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
import orjson
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy import delete, func, insert, select, text
from sqlalchemy.exc import OperationalError

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.response import api_response
from app.shared.timestamps import _iso
from app.vault.models import VaultAccount, VaultItem, VaultAttachment, VaultAuditLog

router = APIRouter(prefix='/api/vault', dependencies=[Depends(require_basic)], tags=['vault'])

# blob / 包裹材料的结构约束：仅接受 {n: base64(12B), ct: base64} 形态
# （12B nonce → base64 恰 16 字符；上限给手动构造留余量）
_BOX_N_MAX = 64
_BOX_CT_MAX = 200_000


def _valid_box(box, ct_max=_BOX_CT_MAX):
    """密文盒结构校验；附件传 ct_max=None（无上限，超大密文由 413 限额单独拦截）"""
    return (isinstance(box, dict)
            and isinstance(box.get('n'), str) and 16 <= len(box['n']) <= _BOX_N_MAX
            and isinstance(box.get('ct'), str) and len(box['ct']) >= 8
            and (ct_max is None or len(box['ct']) <= ct_max))


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
    return data if isinstance(data, dict) else {}


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
    parts = ['{"success":true,"code":200,"message":"操作成功","data":{"items":[']
    total = 0
    for r in rows:
        if total:
            parts.append(',')
        parts.append('{"id":%d,"blob":%s,"favorite":%s,"last_used_at":%s,"password_updated_at":%s,'
                     '"deleted_at":%s,"created_at":%s,"updated_at":%s}' % (
            r[0], _blob_json(r[1]), 'true' if r[2] else 'false',
            _jts(r[3]), _jts(r[4]), _jts(r[5]), _jts(r[6]), _jts(r[7])))
        total += 1
    # 信封与条目一次拼接，免去先拼全部条目再包裹信封的整段字符串拷贝。
    parts.append('],"total":%d}}' % total)
    return Response(''.join(parts).encode('utf-8'), media_type='application/json')


# ─── 账号（加密材料）────────────────────────────────────

def _empty_library(session):
    items = select(VaultItem.id).exists()
    attachments = select(VaultAttachment.id).exists()
    groups = select(VaultAccount.id).where(VaultAccount.group_catalog.is_not(None)).exists()
    return not session.scalar(select(items | attachments | groups))


@router.get('/account')
async def get_account():
    """KDF 参数 + 被包裹的 VEK（客户端据此派生 KEK 解锁）；未初始化 404"""
    def _impl():
        account = db.session.query(VaultAccount).first()
        if not account:
            return api_response(None, 404, 'Vault 未初始化')
        return api_response({**account.to_dict(), 'can_reinitialize_empty': _empty_library(db.session)})
    return await run_db(_retry_locked(_impl))


