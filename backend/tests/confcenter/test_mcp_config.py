import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.shared.mcp_catalog import McpProvider


ADMIN = '/api/confcenter/mcp'
LOCAL = dict(base_url='http://127.0.0.1:60100', client=('127.0.0.1', 40500))


def issue(client, auth, module='todo'):
    response = client.post(f'{ADMIN}/{module}/tokens', headers=auth, json={})
    assert response.status_code == 201
    return response.json()['data']


def rpc(client, token, method='tools/list', params=None, module='todo'):
    message = {'jsonrpc': '2.0', 'id': 1, 'method': method}
    if params is not None:
        message['params'] = params
    return client.post('/mcp/' + module, json=message, headers={
        'Accept': 'application/json, text/event-stream', 'Authorization': 'Bearer ' + token['token']})


def tool_names(client, token, module='todo'):
    return {t['name'] for t in rpc(client, token, module=module).json()['result']['tools']}


def test_todo_parameter_docs_match_protocol_and_examples_validate(app, auth_headers):
    from jsonschema import Draft202012Validator

    todo = dict(app.state.loaded_modules)['todo'].mcp_provider
    with TestClient(app, **LOCAL) as client:
        catalog = client.get(ADMIN, headers=auth_headers).json()['data']
        tools = next(module['tools'] for module in catalog if module['key'] == 'todo')
        for tool in tools:
            if not tool['enabled']:
                enabled = client.put(f"{ADMIN}/todo/tools/{tool['name']}", headers=auth_headers, json={'enabled': True})
                assert enabled.is_success
        listed = rpc(client, issue(client, auth_headers)).json()['result']['tools']
    protocol_schemas = {tool['name']: tool['inputSchema'] for tool in listed}
    assert set(protocol_schemas) == {tool['name'] for tool in tools}
    for tool in tools:
        name = tool['name']
        schema = tool['input_schema']
        assert schema == protocol_schemas[name]
        example_args = {}
        for param, field in schema['properties'].items():
            assert field.get('description', '').strip(), f'{name}.{param} 缺少参数含义'
            assert field.get('examples'), f'{name}.{param} 缺少示例'
            example_args[param] = field['examples'][0]
        Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER).validate(example_args)
        todo.tools[name].inputs.model_validate(example_args)


@pytest.mark.parametrize(('base_url', 'caller'), [
    ('http://192.0.2.10:60100', '192.0.2.25'),
    ('http://[2001:db8::10]:60100', '2001:db8::25'),
    ('https://todo.example.test', '192.0.2.25'),
])
def test_remote_mcp_without_public_origin(app, auth_headers, monkeypatch, base_url, caller):
    from app.config import settings
    monkeypatch.setattr(settings, 'mcp_public_origin', '')
    with TestClient(app, base_url=base_url, client=(caller, 40000)) as remote:
        token = issue(remote, auth_headers)
        catalog = next(m for m in remote.get(ADMIN, headers=auth_headers).json()['data'] if m['key'] == 'todo')
        assert catalog['remote_enabled']
        assert catalog['endpoint'] == f'{base_url}/mcp/todo'
        assert remote.post('/mcp/todo', json={}).status_code == 401
        assert len(tool_names(remote, token)) == 13
        response = rpc(remote, token, 'tools/call', {'name': 'get_today', 'arguments': {}})
        assert response.status_code == 200 and response.json()['result']
        remote.headers['Origin'] = base_url
        assert rpc(remote, token).status_code == 200
        remote.headers['Origin'] = 'https://other.example.test'
        assert rpc(remote, token).status_code == 403


def test_public_origin_is_optional_and_sets_advertised_url(app, auth_headers, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, 'mcp_public_origin', 'https://mcp.example.test:8443/')
    public_host = 'mcp.example.test:8443'
    external = ('192.0.2.25', 40000)
    proxy_app = ProxyHeadersMiddleware(app, trusted_hosts='127.0.0.1')
    with TestClient(app, **LOCAL) as owner:
        token = issue(owner, auth_headers)
        catalog = next(m for m in owner.get(ADMIN, headers=auth_headers).json()['data'] if m['key'] == 'todo')
        assert catalog['remote_enabled'] and catalog['endpoint'] == f'https://{public_host}/mcp/todo'
        tool = next(t for t in catalog['tools'] if t['name'] == 'create_task')
        assert tool['description'] and not tool['read_only']
        assert set(tool['input_schema']['required']) == {'title', 'mutation_id'}
        assert 'task_date' in tool['input_schema']['properties']
        assert tool_names(owner, token)
        with TestClient(app, base_url='https://' + public_host, client=external) as remote:
            assert remote.post('/mcp/todo', json={}).status_code == 401
            assert len(tool_names(remote, token)) == 13
            remote.headers['Origin'] = 'https://' + public_host
            assert rpc(remote, token).status_code == 200
            remote.headers['Origin'] = 'https://other.example.test'
            assert rpc(remote, token).status_code == 403
            del remote.headers['Origin']
            remote.headers['Host'] = 'localhost:60100'
            assert rpc(remote, token).status_code == 200
        with TestClient(proxy_app, base_url='http://backend.internal:60100', client=('127.0.0.1', 41000)) as proxy:
            proxy.headers.update({'X-Forwarded-Proto': 'https', 'X-Forwarded-For': external[0],
                                  'Origin': f'https://{public_host}'})
            assert rpc(proxy, token).status_code == 200


