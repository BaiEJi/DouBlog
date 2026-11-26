from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

ADMIN = '/api/confcenter/mcp'
PATH = '/mcp/subs'
TOOLS = {
    'search_memberships', 'get_membership', 'get_expiring_subscriptions', 'get_spending_report',
    'create_membership', 'record_subscription', 'update_membership', 'update_subscription',
    'save_category', 'delete_subscription',
}


@pytest.fixture
def client_mcp(app):
    with TestClient(app, base_url='http://192.0.2.10:60100', client=('192.0.2.25', 40000)) as client:
        yield client


def token_headers(client, auth, module='subs'):
    response = client.post(f'{ADMIN}/{module}/tokens', headers=auth, json={'name': '订阅 MCP 测试'})
    assert response.status_code == 201
    return {'Authorization': 'Bearer ' + response.json()['data']['token'],
            'Accept': 'application/json, text/event-stream'}


def rpc(client, headers, method, params=None, path=PATH):
    body = {'jsonrpc': '2.0', 'id': 1, 'method': method}
    if params is not None:
        body['params'] = params
    return client.post(path, headers=headers, json=body)


def call(client, headers, name, args, *, error=None):
    response = rpc(client, headers, 'tools/call', {'name': name, 'arguments': args})
    assert response.status_code == 200, response.text
    result = response.json()['result']
    if error is not None:
        assert result['isError'] and error in result['content'][0]['text'], result
        return
    assert not result.get('isError'), result
    return result['structuredContent']


def enable(client, auth, names):
    for name in names:
        response = client.put(f'{ADMIN}/subs/tools/{name}', headers=auth, json={'enabled': True})
        assert response.status_code == 200, response.text


def test_catalog_and_token_isolation(client_mcp, auth_headers):
    catalog = client_mcp.get(ADMIN, headers=auth_headers).json()['data']
    subs = next(module for module in catalog if module['key'] == 'subs')
    assert subs['endpoint'] == 'http://192.0.2.10:60100/mcp/subs'
    assert {tool['name'] for tool in subs['tools']} == TOOLS
    assert not any(tool['enabled'] for tool in subs['tools'])
    for tool in subs['tools']:
        for field in tool['input_schema']['properties'].values():
            assert field['description'] and field['examples']

    assert rpc(client_mcp, {}, 'tools/list').status_code == 401
    token = token_headers(client_mcp, auth_headers)
    todo = token_headers(client_mcp, auth_headers, 'todo')
    assert rpc(client_mcp, todo, 'tools/list').status_code == 401
    assert rpc(client_mcp, token, 'tools/list', path='/mcp/todo').status_code == 401
    assert rpc(client_mcp, token, 'tools/list').json()['result']['tools'] == []
    enabled = {'search_memberships', 'delete_subscription'}
    enable(client_mcp, auth_headers, enabled)
    exposed = rpc(client_mcp, token, 'tools/list').json()['result']['tools']
    assert {tool['name'] for tool in exposed} == enabled
    for removed in ('delete_membership', 'delete_category', 'update_subscription'):
        result = rpc(client_mcp, token, 'tools/call', {'name': removed, 'arguments': {}})
        assert result.json()['error']['code'] == -32602


def test_subscription_workflow_and_reporting(client_mcp, auth_headers):
    token = token_headers(client_mcp, auth_headers)
    enable(client_mcp, auth_headers, TOOLS)
    today = date.today()
    start, end = today.isoformat(), (today + timedelta(days=2)).isoformat()
    period = {'price': 30, 'currency': 'CNY', 'billing_cycle': 'custom', 'custom_days': 3,
              'start_date': start, 'end_date': end}

    def write(tool, **fields):
        return call(client_mcp, token, tool, {'mutation_id': uuid4().hex, **fields})

    category = write('save_category', name='云服务', color='#0E7490')
    category = write('save_category', category_id=category['id'], icon='☁')
    assert category['color'] == '#0E7490'
    empty = write('save_category', name='空分类')
    member = write('create_membership', name='云盘', category_id=category['id'], reminder_days=7, subscription=period)
    mem_id = member['id']
    first = member['subscriptions'][0]
    assert member['subscription_count'] == 1 and first['price'] == 30

    member = write('update_membership', member_id=mem_id, revision=member['revision'], notes='自动同步')
    summary = call(client_mcp, token, 'search_memberships', {'keyword': '云', 'include_categories': True})
    assert summary['items'][0]['notes'] == '自动同步' and summary['total'] == 1
    assert {c['id'] for c in summary['categories']} == {category['id'], empty['id']}
    assert call(client_mcp, token, 'get_membership', {'subscription_id': first['id']})['member']['id'] == mem_id
    reminders = call(client_mcp, token, 'get_expiring_subscriptions', {'days_ahead': 7})
    assert [item['subscription_id'] for item in reminders['items']] == [first['id']]
    assert call(client_mcp, token, 'get_expiring_subscriptions', {})['total'] == 1
    assert call(client_mcp, token, 'get_expiring_subscriptions', {'days_ahead': 0})['total'] == 0
    report = call(client_mcp, token, 'get_spending_report', {
        'sections': ['overview', 'summary', 'category_summary', 'trend', 'ranking', 'details'],
        'start_date': start, 'end_date': end, 'category_id': category['id'], 'granularity': 'day',
    })
    web = client_mcp.get('/api/subs/stats/spending', headers=auth_headers, params={'start_date': start, 'end_date': end})
    assert report['summary'] == web.json()['data']
    assert sum(row['amount'] for row in report['trend']) == 30
    assert report['ranking']['items'][0]['id'] == mem_id
    assert report['details']['items'][0]['subscription_id'] == first['id']
    assert report['overview']['total_members'] == 1 and 'category_summary' in report

    after = today + timedelta(days=3)
    record = {'mutation_id': uuid4().hex, 'member_id': mem_id, **period,
              'start_date': after.isoformat(), 'end_date': (after + timedelta(days=2)).isoformat()}
    with ThreadPoolExecutor(max_workers=2) as pool:
        def record_once(_):
            return call(client_mcp, token, 'record_subscription', record)
        renewed, retry = list(pool.map(record_once, range(2)))
    assert retry['id'] == renewed['id']
    call(client_mcp, token, 'record_subscription', {**record, 'price': 50}, error='409')
    detail = call(client_mcp, token, 'get_membership', {'member_id': mem_id, 'page_size': 1})
    assert detail['history']['total'] == 2 and len(detail['history']['items']) == 1
    corrected = write('update_subscription', subscription_id=first['id'], revision=first['revision'], price=24)
    call(client_mcp, token, 'update_subscription', {
        'mutation_id': uuid4().hex, 'subscription_id': first['id'], 'revision': first['revision'], 'price': 10,
    }, error='409')
    assert client_mcp.get(f"/api/subs/subscriptions/{first['id']}", headers=auth_headers).json()['data']['price'] == 24
    removal = {'mutation_id': uuid4().hex, 'subscription_id': first['id'], 'revision': corrected['revision']}
    assert call(client_mcp, token, 'delete_subscription', removal)['deleted']
    assert call(client_mcp, token, 'delete_subscription', removal)['deleted']
    assert call(client_mcp, token, 'get_membership', {'member_id': mem_id})['history']['total'] == 1

    call(client_mcp, token, 'create_membership', {
        'mutation_id': uuid4().hex, 'name': '回滚测试', 'category_id': 2147483647, 'subscription': period,
    }, error='分类不存在')
    assert call(client_mcp, token, 'search_memberships', {'keyword': '回滚测试'})['total'] == 0
