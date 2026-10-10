"""
Vault API（零知识密码库）

服务端职责边界（重要）：
- 只存取密文（blob = {n, ct}）与包裹后的 VEK 材料；不理解、不解析、不搜索内容
- 不提供任何明文敏感字段的接口（API 层面不存在 password/secret 参数）
- 不做密码强度/复用分析（客户端解密后自行完成）
- 审计日志只记 action + item_id + 时间

条目生命周期：创建 → 更新 → 软删（回收站 deleted_at）→ restore / purge。
"""

import json
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.response import api_response
from app.shared.timestamps import _iso
from app.vault.models import VaultAccount, VaultItem, VaultAttachment, VaultAuditLog

router = APIRouter(prefix='/api/vault', dependencies=[Depends(require_basic)], tags=['vault'])

# blob / 包裹材料的结构约束：仅接受 {n: base64(12B), ct: base64} 形态
_B64_LEN = (4, 64, 200000)


def _valid_box(box):
    return (isinstance(box, dict)
            and isinstance(box.get('n'), str) and 16 <= len(box['n']) <= _B64_LEN[1]
            and isinstance(box.get('ct'), str) and 8 <= len(box['ct']) <= _B64_LEN[2])


def _audit(action, item_id=None):
    db.session.add(VaultAuditLog(action=action, item_id=item_id))


def _iso_or_none(value):
    """接受 ISO 字串转 datetime；非法返回 None"""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None


async def _json_body(request: Request):
    """等价 Flask ``request.get_json(silent=True) or {}``：解析失败/空体给 {}"""
    try:
        data = await request.json()
    except ValueError:
        return {}
    return data or {}


def _query_int(request: Request, key: str, default: int) -> int:
    """等价 Flask ``request.args.get(key, default, type=int)``：非法值回退默认"""
    value = request.query_params.get(key)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _retry_locked(fn, attempts: int = 4):
    """SQLite 写锁竞争兜底：偶发 OperationalError(database is locked) 时回滚后短退避重试。

    高并发写下偶发锁等待超时（busy_timeout 之外的快照冲突等，单发概率 ~0.1%）；
    重试前 rollback 丢弃半途事务保证幂等。非锁类 OperationalError 原样抛出。
    """
    def _impl():
        for i in range(attempts - 1):
            try:
                return fn()
            except OperationalError as e:
                if 'lock' not in str(getattr(e, 'orig', '')) and 'lock' not in str(e):
                    raise
                db.session.rollback()
                time.sleep(0.02 * (i + 1))
        return fn()
    return _impl


# ─── 条目列表快速序列化（性能路径）───────────────────────
# 列表是全密文下行的大响应（500 行 ≈ 380KB）。旧路径 = ORM 实例化 + 每行
# json.loads(blob) + 整包再 json.dumps，双重序列化占请求 CPU 近半。
# 优化：核心查询取元组（免 ORM 实例化）+ blob 列原文直接拼进响应
# （所有写路径都经 json.dumps 落库，列内恒为合法 JSON 对象文本）。

_ITEM_COLS = (VaultItem.id, VaultItem.blob, VaultItem.favorite, VaultItem.last_used_at,
              VaultItem.password_updated_at, VaultItem.deleted_at, VaultItem.created_at,
              VaultItem.updated_at)


def _blob_json(raw):
    """blob 原文即响应所需 JSON 文本；首尾非 {} 时回退解析（保持旧抛错语义）"""
    raw = raw or '{}'
    if raw[:1] == '{' and raw[-1:] == '}':
        return raw
    return json.dumps(json.loads(raw))


def _jts(value):
    """时间戳 → JSON 字符串字面量（null / "..."）"""
    return 'null' if value is None else json.dumps(_iso(value))


def _items_response(rows) -> Response:
    """items 列表响应直拼（字段序与 VaultItem.to_dict 一致，信封同 api_response）"""
    parts = [
        '{"id":%d,"blob":%s,"favorite":%s,"last_used_at":%s,"password_updated_at":%s,'
        '"deleted_at":%s,"created_at":%s,"updated_at":%s}' % (
            r[0], _blob_json(r[1]), 'true' if r[2] else 'false',
            _jts(r[3]), _jts(r[4]), _jts(r[5]), _jts(r[6]), _jts(r[7]))
        for r in rows
    ]
    body = ('{"success":true,"code":200,"message":"操作成功",'
            '"data":{"items":[%s],"total":%d}}' % (','.join(parts), len(parts)))
    return Response(body.encode('utf-8'), media_type='application/json')


