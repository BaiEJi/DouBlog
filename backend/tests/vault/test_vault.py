"""
Vault（零知识密码库）后端测试：
- 账号初始化/读取/密钥轮换
- 条目 CRUD / 回收站 / 最近使用
- 审计日志只含行为（无任何明文）
- 导出/导入往返
- 安全性质：数据库与 API 响应中不存在明文敏感字段（API 契约层面不接受明文）
"""
import json

BOX = {'n': 'AAAAAAAAAAAAAAAA', 'ct': 'c2VjcmV0LWNpcGhlcnRleHQ='}  # 假密文结构
ACCOUNT = {
    'kdf_algo': 'argon2id',
    'kdf_params': {'t': 2, 'm': 32768, 'p': 1},
    'kdf_salt': 'c2FsdDEyMzQ1Njc4OTA=' * 2,
    'recovery_salt': 'cnNhbHQxMjM0NTY3ODkw' * 2,
    'wrapped_vault_key': BOX,
    'recovery_wrapped_vault_key': BOX,
}


def _init_account(client, auth_headers):
    r = client.post('/api/vault/account', json=ACCOUNT, headers=auth_headers)
    assert r.status_code == 201
    return r.json()['data']


def _create_item(client, auth_headers, blob=None):
    r = client.post('/api/vault/items', json={'blob': blob or BOX, 'favorite': False}, headers=auth_headers)
    assert r.status_code == 201, r.json()
    return r.json()['data']


# ─── 账号 ────────────────────────────────────────────────

def test_account_init_and_get(client, auth_headers):
    _init_account(client, auth_headers)
    d = client.get('/api/vault/account', headers=auth_headers).json()['data']
    assert d['kdf_algo'] == 'argon2id'
    assert d['kdf_params'] == {'t': 2, 'm': 32768, 'p': 1}
    assert 'wrapped_vault_key' in d and 'n' in d['wrapped_vault_key']
    # 响应中没有也不应有任何明文口令字段
    assert 'master_password' not in json.dumps(d).lower()


def test_account_init_twice_rejected(client, auth_headers):
    _init_account(client, auth_headers)
    r = client.post('/api/vault/account', json=ACCOUNT, headers=auth_headers)
    assert r.status_code == 409


def test_account_requires_auth(client):
    assert client.get('/api/vault/account').status_code == 401


def _check_groups(client, headers):
    url = '/api/vault/account/groups'
    key = ACCOUNT['kdf_salt']
    first = {'n': 'G' * 16, 'ct': 'encrypted-first-catalog'}
    second = {'n': 'H' * 16, 'ct': 'encrypted-second-catalog'}

    def put(box, nonce):
        return client.put(url, json={'blob': box, 'expected_key': key, 'expected_nonce': nonce}, headers=headers)

    assert put(first, None).status_code == 200
    assert put(first, None).status_code == 200  # Safe retry after a lost response.
    assert put(second, None).status_code == 409
    assert put(second, first['n']).status_code == 200
    assert put(None, first['n']).status_code == 409
    assert client.get('/api/vault/account', headers=headers).json()['data']['group_catalog'] == second
    backup = client.get('/api/vault/export', headers=headers).json()['data']
    assert backup['account']['group_catalog'] == second
    assert put(None, second['n']).status_code == 200
    assert client.post('/api/vault/import', headers=headers, json=backup).status_code == 200
    assert client.get('/api/vault/account', headers=headers).json()['data']['group_catalog'] == second
    del backup['account']['group_catalog']  # A backup made before groups existed.
    assert client.post('/api/vault/import', headers=headers, json=backup).status_code == 200
    assert 'group_catalog' not in client.get('/api/vault/account', headers=headers).json()['data']


def test_encrypted_groups_roundtrip_and_revision(client, auth_headers):
    _init_account(client, auth_headers)
    _check_groups(client, auth_headers)