def initialize_account(session, data):
    """Create keys, or replace both wrappers only for the exact, still empty library."""
    _lock_bulk_write(session)
    accounts = session.scalars(select(VaultAccount).limit(2)).all()
    previous = accounts[0] if accounts else None
    replacing = 'replace_empty' in data
    if not replacing and previous:
        return api_response(None, 409, 'Vault 已初始化')
    if replacing:
        expected = data['replace_empty']
        if not isinstance(expected, dict) or set(expected) != {'kdf_salt', 'recovery_salt'}:
            return api_response(None, 400, '需要原空库的两项密钥标识')
        if (len(accounts) != 1 or previous.kdf_salt != expected['kdf_salt']
                or previous.recovery_salt != expected['recovery_salt']):
            return api_response(None, 409, '密码库已变化，请刷新后重试')
        if not _empty_library(session):
            return api_response(None, 409, '库中已有账号、最近删除、附件或分组，无法重新设置空库')
        if data.get('kdf_salt') == previous.kdf_salt or data.get('recovery_salt') == previous.recovery_salt:
            return api_response(None, 400, '重新设置需要全新的加密材料')

    try:
        params = data['kdf_params'] if isinstance(data['kdf_params'], dict) else json.loads(data['kdf_params'])
    except (KeyError, TypeError, ValueError):
        return api_response(None, 400, 'kdf_params 必须是对象')
    if not isinstance(params, dict) or any(type(params.get(k)) is not int or params[k] < minimum
                                           for k, minimum in (('t', 1), ('m', 8192), ('p', 1))):
        return api_response(None, 400, 'kdf_params 非法（需 t>=1, m>=8192, p>=1）')
    if data.get('kdf_algo') != 'argon2id':
        return api_response(None, 400, 'kdf_algo 仅支持 argon2id')
    for field in ('kdf_salt', 'recovery_salt'):
        val = data.get(field)
        if not isinstance(val, str) or not 16 <= len(val) <= 64:
            return api_response(None, 400, f'{field} 非法')
    for field in ('wrapped_vault_key', 'recovery_wrapped_vault_key'):
        if not _valid_box(data.get(field)):
            return api_response(None, 400, f'{field} 必须是 {{n, ct}} 密文结构')

    account = previous if previous is not None else VaultAccount()
    account.kdf_algo = 'argon2id'
    account.kdf_params = json.dumps({k: params[k] for k in ('t', 'm', 'p')})
    account.kdf_salt = data['kdf_salt']
    account.recovery_salt = data['recovery_salt']
    for field in ('wrapped_vault_key', 'recovery_wrapped_vault_key'):
        setattr(account, field, json.dumps({k: data[field][k] for k in ('n', 'ct')}))
    session.add(account)
    session.add(VaultAuditLog(action='empty_vault_reinitialized' if replacing else 'vault_initialized'))
    session.commit()
    return api_response(account.to_dict(), 200 if replacing else 201, '空密码库已重新设置' if replacing else '创建成功')


@router.post('/account')
async def init_account(request: Request):
    data = await _json_body(request)
    return await run_db(_retry_locked(lambda: initialize_account(db.session, data)))


def _valid_group_box(box):
    return box is None or (_valid_box(box) and set(box) == {'n', 'ct'})


@router.put('/account/groups')
async def update_groups(request: Request):
    data = await _json_body(request)
    if set(data) != {'blob', 'expected_key', 'expected_nonce'} or not _valid_group_box(data['blob']):
        return api_response(None, 400, '需要分组目录密文和原版本标识')
    expected, box = data['expected_nonce'], data['blob']
    if not isinstance(data['expected_key'], str) or (expected is not None and not isinstance(expected, str)):
        return api_response(None, 400, '分组版本标识无效')

    def _impl():
        _lock_bulk_write()
        account = db.session.query(VaultAccount).first()
        if not account:
            return api_response(None, 404, 'Vault 未初始化')
        if account.kdf_salt != data['expected_key']:
            return api_response(None, 409, '密码库密钥已变化，请重新解锁')
        current = orjson.loads(account.group_catalog) if account.group_catalog else None
        if current != box:
            current_nonce = current['n'] if current else None
            if current_nonce != expected:
                return api_response(None, 409, '分组已在其他窗口更新，请核对后再保存')
            if box and box['n'] == current_nonce:
                return api_response(None, 400, '分组密文需要新的随机数')
            account.group_catalog = orjson.dumps(box).decode() if box else None
            _audit('groups_updated')
            db.session.commit()
        return api_response({'group_catalog': box})
    return await run_db(_retry_locked(_impl))


@router.put('/account/keys')
async def rotate_keys(request: Request):
    """主密码修改 / Recovery Key 轮换：仅替换包裹材料与（可选）新盐/参数"""
    data = await _json_body(request)

    def _impl():
        _lock_bulk_write()
        account = db.session.query(VaultAccount).first()
        if not account:
            return api_response(None, 404, 'Vault 未初始化')
        if (('expected_key' in data and data['expected_key'] != account.kdf_salt)
                or ('expected_recovery' in data and data['expected_recovery'] != account.recovery_salt)):
            return api_response(None, 409, '密钥已变化，请重新解锁后再试')

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


def _lock_item_write():
    if db.engine.dialect.name == 'sqlite':
        db.session.execute(text('BEGIN IMMEDIATE'))
    else:
        db.session.execute(text('LOCK TABLE vault_accounts IN ROW EXCLUSIVE MODE'))


