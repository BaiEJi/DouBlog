from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

PATH = '/mcp/todo'
ADMIN = '/api/confcenter/mcp'
TOKENS = ADMIN + '/todo/tokens'
ACCEPT = {'Accept': 'application/json, text/event-stream'}
LOCAL = dict(base_url='http://127.0.0.1:60100', client=('127.0.0.1', 40000))


@pytest.fixture
def local(app):
    with TestClient(app, **LOCAL) as client:
        yield client


def mint(client, auth):
    response = client.post(TOKENS, headers=auth, json={'name': 'QA'})
    assert response.status_code == 201
    assert response.headers['cache-control'] == 'no-store'
    return response.json()['data']


def bearer(item):
    return {**ACCEPT, 'Authorization': 'Bearer ' + item['token']}


def rpc(client, headers, method, params=None):
    message = {'jsonrpc': '2.0', 'method': method, 'id': 1}
    if params is not None:
        message['params'] = params
    return client.post(PATH, headers=headers, json=message)


def call(client, headers, tool_name, *, expect_error=False, **args):
    r = rpc(client, headers, 'tools/call', {'name': tool_name, 'arguments': args})
    assert r.status_code == 200, r.text
    result = r.json()['result']
    assert bool(result.get('isError')) == expect_error, result['content']
    return result['content'][0]['text'] if expect_error else result['structuredContent']


def test_access_and_discovery(app, local, auth_headers, monkeypatch):
    from app.config import settings
    from app.shared.timeutil import now_utc
    from app.confcenter.models import McpToken
    assert local.get(TOKENS).status_code == 401
    assert local.post(TOKENS, json={}).status_code == 401
    item = mint(local, auth_headers)
    headers = bearer(item)
    listing = local.get(TOKENS, headers=auth_headers)
    assert item['token'] not in listing.text and 'digest' not in listing.text
    assert [row['id'] for row in listing.json()['data']] == [item['id']]
    modules = local.get(ADMIN, headers=auth_headers).json()['data']
    assert [(m['key'], m['endpoint']) for m in modules] == [('todo', 'http://127.0.0.1:60100/mcp/todo')]
    assert local.post('/api/todo/mcp/tokens', headers=auth_headers, json={}).status_code == 404
    with Session(app.state.db_runtime.engine) as s:
        record = s.get(McpToken, item['id'])
        assert record.digest != item['token'] and len(record.digest) == 64
    assert local.get('/api/todo/settings', headers=headers).status_code == 401
    assert local.post(TOKENS, headers=headers, json={}).status_code == 401
    assert rpc(local, auth_headers, 'tools/list').status_code == 401
    assert local.post(PATH + '?token=' + item['token'], json={}).status_code == 401
    for method in ('get', 'delete'):
        assert getattr(local, method)(PATH).status_code == 401
    assert rpc(local, {**headers, 'Origin': 'https://external.example'}, 'tools/list').status_code == 403
    init = rpc(local, headers, 'initialize', {'protocolVersion': '2025-11-25', 'capabilities': {},
                                             'clientInfo': {'name': 'QA', 'version': '1'}})
    assert init.json()['result']['serverInfo']['name'] == 'mytodo'
    assert local.post(PATH, headers=headers, json={'jsonrpc': '2.0', 'method': 'notifications/initialized'}).status_code == 202
    tools = rpc(local, headers, 'tools/list').json()['result']['tools']
    assert {t['name'] for t in tools} == {
        'get_today', 'list_tasks', 'get_task', 'list_migration_queue', 'migrate_task', 'set_task_shelved',
        'create_task', 'update_task', 'complete_task', 'reopen_task', 'arrange_task', 'get_calendar', 'get_report'}
    assert rpc(local, headers, 'tools/call', {'name': 'delete_task', 'arguments': {}}).json().get('error')
    assert local.delete(TOKENS + '/' + item['id'], headers=auth_headers).is_success
    assert rpc(local, headers, 'tools/list').status_code == 401
    default_token = local.post(TOKENS, headers=auth_headers)
    assert default_token.status_code == 201
    other = default_token.json()['data']
    assert other['name'] == 'MCP 客户端'
    with Session(app.state.db_runtime.engine) as s:
        s.get(McpToken, other['id']).expires_at = now_utc() - timedelta(seconds=1)
        s.commit()
    assert rpc(local, bearer(other), 'tools/list').status_code == 401
    monkeypatch.setattr(settings, 'auth_enabled', False)
    assert local.post(TOKENS, json={}).status_code == 403