def test_groups_protect_empty_reset_and_stale_account_changes(client, auth_headers):
    url = '/api/vault/account/groups'
    payload = {'blob': BOX, 'expected_key': ACCOUNT['kdf_salt'], 'expected_nonce': None}
    assert client.put(url, json=payload).status_code == 401
    assert client.put(url, headers=auth_headers, json=payload).status_code == 404
    _init_account(client, auth_headers)
    for changes in ({'name': 'private'}, {'blob': {'name': 'private'}}, {'blob': {**BOX, 'name': 'private'}}):
        assert client.put(url, headers=auth_headers, json={**payload, **changes}).status_code == 400
    assert client.put(url, headers=auth_headers, json={**payload, 'expected_key': 'stale'}).status_code == 409
    assert client.put(url, headers=auth_headers, json=payload).status_code == 200
    assert client.get('/api/vault/account', headers=auth_headers).json()['data']['can_reinitialize_empty'] is False
    assert client.post('/api/vault/account', headers=auth_headers, json=_empty_reset()).status_code == 409
    create = {'blob': BOX, 'expected_group_nonce': None, 'expected_key': ACCOUNT['kdf_salt']}
    assert client.post('/api/vault/items', headers=auth_headers, json=create).status_code == 409
    create['expected_group_nonce'] = BOX['n']
    item = client.post('/api/vault/items', headers=auth_headers, json=create).json()['data']
    path = f"/api/vault/items/{item['id']}"
    newer = {'n': 'T' * 16, 'ct': 'new-opaque-fixture'}
    edit = {**create, 'blob': newer, 'expected_item_nonce': BOX['n']}
    assert client.put(path, headers=auth_headers, json=edit).status_code == 200
    assert client.put(path, headers=auth_headers, json=edit).status_code == 409
    fav = client.put(path, headers=auth_headers, json={'favorite': True, 'expected_key': ACCOUNT['kdf_salt'],
                                                       'expected_item_nonce': newer['n']})
    assert fav.status_code == 200 and fav.json()['data']['blob'] == newer
    assert client.put(url, headers=auth_headers, json={**payload, 'blob': None, 'expected_nonce': BOX['n']}).status_code == 200
    assert client.put(path, headers=auth_headers, json={**edit, 'expected_item_nonce': newer['n']}).status_code == 409
    assert client.get('/api/vault/items', headers=auth_headers).json()['data']['items'][0]['blob'] == newer


def test_group_column_existing_sqlite_schema_migration():
    from sqlalchemy import create_engine, inspect, text
    from app.vault import ensure_migrations
    engine = create_engine('sqlite://')
    try:
        with engine.begin() as conn:
            conn.execute(text('CREATE TABLE vault_accounts (id INTEGER PRIMARY KEY)'))
            conn.execute(text('INSERT INTO vault_accounts VALUES (1)'))
            conn.execute(text('CREATE TABLE vault_items (deleted_at TEXT, updated_at TEXT)'))
            conn.execute(text('CREATE TABLE vault_audit_logs (created_at TEXT)'))
        ensure_migrations(engine)
        ensure_migrations(engine)
        assert 'group_catalog' in {c['name'] for c in inspect(engine).get_columns('vault_accounts')}
        with engine.connect() as conn:
            assert conn.execute(text('SELECT id, group_catalog FROM vault_accounts')).one() == (1, None)
    finally:
        engine.dispose()


def _empty_reset():
    return {**ACCOUNT, 'kdf_salt': 'S' * 24, 'recovery_salt': 'R' * 24,
            'replace_empty': {k: ACCOUNT[k] for k in ('kdf_salt', 'recovery_salt')}}


def test_empty_reset_checks_current_material_and_rejects_stale_writers(client, auth_headers):
    url = '/api/vault/account'
    payload = _empty_reset()
    assert client.post(url, json=payload).status_code == 401
    assert client.post(url, json=payload, headers=auth_headers).status_code == 409
    previous = _init_account(client, auth_headers)
    assert client.get(url, headers=auth_headers).json()['data']['can_reinitialize_empty'] is True
    for changes, code in [
        ({'replace_empty': {}}, 400), ({'kdf_params': '[]'}, 400),
        ({'recovery_wrapped_vault_key': {}}, 400), ({'kdf_salt': previous['kdf_salt']}, 400),
        ({'replace_empty': {**payload['replace_empty'], 'recovery_salt': 'stale'}}, 409),
    ]:
        assert client.post(url, headers=auth_headers, json={**payload, **changes}).status_code == code
    assert client.get(url, headers=auth_headers).json()['data']['kdf_salt'] == previous['kdf_salt']
    result = client.post(url, headers=auth_headers, json=payload)
    assert result.status_code == 200
    assert result.json()['data']['id'] == previous['id']
    assert client.post(url, headers=auth_headers, json=payload).status_code == 409
    for stale in ({'blob': BOX}, {'blob': BOX, 'expected_key': previous['kdf_salt']}):
        assert client.post('/api/vault/items', headers=auth_headers, json=stale).status_code == 409
    assert client.post('/api/vault/items', headers=auth_headers,
                       json={'blob': BOX, 'expected_key': payload['kdf_salt']}).status_code == 201
    events = client.get('/api/vault/audit', headers=auth_headers).json()['data']['items']
    assert [row['action'] for row in events].count('empty_vault_reinitialized') == 1