# ─── 账号（加密材料）────────────────────────────────────

@router.get('/account')
async def get_account():
    """KDF 参数 + 被包裹的 VEK（客户端据此派生 KEK 解锁）；未初始化 404"""
    def _impl():
        account = db.session.query(VaultAccount).first()
        if not account:
            return api_response(None, 404, 'Vault 未初始化')
        return api_response(account.to_dict())
    return await run_db(_retry_locked(_impl))


@router.post('/account')
async def init_account(request: Request):
    """初始化 Vault（单账号，仅一次）"""
    data = await _json_body(request)

    def _impl():
        if db.session.query(VaultAccount).count() > 0:
            return api_response(None, 409, 'Vault 已初始化')
        try:
            params = data['kdf_params'] if isinstance(data['kdf_params'], dict) else json.loads(data['kdf_params'])
        except (KeyError, TypeError, ValueError):
            return api_response(None, 400, 'kdf_params 必须是对象')
        if not (isinstance(params.get('t'), int) and isinstance(params.get('m'), int)
                and isinstance(params.get('p'), int) and params['t'] >= 1 and params['m'] >= 8192
                and params['p'] >= 1):
            return api_response(None, 400, 'kdf_params 非法（需 t>=1, m>=8192, p>=1）')
        if data.get('kdf_algo') != 'argon2id':
            return api_response(None, 400, 'kdf_algo 仅支持 argon2id')
        for field in ('kdf_salt', 'recovery_salt'):
            v = data.get(field)
            if not isinstance(v, str) or not (16 <= len(v) <= 64):
                return api_response(None, 400, f'{field} 非法')
        for field in ('wrapped_vault_key', 'recovery_wrapped_vault_key'):
            if not _valid_box(data.get(field)):
                return api_response(None, 400, f'{field} 必须是 {{n, ct}} 密文结构')

        account = VaultAccount(
            kdf_algo='argon2id',
            kdf_params=json.dumps(params),
            kdf_salt=data['kdf_salt'],
            recovery_salt=data['recovery_salt'],
            wrapped_vault_key=json.dumps(data['wrapped_vault_key']),
            recovery_wrapped_vault_key=json.dumps(data['recovery_wrapped_vault_key']),
        )
        db.session.add(account)
        _audit('vault_initialized')
        db.session.commit()
        return api_response(account.to_dict(), 201, '创建成功')
    return await run_db(_retry_locked(_impl))


@router.put('/account/keys')
async def rotate_keys(request: Request):
    """主密码修改 / Recovery Key 轮换：仅替换包裹材料与（可选）新盐/参数"""
    data = await _json_body(request)

    def _impl():
        account = db.session.query(VaultAccount).first()
        if not account:
            return api_response(None, 404, 'Vault 未初始化')

        if 'wrapped_vault_key' in data:
            if not _valid_box(data['wrapped_vault_key']):
                return api_response(None, 400, 'wrapped_vault_key 必须是 {n, ct} 密文结构')
            account.wrapped_vault_key = json.dumps(data['wrapped_vault_key'])
            if data.get('kdf_salt'):
                if not isinstance(data['kdf_salt'], str) or not (16 <= len(data['kdf_salt']) <= 64):
                    return api_response(None, 400, 'kdf_salt 非法')
                account.kdf_salt = data['kdf_salt']
            if data.get('kdf_params'):
                try:
                    params = data['kdf_params'] if isinstance(data['kdf_params'], dict) else json.loads(data['kdf_params'])
                except (TypeError, ValueError):
                    return api_response(None, 400, 'kdf_params 非法')
                if not (isinstance(params.get('t'), int) and isinstance(params.get('m'), int) and isinstance(params.get('p'), int)):
                    return api_response(None, 400, 'kdf_params 非法')
                account.kdf_params = json.dumps(params)

        if 'recovery_wrapped_vault_key' in data:
            if not _valid_box(data['recovery_wrapped_vault_key']):
                return api_response(None, 400, 'recovery_wrapped_vault_key 必须是 {n, ct} 密文结构')
            account.recovery_wrapped_vault_key = json.dumps(data['recovery_wrapped_vault_key'])
            if data.get('recovery_salt'):
                if not isinstance(data['recovery_salt'], str) or not (16 <= len(data['recovery_salt']) <= 64):
                    return api_response(None, 400, 'recovery_salt 非法')
                account.recovery_salt = data['recovery_salt']

        _audit('vault_keys_rotated')
        db.session.commit()
        return api_response(account.to_dict())
    return await run_db(_retry_locked(_impl))