def _check_item_context(data, *, creating=False):
    if 'expected_key' in data or 'expected_group_nonce' in data:
        query = select(VaultAccount.kdf_salt)
        if 'expected_group_nonce' in data:
            query = query.add_columns(VaultAccount.group_catalog)
        row = db.session.execute(query.limit(1)).first()
        if not row or data.get('expected_key') != row.kdf_salt:
            return api_response(None, 409, '密码库密钥已变化，请重新解锁')
        if 'expected_group_nonce' in data:
            nonce = orjson.loads(row.group_catalog)['n'] if row.group_catalog else None
            if data['expected_group_nonce'] != nonce:
                return api_response(None, 409, '分组已在其他窗口更新，请重新选择分组')
    elif creating and db.session.scalar(select(select(VaultAuditLog.id).where(
                VaultAuditLog.action == 'empty_vault_reinitialized').exists())):
        return api_response(None, 409, '空库已重新设置，请刷新后使用当前密钥保存')
    return None


@router.post('/items')
async def create_item(request: Request):
    data = await _json_body(request)

    def _impl():
        if not _valid_box(data.get('blob')):
            return api_response(None, 400, 'blob 必须是 {n, ct} 密文结构')
        _lock_item_write()
        error = _check_item_context(data, creating=True)
        if error is not None:
            return error
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
        guarded = any(key in data for key in ('expected_key', 'expected_item_nonce', 'expected_group_nonce'))
        query = db.session.query(VaultItem).filter(VaultItem.id == item_id)
        if guarded:
            _lock_item_write()
            error = _check_item_context(data)
            if error is not None:
                return error
            query = query.with_for_update()
        item = query.first()
        if not item:
            return api_response(None, 404, '条目不存在')
        if guarded and (item.deleted_at or ('expected_item_nonce' in data and
                        data['expected_item_nonce'] != orjson.loads(item.blob)['n'])):
            return api_response(None, 409, '账号已在其他窗口修改，请重新打开后再编辑')
        fields = data.keys() - {'expected_key', 'expected_group_nonce', 'expected_item_nonce'}
        favorite_only = fields == {'favorite'} and type(data['favorite']) is bool
        if not favorite_only and not _valid_box(data.get('blob')):
            return api_response(None, 400, 'blob 必须是 {n, ct} 密文结构')
        old_pw_at = item.password_updated_at
        if not favorite_only:
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

ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024
_LEGACY_ATTACHMENT_CIPHER_LIMIT = 8 * 1024 * 1024


