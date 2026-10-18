"""API Hub QQ 机器人接入测试：qq_bot 动态令牌 + 出站代理配置 + 参数默认值。

自包含：本地 mock 上游同时扮演 QQ token 端点（/app/getAppAccessToken）与
C2C 发送端点（/v2/users/<openid>/messages）；代理部分为纯单元测试
（resolve_proxy 规则 + admin 配置接口），不依赖真实 Clash。
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

QQ_APP_ID = '1903000001'
QQ_SECRET = 'test-secret'
QQ_OPENID = 'B93CDEFAULTOPENID000000000000000'


class _QQState:
    """mock 服务端状态（token 交换次数 / 收到的请求记录）。"""

    def __init__(self):
        self.token_calls = 0
        self.token_seq = 0
        self.messages = []


@pytest.fixture()
def qq_state():
    return _QQState()


@pytest.fixture()
def qq_system(qq_state):
    def handler_cls():
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

            def do_POST(self):
                path = self.path.split('?')[0]
                n = int(self.headers.get('Content-Length') or 0)
                raw = self.rfile.read(n) if n else b''
                if path == '/app/getAppAccessToken':
                    try:
                        body = json.loads(raw)
                    except ValueError:
                        body = {}
                    qq_state.token_calls += 1
                    if body.get('appId') == QQ_APP_ID and body.get('clientSecret') == QQ_SECRET:
                        qq_state.token_seq += 1
                        self._send({'access_token': f'tok-{qq_state.token_seq}',
                                    'expires_in': 7200})
                    else:
                        self._send({'code': 100007, 'message': 'appid invalid'}, 400)
                    return
                if path.startswith('/v2/users/'):
                    openid = path.split('/')[3]
                    qq_state.messages.append({
                        'openid': openid,
                        'authorization': self.headers.get('Authorization'),
                        'body': json.loads(raw) if raw else None,
                    })
                    self._send({'id': 'MSGID' + str(len(qq_state.messages)), 'retcode': 0})
                    return
                self._send({'error': 'not found'}, 404)

        return Handler

    server = ThreadingHTTPServer(('127.0.0.1', 0), handler_cls())
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f'http://127.0.0.1:{server.server_address[1]}'
    server.shutdown()


def _qq_auth(system_base, cred=None):
    # token_url 显式指向 mock（生产注册时省略 token_url 即用真实 bots.qq.com）；
    # credential 凭证值内联（2026-10-17 起无密钥池）
    return {'providers': [{'type': 'qq_bot',
                           'token_url': system_base + '/app/getAppAccessToken'}],
            'credential_fields': ['app_id', 'app_secret'],
            'credential': cred or {'app_id': QQ_APP_ID, 'app_secret': QQ_SECRET},
            'transport': {}}
QQ_REQUEST_CFG = {
    'param_defaults': {'openid': QQ_OPENID},
    'body': {'type': 'json', 'defaults': {'msg_type': 0}},
}


def _setup_qq_env(client, auth_headers, system_base, *, slug='qqenv',
                  request_cfg=None, cred=None):
    """建 qq 系统+API（鉴权内联）+令牌，返回 sk 明文。"""
    r = client.post('/api/apihub/admin/systems', headers=auth_headers, json={
        'name': f'u-{slug}', 'slug': f'u-{slug}', 'base_url': system_base,
        'timeout_ms': 3000, 'max_retry': 0})
    assert r.status_code == 200, r.json()
    uid = r.json()['data']['id']
    r = client.post('/api/apihub/admin/apis', headers=auth_headers, json={
        'name': f'a-{slug}', 'slug': f'a-{slug}', 'system_id': uid,
        'method': 'POST', 'path_tpl': '/v2/users/{path.openid}/messages',
        'auth_config': _qq_auth(system_base, cred),
        'request_cfg': request_cfg if request_cfg is not None else QQ_REQUEST_CFG})
    assert r.status_code == 200, r.json()
    r = client.post('/api/apihub/admin/tokens', headers=auth_headers,
                    json={'name': f't-{slug}'})
    return r.json()['data']['key']


class TestQQBotProvider:
    def test_end_to_end_with_defaults(self, client, auth_headers, qq_system, qq_state):
        """openid/msg_type 全走默认值：调用方只传 content。"""
        sk = _setup_qq_env(client, auth_headers, qq_system)
        r = client.post('/api/apihub/gw/apis/a-qqenv', headers={'Authorization': f'Bearer {sk}'},
                        json={'body': {'content': '告警：测试消息'}})
        assert r.status_code == 200, r.json()
        assert r.json()['retcode'] == 0
        assert len(qq_state.messages) == 1
        msg = qq_state.messages[0]
        assert msg['openid'] == QQ_OPENID                       # path 默认值
        assert msg['authorization'] == f'QQBot tok-1'           # 动态令牌注入
        assert msg['body'] == {'msg_type': 0, 'content': '告警：测试消息'}  # body 默认值合并

    def test_token_cached_across_invokes(self, client, auth_headers, qq_system, qq_state):
        """token 进程内缓存：多次调用只交换一次。"""
        sk = _setup_qq_env(client, auth_headers, qq_system, slug='qqcache')
        for _ in range(3):
            r = client.post('/api/apihub/gw/apis/a-qqcache',
                            headers={'Authorization': f'Bearer {sk}'},
                            json={'body': {'content': 'x'}})
            assert r.status_code == 200, r.json()
        assert qq_state.token_calls == 1
        assert qq_state.messages[-1]['authorization'] == 'QQBot tok-1'

    def test_token_refresh_after_expiry(self, client, auth_headers, qq_system, qq_state, app):
        """缓存过期后自动重新交换（手动把过期时间拨到过去）。"""
        sk = _setup_qq_env(client, auth_headers, qq_system, slug='qqexp')
        r = client.post('/api/apihub/gw/apis/a-qqexp', headers={'Authorization': f'Bearer {sk}'},
                        json={'body': {'content': 'x'}})
        assert r.status_code == 200
        ex = app.state.apihub.token_exchange
        key = list(ex._cache)[0]
        ex._cache[key] = (ex._cache[key][0], 0.0)              # 立即过期
        r = client.post('/api/apihub/gw/apis/a-qqexp', headers={'Authorization': f'Bearer {sk}'},
                        json={'body': {'content': 'y'}})
        assert r.status_code == 200
        assert qq_state.token_calls == 2
        assert qq_state.messages[-1]['authorization'] == 'QQBot tok-2'

    def test_caller_values_override_defaults(self, client, auth_headers, qq_system, qq_state):
        """调用方显式传 openid / msg_type 时默认值让位。"""
        sk = _setup_qq_env(client, auth_headers, qq_system, slug='qqover')
        r = client.post('/api/apihub/gw/apis/a-qqover', headers={'Authorization': f'Bearer {sk}'},
                        json={'path': {'openid': 'U-CUSTOM'},
                              'body': {'msg_type': 2, 'content': 'markdown 消息'}})
        assert r.status_code == 200
        assert qq_state.messages[0]['openid'] == 'U-CUSTOM'
        assert qq_state.messages[0]['body'] == {'msg_type': 2, 'content': 'markdown 消息'}

    def test_bad_credentials_fails(self, client, auth_headers, qq_system):
        """错误凭证：token 端点 400 → 网关 5xx 且错误可见。"""
        sk = _setup_qq_env(client, auth_headers, qq_system, slug='qqbad',
                           cred={'app_id': 'wrong', 'app_secret': 'nope'})
        r = client.post('/api/apihub/gw/apis/a-qqbad', headers={'Authorization': f'Bearer {sk}'},
                        json={'body': {'content': 'x'}})
        assert r.status_code >= 500
        assert 'qq token' in r.json().get('message', '')

    def test_missing_path_var_without_default(self, client, auth_headers, qq_system):
        """无默认值且调用方未传 path 变量 → 400 template_error（默认值消除的报错）。"""
        sk = _setup_qq_env(client, auth_headers, qq_system, slug='qqnodef',
                           request_cfg={'body': {'type': 'json'}})
        r = client.post('/api/apihub/gw/apis/a-qqnodef', headers={'Authorization': f'Bearer {sk}'},
                        json={'body': {'content': 'x'}})
        assert r.status_code == 400
        assert 'openid' in r.json()['message']

    def test_apply_providers_requires_fetch(self):
        from app.apihub.core import TokenExchanger, apply_providers
        with pytest.raises(Exception):
            apply_providers([{'type': 'qq_bot'}], {'app_id': 'a', 'app_secret': 'b'})
        # 绑定 fetcher 后正常注入
        inj = apply_providers([{'type': 'qq_bot'}], {'app_id': 'a', 'app_secret': 'b'},
                              token_fetch=lambda p, c: 'T')
        assert inj.headers['Authorization'] == 'QQBot T'


class TestOutboundProxy:
    def test_resolve_rules(self, tmp_path, monkeypatch):
        from app.apihub import proxy as pm
        monkeypatch.setattr(pm, '_CACHE', {'cfg': None})
        monkeypatch.setattr(pm.settings, 'data_dir', str(tmp_path), raising=False)
        # 默认关闭
        assert pm.resolve_proxy('https', 'bots.qq.com') is None
        # http 目标 / localhost 永不代理
        pm.save_proxy_config({'enabled': True, 'host': '127.0.0.1', 'port': 7890})
        assert pm.resolve_proxy('http', 'example.com') is None
        assert pm.resolve_proxy('https', 'localhost') is None
        assert pm.resolve_proxy('https', '127.0.0.1') is None
        # https 外网走代理
        assert pm.resolve_proxy('https', 'bots.qq.com') == ('127.0.0.1', 7890)
        # 保存后持久化（缓存失效重读）
        pm.save_proxy_config({'enabled': False})
        assert pm.resolve_proxy('https', 'bots.qq.com') is None

    def test_admin_proxy_endpoints(self, client, auth_headers, tmp_path, monkeypatch):
        from app.apihub import proxy as pm
        monkeypatch.setattr(pm, '_CACHE', {'cfg': None})
        monkeypatch.setattr(pm.settings, 'data_dir', str(tmp_path), raising=False)
        r = client.get('/api/apihub/admin/proxy', headers=auth_headers)
        assert r.status_code == 200
        assert r.json()['data'] == {'enabled': False, 'host': '127.0.0.1', 'port': 7890}
        r = client.put('/api/apihub/admin/proxy', headers=auth_headers,
                       json={'enabled': True, 'host': '192.168.1.9', 'port': 1080})
        assert r.status_code == 200
        assert r.json()['data']['port'] == 1080
        r = client.put('/api/apihub/admin/proxy', headers=auth_headers,
                       json={'enabled': True, 'port': 70000})
        assert r.status_code == 400
        r = client.put('/api/apihub/admin/proxy', headers=auth_headers,
                       json={'enabled': True, 'host': '  '})
        assert r.status_code == 400
        # 恢复关闭，避免影响同进程后续用例
        client.put('/api/apihub/admin/proxy', headers=auth_headers, json={'enabled': False})

    def test_pool_target_key_includes_proxy(self, monkeypatch, tmp_path):
        """代理开启后连接走代理目标（用本地 mock 代理验证 CONNECT 建连路径）。"""
        from app.apihub import proxy as pm
        from app.apihub.pool import UpstreamPool, UpstreamConnectError, UpstreamTimeout
        monkeypatch.setattr(pm, '_CACHE', {'cfg': None})
        monkeypatch.setattr(pm.settings, 'data_dir', str(tmp_path), raising=False)
        pm.save_proxy_config({'enabled': True, 'host': '127.0.0.1', 'port': 1})
        pool = UpstreamPool()
        # 端口 1 无监听 → 经代理建连失败（证明走了代理而非直连目标）
        # Windows 下拒连常表现为超时：两种异常都证明建连走的是代理而非直连目标
        with pytest.raises((UpstreamConnectError, UpstreamTimeout)):
            pool.request('GET', 'https://bots.qq.com/', {}, {}, b'', 2.0)
        pm.save_proxy_config({'enabled': False})
        del pool


class TestAdminInvoke:
    """页面调试调用（POST /admin/apis/{id}/invoke）：不走平台令牌，返回原始上游响应。"""

    def test_invoke_qq_with_defaults(self, client, auth_headers, qq_system, qq_state):
        """管理端直发：默认值填充 + QQBot 头注入，响应含状态/延迟/上游原文。"""
        _sk = _setup_qq_env(client, auth_headers, qq_system, slug='qqinv')
        r = client.get('/api/apihub/admin/apis', headers=auth_headers)
        api_id = next(a['id'] for a in r.json()['data'] if a['slug'] == 'a-qqinv')
        r = client.post(f'/api/apihub/admin/apis/{api_id}/invoke', headers=auth_headers,
                        json={'body': {'content': '页面调试消息'}})
        assert r.status_code == 200, r.json()
        d = r.json()['data']
        assert d['status_code'] == 200 and d['ok'] is True and d['latency_ms'] >= 0
        assert d['body']['retcode'] == 0
        assert len(qq_state.messages) == 1
        assert qq_state.messages[0]['openid'] == QQ_OPENID
        assert qq_state.messages[0]['authorization'].startswith('QQBot tok-')
        assert qq_state.messages[0]['body']['content'] == '页面调试消息'

    def test_invoke_404_and_bad_json_body(self, client, auth_headers):
        r = client.post('/api/apihub/admin/apis/99999/invoke', headers=auth_headers, json={})
        assert r.status_code == 404
        # body 非法 JSON 不由后端解析（原样转发，由上游语义决定）——此处验证端点健壮性
        r = client.post('/api/apihub/admin/apis/99999/invoke', headers=auth_headers,
                        json={'body': '任意字符串'})
        assert r.status_code == 404