# ─── 条目 ────────────────────────────────────────────────

@router.get('/items')
async def list_items(request: Request):
    """全部条目（密文）？trash=1 仅回收站；不含任何服务端搜索——搜索在客户端解密后进行"""
    trash = request.query_params.get('trash', '0') == '1'

    def _impl():
        rows = db.session.execute(
            select(*_ITEM_COLS)
            .where(VaultItem.deleted_at.isnot(None) if trash else VaultItem.deleted_at.is_(None))
            .order_by(VaultItem.updated_at.desc())
        ).all()
        return _items_response(rows)
    return await run_db(_retry_locked(_impl))


@router.post('/items')
async def create_item(request: Request):
    data = await _json_body(request)

    def _impl():
        if not _valid_box(data.get('blob')):
            return api_response(None, 400, 'blob 必须是 {n, ct} 密文结构')
        item = VaultItem(
            blob=json.dumps(data['blob']),
            favorite=bool(data.get('favorite')),
            password_updated_at=_iso_or_none(data.get('password_updated_at')),
        )
        db.session.add(item)
        db.session.flush()
        _audit('created', item.id)
        db.session.commit()
        return api_response(item.to_dict(), 201, '创建成功')
    return await run_db(_retry_locked(_impl))


@router.put('/items/{item_id}')
async def update_item(item_id: int, request: Request):
    data = await _json_body(request)

    def _impl():
        item = db.session.query(VaultItem).filter(VaultItem.id == item_id).first()
        if not item:
            return api_response(None, 404, '条目不存在')
        if not _valid_box(data.get('blob')):
            return api_response(None, 400, 'blob 必须是 {n, ct} 密文结构')
        old_pw_at = item.password_updated_at
        item.blob = json.dumps(data['blob'])
        if 'favorite' in data:
            item.favorite = bool(data.get('favorite'))
        if 'password_updated_at' in data:
            item.password_updated_at = _iso_or_none(data.get('password_updated_at'))
        _audit('updated', item.id)
        if item.password_updated_at and old_pw_at and item.password_updated_at != old_pw_at:
            _audit('password_changed', item.id)   # 只记行为，不记任何旧/新密码
        db.session.commit()
        return api_response(item.to_dict())
    return await run_db(_retry_locked(_impl))


@router.delete('/items/{item_id}')
async def trash_item(item_id: int):
    """移入回收站（软删，密文保持加密状态）"""
    def _impl():
        item = db.session.query(VaultItem).filter(VaultItem.id == item_id).first()
        if not item:
            return api_response(None, 404, '条目不存在')
        if item.deleted_at is None:
            item.deleted_at = datetime.now(timezone.utc)
            _audit('trashed', item.id)
            db.session.commit()
        return api_response(item.to_dict())
    return await run_db(_retry_locked(_impl))


@router.post('/items/{item_id}/restore')
async def restore_item(item_id: int):
    def _impl():
        item = db.session.query(VaultItem).filter(VaultItem.id == item_id).first()
        if not item:
            return api_response(None, 404, '条目不存在')
        item.deleted_at = None
        _audit('restored', item.id)
        db.session.commit()
        return api_response(item.to_dict())
    return await run_db(_retry_locked(_impl))


