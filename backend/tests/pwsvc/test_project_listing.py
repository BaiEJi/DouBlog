"""Project listing preserves public fields and independent association counts."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event, insert, update

from app.pwsvc.models import PwsvcProject, PwsvcType, PwsvcUser


@pytest.mark.parametrize('populated', [False, True], ids=['empty', 'multiple-projects'])
def test_project_listing_public_projection_and_single_query(
        client, app, auth_headers, monkeypatch, populated):
    from app.pwsvc import routes

    def unexpected_crypto(*args, **kwargs):
        raise AssertionError('Listing projects must not derive passwords or decrypt seeds')

    monkeypatch.setattr(routes, 'derive_password', unexpected_crypto)
    monkeypatch.setattr(routes, 'decrypt_seed', unexpected_crypto)
    created = datetime(2026, 10, 21, 9, 8, 7, 123456,
                       tzinfo=timezone(timedelta(hours=8)))
    if populated:
        # Insert out of ID/name order. A 2-type/3-user project detects JOIN multiplication;
        # other projects cover disabled users, no users, and no associations at all.
        with app.state.engine.begin() as connection:
            connection.execute(insert(PwsvcProject.__table__), [
                {'id': pid, 'name': name, 'description': description,
                 'api_key_hash': str(pid).zfill(64), 'api_key_prefix': f'pws_{pid}',
                 'rate_limit': limit, 'created_at': created,
                 'updated_at': created + timedelta(days=1)}
                for pid, name, description, limit in [
                    (40, '空项目', None, 120), (10, '中文项目', None, 0),
                    (30, '仅类型', '', 10000), (20, '另一个项目', '描述', 8),
                ]
            ])
            connection.execute(insert(PwsvcType.__table__), [
                {'id': tid, 'project_id': pid, 'name': f'type-{tid}'}
                for tid, pid in [(101, 10), (102, 10), (201, 20), (301, 30)]
            ])
            connection.execute(insert(PwsvcUser.__table__), [
                {'project_id': pid, 'type_id': tid, 'username': f'user-{number}',
                 'status': status, 'seed_encrypted': 'opaque-seed-not-to-read'}
                for number, (pid, tid, status) in enumerate([
                    (10, 101, 'enabled'), (10, 101, 'disabled'),
                    (10, 102, 'enabled'), (20, 201, 'disabled'),
                ])
            ])

    statements = []

    def record_query(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().lower().startswith('select') and 'pwsvc_' in statement.lower():
            statements.append(statement)

    event.listen(app.state.engine, 'before_cursor_execute', record_query)
    try:
        response = client.get('/api/pwsvc/projects', headers=auth_headers)
    finally:
        event.remove(app.state.engine, 'before_cursor_execute', record_query)

    assert response.status_code == 200
    assert len(statements) == 1
    query = statements[0].lower()
    assert all(column not in query for column in ('api_key_hash', 'seed_encrypted', 'updated_at'))
    assert response.json()['success'] is True
    rows = response.json()['data']
    if not populated:
        assert rows == []
        return

    assert rows == [
        {'id': pid, 'name': name, 'description': description,
         'api_key_prefix': f'pws_{pid}', 'rate_limit': limit,
         'created_at': '2026-10-21T09:08:07.123456',
         'type_count': types, 'user_count': users}
        for pid, name, description, limit, types, users in [
            (10, '中文项目', '', 0, 2, 3), (20, '另一个项目', '描述', 8, 1, 1),
            (30, '仅类型', '', 10000, 1, 0), (40, '空项目', '', 120, 0, 0),
        ]
    ]
    assert all(list(row) == ['id', 'name', 'description', 'api_key_prefix', 'rate_limit',
                             'created_at', 'type_count', 'user_count'] for row in rows)


def test_shared_project_query_uses_each_app_database_and_reads_new_counts(
        app, client, auth_headers, tmp_path, monkeypatch):
    import asyncio
    import httpx
    from fastapi.testclient import TestClient
    from app.config import settings
    from app.main import create_app

    other_directory = tmp_path / 'second-pwsvc-app'
    monkeypatch.setattr(settings, 'data_dir', str(other_directory))
    monkeypatch.setattr(settings, 'images_dir', str(other_directory / 'images'))
    other = create_app()
    stamp = datetime(2026, 10, 21, 9, 8, 7, 123456)
    expected = {}
    for label, application, type_ids, statuses in [
        ('A', app, (11, 12), ('enabled', 'disabled', 'enabled')),
        ('B', other, (11,), ('disabled',)),
    ]:
        with application.state.engine.begin() as connection:
            connection.execute(insert(PwsvcProject.__table__), {
                'id': 7, 'name': f'project-{label}', 'description': None,
                'api_key_hash': label.zfill(64), 'api_key_prefix': f'pws_{label}',
                'rate_limit': 0, 'created_at': stamp,
            })
            connection.execute(insert(PwsvcType.__table__), [
                {'id': tid, 'project_id': 7, 'name': f'type-{tid}'} for tid in type_ids])
            connection.execute(insert(PwsvcUser.__table__), [
                {'project_id': 7, 'type_id': type_ids[index % len(type_ids)],
                 'username': f'user-{index}', 'status': status,
                 'seed_encrypted': 'opaque-not-to-decrypt'}
                for index, status in enumerate(statuses)])
        expected[label] = [{'id': 7, 'name': f'project-{label}', 'description': '',
                            'api_key_prefix': f'pws_{label}', 'rate_limit': 0,
                            'created_at': '2026-10-21T09:08:07.123456',
                            'type_count': len(type_ids), 'user_count': len(statuses)}]

    statements = {'A': [], 'B': []}

    def recorder(label):
        def record(connection, cursor, statement, parameters, context, executemany):
            if statement.lstrip().lower().startswith('select') and 'pwsvc_' in statement.lower():
                statements[label].append(statement)
        return record

    async def read_both(repetitions):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url='http://app-a.test', headers=auth_headers) as first:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=other),
                                         base_url='http://app-b.test', headers=auth_headers) as second:
                for _ in range(repetitions):
                    responses = await asyncio.gather(first.get('/api/pwsvc/projects'),
                                                     second.get('/api/pwsvc/projects'))
                    for label, response in zip(('A', 'B'), responses):
                        assert response.status_code == 200, response.text
                        assert response.json()['success'] is True
                        assert response.json()['data'] == expected[label]

    listeners = [(app.state.engine, recorder('A')), (other.state.engine, recorder('B'))]
    with TestClient(other):
        for engine, listener in listeners:
            event.listen(engine, 'before_cursor_execute', listener)
        try:
            # One expression is shared, but each concurrent request must use its own runtime.
            asyncio.run(read_both(3))
            assert {label: len(queries) for label, queries in statements.items()} == {'A': 3, 'B': 3}
            with other.state.engine.begin() as connection:
                connection.execute(insert(PwsvcType.__table__), {'id': 12, 'project_id': 7, 'name': 'new'})
                connection.execute(insert(PwsvcUser.__table__), {
                    'project_id': 7, 'type_id': 12, 'username': 'new-disabled',
                    'status': 'disabled', 'seed_encrypted': 'opaque-not-to-decrypt'})
                connection.execute(update(PwsvcProject.__table__).where(PwsvcProject.id == 7)
                                   .values(description='changed-only-in-B'))
            expected['B'][0].update(description='changed-only-in-B', type_count=2, user_count=2)
            asyncio.run(read_both(2))
            assert {label: len(queries) for label, queries in statements.items()} == {'A': 5, 'B': 5}
            assert all(all(column not in query.lower()
                           for column in ('api_key_hash', 'seed_encrypted', 'updated_at'))
                       for queries in statements.values() for query in queries)
        finally:
            for engine, listener in listeners:
                event.remove(engine, 'before_cursor_execute', listener)

    # Closing app B cannot bind the shared expression or later app A reads to B's engine.
    response = client.get('/api/pwsvc/projects', headers=auth_headers)
    assert response.status_code == 200
    assert response.json()['data'] == expected['A']
