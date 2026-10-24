"""Existing database migration preserves large bodies and the complete list DTO."""
from datetime import datetime, timedelta, timezone
import threading

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session


INDEX_NAME = 'ix_bmitem_deleted_created_id'


def _index():
    from app.blog.bookmarks.models import BookmarkItem
    return next(index for index in BookmarkItem.__table__.indexes if index.name == INDEX_NAME)


def _columns(engine):
    return {row['name']: row['column_names'] for row in inspect(engine).get_indexes('bookmarks_items')}


def _views(client, headers):
    paths = {
        'first': '?page_size=2', 'second': '?page=2&page_size=2',
        'ascending': '?sort=created_asc', 'trash': '?trash=true',
    }
    output = {}
    for name, query in paths.items():
        response = client.get('/api/bookmarks/items' + query, headers=headers)
        assert response.status_code == 200, response.text
        output[name] = response.json()['data']
    assert output['first']['total'] == output['second']['total'] == 4
    assert [row['id'] for row in output['first']['items']] == ['bm-c', 'bm-b']
    assert [row['id'] for row in output['second']['items']] == ['bm-a', 'bm-old']
    assert [row['id'] for row in output['ascending']['items']] == ['bm-old', 'bm-a', 'bm-b', 'bm-c']
    assert output['trash']['total'] == 1
    assert [row['id'] for row in output['trash']['items']] == ['bm-trash']
    return output


def _bodies(engine):
    from app.blog.bookmarks.models import BookmarkItem
    with Session(engine) as session:
        return session.execute(select(BookmarkItem.id, BookmarkItem.snapshot_md, BookmarkItem.note)
                               .order_by(BookmarkItem.id)).all()


def test_existing_bookmark_index_migration_twice_and_restart_preserves_every_field(app, client, auth_headers):
    from app.blog import ensure_migrations as blog_migrations
    from app.blog.bookmarks import ensure_migrations
    from app.blog.bookmarks.models import BookmarkItem, BookmarkItemTag, BookmarkTag
    from app.main import create_app
    from fastapi.testclient import TestClient

    engine = app.state.engine
    assert _columns(engine)[INDEX_NAME] == ['deleted_at', 'created_at', 'id']  # Fresh schema.
    _index().drop(engine, checkfirst=True)  # Model the existing table before this migration.
    indexes_before = _columns(engine)
    assert INDEX_NAME not in indexes_before
    now = datetime(2026, 10, 21, tzinfo=timezone.utc)
    with Session(engine) as session:
        session.add(BookmarkTag(id='bm-tag', name='完整标签', color='#123456', created_at=now))
        for ident in ('bm-a', 'bm-b', 'bm-c', 'bm-old', 'bm-trash'):
            session.add(BookmarkItem(
                id=ident, url=f'https://example.invalid/{ident}', normalized_url=f'https://example.invalid/{ident}',
                title=f'标题 {ident}', description=f'描述 {ident}', note=f'笔记 {ident}' * 2000,
                site_name='测试站点', favicon_url='https://example.invalid/favicon.ico',
                status='reading' if ident == 'bm-b' else 'unread', starred=ident == 'bm-c',
                snapshot_md=f'# {ident}\n' + '真实大正文\n' * 15000, snapshot_words=75000,
                snapshot_at=now, created_at=now - timedelta(days=1) if ident == 'bm-old' else now,
                updated_at=now, deleted_at=now if ident == 'bm-trash' else None))
        session.flush()
        session.add(BookmarkItemTag(item_id='bm-c', tag_id='bm-tag'))
        session.commit()
    dto_before, bodies_before = _views(client, auth_headers), _bodies(engine)
    assert all(len(row.snapshot_md.encode()) > 100000 for row in bodies_before)
    ensure_migrations(engine)
    ensure_migrations(engine)
    blog_migrations(engine)  # Parent module forwards the idempotent hook too.
    assert _columns(engine)[INDEX_NAME] == ['deleted_at', 'created_at', 'id']
    assert all(_columns(engine)[name] == columns for name, columns in indexes_before.items())
    assert _views(client, auth_headers) == dto_before  # Complete DTOs, not only IDs.
    assert _bodies(engine) == bodies_before

    restarted = create_app()
    with TestClient(restarted) as current:
        assert _columns(restarted.state.engine)[INDEX_NAME] == ['deleted_at', 'created_at', 'id']
        assert _views(current, auth_headers) == dto_before
        assert _bodies(restarted.state.engine) == bodies_before


def test_concurrent_existing_bookmark_migrations_create_one_index(app):
    from app.blog.bookmarks import ensure_migrations
    from app.shared.pools import get_pool

    engine = app.state.engine
    _index().drop(engine, checkfirst=True)
    prior = _columns(engine)
    gate = threading.Barrier(2)
    # Independent SDK workers avoid coupling this DDL race to lazy pool
    # expansion: two queued tasks can otherwise share only one worker.
    pools = [get_pool(f'test-bookmark-index-create-{side}', workers=1) for side in ('a', 'b')]
    worker_threads, worker_lock = set(), threading.Lock()

    def migrate():
        with worker_lock:
            worker_threads.add(threading.get_ident())
        gate.wait(timeout=3)
        ensure_migrations(engine)

    futures = [pool.submit(migrate) for pool in pools]
    for future in futures:
        future.result(timeout=5)
    assert len(worker_threads) == 2
    columns = _columns(engine)
    assert columns[INDEX_NAME] == ['deleted_at', 'created_at', 'id']
    assert set(columns) == {*prior, INDEX_NAME}