def test_empty_reset_protects_live_deleted_items_and_files(client, auth_headers):
    _init_account(client, auth_headers)
    item = _create_item(client, auth_headers)
    path = f"/api/vault/items/{item['id']}"
    assert client.post(path + '/attachments', headers=auth_headers, json={'blob': BOX, 'size': 8}).status_code == 201
    for in_trash in (False, True):
        if in_trash:
            assert client.delete(path, headers=auth_headers).status_code == 200
        before = client.get('/api/vault/export', headers=auth_headers).json()['data']
        assert client.get('/api/vault/account', headers=auth_headers).json()['data']['can_reinitialize_empty'] is False
        assert client.post('/api/vault/account', headers=auth_headers, json=_empty_reset()).status_code == 409
        after = client.get('/api/vault/export', headers=auth_headers).json()['data']
        assert all(after[key] == before[key] for key in ('account', 'items', 'attachments'))


def test_first_create_and_empty_reset_cannot_both_win(client, auth_headers, app):
    import asyncio
    import httpx

    _init_account(client, auth_headers)

    async def race():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as c:
            return await asyncio.gather(
                c.post('/api/vault/items', headers=auth_headers, json={'blob': BOX}),
                c.post('/api/vault/account', headers=auth_headers, json=_empty_reset()))

    writing, resetting = asyncio.run(race())
    assert (writing.status_code, resetting.status_code) in {(201, 409), (409, 200)}
    state = client.get('/api/vault/export', headers=auth_headers).json()['data']
    if resetting.status_code == 200:
        assert state['account']['kdf_salt'] == _empty_reset()['kdf_salt'] and not state['items']
    else:
        assert state['account']['kdf_salt'] == ACCOUNT['kdf_salt'] and len(state['items']) == 1


def test_rotate_keys(client, auth_headers):
    _init_account(client, auth_headers)
    new_box = {'n': 'BBBBBBBBBBBBBBBB', 'ct': 'bmV3LWNpcGhlcnRleHQ='}
    r = client.put('/api/vault/account/keys',
                   json={'wrapped_vault_key': new_box, 'kdf_salt': 'bmV3c2FsdDEyMzQ1Njc4OTA='},
                   headers=auth_headers)
    assert r.status_code == 200
    d = r.json()['data']
    assert d['wrapped_vault_key'] == new_box
    assert d['kdf_salt'] == 'bmV3c2FsdDEyMzQ1Njc4OTA='


# ─── 条目 ────────────────────────────────────────────────

