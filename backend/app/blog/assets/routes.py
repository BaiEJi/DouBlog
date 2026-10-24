"""
Prompt 与 Skill 资产库 API

- 分类：GET/POST /api/assets/categories、PUT/DELETE /api/assets/categories/<id>
- 资产：GET/POST /api/assets/items（列表过滤 ?kind= ?category_id=<int|none> ?tag=
  ?favorite= ?status= ?q= ?sort= ?page= ?page_size=，列表不含正文）、GET/PUT/DELETE
  /api/assets/items/<id>（DELETE 软删进回收站，?hard=1 物理删除）、
  POST .../restore | /duplicate | /use、POST /api/assets/items/bulk
- 版本：GET /api/assets/items/<id>/versions、GET /api/assets/versions/<vid>、
  POST /api/assets/items/<id>/versions/<vid>/restore（恢复产生新版本）
- 聚合：GET /api/assets/tags、GET /api/assets/stats
- 传输：GET /api/assets/export（全量/过滤导出 JSON 附件）、GET /api/assets/items/<id>/export
  ?format=md|json、POST /api/assets/import（create/upsert 两种模式，支持 dry_run 预检）

版本策略：title/summary/content 变更即快照（未变化不产生版本）；tags/category/
favorite/kind 为元数据变更不快照。使用统计：copy/fill/export 动作计数。
"""

import base64
import json
import orjson
import tempfile
from datetime import datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import String, or_, func, select
from sqlalchemy.orm import defer, joinedload

from app.config import settings
from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.modules import mod_logger
from app.shared.response import api_response
from app.shared.timestamps import _iso, _utcnow
from app.blog.assets.models import (
    KINDS,
    AssetCategory,
    AssetFile,
    AssetItem,
    AssetUsageLog,
    AssetVersion,
)
from app.blog.assets.services import (
    content_changed,
    extract_variables,
    snapshot_version,
    validate_item_payload,
)
from app.blog.assets.skills import parse_skill_upload
from lizysdk.errors import ConflictError, NotFoundError, ParamError

router = APIRouter(prefix='/api/assets', dependencies=[Depends(require_basic)])

logger = mod_logger('blog')

SORTS = {
    'updated_desc': (AssetItem.updated_at.desc(), AssetItem.id.desc()),
    'created_desc': (AssetItem.created_at.desc(), AssetItem.id.desc()),
    'usage_desc': (AssetItem.usage_count.desc(), AssetItem.id.desc()),
    'title_asc': (AssetItem.title.asc(), AssetItem.id.asc()),
    'last_used_desc': (AssetItem.last_used_at.desc(), AssetItem.id.desc()),
}

BULK_ACTIONS = ('favorite', 'unfavorite', 'archive', 'unarchive', 'trash',
                'restore', 'hard_delete', 'move')
USE_ACTIONS = ('copy', 'fill', 'export')
IMPORT_MAX_ITEMS = 500
MAX_TITLE_SAFE = 195          # 复制后缀「（副本）」5 字符的预留


# ─── 工具 ─────────────────────────────────────────────

async def _json_or_empty(request: Request) -> dict:
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001
        return {}
    return data or {}


def _query_int(params, name, default=None):
    raw = params.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _like_escape(s: str) -> str:
    return s.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


def _require_item(item_id) -> AssetItem:
    item = AssetItem.query.options(defer(AssetItem.archive)).filter(AssetItem.id == item_id).first()
    if not item:
        raise NotFoundError(message='资产不存在')
    return item


def _require_category(cat_id) -> AssetCategory:
    cat = db.session.get(AssetCategory, cat_id)
    if not cat:
        raise NotFoundError(message='分类不存在')
    return cat


def _attachment(filename_cn: str) -> dict:
    """中文文件名安全下载头：ASCII 兜底 + RFC 5987 filename*"""
    ascii_name = f'assets-{datetime.now().strftime("%Y%m%d-%H%M%S")}'
    return {
        'Content-Disposition':
            f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename_cn)}",
    }


def _resolve_category_id(raw) -> tuple[int | None, str | None]:
    """导入数据中的分类引用：int=id / str=名称 / {name}=名称 → (id, 待新建名称)"""
    if raw is None:
        return None, None
    if isinstance(raw, bool):
        raise ParamError(message='category 引用无效')
    if isinstance(raw, int):
        cat = db.session.get(AssetCategory, raw)
        if not cat:
            raise ParamError(message=f'分类 id={raw} 不存在')
        return cat.id, None
    name = raw.get('name') if isinstance(raw, dict) else raw
    if not isinstance(name, str) or not name.strip():
        raise ParamError(message='category 引用无效')
    name = name.strip()
    cat = AssetCategory.query.filter(AssetCategory.name == name).first()
    if cat:
        return cat.id, None
    return None, name


# ─── 分类 ─────────────────────────────────────────────

