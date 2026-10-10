"""API Hub 接口测试：管理端 CRUD + 网关双模式端到端（真实本地 mock 上游）。

覆盖：上游/密钥脱敏/API/令牌(明文一次性)/限流规则校验、invoke 注入与透传、
信封模式、form body、路径模板、多级限流 429、token×API 隔离、配额并发不超卖、
上游 401 自动禁用换 key、body-code 错误归一化、超时 504、透明代理、探活、日志统计。
"""

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

ECHO_HEADERS = {'authorization', 'x-api-key', 'x-shopify-access-token', 'cookie', 'content-type'}


def _make_handler():
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, obj, status=200):
            body = json.dumps(obj).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _read_body(self):
            n = int(self.headers.get('Content-Length') or 0)
            raw = self.rfile.read(n) if n else b''
            if self.headers.get('Content-Type', '').startswith('application/x-www-form-urlencoded'):
                from urllib.parse import parse_qs
                return {k: v[0] for k, v in parse_qs(raw.decode()).items()}
            if raw:
                try:
                    return json.loads(raw)
                except ValueError:
                    return raw.decode(errors='replace')
            return None

        def do_GET(self):
            self._route('GET')

        def do_POST(self):
            self._route('POST')

        def _route(self, method):
            path = self.path.split('?')[0]
            if path == '/health':
                self._send({'ok': True})
            elif path == '/echo' or path.startswith('/echo/'):
                from urllib.parse import parse_qs, urlsplit
                q = urlsplit(self.path).query
                self._send({
                    'method': method,
                    'query': {k: v[0] for k, v in parse_qs(q).items()},
                    'headers': {k.lower(): v for k, v in self.headers.items()
                                if k.lower() in ECHO_HEADERS},
                    'body': self._read_body(),
                    'path': path,
                })
            elif path == '/protected':
                if self.headers.get('Authorization') != 'Bearer good-key':
                    self._send({'error': 'unauthorized'}, 401)
                else:
                    self._send({'secret': 'data'})
            elif path == '/biz':
                fail = 'fail=1' in self.path
                self._send({'code': 500 if fail else 0, 'msg': 'boom' if fail else 'ok',
                            'data': {'x': 1}})
            elif path == '/slow':
                time.sleep(1.2)
                self._send({'ok': 1})
            else:
                self._send({'error': 'not found'}, 404)

    return Handler


@pytest.fixture(scope='module')
def upstream_base():
    server = ThreadingHTTPServer(('127.0.0.1', 0), _make_handler())
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f'http://127.0.0.1:{server.server_address[1]}'
    server.shutdown()


BEARER_AUTH = {'providers': [{'type': 'bearer', 'value': '{cred.token}'}],
               'credential_fields': ['token'], 'transport': {}}


def _setup_env(client, auth_headers, upstream_base, *, slug_suffix='', providers=None,
               keys=None, path_tpl='/echo', method='POST', request_cfg=None,
               response_cfg=None, probe=None, token_kwargs=None):
    """建 上游+key(s)+API+令牌，返回 (api_id, token_id, sk 明文)。"""
    suffix = slug_suffix or 'env'
    r = client.post('/api/apihub/admin/upstreams', headers=auth_headers, json={
        'name': f'u-{suffix}', 'slug': f'u-{suffix}', 'base_url': upstream_base,
        'timeout_ms': 3000, 'max_retry': 0, 'auth_config': providers or BEARER_AUTH})
    assert r.status_code == 200, r.json()
    uid = r.json()['data']['id']
    for cred in (keys or [{'token': 'good-key'}]):
        rr = client.post(f'/api/apihub/admin/upstreams/{uid}/keys', headers=auth_headers,
                         json={'credential': cred, 'weight': 1})
        assert rr.status_code == 200
    r = client.post('/api/apihub/admin/apis', headers=auth_headers, json={
        'name': f'a-{suffix}', 'slug': f'a-{suffix}', 'upstream_id': uid,
        'method': method, 'path_tpl': path_tpl,
        'request_cfg': request_cfg, 'response_cfg': response_cfg, 'probe': probe})
    assert r.status_code == 200, r.json()
    api_id = r.json()['data']['id']
    body = {'name': f't-{suffix}'}
    body.update(token_kwargs or {})
    r = client.post('/api/apihub/admin/tokens', headers=auth_headers, json=body)
    assert r.status_code == 200
    data = r.json()['data']
    return api_id, data['id'], data['key']


