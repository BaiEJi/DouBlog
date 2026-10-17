"""apihub upstream → system 重构迁移测试（ensure_migrations + LEGACY_TABLE_MAP）。

自建一份旧版 schema（apihub_upstreams / apihub_apis.upstream_id + OpenAPI 发布列），
插入自注册遗留数据（doublog 系统 / doublog-self 令牌）与一个应保留的普通系统，
跑迁移后断言：表/列改名、OpenAPI 列删除、自注册数据清理、正常数据原样保留、幂等。
"""

import pytest
from sqlalchemy import create_engine, inspect, text

# 旧版（2026-10-17 重构前）apihub schema——与当期 models.py 对应的最小 DDL
_OLD_DDL = [
    """CREATE TABLE apihub_upstreams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(128) NOT NULL, slug VARCHAR(64) NOT NULL UNIQUE,
        base_url VARCHAR(512) NOT NULL,
        timeout_ms INTEGER NOT NULL DEFAULT 30000,
        max_retry INTEGER NOT NULL DEFAULT 2,
        auth_config_enc BLOB NOT NULL,
        status INTEGER NOT NULL DEFAULT 1,
        disabled_reason TEXT, created_at DATETIME, updated_at DATETIME)""",
    """CREATE TABLE apihub_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        upstream_id INTEGER NOT NULL REFERENCES apihub_upstreams(id) ON DELETE CASCADE,
        credential_enc BLOB NOT NULL, weight INTEGER NOT NULL DEFAULT 1,
        status INTEGER NOT NULL DEFAULT 1, disabled_reason TEXT,
        last_used_at DATETIME, last_ok_at DATETIME, created_at DATETIME)""",
    """CREATE TABLE apihub_apis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        upstream_id INTEGER NOT NULL REFERENCES apihub_upstreams(id) ON DELETE CASCADE,
        name VARCHAR(128) NOT NULL, slug VARCHAR(64) NOT NULL UNIQUE,
        description VARCHAR(256) NOT NULL DEFAULT '',
        method VARCHAR(8) NOT NULL DEFAULT 'GET', path_tpl VARCHAR(512) NOT NULL DEFAULT '/',
        request_cfg JSON, response_cfg JSON, timeout_ms INTEGER, probe JSON,
        health_status VARCHAR(16) NOT NULL DEFAULT 'unknown',
        last_probe_at DATETIME, last_latency_ms INTEGER,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        group1 VARCHAR(64) NOT NULL DEFAULT '', group2 VARCHAR(64) NOT NULL DEFAULT '',
        pub_name VARCHAR(64) NOT NULL DEFAULT '', doc_md TEXT NOT NULL DEFAULT '',
        created_at DATETIME, updated_at DATETIME)""",
    """CREATE TABLE apihub_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(128) NOT NULL, key_hash VARCHAR(64) NOT NULL UNIQUE,
        key_hint VARCHAR(24) NOT NULL DEFAULT '', expires_at DATETIME,
        allowed_api_ids JSON, allowed_ips JSON, quota_total INTEGER,
        quota_used INTEGER NOT NULL DEFAULT 0, status INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME, last_used_at DATETIME)""",
    """CREATE TABLE apihub_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope VARCHAR(16) NOT NULL,
        api_id INTEGER REFERENCES apihub_apis(id) ON DELETE CASCADE,
        token_id INTEGER REFERENCES apihub_tokens(id) ON DELETE CASCADE,
        algorithm VARCHAR(16) NOT NULL DEFAULT 'token_bucket',
        rate_per_sec FLOAT, burst INTEGER, window_s INTEGER, max_count INTEGER,
        enabled BOOLEAN NOT NULL DEFAULT 1, created_at DATETIME)""",
    """CREATE TABLE apihub_call_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_id INTEGER, api_id INTEGER, upstream_id INTEGER, key_id INTEGER,
        mode VARCHAR(16) NOT NULL DEFAULT 'invoke', method VARCHAR(8) NOT NULL DEFAULT '',
        path_digest VARCHAR(256) NOT NULL DEFAULT '', status_code INTEGER,
        latency_ms INTEGER, ok BOOLEAN NOT NULL DEFAULT 0, error_type VARCHAR(64),
        rl_scope VARCHAR(16), created_at DATETIME)""",
    """CREATE TABLE apihub_health_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_id INTEGER NOT NULL REFERENCES apihub_apis(id) ON DELETE CASCADE,
        source VARCHAR(16) NOT NULL, ok BOOLEAN NOT NULL DEFAULT 0,
        status_code INTEGER, latency_ms INTEGER, detail JSON, created_at DATETIME)""",
]