def _category_counts() -> dict[int | None, dict]:
    """非回收站资产按分类聚合 {category_id|None: {count, prompt, skill}}"""
    counts: dict[int | None, dict] = {}
    rows = AssetItem.query.filter(AssetItem.status != 'trash').with_entities(
        AssetItem.category_id, AssetItem.kind, func.count()).group_by(AssetItem.category_id, AssetItem.kind).all()
    for cat_id, kind, count in rows:
        c = counts.setdefault(cat_id, {'count': 0, 'prompt': 0, 'skill': 0})
        c['count'] += count
        c[kind] = c.get(kind, 0) + count
    return counts


def _category_dict_with_counts(cat_dict: dict, stat: dict) -> dict:
    cat_dict.update({'item_count': stat['count'],
                     'prompt_count': stat['prompt'],
                     'skill_count': stat['skill']})
    return cat_dict


UNCATEGORIZED = {'id': None, 'name': '未分类', 'icon': None, 'color': None,
                 'kind': 'all', 'sort_order': 9999, 'created_at': None, 'updated_at': None}


@router.get('/categories')
async def list_categories():
    def _impl():
        cats = AssetCategory.query.order_by(AssetCategory.sort_order, AssetCategory.id).all()
        counts = _category_counts()
        out = [_category_dict_with_counts(
            c.to_dict(), counts.get(c.id, {'count': 0, 'prompt': 0, 'skill': 0}))
            for c in cats]
        out.append(_category_dict_with_counts(
            dict(UNCATEGORIZED), counts.get(None, {'count': 0, 'prompt': 0, 'skill': 0})))
        return api_response(out)
    return await run_db(_impl)


def _validate_category_payload(data: dict, partial: bool = False) -> dict:
    out = {}
    keys = ('name', 'icon', 'color', 'kind', 'sort_order')
    if partial:
        keys = tuple(k for k in keys if k in data)
    if 'name' in keys:
        name = data.get('name')
        if not isinstance(name, str) or not name.strip():
            raise ParamError(message='分类名称不能为空')
        name = name.strip()
        if len(name) > 50:
            raise ParamError(message='分类名称长度不能超过50个字符')
        out['name'] = name
    if 'icon' in keys:
        icon = data.get('icon')
        if icon is not None and (not isinstance(icon, str) or len(icon) > 10):
            raise ParamError(message='icon 必须是不超过10个字符的字符串')
        out['icon'] = icon
    if 'color' in keys:
        color = data.get('color')
        if color is not None and (not isinstance(color, str) or len(color) > 7):
            raise ParamError(message='color 必须是不超过7个字符的字符串')
        out['color'] = color
    if 'kind' in keys:
        kind = data.get('kind') or 'all'
        if kind not in ('all',) + KINDS:
            raise ParamError(message='kind 必须是: all, prompt, skill')
        out['kind'] = kind
    if 'sort_order' in keys:
        so = data.get('sort_order')
        if so is None:
            so = 0
        if not isinstance(so, int) or isinstance(so, bool):
            raise ParamError(message='sort_order 必须为整数')
        out['sort_order'] = so
    return out


@router.post('/categories')
async def create_category(request: Request):
    data = await _json_or_empty(request)

    def _impl():
        patch = _validate_category_payload(data)
        if 'name' not in patch:
            raise ParamError(message='分类名称不能为空')
        if AssetCategory.query.filter(AssetCategory.name == patch['name']).first():
            raise ConflictError(message='分类名称已存在')
        cat = AssetCategory(**patch)
        db.session.add(cat)
        db.session.commit()
        d = cat.to_dict()
        d.update({'item_count': 0, 'prompt_count': 0, 'skill_count': 0})
        logger.info(f'创建分类 {cat.name}(#{cat.id})')
        return api_response(d, 201, '创建成功')
    return await run_db(_impl)


@router.put('/categories/{cat_id}')
async def update_category(cat_id: int, request: Request):
    data = await _json_or_empty(request)

    def _impl():
        cat = _require_category(cat_id)
        patch = _validate_category_payload(data, partial=True)
        if 'name' in patch and patch['name'] != cat.name:
            dup = AssetCategory.query.filter(AssetCategory.name == patch['name']).first()
            if dup and dup.id != cat.id:
                raise ConflictError(message='分类名称已存在')
        for k, v in patch.items():
            setattr(cat, k, v)
        db.session.commit()
        logger.info(f'更新分类 {cat.name}(#{cat.id})')
        return api_response(cat.to_dict(), 200, '更新成功')
    return await run_db(_impl)


@router.delete('/categories/{cat_id}')
async def delete_category(cat_id: int):
    def _impl():
        cat = _require_category(cat_id)
        used = AssetItem.query.filter(AssetItem.category_id == cat_id).count()
        if used:
            raise ConflictError(message=f'分类下仍有 {used} 个资产，请先移动或删除')
        name = cat.name
        db.session.delete(cat)
        db.session.commit()
        logger.info(f'删除分类 {name}(#{cat_id})')
        return api_response(None, 200, '删除成功')
    return await run_db(_impl)


# ─── 资产列表 / CRUD ─────────────────────────────────

