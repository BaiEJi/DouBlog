"""The content returned with a revision must describe one committed layout."""
import threading

from sqlalchemy import event


def test_layout_read_never_mixes_two_commits(app, client, auth_headers):
    from app.shared.pools import get_pool
    url = '/api/home/layout'
    before = client.put(url, headers=auth_headers, json={
        'groups': [{'name': 'before', 'cards': [{'key': 'blog'}]}],
        'revision': 0, 'mutation_id': 'snapshot-before',
    }).json()['data']
    changed = threading.Event()
    committed = []

    def concurrent_write():
        response = client.put(url, headers=auth_headers, json={
            'groups': [{'name': 'after', 'cards': [{'key': 'todo'}]}],
            'revision': before['revision'], 'mutation_id': 'snapshot-after',
        })
        assert response.status_code == 200, response.text
        committed.append(response.json()['data'])

    def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        if (statement.lstrip().upper().startswith('SELECT')
                and 'system_home_groups' in statement and not changed.is_set()):
            changed.set()
            # Commit after the read cursor opens, before any later SELECT can
            # observe the new layout. WAL allows the writer to finish here.
            get_pool('home-snapshot-test', workers=1).submit(concurrent_write).result(timeout=10)

    event.listen(app.state.engine, 'after_cursor_execute', after_cursor_execute)
    try:
        response = client.get(url, headers=auth_headers)
    finally:
        event.remove(app.state.engine, 'after_cursor_execute', after_cursor_execute)
    assert changed.is_set() and committed
    assert response.status_code == 200, response.text
    assert response.json()['data'] in (before, committed[0])
    assert client.get(url, headers=auth_headers).json()['data'] == committed[0]
