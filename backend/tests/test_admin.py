"""
Admin 数据库管理 API tests

- 状态 / 连通性测试 / 切换校验（纯本地，无 PG 依赖）
- 真实 SQLite ↔ PostgreSQL 切换往返（需 venv 安装 pgserver，否则跳过）
"""
import pytest


def _create_post(client, headers, title, name, parent_id=None):
    payload = {'title': title, 'name': name, 'content': f'content of {name}'}
    if parent_id is not None:
        payload['parent_id'] = parent_id
    r = client.post('/api/posts', json=payload, headers=headers)
    assert r.status_code == 201
    return r.get_json()['data']


# ─── 状态 ────────────────────────────────────────────────

def test_database_status(client, auth_headers):
    r = client.get('/api/admin/database', headers=auth_headers)

    assert r.status_code == 200
    data = r.get_json()['data']
    assert data['backend'] == 'sqlite'
    assert 'postgres' in data
    assert data['counts']['posts'] == 0


def test_admin_requires_auth(client):
    assert client.get('/api/admin/database').status_code == 401


# ─── 连通性测试（不切换）────────────────────────────────

def test_connection_test_sqlite(client, auth_headers):
    r = client.post('/api/admin/database/test', json={'target': 'sqlite'}, headers=auth_headers)

    assert r.status_code == 200
    assert r.get_json()['data']['ok'] is True


def test_connection_test_postgres_unreachable(client, auth_headers):
    r = client.post('/api/admin/database/test', json={
        'target': 'postgres',
        'postgres': {'host': '127.0.0.1', 'port': 59999, 'user': 'postgres', 'password': '', 'dbname': 'none'},
    }, headers=auth_headers)

    assert r.status_code == 400
    assert '连接失败' in r.get_json()['message']


def test_connection_test_invalid_target(client, auth_headers):
    r = client.post('/api/admin/database/test', json={'target': 'mysql'}, headers=auth_headers)

    assert r.status_code == 400


# ─── 切换校验（不触达真实 PG）───────────────────────────

def test_switch_to_same_backend_rejected(client, auth_headers):
    r = client.post('/api/admin/database/switch', json={'target': 'sqlite'}, headers=auth_headers)

    assert r.status_code == 400
    assert '当前已在' in r.get_json()['message']


def test_switch_to_unreachable_postgres_rejected(client, auth_headers):
    _create_post(client, auth_headers, 'A', 'sw-post-a')
    r = client.post('/api/admin/database/switch', json={
        'target': 'postgres',
        'postgres': {'host': '127.0.0.1', 'port': 59999, 'user': 'postgres', 'password': '', 'dbname': 'none'},
    }, headers=auth_headers)

    assert r.status_code == 400
    assert '无法连接' in r.get_json()['message']


# ─── 真实 SQLite ↔ PostgreSQL 往返（pgserver 可选）──────

pgserver = pytest.importorskip('pgserver', reason='未安装 pgserver，跳过真实 PG 集成测试')


@pytest.fixture(scope='module')
def pg(tmp_path_factory):
    """起一个内嵌 PostgreSQL 实例（module 级共享）"""
    server = pgserver.get_server(str(tmp_path_factory.mktemp('pgdata')))
    yield {
        'host': '127.0.0.1',
        'port': int(server.get_uri().split(':')[3].split('/')[0]),
        'user': 'postgres',
        'password': '',
        'dbname': 'doublog_test',
    }
    server.cleanup()


def test_real_switch_roundtrip(client, auth_headers, pg, app):
    """sqlite → postgres → sqlite 往返：只换连接不迁移，两侧数据互不影响"""
    # 1. sqlite 侧造数据并留基线
    _create_post(client, auth_headers, '基线文章', 'rt-parent')
    tree_before = client.get('/api/posts/tree', headers=auth_headers).get_json()['data']
    assert len(tree_before) == 1

    # 2. 切到 PostgreSQL（只写配置，无迁移字段）
    r = client.post('/api/admin/database/switch', json={'target': 'postgres', 'postgres': pg}, headers=auth_headers)
    assert r.status_code == 200, r.get_json()
    assert r.get_json()['data'] == {'backend': 'postgres', 'restart_required': True}
    assert 'migrated' not in r.get_json()['data']

    import json as _json
    from app.db import db_config_path
    assert _json.load(open(db_config_path(), encoding='utf-8'))['backend'] == 'postgres'

    # 3. 模拟重启：新 app 绑定 PG —— 空库自动播种（1 默认知识库 / 0 文章），sqlite 数据不动
    from app.main import create_app
    pg_app = create_app()
    with pg_app.test_client() as c:
        wss = c.get('/api/workspaces', headers=auth_headers).get_json()['data']
        assert len(wss) == 1 and wss[0]['name'] == '默认知识库' and wss[0]['post_count'] == 0
        tree = c.get('/api/posts/tree', headers=auth_headers).get_json()['data']
        assert tree == []
        # PG 上写一篇（空库自增，无序列问题）
        r = c.post('/api/posts', json={'title': 'PG 文章', 'name': 'rt-pg-post', 'content': 'x'}, headers=auth_headers)
        assert r.status_code == 201

    # 4. 未重启也允许连续切换（纯配置写入，无数据源错位风险）
    r = client.post('/api/admin/database/switch', json={'target': 'sqlite'}, headers=auth_headers)
    assert r.status_code == 200
    assert r.get_json()['data']['backend'] == 'sqlite'

    # 5. 切回后：sqlite 原数据原封不动（PG 上的文章不出现）
    final_app = create_app()
    with final_app.test_client() as c:
        tree = c.get('/api/posts/tree', headers=auth_headers).get_json()['data']
        names = [n['name'] for n in tree]
        assert names == ['rt-parent']
        assert 'rt-pg-post' not in names
        detail = c.get('/api/posts/id/1', headers=auth_headers).get_json()['data']
        assert detail['title'] == '基线文章'