@router.get('/items')
async def list_items(request: Request):
    params = request.query_params

    def _impl():
        q = AssetItem.query
        kind = params.get('kind')
        if kind:
            if kind not in KINDS:
                raise ParamError(message=f'kind 必须是: {", ".join(KINDS)}')
            q = q.filter(AssetItem.kind == kind)
        raw_cat = params.get('category_id')
        if raw_cat not in (None, ''):
            if raw_cat == 'none':
                q = q.filter(AssetItem.category_id.is_(None))
            else:
                category_id = _query_int(params, 'category_id')
                if category_id is None:
                    raise ParamError(message='category_id 必须为整数或 none')
                _require_category(category_id)
                q = q.filter(AssetItem.category_id == category_id)
        tag = params.get('tag')
        if tag:
            # JSON 列包含匹配（SQLite 文本 / PG JSON cast 文本皆可走 LIKE）
            q = q.filter(AssetItem.tags.cast(String)
                         .like(f'%{_like_escape(tag)}%', escape='\\'))
        if params.get('favorite') in ('1', 'true'):
            q = q.filter(AssetItem.favorite.is_(True))
        status = params.get('status') or 'active'
        if status not in ('active', 'archived', 'trash', 'all'):
            raise ParamError(message='status 必须是: active, archived, trash, all')
        if status != 'all':
            q = q.filter(AssetItem.status == status)
        keyword = (params.get('q') or '').strip()
        if keyword:
            pat = f'%{_like_escape(keyword)}%'
            q = q.filter(or_(AssetItem.title.like(pat, escape='\\'),
                             AssetItem.summary.like(pat, escape='\\'),
                             AssetItem.content.like(pat, escape='\\')))

        total = q.with_entities(func.count(AssetItem.id)).scalar()
        sort = params.get('sort') or 'updated_desc'
        order = SORTS.get(sort)
        if order is None:
            raise ParamError(message=f'sort 必须是: {", ".join(SORTS)}')
        page = max(_query_int(params, 'page', 1) or 1, 1)
        page_size = _query_int(params, 'page_size', 20) or 20
        page_size = max(1, min(page_size, settings.max_page_size))
        items = (q.options(defer(AssetItem.content), defer(AssetItem.archive), joinedload(AssetItem.category)).order_by(*order)
                  .offset((page - 1) * page_size).limit(page_size).all())
        ids = [item.id for item in items]
        version_counts = dict(db.session.query(AssetVersion.item_id, func.count()).filter(
            AssetVersion.item_id.in_(ids)).group_by(AssetVersion.item_id).all()) if ids else {}
        file_counts = dict(db.session.query(AssetFile.item_id, func.count()).filter(
            AssetFile.item_id.in_(ids)).group_by(AssetFile.item_id).all()) if ids else {}
        return api_response({
            'items': [i.to_dict(counts=(version_counts.get(i.id, 0), file_counts.get(i.id, 0))) for i in items],
            'total': total, 'page': page, 'page_size': page_size,
        })
    return await run_db(_impl)


@router.post('/items')
async def create_item(request: Request):
    data = await _json_or_empty(request)

    def _impl():
        patch = validate_item_payload(data)
        if not patch.get('title') or not patch.get('content'):
            raise ParamError(message='标题与正文不能为空')
        category_id = data.get('category_id')
        if category_id is not None:
            _require_category(category_id)
        favorite = data.get('favorite')
        if favorite not in (None, True, False):
            raise ParamError(message='favorite 必须为布尔值')
        item = AssetItem(
            kind=patch['kind'], title=patch['title'], summary=patch.get('summary'),
            content=patch['content'], category_id=category_id,
            tags=patch.get('tags', []),
            variables=extract_variables(patch['content']),
            favorite=bool(favorite),
        )
        db.session.add(item)
        db.session.flush()                      # 取 id 后写 v1 快照
        db.session.add(snapshot_version(
            item, (data.get('version_note') or '').strip() or '初始版本'))
        db.session.commit()
        logger.info(f'创建资产 {item.title}(#{item.id}, {item.kind})')
        return api_response(item.to_dict(include_content=True), 201, '创建成功')
    return await run_db(_impl)


@router.get('/items/{item_id}')
async def get_item(item_id: int):
    def _impl():
        item = _require_item(item_id)
        return api_response(item.to_dict(include_content=True))
    return await run_db(_impl)


@router.put('/items/{item_id}')
async def update_item(item_id: int, request: Request):
    data = await _json_or_empty(request)

    def _impl():
        item = _require_item(item_id)
        if item.status == 'trash':
            raise ConflictError(message='回收站资产不能编辑，请先恢复')
        patch = validate_item_payload(data, partial=True)
        if 'category_id' in data:
            cid = data.get('category_id')
            if cid is not None:
                _require_category(cid)
            patch['category_id'] = cid
        if 'favorite' in data:
            if not isinstance(data['favorite'], bool):
                raise ParamError(message='favorite 必须为布尔值')
            patch['favorite'] = data['favorite']

        versioned = content_changed(item, patch)
        for k, v in patch.items():
            setattr(item, k, v)
        if 'content' in patch:
            item.variables = extract_variables(item.content)
        if versioned:
            item.version += 1
            db.session.add(snapshot_version(
                item, (data.get('version_note') or '').strip() or None))
        db.session.commit()
        logger.info(f'更新资产 {item.title}(#{item.id}) -> v{item.version}')
        return api_response(item.to_dict(include_content=True), 200, '更新成功')
    return await run_db(_impl)


