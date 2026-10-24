import threading
import time
from app.shared.pools import get_pool
import pytest

from tests.steamidler.test_steamidler import FakeAttempt, seed_account


def test_completion_failure_can_retry_without_false_success(client, app, monkeypatch):
    from app.steamidler.manager import get_manager
    manager = get_manager(app)
    attempt = FakeAttempt(state='success', steamid='76561198000000001', tokens={'refresh_token': 'r', 'access_token': 'a'})
    manager.attempts[attempt.id] = attempt
    calls = []
    def complete(value):
        calls.append(value)
        if len(calls) == 1:
            raise OSError('isolated write failure')
        return {'steamid': value.steamid, 'account_name': value.username}
    monkeypatch.setattr(manager, 'maybe_complete', complete)
    first = client.get('/api/steamidler/login/status', params={'attempt_id': attempt.id}).json()['data']
    assert first['state'] != 'success'
    assert attempt.id not in manager._completed_attempts
    second = client.get('/api/steamidler/login/status', params={'attempt_id': attempt.id}).json()['data']
    third = client.get('/api/steamidler/login/status', params={'attempt_id': attempt.id}).json()['data']
    assert second['account'] == third['account']
    assert second['state'] == 'success' and len(calls) == 2


def test_concurrent_completion_executes_once(app, monkeypatch):
    from app.steamidler.manager import get_manager
    manager = get_manager(app)
    attempt = FakeAttempt(state='success')
    entered, release = threading.Event(), threading.Event()
    calls = []
    def complete(value):
        calls.append(value)
        entered.set()
        assert release.wait(2)
        return {'steamid': '1', 'account_name': 'fixture'}
    monkeypatch.setattr(manager, 'maybe_complete', complete)
    pool = get_pool('test-steam-completion', workers=8)
    futures = [pool.submit(manager.complete_login, attempt) for _ in range(8)]
    assert entered.wait(1)
    release.set()
    result = [future.result() for future in futures]
    assert len(calls) == 1
    assert all(value == result[0] for value in result)


def test_worker_start_is_unique_and_stop_has_total_deadline(app, monkeypatch):
    from app.steamidler import manager as module
    manager = module.get_manager(app)
    account = seed_account(manager.db)
    started = []
    class Worker:
        def __init__(self, *args, **kwargs): self.alive = False
        def start(self): self.alive = True; started.append(self)
        def stop(self, remove=False): self.alive = False
        def join(self, timeout=None): pass
        def is_alive(self): return self.alive
    monkeypatch.setattr(module, 'AccountWorker', Worker)
    pool = get_pool('test-steam-start', workers=12)
    futures = [pool.submit(manager._start_worker_for, account) for _ in range(24)]
    [future.result() for future in futures]
    assert len(started) == 1
    assert manager.shutdown(0.1)


@pytest.mark.parametrize('action', ['_start_worker_for', '_restart_worker_for'])
def test_failed_thread_start_is_not_published_and_can_retry(app, monkeypatch, action):
    from app.steamidler import manager as module
    manager = module.get_manager(app)
    account = seed_account(manager.db)
    starts = []
    class Worker(threading.Thread):
        def __init__(self, *args, **kwargs):
            super().__init__(daemon=True)
            self.release = threading.Event()
        def start(self):
            starts.append(self)
            if len(starts) == 1:
                raise RuntimeError('isolated cannot start thread')
            super().start()
        def run(self): self.release.wait(3)
        def stop(self, remove=False): self.release.set()
    monkeypatch.setattr(module, 'AccountWorker', Worker)
    operation = getattr(manager, action)
    with pytest.raises(RuntimeError, match='cannot start'):
        operation(account)
    assert account['steamid'] not in manager.workers
    try:
        operation(account)
        assert manager.workers[account['steamid']].is_alive()
    finally:
        assert manager.shutdown(1)


def test_old_attempts_are_pruned_without_polling_each_id(app):
    from app.steamidler.manager import get_manager
    manager = get_manager(app)
    old = FakeAttempt(state='pending')
    old.created_at = time.time() - 601
    manager.attempts[old.id] = old
    manager._prune_attempts()
    assert not manager.attempts
    assert old.state == 'failed'


def test_snapshot_query_excludes_large_and_secret_columns(client, app):
    from app.db import db
    from sqlalchemy import event
    from app.steamidler.manager import get_manager
    manager = get_manager(app)
    seed_account(manager.db, games_cache='x' * 100000, shared_secret='fixture-secret')
    statements = []
    def before(conn, cursor, statement, *args): statements.append(statement.lower())
    event.listen(db.engine, 'before_cursor_execute', before)
    try:
        response = client.get('/api/steamidler/accounts')
    finally:
        event.remove(db.engine, 'before_cursor_execute', before)
    assert response.status_code == 200
    assert response.json()['data'][0]['shared_secret_set'] is True
    account_sql = [sql for sql in statements if 'from steamidler_accounts' in sql]
    assert account_sql
    assert all('games_cache' not in sql and 'refresh_token' not in sql for sql in account_sql)
    assert 'fixture-secret' not in response.text
