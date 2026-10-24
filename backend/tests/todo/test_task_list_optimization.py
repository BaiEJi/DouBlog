"""列表单次业务日期、按返回项取分类及兼容分页形状。"""
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import event, insert, select
from sqlalchemy.orm import Session


@pytest.mark.parametrize('query,expected_ids,sql_count,categories_read', [
    ('?q=uncat', ['list-uncat'], 2, False),
    ('?page=1&page_size=1', ['list-uncat'], 3, False),
    ('?page=2&page_size=1', ['list-cat'], 4, True),
    ('', ['list-uncat', 'list-cat'], 3, True),
])
def test_list_reads_one_setting_and_only_required_categories(client, app, query, expected_ids, sql_count, categories_read):
    from app.todo.models import Category, Task
    stamp = datetime(2026, 10, 21, tzinfo=timezone.utc)
    with Session(app.state.engine) as session:
        category = session.scalar(select(Category).limit(1))
        category_id, name, color = category.id, category.name, category.color
        session.execute(insert(Task), [
            {'id': 'list-uncat', 'title': 'uncat task', 'description': '正文保留',
             'position': 1., 'created_at': stamp, 'updated_at': stamp},
            {'id': 'list-cat', 'title': 'categorized task', 'category_id': category_id,
             'description': '有分类正文保留', 'position': 2., 'created_at': stamp, 'updated_at': stamp},
        ])
        session.commit()
    statements = []
    def capture(connection, cursor, statement, parameters, context, many):
        lowered = statement.lower()
        if any(table in lowered for table in ('todo_tasks', 'todo_app_settings', 'todo_categories')):
            statements.append(lowered)
    event.listen(app.state.engine, 'before_cursor_execute', capture)
    try:
        response = client.get('/api/todo/tasks' + query)
    finally:
        event.remove(app.state.engine, 'before_cursor_execute', capture)
    assert response.status_code == 200, response.text
    body = response.json()['data']
    if 'page=' in query:
        assert body['total'] == 2 and body['page_size'] == 1
        items = body['items']
    else:
        assert isinstance(body, list)
        items = body
    assert [item['id'] for item in items] == expected_ids
    assert len(statements) == sql_count, statements
    assert sum('todo_app_settings' in sql for sql in statements) == 1
    assert any('todo_categories' in sql for sql in statements) is categories_read
    for item in items:
        assert item['revision'] == 1 and item['description'].endswith('正文保留')
        if item['id'] == 'list-cat':
            assert (item['category_id'], item['category_name'], item['category_color']) == (category_id, name, color)
        else:
            assert item['category_id'] is item['category_name'] is item['category_color'] is None


def test_today_alias_filter_and_dto_share_one_clock_across_midnight(client, app, monkeypatch):
    from app.shared import timeutil
    from app.todo.models import AppSetting, Task
    from app.todo.services.tasks import list_tasks
    stamp = datetime(2026, 10, 21, tzinfo=timezone.utc)
    with Session(app.state.engine) as session:
        setting = session.get(AppSetting, 'app')
        if setting is None:
            session.add(AppSetting(key='app', value='{"timezone":"UTC"}'))
        else:
            setting.value = '{"timezone":"UTC"}'
        session.execute(insert(Task), [
            {'id': 'before-midnight', 'title': '当日任务', 'task_date': date(2026, 10, 21),
             'original_date': date(2026, 10, 20), 'created_at': stamp, 'updated_at': stamp},
            {'id': 'after-midnight', 'title': '次日任务', 'task_date': date(2026, 10, 22),
             'original_date': date(2026, 10, 20), 'created_at': stamp, 'updated_at': stamp},
        ])
        session.commit()
    clock_calls = []
    def crossing_clock():
        clock_calls.append(True)
        return datetime(2026, 10, 21, 23, 59, tzinfo=timezone.utc) if len(clock_calls) == 1 else datetime(2026, 10, 22, 0, 1, tzinfo=timezone.utc)
    monkeypatch.setattr(timeutil, 'now_utc', crossing_clock)
    response = client.get('/api/todo/tasks?date=today&status=all')
    assert response.status_code == 200, response.text
    items = response.json()['data']
    assert [item['id'] for item in items] == ['before-midnight']
    assert items[0]['task_date'] == '2026-10-21' and items[0]['days_procrastinated'] == 1
    assert len(clock_calls) == 1
    # 不传today的既有直接服务调用仍兼容，也不能在解析today时再读时钟。
    clock_calls.clear()
    with Session(app.state.engine) as session:
        assert [task.id for task in list_tasks(session, date_str='today', status='all')] == ['before-midnight']
    assert len(clock_calls) == 1