@router.delete('/items/{item_id}')
async def delete_item(item_id: int, request: Request):
    hard = request.query_params.get('hard') in ('1', 'true')

    def _impl():
        item = _require_item(item_id)
        title = item.title
        if hard:
            db.session.delete(item)
            db.session.commit()
            logger.info(f'彻底删除资产 {title}(#{item_id})')
            return api_response(None, 200, '已彻底删除')
        item.status = 'trash'
        db.session.commit()
        logger.info(f'资产 {title}(#{item_id}) 移入回收站')
        return api_response(None, 200, '已移入回收站')
    return await run_db(_impl)


@router.post('/items/{item_id}/restore')
async def restore_item(item_id: int):
    def _impl():
        item = _require_item(item_id)
        if item.status == 'active':
            raise ConflictError(message='资产不在回收站/归档中')
        item.status = 'active'
        db.session.commit()
        return api_response(item.to_dict(), 200, '已恢复')
    return await run_db(_impl)


@router.post('/items/{item_id}/duplicate')
async def duplicate_item(item_id: int):
    def _impl():
        src = _require_item(item_id)
        copy = AssetItem(
            kind=src.kind, title=src.title, summary=src.summary, content=src.content,
            category_id=src.category_id, tags=list(src.tags or []),
            variables=extract_variables(src.content),
            favorite=False, status='active', version=1,
        )
        # 标题撞名不阻断（资产无唯一约束），加后缀便于区分
        if AssetItem.query.filter(AssetItem.title == copy.title,
                                  AssetItem.status != 'trash').count():
            copy.title = f'{src.title[:MAX_TITLE_SAFE]}（副本）'
        db.session.add(copy)
        db.session.flush()
        db.session.add(snapshot_version(copy, f'复制自 #{src.id}'))
        db.session.commit()
        logger.info(f'复制资产 {src.title}(#{src.id}) -> #{copy.id}')
        return api_response(copy.to_dict(include_content=True), 201, '已复制')
    return await run_db(_impl)


@router.post('/items/{item_id}/use')
async def use_item(item_id: int, request: Request):
    data = await _json_or_empty(request)

    def _impl():
        item = _require_item(item_id)
        if item.status == 'trash':
            raise ConflictError(message='回收站资产不能使用')
        action = data.get('action') or 'copy'
        if action not in USE_ACTIONS:
            raise ParamError(message=f'action 必须是: {", ".join(USE_ACTIONS)}')
        item.usage_count += 1
        item.last_used_at = _utcnow()
        db.session.add(AssetUsageLog(item_id=item.id, action=action))
        db.session.commit()
        return api_response({'id': item.id, 'title': item.title, 'kind': item.kind,
                             'content': item.content,
                             'usage_count': item.usage_count,
                             'last_used_at': _iso(item.last_used_at)}, 200, '使用已记录')
    return await run_db(_impl)


@router.post('/items/bulk')
async def bulk_items(request: Request):
    data = await _json_or_empty(request)

    def _impl():
        action = data.get('action')
        if action not in BULK_ACTIONS:
            raise ParamError(message=f'action 必须是: {", ".join(BULK_ACTIONS)}')
        ids = data.get('ids')
        if not isinstance(ids, list) or not ids or len(ids) > 500:
            raise ParamError(message='ids 必须为非空数组（≤500）')
        category_id = None
        if action == 'move':
            category_id = data.get('category_id')
            if category_id is not None:
                _require_category(category_id)
        items = AssetItem.query.filter(AssetItem.id.in_(ids)).all()
        for item in items:
            if action == 'favorite':
                item.favorite = True
            elif action == 'unfavorite':
                item.favorite = False
            elif action == 'archive':
                if item.status == 'active':
                    item.status = 'archived'
            elif action == 'unarchive':
                if item.status == 'archived':
                    item.status = 'active'
            elif action == 'trash':
                item.status = 'trash'
            elif action == 'restore':
                if item.status != 'active':
                    item.status = 'active'
            elif action == 'hard_delete':
                db.session.delete(item)
            elif action == 'move':
                item.category_id = category_id
        db.session.commit()
        logger.info(f'批量操作 {action} × {len(items)}')
        return api_response({'affected': len(items)}, 200, '批量操作完成')
    return await run_db(_impl)


# ─── Skill 包导入 / 文件 ─────────────────────────────