def _gw(client, slug, sk, json_body=None, method='POST', path=None):
    headers = {'Authorization': f'Bearer {sk}'}
    if method == 'POST':
        return client.post(f'/api/apihub/gw/apis/{slug}', headers=headers, json=json_body or {})
    return client.get(f'/api/apihub/gw/{path}', headers=headers)


# ─── 管理端 ─────────────────────────────────────────────────────────

class TestAdmin:
    def test_requires_auth(self, client):
        for p in ('/api/apihub/admin/upstreams', '/api/apihub/admin/apis',
                  '/api/apihub/admin/tokens', '/api/apihub/admin/rules',
                  '/api/apihub/logs', '/api/apihub/stats/overview'):
            assert client.get(p).status_code == 401, p

    def test_upstream_crud_and_masking(self, client, auth_headers, upstream_base):
        # 无效 providers
        r = client.post('/api/apihub/admin/upstreams', headers=auth_headers, json={
            'name': 'x', 'slug': 'x', 'base_url': 'http://x',
            'auth_config': {'providers': [{'type': 'nope'}], 'credential_fields': ['a']}})
        assert r.status_code == 400
        # 创建 + auth_config 回读
        r = client.post('/api/apihub/admin/upstreams', headers=auth_headers, json={
            'name': 'U', 'slug': 'crud-u', 'base_url': upstream_base,
            'auth_config': BEARER_AUTH})
        assert r.status_code == 200
        uid = r.json()['data']['id']
        assert r.json()['data']['auth_config']['providers'][0]['type'] == 'bearer'
        # slug 冲突
        r = client.post('/api/apihub/admin/upstreams', headers=auth_headers, json={
            'name': 'U2', 'slug': 'crud-u', 'base_url': 'http://x', 'auth_config': BEARER_AUTH})
        assert r.status_code == 400
        # key 增删 + 脱敏（不回明文）
        r = client.post(f'/api/apihub/admin/upstreams/{uid}/keys', headers=auth_headers,
                        json={'credential': {'token': 'verylongsecret123'}})
        assert r.status_code == 200
        keys = client.get(f'/api/apihub/admin/upstreams/{uid}/keys',
                          headers=auth_headers).json()['data']
        assert 'verylongsecret123' not in json.dumps(keys)
        assert keys[0]['credential']['token'] == 'ver***23'
        # 更新 + 删除
        r = client.put(f'/api/apihub/admin/upstreams/{uid}', headers=auth_headers, json={
            'name': 'U2', 'slug': 'crud-u', 'base_url': 'http://updated',
            'auth_config': BEARER_AUTH})
        assert r.status_code == 200
        assert client.delete(f'/api/apihub/admin/upstreams/{uid}',
                             headers=auth_headers).status_code == 200

    def test_upstream_delete_blocked_by_api(self, client, auth_headers, upstream_base):
        _api_id, _tid, _sk = _setup_env(client, auth_headers, upstream_base,
                                        slug_suffix='blk')
        items = client.get('/api/apihub/admin/upstreams', headers=auth_headers).json()['data']
        uid = next(u['id'] for u in items if u['slug'] == 'u-blk')
        assert client.delete(f'/api/apihub/admin/upstreams/{uid}',
                             headers=auth_headers).status_code == 400

    def test_token_plaintext_once(self, client, auth_headers):
        r = client.post('/api/apihub/admin/tokens', headers=auth_headers,
                        json={'name': 'tk', 'quota_total': 100})
        data = r.json()['data']
        assert data['key'].startswith('sk-')
        items = client.get('/api/apihub/admin/tokens', headers=auth_headers).json()['data']
        assert 'key' not in items[-1]

    def test_rule_validation(self, client, auth_headers):
        bad = [
            {'scope': 'wrong'},
            {'scope': 'token_api', 'api_id': 1},
            {'scope': 'global', 'algorithm': 'token_bucket'},
            {'scope': 'global', 'algorithm': 'fixed_window', 'window_s': 60},
        ]
        for b in bad:
            r = client.post('/api/apihub/admin/rules', headers=auth_headers, json=b)
            assert r.status_code == 400, b
        r = client.post('/api/apihub/admin/rules', headers=auth_headers, json={
            'scope': 'global', 'algorithm': 'fixed_window', 'window_s': 60, 'max_count': 1000})
        assert r.status_code == 200
        items = client.get('/api/apihub/admin/rules', headers=auth_headers).json()['data']
        assert items[-1]['usage']['algorithm'] == 'fixed_window'


# ─── 网关 ───────────────────────────────────────────────────────────

