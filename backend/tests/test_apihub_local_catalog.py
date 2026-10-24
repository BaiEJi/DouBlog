"""DouBlog（本机）内置目录测试：初始化/幂等/生命周期/冲突/多 app/本机 PG（D01–D04）。

- D01 空库自动一个内置系统 + 两 API；重复 start 不重复；用户调整保留；origin 随端口更新；
- D02 旧迁移（老库 doublog 自注册清理）先执行，再播种目录；普通数据保留；无 doublog-self；
- D03 保留 slug 被普通资源占用 → LocalCatalogConflict 且事务无部分目录；
  伪造/清除 marker/改固定结构/删内置/新增未登记 API 一律 400 且库未变；
- D04 两个 app 不同数据目录互不可见；本机临时 PG 同样登记/幂等/冲突。
"""

import json

import pytest
from sqlalchemy import create_engine, inspect, text

from app.apihub.local_catalog import (BUILTIN_SYSTEM_SLUG, GET_KEY_API_SLUG,
                                      NAMESPACE_API_SLUG, is_builtin_transport,
                                      seed_local_catalog, LocalCatalogConflict)


def _systems(client, auth_headers):
    return {s['slug']: s for s in client.get('/api/apihub/admin/systems',
                                             headers=auth_headers).json()['data']}


def _apis(client, auth_headers, system_id):
    return client.get(f'/api/apihub/admin/apis?system_id={system_id}',
                      headers=auth_headers).json()['data']


def _builtin_rows(client, auth_headers):
    systems = _systems(client, auth_headers)
    sys_row = systems[BUILTIN_SYSTEM_SLUG]
    return sys_row, {a['slug']: a for a in _apis(client, auth_headers, sys_row['id'])}


class TestSeedD01:
    def test_fresh_db_seeded_once(self, client, auth_headers, app):
        from app.config import settings
        sys_row, apis = _builtin_rows(client, auth_headers)
        assert sys_row['name'] == 'DouBlog（本机）'
        assert sys_row['builtin'] is True
        assert sys_row['base_url'] == f'http://127.0.0.1:{settings.port}'
        assert sys_row['timeout_ms'] == 5000 and sys_row['max_retry'] == 0
        assert set(apis) == {NAMESPACE_API_SLUG, GET_KEY_API_SLUG}
        ns_api = apis[NAMESPACE_API_SLUG]
        assert ns_api['method'] == 'GET' and ns_api['path_tpl'] == '/api/confcenter/namespaces'
        key_api = apis[GET_KEY_API_SLUG]
        assert key_api['method'] == 'GET'
        assert key_api['path_tpl'] == '/api/confcenter/{path.namespace}/{path.key}'
        assert all(a['builtin'] is True for a in apis.values())
        # 初次播种的鉴权：Basic provider + 默认用户凭据（settings 来源，内联明文）
        assert ns_api['auth_config']['providers'] == [{'type': 'basic'}]
        assert ns_api['auth_config']['credential']['user'] == settings.auth_username
        # probe：不定时 + /health（避免无路径参数时自动探活误判）
        assert ns_api['probe']['interval_s'] == 0 and ns_api['probe']['path'] == '/health'
        assert ns_api['response_cfg'] == {'envelope': 'passthrough'}
        assert ns_api['request_cfg'] is None

    def test_repeated_start_idempotent(self, client, auth_headers, app):
        from app.apihub import start_background
        start_background(app)          # 二次 start（同库同 app）不重复登记
        start_background(app)
        systems = _systems(client, auth_headers)
        assert list(systems).count(BUILTIN_SYSTEM_SLUG) == 1
        _, apis = _builtin_rows(client, auth_headers)
        assert set(apis) == {NAMESPACE_API_SLUG, GET_KEY_API_SLUG}

    def test_restart_same_db_preserves_user_changes(self, app, auth_headers):
        """重复 create_app（同库）：enabled/name/timeout/status/凭据保留，origin 随端口更新。"""
        from fastapi.testclient import TestClient
        from app.config import settings
        with TestClient(app) as client:
            sys_row, apis = _builtin_rows(client, auth_headers)
            # 用户调整：停用一个 API、改系统名称/超时、改另一 API 凭据
            r = client.put(f"/api/apihub/admin/apis/{apis[GET_KEY_API_SLUG]['id']}/enabled",
                           headers=auth_headers, json={'enabled': False})
            assert r.status_code == 200
            r = client.put(f"/api/apihub/admin/systems/{sys_row['id']}", headers=auth_headers, json={
                'name': '我的本机', 'slug': BUILTIN_SYSTEM_SLUG,
                'base_url': sys_row['base_url'], 'timeout_ms': 8000, 'max_retry': 2,
                'status': 2, 'transport': sys_row['transport']})
            assert r.status_code == 200, r.json()
            key_api = apis[GET_KEY_API_SLUG]
            r = client.put(f"/api/apihub/admin/apis/{key_api['id']}", headers=auth_headers, json={
                **key_api, 'enabled': False,      # 保持停用状态（key_api 是停用前的旧快照）
                'auth_config': {
                    'providers': [{'type': 'basic'}],
                    'credential_fields': ['user', 'password'],
                    'credential': {'user': 'admin', 'password': 'changed-pw'}}})
            assert r.status_code == 200, r.json()
        # 模拟重启（端口变化）+ 再次播种
        settings.port = settings.port + 1
        try:
            from app.main import create_app
            app2 = create_app()
            with TestClient(app2) as client2:
                sys2, apis2 = _builtin_rows(client2, auth_headers)
                assert sys2['name'] == '我的本机' and sys2['status'] == 2
                assert sys2['timeout_ms'] == 8000 and sys2['max_retry'] == 2
                assert sys2['base_url'] == f'http://127.0.0.1:{settings.port}'  # origin 更新
                assert apis2[GET_KEY_API_SLUG]['enabled'] is False              # 停用保留
                assert apis2[GET_KEY_API_SLUG]['auth_config']['credential']['password'] == 'changed-pw'
                assert len(apis2) == 2                                          # 不新增
        finally:
            settings.port = settings.port - 1


