"""DouBlog（本机）对外 OpenAPI 契约测试（A01–A09）：统一 OpenAPI 入口 /
POST invoke / 管理调试 / 双层认证 / 限流配额 / 转发围栏 / 内部错误透传 / 文档契约。

对外统一入口（默认格式）：GET /api/apihub/openapi/{system}/{api}（api=公开别名，
路径模板变量经同名 query 参数传入）。回环方案：内置系统的 base_url 指向本测试起的
ThreadingHTTPServer（127.0.0.1 随机端口），该适配器把收到的请求原样转发给当前测试的
TestClient（真实 app 的 confcenter 路由）——外部 GET 因此完整穿过
「网关 → HTTP 回环 → require_basic → confcenter」真实链路。
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

GW = '/api/apihub/gw'
OPENAPI = '/api/apihub/openapi'
NAMESPACES_PATH = f'{OPENAPI}/doublog/confcenter_namespaces'
GET_KEY_PATH = f'{OPENAPI}/doublog/confcenter_get_key?namespace={{namespace}}&key={{key}}'

_CTX = {'client': None}
_CTX_LOCK = threading.Lock()


def _make_adapter_handler():
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            client = _CTX['client']
            headers = {}
            if self.headers.get('Authorization'):
                headers['Authorization'] = self.headers['Authorization']
            if self.headers.get('Cookie'):
                headers['Cookie'] = self.headers['Cookie']
            with _CTX_LOCK:
                r = client.get(self.path, headers=headers)
            body = r.content
            self.send_response(r.status_code)
            if r.headers.get('content-type'):
                self.send_header('Content-Type', r.headers['content-type'])
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


def _make_slow_handler(delay_s: float):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            time.sleep(delay_s)
            body = b'{"success":true,"code":200,"message":"ok","data":{}}'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


@pytest.fixture()
def local(client, auth_headers, app):
    """回环适配器 + 内置系统 base_url 重指向 + 测试数据 + 平台令牌。

    返回 (sk, base gw 工具)。confcenter 种子：apihub_demo（多类型条目）与
    empty_demo（空空间）；A01 的零空间用例单独用新 app（不播种）。
    """
    _CTX['client'] = client
    server = ThreadingHTTPServer(('127.0.0.1', 0), _make_adapter_handler())
    threading.Thread(target=server.serve_forever, daemon=True).start()
    _set_origin(app, f'http://127.0.0.1:{server.server_address[1]}')

    # 配置中心种子数据
    seeds = [
        ('apihub_demo', 'example', 'json', {'enabled': True}),
        ('apihub_demo', 'plain', 'str', 'plain-text'),
        ('apihub_demo', 'empty-str', 'str', ''),
        ('apihub_demo', 'cn', 'str', '中文值'),
        ('apihub_demo', 'json-like', 'str', '{"looks":"json"}'),
        ('apihub_demo', 'obj', 'json', {'a': 1, 'b': [2, 3]}),
        ('apihub_demo', 'arr', 'json', [1, 2]),
        ('apihub_demo', 'num', 'json', 3.14),
        ('apihub_demo', 'bool', 'json', True),
        ('apihub_demo', 'null', 'json', None),
        ('other_demo', 'example', 'str', 'other-ns-value'),
    ]
    for ns, key, typ, data in seeds:
        r = client.put(f'/api/confcenter/{ns}/{key}', headers=auth_headers,
                       json={'type': typ, 'data': data})
        assert r.status_code in (200, 201), (ns, key, r.json())
    r = client.post('/api/confcenter/namespaces', headers=auth_headers,
                    json={'namespace': 'empty_demo'})
    assert r.status_code == 201

    r = client.post('/api/apihub/admin/tokens', headers=auth_headers, json={'name': 'qa'})
    assert r.status_code == 200
    sk = r.json()['data']['key']
    try:
        yield {'sk': sk, 'client': client, 'auth': auth_headers, 'app': app}
    finally:
        server.shutdown()


def _set_origin(app, base_url):
    """测试直改内置系统回环地址（管理端禁止改 base_url，ORM 是测试特权）。"""
    from sqlalchemy import select
    from app.apihub.models import ApihubSystem
    from app.db import database_context, db
    with database_context(app.state.db_runtime):
        row = db.session.execute(select(ApihubSystem)
                                 .where(ApihubSystem.slug == 'doublog')).scalar()
        row.base_url = base_url
        db.session.commit()
        db.session.remove()
    state = getattr(app.state, 'apihub', None)
    if state is not None:
        state.reload()


def _api_id(client, auth_headers, slug):
    items = client.get('/api/apihub/admin/apis', headers=auth_headers).json()['data']
    return next(a['id'] for a in items if a['slug'] == slug)


def _gw_get(client, path, sk):
    return client.get(path, headers={'Authorization': f'Bearer {sk}'})


def _gw_invoke(client, slug, sk, body):
    return client.post(f'{GW}/apis/{slug}', headers={'Authorization': f'Bearer {sk}'},
                       json=body)


# ─── A01 namespace 全部 / 空 ────────────────────────────────────────

class TestA01Namespaces:
    def test_matches_internal(self, local):
        client, auth, sk = local['client'], local['auth'], local['sk']
        r = _gw_get(client, NAMESPACES_PATH, sk)
        assert r.status_code == 200
        assert r.headers.get('X-Hub-Latency-Ms') is not None
        body = r.json()
        direct = client.get('/api/confcenter/namespaces', headers=auth).json()
        assert body == direct                       # 信封透传，逐字段一致
        data = {row['namespace']: row['count'] for row in body['data']}
        assert data['apihub_demo'] >= 1 and data['empty_demo'] == 0
        # invoke 兼容入口同值
        r2 = _gw_invoke(client, 'doublog-confcenter-namespaces', sk, {})
        assert r2.status_code == 200 and r2.json() == body

    def test_zero_namespaces(self, client, auth_headers, app):
        """零空间时返回空数组（新 app 不播种任何配置）。"""
        _CTX['client'] = client
        server = ThreadingHTTPServer(('127.0.0.1', 0), _make_adapter_handler())
        threading.Thread(target=server.serve_forever, daemon=True).start()
        _set_origin(app, f'http://127.0.0.1:{server.server_address[1]}')
        r = client.post('/api/apihub/admin/tokens', headers=auth_headers, json={'name': 't'})
        sk = r.json()['data']['key']
        r = _gw_get(client, NAMESPACES_PATH, sk)
        assert r.status_code == 200 and r.json()['data'] == []
        server.shutdown()


# ─── A02 key 类型保真 ───────────────────────────────────────────────

class TestA02KeyTypes:
    @pytest.mark.parametrize('key', ['example', 'plain', 'empty-str', 'cn', 'json-like',
                                     'obj', 'arr', 'num', 'bool', 'null'])
    def test_value_fidelity(self, local, key):
        client, auth, sk = local['client'], local['auth'], local['sk']
        r = _gw_get(client, GET_KEY_PATH.format(namespace='apihub_demo', key=key), sk)
        assert r.status_code == 200, r.text
        direct = client.get(f'/api/confcenter/apihub_demo/{key}', headers=auth)
        assert r.json() == direct.json()            # 与内部直读完全一致（含 updated_at）
        assert 'updated_at' in r.json()['data']

    def test_same_key_two_namespaces(self, local):
        client, sk = local['client'], local['sk']
        a = _gw_get(client, GET_KEY_PATH.format(namespace='apihub_demo', key='example'), sk)
        b = _gw_get(client, GET_KEY_PATH.format(namespace='other_demo', key='example'), sk)
        assert a.json()['data']['data'] == {'enabled': True}
        assert b.json()['data']['data'] == 'other-ns-value'

    def test_invoke_entry(self, local):
        client, sk = local['client'], local['sk']
        r = _gw_invoke(client, 'doublog-confcenter-get-key', sk,
                       {'path': {'namespace': 'apihub_demo', 'key': 'cn'}})
        assert r.status_code == 200
        assert r.json()['data']['data'] == '中文值'


# ─── A03 缺失 / 参数错误 ────────────────────────────────────────────

class TestA03MissingAndInvalid:
    def test_unknown_namespace_or_key_404(self, local):
        client, sk = local['client'], local['sk']
        for ns, key in (('no-such-ns', 'x'), ('apihub_demo', 'no-such-key')):
            r = _gw_get(client, GET_KEY_PATH.format(namespace=ns, key=key), sk)
            assert r.status_code == 404, (ns, key)
            body = r.json()
            assert body['success'] is False and body['code'] == 404   # 内部 404 信封透传
        # 无创建副作用
        names = [row['namespace'] for row in _gw_get(
            client, NAMESPACES_PATH, sk).json()['data']]
        assert 'no-such-ns' not in names

    def test_invoke_missing_or_bad_vars_400(self, local):
        client, sk = local['client'], local['sk']
        cases = [
            {},                                                   # 缺变量
            {'path': {'namespace': 'apihub_demo'}},               # 缺 key
            {'path': {'namespace': '', 'key': 'x'}},              # 空值
            {'path': {'namespace': '.', 'key': 'x'}},             # 独立 . 段
            {'path': {'namespace': '..', 'key': 'x'}},            # 独立 .. 段
            {'path': {'namespace': 'a' * 101, 'key': 'x'}},       # 超长
            {'path': {'namespace': 'a', 'key': 'k' * 201}},
            {'path': {'namespace': 'a b', 'key': 'x'}},           # 非法字符
            {'path': {'namespace': 'a%b', 'key': 'x'}},           # 百分号
            {'path': {'namespace': 'a?q', 'key': 'x'}},           # 问号
            {'path': {'namespace': 'a\nb', 'key': 'x'}},          # 换行
            {'path': {'namespace': 123, 'key': 'x'}},             # 非字符串
            {'path': {'namespace': ['a'], 'key': 'x'}},
        ]
        for body in cases:
            r = _gw_invoke(client, 'doublog-confcenter-get-key', sk, body)
            assert r.status_code == 400 and r.json()['error'] == 'template_error', body
            assert r.json()['code'] == 400

    def test_alias_param_errors_and_old_path_gone(self, local):
        """query 参数非法 → 400；未登记别名/系统 → 404；旧 gw/systems 原生路径 → 403（无兼容）。"""
        client, sk = local['client'], local['sk']
        # 参数非法（空/空格/编码..）→ 400 template_error
        for q in ('namespace=&key=x', 'namespace=a+b&key=x',
                  'namespace=%2E%2E&key=x', 'namespace=a%2Fb&key=x'):
            r = client.get(f'{OPENAPI}/doublog/confcenter_get_key?{q}',
                           headers={'Authorization': f'Bearer {sk}'})
            assert r.status_code == 400, (q, r.status_code)
        # 缺参数 → 400
        r = client.get(f'{OPENAPI}/doublog/confcenter_get_key',
                       headers={'Authorization': f'Bearer {sk}'})
        assert r.status_code == 400 and r.json()['error'] == 'template_error'
        # 未登记别名 / 未知系统 → 404；多段别名不匹配路由 → 404
        for path in (f'{OPENAPI}/doublog/nope', f'{OPENAPI}/no-sys/x',
                     f'{OPENAPI}/doublog/a/b'):
            r = client.get(path, headers={'Authorization': f'Bearer {sk}'})
            assert r.status_code == 404, path
        # 旧原生 GET 路径已废除：内置系统透明代理一律 403 指向 OpenAPI 入口
        for path in (f'{GW}/systems/doublog/api/confcenter/namespaces',
                     f'{GW}/systems/doublog/api/confcenter/a/b',
                     f'{GW}/systems/doublog/health'):
            r = client.get(path, headers={'Authorization': f'Bearer {sk}'})
            assert r.status_code == 403 and r.json()['error'] == 'forbidden', path

    def test_alias_equivalence(self, local):
        """别名等价：连字符形式与完整 slug 同样命中；namespace 允许叫 namespaces。"""
        client, sk = local['client'], local['sk']
        for alias in ('confcenter-namespaces', 'doublog-confcenter-namespaces',
                      'doublog_confcenter_namespaces'):
            r = client.get(f'{OPENAPI}/doublog/{alias}',
                           headers={'Authorization': f'Bearer {sk}'})
            assert r.status_code == 200, alias
        r = client.get(f'{OPENAPI}/doublog/confcenter_get_key?namespace=namespaces&key=x',
                       headers={'Authorization': f'Bearer {sk}'})
        assert r.status_code == 404 and r.json()['success'] is False   # 内部 404 信封


# ─── A04 外层授权 ───────────────────────────────────────────────────

class TestA04OuterAuth:
    def test_no_or_bad_sk_401(self, local):
        client, auth = local['client'], local['auth']
        assert client.get(NAMESPACES_PATH).status_code == 401
        assert _gw_get(client, NAMESPACES_PATH, 'sk-bad').status_code == 401
        # Cookie / 默认用户 Basic 不能替代外层 sk
        r = client.get(NAMESPACES_PATH, headers=auth)
        assert r.status_code == 401
        r = client.get(NAMESPACES_PATH, headers={'Cookie': 'doublog_session=forged'})
        assert r.status_code == 401
        assert _gw_invoke(client, 'doublog-confcenter-get-key', 'sk-bad', {}).status_code == 401

    def test_expired_or_disabled_sk_401(self, local):
        client, auth, app = local['client'], local['auth'], local['app']
        r = client.post('/api/apihub/admin/tokens', headers=auth, json={'name': 'exp'})
        exp_sk = r.json()['data']['key']
        tid = r.json()['data']['id']
        # 直接把过期时间改到过去（SQLite DateTime 不接受字符串入参，走 ORM）
        from datetime import datetime
        from app.db import database_context, db
        from app.apihub.models import ApihubToken as _T
        with database_context(app.state.db_runtime):
            row = db.session.get(_T, tid)
            row.expires_at = datetime(2000, 1, 1)
            db.session.commit()
            db.session.remove()
        app.state.apihub.reload()
        assert _gw_get(client, NAMESPACES_PATH, exp_sk).status_code == 401
        r = client.post('/api/apihub/admin/tokens', headers=auth, json={'name': 'dis'})
        dis_sk = r.json()['data']['key']
        tid = r.json()['data']['id']
        client.put(f'/api/apihub/admin/tokens/{tid}', headers=auth, json={'status': 2})
        assert _gw_get(client, NAMESPACES_PATH, dis_sk).status_code == 401

    def test_scope_and_ip_restriction(self, local):
        client, auth, sk = local['client'], local['auth'], local['sk']
        ns_id = _api_id(client, auth, 'doublog-confcenter-namespaces')
        r = client.post('/api/apihub/admin/tokens', headers=auth, json={
            'name': 'ns-only', 'allowed_api_ids': [ns_id]})
        scoped = r.json()['data']['key']
        assert _gw_get(client, NAMESPACES_PATH, scoped).status_code == 200
        # 仅授 namespaces 令牌不能经 GET 别名或 invoke 读 key
        key_path = GET_KEY_PATH.format(namespace='apihub_demo', key='example')
        assert _gw_get(client, key_path, scoped).status_code == 403
        r = _gw_invoke(client, 'doublog-confcenter-get-key', scoped,
                       {'path': {'namespace': 'apihub_demo', 'key': 'example'}})
        assert r.status_code == 403
        r = client.post('/api/apihub/admin/tokens', headers=auth, json={
            'name': 'ip', 'allowed_ips': ['9.9.9.9']})
        assert _gw_get(client, NAMESPACES_PATH, r.json()['data']['key']).status_code == 403


# ─── A05 内层默认用户 ───────────────────────────────────────────────

class TestA05InnerDefaultUser:
    def test_default_user_basic_injected(self, local):
        """内部 confcenter 全程 require_basic：外部 GET 成功即证明网关注入了默认用户 Basic。"""
        client, sk = local['client'], local['sk']
        r = _gw_get(client, GET_KEY_PATH.format(namespace='apihub_demo', key='example'), sk)
        assert r.status_code == 200 and r.json()['data']['data'] == {'enabled': True}
        # 直接内部接口无认证仍是 401（内层不旁路）
        assert client.get('/api/confcenter/apihub_demo/example').status_code == 401
        assert client.get('/api/confcenter/namespaces',
                          headers={'X-Apihub-Token': 'anything'}).status_code == 401

    def test_wrong_inner_password_503_no_leak(self, local):
        client, auth, sk = local['client'], local['auth'], local['sk']
        api = next(a for a in client.get('/api/apihub/admin/apis', headers=auth).json()['data']
                   if a['slug'] == 'doublog-confcenter-get-key')
        r = client.put(f"/api/apihub/admin/apis/{api['id']}", headers=auth, json={
            **api,
            'auth_config': {'providers': [{'type': 'basic'}],
                            'credential_fields': ['user', 'password'],
                            'credential': {'user': 'admin', 'password': 'wrong-inner-pw'}}})
        assert r.status_code == 200, r.json()
        r = _gw_get(client, GET_KEY_PATH.format(namespace='apihub_demo', key='example'), sk)
        assert r.status_code == 503 and r.json()['error'] == 'upstream_error'
        assert 'auth_401' in r.json()['message']       # 401 不重试，直接失败
        assert 'wrong-inner-pw' not in r.text          # 凭据不泄漏


# ─── A06 API 状态与配额 ─────────────────────────────────────────────

class TestA06StatusAndQuota:
    def test_disabled_api_and_system(self, local):
        client, auth, sk = local['client'], local['auth'], local['sk']
        ns_id = _api_id(client, auth, 'doublog-confcenter-namespaces')
        client.put(f'/api/apihub/admin/apis/{ns_id}/enabled', headers=auth, json={'enabled': False})
        r = _gw_get(client, NAMESPACES_PATH, sk)
        assert r.status_code == 503 and r.json()['error'] == 'api_disabled'
        client.put(f'/api/apihub/admin/apis/{ns_id}/enabled', headers=auth, json={'enabled': True})
        # 停用内置系统（允许）→ system_disabled
        systems = {s['slug']: s for s in client.get('/api/apihub/admin/systems',
                                                    headers=auth).json()['data']}
        r = client.put(f"/api/apihub/admin/systems/{systems['doublog']['id']}", headers=auth,
                       json={**systems['doublog'], 'status': 2})
        assert r.status_code == 200
        assert _gw_get(client, NAMESPACES_PATH, sk).status_code == 503 \
            and _gw_get(client, NAMESPACES_PATH, sk).json()['error'] == 'system_disabled'
        client.put(f"/api/apihub/admin/systems/{systems['doublog']['id']}", headers=auth,
                   json={**systems['doublog'], 'status': 1})
        assert _gw_get(client, NAMESPACES_PATH, sk).status_code == 200

    def test_api_scope_rate_limit_headers(self, local):
        client, auth = local['client'], local['auth']
        ns_id = _api_id(client, auth, 'doublog-confcenter-namespaces')
        r = client.post('/api/apihub/admin/tokens', headers=auth, json={'name': 'rl'})
        sk = r.json()['data']['key']
        r = client.post('/api/apihub/admin/rules', headers=auth, json={
            'scope': 'api', 'api_id': ns_id, 'algorithm': 'fixed_window',
            'window_s': 60, 'max_count': 2})
        assert r.status_code == 200
        assert _gw_get(client, NAMESPACES_PATH, sk).status_code == 200
        assert _gw_get(client, NAMESPACES_PATH, sk).status_code == 200
        r = _gw_get(client, NAMESPACES_PATH, sk)
        assert r.status_code == 429
        assert r.headers['X-RateLimit-Scope'] == 'api'
        assert int(r.headers['Retry-After']) > 0

    def test_quota_single_count_and_refund(self, local):
        """GET 别名一次配额；参数校验失败（400）退还配额不残留。"""
        client, auth = local['client'], local['auth']
        r = client.post('/api/apihub/admin/tokens', headers=auth,
                        json={'name': 'q3', 'quota_total': 3})
        sk = r.json()['data']['key']
        key_path = GET_KEY_PATH.format(namespace='apihub_demo', key='example')
        for _ in range(3):
            assert _gw_get(client, key_path, sk).status_code == 200
        r = _gw_get(client, key_path, sk)
        assert r.status_code == 429 and r.json()['error'] == 'quota_exceeded'
        # 新令牌 quota=1：先发一次缺变量 invoke（400 退款），再 GET 仍可成功
        r = client.post('/api/apihub/admin/tokens', headers=auth,
                        json={'name': 'q1', 'quota_total': 1})
        sk1 = r.json()['data']['key']
        assert _gw_invoke(client, 'doublog-confcenter-get-key', sk1, {}).status_code == 400
        assert _gw_get(client, key_path, sk1).status_code == 200
        assert _gw_get(client, key_path, sk1).status_code == 429


# ─── A07 本机转发围栏 ───────────────────────────────────────────────

class TestA07ForwardFence:
    @pytest.mark.parametrize('path', [
        f'{GW}/systems/doublog/api/admin/systems',
        f'{GW}/systems/doublog/api/admin/database/switch',
        f'{GW}/systems/doublog/api/auth/login',
        f'{GW}/systems/doublog/api/todo/tasks',
        f'{GW}/systems/doublog/api/confcenter/entries',
        f'{GW}/systems/doublog/api/confcenter/apihub_demo',
        f'{GW}/systems/doublog/health',
        f'{GW}/systems/doublog/api',
        f'{GW}/systems/doublog/api/confcenter/namespaces',   # 旧原生 GET 路径已废除
    ])
    def test_unregistered_paths_403(self, local, path):
        client, sk = local['client'], local['sk']
        r = client.get(path, headers={'Authorization': f'Bearer {sk}'})
        assert r.status_code == 403 and r.json()['error'] == 'forbidden', path

    @pytest.mark.parametrize('method', ['post', 'put', 'delete', 'patch'])
    def test_write_methods_403(self, local, method):
        client, sk = local['client'], local['sk']
        r = getattr(client, method)(NAMESPACES_PATH,
                                    headers={'Authorization': f'Bearer {sk}'})
        assert r.status_code == 403
        r = getattr(client, method)(
            GET_KEY_PATH.format(namespace='apihub_demo', key='example'),
            headers={'Authorization': f'Bearer {sk}'})
        assert r.status_code == 403

    def test_inbound_credentials_not_forwarded(self, local):
        """入站 Cookie/Authorization 不影响内层 Basic（剥离后由网关注入默认用户）。"""
        client, sk = local['client'], local['sk']
        key_path = GET_KEY_PATH.format(namespace='apihub_demo', key='example')
        r = client.get(key_path, headers={'Authorization': f'Bearer {sk}',
                                          'Cookie': 'evil=1; doublog_session=fake',
                                          'X-Extra': '1'})
        assert r.status_code == 200 and r.json()['data']['data'] == {'enabled': True}

    def test_normal_system_passthrough_and_openapi(self, client, auth_headers, system_base):
        """普通系统回归：透明代理不变；统一 OpenAPI 入口对普通系统同样可用（默认格式）。"""
        r = client.post('/api/apihub/admin/systems', headers=auth_headers, json={
            'name': 'plain', 'slug': 'plain-sys', 'base_url': system_base})
        uid = r.json()['data']['id']
        r = client.post('/api/apihub/admin/apis', headers=auth_headers, json={
            'name': 'echo', 'slug': 'plain-echo', 'system_id': uid,
            'method': 'GET', 'path_tpl': '/echo'})
        r = client.post('/api/apihub/admin/tokens', headers=auth_headers, json={'name': 'pt'})
        sk = r.json()['data']['key']
        # 透明代理（既有行为不变）
        r = client.get(f'{GW}/systems/plain-sys/echo?a=1',
                       headers={'Authorization': f'Bearer {sk}'})
        assert r.status_code == 200 and r.json()['query'] == {'a': '1'}
        # 统一 OpenAPI 入口：别名 echo / plain-echo / plain_echo 均命中
        for alias in ('echo', 'plain-echo', 'plain_echo'):
            r = client.get(f'{OPENAPI}/plain-sys/{alias}?a=2',
                           headers={'Authorization': f'Bearer {sk}'})
            assert r.status_code == 200 and r.json()['query'] == {'a': '2'}, alias


# ─── A08 内部限流 / 网络错误 / 日志 ─────────────────────────────────

class TestA08InternalErrors:
    def test_confcenter_ratelimit_passthrough(self, local):
        client, auth, sk = local['client'], local['auth'], local['sk']
        # 限流关闭时造数据，再启用 override（rl_ns 每窗口 1 次）
        r = client.put('/api/confcenter/rl_ns/k', headers=auth,
                       json={'type': 'str', 'data': 'v'})
        assert r.status_code in (200, 201)
        r = client.put('/api/confcenter/ratelimit/config', headers=auth, json={
            'enabled': True, 'limit': 100, 'window_seconds': 60,
            'overrides': {'rl_ns': {'limit': 1, 'window_seconds': 60}}})
        assert r.status_code == 200
        path = GET_KEY_PATH.format(namespace='rl_ns', key='k')
        assert _gw_get(client, path, sk).status_code == 200
        r = _gw_get(client, path, sk)
        assert r.status_code == 429                       # 内部 429 信封透传
        body = r.json()
        assert body['code'] == 429 and body['data']['error_code'] == 'RATE_LIMITED'

    def test_conn_failure_503_and_timeout_504(self, local):
        client, auth, sk, app = local['client'], local['auth'], local['sk'], local['app']
        # 连接失败（死端口）→ 503，单次尝试（max_retry=0）
        _set_origin(app, 'http://127.0.0.1:1')
        r = _gw_get(client, NAMESPACES_PATH, sk)
        assert r.status_code == 503 and r.json()['error'] == 'upstream_error'
        assert 'conn_error' in r.json()['message']
        # 慢服务 + 300ms 超时（系统 timeout 可编辑）→ 504
        slow = ThreadingHTTPServer(('127.0.0.1', 0), _make_slow_handler(1.2))
        threading.Thread(target=slow.serve_forever, daemon=True).start()
        _set_origin(app, f'http://127.0.0.1:{slow.server_address[1]}')
        systems = {s['slug']: s for s in client.get('/api/apihub/admin/systems',
                                                    headers=auth).json()['data']}
        client.put(f"/api/apihub/admin/systems/{systems['doublog']['id']}", headers=auth,
                   json={**systems['doublog'], 'timeout_ms': 300})
        r = _gw_get(client, NAMESPACES_PATH, sk)
        assert r.status_code == 504 and r.json()['error'] == 'upstream_timeout'
        slow.shutdown()

    def test_log_binds_real_api_single_count(self, local):
        client, auth, sk = local['client'], local['auth'], local['sk']
        assert _gw_get(client, NAMESPACES_PATH, sk).status_code == 200
        time.sleep(2.5)                       # writer 批量落库窗口
        ns_id = _api_id(client, auth, 'doublog-confcenter-namespaces')
        logs = client.get(f'/api/apihub/logs?api_id={ns_id}', headers=auth).json()['data']
        assert len(logs) == 1
        assert logs[0]['mode'] == 'invoke' and logs[0]['ok'] is True
        assert logs[0]['status_code'] == 200


# ─── A09 管理调试 / 文档 / OpenAPI ──────────────────────────────────

class TestA09AdminAndDocs:
    def test_admin_invoke_debug(self, local):
        client, auth = local['client'], local['auth']
        ns_id = _api_id(client, auth, 'doublog-confcenter-namespaces')
        key_id = _api_id(client, auth, 'doublog-confcenter-get-key')
        r = client.post(f'/api/apihub/admin/apis/{ns_id}/invoke', headers=auth, json={})
        assert r.status_code == 200, r.json()
        data = r.json()['data']
        assert data['status_code'] == 200 and data['ok'] is True
        assert data['body']['success'] is True             # body 为内部完整信封
        r = client.post(f'/api/apihub/admin/apis/{key_id}/invoke', headers=auth,
                        json={'path': {'namespace': 'apihub_demo', 'key': 'example'}})
        assert r.status_code == 200
        assert r.json()['data']['body']['data']['data'] == {'enabled': True}
        # 错误参数 400；未认证 401
        r = client.post(f'/api/apihub/admin/apis/{key_id}/invoke', headers=auth, json={})
        assert r.status_code == 400 and r.json()['error'] == 'template_error'
        assert client.post(f'/api/apihub/admin/apis/{ns_id}/invoke', json={}).status_code == 401

    def test_doc_markdown_contract(self, local):
        client, auth = local['client'], local['auth']
        for slug, alias in (('doublog-confcenter-namespaces', 'confcenter_namespaces'),
                            ('doublog-confcenter-get-key', 'confcenter_get_key')):
            aid = _api_id(client, auth, slug)
            r = client.get(f'/api/apihub/admin/apis/{aid}/doc', headers=auth)
            assert r.status_code == 200
            assert r.headers['content-type'].startswith('text/markdown')
            md = r.text
            assert f'/api/apihub/openapi/doublog/{alias}' in md      # 统一 OpenAPI 入口
            assert '/api/apihub/gw/apis/' in md                       # invoke 入口
            assert '/gw/systems/doublog' not in md                    # 内置不经透明代理
            assert 'sk-' in md and 'Bearer' in md
            assert 'lizy111A' not in md and 'wrong-inner-pw' not in md    # 不含凭据
        # get-key 文档：变量必填说明 + 测试样例 + query 传参
        aid = _api_id(client, auth, 'doublog-confcenter-get-key')
        md = client.get(f'/api/apihub/admin/apis/{aid}/doc', headers=auth).text
        assert '必填' in md and 'query' in md
        assert 'apihub_demo' in md and 'example' in md

    def test_openapi_yaml_matches_reality(self, local):
        import yaml
        yaml_path = Path(__file__).resolve().parents[2] / 'docs' / 'openapi' / 'apihub-doublog.yaml'
        spec = yaml.safe_load(yaml_path.read_text(encoding='utf-8'))
        assert spec['openapi'].startswith('3.1')
        paths = set(spec['paths'])
        assert paths == {
            '/api/apihub/openapi/doublog/confcenter_namespaces',
            '/api/apihub/openapi/doublog/confcenter_get_key',
        }
        for p in paths:
            get = spec['paths'][p]['get']
            assert get.get('security', spec['security']) == [{'bearerAuth': []}]
            assert '429' in get['responses'] and '401' in get['responses']
        key_get = spec['paths']['/api/apihub/openapi/doublog/confcenter_get_key']['get']

        def _resolve(p):
            if '$ref' in p:
                return spec['components']['parameters'][p['$ref'].rsplit('/', 1)[-1]]
            return p

        params = {p['name']: p for p in map(_resolve, key_get['parameters'])}
        assert set(params) == {'namespace', 'key'}
        assert params['namespace']['schema']['maxLength'] == 100
        assert params['key']['schema']['maxLength'] == 200
        assert params['namespace']['required'] is True and params['key']['required'] is True
        assert params['namespace']['in'] == 'query' and params['key']['in'] == 'query'
        assert spec['components']['securitySchemes']['bearerAuth']['type'] == 'http'
        # 文档不包含任何真实凭据；不残留旧路径
        raw = yaml_path.read_text(encoding='utf-8')
        assert 'lizy111A' not in raw and '/gw/systems/doublog' not in raw


# ─── 复用 mock 上游（普通系统回归用）──────────────────────────────

@pytest.fixture(scope='module')
def system_base():
    """与 test_apihub_api 同款 echo mock（A07 普通系统透明代理回归）。"""
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

            def do_GET(self):
                from urllib.parse import parse_qs, urlsplit
                self._send({'method': 'GET',
                            'query': {k: v[0] for k, v in parse_qs(urlsplit(self.path).query).items()},
                            'path': self.path.split('?')[0]})

        return Handler

    server = ThreadingHTTPServer(('127.0.0.1', 0), _make_handler())
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f'http://127.0.0.1:{server.server_address[1]}'
    server.shutdown()
