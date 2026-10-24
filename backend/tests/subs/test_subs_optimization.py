"""全量排行、汇总/明细边界和版本冲突。"""
from decimal import Decimal
from sqlalchemy.orm import Session


def test_member_list_count_reads_timezone_without_extra_sql(client, auth_headers, app, monkeypatch):
    from datetime import datetime, timezone
    from sqlalchemy import event
    from app.shared import timeutil
    from app.subs.models import SubsMember, SubsSubscription
    from app.todo.models import AppSetting
    monkeypatch.setattr(timeutil, 'now_utc', lambda: datetime(2026, 6, 1, 17, tzinfo=timezone.utc))
    with Session(app.state.engine) as session:
        setting = session.get(AppSetting, 'app')
        if setting is None:
            session.add(AppSetting(key='app', value='{"timezone":"UTC"}'))
        else:
            setting.value = '{"timezone":"UTC"}'
        member = SubsMember(name='跨日会员')
        session.add(member); session.flush()
        session.add(SubsSubscription(member_id=member.id, price=1, currency='CNY', billing_cycle='yearly',
            start_date='2026-01-01', end_date='2026-06-01'))
        session.commit()
    statements = []
    def capture(connection, cursor, statement, parameters, context, many):
        if 'subs_members' in statement.lower() or 'todo_app_settings' in statement.lower():
            statements.append(statement.lower())
    event.listen(app.state.engine, 'before_cursor_execute', capture)
    try:
        response = client.get('/api/subs/members', headers=auth_headers)
    finally:
        event.remove(app.state.engine, 'before_cursor_execute', capture)
    assert response.status_code == 200, response.text
    result = response.json()['data']
    assert result['total'] == 1 and result['items'][0]['status'] == 'active'
    assert len(statements) == 2, statements
    assert 'count(' in statements[0] and 'todo_app_settings' in statements[0]
    assert 'order by' not in statements[0] and 'join' not in statements[0]
    # status过滤只求一次today，再用于COUNT、筛选和DTO，不能在序列化前重读设置。
    statements.clear()
    event.listen(app.state.engine, 'before_cursor_execute', capture)
    try:
        response = client.get('/api/subs/members?status=active', headers=auth_headers)
    finally:
        event.remove(app.state.engine, 'before_cursor_execute', capture)
    assert response.status_code == 200 and response.json()['data']['total'] == 1
    assert len(statements) == 3, statements
    assert sum('todo_app_settings' in statement for statement in statements) == 1


def test_empty_member_count_still_uses_default_timezone(client, auth_headers, app):
    response = client.get('/api/subs/members?keyword=no-such-member', headers=auth_headers)
    assert response.status_code == 200
    assert response.json()['data'] == {'items': [], 'total': 0}


def test_ranking_includes_members_after_first_100(client, auth_headers, app):
    from app.subs.models import SubsMember, SubsSubscription
    with Session(app.state.engine) as session:
        for index in range(105):
            member = SubsMember(name=f'会员 {index:03}')
            session.add(member); session.flush()
            session.add(SubsSubscription(member_id=member.id, price=Decimal('99999' if index == 0 else '1'),
                currency='CNY', billing_cycle='yearly', start_date='2026-01-01', end_date='2026-12-31'))
        session.commit()
    response = client.get('/api/subs/stats/ranking?metric=total_spending&limit=10', headers=auth_headers)
    assert response.status_code == 200, response.text
    result = response.json()['data']
    assert result['total'] == 105 and result['items'][0]['name'] == '会员 000'
    assert result['items'][0]['total_spending'] == 99999


def test_trend_summary_and_paginated_details(client, auth_headers):
    created = client.post('/api/subs/members', json={'name': '汇总测试', 'subscription': {
        'price': 31, 'currency': 'CNY', 'billing_cycle': 'monthly',
        'start_date': '2026-01-01', 'end_date': '2026-01-31'}}, headers=auth_headers)
    assert created.status_code == 201, created.text
    query = 'start_date=2026-01-05&end_date=2026-01-06'
    result = client.get(f'/api/subs/stats/trend?{query}&granularity=month', headers=auth_headers).json()['data']
    assert result['trend'][0]['amount'] == 2 and result['trend'][0]['details'] == []
    legacy = client.get(f'/api/subs/stats/trend?{query}&granularity=month&include_details=1', headers=auth_headers).json()['data']
    assert legacy['trend'][0]['details'][0]['subscriptions'][0]['amount'] == 2
    details = client.get(f'/api/subs/stats/details?{query}&page=1&page_size=1', headers=auth_headers).json()['data']
    assert details['total'] == 1 and details['items'][0]['amount'] == 2
    assert client.get('/api/subs/stats/trend?start_date=2020-01-01&end_date=2026-12-31&granularity=day', headers=auth_headers).status_code == 400


def test_member_and_subscription_stale_revision_are_rejected(client, auth_headers):
    created = client.post('/api/subs/members', json={'name': 'CAS'}, headers=auth_headers).json()['data']
    url = f"/api/subs/members/{created['id']}"
    assert client.put(url, json={'name': 'first', 'revision': 1}, headers=auth_headers).status_code == 200
    assert client.put(url, json={'name': 'stale', 'revision': 1}, headers=auth_headers).status_code == 409
    assert client.get(url, headers=auth_headers).json()['data']['name'] == 'first'


def test_uncategorized_spending_and_empty_periods_are_consistent(client, auth_headers):
    created = client.post('/api/subs/members', json={'name': '未分类支出', 'subscription': {
        'price': 31, 'currency': 'CNY', 'billing_cycle': 'monthly',
        'start_date': '2026-01-01', 'end_date': '2026-01-31'}}, headers=auth_headers)
    assert created.status_code == 201
    query = 'start_date=2026-01-01&end_date=2026-02-28'
    spending = client.get(f'/api/subs/stats/spending?{query}', headers=auth_headers).json()['data']
    categories = client.get(f'/api/subs/stats/by-category?{query}', headers=auth_headers).json()['data']
    trend = client.get(f'/api/subs/stats/trend?{query}&granularity=month', headers=auth_headers).json()['data']['trend']
    assert spending['total'] == categories['total'] == sum(point['amount'] for point in trend) == 31
    assert spending['categories'][0]['category_name'] == '未分类'
    assert trend[1]['amount'] == 0


def test_non_finite_prices_are_rejected(client, auth_headers):
    for price in ('NaN', 'Infinity', '-Infinity', '100000000'):
        response = client.post('/api/subs/members', json={'name': '无效价格', 'subscription': {
            'price': price, 'currency': 'CNY', 'billing_cycle': 'monthly',
            'start_date': '2026-01-01', 'end_date': '2026-01-31'}}, headers=auth_headers)
        assert response.status_code == 400, response.text