class TestSeedD02OldMigration:
    @pytest.fixture()
    def migrated_dir(self, tmp_path, monkeypatch):
        """旧版 schema 库（含 doublog 自注册遗留 + 普通 qq 系统）→ 跑旧迁移 → create_app 播种。"""
        from app.apihub.core import CryptoBox
        from app.config import settings
        from app.db import Base
        import app.apihub.models  # noqa: F401 - 注册 apihub 表

        monkeypatch.setattr(settings, 'data_dir', str(tmp_path))
        monkeypatch.setattr(settings, 'images_dir', str(tmp_path / 'images'))
        monkeypatch.setattr(settings, 'database_backend', 'sqlite')
        monkeypatch.setenv('DOUBLOG_TESTING', '1')
        # 与 tests/test_apihub_migration.py 相同的旧 schema 最小 DDL
        crypto = CryptoBox('local-catalog-test-master')
        old = [
            """CREATE TABLE apihub_upstreams (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(128) NOT NULL,
                slug VARCHAR(64) NOT NULL UNIQUE, base_url VARCHAR(512) NOT NULL,
                timeout_ms INTEGER NOT NULL DEFAULT 30000, max_retry INTEGER NOT NULL DEFAULT 2,
                auth_config_enc BLOB NOT NULL, status INTEGER NOT NULL DEFAULT 1,
                disabled_reason TEXT, created_at DATETIME, updated_at DATETIME)""",
            """CREATE TABLE apihub_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                upstream_id INTEGER NOT NULL, credential_enc BLOB NOT NULL,
                weight INTEGER NOT NULL DEFAULT 1, status INTEGER NOT NULL DEFAULT 1,
                disabled_reason TEXT, last_used_at DATETIME, last_ok_at DATETIME,
                created_at DATETIME)""",
            """CREATE TABLE apihub_apis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                upstream_id INTEGER NOT NULL, name VARCHAR(128) NOT NULL,
                slug VARCHAR(64) NOT NULL UNIQUE, description VARCHAR(256) NOT NULL DEFAULT '',
                method VARCHAR(8) NOT NULL DEFAULT 'GET', path_tpl VARCHAR(512) NOT NULL DEFAULT '/',
                request_cfg JSON, response_cfg JSON, timeout_ms INTEGER, probe JSON,
                health_status VARCHAR(16) NOT NULL DEFAULT 'unknown',
                last_probe_at DATETIME, last_latency_ms INTEGER,
                enabled BOOLEAN NOT NULL DEFAULT 1,
                group1 VARCHAR(64) NOT NULL DEFAULT '', group2 VARCHAR(64) NOT NULL DEFAULT '',
                pub_name VARCHAR(64) NOT NULL DEFAULT '', doc_md TEXT NOT NULL DEFAULT '',
                created_at DATETIME, updated_at DATETIME)""",
            """CREATE TABLE apihub_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(128) NOT NULL,
                key_hash VARCHAR(64) NOT NULL UNIQUE, key_hint VARCHAR(24) NOT NULL DEFAULT '',
                expires_at DATETIME, allowed_api_ids JSON, allowed_ips JSON,
                quota_total INTEGER, quota_used INTEGER NOT NULL DEFAULT 0,
                status INTEGER NOT NULL DEFAULT 1, created_at DATETIME, last_used_at DATETIME)""",
        ]
        engine = create_engine(f'sqlite:///{tmp_path}/blog.db')
        with engine.begin() as conn:
            for ddl in old:
                conn.execute(text(ddl))
            conn.execute(text("INSERT INTO apihub_upstreams (id, name, slug, base_url, auth_config_enc) "
                              "VALUES (1, 'DouBlog 自身', 'doublog', 'http://127.0.0.1:60100', X'00')"))
            conn.execute(text("INSERT INTO apihub_apis (id, upstream_id, name, slug, group1) "
                              "VALUES (1, 1, 'GET /api/todo/tasks', 'todo-get-tasks', 'self')"))
            conn.execute(text("INSERT INTO apihub_tokens (id, name, key_hash) VALUES (1, 'doublog-self', 'h1')"))
            conn.execute(text("INSERT INTO apihub_tokens (id, name, key_hash) VALUES (2, 'my-token', 'h2')"))
            conn.execute(text("INSERT INTO apihub_upstreams (id, name, slug, base_url, auth_config_enc) "
                              "VALUES (2, 'QQ', 'qq', 'https://api.sgroup.qq.com', :enc)"),
                         {'enc': crypto.encrypt({'providers': [{'type': 'bearer', 'value': '{cred.token}'}],
                                                 'credential_fields': ['token'], 'transport': {}})})
            conn.execute(text("INSERT INTO apihub_keys (id, upstream_id, credential_enc) "
                              "VALUES (2, 2, :enc)"), {'enc': crypto.encrypt({'token': 'k'})})
            conn.execute(text("INSERT INTO apihub_apis (id, upstream_id, name, slug, group1) "
                              "VALUES (2, 2, 'send c2c', 'qq-send-c2c', 'qq')"))
        engine.dispose()
        with open(tmp_path / 'apihub.key', 'w', encoding='utf-8') as f:
            f.write('local-catalog-test-master')
        return tmp_path

    def test_migration_then_seed(self, migrated_dir, auth_headers):
        from fastapi.testclient import TestClient
        from app.main import create_app
        app = create_app()
        with TestClient(app) as client:
            systems = _systems(client, auth_headers)
            # 旧自注册 doublog 系统被迁移清理，新内置 doublog（marker）接管该 slug
            assert list(systems).count('doublog') == 1
            assert systems['doublog']['builtin'] is True
            assert systems['qq']['builtin'] is False        # 普通系统保留
            tokens = [t['name'] for t in client.get('/api/apihub/admin/tokens',
                                                    headers=auth_headers).json()['data']]
            assert 'doublog-self' not in tokens and 'my-token' in tokens
            sys_row, apis = _builtin_rows(client, auth_headers)
            assert set(apis) == {NAMESPACE_API_SLUG, GET_KEY_API_SLUG}
        # 直接 ensure_migrations（纯历史迁移调用）在老库上行为不变：不再清新目录
        from app.apihub import ensure_migrations
        ensure_migrations(create_engine(f'sqlite:///{migrated_dir}/blog.db'))