def test_configured_origin_must_be_an_http_origin(monkeypatch):
    from app.config import settings
    from app.confcenter.mcp_network import McpNetwork
    for value in ('ftp://host.example', 'https://*.example', 'https://a@b.test',
                  'https://host.example/path', 'https://host.example?token=x', 'https://host.example:0'):
        monkeypatch.setattr(settings, 'mcp_public_origin', value)
        with pytest.raises(ValueError, match='DOUBLOG_MCP_PUBLIC_ORIGIN'):
            McpNetwork.configured()
    monkeypatch.setattr(settings, 'mcp_public_origin', 'https://Mcp.example.test:443/')
    origin = McpNetwork.configured()
    assert origin.public_origin == 'https://mcp.example.test'
    monkeypatch.setattr(settings, 'mcp_public_origin', 'http://192.0.2.10:60100')
    assert McpNetwork.configured().public_origin == 'http://192.0.2.10:60100'


def test_renew_active_expired_stale_and_revoked_tokens(app, auth_headers):
    from app.confcenter.models import McpToken
    from app.shared.timeutil import now_utc
    with TestClient(app, **LOCAL) as client:
        item = issue(client, auth_headers)
        path = f"{ADMIN}/todo/tokens/{item['id']}/renew"
        expected = {'expected_expires_at': item['expires_at']}
        assert client.post(path, headers={'Authorization': 'Bearer ' + item['token']}, json=expected).status_code == 401
        assert client.post(path, headers=auth_headers, json={'expected_expires_at': '9999-12-30T00:00:00Z'}).status_code == 422
        response = client.post(path, headers=auth_headers, json=expected)
        assert response.status_code == 200 and item['token'] not in response.text
        renewed = response.json()['data']
        original_end = datetime.fromisoformat(item['expires_at'])
        assert datetime.fromisoformat(renewed['expires_at']) == original_end + timedelta(days=30)
        assert renewed['id'] == item['id'] and rpc(client, item).status_code == 200
        assert client.post(path, headers=auth_headers, json=expected).status_code == 409
        with Session(app.state.engine) as session:
            record = session.get(McpToken, item['id'])
            record.expires_at = now_utc() - timedelta(days=2)
            session.commit()
        old = client.get(ADMIN + '/todo/tokens', headers=auth_headers).json()['data'][0]
        assert rpc(client, item).status_code == 401
        start = now_utc()
        resumed = client.post(path, headers=auth_headers, json={'expected_expires_at': old['expires_at']})
        assert resumed.status_code == 200
        end = datetime.fromisoformat(resumed.json()['data']['expires_at'])
        assert start + timedelta(days=30) <= end <= now_utc() + timedelta(days=30)
        assert rpc(client, item).status_code == 200
        client.delete(path.removesuffix('/renew'), headers=auth_headers)
        assert client.post(path, headers=auth_headers, json=expected).status_code == 404
        assert rpc(client, item).status_code == 401


def test_settings_apply_to_existing_tokens_and_survive_restart(app, auth_headers):
    from app.main import create_app

    with TestClient(app, **LOCAL) as client:
        first, second = issue(client, auth_headers), issue(client, auth_headers)
        setting = ADMIN + '/todo/tools/'
        args = {'name': 'create_task', 'arguments': {'title': '不应创建', 'mutation_id': str(uuid4())}}
        all_tools = tool_names(client, first)
        assert len(all_tools) == 13
        assert client.get(ADMIN).status_code == 401
        assert client.put(setting + 'create_task', headers={'Authorization': 'Bearer ' + first['token']},
                          json={'enabled': False}).status_code == 401
        assert client.put(setting + 'unknown', headers=auth_headers, json={'enabled': True}).status_code == 404
        assert client.post(ADMIN + '/missing-module/tokens', headers=auth_headers, json={}).status_code == 404
        for name in all_tools:
            assert client.put(setting + name, headers=auth_headers, json={'enabled': False}).status_code == 200
        for token in [first, second]:
            assert not tool_names(client, token)
            assert rpc(client, token, 'tools/call', args).json()['error']['code'] == -32602
        assert client.get('/api/todo/tasks?q=不应创建', headers=auth_headers).json()['data'] == []

    with TestClient(create_app(), **LOCAL) as restarted:
        assert not tool_names(restarted, first)
        assert restarted.put(setting + 'get_today', headers=auth_headers, json={'enabled': True}).is_success
        assert tool_names(restarted, second) == {'get_today'}
        assert 'result' in rpc(restarted, first, 'tools/call', {'name': 'get_today', 'arguments': {}}).json()
        assert rpc(restarted, first, 'tools/call', args).json()['error']['code'] == -32602


