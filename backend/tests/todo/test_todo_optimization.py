"""SQL CAS、幂等排序、日历投影和缓存回填竞态。"""
from datetime import date, datetime, timezone

from sqlalchemy import insert
from sqlalchemy.orm import Session


def test_move_revision_and_idempotent_retry(client):
    task = client.post('/api/todo/tasks', json={'title': '版本任务'}).json()['data']
    body = {'is_important': True, 'is_urgent': False, 'revision': task['revision'],
            'mutation_id': 'todo-move-1'}
    moved = client.post(f"/api/todo/tasks/{task['id']}/move", json=body)
    assert moved.status_code == 200, moved.text
    assert client.post(f"/api/todo/tasks/{task['id']}/move", json=body).json() == moved.json()
    assert moved.json()['data']['revision'] == task['revision'] + 1
    assert client.post(f"/api/todo/tasks/{task['id']}/reorder", json={'revision': task['revision']}).status_code == 409


def test_today_cache_old_read_cannot_fill_new_epoch():
    from app.todo import readcache
    state = {}; key = ('database-1', '2026-10-21')
    started = readcache.epoch()
    readcache.bump()  # 模拟查询结束前另一请求提交写入。
    assert readcache.put(state, key, b'old-read', started) is False
    assert readcache.get(state, key) is None
    assert readcache.put(state, key, b'fresh-read', readcache.epoch()) is True
    assert readcache.get(state, key) == b'fresh-read'


def test_inbox_pagination_and_calendar_count_not_sample_length(client, app):
    from app.todo.models import Task
    stamp = datetime.now(timezone.utc)
    with Session(app.state.engine) as session:
        session.execute(insert(Task), [{'id': f'calendar-{index}', 'title': f'任务 {index}',
            'description': '不应进入日历的大正文' * 1000, 'status': 'done' if index < 5 else 'pending',
            'task_date': date(2026, 10, 21), 'is_important': True, 'is_urgent': False,
            'position': float(index + 1), 'created_at': stamp, 'updated_at': stamp} for index in range(10)])
        session.execute(insert(Task), [{'id': f'inbox-{index}', 'title': f'收件箱 {index}',
            'status': 'pending', 'created_at': stamp, 'updated_at': stamp} for index in range(105)])
        session.commit()
    page = client.get('/api/todo/tasks?inbox=true&page=3&page_size=50').json()['data']
    assert page['total'] == 105 and len(page['items']) == 5
    response = client.get('/api/todo/tasks/calendar?from=2026-10-01&to=2026-10-31')
    assert response.status_code == 200, response.text
    summary = response.json()['data']
    assert summary['total'] == 10
    assert summary['days'][0]['total'] == 10 and summary['days'][0]['done'] == 5
    assert len(summary['days'][0]['items']) == 4
    assert 'description' not in summary['days'][0]['items'][0]


def test_plan_instance_database_uniqueness(app):
    from app.todo.models import Task
    from sqlalchemy.exc import IntegrityError
    import pytest
    stamp = datetime.now(timezone.utc)
    with Session(app.state.engine) as session:
        base = {'title': '计划实例', 'plan_id': 'plan-same', 'task_date': date(2026, 10, 21),
                'created_at': stamp, 'updated_at': stamp}
        session.execute(insert(Task), [{'id': 'instance-one', **base}]); session.commit()
        with pytest.raises(IntegrityError):
            session.execute(insert(Task), [{'id': 'instance-two', **base}]); session.commit()
        session.rollback()
