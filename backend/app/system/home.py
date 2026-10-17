"""
门户工作台布局 API（system 模块，2026-10-17）

主页卡片的分组 / 顺序 / 标题描述自定义覆盖全量持久化在库（此前仅 localStorage）：

- GET    /api/home/layout    读布局（空库返回 groups: []，前端渲染内置默认单组）
- PUT    /api/home/layout    整体替换布局（单用户低频操作，全删全插一个事务）
- DELETE /api/home/layout    清空布局（恢复默认；前端回到内置单组全卡）

存储模型（models.py）：system_home_groups（分组 + 组间顺序）+
system_home_cards（卡片：group_id 归组 + position 组内顺序 + title/desc 覆盖）。
title/desc 为 null 表示沿用前端内置默认文案——内置文案升级可向前传播，
"恢复默认文案" = 清覆盖，不动分组。

key 是模块标识（如 blog / diary，前端 systems.js 单源），服务端只校验格式
（新增模块无需后端同步）；前端对未知 key 自动滤除、缺失模块自动补到末组。
"""
import re

from fastapi import APIRouter, Depends, Request

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.modules import mod_logger
from app.shared.response import api_response

router = APIRouter(prefix='/api/home', dependencies=[Depends(require_basic)])

logger = mod_logger('system')

# 布局规模护栏（单用户 15 卡，上限留足余量防滥用）
MAX_GROUPS = 20
MAX_CARDS_PER_GROUP = 60
MAX_TITLE_LEN = 120
MAX_DESC_LEN = 300
MAX_NAME_LEN = 64

# key = 模块标识：小写字母开头，字母数字_-，1-40 位
_KEY_RE = re.compile(r'^[a-z][a-z0-9_-]{0,39}$')


def _clean_text(value, max_len):
    """None/非字符串 → None；否则 strip，空串视为 null（= 用默认），超长截断由调用方校验"""
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _parse_layout(body: dict) -> tuple[list[dict] | None, str | None]:
    """校验并规整请求体 → ([{name, cards: [{key,title,desc}]}], None) 或 (None, 错误消息)"""
    groups = body.get('groups')
    if not isinstance(groups, list) or not groups:
        return None, 'groups 需为非空数组'
    if len(groups) > MAX_GROUPS:
        return None, f'分组数量上限 {MAX_GROUPS}'

    seen_keys = set()
    parsed = []
    for gi, g in enumerate(groups):
        if not isinstance(g, dict):
            return None, f'第 {gi + 1} 个分组格式错误'
        name = g.get('name')
        if not isinstance(name, str) or not name.strip():
            return None, f'第 {gi + 1} 个分组缺少名称'
        name = name.strip()
        if len(name) > MAX_NAME_LEN:
            return None, f'分组名称超长（≤{MAX_NAME_LEN} 字符）'

        cards = g.get('cards')
        if not isinstance(cards, list):
            return None, f'分组「{name}」的 cards 需为数组'
        if len(cards) > MAX_CARDS_PER_GROUP:
            return None, f'分组「{name}」卡片数量上限 {MAX_CARDS_PER_GROUP}'

        pcards = []
        for ci, c in enumerate(cards):
            if not isinstance(c, dict):
                return None, f'分组「{name}」第 {ci + 1} 张卡格式错误'
            key = c.get('key')
            if not isinstance(key, str) or not _KEY_RE.fullmatch(key):
                return None, f'卡片 key 非法：{key!r}（小写字母开头，字母数字_-）'
            if key in seen_keys:
                return None, f'卡片 {key} 重复出现（一张卡只能归一个组）'
            seen_keys.add(key)
            title = _clean_text(c.get('title'), MAX_TITLE_LEN)
            desc = _clean_text(c.get('desc'), MAX_DESC_LEN)
            if title and len(title) > MAX_TITLE_LEN:
                return None, f'卡片 {key} 标题超长（≤{MAX_TITLE_LEN} 字符）'
            if desc and len(desc) > MAX_DESC_LEN:
                return None, f'卡片 {key} 描述超长（≤{MAX_DESC_LEN} 字符）'
            pcards.append({'key': key, 'title': title, 'desc': desc})
        parsed.append({'name': name, 'cards': pcards})
    return parsed, None


def _load_layout() -> dict:
    """当前布局 → {groups: [{id, name, cards: [{key,title,desc}]}]}（按 position 排序）"""
    from app.system.models import SystemHomeCard, SystemHomeGroup

    groups = (db.session.query(SystemHomeGroup)
              .order_by(SystemHomeGroup.position, SystemHomeGroup.id).all())
    cards = (db.session.query(SystemHomeCard)
             .order_by(SystemHomeCard.group_id, SystemHomeCard.position, SystemHomeCard.key).all())
    by_group: dict[int, list] = {}
    for c in cards:
        by_group.setdefault(c.group_id, []).append(c.to_dict())
    return {'groups': [
        {'id': g.id, 'name': g.name, 'cards': by_group.get(g.id, [])}
        for g in groups
    ]}


def _replace_layout(parsed: list[dict]) -> dict:
    """全删全插（一个事务）；分组 id 重新自增分配，返回规整后的布局"""
    from app.system.models import SystemHomeCard, SystemHomeGroup

    db.session.query(SystemHomeCard).delete()
    db.session.query(SystemHomeGroup).delete()
    for gi, g in enumerate(parsed):
        row = SystemHomeGroup(name=g['name'], position=gi)
        db.session.add(row)
        db.session.flush()   # 拿自增 id 供卡片外联
        for ci, c in enumerate(g['cards']):
            db.session.add(SystemHomeCard(
                key=c['key'], group_id=row.id, position=ci,
                title=c['title'], desc=c['desc'],
            ))
    db.session.commit()
    return _load_layout()


@router.get('/layout')
async def home_layout_get():
    """读布局；空库（未自定义过）返回 groups: []，前端渲染内置默认"""
    return api_response(await run_db(_load_layout))


@router.put('/layout')
async def home_layout_put(request: Request):
    """整体替换布局（分组 + 卡片顺序 + 标题描述覆盖）；返回带服务端 id 的规整结果"""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 - 非法 JSON 按空体处理
        body = {}
    if not isinstance(body, dict):
        body = {}
    parsed, err = _parse_layout(body)
    if err:
        return api_response(None, 400, err)

    def _run():
        result = _replace_layout(parsed)
        logger.info('门户布局已更新: %d 组 %d 卡', len(result['groups']),
                    sum(len(g['cards']) for g in result['groups']))
        return api_response(result)
    return await run_db(_run)


@router.delete('/layout')
async def home_layout_reset():
    """清空布局（恢复默认分组与默认文案）"""
    from app.system.models import SystemHomeCard, SystemHomeGroup

    def _run():
        db.session.query(SystemHomeCard).delete()
        db.session.query(SystemHomeGroup).delete()
        db.session.commit()
        logger.info('门户布局已重置为默认')
        return api_response({'groups': []}, 200, '已恢复默认布局')
    return await run_db(_run)