def test_item_crud_and_trash(client, auth_headers):
    _init_account(client, auth_headers)
    item = _create_item(client, auth_headers)
    iid = item['id']
    assert item['blob'] == BOX

    # 更新
    box2 = {'n': 'CCCCCCCCCCCCCCCC', 'ct': 'dXBkYXRlZC1jaXBoZXJ0ZXh0'}
    r = client.put(f'/api/vault/items/{iid}', json={'blob': box2, 'favorite': True}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()['data']['favorite'] is True

    # 使用记录（仅 ID+时间）
    r = client.post(f'/api/vault/items/{iid}/use', headers=auth_headers)
    assert r.status_code == 200
    assert r.json()['data']['last_used_at'] is not None

    # 软删进回收站
    assert client.delete(f'/api/vault/items/{iid}', headers=auth_headers).status_code == 200
    live = client.get('/api/vault/items', headers=auth_headers).json()['data']
    trash = client.get('/api/vault/items?trash=1', headers=auth_headers).json()['data']
    assert live['total'] == 0 and trash['total'] == 1

    # 恢复
    assert client.post(f'/api/vault/items/{iid}/restore', headers=auth_headers).status_code == 200
    live = client.get('/api/vault/items', headers=auth_headers).json()['data']
    assert live['total'] == 1

    # 永久删除
    assert client.delete(f'/api/vault/items/{iid}/purge', headers=auth_headers).status_code == 200
    assert client.get('/api/vault/items?trash=1', headers=auth_headers).json()['data']['total'] == 0


def test_item_rejects_plaintext_shape(client, auth_headers):
    """API 契约层面不接受任何明文敏感字段（不存在 password 参数）"""
    _init_account(client, auth_headers)
    r = client.post('/api/vault/items', json={'blob': 'not-a-box'}, headers=auth_headers)
    assert r.status_code == 400
    r = client.post('/api/vault/items', json={'password': 'plaintext!!'}, headers=auth_headers)
    assert r.status_code == 400
    r = client.post('/api/vault/items', json={'blob': {'n': 'x'}}, headers=auth_headers)
    assert r.status_code == 400


def test_items_require_auth(client):
    assert client.get('/api/vault/items').status_code == 401


# ─── 审计：只含行为，绝不含明文 ──────────────────────────

def test_audit_log_content_safety(client, auth_headers):
    _init_account(client, auth_headers)
    item = _create_item(client, auth_headers)
    client.post(f"/api/vault/items/{item['id']}/use", headers=auth_headers)
    client.delete(f"/api/vault/items/{item['id']}", headers=auth_headers)

    d = client.get('/api/vault/audit', headers=auth_headers).json()['data']
    actions = [i['action'] for i in d['items']]
    assert 'created' in actions and 'used' in actions and 'trashed' in actions
    # 每条记录只有 action/item_id/时间——没有任何内容载荷
    for entry in d['items']:
        assert set(entry.keys()) == {'id', 'action', 'item_id', 'created_at'}


# ─── 导出 / 导入 ────────────────────────────────────────

def test_export_import_roundtrip(client, auth_headers, app):
    _init_account(client, auth_headers)
    _create_item(client, auth_headers)
    _create_item(client, auth_headers, blob={'n': 'DDDDDDDDDDDDDDDD', 'ct': 'c2Vjb25kLWJsb2I='})

    backup = client.get('/api/vault/export', headers=auth_headers).json()['data']
    assert backup['format'] == 'doublog-vault-backup'
    assert len(backup['items']) == 2
    assert backup['account']['kdf_params']['t'] == 2

    # 覆盖式导入：先清掉再导入
    from app.db import db as _db
    from app.vault.models import VaultItem
    VaultItem.query.delete()
    _db.session.commit()
    assert client.get('/api/vault/items', headers=auth_headers).json()['data']['total'] == 0

    r = client.post('/api/vault/import', json=backup, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()['data']['imported_items'] == 2
    restored = client.get('/api/vault/items', headers=auth_headers).json()['data']
    assert restored['total'] == 2

    # 非法格式
    assert client.post('/api/vault/import', json={'format': 'nope'}, headers=auth_headers).status_code == 400


# ─── 数据库零明文性质 ────────────────────────────────────

def test_database_stores_only_ciphertext(client, auth_headers, app):
    """直接检查数据库行：blob/包裹材料必须是密文结构，无明文口令字段"""
    _init_account(client, auth_headers)
    from app.vault.models import VaultItem, VaultAccount
    acc = VaultAccount.query.first()
    raw = acc.wrapped_vault_key
    parsed = json.loads(raw)
    assert set(parsed.keys()) == {'n', 'ct'}
    cols = {c.name for c in VaultItem.__table__.columns}
    assert not any(k in cols for k in ('password', 'secret', 'note', 'username', 'service'))
    acc_cols = {c.name for c in VaultAccount.__table__.columns}
    assert not any('plain' in c or 'password' in c for c in acc_cols)


# ─── 安全附件（零知识密文存储）──────────────────────────

def test_attachment_roundtrip_and_list(client, auth_headers):
    """上传密文 → 列表带回密文（前端解密文件名）→ 单取 → 删除"""
    _init_account(client, auth_headers)
    item = _create_item(client, auth_headers)
    box = {'n': 'AAAAAAAAAAAAAAAA', 'ct': 'c2VjcmV0LWZpbGUtY2lwaGVydGV4dA=='}
    r = client.post(f"/api/vault/items/{item['id']}/attachments",
                    json={'blob': box, 'size': 18}, headers=auth_headers)
    assert r.status_code == 201, r.json()
    a1 = r.json()['data']
    assert a1['item_id'] == item['id'] and a1['size'] == 18 and a1['blob']['ct'] == box['ct']

    r = client.get(f"/api/vault/items/{item['id']}/attachments", headers=auth_headers)
    listed = r.json()['data']
    assert len(listed) == 1 and listed[0]['blob'] == box

    r = client.get(f"/api/vault/attachments/{a1['id']}", headers=auth_headers)
    assert r.json()['data']['blob'] == box

    assert client.delete(f"/api/vault/attachments/{a1['id']}", headers=auth_headers).status_code == 200
    assert client.get(f"/api/vault/attachments/{a1['id']}", headers=auth_headers).status_code == 404
    assert client.get(f"/api/vault/items/{item['id']}/attachments", headers=auth_headers).json()['data'] == []


def test_attachment_limits_and_validation(client, auth_headers):
    """明文 5MB 上限 / 密文字符上限 / 非法 blob / 非法 size"""
    _init_account(client, auth_headers)
    item = _create_item(client, auth_headers)
    ok = {'n': 'AAAAAAAAAAAAAAAA', 'ct': 'c2VjcmV0'}
    assert client.post(f"/api/vault/items/{item['id']}/attachments",
                       json={'blob': {'bad': 1}, 'size': 1}, headers=auth_headers).status_code == 400
    assert client.post(f"/api/vault/items/{item['id']}/attachments",
                       json={'blob': ok, 'size': 'x'}, headers=auth_headers).status_code == 400
    assert client.post(f"/api/vault/items/{item['id']}/attachments",
                       json={'blob': ok, 'size': 6 * 1024 * 1024}, headers=auth_headers).status_code == 413
    big_ct = {'n': 'A' * 16, 'ct': 'A' * (8 * 1024 * 1024 + 1)}
    assert client.post(f"/api/vault/items/{item['id']}/attachments",
                       json={'blob': big_ct, 'size': 1024}, headers=auth_headers).status_code == 413
    # Production envelope: Base64 file bytes inside encrypted JSON, then outer Base64.
    size = 5 * 1024 * 1024
    inner = 4 * ((size + 2) // 3) + 100
    browser_box = {'n': BOX['n'], 'ct': 'A' * (4 * ((inner + 16 + 2) // 3))}
    url = f"/api/vault/items/{item['id']}/attachments"
    assert client.post(url, headers=auth_headers, json={'size': size, 'blob': browser_box}).status_code == 201
    oversized = {**browser_box, 'ct': browser_box['ct'] + 'A' * 16384}
    assert client.post(url, headers=auth_headers, json={'size': size, 'blob': oversized}).status_code == 413
    # 合法上限内
    assert client.post(f"/api/vault/items/{item['id']}/attachments",
                       json={'blob': ok, 'size': 5 * 1024 * 1024}, headers=auth_headers).status_code == 201


def test_attachment_lifecycle_with_item(client, auth_headers):
    """软删条目：附件不可管理但密文保留；purge：附件级联删除；404 条目拒绝"""
    _init_account(client, auth_headers)
    item = _create_item(client, auth_headers)
    box = {'n': 'AAAAAAAAAAAAAAAA', 'ct': 'c2VjcmV0'}
    client.post(f"/api/vault/items/{item['id']}/attachments", json={'blob': box, 'size': 7}, headers=auth_headers)

    # 软删后：列表 400、上传 400；单取附件仍可（恢复语义）
    client.delete(f"/api/vault/items/{item['id']}", headers=auth_headers)
    assert client.get(f"/api/vault/items/{item['id']}/attachments", headers=auth_headers).status_code == 400
    assert client.post(f"/api/vault/items/{item['id']}/attachments",
                       json={'blob': box, 'size': 1}, headers=auth_headers).status_code == 400
    # 恢复 → 附件回到可管理状态
    client.post(f"/api/vault/items/{item['id']}/restore", headers=auth_headers)
    assert len(client.get(f"/api/vault/items/{item['id']}/attachments", headers=auth_headers).json()['data']) == 1
    # purge → 附件级联删除
    client.delete(f"/api/vault/items/{item['id']}/purge", headers=auth_headers)
    assert client.get(f"/api/vault/items/{item['id']}/attachments", headers=auth_headers).status_code == 404
    # 不存在条目
    assert client.get('/api/vault/items/99999/attachments', headers=auth_headers).status_code == 404


def test_attachment_audit_logged(client, auth_headers, app):
    """附件增删写入审计（action + item_id，无内容）"""
    _init_account(client, auth_headers)
    item = _create_item(client, auth_headers)
    box = {'n': 'AAAAAAAAAAAAAAAA', 'ct': 'c2VjcmV0'}
    client.post(f"/api/vault/items/{item['id']}/attachments", json={'blob': box, 'size': 1}, headers=auth_headers)
    aid = client.get(f"/api/vault/items/{item['id']}/attachments", headers=auth_headers).json()['data'][0]['id']
    client.delete(f"/api/vault/attachments/{aid}", headers=auth_headers)
    r = client.get('/api/vault/audit', headers=auth_headers).json()['data']
    actions = {row['action'] for row in r['items'] if r.get('items')} if isinstance(r, dict) else set()
    from app.vault.models import VaultAuditLog
    acts = {a.action for a in VaultAuditLog.query.all()}
    assert 'attachment_added' in acts and 'attachment_removed' in acts


# ─── 性能路径回归：列表直拼响应与旧 to_dict 语义一致 ─────

def test_list_fast_path_matches_contract(client, auth_headers):
    """列表直拼响应：信封字段、条目字段集合与值、trash 过滤均与契约一致"""
    _init_account(client, auth_headers)
    item = _create_item(client, auth_headers)

    r = client.get('/api/vault/items', headers=auth_headers)
    assert r.status_code == 200
    assert r.headers['content-type'].startswith('application/json')
    d = r.json()
    assert set(d.keys()) == {'success', 'code', 'message', 'data'}
    assert d['success'] is True and d['code'] == 200
    assert set(d['data'].keys()) == {'items', 'total'} and d['data']['total'] == 1
    entry = d['data']['items'][0]
    assert set(entry.keys()) == {'id', 'blob', 'favorite', 'last_used_at',
                                 'password_updated_at', 'deleted_at', 'created_at',
                                 'updated_at'}
    assert entry['id'] == item['id'] and entry['blob'] == BOX
    assert entry['favorite'] is False and entry['deleted_at'] is None
    assert entry['created_at'] and entry['updated_at']

    # trash=1 过滤
    client.delete(f"/api/vault/items/{item['id']}", headers=auth_headers)
    assert client.get('/api/vault/items', headers=auth_headers).json()['data']['total'] == 0
    assert client.get('/api/vault/items?trash=1', headers=auth_headers).json()['data']['total'] == 1


def test_export_fast_path_roundtrip(client, auth_headers):
    """export 走核心查询路径后字段与导入往返不变"""
    _init_account(client, auth_headers)
    _create_item(client, auth_headers)
    backup = client.get('/api/vault/export', headers=auth_headers).json()['data']
    assert len(backup['items']) == 1
    entry = backup['items'][0]
    assert set(entry.keys()) == {'id', 'blob', 'favorite', 'last_used_at',
                                 'password_updated_at', 'deleted_at', 'created_at',
                                 'updated_at'}
    assert entry['blob'] == BOX


def test_perf_indexes_created(app):
    """性能索引存在（新建库 create_all + 存量库 ensure_migrations 同名）"""
    from sqlalchemy import inspect
    insp = inspect(app.state.engine)
    item_ix = {ix['name'] for ix in insp.get_indexes('vault_items')}
    audit_ix = {ix['name'] for ix in insp.get_indexes('vault_audit_logs')}
    assert 'ix_vault_items_trash_order' in item_ix
    assert 'ix_vault_audit_logs_created_at' in audit_ix


def test_retry_locked_recovers(client, monkeypatch):
    """写锁重试：锁类 OperationalError 重试成功；非锁类原样抛出"""
    from app.vault import routes
    monkeypatch.setattr(routes.time, 'sleep', lambda s: None)
    from sqlalchemy.exc import OperationalError

    calls = {'n': 0}

    def flaky():
        calls['n'] += 1
        if calls['n'] == 1:
            raise OperationalError('INSERT', {}, RuntimeError('database is locked'))
        return 'ok'

    assert routes._retry_locked(flaky)() == 'ok'
    assert calls['n'] == 2

    def other_db_error():
        raise OperationalError('SELECT', {}, RuntimeError('no such table: x'))

    try:
        routes._retry_locked(other_db_error)()
    except OperationalError:
        pass
    else:
        raise AssertionError('非锁类 OperationalError 应原样抛出')

def _check_backup_roundtrip(client, auth_headers):
    _init_account(client, auth_headers)
    first = _create_item(client, auth_headers)
    other = _create_item(client, auth_headers)
    file_box = {'n': 'F' * 16, 'ct': 'YXR0YWNobWVudA=='}
    for item, size in [(first, 8), (other, 19)]:
        assert client.post(f"/api/vault/items/{item['id']}/attachments", headers=auth_headers,
                           json={'blob': file_box, 'size': size}).status_code == 201
    client.delete(f"/api/vault/items/{other['id']}", headers=auth_headers)
    backup = client.get('/api/vault/export', headers=auth_headers).json()['data']
    assert backup['version'] == 2 and len(backup['attachments']) == 2
    # Remap IDs from a foreign library, and deliberately reverse its item order.
    for item in backup['items']:
        item['id'] += 500
    for att in backup['attachments']:
        att['item_id'] += 500
    backup['items'].reverse()
    res = client.post('/api/vault/import', json=backup, headers=auth_headers)
    assert res.status_code == 200 and res.json()['data'] == {'imported_items': 2, 'imported_attachments': 2}
    new = client.get('/api/vault/export', headers=auth_headers).json()['data']
    parents = {item['id']: item for item in new['items']}
    for att in new['attachments']:
        item = parents[att['item_id']]
        assert bool(item['deleted_at']) == (att['size'] == 19)
        original = next(x for x in backup['items'] if bool(x['deleted_at']) == bool(item['deleted_at']))
        assert item['created_at'] == original['created_at'] and item['updated_at'] == original['updated_at']
        assert att['blob'] == file_box
    archived = next(i for i in new['items'] if i['deleted_at'])
    assert client.post(f"/api/vault/items/{archived['id']}/restore", headers=auth_headers).status_code == 200
    assert client.get(f"/api/vault/items/{archived['id']}/attachments", headers=auth_headers).json()['data'][0]['size'] == 19


def test_backup_v2_keeps_files_with_their_account_and_dates(client, auth_headers):
    _check_backup_roundtrip(client, auth_headers)


def test_invalid_backup_is_atomic_and_v1_is_still_readable(client, auth_headers):
    _init_account(client, auth_headers)
    item = _create_item(client, auth_headers)
    client.post(f"/api/vault/items/{item['id']}/attachments", headers=auth_headers, json={'size': 10, 'blob': BOX})
    before = client.get('/api/vault/export', headers=auth_headers).json()['data']
    for changes in [
        {'items': [*before['items'], before['items'][0]]}, {'attachments': [{'item_id': 9999, 'blob': BOX, 'size': 10}]},
        {'attachments': [dict(before['attachments'][0], size=-1)]}, {'items': [{'id': 5, 'blob': {}}]},
        {'attachments': None}, {'version': 3}, {'account': dict(before['account'], kdf_params='[]')},
    ]:
        assert client.post('/api/vault/import', headers=auth_headers, json={**before, **changes}).status_code == 400
    assert client.post('/api/vault/import', headers=auth_headers, json={**before, 'expected_key': 'changed'}).status_code == 409
    actual = client.get('/api/vault/export', headers=auth_headers).json()['data']
    for key in ('account', 'items', 'attachments'):
        assert actual[key] == before[key]
    legacy = {key: before[key] for key in ('format', 'account', 'items')}
    legacy['version'] = 1
    res = client.post('/api/vault/import', headers=auth_headers, json=legacy)
    assert res.status_code == 200 and res.json()['data']['imported_attachments'] == 0
    from app.vault.models import VaultAttachment
    assert VaultAttachment.query.count() == 0


def test_append_is_atomic_and_stale_previews_cannot_add_duplicates(client, auth_headers, app):
    _init_account(client, auth_headers)
    item = _create_item(client, auth_headers)
    payload = {'items': [BOX, BOX], 'expected_key': ACCOUNT['kdf_salt'], 'expected_items': [[item['id'], BOX['n']]]}
    url = '/api/vault/items/append'
    assert client.post(url, headers=auth_headers, json={**payload, 'items': [BOX, {'password': 'fixture'}]}).status_code == 400
    assert client.post(url, headers=auth_headers, json={**payload, 'expected_key': 'stale'}).status_code == 409
    import asyncio
    import httpx

    async def race():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as c:
            results = await asyncio.gather(*(c.post(url, headers=auth_headers, json=payload) for _ in range(2)))
            return [r.status_code for r in results]

    responses = asyncio.run(race())
    assert sorted(responses) == [201, 409]
    assert client.post(url, headers=auth_headers, json=payload).status_code == 409
    assert client.get('/api/vault/items', headers=auth_headers).json()['data']['total'] == 3


def test_rewrap_detects_stale_material_and_pwsvc_is_independent(client, auth_headers):
    _init_account(client, auth_headers)
    new = {'n': 'B' * 16, 'ct': 'Zml4dHVyZS1ib3g='}
    update = {'wrapped_vault_key': new, 'kdf_salt': 'D' * 24,
              'expected_key': ACCOUNT['kdf_salt'], 'expected_recovery': ACCOUNT['recovery_salt']}
    response = client.put('/api/vault/account/keys', headers=auth_headers, json=update)
    assert response.status_code == 200 and response.json()['data']['recovery_wrapped_vault_key'] == BOX
    assert client.put('/api/vault/account/keys', headers=auth_headers, json=update).status_code == 409
    from app.main import MODULES
    from app.shared.modules import module_for_path
    assert 'pwsvc' in MODULES and module_for_path('/api/pwsvc/projects') == 'pwsvc'
    assert client.get('/api/pwsvc/projects').status_code == 401

def test_favorite_only_preserves_current_ciphertext(client, auth_headers):
    _init_account(client, auth_headers)
    item = _create_item(client, auth_headers)
    path = f"/api/vault/items/{item['id']}"
    next_box = {'n': 'CCCCCCCCCCCCCCCC', 'ct': 'b3BhcXVlLW5ldw=='}
    assert client.put(path, headers=auth_headers, json={'blob': next_box}).status_code == 200
    updated = client.put(path, headers=auth_headers, json={'favorite': True})
    assert updated.status_code == 200
    assert updated.json()['data']['favorite'] is True
    assert updated.json()['data']['blob'] == next_box
    for invalid in ({}, ['invalid']):
        assert client.put(path, headers=auth_headers, json=invalid).status_code == 400


def test_library_roundtrip_on_real_postgresql(client, auth_headers, tmp_path, monkeypatch):
    import pytest
    from fastapi.testclient import TestClient
    from sqlalchemy.engine import make_url
    from app.config import settings
    from app.main import create_app, stop_background

    pgserver = pytest.importorskip('pgserver')
    monkeypatch.setattr(settings, 'debug', False)
    pgdata = tmp_path / 'vault-pg'
    pgdata.mkdir()
    server = pgserver.get_server(str(pgdata))
    pg_app = None
    try:
        uri = make_url(server.get_uri())
        assert uri.host in ('localhost', '127.0.0.1') and uri.port
        target = {'host': '127.0.0.1', 'port': uri.port, 'user': 'postgres', 'password': '', 'dbname': 'vault_roundtrip'}
        response = client.post('/api/admin/database/switch', headers=auth_headers, json={'target': 'postgres', 'postgres': target})
        assert response.status_code == 200, response.text
        pg_app = create_app()
        with TestClient(pg_app) as pg:
            engine = pg_app.state.engine
            assert engine.dialect.name == 'postgresql' and engine.url.port == uri.port
            _check_backup_roundtrip(pg, auth_headers)
            _check_groups(pg, auth_headers)
            rows = pg.get('/api/vault/items', headers=auth_headers).json()['data']['items']
            batch = {'expected_key': ACCOUNT['kdf_salt'], 'expected_items': [[i['id'], i['blob']['n']] for i in rows], 'items': [BOX]}
            assert pg.post('/api/vault/items/append', headers=auth_headers, json=batch).status_code == 201
            assert pg.post('/api/vault/items/append', headers=auth_headers, json=batch).status_code == 409
            assert pg.post('/api/vault/account', headers=auth_headers, json=_empty_reset()).status_code == 409
            snapshot = pg.get('/api/vault/export', headers=auth_headers).json()['data']
            for item in snapshot['items']:
                assert pg.delete(f"/api/vault/items/{item['id']}/purge", headers=auth_headers).status_code == 200
            assert pg.post('/api/vault/account', headers=auth_headers, json=_empty_reset()).status_code == 200
            assert pg.post('/api/vault/items', headers=auth_headers, json={'blob': BOX}).status_code == 409
            assert pg.post('/api/vault/items', headers=auth_headers,
                           json={'blob': BOX, 'expected_key': _empty_reset()['kdf_salt']}).status_code == 201
    finally:
        try:
            if pg_app is not None:
                stop_background(pg_app)
                pg_app.state.engine.dispose()
        finally:
            server.cleanup()
