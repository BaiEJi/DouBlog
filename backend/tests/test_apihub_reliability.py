"""Gateway quotas, retry safety, lifecycle, and candidate transport contracts."""
import queue
import threading
from app.shared.pools import get_pool

from app.apihub.state import Store


def test_quota_reservations_are_atomic_and_reset_rejects_old_refund():
    store = Store()
    token = {'id': 7, 'quota_used': 0, 'quota_total': 7}
    pool = get_pool('test-apihub-quota', workers=32)
    tickets = []
    for offset in range(0, 1000, 32):
        futures = [pool.submit(store.reserve, token) for _ in range(min(32, 1000-offset))]
        tickets.extend(future.result() for future in futures)
    valid = [ticket for ticket in tickets if ticket is not None]
    assert len(valid) == 7
    assert store.remaining(token) == 0
    store.refund(valid[0])
    assert store.remaining(token) == 1
    with store.lock:
        store.reset_quota(7)
    store.refund(valid[1])
    assert store.quota_used[7] == store.quota_pending[7] == 0


def test_reload_preserves_unpersisted_quota_and_writer_is_independent_of_logs(app, monkeypatch):
    from app.apihub.state import get_state
    from app.apihub.models import ApihubToken
    from app.db import db
    token_row = ApihubToken(name='quota', key_hash='quota-fixture', key_hint='test', quota_total=5)
    db.session.add(token_row); db.session.commit()
    state = get_state(app)
    token = state.store.tokens['quota-fixture']
    state.store.reserve(token)
    state.store.reserve(token)
    state.reload()
    assert state.store.quota_used[token['id']] == 2
    writer = state.writer
    writer.q = queue.Queue(maxsize=1)
    original = writer.ensure_started
    monkeypatch.setattr(writer, 'ensure_started', lambda: None)
    writer.log(mode='invoke', method='GET', path_digest='first', ok=True)
    writer.log(mode='invoke', method='GET', path_digest='dropped', ok=True)
    assert writer.dropped == 1
    monkeypatch.setattr(writer, 'ensure_started', original)
    assert writer.flush(4)
    db.session.expire_all()
    assert db.session.get(ApihubToken, token['id']).quota_used == 2
    assert writer.stop(3)


def test_post_timeout_is_never_retried(client, auth_headers, app, monkeypatch):
    from tests.test_apihub_api import _setup_env
    from app.apihub.state import get_state
    from app.apihub.pool import UpstreamTimeout
    _, _, key = _setup_env(client, auth_headers, 'http://127.0.0.1:1', slug_suffix='retry', method='POST')
    state = get_state(app)
    calls = []
    def timeout(*args, **kwargs):
        calls.append(args)
        raise UpstreamTimeout('ambiguous remote result')
    monkeypatch.setattr(state.pool, 'request', timeout)
    response = client.post('/api/apihub/gw/apis/a-retry', headers={'Authorization': f'Bearer {key}'}, json={'body': {'side_effect': True}})
    assert response.status_code == 504
    assert len(calls) == 1


def test_post_stale_keepalive_is_not_replayed(monkeypatch):
    import http.client
    from app.apihub.pool import _Target, _Conn
    target = _Target('http', '127.0.0.1', 1, None)
    class FakeConn:
        def close(self): pass
    target._release(_Conn(FakeConn()))
    calls = []
    def failed(*args):
        calls.append(1)
        raise http.client.RemoteDisconnected('response lost after remote commit')
    monkeypatch.setattr(target, '_roundtrip', failed)
    monkeypatch.setattr(target, '_connect', lambda _: (_ for _ in ()).throw(AssertionError('must not reconnect POST')))
    try:
        target.request('POST', '/', {}, b'{}', 0.1)
    except http.client.RemoteDisconnected:
        pass
    else:
        raise AssertionError('ambiguous result must be visible to caller')
    assert len(calls) == 1


def test_both_transports_real_local_echo_contract(system_base, app):
    from app.apihub.pool import UpstreamPool, HttpxCandidatePool
    import json
    for cls in (UpstreamPool, HttpxCandidatePool):
        transport = cls()
        try:
            response = transport.request('POST', system_base + '/echo', {'Content-Type': 'application/json'}, {'中文': 'value'}, b'{"ok":true}', 2)
            assert response.status == 200
            data = json.loads(response.content)
            assert data['body'] == {'ok': True}
            assert data['query'] == {'中文': 'value'}
        finally:
            transport.close_all()


def test_token_exchange_single_flight_and_credential_rotation():
    import json
    from app.apihub.core import TokenExchanger
    from app.apihub.pool import FastResp
    entered, release = threading.Event(), threading.Event()
    calls = []
    class Pool:
        def request(self, method, url, headers, params, payload, timeout):
            calls.append(json.loads(payload))
            entered.set()
            assert release.wait(2)
            return FastResp(200, json.dumps({'access_token': 'token-' + str(len(calls)), 'expires_in': 60}).encode(), {})
    exchanger = TokenExchanger()
    credential = {'app_id': 'fixture', 'app_secret': 'one'}
    pool = get_pool('test-apihub-exchanger', workers=8)
    futures = [pool.submit(exchanger.get, Pool(), {}, credential) for _ in range(8)]
    assert entered.wait(1)
    release.set()
    results = [future.result() for future in futures]
    assert len(calls) == 1 and len(set(results)) == 1
    assert exchanger.get(Pool(), {}, {**credential, 'app_secret': 'two'}) == 'token-2'
    assert len(calls) == 2


from tests.test_apihub_api import system_base  # noqa: E402,F401 - shared local HTTP fixture


def test_auth_cache_is_isolated_between_apps():
    from types import SimpleNamespace
    from app.apihub.routes import _authenticate
    from app.apihub.core import hash_token
    plain = 'sk-isolation-fixture'
    first, second = Store(), Store()
    first.tokens[hash_token(plain)] = {'id': 1, 'status': 1, 'expires_at': None}
    first.version = second.version = 3
    def request(store):
        return SimpleNamespace(headers={'Authorization': 'Bearer ' + plain},
            app=SimpleNamespace(state=SimpleNamespace(apihub=SimpleNamespace(store=store))))
    assert _authenticate(request(first))['id'] == 1
    assert _authenticate(request(second)) is None


def test_total_deadline_stops_slow_body_and_headers(app):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from app.apihub.pool import UpstreamPool, UpstreamTimeout
    import time
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_GET(self):
            try:
                if self.path == '/headers':
                    for chunk in (b'HTTP/1.1 200 OK\r\n', b'X-One: 1\r\n', b'X-Two: 2\r\n',
                                  b'X-Three: 3\r\n', b'Content-Length: 0\r\n\r\n'):
                        self.wfile.write(chunk); self.wfile.flush(); time.sleep(0.08)
                else:
                    self.send_response(200); self.send_header('Content-Length', '5'); self.end_headers()
                    for _ in range(5):
                        self.wfile.write(b'x'); self.wfile.flush(); time.sleep(0.08)
            except OSError:
                pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    transport = UpstreamPool()
    try:
        for path in ('/body', '/headers'):
            start = time.monotonic()
            try:
                transport.request('GET', f'http://127.0.0.1:{server.server_address[1]}{path}', {}, {}, b'', 0.18)
            except UpstreamTimeout:
                pass
            else:
                raise AssertionError('slow trickle must not extend the total deadline')
            assert time.monotonic() - start < 0.35
    finally:
        transport.close_all(); server.shutdown(); server.server_close(); thread.join(2)
