"""
Admin 数据库管理 API tests

- 状态 / 连通性测试 / 切换校验（纯本地，无 PG 依赖）
- 真实 SQLite ↔ PostgreSQL 切换往返（需 venv 安装 pgserver，否则跳过）
"""
import pytest


def _has_blog_routes(app) -> bool:
    """并行迁移中间态探针：app.blog 未迁移时动态注册表跳过它，/api/posts 不存在；
    blog 正常注册后恒为 True（下方护栏随之自动失效）。

    注意 FastAPI 0.143 的 include_router 产生惰性 _IncludedRouter（顶层
    元素无 .path），必须展开 original_router 后再比对。
    """
    def _paths(routes):
        for r in routes:
            inner = getattr(r, 'original_router', None)
            if inner is not None:
                yield from _paths(inner.routes)
            else:
                yield getattr(r, 'path', '')
    return any(p == '/api/posts' for p in _paths(app.routes))


def _create_post(client, headers, title, name, parent_id=None):
    payload = {'title': title, 'name': name, 'content': f'content of {name}'}
    if parent_id is not None:
        payload['parent_id'] = parent_id
    r = client.post('/api/posts', json=payload, headers=headers)
    assert r.status_code == 201
    return r.json()['data']


@pytest.fixture(autouse=True)
def _prod_semantics(monkeypatch):
    """对齐 Flask 时代测试环境语义：测试进程不在 reloader 下
    （WERKZEUG_RUN_MAIN 未设置）→ switch 返回 restart_required=True、
    不 touch 重启戳文件。"""
    from app.config import settings
    monkeypatch.setattr(settings, 'debug', False)


@pytest.fixture(autouse=True)
def _ensure_count_tables(app):
    """中间态护栏：app.blog 未迁移（导入失败被跳过）时 init_db 建不出
    blog_posts / blog_audit_logs，GET /api/admin/database 的统计 SQL 会 500。
    补最小表壳保证 system 用例自包含；blog 已注册时 create_all 已建真表，
    CREATE TABLE IF NOT EXISTS 为 no-op。"""
    from sqlalchemy import text
    with app.state.engine.begin() as conn:
        conn.execute(text('CREATE TABLE IF NOT EXISTS blog_posts (id INTEGER PRIMARY KEY)'))
        conn.execute(text('CREATE TABLE IF NOT EXISTS blog_audit_logs (id INTEGER PRIMARY KEY)'))


# ─── 状态 ────────────────────────────────────────────────

def test_database_status(client, auth_headers):
    r = client.get('/api/admin/database', headers=auth_headers)

    assert r.status_code == 200
    data = r.json()['data']
    assert data['backend'] == 'sqlite'
    assert 'postgres' in data
    assert data['counts']['posts'] == 0


def test_admin_requires_auth(client):
    assert client.get('/api/admin/database').status_code == 401


# ─── 连通性测试（不切换）────────────────────────────────

def test_connection_test_sqlite(client, auth_headers):
    r = client.post('/api/admin/database/test', json={'target': 'sqlite'}, headers=auth_headers)

    assert r.status_code == 200
    assert r.json()['data']['ok'] is True


def test_connection_test_postgres_unreachable(client, auth_headers):
    r = client.post('/api/admin/database/test', json={
        'target': 'postgres',
        'postgres': {'host': '127.0.0.1', 'port': 59999, 'user': 'postgres', 'password': '', 'dbname': 'none'},
    }, headers=auth_headers)

    assert r.status_code == 400
    assert '连接失败' in r.json()['message']


def test_connection_test_invalid_target(client, auth_headers):
    r = client.post('/api/admin/database/test', json={'target': 'mysql'}, headers=auth_headers)

    assert r.status_code == 400


# ─── 切换校验（不触达真实 PG）───────────────────────────

def test_switch_to_same_backend_rejected(client, auth_headers):
    r = client.post('/api/admin/database/switch', json={'target': 'sqlite'}, headers=auth_headers)

    assert r.status_code == 400
    assert '当前已在' in r.json()['message']