@router.post('/skills/import')
async def import_skill(request: Request):
    """multipart `file` 上传 Skill（.md 单文件宽松 / .zip 严格规格校验）→
    解析描述建条目 + 存文件清单 + 保留原始 zip；响应先给出提取结果"""
    try:
        form = await request.form()
    except Exception:  # noqa: BLE001
        raise ParamError(message='请求必须是 multipart/form-data')
    upload = form.get('file')
    if upload is None or not hasattr(upload, 'read'):
        raise ParamError(message='缺少 file 字段')
    filename = upload.filename or 'SKILL.md'
    data = await upload.read()

    def _impl():
        draft = parse_skill_upload(filename, data)
        item = AssetItem(
            kind='skill', title=draft['name'], summary=draft['description'],
            content=draft['content'], variables=extract_variables(draft['content']),
            archive=draft.get('archive'), archive_name=draft.get('archive_name'),
        )
        db.session.add(item)
        db.session.flush()
        db.session.add(snapshot_version(item, f'Skill 包导入（{filename}）'))
        for f in draft['files']:
            db.session.add(AssetFile(
                item_id=item.id, path=f['path'], size=f['size'],
                is_text=f['is_text'], content=f['content']))
        db.session.commit()
        logger.info(f"导入 Skill {draft['name']}(#{item.id})：{len(draft['files'])} 个文件"
                    f"（{'zip' if draft.get('archive') else '单文件'}）")
        out = item.to_dict(include_content=True)
        # 先输出提取结果（规格字段 + 文件树），前端据此直接展示
        out['skill'] = {'name': draft['name'], 'description': draft['description'],
                        'entry': 'SKILL.md',
                        'files': [f['path'] for f in draft['files']]}
        return api_response(out, 201, '导入成功')
    return await run_db(_impl)


@router.get('/items/{item_id}/files')
async def list_item_files(item_id: int):
    def _impl():
        if not db.session.query(AssetItem.id).filter(AssetItem.id == item_id).scalar():
            raise NotFoundError(message='资产不存在')
        rows = AssetFile.query.filter(AssetFile.item_id == item_id) \
            .order_by(AssetFile.path).all()
        return api_response([f.to_dict() for f in rows])
    return await run_db(_impl)


@router.get('/files/{file_id}')
async def get_file(file_id: int):
    def _impl():
        f = db.session.get(AssetFile, file_id)
        if not f:
            raise NotFoundError(message='文件不存在')
        return api_response(f.to_dict(include_content=True))
    return await run_db(_impl)


@router.get('/items/{item_id}/archive')
async def download_archive(item_id: int):
    def _impl():
        item = _require_item(item_id)
        if not item.archive:
            raise NotFoundError(message='该资产没有原始压缩包')
        name = item.archive_name or f'{item.title}.zip'
        return Response(item.archive, media_type='application/zip',
                        headers=_attachment(name))
    return await run_db(_impl)


# ─── 版本 ─────────────────────────────────────────────

@router.get('/items/{item_id}/versions')
async def list_versions(item_id: int, request: Request):
    def _impl():
        paged = 'page' in request.query_params
        identity_query = db.session.query(AssetItem.id).filter(AssetItem.id == item_id)
        if paged:
            version_count = select(func.count()).select_from(AssetVersion).where(
                AssetVersion.item_id == item_id).correlate(None).scalar_subquery()
            identity = identity_query.add_columns(version_count).one_or_none()
            exists = identity[0] if identity else None
            total = identity[1] if identity else 0
        else:
            exists = identity_query.scalar()
        if not exists:
            raise NotFoundError(message='资产不存在')
        q = AssetVersion.query.options(defer(AssetVersion.content), defer(AssetVersion.summary)).filter(
            AssetVersion.item_id == item_id).order_by(AssetVersion.version.desc(), AssetVersion.id.desc())
        if not paged:
            return api_response([v.to_dict() for v in q.all()])
        page = max(1, _query_int(request.query_params, 'page', 1) or 1)
        size = max(1, min(100, _query_int(request.query_params, 'page_size', 20) or 20))
        return api_response({'items': [v.to_dict() for v in q.offset((page - 1) * size).limit(size)],
                             'page': page, 'page_size': size, 'total': total})
    return await run_db(_impl)


@router.get('/versions/{version_id}')
async def get_version(version_id: int):
    def _impl():
        v = db.session.get(AssetVersion, version_id)
        if not v:
            raise NotFoundError(message='版本不存在')
        return api_response(v.to_dict(include_content=True))
    return await run_db(_impl)


@router.post('/items/{item_id}/versions/{version_id}/restore')
async def restore_version(item_id: int, version_id: int):
    def _impl():
        item = _require_item(item_id)
        if item.status == 'trash':
            raise ConflictError(message='回收站资产不能恢复版本，请先恢复资产')
        v = db.session.get(AssetVersion, version_id)
        if not v or v.item_id != item.id:
            raise NotFoundError(message='版本不存在')
        if v.version == item.version and v.content == item.content \
                and v.title == item.title and v.summary == item.summary:
            raise ConflictError(message='该版本即当前版本')
        item.title, item.summary, item.content = v.title, v.summary, v.content
        item.variables = extract_variables(item.content)
        item.version += 1
        db.session.add(snapshot_version(item, f'恢复自 v{v.version}'))
        db.session.commit()
        logger.info(f'资产 #{item.id} 恢复 v{v.version} -> v{item.version}')
        return api_response(item.to_dict(include_content=True), 200,
                            f'已恢复到 v{v.version}')
    return await run_db(_impl)


# ─── 标签 / 统计 ─────────────────────────────────────

