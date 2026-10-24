"""System-wide invariants: durability, database affinity and stale writes."""
import asyncio
import json
import threading

import pytest


def test_layout_cas_idempotency_and_reset_barrier(client, auth_headers):
    url = '/api/home/layout'
    empty = client.get(url, headers=auth_headers).json()['data']
    body = {'groups': [{'name': '新组', 'cards': [{'key': 'blog'}]}],
            'revision': empty['revision'], 'mutation_id': 'layout-first'}
    saved = client.put(url, json=body, headers=auth_headers)
    assert saved.status_code == 200
    assert client.put(url, json=body, headers=auth_headers).json() == saved.json()
    assert client.put(url, json={**body, 'groups': [{'name': '其他', 'cards': []}]},
                      headers=auth_headers).status_code == 409
    reset = client.request('DELETE', url, json={'revision': saved.json()['data']['revision'],
                                               'mutation_id': 'layout-reset'}, headers=auth_headers)
    assert reset.status_code == 200
    assert reset.json()['data']['groups'] == []
    stale = {**body, 'revision': saved.json()['data']['revision'], 'mutation_id': 'stale-after-reset'}
    assert client.put(url, json=stale, headers=auth_headers).status_code == 409
    assert client.get(url, headers=auth_headers).json()['data'] == reset.json()['data']


def test_two_apps_keep_database_and_cache_affinity(app, client, auth_headers, tmp_path, monkeypatch):
    from app.config import settings
    from app.main import create_app
    from fastapi.testclient import TestClient
    original = {'groups': [{'name': '原数据库', 'cards': []}]}
    assert client.put('/api/home/layout', json=original, headers=auth_headers).status_code == 200
    first_identity = client.get('/api/auth/check', headers=auth_headers).json()['data']['database_identity']
    monkeypatch.setattr(settings, 'data_dir', str(tmp_path / 'other-app'))
    monkeypatch.setattr(settings, 'images_dir', str(tmp_path / 'other-app' / 'images'))
    other = create_app()
    with TestClient(other) as second:
        assert second.get('/api/home/layout', headers=auth_headers).json()['data']['groups'] == []
        second_identity = second.get('/api/auth/check', headers=auth_headers).json()['data']['database_identity']
        assert first_identity != second_identity
        stale_headers = {**auth_headers, 'X-Expected-Database-Identity': first_identity}
        rejected = second.put('/api/home/layout', json=original, headers=stale_headers)
        assert rejected.status_code == 409
        assert rejected.json()['data']['error_code'] == 'DATABASE_CHANGED'
        assert second.get('/api/home/layout', headers=auth_headers).json()['data']['groups'] == []
        assert second.get('/api/home/layout', headers=stale_headers).status_code == 409
        assert second.get('/api/auth/check', headers=stale_headers).status_code == 200
        assert client.get('/api/home/layout', headers=auth_headers).json()['data']['groups'][0]['name'] == '原数据库'
        assert client.get('/api/admin/database', headers=auth_headers).json()['data']['data_dir'] == app.state.db_runtime.data_dir
    # Disposing the second app must not close the first app or shared SDK pools.
    assert client.get('/api/home/layout', headers=auth_headers).status_code == 200


def test_run_db_cancellation_cleans_admission(app, monkeypatch):
    from app.db import database_context, run_db
    from app.shared import pools
    queue = pools.get_pool('test-runtime-cancellation', workers=1)
    monkeypatch.setattr(pools, 'DB_POOL', queue)
    gate = threading.Event()
    entered = threading.Event()
    def block():
        entered.set()
        gate.wait(3)
    async def exercise():
        with database_context(app):
            first = asyncio.create_task(run_db(block))
            for _ in range(100):
                if entered.is_set():
                    break
                await asyncio.sleep(.01)
            assert entered.is_set()
            second = asyncio.create_task(run_db(lambda: pytest.fail('Cancelled queued task ran')))
            await asyncio.sleep(.01)
            second.cancel()
            with pytest.raises(asyncio.CancelledError):
                await second
            assert app.state.db_runtime.pending == 1
            gate.set()
            await first
    try:
        asyncio.run(exercise())
    finally:
        gate.set()
    assert app.state.db_runtime.pending == 0