class TestSeedD03Conflict:
    def _runtime(self, tmp_path):
        from app.db import Base, DatabaseRuntime
        import app.apihub.models  # noqa: F401
        engine = create_engine(f'sqlite:///{tmp_path}/blog.db')
        Base.metadata.create_all(engine)
        return DatabaseRuntime(engine)

    def test_normal_system_occupies_slug(self, tmp_path):
        runtime = self._runtime(tmp_path)
        from app.apihub.models import ApihubSystem
        from app.db import database_context
        with database_context(runtime) as _:
            from app.db import db
            db.session.add(ApihubSystem(name='占位', slug='doublog', base_url='http://x'))
            db.session.commit()
            db.session.remove()
        with pytest.raises(LocalCatalogConflict, match='doublog'):
            seed_local_catalog(runtime)
        # 事务回滚：无部分目录（系统仍是普通占位，两 API 未创建）
        with database_context(runtime) as _:
            from app.db import db
            from sqlalchemy import select
            from app.apihub.models import ApihubApi
            assert db.session.execute(select(ApihubApi)).scalars().all() == []
            row = db.session.execute(select(ApihubSystem)).scalar()
            assert is_builtin_transport(row.transport) is False
            db.session.remove()
        runtime.engine.dispose()

    def test_normal_api_occupies_reserved_slug(self, tmp_path):
        runtime = self._runtime(tmp_path)
        from app.apihub.models import ApihubApi, ApihubSystem
        from app.db import database_context, db
        with database_context(runtime):
            s = ApihubSystem(name='普通', slug='normal', base_url='http://x')
            db.session.add(s)
            db.session.flush()
            db.session.add(ApihubApi(system_id=s.id, name='占位', slug=NAMESPACE_API_SLUG,
                                     method='GET', path_tpl='/'))
            db.session.commit()
            db.session.remove()
        with pytest.raises(LocalCatalogConflict, match=NAMESPACE_API_SLUG):
            seed_local_catalog(runtime)
        runtime.engine.dispose()

    def test_admin_cannot_forge_or_break_structure(self, client, auth_headers, app):
        """管理端保护：新建保留 slug 400；内置改固定结构/删除/新增 API 400 且库未变；
        清除 marker 的更新被合并纠正。"""
        sys_row, apis = _builtin_rows(client, auth_headers)
        ns_api, key_api = apis[NAMESPACE_API_SLUG], apis[GET_KEY_API_SLUG]
        # 普通系统/API 不能占用保留 slug
        r = client.post('/api/apihub/admin/systems', headers=auth_headers, json={
            'name': 'x', 'slug': 'doublog', 'base_url': 'http://x'})
        assert r.status_code == 400
        r = client.post('/api/apihub/admin/systems', headers=auth_headers, json={
            'name': 'y', 'slug': 'y-host', 'base_url': 'http://x'})
        assert r.status_code == 200
        host = r.json()['data']['id']
        r = client.post('/api/apihub/admin/apis', headers=auth_headers, json={
            'name': 'z', 'slug': NAMESPACE_API_SLUG, 'system_id': host,
            'method': 'GET', 'path_tpl': '/'})
        assert r.status_code == 400
        # 目录 slug 已被内置 API 占用：dup 检查或保留检查任一拦截
        assert '已存在' in r.json()['message'] or '内置目录保留' in r.json()['message']
        # 内置系统：slug/base_url 改动 400；删除 400；transport 更新保留 marker
        r = client.put(f'/api/apihub/admin/systems/{sys_row["id"]}', headers=auth_headers, json={
            **sys_row, 'slug': 'doublog2'})
        assert r.status_code == 400
        r = client.put(f'/api/apihub/admin/systems/{sys_row["id"]}', headers=auth_headers, json={
            **sys_row, 'base_url': 'http://evil'})
        assert r.status_code == 400
        assert client.delete(f'/api/apihub/admin/systems/{sys_row["id"]}',
                             headers=auth_headers).status_code == 400
        r = client.put(f'/api/apihub/admin/systems/{sys_row["id"]}', headers=auth_headers, json={
            **sys_row, 'transport': {}})   # 尝试清掉 marker
        assert r.status_code == 200
        assert r.json()['data']['builtin'] is True
        # 内置系统下不能新增未登记 API
        r = client.post('/api/apihub/admin/apis', headers=auth_headers, json={
            'name': 'extra', 'slug': 'doublog-extra', 'system_id': sys_row['id'],
            'method': 'GET', 'path_tpl': '/'})
        assert r.status_code == 400
        # 内置 API：slug/system/method/path_tpl 固定；删除 400；凭据/名称/启停可改
        for mutate in ({'slug': 'renamed'}, {'system_id': host},
                       {'method': 'POST'}, {'path_tpl': '/api/other'}):
            r = client.put(f'/api/apihub/admin/apis/{ns_api["id"]}', headers=auth_headers,
                           json={**ns_api, **mutate})
            assert r.status_code == 400, mutate
        assert client.delete(f'/api/apihub/admin/apis/{ns_api["id"]}',
                             headers=auth_headers).status_code == 400
        r = client.put(f'/api/apihub/admin/apis/{key_api["id"]}', headers=auth_headers, json={
            **key_api, 'name': '查询单条',
            'auth_config': {'providers': [{'type': 'basic'}],
                            'credential_fields': ['user', 'password'],
                            'credential': {'user': 'admin', 'password': 'pw2'}}})
        assert r.status_code == 200, r.json()
        assert r.json()['data']['name'] == '查询单条'
        assert r.json()['data']['auth_config']['credential']['password'] == 'pw2'
        # 库未变：结构字段原样
        _, apis_after = _builtin_rows(client, auth_headers)
        assert apis_after[NAMESPACE_API_SLUG]['path_tpl'] == '/api/confcenter/namespaces'
        assert apis_after[GET_KEY_API_SLUG]['method'] == 'GET'


