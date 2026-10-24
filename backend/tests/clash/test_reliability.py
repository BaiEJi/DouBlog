import asyncio
import json
import threading
from app.shared.pools import get_pool
from types import SimpleNamespace


def test_short_operation_remains_admitted_after_http_cancel(app):
    from app.clash.routes import _isolated
    from app.db import database_context
    entered, release = threading.Event(), threading.Event()
    @_isolated
    def operation():
        entered.set()
        assert release.wait(3)
    async def check():
        with database_context(app):
            task = asyncio.create_task(operation())
            assert await asyncio.to_thread(entered.wait, 2)
            task.cancel()
            try: await task
            except asyncio.CancelledError: pass
            assert not await asyncio.to_thread(app.state.db_runtime.drain, 0.02)
            release.set()
            assert await asyncio.to_thread(app.state.db_runtime.drain, 2)
    try:
        asyncio.run(check())
    finally:
        release.set()


def test_runtime_yaml_cache_invalidates_on_replacement(fake_clashctl, monkeypatch):
    from app.clash import service, controller
    from app.shared.files import atomic_write_text
    path = fake_clashctl / 'resources' / 'runtime.yaml'
    atomic_write_text(path, 'external-controller: "127.0.0.1:1234"\nsecret: first\n')
    calls = []
    original = service.yaml.load
    def load(*args, **kwargs): calls.append(1); return original(*args, **kwargs)
    monkeypatch.setattr(service.yaml, 'load', load)
    assert controller._controller_info()[1] == 'first'
    assert controller._controller_info()[1] == 'first'
    assert len(calls) == 1
    atomic_write_text(path, 'external-controller: "127.0.0.1:1234"\nsecret: other\n')
    assert controller._controller_info()[1] == 'other'
    assert len(calls) == 2


def test_mixin_write_reports_saved_but_not_applied(fake_clashctl, monkeypatch):
    import pytest
    from app.clash import service
    from lizysdk.errors import ParamError
    monkeypatch.setattr(service, 'run_clashctl', lambda *args, **kwargs: (1, 'fixture apply failed'))
    with pytest.raises(ParamError) as error:
        service.config_write_mixin('mode: rule\n')
    assert '配置已保存' in str(error.value)
    assert (fake_clashctl / 'resources' / 'mixin.yaml').read_text(encoding='utf-8') == 'mode: rule\n'


def test_mutating_operations_are_serialized(fake_clashctl, monkeypatch):
    from app.clash import service
    entered, release = threading.Event(), threading.Event()
    active = []
    def execute(*args, **kwargs):
        active.append(args[0])
        entered.set()
        assert release.wait(2)
        return 0, 'fixture ok'
    monkeypatch.setattr(service, 'run_clashctl', execute)
    pool = get_pool('test-clash-serialized', workers=2)
    first = pool.submit(service.kernel_start)
    assert entered.wait(1)
    second = pool.submit(service.kernel_stop)
    assert len(active) == 1
    release.set()
    first.result(); second.result()
    assert active == ['clashon', 'clashoff']


def test_native_stream_handshake_authentication_and_cleanup(app, monkeypatch):
    from websockets.sync.server import serve
    from app.clash import events, service, controller
    entered = threading.Event()
    def handler(socket):
        assert socket.request.headers['Authorization'] == 'Bearer fixture-secret'
        assert socket.request.path == '/connections?interval=2000'
        socket.send(json.dumps({'uploadTotal': 3, 'downloadTotal': 7, 'connections': []}))
        entered.set()
        try: socket.recv(timeout=2)
        except Exception: pass
    with serve(handler, '127.0.0.1', 0) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.socket.getsockname()[1]
        monkeypatch.setattr(service, 'ensure_available', lambda: None)
        monkeypatch.setattr(controller, '_controller_info', lambda: (f'http://127.0.0.1:{port}', 'fixture-secret', ''))
        async def disconnected(): return False
        request = SimpleNamespace(app=app, is_disconnected=disconnected)
        async def check():
            response = events.connection_events(request)
            mode = await response.body_iterator.__anext__()
            data = await response.body_iterator.__anext__()
            assert '"websocket"' in mode
            assert '"uploadTotal":3' in data
            await response.body_iterator.aclose()
        asyncio.run(check())
        assert entered.wait(1)
        # all subscriber slots returned after disconnect
        slots = app.state.clash_stream_slots
        for _ in range(8): assert slots.acquire(blocking=False)
        assert not slots.acquire(blocking=False)
        for _ in range(8): slots.release()
        server.shutdown()
        thread.join(2)


def test_stream_capability_failure_uses_rest_fallback_and_stops(app, monkeypatch):
    from app.clash import events, service, controller
    monkeypatch.setattr(service, 'ensure_available', lambda: None)
    monkeypatch.setattr(controller, '_controller_info', lambda: (_ for _ in ()).throw(OSError('no WS')))
    monkeypatch.setattr(controller, 'connections_get', lambda: {'uploadTotal': 2, 'downloadTotal': 1, 'connections': []})
    async def disconnected(): return False
    request = SimpleNamespace(app=app, is_disconnected=disconnected)
    async def check():
        response = events.connection_events(request)
        assert '"polling"' in await response.body_iterator.__anext__()
        assert '"uploadTotal":2' in await response.body_iterator.__anext__()
        events.stop_background(app)
        try:
            await response.body_iterator.__anext__()
        except StopAsyncIteration:
            pass
        else:
            raise AssertionError('stop must finish stream')
    asyncio.run(check())
