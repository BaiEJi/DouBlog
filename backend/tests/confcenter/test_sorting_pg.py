"""entries 排序在真实临时 PostgreSQL 上复核（B3）。

复用 test_optimized_queries_pg.py 的生命周期方式：pgserver 临时本机数据目录
+ 独立数据库，经 /api/admin/database/switch 切换后 create_app 出 PG 实例；
不访问业务 PostgreSQL。证明排序 SQL（COLLATE "C"、NULLS LAST、稳定兜底）
不会仅在 SQLite 语法下成立。
"""
import base64
from datetime import datetime

import pytest

AUTH = {'Authorization': 'Basic ' + base64.b64encode(b"admin:lizy111A").decode()}


def _entries(pg_client, **params):
    import urllib.parse
    r = pg_client.get('/api/confcenter/entries?' + urllib.parse.urlencode(params),
                      headers=AUTH)
    assert r.status_code == 200, r.text
    return r.json()['data']


def test_entries_sorting_on_real_postgres(client, app, auth_headers, tmp_path_factory, monkeypatch):
    pgserver = pytest.importorskip('pgserver', reason='pgserver is required for real PostgreSQL validation')
    from sqlalchemy.engine import make_url
    from sqlalchemy.orm import Session
    from fastapi.testclient import TestClient
    from app.config import settings
    from app.db import database_context, db
    from app.main import create_app

    monkeypatch.setattr(settings, 'debug', False)  # 切换用 restart_required，不触发 reload
    assert app.state.engine.dialect.name == 'sqlite'
    pgdata = tmp_path_factory.mktemp('confcenter-sorting-pgdata')
    server = pgserver.get_server(str(pgdata))
    pg_app = None
    database_name = 'doublog_confcenter_sorting_test'
    try:
        local_uri = make_url(server.get_uri())
        assert local_uri.host in ('127.0.0.1', 'localhost') and local_uri.port
        target = {'host': '127.0.0.1', 'port': local_uri.port, 'user': 'postgres',
                  'password': '', 'dbname': database_name}
        switched = client.post('/api/admin/database/switch', headers=auth_headers,
                               json={'target': 'postgres', 'postgres': target})
        assert switched.status_code == 200, switched.text

        pg_app = create_app()
        with TestClient(pg_app) as pg_client:
            engine = pg_app.state.engine
            assert engine.dialect.name == 'postgresql'
            assert engine.url.host == '127.0.0.1' and engine.url.port == local_uri.port

            # 直插：相同 type/data/updated_at 的兜底样本 + NULL updated_at + 中文/多行。
            # executemany 字典参数与 ORM 都会把 None 当“未设置”套 server_default，
            # 造不出 NULL 样本——逐行 .values(updated_at=None) 显式绑定 NULL。
            from app.confcenter.models import ConfEntry, ConfNamespace
            from sqlalchemy import insert
            same = datetime(2026, 5, 5, 5, 5, 5)
            rows = [
                ('ns-a', 'k-001', 'str', 'same-value', same),
                ('ns-b', 'k-002', 'str', 'same-value', same),
                ('ns-c', 'k-003', 'json', '{"a":1}', same),
                ('ns-a', 'k-null', 'str', 'zzz', None),
                ('ns-a', 'k-new', 'str', '中文值', datetime(2026, 6, 1)),
                ('ns-b', 'k-old', 'str', 'Zebra', datetime(2026, 1, 1)),
                ('ns-a', 'k-mid', 'str', 'a\nb', datetime(2026, 3, 1)),
            ]
            with database_context(pg_app), Session(engine) as session:
                for ns in {r[0] for r in rows}:
                    session.execute(insert(ConfNamespace).values(namespace=ns))
                for ns, k, t, d, u in rows:
                    session.execute(insert(ConfEntry).values(
                        namespace=ns, key=k, type=t, data=d, updated_at=u))
                session.commit()

            keys = lambda d: [(i['namespace'], i['key']) for i in d['items']]

            # key asc/desc（主列即 key，兜底只补 namespace）；
            # C collation 字节序：'001'<'002'<'003'<'mid'<'new'<'null'<'old'
            assert keys(_entries(pg_client, sort_by='key')) == [
                ('ns-a', 'k-001'), ('ns-b', 'k-002'), ('ns-c', 'k-003'),
                ('ns-a', 'k-mid'), ('ns-a', 'k-new'), ('ns-a', 'k-null'),
                ('ns-b', 'k-old')]
            assert keys(_entries(pg_client, sort_by='key', sort_order='desc')) == [
                ('ns-b', 'k-old'), ('ns-a', 'k-null'), ('ns-a', 'k-new'),
                ('ns-a', 'k-mid'), ('ns-c', 'k-003'), ('ns-b', 'k-002'),
                ('ns-a', 'k-001')]

            # type：json < str；同 type 按 namespace,key 兜底
            assert keys(_entries(pg_client, sort_by='type')) == [
                ('ns-c', 'k-003'),
                ('ns-a', 'k-001'), ('ns-a', 'k-mid'), ('ns-a', 'k-new'),
                ('ns-a', 'k-null'), ('ns-b', 'k-002'), ('ns-b', 'k-old')]

            # data 按存储文本 C collation 字节序：
            # 'Zebra'(0x5A) < 'a\nb'(0x61) < 'same-value'×2(0x73) < 'zzz'(0x7A)
            # < '{"a":1}'(0x7B) < '中文值'(0xE4..)
            assert keys(_entries(pg_client, sort_by='data')) == [
                ('ns-b', 'k-old'), ('ns-a', 'k-mid'),
                ('ns-a', 'k-001'), ('ns-b', 'k-002'),
                ('ns-a', 'k-null'), ('ns-c', 'k-003'), ('ns-a', 'k-new')]

            # updated_at 双方向 NULLS LAST；desc 首位最新，同刻按 namespace,key 兜底
            assert keys(_entries(pg_client, sort_by='updated_at'))[-1] == ('ns-a', 'k-null')
            desc_time = keys(_entries(pg_client, sort_by='updated_at', sort_order='desc'))
            assert desc_time[0:2] == [('ns-a', 'k-new'), ('ns-a', 'k-001')]
            assert desc_time[-1] == ('ns-a', 'k-null')

            # 未传参数旧顺序不变；非法参数 400（在 PG 方言路径下同样生效）
            assert keys(_entries(pg_client)) == sorted(keys(_entries(pg_client)))
            r = pg_client.get('/api/confcenter/entries',
                              params={'sort_by': 'namespace'}, headers=AUTH)
            assert r.status_code == 400

            # 分页 + 排序：page_size=3 两页无重漏
            seen = [x for page in (1, 2, 3)
                    for x in keys(_entries(pg_client, page=page, page_size=3, sort_by='data'))]
            assert len(seen) == 7 and len(set(seen)) == 7
    finally:
        from app.main import stop_background
        try:
            if pg_app is not None:
                stop_background(pg_app)
                pg_app.state.engine.dispose()
        finally:
            server.cleanup()
