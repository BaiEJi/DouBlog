"""历史页存在性+总数合并；无版本、越界和旧数组协议仍无大字段读取。"""
from datetime import datetime, timezone

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session


@pytest.mark.parametrize('query,empty,versions,page,size', [
    ('?page=1&page_size=2', False, [3, 2], 1, 2),
    ('?page=9&page_size=2', False, [], 9, 2),
    ('?page=1&page_size=2', True, [], 1, 2),
    ('?page=0&page_size=999', False, [3, 2, 1], 1, 100),
    ('', False, [3, 2, 1], None, None),
])
def test_history_count_and_page_use_two_sql_with_original_dto(client, auth_headers, app, query, empty, versions, page, size):
    from app.blog.assets.models import AssetItem, AssetVersion, AssetFile
    stamp = datetime(2026, 10, 21, 12, 34, 56, tzinfo=timezone.utc)
    with Session(app.state.engine) as session:
        item = AssetItem(kind='skill', title='历史投影', content='资产正文' * 10000)
        session.add(item); session.flush(); item_id = item.id
        if not empty:
            for version in (1, 2, 3):
                session.add(AssetVersion(item_id=item_id, version=version, title=f'版本{version}', note=f'备注{version}',
                    content='版本正文' * 10000, summary='版本摘要' * 10000, created_at=stamp))
        session.add(AssetFile(item_id=item_id, path='large.md', content='不得读取的文件' * 10000))
        session.commit()
        reference = {row.version: row.to_dict() for row in session.scalars(select(AssetVersion).where(AssetVersion.item_id == item_id))}
    statements = []
    def capture(connection, cursor, statement, parameters, context, many):
        if 'assets_' in statement.lower(): statements.append(statement.lower())
    event.listen(app.state.engine, 'before_cursor_execute', capture)
    try:
        response = client.get(f'/api/assets/items/{item_id}/versions' + query, headers=auth_headers)
    finally:
        event.remove(app.state.engine, 'before_cursor_execute', capture)
    assert response.status_code == 200, response.text
    expected = [reference[version] for version in versions]
    assert response.json()['data'] == (expected if page is None else {
        'items': expected, 'total': 0 if empty else 3, 'page': page, 'page_size': size})
    assert len(statements) == 2, statements
    assert sum('count(' in sql for sql in statements) == (0 if page is None else 1)
    assert not any('assets_files' in sql for sql in statements)
    projections = [sql.split('from', 1)[0] for sql in statements]
    assert not any(column in projection for column in ('assets_items.content', 'assets_items.archive',
        'assets_versions.content', 'assets_versions.summary') for projection in projections), projections


@pytest.mark.parametrize('query', ['', '?page=1&page_size=20'])
def test_history_missing_asset_keeps_one_sql_404(client, auth_headers, app, query):
    statements = []
    def capture(connection, cursor, statement, parameters, context, many):
        if 'assets_' in statement.lower(): statements.append(statement)
    event.listen(app.state.engine, 'before_cursor_execute', capture)
    try:
        response = client.get('/api/assets/items/99999/versions' + query, headers=auth_headers)
    finally:
        event.remove(app.state.engine, 'before_cursor_execute', capture)
    assert response.status_code == 404 and response.json()['message'] == '资产不存在'
    assert len(statements) == 1