def test_switch_to_unreachable_postgres_rejected(client, auth_headers, app):
    if _has_blog_routes(app):  # 中间态护栏：blog 未注册时跳过造数（不影响切换断言）
        _create_post(client, auth_headers, 'A', 'sw-post-a')
    r = client.post('/api/admin/database/switch', json={
        'target': 'postgres',
        'postgres': {'host': '127.0.0.1', 'port': 59999, 'user': 'postgres', 'password': '', 'dbname': 'none'},
    }, headers=auth_headers)

    assert r.status_code == 400
    assert '无法连接' in r.json()['message']


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
    if not _has_blog_routes(app):
        pytest.skip('app.blog 路由未注册（并行迁移中间态），跳过依赖 /api/posts 的真实切换往返')

    # 1. sqlite 侧造数据并留基线
    _create_post(client, auth_headers, '基线文章', 'rt-parent')
    tree_before = client.get('/api/posts/tree', headers=auth_headers).json()['data']
    assert len(tree_before) == 1

    # 2. 切到 PostgreSQL（只写配置，无迁移字段）
    r = client.post('/api/admin/database/switch', json={'target': 'postgres', 'postgres': pg}, headers=auth_headers)
    assert r.status_code == 200, r.json()
    assert r.json()['data'] == {'backend': 'postgres', 'restart_required': True}
    assert 'migrated' not in r.json()['data']

    import json as _json
    from app.db import db_config_path
    assert _json.load(open(db_config_path(), encoding='utf-8'))['backend'] == 'postgres'

    # 3. 模拟重启：新 app 绑定 PG —— 空库自动播种（1 默认知识库 / 0 文章），sqlite 数据不动
    from app.main import create_app
    from fastapi.testclient import TestClient
    pg_app = create_app()
    with TestClient(pg_app) as c:
        wss = c.get('/api/workspaces', headers=auth_headers).json()['data']
        assert len(wss) == 1 and wss[0]['name'] == '默认知识库' and wss[0]['post_count'] == 0
        tree = c.get('/api/posts/tree', headers=auth_headers).json()['data']
        assert tree == []
        # PG 上写一篇（空库自增，无序列问题）
        r = c.post('/api/posts', json={'title': 'PG 文章', 'name': 'rt-pg-post', 'content': 'x'}, headers=auth_headers)
        assert r.status_code == 201

    # 4. 未重启也允许连续切换（纯配置写入，无数据源错位风险）
    r = client.post('/api/admin/database/switch', json={'target': 'sqlite'}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()['data']['backend'] == 'sqlite'

    # 5. 切回后：sqlite 原数据原封不动（PG 上的文章不出现）
    final_app = create_app()
    with TestClient(final_app) as c:
        tree = c.get('/api/posts/tree', headers=auth_headers).json()['data']
        names = [n['name'] for n in tree]
        assert names == ['rt-parent']
        assert 'rt-pg-post' not in names
        detail = c.get('/api/posts/id/1', headers=auth_headers).json()['data']
        assert detail['title'] == '基线文章'


# ─── 日志上报配置（管理页）────────────────────────────────

def test_logging_config_endpoints(client, auth_headers, tmp_path, monkeypatch):
    """GET 默认 → PUT 改开关/地址/级别（即时持久化）→ 校验拒绝 → 测试发送返回 marker"""
    from app.config import settings as st
    monkeypatch.setattr(st, 'logs_send_json', True)          # 默认启用（测试里 conftest 关过）

    d = client.get('/api/admin/logging', headers=auth_headers).json()['data']
    assert d['enabled'] is True and d['url'].startswith('http')
    assert {'module': 'diary', 'sys_name': 'doublog.diary'} in d['modules']

    r = client.put('/api/admin/logging', json={'enabled': False, 'url': 'http://127.0.0.1:60100/api/v1/logs', 'level': 'INFO'},
                   headers=auth_headers)
    assert r.status_code == 200
    d2 = r.json()['data']
    assert d2['enabled'] is False and d2['level'] == 'INFO'

    # 文件持久化 + 重新读取
    import json as _json, os as _os
    cfg_path = _os.path.join(st.data_dir, 'logs_config.json')
    assert _os.path.exists(cfg_path)
    stored = _json.load(open(cfg_path, encoding='utf-8'))
    assert stored['enabled'] is False and stored['level'] == 'INFO'
    d3 = client.get('/api/admin/logging', headers=auth_headers).json()['data']
    assert d3['enabled'] is False

    for bad in ({'enabled': 'yes'}, {'url': 'ftp://x'}, {'level': 'DEBUG'}):
        assert client.put('/api/admin/logging', json=bad, headers=auth_headers).status_code == 400

    t = client.post('/api/admin/logging/test', headers=auth_headers)
    assert t.status_code == 200 and t.json()['data']['marker'].startswith('log-send-test-')
