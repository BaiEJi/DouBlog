"""Worker-owned Session cleanup without allocating sessions for cache hits."""
import asyncio
import threading

import pytest
from sqlalchemy import text
from sqlalchemy.orm import scoped_session, sessionmaker


@pytest.mark.parametrize('core_connection', [False, True], ids=['cache', 'core-connection'])
def test_run_db_without_orm_does_not_create_session(app, monkeypatch, core_connection):
    from app.db import current_runtime, database_context, run_db
    from app.shared.pools import get_pool

    runtime = app.state.db_runtime
    pool = get_pool(f'test-session-free-{core_connection}', workers=1)

    def unexpected_session():
        pytest.fail('A cache/Core-only task constructed an ORM Session')

    monkeypatch.setattr(runtime.sessions.registry, 'createfunc', unexpected_session)

    def work():
        assert current_runtime() is runtime
        assert not runtime.sessions.registry.has()
        if core_connection:
            with runtime.engine.connect() as connection:
                return connection.execute(text('SELECT 41 + 1')).scalar_one()
        return {'cached': 42}

    async def exercise():
        with database_context(app):
            return await run_db(work, _pool=pool)

    assert asyncio.run(exercise()) == (42 if core_connection else {'cached': 42})
    assert pool.submit(runtime.sessions.registry.has).result(timeout=3) is False
    assert runtime.pending == 0


@pytest.mark.parametrize('work_fails,rollback_fails', [(False, False), (True, False), (True, True)],
                         ids=['success', 'work-failure', 'rollback-failure'])
def test_run_db_rolls_back_and_removes_only_its_worker_registry(
        app, monkeypatch, work_fails, rollback_fails):
    from app.db import current_runtime, database_context, run_db
    from app.shared.pools import get_pool

    runtime = app.state.db_runtime
    pool = get_pool(f'test-session-cleanup-{work_fails}-{rollback_fails}', workers=1)
    with runtime.engine.begin() as connection:
        connection.execute(text('CREATE TABLE session_cleanup_probe (value INTEGER)'))
    # Both another registry in the worker and this registry in the caller must
    # survive cleanup of the task's exact thread-local Session.
    foreign = scoped_session(sessionmaker(bind=runtime.engine))
    foreign_session = pool.submit(foreign).result(timeout=3)
    caller_session = runtime.sessions()
    rollback, remove = runtime.sessions.rollback, runtime.sessions.remove
    events, task_sessions, worker_ids = [], [], []

    def tracked_rollback():
        events.append(('rollback', threading.get_ident(), runtime.sessions.registry()))
        rollback()
        if rollback_fails:
            raise RuntimeError('rollback-cleanup-failure')

    def tracked_remove():
        events.append(('remove', threading.get_ident(), runtime.sessions.registry()))
        remove()
        assert not runtime.sessions.registry.has()

    monkeypatch.setattr(runtime.sessions, 'rollback', tracked_rollback)
    monkeypatch.setattr(runtime.sessions, 'remove', tracked_remove)

    def work():
        assert current_runtime() is runtime
        worker_ids.append(threading.get_ident())
        task_sessions.append(runtime.sessions())
        runtime.sessions.execute(text('INSERT INTO session_cleanup_probe VALUES (7)'))
        if work_fails:
            raise RuntimeError('business-failure')
        return 7

    async def exercise():
        with database_context(app):
            return await run_db(work, _pool=pool)

    try:
        if work_fails:
            with pytest.raises(RuntimeError, match=('rollback-cleanup-failure'
                                                   if rollback_fails else 'business-failure')):
                asyncio.run(exercise())
        else:
            assert asyncio.run(exercise()) == 7
        assert [event[0] for event in events] == ['rollback', 'remove']
        assert all(event[1] == worker_ids[0] != threading.get_ident() for event in events)
        assert all(event[2] is task_sessions[0] for event in events)
        assert pool.submit(runtime.sessions.registry.has).result(timeout=3) is False
        assert pool.submit(foreign).result(timeout=3) is foreign_session
        assert runtime.sessions() is caller_session
        with runtime.engine.connect() as connection:
            assert connection.execute(text('SELECT COUNT(*) FROM session_cleanup_probe')).scalar_one() == 0
        assert runtime.pending == 0
    finally:
        pool.submit(foreign.remove).result(timeout=3)
        remove()  # Clean the caller's pre-existing Session without test instrumentation.


def test_running_run_db_cancel_keeps_session_and_ticket_until_real_completion(app, monkeypatch):
    from app.db import database_context, run_db
    from app.shared.pools import get_pool

    runtime = app.state.db_runtime
    pool = get_pool('test-session-running-cancel', workers=1)
    with runtime.engine.begin() as connection:
        connection.execute(text('CREATE TABLE cancelled_session_probe (value INTEGER)'))
    entered, release = threading.Event(), threading.Event()
    cleaned = []
    remove = runtime.sessions.remove

    def tracked_remove():
        assert runtime.sessions.registry.has()
        remove()
        assert not runtime.sessions.registry.has()
        cleaned.append(threading.get_ident())

    monkeypatch.setattr(runtime.sessions, 'remove', tracked_remove)

    def work():
        runtime.sessions.execute(text('INSERT INTO cancelled_session_probe VALUES (9)'))
        entered.set()
        assert release.wait(3)

    async def exercise():
        with database_context(app):
            task = asyncio.create_task(run_db(work, _pool=pool))
            for _ in range(200):
                if entered.is_set():
                    break
                await asyncio.sleep(.01)
            assert entered.is_set()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert runtime.pending == 1 and not cleaned
            release.set()
            for _ in range(200):
                if runtime.pending == 0:
                    break
                await asyncio.sleep(.01)
            assert runtime.pending == 0

    try:
        asyncio.run(exercise())
    finally:
        release.set()
    assert len(cleaned) == 1 and cleaned[0] != threading.get_ident()
    assert pool.submit(runtime.sessions.registry.has).result(timeout=3) is False
    with runtime.engine.connect() as connection:
        assert connection.execute(text('SELECT COUNT(*) FROM cancelled_session_probe')).scalar_one() == 0
