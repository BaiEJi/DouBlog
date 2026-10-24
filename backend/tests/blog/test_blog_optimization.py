"""知识域优化回归：分页、索引、SQL投影、写冲突和日记幂等。"""
from datetime import date

from sqlalchemy import event, insert
from sqlalchemy.orm import Session


def _post(client, headers, name, **values):
    response = client.post('/api/posts', json={'name': name, 'title': name, 'content': '正文', **values}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()['data']


def test_post_cas_and_subtree_levels(client, auth_headers):
    root = _post(client, auth_headers, 'level-root')
    child = _post(client, auth_headers, 'level-child', parent_id=root['id'])
    grand = _post(client, auth_headers, 'level-grand', parent_id=child['id'])
    other = _post(client, auth_headers, 'level-other')
    response = client.put(f"/api/posts/id/{root['id']}", json={'parent_id': other['id'], 'revision': 1}, headers=auth_headers)
    assert response.status_code == 400
    assert client.get(f"/api/posts/id/{root['id']}?no_view=1", headers=auth_headers).json()['data']['revision'] == 1
    response = client.put(f"/api/posts/id/{child['id']}", json={'parent_id': 0, 'revision': 1}, headers=auth_headers)
    assert response.status_code == 200, response.text
    detail = client.get(f"/api/posts/id/{grand['id']}?no_view=1", headers=auth_headers).json()['data']
    assert detail['level'] == 1 and detail['slug'] == '/level-child/level-grand'
    stale = client.put(f"/api/posts/id/{child['id']}", json={'content': '旧写入', 'revision': 1}, headers=auth_headers)
    assert stale.status_code == 409


def test_backlinks_projection_updates_and_name_priority(client, auth_headers, app):
    target = _post(client, auth_headers, 'target-page', title='唯一标题')
    source = _post(client, auth_headers, 'source-page', content='[[target-page|显示]] [[唯一标题]]')
    statements = []
    def track(connection, cursor, statement, parameters, context, many):
        statements.append(statement.lower())
    event.listen(app.state.engine, 'before_cursor_execute', track)
    try:
        response = client.get(f"/api/posts/id/{target['id']}/backlinks", headers=auth_headers)
    finally:
        event.remove(app.state.engine, 'before_cursor_execute', track)
    assert response.json()['data']['items'][0]['id'] == source['id']
    assert not any('blog_posts.content' in statement for statement in statements)
    client.put(f"/api/posts/id/{source['id']}", json={'content': '无链接', 'revision': 1}, headers=auth_headers)
    assert client.get(f"/api/posts/id/{target['id']}/backlinks", headers=auth_headers).json()['data']['total'] == 0


def test_blog_reorder_receipt_and_tree_sibling_guard(client, auth_headers):
    a = _post(client, auth_headers, 'sort-one'); b = _post(client, auth_headers, 'sort-two')
    tree = client.get('/api/posts/tree', headers=auth_headers)
    version = int(tree.headers['X-Tree-Revision'])
    body = {'parent_id': 0, 'children_order': [b['id'], a['id']], 'revision': version, 'mutation_id': 'sort-receipt-1'}
    response = client.put('/api/posts/reorder', json=body, headers=auth_headers)
    assert response.status_code == 200, response.text
    assert client.put('/api/posts/reorder', json=body, headers=auth_headers).json() == response.json()
    body['mutation_id'] = 'sort-receipt-2'
    assert client.put('/api/posts/reorder', json=body, headers=auth_headers).status_code == 409
    body['revision'] = response.json()['data']['revision']; body['children_order'] = [a['id']]
    assert client.put('/api/posts/reorder', json=body, headers=auth_headers).status_code == 409
    assert len(client.get('/api/posts/tree', headers=auth_headers).json()['data']) == 2


def test_diary_receipts_conflicts_and_deleted_journal_guard(client, auth_headers):
    journal = client.get('/api/diary/journals', headers=auth_headers).json()['data'][0]['id']
    body = {'entry_date': date.today().isoformat(), 'journal_id': journal, 'content': '未丢失内容', 'mutation_id': 'diary-create-1'}
    created = client.post('/api/diary/entries', json=body, headers=auth_headers)
    assert created.status_code == 201, created.text
    assert client.post('/api/diary/entries', json=body, headers=auth_headers).json() == created.json()
    entry = created.json()['data']
    body = {'content': '新内容', 'revision': entry['revision'], 'mutation_id': 'diary-update-1'}
    updated = client.put(f"/api/diary/entries/{entry['id']}", json=body, headers=auth_headers)
    assert updated.status_code == 200 and updated.json()['data']['revision'] == 2
    assert client.put(f"/api/diary/entries/{entry['id']}", json=body, headers=auth_headers).json() == updated.json()
    assert client.put(f"/api/diary/entries/{entry['id']}", json={'content': '过期内容', 'revision': 1}, headers=auth_headers).status_code == 409
    assert client.get(f"/api/diary/entries/{entry['id']}", headers=auth_headers).json()['data']['content'] == '新内容'
    client.delete(f"/api/diary/entries/{entry['id']}", headers=auth_headers)
    assert client.delete(f'/api/diary/journals/{journal}', headers=auth_headers).status_code == 409


def test_diary_more_than_500_and_excerpt_projection(client, auth_headers, app):
    from app.blog.diary.models import Diary, DiaryJournal
    with Session(app.state.engine) as session:
        journal = session.query(DiaryJournal.id).first()[0]
        session.execute(insert(Diary), [{'entry_date': '2026-10-21', 'kind': 'note', 'journal_id': journal,
            'content': f'{index}:' + '长正文' * 1000, 'word_count': 3000} for index in range(505)])
        session.commit()
    response = client.get('/api/diary/entries?limit=50&offset=500&include_content=0', headers=auth_headers)
    result = response.json()['data']
    assert result['total'] == 505 and len(result['items']) == 5 and result['has_more'] is False
    entry = result['items'][0]
    assert len(entry['content']) == 600 and entry['is_excerpt']
    assert len(client.get(f"/api/diary/entries/{entry['id']}", headers=auth_headers).json()['data']['content']) > 3000


def test_asset_list_has_bounded_queries_and_no_large_field_load(client, auth_headers, app):
    from app.blog.assets.models import AssetItem, AssetVersion, AssetFile
    with Session(app.state.engine) as session:
        for index in range(12):
            item = AssetItem(kind='skill', title=f'大资产{index}', content='正文' * 10000, archive=b'x' * 10000)
            session.add(item); session.flush()
            session.add(AssetVersion(item_id=item.id, version=1, title=item.title, content=item.content))
            session.add(AssetFile(item_id=item.id, path='SKILL.md', content=item.content))
        session.commit()
    statements = []
    def track(connection, cursor, statement, parameters, context, many):
        if 'assets_' in statement.lower(): statements.append(statement.lower())
    event.listen(app.state.engine, 'before_cursor_execute', track)
    try:
        result = client.get('/api/assets/items?page_size=20', headers=auth_headers).json()['data']
    finally:
        event.remove(app.state.engine, 'before_cursor_execute', track)
    assert len(result['items']) == 12
    assert all(item['versions_count'] == 1 and item['files_count'] == 1 for item in result['items'])
    assert len(statements) <= 5, statements
    select_fields = [sql.split(' from ', 1)[0].replace('\n', ' ') for sql in statements]
    assert not any('assets_items.archive ' in sql or 'assets_items.content ' in sql or 'assets_versions.content ' in sql for sql in select_fields)
    item_id = result['items'][0]['id']
    history = client.get(f'/api/assets/items/{item_id}/versions?page=1&page_size=1', headers=auth_headers).json()['data']
    assert history['total'] == 1 and 'content' not in history['items'][0]


def test_diary_delete_journal_races_legacy_create_safely(app, client, auth_headers, monkeypatch):
    import asyncio
    import threading
    import httpx
    from app.blog.diary import routes
    journal = client.post('/api/diary/journals', json={'name': '并发删本'}, headers=auth_headers).json()['data']['id']
    checked, deleting = threading.Event(), threading.Event()
    original_validate, original_lock = routes._validate_payload, routes._lock_journals

    def pause_after_validate(*args, **kwargs):
        value = original_validate(*args, **kwargs)
        checked.set()
        assert deleting.wait(10)
        return value

    def observe_delete_lock():
        if checked.is_set():
            deleting.set()
        return original_lock()

    monkeypatch.setattr(routes, '_validate_payload', pause_after_validate)
    monkeypatch.setattr(routes, '_lock_journals', observe_delete_lock)

    async def race():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as api:
            pending = asyncio.create_task(api.post('/api/diary/entries', headers=auth_headers,
                json={'content': '无mutation_id旧客户端', 'journal_id': journal, 'entry_date': '2026-10-21'}))
            for _ in range(1000):
                if checked.is_set(): break
                await asyncio.sleep(.01)
            assert checked.is_set()
            deleted = asyncio.create_task(api.delete(f'/api/diary/journals/{journal}', headers=auth_headers))
            return await asyncio.gather(pending, deleted)

    created, deleted = asyncio.run(race())
    assert created.status_code == 201, created.text
    assert deleted.status_code == 409, deleted.text
    assert any(row['id'] == journal for row in client.get('/api/diary/journals', headers=auth_headers).json()['data'])


def test_diary_legacy_summary_concurrency_creates_one_row(app, client, auth_headers, monkeypatch):
    import asyncio
    import threading
    import httpx
    from app.blog.diary import routes
    # 空日记本集合也必须有稳定写锚点，否则首次总结没有可锁业务行。
    for journal in client.get('/api/diary/journals', headers=auth_headers).json()['data']:
        assert client.delete(f"/api/diary/journals/{journal['id']}", headers=auth_headers).status_code == 200
    first_flushed, second_started = threading.Event(), threading.Event()
    original_finish, original_lock = routes._finish_mutation, routes._lock_journals

    def pause_first_commit(result, *args):
        if result.get('created'):
            first_flushed.set()
            assert second_started.wait(10)
        return original_finish(result, *args)

    def observe_second_lock():
        if first_flushed.is_set(): second_started.set()
        return original_lock()

    monkeypatch.setattr(routes, '_finish_mutation', pause_first_commit)
    monkeypatch.setattr(routes, '_lock_journals', observe_second_lock)

    async def race():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as api:
            pending = asyncio.create_task(api.post('/api/diary/summary', headers=auth_headers,
                json={'content': 'first', 'entry_date': '2026-10-21'}))
            for _ in range(1000):
                if first_flushed.is_set(): break
                await asyncio.sleep(.01)
            assert first_flushed.is_set()
            second = asyncio.create_task(api.post('/api/diary/summary', headers=auth_headers,
                json={'content': 'second', 'entry_date': '2026-10-21'}))
            return await asyncio.gather(pending, second)

    results = asyncio.run(race())
    assert sorted(response.status_code for response in results) == [200, 201], [r.text for r in results]
    rows = client.get('/api/diary/entries?date=2026-10-21', headers=auth_headers).json()['data']['items']
    assert len(rows) == 1 and rows[0]['content'] == 'second'