class TestGateway:
    def test_invoke_bearer_injection(self, client, auth_headers, upstream_base):
        _api_id, _tid, sk = _setup_env(client, auth_headers, upstream_base)
        r = _gw(client, 'a-env', sk, {'query': {'x': '1'}, 'body': {'hello': 'world'}})
        assert r.status_code == 200
        data = r.json()
        assert data['headers']['authorization'] == 'Bearer good-key'
        assert data['query'] == {'x': '1'}
        assert data['body'] == {'hello': 'world'}

    def test_wrap_envelope_and_body_code(self, client, auth_headers, upstream_base):
        _a, _t, sk = _setup_env(client, auth_headers, upstream_base, slug_suffix='wrap',
                                path_tpl='/biz', method='GET', response_cfg={
                                    'envelope': 'wrap',
                                    'error_mapping': {'body_code_path': '$.code',
                                                      'success_codes': [0],
                                                      'body_message_path': '$.msg'}})
        r = _gw(client, 'a-wrap', sk, {'query': {'fail': '1'}})
        assert r.status_code == 200
        body = r.json()
        assert body['code'] == 500 and body['message'] == 'boom'
        r = _gw(client, 'a-wrap', sk, {})
        assert r.json()['code'] == 0

    def test_form_body_and_path_template(self, client, auth_headers, upstream_base):
        _a, _t, sk = _setup_env(client, auth_headers, upstream_base, slug_suffix='form',
                                path_tpl='/echo/{path.seg}', method='POST',
                                request_cfg={'body': {'type': 'form'}})
        r = _gw(client, 'a-form', sk, {'path': {'seg': 'abc'}, 'body': {'a': '1'}})
        assert r.status_code == 200
        data = r.json()
        assert data['path'] == '/echo/abc'
        assert data['body'] == {'a': '1'}

    def test_auth_401_and_404(self, client, auth_headers, upstream_base):
        _a, _t, sk = _setup_env(client, auth_headers, upstream_base)
        assert _gw(client, 'a-env', 'sk-bad').status_code == 401
        assert client.post('/api/apihub/gw/apis/no-such',
                           headers={'Authorization': 'Bearer sk-x'},
                           json={}).status_code in (401, 404)   # 坏令牌在先 → 401

    def test_rate_limit_api_scope(self, client, auth_headers, upstream_base):
        api_id, _t, sk = _setup_env(client, auth_headers, upstream_base, slug_suffix='rl')
        r = client.post('/api/apihub/admin/rules', headers=auth_headers, json={
            'scope': 'api', 'api_id': api_id, 'algorithm': 'fixed_window',
            'window_s': 60, 'max_count': 2})
        assert r.status_code == 200
        assert _gw(client, 'a-rl', sk).status_code == 200
        assert _gw(client, 'a-rl', sk).status_code == 200
        r = _gw(client, 'a-rl', sk)
        assert r.status_code == 429
        assert r.headers['X-RateLimit-Scope'] == 'api'
        assert int(r.headers['Retry-After']) > 0

    def test_token_api_isolation(self, client, auth_headers, upstream_base):
        api_id, _ta, sk_a = _setup_env(client, auth_headers, upstream_base, slug_suffix='iso')
        r = client.post('/api/apihub/admin/tokens', headers=auth_headers,
                        json={'name': 'iso-b'})
        sk_b = r.json()['data']['key']
        tb_id = r.json()['data']['id']
        r = client.post('/api/apihub/admin/rules', headers=auth_headers, json={
            'scope': 'token_api', 'api_id': api_id, 'token_id': _ta,
            'algorithm': 'fixed_window', 'window_s': 60, 'max_count': 1})
        assert r.status_code == 200
        assert _gw(client, 'a-iso', sk_a).status_code == 200
        assert _gw(client, 'a-iso', sk_a).status_code == 429
        assert _gw(client, 'a-iso', sk_b).status_code == 200   # B 不受影响

    def test_quota_no_oversell_concurrent(self, app, auth_headers, upstream_base):
        _setup_env(client := TestClient(app), auth_headers, upstream_base,
                   slug_suffix='quota')
        r = client.post('/api/apihub/admin/tokens', headers=auth_headers,
                        json={'name': 'q', 'quota_total': 20})
        sk = r.json()['data']['key']

        def burst(i):
            c = TestClient(app)
            return c.post('/api/apihub/gw/apis/a-quota',
                          headers={'Authorization': f'Bearer {sk}'}, json={}).status_code

        with ThreadPoolExecutor(max_workers=20) as ex:
            codes = list(ex.map(burst, range(80)))
        assert codes.count(200) == 20 and codes.count(429) == 60

    def test_upstream_401_disable_key_retry(self, client, auth_headers, upstream_base):
        _a, _t, sk = _setup_env(client, auth_headers, upstream_base, slug_suffix='prot',
                                path_tpl='/protected', method='GET',
                                keys=[{'token': 'bad-key'}, {'token': 'good-key'}])
        r = _gw(client, 'a-prot', sk)
        assert r.status_code == 200
        assert r.json()['secret'] == 'data'
        items = client.get('/api/apihub/admin/upstreams', headers=auth_headers).json()['data']
        uid = next(u['id'] for u in items if u['slug'] == 'u-prot')
        keys = client.get(f'/api/apihub/admin/upstreams/{uid}/keys',
                          headers=auth_headers).json()['data']
        bad = next(k for k in keys if k['credential']['token'].startswith('bad'))
        assert bad['status'] == 2 and '401' in (bad['disabled_reason'] or '')
        assert _gw(client, 'a-prot', sk).status_code == 200   # 再调直接用好 key

    def test_timeout_504(self, client, auth_headers, upstream_base):
        _a, _t, sk = _setup_env(client, auth_headers, upstream_base, slug_suffix='slow',
                                path_tpl='/slow', method='GET')
        # 上游 timeout 3000ms 太长——单独建一个短超时上游
        r = client.post('/api/apihub/admin/upstreams', headers=auth_headers, json={
            'name': 'u-fast', 'slug': 'u-fast', 'base_url': upstream_base,
            'timeout_ms': 300, 'max_retry': 0, 'auth_config': BEARER_AUTH})
        uid = r.json()['data']['id']
        client.post(f'/api/apihub/admin/upstreams/{uid}/keys', headers=auth_headers,
                    json={'credential': {'token': 'k'}})
        r = client.post('/api/apihub/admin/apis', headers=auth_headers, json={
            'name': 'slow2', 'slug': 'a-slow2', 'upstream_id': uid,
            'method': 'GET', 'path_tpl': '/slow'})
        api_id = r.json()['data']['id']
        r = client.post('/api/apihub/admin/tokens', headers=auth_headers, json={'name': 'ts'})
        sk2 = r.json()['data']['key']
        r = _gw(client, 'a-slow2', sk2)
        assert r.status_code == 504

    def test_passthrough_mode(self, client, auth_headers, upstream_base):
        _a, _t, sk = _setup_env(client, auth_headers, upstream_base)
        r = client.get('/api/apihub/gw/upstreams/u-env/echo?a=1',
                       headers={'Authorization': f'Bearer {sk}'})
        assert r.status_code == 200
        data = r.json()
        assert data['query'] == {'a': '1'}
        assert data['headers']['authorization'] == 'Bearer good-key'

    def test_probe_and_health(self, client, auth_headers, upstream_base):
        _a, _t, _sk = _setup_env(client, auth_headers, upstream_base, slug_suffix='probe',
                                 path_tpl='/health', method='GET',
                                 probe={'path': '/health', 'interval_s': 0})
        r = client.post('/api/apihub/probes/run', headers=auth_headers, json={})
        assert r.status_code == 200
        results = r.json()['data']
        res = next(x for x in results if x['slug'] == 'a-probe')
        assert res['ok'] is True and res['new_status'] == 'healthy'
        items = client.get('/api/apihub/admin/apis', headers=auth_headers).json()['data']
        item = next(a for a in items if a['slug'] == 'a-probe')
        assert item['health']['status'] == 'healthy'

    def test_down_blocks_traffic(self, client, auth_headers, upstream_base, app):
        _a, _t, sk = _setup_env(client, auth_headers, upstream_base, slug_suffix='down')
        state = app.state.apihub
        state.monitor.apply_result(_a, {'failure_threshold': 1, 'success_threshold': 1}, False)
        r = _gw(client, 'a-down', sk)
        assert r.status_code == 503 and r.json()['error'] == 'unhealthy'

    def test_logs_and_stats(self, client, auth_headers, upstream_base):
        api_id, _t, sk = _setup_env(client, auth_headers, upstream_base, slug_suffix='stat')
        _gw(client, 'a-stat', sk)
        _gw(client, 'a-stat', sk)
        state = app_state = None
        # 触发 writer 落库（间隔 2s，等待）
        time.sleep(2.5)
        r = client.get('/api/apihub/logs?api_id=%d' % api_id, headers=auth_headers)
        logs = r.json()['data']
        assert len(logs) >= 2 and logs[0]['mode'] == 'invoke'
        r = client.get('/api/apihub/stats/overview', headers=auth_headers)
        s = r.json()['data']
        assert s['total_calls'] >= 2
        assert any(i['slug'] == 'a-stat' for i in s['per_api'])