def test_atomic_file_failure_preserves_previous(tmp_path, monkeypatch):
    from app.shared.files import atomic_write_json
    import app.shared.files as files
    path = tmp_path / 'config.json'
    atomic_write_json(path, {'old': True})
    with pytest.raises(ValueError):
        atomic_write_json(path, {'invalid': float('nan')})
    assert json.loads(path.read_text(encoding='utf-8')) == {'old': True}
    def fail(*args):
        raise OSError('simulated disk failure')
    monkeypatch.setattr(files.os, 'replace', fail)
    with pytest.raises(OSError):
        atomic_write_json(path, {'new': True})
    assert json.loads(path.read_text(encoding='utf-8')) == {'old': True}
    assert list(tmp_path.glob('*.tmp')) == []


def test_failed_database_drain_does_not_publish_config(app, client, auth_headers, monkeypatch):
    import app.main as main
    from app.db import db_config_path
    from app.shared.files import atomic_write_json
    from pathlib import Path
    path = Path(app.state.db_runtime.data_dir) / 'db_config.json'
    # Stored target PG, running SQLite: switching back requires no remote service.
    stored = {'backend': 'postgres', 'postgres': {}}
    atomic_write_json(path, stored)
    monkeypatch.setattr(main, 'drain_background', lambda *a, **kw: False)
    response = client.post('/api/admin/database/switch', json={'target': 'sqlite'}, headers=auth_headers)
    assert response.status_code == 503
    assert json.loads(path.read_text(encoding='utf-8')) == stored
    assert not app.state.db_runtime.writes_paused


def test_lifespan_reentry_keeps_pool_usable(app, auth_headers):
    from fastapi.testclient import TestClient
    for _ in range(2):
        with TestClient(app) as current:
            assert current.get('/ready', headers=auth_headers).status_code == 200
            assert current.get('/api/home/layout', headers=auth_headers).status_code == 200
    assert app.state.db_runtime.closed


def test_failed_background_stop_keeps_service_fenced(app, client, auth_headers, monkeypatch):
    import app.main as main
    from app.shared.files import atomic_write_json
    from pathlib import Path
    path = Path(app.state.db_runtime.data_dir) / 'db_config.json'
    stored = {'backend': 'postgres', 'postgres': {}}
    atomic_write_json(path, stored)
    monkeypatch.setattr(main, 'stop_background', lambda *a, **kw: False)
    response = client.post('/api/admin/database/switch', json={'target': 'sqlite'}, headers=auth_headers)
    assert response.status_code == 503
    assert json.loads(path.read_text(encoding='utf-8')) == stored
    assert app.state.db_runtime.writes_paused
    assert client.put('/api/home/layout', json={'groups': [{'name': 'blocked', 'cards': []}]},
                      headers=auth_headers).status_code == 503
    assert client.get('/ready', headers=auth_headers).status_code == 503
    assert client.get('/api/admin/database', headers=auth_headers).status_code == 200


def test_auth_store_failure_never_falls_back_to_default_password(app, client, monkeypatch):
    import sqlalchemy.orm
    def unavailable(*args, **kwargs):
        raise RuntimeError('simulated account store outage')
    monkeypatch.setattr(sqlalchemy.orm, 'Session', unavailable)
    response = client.post('/api/auth/login', json={'username': 'admin', 'password': 'lizy111A'})
    assert response.status_code == 503
    assert 'doublog_session' not in response.headers.get('set-cookie', '')


def test_nested_app_creation_ignores_callers_database_binding(app, tmp_path, monkeypatch):
    from app.config import settings
    from app.db import database_context, current_runtime, db
    from app.main import create_app, stop_background
    from app.system import ensure_migrations as original_migration
    import app.system as system
    directory = tmp_path / 'nested-app'
    observed = []
    def migration(engine):
        observed.append(db.engine is engine and current_runtime().data_dir == str(directory))
        original_migration(engine)
    monkeypatch.setattr(system, 'ensure_migrations', migration)
    monkeypatch.setattr(settings, 'data_dir', str(directory))
    monkeypatch.setattr(settings, 'images_dir', str(directory / 'images'))
    with database_context(app):
        other = create_app()
        assert current_runtime() is app.state.db_runtime
    try:
        assert observed == [True]
        assert other.state.engine.url.database.replace('\\', '/').endswith('/nested-app/blog.db')
        assert other.state.db_runtime.identity != app.state.db_runtime.identity
        assert other.state.db_runtime.data_dir == str(directory)
    finally:
        stop_background(other)
        other.state.engine.dispose()