@pytest.fixture()
def old_engine(tmp_path):
    """旧版 schema + 自注册遗留数据 + 一个普通系统（应保留）。"""
    engine = create_engine(f'sqlite:///{tmp_path}/old.db')
    with engine.begin() as conn:
        for ddl in _OLD_DDL:
            conn.execute(text(ddl))
        # 自注册遗留：上游 doublog（自注册脚本产物）+ API（self 分组）+ key + doublog-self 令牌
        conn.execute(text("INSERT INTO apihub_upstreams (id, name, slug, base_url, auth_config_enc) "
                          "VALUES (1, 'DouBlog 自身（本机回环）', 'doublog', 'http://127.0.0.1:60100', X'00')"))
        conn.execute(text("INSERT INTO apihub_keys (id, upstream_id, credential_enc) VALUES (1, 1, X'00')"))
        conn.execute(text("INSERT INTO apihub_apis (id, upstream_id, name, slug, group1, group2) "
                          "VALUES (1, 1, 'GET /api/todo/tasks', 'todo-get-tasks', 'self', 'todo')"))
        conn.execute(text("INSERT INTO apihub_health_logs (api_id, source) VALUES (1, 'manual')"))
        conn.execute(text("INSERT INTO apihub_call_logs (api_id, upstream_id, mode) VALUES (1, 1, 'openapi')"))
        conn.execute(text("INSERT INTO apihub_tokens (id, name, key_hash) VALUES (1, 'doublog-self', 'h1')"))
        conn.execute(text("INSERT INTO apihub_rules (scope, api_id) VALUES ('api', 1)"))
        conn.execute(text("INSERT INTO apihub_rules (scope, token_id) VALUES ('token', 1)"))
        # 普通系统（应保留）：qq + 一条 API + key + 令牌 + api 级规则
        conn.execute(text("INSERT INTO apihub_upstreams (id, name, slug, base_url, auth_config_enc) "
                          "VALUES (2, 'QQ 机器人', 'qq', 'https://api.sgroup.qq.com', X'00')"))
        conn.execute(text("INSERT INTO apihub_keys (id, upstream_id, credential_enc) VALUES (2, 2, X'00')"))
        conn.execute(text("INSERT INTO apihub_apis (id, upstream_id, name, slug, group1) "
                          "VALUES (2, 2, 'send c2c', 'qq-send-c2c', 'qq')"))
        conn.execute(text("INSERT INTO apihub_call_logs (api_id, upstream_id, mode) VALUES (2, 2, 'invoke')"))
        conn.execute(text("INSERT INTO apihub_tokens (id, name, key_hash) VALUES (2, 'my-token', 'h2')"))
        conn.execute(text("INSERT INTO apihub_rules (scope, api_id) VALUES ('api', 2)"))
    return engine


def _run_migrations(engine):
    from app.apihub import ensure_migrations
    from app.db import _rename_legacy_tables
    _rename_legacy_tables(engine)
    ensure_migrations(engine)


