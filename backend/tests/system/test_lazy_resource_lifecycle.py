"""Main lifecycle must own resources that initialize lazily and only export stop."""
from fnmatch import fnmatch
from types import SimpleNamespace

import pytest


class TrackingRedis:
    """Small local KV double; using a closed client is a test failure."""

    def __init__(self, identity):
        self.identity = identity
        self.values = {}
        self.close_calls = 0

    def _open(self):
        assert self.close_calls == 0, 'A stopped app reused its old Redis client'

    def get(self, key):
        self._open()
        return self.values.get(key)

    def setex(self, key, ttl, value):
        self._open()
        self.values[key] = value

    def delete(self, *keys):
        self._open()
        removed = 0
        for key in keys:
            removed += key in self.values
            self.values.pop(key, None)
        return removed

    def scan_iter(self, match=None):
        self._open()
        return iter([key for key in self.values if match is None or fnmatch(key, match)])

    def ping(self):
        self._open()
        return True

    def close(self):
        self.close_calls += 1


@pytest.fixture
def redis_clients(monkeypatch):
    from app.confcenter import cache
    from app.db import current_runtime

    clients = []

    def build(config):
        client = TrackingRedis(current_runtime().identity)
        clients.append(client)
        return client

    monkeypatch.setattr(cache, 'REDIS_AVAILABLE', True)
    monkeypatch.setattr(cache, '_build_client', build)
    return clients


