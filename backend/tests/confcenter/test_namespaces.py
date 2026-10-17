"""独立 namespace 生命周期、兼容写入与历史数据回填。"""
from sqlalchemy import create_engine, select

from app.confcenter.migrations import ensure_migrations
from app.confcenter.models import ConfEntry, ConfNamespace
from tests.confcenter.conftest import AUTH


def test_create_empty_namespace_survives_restart(client, app):
    r = client.post('/api/confcenter/namespaces', json={'namespace': 'empty'}, headers=AUTH)
    assert r.status_code == 201
    assert r.json()['data'] == {'namespace': 'empty', 'count': 0}
    assert client.get('/api/confcenter/namespaces', headers=AUTH).json()['data'] == [r.json()['data']]
    from app.main import create_app
    from fastapi.testclient import TestClient
    restarted = TestClient(create_app())
    assert restarted.get('/api/confcenter/namespaces', headers=AUTH).json()['data'] == [r.json()['data']]


def test_duplicate_namespace_is_conflict_without_overwriting_kv(client):
    assert client.post('/api/confcenter/namespaces', json={'namespace': 'app'}, headers=AUTH).status_code == 201
    assert client.put('/api/confcenter/app/name', json={'type': 'str', 'data': 'kept'}, headers=AUTH).status_code == 201
    r = client.post('/api/confcenter/namespaces', json={'namespace': 'app'}, headers=AUTH)
    assert r.status_code == 409 and r.json()['success'] is False
    assert client.get('/api/confcenter/app/name', headers=AUTH).json()['data']['data'] == 'kept'
    assert client.get('/api/confcenter/namespaces', headers=AUTH).json()['data'] == [{'namespace': 'app', 'count': 1}]


def test_namespace_validation_and_auth(client):
    for name in ('', ' ', 'bad space', 'a/b', 'a?b', 'n' * 101, 'app\n', '中文', None, 123, {}):
        r = client.post('/api/confcenter/namespaces', json={'namespace': name}, headers=AUTH)
        assert r.status_code == 400, (name, r.json())
    assert client.post('/api/confcenter/namespaces', content='not-json', headers=AUTH).status_code == 400
    assert client.post('/api/confcenter/namespaces', json={'namespace': 'private'}).status_code == 401
    name = 'ns_1.v2:c-' + 'a' * 90
    assert len(name) == 100
    assert client.post('/api/confcenter/namespaces', json={'namespace': name}, headers=AUTH).status_code == 201
    assert client.get('/api/confcenter/namespaces', headers=AUTH).json()['data'] == [{'namespace': name, 'count': 0}]


def test_deleting_last_kv_keeps_namespace(client):
    assert client.post('/api/confcenter/namespaces', json={'namespace': 'app'}, headers=AUTH).status_code == 201
    assert client.put('/api/confcenter/app/key', json={'type': 'str', 'data': 'value'}, headers=AUTH).status_code == 201
    assert client.delete('/api/confcenter/app/key', headers=AUTH).status_code == 200
    assert client.get('/api/confcenter/namespaces', headers=AUTH).json()['data'] == [{'namespace': 'app', 'count': 0}]
    data = client.get('/api/confcenter/entries', params={'namespace': 'app'}, headers=AUTH).json()['data']
    assert data['total'] == 0 and data['items'] == []
    assert client.post('/api/confcenter/namespaces', json={'namespace': 'app'}, headers=AUTH).status_code == 409


def test_legacy_put_registers_namespace_and_invalid_put_does_not(client):
    assert client.put('/api/confcenter/legacy/key', json={'type': 'str', 'data': 'v'}, headers=AUTH).status_code == 201
    assert client.put('/api/confcenter/invalid/key', json={'type': 'json', 'data': '{'}, headers=AUTH).status_code == 400
    assert client.get('/api/confcenter/namespaces', headers=AUTH).json()['data'] == [{'namespace': 'legacy', 'count': 1}]


def test_same_key_in_two_namespaces_is_isolated(client):
    for name, value in (('app', 'one'), ('service', 'two')):
        assert client.post('/api/confcenter/namespaces', json={'namespace': name}, headers=AUTH).status_code == 201
        assert client.put(f'/api/confcenter/{name}/shared', json={'type': 'str', 'data': value}, headers=AUTH).status_code == 201
    for name, value in (('app', 'one'), ('service', 'two')):
        d = client.get('/api/confcenter/entries', params={'namespace': name}, headers=AUTH).json()['data']
        assert d['total'] == 1 and d['items'][0]['data'] == value and d['items'][0]['namespace'] == name
    assert client.get('/api/confcenter/namespaces', headers=AUTH).json()['data'] == [{'namespace': 'app', 'count': 1}, {'namespace': 'service', 'count': 1}]


def test_migration_backfills_legacy_namespaces_idempotently():
    engine = create_engine('sqlite://')
    entries, namespaces = ConfEntry.__table__, ConfNamespace.__table__
    entries.create(engine)
    with engine.begin() as conn:
        conn.execute(entries.insert(), [dict(namespace='legacy', key='a', type='str', data='unchanged'), dict(namespace='legacy', key='b', type='json', data='[1,2]')])
    namespaces.create(engine)
    with engine.begin() as conn:
        conn.execute(namespaces.insert().values(namespace='empty'))
    ensure_migrations(engine)
    ensure_migrations(engine)
    with engine.connect() as conn:
        assert conn.execute(select(namespaces.c.namespace).order_by(namespaces.c.namespace)).scalars().all() == ['empty', 'legacy']
        assert conn.execute(select(entries.c.key, entries.c.data).order_by(entries.c.key)).all() == [('a', 'unchanged'), ('b', '[1,2]')]
    engine.dispose()