@router.get('/tags')
async def list_tags():
    def _impl():
        counts: dict[str, int] = {}
        rows = AssetItem.query.filter(AssetItem.status != 'trash') \
            .with_entities(AssetItem.tags).all()
        for (tags,) in rows:
            for t in tags or []:
                counts[t] = counts.get(t, 0) + 1
        out = [{'tag': t, 'count': c} for t, c in
               sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]
        return api_response(out)
    return await run_db(_impl)


@router.get('/stats')
async def stats():
    def _impl():
        items = AssetItem.query.options(defer(AssetItem.content), defer(AssetItem.archive)).all()
        live = [i for i in items if i.status != 'trash']
        active = [i for i in live if i.status == 'active']
        archived = [i for i in live if i.status == 'archived']
        trash = [i for i in items if i.status == 'trash']

        tag_set = {t for i in live for t in (i.tags or [])}
        versions_total = AssetVersion.query.count()

        by_category = []
        cats = AssetCategory.query.order_by(AssetCategory.sort_order, AssetCategory.id).all()
        for c in cats:
            members = [i for i in live if i.category_id == c.id]
            by_category.append({'id': c.id, 'name': c.name, 'icon': c.icon, 'color': c.color,
                                'count': len(members),
                                'prompt_count': sum(1 for i in members if i.kind == 'prompt'),
                                'skill_count': sum(1 for i in members if i.kind == 'skill')})
        uncat = [i for i in live if i.category_id is None]
        by_category.append({'id': None, 'name': '未分类', 'icon': None, 'color': None,
                            'count': len(uncat),
                            'prompt_count': sum(1 for i in uncat if i.kind == 'prompt'),
                            'skill_count': sum(1 for i in uncat if i.kind == 'skill')})

        top_used = sorted(live, key=lambda i: (-i.usage_count, i.id))[:5]
        recent_used = sorted((i for i in live if i.last_used_at),
                             key=lambda i: (i.last_used_at, i.id), reverse=True)[:5]

        since = _utcnow() - timedelta(days=29)
        logs = AssetUsageLog.query.filter(AssetUsageLog.created_at >= since) \
            .with_entities(AssetUsageLog.created_at).all()
        day_count: dict[str, int] = {}
        for (created_at,) in logs:
            day = (_iso(created_at) or '')[:10]
            if day:
                day_count[day] = day_count.get(day, 0) + 1
        trend = []
        day = since.date()
        for _ in range(30):
            key = day.isoformat()
            trend.append({'date': key, 'count': day_count.get(key, 0)})
            day += timedelta(days=1)

        return api_response({
            'totals': {
                'prompts': sum(1 for i in live if i.kind == 'prompt'),
                'skills': sum(1 for i in live if i.kind == 'skill'),
                'active': len(active), 'archived': len(archived), 'trash': len(trash),
                'favorites': sum(1 for i in live if i.favorite),
                'categories': AssetCategory.query.count(),
                'tags': len(tag_set), 'versions': versions_total,
                'total_usage': sum(i.usage_count for i in live),
            },
            'by_category': by_category,
            'top_used': [{'id': i.id, 'title': i.title, 'kind': i.kind,
                          'usage_count': i.usage_count} for i in top_used if i.usage_count],
            'recent_used': [{'id': i.id, 'title': i.title, 'kind': i.kind,
                             'last_used_at': _iso(i.last_used_at)} for i in recent_used],
            'usage_trend': trend,
        })
    return await run_db(_impl)


# ─── 导出 / 导入 ─────────────────────────────────────

def _export_items(params):
    """按过滤条件取要导出的资产（含正文；可选含历史版本）"""
    q = AssetItem.query
    kind = params.get('kind')
    if kind:
        if kind not in KINDS:
            raise ParamError(message=f'kind 必须是: {", ".join(KINDS)}')
        q = q.filter(AssetItem.kind == kind)
    category_id = _query_int(params, 'category_id')
    if category_id is not None:
        q = q.filter(AssetItem.category_id == category_id)
    if params.get('favorite') in ('1', 'true'):
        q = q.filter(AssetItem.favorite.is_(True))
    keyword = (params.get('q') or '').strip()
    if keyword:
        pat = f'%{_like_escape(keyword)}%'
        q = q.filter(or_(AssetItem.title.like(pat, escape='\\'),
                         AssetItem.summary.like(pat, escape='\\'),
                         AssetItem.content.like(pat, escape='\\')))
    include_trash = params.get('include_trash') in ('1', 'true')
    if not include_trash:
        q = q.filter(AssetItem.status != 'trash')
    include_versions = params.get('include_versions') in ('1', 'true')
    offset = 0
    while True:
        items = q.options(joinedload(AssetItem.category)).order_by(AssetItem.id).offset(offset).limit(50).all()
        if not items:
            break
        ids = [item.id for item in items]
        versions_by_item, files_by_item = {}, {}
        if include_versions:
            for version in AssetVersion.query.filter(AssetVersion.item_id.in_(ids)).order_by(AssetVersion.version):
                versions_by_item.setdefault(version.item_id, []).append(version.to_dict(include_content=True))
        for file in AssetFile.query.filter(AssetFile.item_id.in_(ids)).order_by(AssetFile.path):
            files_by_item.setdefault(file.item_id, []).append(file.to_dict(include_content=True))
        for item in items:
            result = {
                'kind': item.kind, 'title': item.title, 'summary': item.summary,
                'content': item.content, 'tags': item.tags or [], 'favorite': bool(item.favorite),
                'status': item.status, 'usage_count': item.usage_count,
                'category': item.category.name if item.category else None,
            }
            if include_versions:
                result['versions'] = versions_by_item.get(item.id, [])
            if item.id in files_by_item:
                result['files'] = files_by_item[item.id]
            if item.archive:
                result['archive_name'] = item.archive_name
                result['archive_b64'] = base64.b64encode(item.archive).decode('ascii')
            yield result
        offset += len(items)


