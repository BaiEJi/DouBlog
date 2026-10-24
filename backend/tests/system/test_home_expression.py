"""Fixed home Select reuse must preserve live database affinity and full DTOs."""
import pytest
from sqlalchemy import event


def _read_once(client, app, auth_headers):
    statements = []
    def capture(connection, cursor, statement, parameters, context, many):
        if 'system_home_' in statement.lower():
            statements.append(statement)
    event.listen(app.state.engine, 'before_cursor_execute', capture)
    try:
        response = client.get('/api/home/layout', headers=auth_headers)
    finally:
        event.remove(app.state.engine, 'before_cursor_execute', capture)
    assert response.status_code == 200, response.text
    assert len(statements) == 1, statements
    assert all(name in statements[0] for name in ('system_home_state', 'system_home_groups', 'system_home_cards'))
    return response.json()['data']


@pytest.mark.parametrize('groups', [
    None,
    [{'name': '空组', 'cards': []}],
    [{'name': '中文 🧪', 'cards': [{'key': 'todo', 'title': '我的待办'},
        {'key': 'blog', 'desc': '文章与双链'}]}, {'name': '第二组', 'cards': []}],
])
def test_home_expression_reads_complete_live_json_in_one_sql(app, client, auth_headers, groups):
    if groups is None:
        expected = {'revision': 0, 'groups': []}
    else:
        response = client.put('/api/home/layout', headers=auth_headers,
            json={'groups': groups, 'revision': 0, 'mutation_id': 'expression-layout'})
        assert response.status_code == 200, response.text
        expected = {'revision': 1, 'groups': [
            {'id': index + 1, 'name': group['name'], 'cards': [
                {'key': card['key'], 'title': card.get('title'), 'desc': card.get('desc')}
                for card in group['cards']]}
            for index, group in enumerate(groups)]}
        assert response.json()['data'] == expected
    assert _read_once(client, app, auth_headers) == expected
    assert _read_once(client, app, auth_headers) == expected


def test_home_expression_keeps_two_apps_same_ids_and_survives_other_close(app, auth_headers, tmp_path, monkeypatch):
    from app.config import settings
    from app.main import create_app
    from fastapi.testclient import TestClient

    def save(client, name, title, revision, mutation):
        response = client.put('/api/home/layout', headers=auth_headers, json={
            'groups': [{'name': name, 'cards': [{'key': 'blog', 'title': title}]}],
            'revision': revision, 'mutation_id': mutation})
        assert response.status_code == 200, response.text
        return response.json()['data']

    with TestClient(app) as first:
        first_data = save(first, '第一个数据库', '第一份文案', 0, 'expression-first')
        assert _read_once(first, app, auth_headers) == first_data
        monkeypatch.setattr(settings, 'data_dir', str(tmp_path / 'home-expression-other'))
        monkeypatch.setattr(settings, 'images_dir', str(tmp_path / 'home-expression-other' / 'images'))
        other = create_app()
        with TestClient(other) as second:
            assert _read_once(second, other, auth_headers) == {'revision': 0, 'groups': []}
            second_data = save(second, '第二个数据库', '第二份文案', 0, 'expression-second')
            assert first_data['groups'][0]['id'] == second_data['groups'][0]['id'] == 1
            assert first_data['revision'] == second_data['revision'] == 1
            for _ in range(2):
                assert _read_once(first, app, auth_headers) == first_data
                assert _read_once(second, other, auth_headers) == second_data
            # Reusing the same expression observes new committed content and version.
            second_data = save(second, '第二库已更新', '更新后的文案', 1, 'expression-second-edit')
            assert second_data['revision'] == 2
            assert _read_once(second, other, auth_headers) == second_data
            assert _read_once(first, app, auth_headers) == first_data
        assert other.state.db_runtime.closed is True
        assert _read_once(first, app, auth_headers) == first_data
        first_data = save(first, '另一app已关闭', '第一个库继续写入', 1, 'expression-first-edit')
        assert first_data['revision'] == 2
        assert _read_once(first, app, auth_headers) == first_data