def test_workflow(local, auth_headers):
    headers = bearer(mint(local, auth_headers))
    def read(name, **args):
        return call(local, headers, name, **args)
    def write(name, **args):
        return read(name, mutation_id=str(uuid4()), **args)

    board = read('get_today')
    today = date.fromisoformat(board['date'])
    yesterday = (today - timedelta(days=1)).isoformat()
    assert len(board['quadrants']) == 4
    task = write('create_task', title='MCP 待排期')
    tid = task['id']
    assert [t['id'] for t in read('list_tasks', inbox=True, q='MCP')['items']] == [tid]
    scheduled = write('update_task', task_id=tid, task_date=yesterday, revision=task['revision'])
    assert scheduled['original_date'] == yesterday
    assert '409' in write('update_task', task_id=tid, title='过期修改', revision=task['revision'], expect_error=True)
    assert tid in [t['id'] for t in read('list_migration_queue')['items']]
    assert write('set_task_shelved', task_id=tid, shelved=True)['shelved_at']
    assert read('list_migration_queue', queue='shelved')['items'][0]['id'] == tid
    assert not read('list_migration_queue')['items']
    assert write('set_task_shelved', task_id=tid, shelved=False)['shelved_at'] is None
    moved = write('migrate_task', task_id=tid, to_date='today', reason='调整计划')
    assert moved['task_date'] == str(today) and moved['migrated_count'] == 1
    anchor = write('create_task', title='排序参照', task_date='today', is_important=True)
    arranged = write('arrange_task', task_id=tid, revision=moved['revision'], quadrant=2)
    first = write('arrange_task', task_id=tid, revision=arranged['revision'], before_task_id=anchor['id'])
    assert first['position'] < anchor['position'] and first['quadrant'] == 2
    assert write('complete_task', task_id=tid, note='已验证')['completion_note'] == '已验证'
    assert read('get_calendar', start=str(today), end=str(today))['days'][0]['done'] == 1
    for mode, args in [('daily', {}), ('range', {'start': yesterday, 'end': str(today)}),
                       ('heatmap', {'year': today.year}), ('streak', {})]:
        assert read('get_report', mode=mode, **args)
    assert read('get_report', mode='range', expect_error=True)
    assert write('reopen_task', task_id=tid)['status'] == 'pending'
    assert any(e['event_type'] == 'migrated' for e in read('get_task', task_id=tid)['events'])
    assert local.get('/api/todo/tasks/' + tid, headers=auth_headers).json()['data']['status'] == 'pending'


def test_concurrent_receipt_and_rollback(local, auth_headers):
    headers = bearer(mint(local, auth_headers))
    mutation = str(uuid4())
    def create(title='首次记录', **kwargs):
        return call(local, headers, 'create_task', title=title, mutation_id=mutation, **kwargs)
    with ThreadPoolExecutor(2) as pool:
        a, b = [f.result() for f in [pool.submit(create), pool.submit(create)]]
    assert a == b
    assert '409' in create('不同内容', expect_error=True)
    assert call(local, headers, 'list_tasks', q='首次记录')['total'] == 1
    new_id = str(uuid4())
    assert call(local, headers, 'create_task', mutation_id=new_id, title=' ', expect_error=True)
    assert call(local, headers, 'create_task', mutation_id=new_id, title='已修正')['id']