def test_registered_modules_have_separate_tools_and_credentials(app, auth_headers):
    todo = dict(app.state.loaded_modules)['todo'].mcp_provider
    demo = McpProvider('测试模块', 'example', '', {'get_today': todo.tools['get_today']},
                       lambda name, args, token_id: {'module': 'example'})
    app.state.loaded_modules.append(('example', SimpleNamespace(mcp_provider=demo)))
    with TestClient(app, **LOCAL) as client:
        modules = client.get(ADMIN, headers=auth_headers).json()['data']
        assert {m['key'] for m in modules} >= {'todo', 'subs', 'example'}
        todo_token = issue(client, auth_headers)
        demo_token = issue(client, auth_headers, 'example')
        assert client.post(f"{ADMIN}/example/tokens/{todo_token['id']}/renew", headers=auth_headers,
                           json={'expected_expires_at': todo_token['expires_at']}).status_code == 404
        assert rpc(client, todo_token, module='example').status_code == 401
        assert rpc(client, demo_token).status_code == 401
        assert not tool_names(client, demo_token, 'example')
        assert client.put(ADMIN + '/example/tools/get_today', headers=auth_headers, json={'enabled': True}).is_success
        assert client.put(ADMIN + '/todo/tools/get_today', headers=auth_headers, json={'enabled': False}).is_success
        assert 'get_today' not in tool_names(client, todo_token)
        assert tool_names(client, demo_token, 'example') == {'get_today'}
        assert client.get(ADMIN + '/example/tokens', headers=auth_headers).json()['data'][0]['id'] == demo_token['id']
        client.delete(ADMIN + '/example/tokens/' + todo_token['id'], headers=auth_headers)
        assert rpc(client, todo_token).status_code == 200
        client.delete(ADMIN + '/todo/tokens/' + todo_token['id'], headers=auth_headers)
        assert rpc(client, todo_token).status_code == 401
        assert rpc(client, demo_token, module='example').status_code == 200


def test_legacy_token_moves_once_with_its_identity_and_expiry(app, tmp_path, auth_headers):
    from app.main import create_app
    from app.shared.timeutil import now_utc

    engine = app.state.engine
    assert engine.dialect.name == 'sqlite' and tmp_path in Path(engine.url.database).parents
    secret = 'dbmcp_' + 'x' * 43
    now = now_utc()
    token = {'token': secret, 'id': str(uuid4())}
    with engine.begin() as conn:
        conn.execute(text('DROP TABLE confcenter_mcp_tokens'))
        conn.execute(text('CREATE TABLE todo_mcp_tokens (id VARCHAR(36) PRIMARY KEY, name VARCHAR(64) NOT NULL, '
                          'digest VARCHAR(64) UNIQUE NOT NULL, hint VARCHAR(4) NOT NULL, database_identity VARCHAR(64) NOT NULL, '
                          'created_at TIMESTAMP NOT NULL, expires_at TIMESTAMP NOT NULL)'))
        conn.execute(text('INSERT INTO todo_mcp_tokens VALUES (:id, :name, :digest, :hint, :db, :now, :expiry)'),
                     {'id': token['id'], 'name': '旧客户端', 'digest': hashlib.sha256(secret.encode()).hexdigest(),
                      'hint': secret[-4:], 'db': app.state.db_runtime.identity, 'now': now, 'expiry': now + timedelta(days=4)})
    upgraded = create_app()
    assert not inspect(upgraded.state.engine).has_table('todo_mcp_tokens')
    with TestClient(upgraded, **LOCAL) as client:
        rows = client.get(ADMIN + '/todo/tokens', headers=auth_headers).json()['data']
        assert [row['id'] for row in rows] == [token['id']]
        assert len(tool_names(client, token)) == 13
        assert client.delete(ADMIN + '/todo/tokens/' + token['id'], headers=auth_headers).is_success
    with TestClient(create_app(), **LOCAL) as restarted:
        assert rpc(restarted, token).status_code == 401