@router.delete('/items/{item_id}/purge')
async def purge_item(item_id: int):
    """永久删除（不可恢复）"""
    def _impl():
        item = db.session.query(VaultItem).filter(VaultItem.id == item_id).first()
        if not item:
            return api_response(None, 404, '条目不存在')
        db.session.query(VaultAttachment).filter(VaultAttachment.item_id == item_id).delete(synchronize_session=False)
        db.session.delete(item)
        _audit('purged', item_id)
        db.session.commit()
        return api_response({'id': item_id, 'attachments_purged': True})
    return await run_db(_retry_locked(_impl))


@router.post('/items/{item_id}/use')
async def mark_used(item_id: int):
    """记录最近使用：仅条目 ID + 时间戳，无任何敏感内容"""
    def _impl():
        item = db.session.query(VaultItem).filter(VaultItem.id == item_id).first()
        if not item:
            return api_response(None, 404, '条目不存在')
        item.last_used_at = datetime.now(timezone.utc)
        _audit('used', item.id)
        db.session.commit()
        return api_response(item.to_dict())
    return await run_db(_retry_locked(_impl))


# ─── 安全附件（零知识：前端 VEK 加密，服务端只存密文）────

ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024          # 明文 5MB
ATTACHMENT_MAX_CIPHER_CHARS = 8 * 1024 * 1024   # 密文 base64 上限（5MB→~6.7MB + JSON 余量）


def _live_item(item_id):
    item = db.session.query(VaultItem).filter(VaultItem.id == item_id).first()
    if not item:
        return None, api_response(None, 404, '条目不存在')
    if item.deleted_at is not None:
        return None, api_response(None, 400, '条目已在回收站，不能管理附件')
    return item, None


@router.get('/items/{item_id}/attachments')
async def list_attachments(item_id: int):
    def _impl():
        item, err = _live_item(item_id)
        if err:
            return err
        rows = (db.session.query(VaultAttachment)
                .filter(VaultAttachment.item_id == item_id)
                .order_by(VaultAttachment.created_at.asc()).all())
        return api_response([a.to_dict() for a in rows])
    return await run_db(_retry_locked(_impl))


@router.post('/items/{item_id}/attachments')
async def add_attachment(item_id: int, request: Request):
    data = await _json_body(request)

    def _impl():
        item, err = _live_item(item_id)
        if err:
            return err
        box = data.get('blob')
        # 附件盒校验：结构同 _valid_box 但 ct 上限放宽（大文件密文先给 413 而非 400）
        if not (isinstance(box, dict)
                and isinstance(box.get('n'), str) and 16 <= len(box['n']) <= _B64_LEN[1]
                and isinstance(box.get('ct'), str) and 8 <= len(box['ct'])):
            return api_response(None, 400, 'blob 需为 {n, ct} 密文结构')
        if len(box['ct']) > ATTACHMENT_MAX_CIPHER_CHARS:
            return api_response(None, 413, f'附件密文超过上限（明文约 {ATTACHMENT_MAX_BYTES // 1024 // 1024}MB）')
        try:
            size = int(data.get('size', 0))
        except (TypeError, ValueError):
            return api_response(None, 400, 'size 需为整数')
        if size < 0 or size > ATTACHMENT_MAX_BYTES:
            return api_response(None, 413, f'附件明文需在 0–{ATTACHMENT_MAX_BYTES // 1024 // 1024}MB 之间')
        a = VaultAttachment(item_id=item_id, blob=json.dumps(box, ensure_ascii=False), size=size)
        db.session.add(a)
        _audit('attachment_added', item_id)
        db.session.commit()
        return api_response(a.to_dict(), 201)
    return await run_db(_retry_locked(_impl))


@router.get('/attachments/{aid}')
async def get_attachment(aid: int):
    def _impl():
        a = db.session.get(VaultAttachment, aid)
        if not a:
            return api_response(None, 404, '附件不存在')
        return api_response(a.to_dict())
    return await run_db(_retry_locked(_impl))


@router.delete('/attachments/{aid}')
async def delete_attachment(aid: int):
    def _impl():
        a = db.session.get(VaultAttachment, aid)
        if not a:
            return api_response(None, 404, '附件不存在')
        db.session.delete(a)
        _audit('attachment_removed', a.item_id)
        db.session.commit()
        return api_response({'id': aid})
    return await run_db(_retry_locked(_impl))


# ─── 审计 / 备份 ─────────────────────────────────────────