def check_category_lifecycle(client, auth_headers, token):
    admin = ADMIN + '/todo/tools/'
    catalog = client.get(ADMIN, headers=auth_headers).json()['data']
    tools = next(m['tools'] for m in catalog if m['key'] == 'todo')
    group = {t['name']: t['enabled'] for t in tools if t['group'] == '类别管理'}
    assert set(group) == {'list_categories', 'create_category', 'update_category', 'delete_category'}
    assert not any(group.values())
    assert rpc(client, token, 'tools/call', {'name': 'list_categories', 'arguments': {}}).json()['error']['code'] == -32602
    for name in group:
        assert client.put(admin + name, headers=auth_headers, json={'enabled': True}).is_success

    def write(tool_name, **args):
        args.setdefault('mutation_id', str(uuid4()))
        return call(client, token, tool_name, **args)

    new = {'mutation_id': str(uuid4()), 'name': '  交付  ', 'color': '#0E7490', 'icon': '📋', 'sort_order': 8}
    assert write('create_category', name='未保存', is_archived=True, expect_error=True)
    assert write('create_category', **{**new, 'name': '   '}, expect_error=True)
    category = call(client, token, 'create_category', **new)
    assert category == call(client, token, 'create_category', **new)
    cid = category['id']
    assert category['name'] == '交付' and category['task_count'] == 0
    rest = '/api/todo/categories'
    assert any(c['id'] == cid for c in client.get(rest, headers=auth_headers).json()['data'])
    task = write('create_task', title='待办关联', category_id=cid)
    done = write('create_task', title='已完成关联', category_id=cid)
    write('complete_task', task_id=done['id'])
    trashed = write('create_task', title='回收站关联', category_id=cid)
    trashed_path = '/api/todo/tasks/' + trashed['id']
    assert client.delete(trashed_path, headers=auth_headers).is_success

    archived = write('update_category', category_id=cid, name='交付跟进', is_archived=True, color='#7C3AED', sort_order=-1)
    assert archived['task_count'] == 1 and archived['icon'] == '📋' and archived['name'] == '交付跟进'
    assert cid not in [c['id'] for c in call(client, token, 'list_categories')['items']]
    assert call(client, token, 'list_categories', include_archived=True)['items'][0] == archived
    web = client.patch(rest + '/' + cid, headers=auth_headers, json={'is_archived': False, 'icon': None})
    assert web.is_success
    restored = call(client, token, 'list_categories')['items'][0]
    assert restored['id'] == cid and restored['icon'] is None and not restored['is_archived']
    assert call(client, token, 'get_task', task_id=task['id'])['category_id'] == cid

    future = (date.today() + timedelta(days=365)).isoformat()
    plan = client.post('/api/todo/plans', headers=auth_headers, json={
        'title': '交付计划', 'start_date': future, 'category_id': cid, 'rule': {'type': 'weekly', 'weekdays': [0]}})
    assert plan.status_code == 201
    remove = {'mutation_id': str(uuid4()), 'category_id': cid}
    deleted = call(client, token, 'delete_category', **remove)
    assert deleted == {'ok': True, 'moved_to_uncategorized': 2}
    assert call(client, token, 'delete_category', **remove) == deleted
    for tid in (task['id'], done['id']):
        assert call(client, token, 'get_task', task_id=tid)['category_id'] is None
    assert client.post(trashed_path + '/restore', headers=auth_headers).json()['data']['category_id'] is None
    plans = client.get('/api/todo/plans', headers=auth_headers).json()['data']
    plan_id = plan.json()['data']['id']
    assert next(p for p in plans if p['id'] == plan_id)['category_id'] is None
    today = call(client, token, 'get_today')['date']
    changed = client.patch('/api/todo/plans/' + plan_id, headers=auth_headers, json={
        'start_date': today, 'end_date': today, 'rule': {'type': 'weekly', 'weekdays': list(range(7))}})
    assert changed.is_success
    instances = client.get('/api/todo/tasks', headers=auth_headers, params={'date': today, 'plan_only': True}).json()['data']
    assert any(t['plan_id'] == plan_id and t['category_id'] is None for t in instances)
    assert '404' in write('delete_category', category_id=cid, expect_error=True)


def test_category_management_uses_the_same_records_as_the_website(local, auth_headers):
    check_category_lifecycle(local, auth_headers, bearer(mint(local, auth_headers)))


def test_receipts_and_token_isolation_on_postgres(local, auth_headers, tmp_path_factory, monkeypatch):
    pgserver = pytest.importorskip('pgserver')
    from sqlalchemy.engine import make_url
    from app.config import settings
    from app.main import create_app

    sqlite_token = mint(local, auth_headers)
    monkeypatch.setattr(settings, 'debug', False)
    server = pgserver.get_server(str(tmp_path_factory.mktemp('mytodo-mcp-pg')))
    try:
        url = make_url(server.get_uri())
        assert url.host in ('localhost', '127.0.0.1') and url.port
        target = {'host': '127.0.0.1', 'port': url.port, 'user': 'postgres', 'password': '',
                  'dbname': 'mytodo_mcp_test'}
        switched = local.post('/api/admin/database/switch', headers=auth_headers,
                              json={'target': 'postgres', 'postgres': target})
        assert switched.status_code == 200
        pg_app = create_app()
        with TestClient(pg_app, **LOCAL) as pg:
            assert pg_app.state.engine.url.port == url.port
            assert rpc(pg, bearer(sqlite_token), 'tools/list').status_code == 401
            item = mint(pg, auth_headers)
            renewed = pg.post(f"{TOKENS}/{item['id']}/renew", headers=auth_headers,
                              json={'expected_expires_at': item['expires_at']})
            assert renewed.is_success and renewed.json()['data']['expires_at'] > item['expires_at']
            token = bearer(item)
            setting = ADMIN + '/todo/tools/create_task'
            assert pg.put(setting, headers=auth_headers, json={'enabled': False}).is_success
            blocked = rpc(pg, token, 'tools/call', {'name': 'create_task', 'arguments': {}})
            assert blocked.json()['error']['code'] == -32602
            assert pg.put(setting, headers=auth_headers, json={'enabled': True}).is_success
            mutation = str(uuid4())
            def create():
                return call(pg, token, 'create_task', title='PG 任务', mutation_id=mutation)
            with ThreadPoolExecutor(2) as pool:
                a, b = [f.result() for f in [pool.submit(create), pool.submit(create)]]
            assert a == b and call(pg, token, 'list_tasks', q='PG 任务')['total'] == 1
            check_category_lifecycle(pg, auth_headers, token)
    finally:
        server.cleanup()