def _attachment_cipher_limit(size):
    # The browser encrypts JSON containing Base64 file data, then Base64-encodes the
    # ciphertext. Reserve 4 KiB for JSON/filename/MIME and 16 bytes for the GCM tag.
    file_chars = 4 * ((size + 2) // 3)
    encrypted_bytes = file_chars + 4096 + 16
    return max(_LEGACY_ATTACHMENT_CIPHER_LIMIT, 4 * ((encrypted_bytes + 2) // 3))


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
        # 附件盒校验：结构同 _valid_box 但 ct 无上限（大文件密文先给 413 而非 400）
        if not _valid_box(box, ct_max=None):
            return api_response(None, 400, 'blob 需为 {n, ct} 密文结构')
        try:
            size = int(data.get('size', 0))
        except (TypeError, ValueError):
            return api_response(None, 400, 'size 需为整数')
        if size < 0 or size > ATTACHMENT_MAX_BYTES:
            return api_response(None, 413, f'附件明文需在 0–{ATTACHMENT_MAX_BYTES // 1024 // 1024}MB 之间')
        if len(box['ct']) > _attachment_cipher_limit(size):
            return api_response(None, 413, f'附件密文超过上限（明文约 {ATTACHMENT_MAX_BYTES // 1024 // 1024}MB）')
        a = VaultAttachment(item_id=item_id, blob=orjson.dumps(box).decode(), size=size)
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


def _lock_bulk_write(session=None):
    """Fence competing item/attachment writes for a whole-library change, including empty libraries."""
    session = db.session if session is None else session
    if session.get_bind().dialect.name == 'sqlite':
        session.execute(text('BEGIN IMMEDIATE'))
    else:
        session.execute(text('LOCK TABLE vault_accounts, vault_items, vault_attachments IN SHARE ROW EXCLUSIVE MODE'))


def _valid_snapshot(rows):
    return isinstance(rows, list) and all(
        isinstance(row, list) and len(row) == 2 and type(row[0]) is int and isinstance(row[1], str)
        for row in rows
    )


@router.post('/items/append')
async def append_items(request: Request):
    """Append one browser import atomically. Compare the encrypted snapshot used for local deduplication."""
    data = await _json_body(request)

    def _impl():
        if not isinstance(data, dict) or not _valid_snapshot(data.get('expected_items')):
            return api_response(None, 400, '缺少预览时的账号快照')
        boxes = data.get('items')
        if not isinstance(boxes, list) or not boxes or any(not _valid_box(b) or set(b) != {'n', 'ct'} for b in boxes):
            return api_response(None, 400, '导入内容必须为加密条目')
        _lock_bulk_write()
        account = db.session.query(VaultAccount).first()
        if not account or data.get('expected_key') != account.kdf_salt:
            return api_response(None, 409, '密码库密钥已变化，请重新解锁')
        current = db.session.execute(select(VaultItem.id, VaultItem.blob).where(VaultItem.deleted_at.is_(None))).all()
        actual = {item_id: orjson.loads(blob)['n'] for item_id, blob in current}
        expected = data['expected_items']
        if len(actual) != len(expected) or actual != dict(expected):
            return api_response(None, 409, '账号列表已变化，请重新预览后导入')
        now = datetime.now(timezone.utc)
        db.session.execute(insert(VaultItem), [
            {'blob': orjson.dumps(box).decode(), 'favorite': False, 'password_updated_at': now} for box in boxes
        ])
        _audit('accounts_appended')
        db.session.commit()
        return api_response({'imported_items': len(boxes)}, 201)
    return await run_db(_retry_locked(_impl))


@router.get('/export')
async def export_vault():
    """v2 加密快照包含回收站和附件；密钥、条目及附件来自同一数据库快照。"""
    def _impl():
        if db.engine.dialect.name == 'sqlite':
            db.session.execute(text('BEGIN IMMEDIATE'))
        else:
            db.session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'))
        account = db.session.query(VaultAccount).first()
        if not account:
            return api_response(None, 404, 'Vault 未初始化')
        rows = db.session.execute(select(*_ITEM_COLS)).all()
        items = [{'id': r[0], 'blob': orjson.loads(r[1] or '{}'), 'favorite': bool(r[2]),
                  'last_used_at': _iso(r[3]), 'password_updated_at': _iso(r[4]),
                  'deleted_at': _iso(r[5]), 'created_at': _iso(r[6]), 'updated_at': _iso(r[7])}
                 for r in rows]
        attachments = [a.to_dict() for a in db.session.scalars(select(VaultAttachment)).all()]
        materials = account.to_dict()
        _audit('exported')
        db.session.commit()
        return api_response({'format': 'doublog-vault-backup', 'version': 2,
                             'exported_at': datetime.now(timezone.utc).isoformat(),
                             'account': materials, 'items': items, 'attachments': attachments})
    return await run_db(_retry_locked(_impl))


def _prepare_backup(data):
    """Build and validate detached records before touching the current library."""
    if not isinstance(data, dict) or data.get('format') not in ('doublog-vault-backup', 'doublog-vault-backdown'):
        raise ValueError('不是有效的 DouBlog Vault 备份文件')
    version = data.get('version', 1)
    if type(version) is not int or version not in (1, 2):
        raise ValueError('不支持的备份版本')
    raw_account = data.get('account')
    if not isinstance(raw_account, dict) or raw_account.get('kdf_algo', 'argon2id') != 'argon2id':
        raise ValueError('备份账号材料不完整')
    params = raw_account.get('kdf_params')
    if isinstance(params, str):
        params = json.loads(params)
    if not isinstance(params, dict) or any(type(params.get(k)) is not int or params[k] < minimum
                                           for k, minimum in (('t', 1), ('m', 8192), ('p', 1))):
        raise ValueError('备份 KDF 参数非法')
    account = {'kdf_algo': 'argon2id', 'kdf_params': json.dumps(params)}
    for field in ('kdf_salt', 'recovery_salt'):
        val = raw_account.get(field)
        if not isinstance(val, str) or not 16 <= len(val) <= 64:
            raise ValueError('备份账号材料不完整')
        account[field] = val
    for field in ('wrapped_vault_key', 'recovery_wrapped_vault_key'):
        val = raw_account.get(field)
        if not _valid_box(val):
            raise ValueError('备份账号材料不完整')
        account[field] = orjson.dumps({'n': val['n'], 'ct': val['ct']}).decode()
    groups = raw_account.get('group_catalog')
    if not _valid_group_box(groups):
        raise ValueError('备份的分组目录密文结构非法')
    account['group_catalog'] = orjson.dumps(groups).decode() if groups else None

    if not isinstance(data.get('items'), list):
        raise ValueError('备份缺少条目列表')
    items, parents = [], {}
    for raw in data['items']:
        if not isinstance(raw, dict) or not _valid_box(raw.get('blob')):
            raise ValueError('备份条目密文结构非法')
        old_id = raw.get('id')
        if old_id is not None or version == 2:
            if type(old_id) is not int or old_id < 1 or old_id in parents:
                raise ValueError('备份条目编号无效或重复')
        box = raw['blob']
        dates = {}
        for field in ('created_at', 'updated_at', 'password_updated_at', 'last_used_at', 'deleted_at'):
            if raw.get(field) is not None:
                dates[field] = _iso_or_none(raw[field])
                if dates[field] is None:
                    raise ValueError('备份条目时间格式不正确')
        item = VaultItem(blob=orjson.dumps({'n': box['n'], 'ct': box['ct']}).decode(),
                         favorite=bool(raw.get('favorite')), **dates)
        items.append(item)
        if old_id is not None:
            parents[old_id] = item
    files = data.get('attachments', [] if version == 1 else None)
    if not isinstance(files, list):
        raise ValueError('备份缺少附件列表')
    attachments = []
    for raw in files:
        if not isinstance(raw, dict) or type(raw.get('item_id')) is not int or raw['item_id'] not in parents:
            raise ValueError('附件关联了不存在的条目')
        box, size = raw.get('blob'), raw.get('size')
        if (type(size) is not int or not 0 <= size <= ATTACHMENT_MAX_BYTES
                or not _valid_box(box, _attachment_cipher_limit(size))):
            raise ValueError('备份附件密文或大小非法')
        row = {'blob': orjson.dumps({'n': box['n'], 'ct': box['ct']}).decode(), 'size': size}
        if raw.get('created_at') is not None:
            row['created_at'] = _iso_or_none(raw['created_at'])
            if row['created_at'] is None:
                raise ValueError('备份附件时间格式不正确')
        attachments.append((parents[raw['item_id']], row))
    return account, items, attachments


@router.post('/import')
async def import_vault(request: Request):
    data = await _json_body(request)

    def _impl():
        try:
            materials, items, attachments = _prepare_backup(data)
        except ValueError as error:
            return api_response(None, 400, str(error))
        _lock_bulk_write()
        account = db.session.query(VaultAccount).first()
        if 'expected_key' in data and (account.kdf_salt if account else None) != data['expected_key']:
            return api_response(None, 409, '密码库已变化，请重新打开备份')
        if not account:
            account = VaultAccount()
            db.session.add(account)
        for key, value in materials.items():
            setattr(account, key, value)
        db.session.execute(delete(VaultAttachment))
        db.session.execute(delete(VaultItem))
        db.session.add_all(items)
        db.session.flush()
        if attachments:
            db.session.execute(insert(VaultAttachment), [dict(row, item_id=item.id) for item, row in attachments])
        _audit('imported')
        db.session.commit()
        return api_response({'imported_items': len(items), 'imported_attachments': len(attachments)})
    return await run_db(_retry_locked(_impl))