class TestUpstreamToSystemMigration:
    def test_table_and_columns_renamed(self, old_engine):
        _run_migrations(old_engine)
        insp = inspect(old_engine)
        assert not insp.has_table('apihub_upstreams')
        assert insp.has_table('apihub_systems')
        for table in ('apihub_keys', 'apihub_apis', 'apihub_call_logs'):
            cols = {c['name'] for c in insp.get_columns(table)}
            assert 'system_id' in cols and 'upstream_id' not in cols, table

    def test_openapi_columns_dropped(self, old_engine):
        _run_migrations(old_engine)
        cols = {c['name'] for c in inspect(old_engine).get_columns('apihub_apis')}
        assert not cols & {'group1', 'group2', 'pub_name', 'doc_md'}

    def test_selfreg_data_purged(self, old_engine):
        _run_migrations(old_engine)
        with old_engine.connect() as conn:
            assert conn.execute(text("SELECT count() FROM apihub_systems WHERE slug='doublog'")).scalar() == 0
            assert conn.execute(text("SELECT count() FROM apihub_apis WHERE slug='todo-get-tasks'")).scalar() == 0
            assert conn.execute(text("SELECT count() FROM apihub_keys WHERE system_id=1")).scalar() == 0
            assert conn.execute(text("SELECT count() FROM apihub_health_logs")).scalar() == 0
            assert conn.execute(text("SELECT count() FROM apihub_call_logs WHERE system_id=1")).scalar() == 0
            assert conn.execute(text("SELECT count() FROM apihub_tokens WHERE name='doublog-self'")).scalar() == 0
            # 自注册的 api 级规则与 doublog-self 的 token 级规则一并清理
            assert conn.execute(text("SELECT count() FROM apihub_rules WHERE api_id=1")).scalar() == 0
            assert conn.execute(text("SELECT count() FROM apihub_rules WHERE token_id=1")).scalar() == 0

    def test_normal_data_survives(self, old_engine):
        _run_migrations(old_engine)
        with old_engine.connect() as conn:
            assert conn.execute(text("SELECT count() FROM apihub_systems WHERE slug='qq'")).scalar() == 1
            assert conn.execute(text("SELECT system_id FROM apihub_apis WHERE slug='qq-send-c2c'")).scalar() == 2
            assert conn.execute(text("SELECT count() FROM apihub_keys WHERE system_id=2")).scalar() == 1
            assert conn.execute(text("SELECT count() FROM apihub_call_logs WHERE system_id=2")).scalar() == 1
            assert conn.execute(text("SELECT count() FROM apihub_tokens WHERE name='my-token'")).scalar() == 1
            assert conn.execute(text("SELECT count() FROM apihub_rules WHERE api_id=2")).scalar() == 1

    def test_idempotent(self, old_engine):
        _run_migrations(old_engine)
        _run_migrations(old_engine)   # 二次执行不报错、不再动数据
        with old_engine.connect() as conn:
            assert conn.execute(text("SELECT count() FROM apihub_systems")).scalar() == 1
            assert conn.execute(text("SELECT count() FROM apihub_apis")).scalar() == 1

    def test_fresh_db_untouched(self, tmp_path):
        """全新库（无旧表旧列）：迁移零动作，不误删任何数据。"""
        from app.apihub import ensure_migrations
        from app.apihub import models  # noqa: F401 - 注册 apihub 表到 Base.metadata
        engine = create_engine(f'sqlite:///{tmp_path}/fresh.db')
        from app.db import Base
        Base.metadata.create_all(engine)
        ensure_migrations(engine)
        # 建一个 doublog 系统 + API —— 新库里不应被清理（清理仅对旧 schema 一次性执行）
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO apihub_systems (name, slug, base_url, auth_config_enc) "
                              "VALUES ('x', 'doublog', 'http://x', X'00')"))
            conn.execute(text("INSERT INTO apihub_apis (system_id, name, slug, description, path_tpl) "
                              "VALUES (1, 'a', 'a-1', '', '/')"))
        ensure_migrations(engine)
        with engine.connect() as conn:
            assert conn.execute(text("SELECT count() FROM apihub_systems WHERE slug='doublog'")).scalar() == 1
            assert conn.execute(text("SELECT count() FROM apihub_apis")).scalar() == 1

    def test_internal_token_bypass_removed(self, client, auth_headers):
        """内部令牌旁路已删：伪造 X-Apihub-Token 不能绕过认证。"""
        r = client.get('/api/todo/tasks', headers={'X-Apihub-Token': 'anything'})
        assert r.status_code == 401

    def test_openapi_routes_gone(self, client):
        """/openapi/** 入口已移除。"""
        assert client.get('/openapi/self/todo/x').status_code == 404
        assert client.get('/openapi/qq/send/doc').status_code == 404