@router.get('/audit')
async def list_audit(request: Request):
    page = _query_int(request, 'page', 1)
    page_size = min(_query_int(request, 'page_size', 50), 200)

    def _impl():
        # count 单独走索引计数（旧 Query.count() 把带 ORDER BY 的整条查询包成子查询）
        total = db.session.query(func.count(VaultAuditLog.id)).scalar()
        items = (db.session.query(VaultAuditLog)
                 .order_by(VaultAuditLog.created_at.desc())
                 .offset((page - 1) * page_size).limit(page_size).all())
        return api_response({'items': [i.to_dict() for i in items], 'total': total, 'page': page})
    return await run_db(_retry_locked(_impl))


@router.get('/export')
async def export_vault():
    """加密备份：账号包裹材料 + 全部条目密文（客户端可直接落盘，恢复需主密码/恢复密钥）"""
    def _impl():
        account = db.session.query(VaultAccount).first()
        if not account:
            return api_response(None, 404, 'Vault 未初始化')
        rows = db.session.execute(select(*_ITEM_COLS)).all()   # 含回收站
        items = [{'id': r[0], 'blob': json.loads(r[1] or '{}'), 'favorite': bool(r[2]),
                  'last_used_at': _iso(r[3]), 'password_updated_at': _iso(r[4]),
                  'deleted_at': _iso(r[5]), 'created_at': _iso(r[6]), 'updated_at': _iso(r[7])}
                 for r in rows]
        _audit('exported')
        db.session.commit()
        return api_response({
            'format': 'doublog-vault-backup',
            'version': 1,
            'exported_at': datetime.now(timezone.utc).isoformat(),
            'account': account.to_dict(),
            'items': items,
        })
    return await run_db(_retry_locked(_impl))


@router.post('/import')
async def import_vault(request: Request):
    """导入备份（替换式）：以备份的账号材料与本库条目整体覆盖当前库"""
    data = await _json_body(request)

    def _impl():
        # 双接受：'doublog-vault-backdown' 是历史导出笔误串，保留兼容老备份文件
        if data.get('format') != 'doublog-vault-backdown' and data.get('format') != 'doublog-vault-backup':
            return api_response(None, 400, '不是有效的 DouBlog Vault 备份文件')
        backup_account = data.get('account') or {}
        backup_items = data.get('items')
        if not isinstance(backup_items, list):
            return api_response(None, 400, '备份缺少 items')
        try:
            params = backup_account['kdf_params']
            if isinstance(params, str):
                params = json.loads(params)
        except (KeyError, TypeError, ValueError):
            return api_response(None, 400, '备份账号材料不完整')
        for field in ('kdf_salt', 'recovery_salt'):
            if not isinstance(backup_account.get(field), str):
                return api_response(None, 400, '备份账号材料不完整')
        for field in ('wrapped_vault_key', 'recovery_wrapped_vault_key'):
            if not _valid_box(backup_account.get(field)):
                return api_response(None, 400, '备份账号材料不完整')

        account = db.session.query(VaultAccount).first()
        if not account:
            account = VaultAccount()
            db.session.add(account)
        account.kdf_algo = 'argon2id'
        account.kdf_params = json.dumps(params)
        account.kdf_salt = backup_account['kdf_salt']
        account.recovery_salt = backup_account['recovery_salt']
        account.wrapped_vault_key = json.dumps(backup_account['wrapped_vault_key'])
        account.recovery_wrapped_vault_key = json.dumps(backup_account['recovery_wrapped_vault_key'])

        VaultItem.query.delete()
        for raw in backup_items:
            if not isinstance(raw, dict) or not _valid_box(raw.get('blob')):
                return api_response(None, 400, '备份条目密文结构非法')
            db.session.add(VaultItem(
                blob=json.dumps(raw['blob']),
                favorite=bool(raw.get('favorite')),
                last_used_at=_iso_or_none(raw.get('last_used_at')),
                password_updated_at=_iso_or_none(raw.get('password_updated_at')),
                deleted_at=_iso_or_none(raw.get('deleted_at')),
            ))
        _audit('imported')
        db.session.commit()
        return api_response({'imported_items': len(backup_items)})
    return await run_db(_retry_locked(_impl))