def test_cancelled_gateway_finishes_refund_and_log_before_writer_stops(app, monkeypatch):
    import app.main as main
    from app.apihub.routes import _run_gw
    from app.apihub.state import get_state
    from app.apihub.models import ApihubCallLog, ApihubToken
    from app.db import database_context, db
    from sqlalchemy import select, func
    entered, release = threading.Event(), threading.Event()
    events = []
    with database_context(app):
        token = ApihubToken(name='late-producer', key_hash='late-producer', key_hint='fixture', quota_total=2)
        db.session.add(token); db.session.commit()
        token_id = token.id
        state = get_state(app)
    writer_stop = state.writer.stop
    def stop(timeout=5):
        events.append('writer-stop')
        return writer_stop(timeout)
    monkeypatch.setattr(state.writer, 'stop', stop)
    dispose = app.state.engine.dispose
    def dispose_after_producer():
        events.append('dispose')
        dispose()
    monkeypatch.setattr(app.state.engine, 'dispose', dispose_after_producer)
    def produce():
        ticket = state.store.reserve(state.store.tokens['late-producer'])
        entered.set()
        assert release.wait(5)
        state.store.refund(ticket)
        state.writer.log(token_id=token_id, mode='invoke', method='GET', path_digest='late-producer', ok=False)
        events.append('produced')
    async def exercise():
        lifetime = main.app_lifespan(app)
        await lifetime.__aenter__()
        with database_context(app):
            task = asyncio.create_task(_run_gw(produce))
            assert await asyncio.to_thread(entered.wait, 2)
            # Persist the reservation first, so the late refund is required to
            # restore the durable quota, rather than merely cancelling in RAM.
            assert await asyncio.to_thread(state.writer.flush, 3)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            closing = asyncio.create_task(lifetime.__aexit__(None, None, None))
            for _ in range(100):
                if app.state.db_runtime.admissions_paused:
                    break
                await asyncio.sleep(.01)
            assert app.state.db_runtime.admissions_paused
            assert 'writer-stop' not in events and 'dispose' not in events
            release.set()
            await closing
    try:
        asyncio.run(exercise())
    finally:
        release.set()
    assert events.index('produced') < events.index('writer-stop') < events.index('dispose')
    assert app.state.db_runtime.closed and app.state.shutdown_error is None
    with app.state.engine.connect() as connection:
        assert connection.execute(select(ApihubToken.quota_used).where(ApihubToken.id == token_id)).scalar() == 0
        assert connection.execute(select(func.count()).select_from(ApihubCallLog).where(
            ApihubCallLog.path_digest == 'late-producer')).scalar() == 1


def test_shutdown_timeout_keeps_resources_and_reentry_recovers(app, monkeypatch):
    import app.main as main
    runtime = app.state.db_runtime
    stopped, disposed = [], []
    original_stop, original_dispose = main.stop_background, runtime.engine.dispose
    def stop(*args, **kwargs):
        stopped.append(True)
        return original_stop(*args, **kwargs)
    def dispose():
        disposed.append(True)
        return original_dispose()
    monkeypatch.setattr(main, 'stop_background', stop)
    monkeypatch.setattr(runtime.engine, 'dispose', dispose)
    runtime.admit(write=True)
    assert not main._stop_app_resources(app, timeout=.02)
    assert not stopped and not disposed
    assert runtime.admissions_paused and not runtime.closed and not app.state.ready
    assert app.state.shutdown_error.startswith('inflight:')
    with pytest.raises(Exception):
        runtime.admit(write=True)
    runtime.release(write=True)
    main._enter_lifespan(app)
    assert app.state.ready and app.state.shutdown_error is None
    assert not runtime.admissions_paused and not runtime.closed
    main._leave_lifespan(app)
    assert runtime.closed and len(disposed) == 2


