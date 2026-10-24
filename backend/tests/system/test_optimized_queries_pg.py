"""Execute optimized cross-module projections/aggregates on an isolated real PG."""
from datetime import date, datetime, timedelta, timezone
import hashlib

import pytest
from sqlalchemy import func, inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session


def _seed_queries(session):
    from app.blog.assets.models import AssetItem, AssetVersion
    from app.blog.bookmarks.models import BookmarkItem, BookmarkItemTag, BookmarkTag
    from app.practice.models import (PracticeProblem, PracticeProblemTag, PracticeReview,
                                     PracticeSolution, PracticeSolutionCode, PracticeTag)
    from app.pwsvc.models import PwsvcProject, PwsvcType, PwsvcUser

    now = datetime(2026, 10, 21, 0, 0, tzinfo=timezone.utc)
    session.add_all([
        PracticeProblem(id='pg-rich', title='PG rich problem', source='other', difficulty=2,
                        status='reviewing', description_md='body must not enter summary' * 50,
                        pitfall_md='private detail', created_at=now, updated_at=now),
        PracticeProblem(id='pg-empty', title='PG no children', source='other', difficulty=1,
                        status='todo', created_at=now - timedelta(days=1), updated_at=now),
        PracticeProblem(id='pg-deleted', title='PG deleted problem', source='other', difficulty=3,
                        status='todo', created_at=now + timedelta(days=1), updated_at=now,
                        deleted_at=now),
        PracticeTag(id='pg-tag-z', name='Z tag', color='#112233', sort_order=10, created_at=now),
        PracticeTag(id='pg-tag-a', name='A tag', color='#445566', sort_order=0, created_at=now),
        PracticeTag(id='pg-tag-empty', name='Unused tag', color='#778899', sort_order=20, created_at=now),
    ])
    full_asset = AssetItem(kind='prompt', title='PG versioned asset', content='current', version=3)
    empty_asset = AssetItem(kind='prompt', title='PG no versions', content='current')
    projects = [PwsvcProject(name=f'PG {name}', api_key_hash=hashlib.sha256(name.encode()).hexdigest(),
                             api_key_prefix='pg-only')
                for name in ('populated', 'disabled', 'types-only', 'empty')]
    session.add_all([full_asset, empty_asset, *projects])
    session.add(BookmarkTag(id='pg-bookmark-tag', name='PG bookmark tag', color='#aabbcc', created_at=now))
    for ident in ('pg-bookmark-a', 'pg-bookmark-b', 'pg-bookmark-c', 'pg-bookmark-trash'):
        session.add(BookmarkItem(
            id=ident, url=f'https://example.invalid/{ident}', normalized_url=f'https://example.invalid/{ident}',
            title=f'PG {ident}', description='PG complete description', note='PG preserved note',
            snapshot_md='# PG snapshot\n' + '真实书签正文\n' * 12000, snapshot_words=72000,
            snapshot_at=now, created_at=now, updated_at=now,
            deleted_at=now if ident.endswith('trash') else None))
    session.flush()  # FK parents must exist before child inserts on PostgreSQL.

    types = [PwsvcType(project_id=projects[0].id, name='type-a'),
             PwsvcType(project_id=projects[0].id, name='type-b'),
             PwsvcType(project_id=projects[1].id, name='disabled-type'),
             PwsvcType(project_id=projects[2].id, name='unused-type')]
    session.add_all(types)
    session.add_all([
        BookmarkItemTag(item_id='pg-bookmark-c', tag_id='pg-bookmark-tag'),
        PracticeSolution(id='pg-coded-solution', problem_id='pg-rich', name='With code',
                         created_at=now, updated_at=now),
        PracticeSolution(id='pg-uncoded-solution', problem_id='pg-rich', name='Without code',
                         created_at=now, updated_at=now),
    ])
    session.add_all([AssetVersion(item_id=full_asset.id, version=version, title=f'PG version {version}',
                                 content='history body' * 100, summary='history summary', note=f'note-{version}')
                     for version in (1, 2, 3)])
    session.flush()

    session.add_all([
        PracticeProblemTag(problem_id='pg-rich', tag_id='pg-tag-z'),
        PracticeProblemTag(problem_id='pg-rich', tag_id='pg-tag-a'),
        PracticeProblemTag(problem_id='pg-deleted', tag_id='pg-tag-a'),
        PracticeSolutionCode(id='pg-code-python', solution_id='pg-coded-solution', language='python', code='pass'),
        PracticeSolutionCode(id='pg-code-cpp', solution_id='pg-coded-solution', language='cpp', code='int main(){}'),
        PracticeReview(id='pg-done', problem_id='pg-rich', cycle=1, seq=1,
                       prev_interval_days=1, scheduled_date=date(2019, 1, 1), status='done', created_at=now),
        PracticeReview(id='pg-pending', problem_id='pg-rich', cycle=2, seq=3,
                       prev_interval_days=4, scheduled_date=date(2020, 1, 3), status='pending', created_at=now),
        PracticeReview(id='pg-cancelled', problem_id='pg-rich', cycle=2, seq=4,
                       prev_interval_days=7, scheduled_date=date(2020, 1, 4), status='cancelled', created_at=now),
    ])
    # 2 types × 3 users would become 6/6 in an incorrect multi-detail join.
    session.add_all([
        PwsvcUser(project_id=projects[0].id, type_id=types[0].id, username='enabled-a',
                  status='enabled', seed_encrypted='opaque-test-value-never-decrypted'),
        PwsvcUser(project_id=projects[0].id, type_id=types[0].id, username='disabled-a',
                  status='disabled', seed_encrypted='opaque-test-value-never-decrypted'),
        PwsvcUser(project_id=projects[0].id, type_id=types[1].id, username='enabled-b',
                  status='enabled', seed_encrypted='opaque-test-value-never-decrypted'),
        PwsvcUser(project_id=projects[1].id, type_id=types[2].id, username='disabled-only',
                  status='disabled', seed_encrypted='opaque-test-value-never-decrypted'),
    ])
    session.commit()
    return {'asset': full_asset.id, 'empty_asset': empty_asset.id,
            'project_counts': {projects[0].id: (2, 3), projects[1].id: (1, 1),
                               projects[2].id: (1, 0), projects[3].id: (0, 0)}}