@router.get('/export')
async def export_assets(request: Request):
    params = request.query_params

    def _impl():
        spool = tempfile.SpooledTemporaryFile(max_size=4 * 1024 * 1024, mode='w+b')
        try:
            spool.write(b'{"items":[')
            count = 0
            for item in _export_items(params):
                if count:
                    spool.write(b',')
                spool.write(orjson.dumps(item))
                count += 1
            metadata = orjson.dumps({'generator': 'doulog-assets', 'version': 1,
                'exported_at': _utcnow().isoformat(), 'count': count})
            spool.write(b'],' + metadata[1:])
            spool.seek(0)
        except BaseException:
            spool.close()
            raise
        def chunks():
            try:
                while chunk := spool.read(64 * 1024):
                    yield chunk
            finally:
                spool.close()
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        return StreamingResponse(chunks(), media_type='application/json',
            headers=_attachment(f'doulog-assets-{stamp}.json'))
    return await run_db(_impl)


@router.get('/items/{item_id}/export')
async def export_item(item_id: int, request: Request):
    fmt = (request.query_params.get('format') or 'md').lower()

    def _impl():
        item = _require_item(item_id)
        if fmt == 'json':
            body = orjson.dumps(item.to_dict(include_content=True),
                                option=orjson.OPT_INDENT_2).decode('utf-8')
            return Response(body, media_type='application/json',
                            headers=_attachment(f'{item.title}.json'))
        if fmt != 'md':
            raise ParamError(message='format 必须是: md, json')
        fm = {'title': item.title, 'kind': item.kind, 'tags': item.tags or [],
              'created_at': _iso(item.created_at), 'updated_at': _iso(item.updated_at)}
        if item.summary:
            fm['summary'] = item.summary
        body = '---\n' + orjson.dumps(fm, option=orjson.OPT_INDENT_2).decode('utf-8') + '\n---\n\n' \
            + item.content + '\n'
        return Response(body, media_type='text/markdown; charset=utf-8',
                        headers=_attachment(f'{item.title}.md'))
    return await run_db(_impl)


def _normalize_import_item(raw, index: int) -> dict:
    """单条导入数据规范化；不合法抛 ParamError（调用方按条捕获入 errors）"""
    if not isinstance(raw, dict):
        raise ParamError(message='条目必须是对象')
    kind = raw.get('kind') or 'prompt'
    if kind not in KINDS:
        raise ParamError(message=f'kind 必须是: {", ".join(KINDS)}')
    normalized = validate_item_payload({'kind': kind, 'title': raw.get('title'),
                                        'summary': raw.get('summary'),
                                        'content': raw.get('content'),
                                        'tags': raw.get('tags') or []})
    favorite = raw.get('favorite')
    if favorite not in (None, True, False):
        raise ParamError(message='favorite 必须为布尔值')
    usage_count = raw.get('usage_count') or 0
    if not isinstance(usage_count, int) or isinstance(usage_count, bool) or usage_count < 0:
        raise ParamError(message='usage_count 必须为非负整数')
    status = raw.get('status') or 'active'
    if status not in ('active', 'archived'):
        status = 'active'
    versions = raw.get('versions')
    if versions is not None and not isinstance(versions, list):
        raise ParamError(message='versions 必须为数组')
    files = raw.get('files')
    if files is not None and not isinstance(files, list):
        raise ParamError(message='files 必须为数组')
    archive_b64 = raw.get('archive_b64')
    if archive_b64 is not None:
        if not isinstance(archive_b64, str):
            raise ParamError(message='archive_b64 必须为 base64 字符串')
        try:
            archive_bytes = base64.b64decode(archive_b64, validate=True)
        except Exception:  # noqa: BLE001
            raise ParamError(message='archive_b64 不是有效的 base64')
        if len(archive_bytes) > 10 * 1024 * 1024:
            raise ParamError(message='archive_b64 解码后超过 10MB')
    else:
        archive_bytes = None
    archive_name = raw.get('archive_name')
    if archive_name is not None and not isinstance(archive_name, str):
        raise ParamError(message='archive_name 必须为字符串')
    out = dict(normalized)
    out.update({'index': index, 'favorite': bool(favorite), 'status': status,
                'usage_count': usage_count, 'category': raw.get('category'),
                'versions': versions, 'files': files,
                'archive': archive_bytes, 'archive_name': archive_name})
    return out