@pytest.mark.parametrize('module', ['test-cancelled-file-write', 'system-config'])
def test_run_blocking_tickets_survive_cancel_and_controls_do_not_self_wait(app, module):
    from app.db import database_context
    from app.shared.pools import run_blocking
    entered, release = threading.Event(), threading.Event()
    runtime = app.state.db_runtime
    if module == 'system-config':
        runtime.writes_paused = True
    def work():
        entered.set()
        assert release.wait(3)
    async def exercise():
        with database_context(app):
            task = asyncio.create_task(run_blocking(module, work, workers=1))
            assert await asyncio.to_thread(entered.wait, 2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            if module == 'system-config':
                assert runtime.pending_controls == 1 and runtime.pending == 0
                assert runtime.drain(.01), 'switch excludes its own control ticket'
            else:
                assert runtime.pending == 1
            assert not runtime.drain(.01, include_controls=True)
            release.set()
            assert await asyncio.to_thread(runtime.drain, 2, include_controls=True)
    try:
        asyncio.run(exercise())
    finally:
        release.set()
        runtime.writes_paused = False
    assert runtime.pending == runtime.pending_controls == 0


def test_basic_auth_recovery_routes_work_while_switch_is_pending(app, client, auth_headers, monkeypatch):
    from app.shared.files import atomic_write_json
    from pathlib import Path
    from app.config import settings
    monkeypatch.setattr(settings, 'debug', False)
    directory = Path(app.state.db_runtime.data_dir)
    # A successful prior switch stored PG but this process still runs SQLite.
    atomic_write_json(directory / 'db_config.json', {'backend': 'postgres', 'postgres': {}})
    app.state.db_runtime.writes_paused = True
    assert client.post('/api/auth/login', headers=auth_headers).status_code == 200
    client.cookies.clear()  # Recovery must also work without a session cookie.
    response = client.post('/api/admin/database/switch', headers=auth_headers, json={'target': 'sqlite'})
    assert response.status_code == 200, response.json()
    assert not app.state.db_runtime.writes_paused
    assert client.get('/ready', headers=auth_headers).status_code == 200


def test_slow_log_body_cannot_recreate_writer_after_switch_drain(app, tmp_path, monkeypatch):
    import httpx
    from pathlib import Path
    from app.db import database_context
    from app.shared.files import atomic_write_json
    from app.shared.pools import run_blocking
    from app.system.routes import _database_switch_sync
    directory = Path(app.state.db_runtime.data_dir)
    stored = {'backend': 'postgres', 'postgres': {}}
    atomic_write_json(directory / 'db_config.json', stored)
    runtime = app.state.db_runtime
    drain = runtime.drain
    monkeypatch.setattr(runtime, 'drain', lambda timeout=5, **kwargs: drain(min(timeout, .05), **kwargs))
    async def exercise():
        entered, release = asyncio.Event(), asyncio.Event()
        async def body():
            entered.set()
            await release.wait()
            yield b'[{"level":"INFO","message":"slow-body","sys_name":"lifecycle-test"}]'
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://isolated') as client:
            ingest = asyncio.create_task(client.post('/api/v1/logs/batch', content=body(),
                headers={'Content-Type': 'application/json'}))
            await entered.wait()
            assert runtime.pending == 1
            with database_context(app):
                switched = await run_blocking('system-config', _database_switch_sync, {'target': 'sqlite'}, app, workers=2)
            assert switched.status_code == 503
            assert json.loads((directory / 'db_config.json').read_text(encoding='utf-8')) == stored
            assert not runtime.writes_paused
            assert getattr(app.state, 'sdklogs_pipeline', None) is None
            release.set()
            assert (await ingest).status_code == 202
            pipeline = app.state.sdklogs_pipeline
            assert await asyncio.to_thread(pipeline.flush, 3)
            assert await asyncio.to_thread(pipeline.stop, 2)
            app.state.sdklogs_pipeline = None
    asyncio.run(exercise())