def _data(client, url, headers):
    response = client.get(url, headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['success'] is True and body['code'] == 200
    return body['data']


def test_optimized_queries_execute_on_real_postgres(client, app, auth_headers, tmp_path_factory, monkeypatch):
    pgserver = pytest.importorskip('pgserver', reason='pgserver is required for real PostgreSQL validation')
    from app.config import settings
    from app.db import current_runtime, database_context, db
    from app.main import create_app, stop_background
    from fastapi.testclient import TestClient

    monkeypatch.setattr(settings, 'debug', False)  # Config switch uses restart_required, never reload.
    assert app.state.engine.dialect.name == 'sqlite'
    pgdata = tmp_path_factory.mktemp('optimized-queries-pgdata')
    server = pgserver.get_server(str(pgdata))
    pg_app = None
    database_name = 'doublog_optimized_queries_test'
    try:
        local_uri = make_url(server.get_uri())
        assert local_uri.host in ('127.0.0.1', 'localhost') and local_uri.port
        target = {'host': '127.0.0.1', 'port': local_uri.port, 'user': 'postgres',
                  'password': '', 'dbname': database_name}
        switched = client.post('/api/admin/database/switch', headers=auth_headers,
                               json={'target': 'postgres', 'postgres': target})
        assert switched.status_code == 200, switched.text
        assert switched.json()['data'] == {'backend': 'postgres', 'restart_required': True}

        pg_app = create_app()
        with TestClient(pg_app) as pg_client:
            engine = pg_app.state.engine
            assert engine.dialect.name == 'postgresql'
            assert engine.url.host == '127.0.0.1' and engine.url.port == local_uri.port
            with database_context(pg_app):
                assert current_runtime() is pg_app.state.db_runtime and db.engine is engine
                with Session(engine) as session:
                    assert session.scalar(text('SELECT current_database()')) == database_name
                    assert session.scalar(text('SELECT inet_server_port()')) == local_uri.port
                    fixture = _seed_queries(session)

            # Default Core Row → Pydantic summary, tag order, distinct solution
            # count including a solution without code, and pending-only review.
            page = _data(pg_client, '/api/practice/problems', auth_headers)
            assert (page['total'], page['page'], page['page_size']) == (2, 1, 20)
            assert [row['id'] for row in page['items']] == ['pg-rich', 'pg-empty']
            rich, empty = page['items']
            assert rich['description_md'] is None and rich['pitfall_md'] is None
            assert rich['tags'] == [
                {'id': 'pg-tag-a', 'name': 'A tag', 'color': '#445566'},
                {'id': 'pg-tag-z', 'name': 'Z tag', 'color': '#112233'},
            ]
            assert rich['solution_count'] == 2 and rich['code_languages'] == ['cpp', 'python']
            assert rich['next_review'] == {'id': 'pg-pending', 'cycle': 2, 'seq': 3,
                                           'prev_interval_days': 4, 'scheduled_date': '2020-01-03'}
            assert (empty['tags'], empty['solution_count'], empty['code_languages'], empty['next_review']) == (
                [], 0, [], None)
            selected = _data(pg_client, '/api/practice/problems?tags=pg-tag-a,pg-tag-z&tags_op=and'
                             '&language=cpp&only_due_review=true&sort=review_asc', auth_headers)
            assert selected['total'] == 1 and [row['id'] for row in selected['items']] == ['pg-rich']
            ordered = _data(pg_client, '/api/practice/problems?sort=review_asc', auth_headers)
            assert [row['id'] for row in ordered['items']] == ['pg-rich', 'pg-empty']
            tags = {tag['id']: tag['problem_count']
                    for tag in _data(pg_client, '/api/practice/tags', auth_headers)}
            assert tags == {'pg-tag-a': 1, 'pg-tag-z': 1, 'pg-tag-empty': 0}

            # Uncorrelated scalar COUNT must preserve the existing item identity
            # on empty history, and total must survive an out-of-range page.
            prefix = f"/api/assets/items/{fixture['asset']}/versions"
            first = _data(pg_client, prefix + '?page=1&page_size=2', auth_headers)
            assert (first['total'], first['page'], first['page_size']) == (3, 1, 2)
            assert [row['version'] for row in first['items']] == [3, 2]
            assert all(set(row) == {'id', 'item_id', 'version', 'title', 'note', 'created_at'}
                       for row in first['items'])
            second = _data(pg_client, prefix + '?page=2&page_size=2', auth_headers)
            assert second['total'] == 3 and [row['version'] for row in second['items']] == [1]
            overflow = _data(pg_client, prefix + '?page=99&page_size=2', auth_headers)
            assert overflow['total'] == 3 and overflow['items'] == []
            no_versions = _data(pg_client,
                f"/api/assets/items/{fixture['empty_asset']}/versions?page=1&page_size=2", auth_headers)
            assert no_versions == {'items': [], 'page': 1, 'page_size': 2, 'total': 0}
            assert pg_client.get('/api/assets/items/999999999/versions?page=1',
                                 headers=auth_headers).status_code == 404

            # Independent LEFT JOIN aggregate subqueries, including disabled
            # users and projects missing one or both detail-table associations.
            projects = _data(pg_client, '/api/pwsvc/projects', auth_headers)
            assert [row['id'] for row in projects] == sorted(fixture['project_counts'])
            assert {row['id']: (row['type_count'], row['user_count']) for row in projects} == fixture['project_counts']
            assert all('api_key_hash' not in row and 'seed_encrypted' not in row for row in projects)

            from app.blog.bookmarks import ensure_migrations as bookmark_migrations
            from app.blog.bookmarks.models import BookmarkItem
            index_name = 'ix_bmitem_deleted_created_id'
            index = next(index for index in BookmarkItem.__table__.indexes if index.name == index_name)
            def bookmark_indexes():
                return {item['name']: item['column_names']
                        for item in inspect(engine).get_indexes('bookmarks_items')}
            assert bookmark_indexes()[index_name] == ['deleted_at', 'created_at', 'id']
            index.drop(engine, checkfirst=True)  # Existing PG table missing the new index.
            prior_indexes = bookmark_indexes()
            before_bookmarks = _data(pg_client, '/api/bookmarks/items?page_size=2', auth_headers)
            assert before_bookmarks['total'] == 3
            assert [item['id'] for item in before_bookmarks['items']] == ['pg-bookmark-c', 'pg-bookmark-b']
            assert before_bookmarks['items'][0]['tags'] == [
                {'id': 'pg-bookmark-tag', 'name': 'PG bookmark tag', 'color': '#aabbcc'}]
            with Session(engine) as session:
                original_bodies = session.execute(select(BookmarkItem.id, BookmarkItem.snapshot_md, BookmarkItem.note)
                                                   .order_by(BookmarkItem.id)).all()
            bookmark_migrations(engine)
            bookmark_migrations(engine)  # IF NOT EXISTS is executed on the real PostgreSQL dialect.
            assert bookmark_indexes()[index_name] == ['deleted_at', 'created_at', 'id']
            assert all(bookmark_indexes()[name] == columns for name, columns in prior_indexes.items())
            assert _data(pg_client, '/api/bookmarks/items?page_size=2', auth_headers) == before_bookmarks
            tail = _data(pg_client, '/api/bookmarks/items?page=2&page_size=2', auth_headers)
            assert tail['total'] == 3 and [item['id'] for item in tail['items']] == ['pg-bookmark-a']
            trash = _data(pg_client, '/api/bookmarks/items?trash=true', auth_headers)
            assert trash['total'] == 1 and [item['id'] for item in trash['items']] == ['pg-bookmark-trash']
            with Session(engine) as session:
                assert session.execute(select(BookmarkItem.id, BookmarkItem.snapshot_md, BookmarkItem.note)
                                       .order_by(BookmarkItem.id)).all() == original_bodies

            # Reopen a connection after the request workers finished. These are
            # committed rows on the dedicated PG database, not the SQLite app.
            from app.practice.models import PracticeProblem
            from app.blog.assets.models import AssetVersion
            from app.pwsvc.models import PwsvcUser
            with database_context(pg_app):
                with Session(engine) as session:
                    assert session.scalar(text('SELECT current_database()')) == database_name
                    assert session.scalar(select(func.count()).select_from(PracticeProblem)) == 3
                    assert session.scalar(select(func.count()).select_from(AssetVersion)) == 3
                    assert session.scalar(select(func.count()).select_from(PwsvcUser)) == 4
                    assert session.scalar(select(func.count()).select_from(BookmarkItem)) == 4
            with app.state.engine.connect() as sqlite_connection:
                assert sqlite_connection.execute(text('SELECT COUNT(*) FROM practice_problems')).scalar_one() == 0
    finally:
        try:
            if pg_app is not None:
                stop_background(pg_app)
                pg_app.state.engine.dispose()
        finally:
            server.cleanup()