@router.post('/import')
async def import_assets(request: Request):
    data = await _json_or_empty(request)

    def _impl():
        raw_items = data.get('items') if isinstance(data, dict) else data
        if not isinstance(raw_items, list) or not raw_items:
            raise ParamError(message='导入内容为空（items 数组缺失）')
        if len(raw_items) > IMPORT_MAX_ITEMS:
            raise ParamError(message=f'单次导入不能超过 {IMPORT_MAX_ITEMS} 条')
        mode = (data.get('mode') or 'upsert') if isinstance(data, dict) else 'upsert'
        if mode not in ('create', 'upsert'):
            raise ParamError(message='mode 必须是: create, upsert')
        dry_run = bool(data.get('dry_run')) if isinstance(data, dict) else False

        normalized, errors = [], []
        for idx, raw in enumerate(raw_items):
            try:
                normalized.append(_normalize_import_item(raw, idx))
            except Exception as e:  # noqa: BLE001 单条非法不阻断整体
                errors.append({'index': idx,
                               'title': raw.get('title') if isinstance(raw, dict) else None,
                               'error': getattr(e, 'message', None) or str(e)})

        created = updated = 0
        categories_created: list[str] = []

        def _category_for(entry) -> int | None:
            cid, to_create = _resolve_category_id(entry['category'])
            if cid is None and to_create:
                if dry_run:
                    if to_create not in categories_created:
                        categories_created.append(to_create)
                    return None
                cat = AssetCategory(name=to_create)
                db.session.add(cat)
                db.session.flush()
                categories_created.append(cat.name)
                return cat.id
            return cid

        for entry in normalized:
            try:
                category_id = _category_for(entry)
                if dry_run:
                    continue
                existing = None
                if mode == 'upsert':
                    existing = AssetItem.query.filter(
                        AssetItem.kind == entry['kind'],
                        AssetItem.title == entry['title'],
                        AssetItem.status != 'trash',
                    ).first()
                if existing:
                    patch = {k: entry[k] for k in ('kind', 'title', 'summary',
                                                   'content', 'tags') if k in entry}
                    versioned = content_changed(existing, patch)
                    for k, v in patch.items():
                        setattr(existing, k, v)
                    existing.variables = extract_variables(existing.content)
                    existing.category_id = category_id
                    existing.favorite = entry['favorite']
                    if versioned:
                        existing.version += 1
                        db.session.add(snapshot_version(existing, '导入更新'))
                    updated += 1
                else:
                    item = AssetItem(
                        kind=entry['kind'], title=entry['title'],
                        summary=entry.get('summary'), content=entry['content'],
                        category_id=category_id, tags=entry.get('tags', []),
                        variables=extract_variables(entry['content']),
                        favorite=entry['favorite'], status=entry['status'],
                        usage_count=entry['usage_count'],
                        archive=entry.get('archive'),
                        archive_name=entry.get('archive_name') if entry.get('archive') else None,
                    )
                    db.session.add(item)
                    db.session.flush()
                    # Skill 包文件（可选）：随条目一起恢复
                    for f in entry.get('files') or []:
                        if not isinstance(f, dict) or not isinstance(f.get('path'), str):
                            continue
                        db.session.add(AssetFile(
                            item_id=item.id, path=f['path'][:500],
                            size=int(f.get('size') or 0),
                            is_text=bool(f.get('is_text', True)),
                            content=f.get('content') if f.get('is_text', True) else None))
                    # 历史版本（可选）：重排为连续版本链，当前内容确保在链尾
                    vers = [v for v in (entry.get('versions') or [])
                            if isinstance(v, dict) and isinstance(v.get('content'), str)]
                    if vers:
                        seq = 0
                        for v in vers:
                            seq += 1
                            db.session.add(AssetVersion(
                                item_id=item.id, version=seq,
                                title=str(v.get('title') or item.title)[:200],
                                summary=v.get('summary'), content=v['content'],
                                note=str(v.get('note') or '')[:200] or None))
                        if vers[-1].get('content') != item.content:
                            seq += 1
                            db.session.add(AssetVersion(
                                item_id=item.id, version=seq, title=item.title,
                                summary=item.summary, content=item.content,
                                note='导入（当前）'))
                        item.version = seq
                    else:
                        db.session.add(snapshot_version(item, '导入'))
                    created += 1
            except Exception as e:  # noqa: BLE001 单条失败不阻断整体
                errors.append({'index': entry['index'], 'title': entry['title'],
                               'error': getattr(e, 'message', None) or str(e)})

        if not dry_run:
            db.session.commit()
            logger.info(f'导入资产 mode={mode} created={created} updated={updated} '
                        f'errors={len(errors)}')
        return api_response({
            'dry_run': dry_run, 'mode': mode,
            'created': 0 if dry_run else created,
            'updated': 0 if dry_run else updated,
            'errors': errors,
            'categories_created': categories_created,
            'valid': len(normalized),
        }, 200, '预检完成' if dry_run else '导入完成')
    return await run_db(_impl)