class TestSeedD04MultiAppAndPG:
    def test_two_apps_isolated(self, tmp_path, monkeypatch, auth_headers):
        """两个 app 不同数据目录互不可见；各自目录独立、快照互不串用。"""
        from fastapi.testclient import TestClient
        from app.apihub.state import get_state
        from app.config import settings
        from app.main import create_app
        dirs = [tmp_path / 'a', tmp_path / 'b']
        apps = []
        for d in dirs:
            d.mkdir()
            monkeypatch.setattr(settings, 'data_dir', str(d))
            monkeypatch.setattr(settings, 'images_dir', str(d / 'images'))
            monkeypatch.setattr(settings, 'database_backend', 'sqlite')   # 禁止触业务 PG
            monkeypatch.setenv('DOUBLOG_TESTING', '1')
            a = create_app()
            get_state(a)   # 默认 runtime 仍指向本 app 时惰建快照，避免后续 app 覆盖默认值
            apps.append(a)
        stores = []
        for i, a in enumerate(apps):
            with TestClient(a) as c:
                systems = _systems(c, auth_headers)
                assert set(systems) == {'doublog'}, f'app{i} 只见自己的目录系统'
                _, apis = _builtin_rows(c, auth_headers)
                assert set(apis) == {NAMESPACE_API_SLUG, GET_KEY_API_SLUG}
                stores.append(a.state.apihub)   # with 退出时 stop_background 会清 state
        # 快照无全局串用：两个 store 是不同对象，各只含自己库的目录
        s0, s1 = stores
        assert s0 is not s1
        assert set(s0.store.systems_by_slug) == {'doublog'}
        assert set(s1.store.systems_by_slug) == {'doublog'}
        assert set(s0.store.apis) == {NAMESPACE_API_SLUG, GET_KEY_API_SLUG}

    def test_local_pg_seed_idempotent_and_conflict(self, tmp_path):
        """本机临时 pgserver：登记/幂等/冲突事务同样成立（不触业务 PG）。"""
        pgserver = pytest.importorskip('pgserver', reason='未安装 pgserver，跳过本机 PG 集成')
        server = pgserver.get_server(str(tmp_path / 'pgdata'))
        uri = server.get_uri()                       # .../postgres
        base_uri = uri.rsplit('/', 1)[0]
        server.psql('CREATE DATABASE apihub_catalog_test')
        engine = create_engine(f'{base_uri}/apihub_catalog_test', pool_pre_ping=True)
        from app.db import Base, DatabaseRuntime
        import app.apihub.models  # noqa: F401
        Base.metadata.create_all(engine)
        runtime = DatabaseRuntime(engine)
        r1 = seed_local_catalog(runtime)
        assert r1['created_system'] is True and r1['created_apis'] == 2
        r2 = seed_local_catalog(runtime)
        assert r2['created_system'] is False and r2['created_apis'] == 0   # 幂等
        with engine.connect() as conn:
            n = conn.execute(text('SELECT count(*) FROM apihub_apis')).scalar()
            assert n == 2
            origin = conn.execute(text('SELECT base_url FROM apihub_systems')).scalar()
            assert origin == r1['origin']
        # 冲突事务：抹掉 marker 使内置系统变“普通”，再次播种应冲突且回滚
        from app.db import database_context, db
        with database_context(runtime):
            db.session.execute(text("UPDATE apihub_systems SET transport = '{}'"))
            db.session.commit()
            db.session.remove()
        with pytest.raises(LocalCatalogConflict):
            seed_local_catalog(runtime)
        with engine.connect() as conn:
            n = conn.execute(text('SELECT count(*) FROM apihub_apis')).scalar()
            assert n == 2   # 无部分目录增长
        engine.dispose()
        server.cleanup()