def _activate_confcenter(client, app, headers):
    configured = client.put('/api/confcenter/cache/config', headers=headers, json={
        'enabled': True, 'host': '127.0.0.1', 'port': 6379, 'db': 0,
        'password': '', 'ttl_seconds': 60,
    })
    assert configured.status_code == 200, configured.text
    created = client.put('/api/confcenter/lifecycle/key', headers=headers,
                         json={'type': 'json', 'data': {'identity': app.state.db_runtime.identity}})
    assert created.status_code in (200, 201), created.text
    response = client.get('/api/confcenter/lifecycle/key', headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()['data']['data'] == {'identity': app.state.db_runtime.identity}
    cache = app.state.confcenter_cache
    limiter = app.state.confcenter_ratelimit
    assert cache.client is not None and limiter is not None
    assert cache.client.identity == app.state.db_runtime.identity
    return cache, limiter, cache.client


def test_confcenter_shutdown_closes_once_and_reentry_rebuilds_state(app, auth_headers, redis_clients):
    from app.main import stop_background
    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        old_cache, old_limiter, old_client = _activate_confcenter(client, app, auth_headers)
        generation = old_cache.generation
    assert old_client.close_calls == 1
    assert old_cache.failed and old_cache.generation == generation + 1
    assert app.state.confcenter_cache is None and app.state.confcenter_ratelimit is None
    assert app.state.db_runtime.closed
    assert stop_background(app)  # Repeated cleanup does not close the same client twice.
    assert old_client.close_calls == 1

    with TestClient(app) as client:
        current_cache, current_limiter, current_client = _activate_confcenter(client, app, auth_headers)
        assert current_cache is not old_cache and current_limiter is not old_limiter
        assert current_client is not old_client and not current_client.close_calls
        assert not app.state.db_runtime.closed
        assert old_client.close_calls == 1
    assert [client.close_calls for client in redis_clients] == [1, 1]
    assert app.state.confcenter_cache is None and app.state.confcenter_ratelimit is None


def test_confcenter_switch_closes_once_and_recovery_rebuilds_state(
        app, auth_headers, redis_clients, monkeypatch):
    from app.config import settings
    from app.system import routes
    from fastapi.testclient import TestClient

    monkeypatch.setattr(settings, 'debug', False)
    # Only validation is stubbed. The real HTTP switch, fence, drain, stop and
    # atomic config publish run against the isolated app; no PG/network is used.
    monkeypatch.setattr(routes, '_ensure_postgres_database', lambda config: None)
    with TestClient(app) as client:
        old_cache, old_limiter, old_client = _activate_confcenter(client, app, auth_headers)
        switched = client.post('/api/admin/database/switch', headers=auth_headers, json={
            'target': 'postgres', 'postgres': {'host': '127.0.0.1', 'port': 9,
                'user': 'lifecycle-test', 'password': '', 'dbname': 'isolated_lazy_resource_test'},
        })
        assert switched.status_code == 200, switched.text
        assert switched.json()['data'] == {'backend': 'postgres', 'restart_required': True}
        assert app.state.db_runtime.writes_paused
        assert old_client.close_calls == 1
        assert app.state.confcenter_cache is None and app.state.confcenter_ratelimit is None
        assert client.get('/api/confcenter/lifecycle/key', headers=auth_headers).status_code == 503

        recovered = client.post('/api/admin/database/switch', headers=auth_headers,
                                json={'target': 'sqlite'})
        assert recovered.status_code == 200, recovered.text
        assert not app.state.db_runtime.writes_paused
        current_cache, current_limiter, current_client = _activate_confcenter(client, app, auth_headers)
        assert current_cache is not old_cache and current_limiter is not old_limiter
        assert current_client is not old_client and old_client.close_calls == 1
    assert [client.close_calls for client in redis_clients] == [1, 1]


def test_confcenter_shutdown_does_not_close_another_apps_client(
        app, auth_headers, redis_clients, monkeypatch, tmp_path):
    from app.config import settings
    from app.main import create_app
    from fastapi.testclient import TestClient

    other_directory = tmp_path / 'another-app'
    monkeypatch.setattr(settings, 'data_dir', str(other_directory))
    monkeypatch.setattr(settings, 'images_dir', str(other_directory / 'images'))
    other = create_app()
    assert other.state.db_runtime.identity != app.state.db_runtime.identity
    with TestClient(other) as second:
        other_cache, other_limiter, other_client = _activate_confcenter(second, other, auth_headers)
        with TestClient(app) as first:
            _, _, first_client = _activate_confcenter(first, app, auth_headers)
            assert first_client is not other_client
        assert first_client.close_calls == 1 and other_client.close_calls == 0
        assert app.state.confcenter_cache is None and app.state.confcenter_ratelimit is None
        assert other.state.confcenter_cache is other_cache
        assert other.state.confcenter_ratelimit is other_limiter
        assert second.get('/api/confcenter/lifecycle/key', headers=auth_headers).status_code == 200
        assert len(redis_clients) == 2
    assert other_client.close_calls == 1


def _hook_app(app, modules):
    return SimpleNamespace(state=SimpleNamespace(db_runtime=app.state.db_runtime,
        loaded_modules=modules, active_background=set(), background_started=False))


def test_start_registers_stop_only_and_normal_hooks_once_in_reverse_stop_order(app):
    from app.main import start_background, stop_background

    calls = []
    lazy = SimpleNamespace(stop_background=lambda app, timeout: calls.append('stop-lazy'))
    normal = SimpleNamespace(start_background=lambda app: calls.append('start-normal'),
                             stop_background=lambda app, timeout: calls.append('stop-normal'))
    current = _hook_app(app, [('lazy', lazy), ('normal', normal), ('plain', SimpleNamespace())])
    start_background(current)
    start_background(current)
    assert calls == ['start-normal']
    assert current.state.active_background == {'lazy', 'normal'}
    assert stop_background(current)
    assert stop_background(current)
    assert calls == ['start-normal', 'stop-normal', 'stop-lazy']
    assert current.state.active_background == set() and not current.state.background_started
    start_background(current)
    assert current.state.active_background == {'lazy', 'normal'}
    assert calls[-1] == 'start-normal'
    assert stop_background(current)


def test_failed_start_is_not_registered_and_can_retry_without_restarting_previous_hook(app):
    from app.main import start_background, stop_background

    calls = []

    def start(current):
        calls.append('start-normal')
        if calls.count('start-normal') == 1:
            raise RuntimeError('isolated startup failure')

    lazy = SimpleNamespace(stop_background=lambda app, timeout: calls.append('stop-lazy'))
    normal = SimpleNamespace(start_background=start,
                             stop_background=lambda app, timeout: calls.append('stop-normal'))
    current = _hook_app(app, [('lazy', lazy), ('normal', normal)])
    with pytest.raises(RuntimeError, match='startup failure'):
        start_background(current)
    assert current.state.active_background == {'lazy'}
    start_background(current)
    start_background(current)
    assert calls == ['start-normal', 'start-normal']
    assert current.state.active_background == {'lazy', 'normal'}
    assert stop_background(current)


def test_failed_stop_only_hook_remains_registered_until_retry_succeeds(app):
    from app.main import start_background, stop_background

    calls = []

    def stop(current, timeout):
        calls.append('stop-lazy')
        return calls.count('stop-lazy') > 1

    normal = SimpleNamespace(start_background=lambda app: calls.append('start-normal'),
                             stop_background=lambda app, timeout: calls.append('stop-normal'))
    current = _hook_app(app, [('normal', normal), ('lazy', SimpleNamespace(stop_background=stop))])
    start_background(current)
    assert not stop_background(current)
    assert calls == ['start-normal', 'stop-lazy', 'stop-normal']
    assert current.state.active_background == {'lazy'} and current.state.background_started
    assert stop_background(current)
    assert calls == ['start-normal', 'stop-lazy', 'stop-normal', 'stop-lazy']
    assert current.state.active_background == set() and not current.state.background_started
