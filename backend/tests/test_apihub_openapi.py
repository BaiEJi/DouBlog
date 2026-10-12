"""API Hub OpenAPI 发布测试（2026-10-12）：内部信任令牌 + 二级分组 + /openapi 入口 + /doc。

覆盖：
- require_basic 的 X-Apihub-Token 内部令牌旁路（服务内 API 不走用户身份验证）
- 管理端分组/对外名称/文档字段校验（二级需一级、字符集、'doc' 保留、组内重名）
- /openapi/{g1}/{g2}/{name} 透明转发（query/body 透传、路径变量取 query、401/404/405/400）
- /openapi/.../doc Markdown 文档（元信息/路径变量/限流/示例/自定义段落）
- api 级限流在 /openapi 入口同样生效（429 + 响应头）
- ensure_migrations 幂等补列
"""
import json
import threading
from http.server import ThreadingHTTPServer

import pytest
from sqlalchemy import create_engine, text

from tests.test_apihub_api import BEARER_AUTH, _make_handler


@pytest.fixture(scope='module')
def upstream_base():
    server = ThreadingHTTPServer(('127.0.0.1', 0), _make_handler())
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f'http://127.0.0.1:{server.server_address[1]}'
    server.shutdown()


def _mk(client, auth_headers, upstream_base, *, slug, path_tpl='/echo', method='POST',
        group1='', group2='', pub_name='', doc_md=''):
    r = client.post('/api/apihub/admin/upstreams', headers=auth_headers, json={
        'name': f'u-{slug}', 'slug': f'u-{slug}', 'base_url': upstream_base,
        'timeout_ms': 3000, 'max_retry': 0, 'auth_config': BEARER_AUTH})
    assert r.status_code == 200, r.text
    uid = r.json()['data']['id']
    r = client.post(f'/api/apihub/admin/upstreams/{uid}/keys', headers=auth_headers,
                    json={'credential': {'token': 'good-key'}})
    assert r.status_code == 200
    r = client.post('/api/apihub/admin/apis', headers=auth_headers, json={
        'name': f'a-{slug}', 'slug': slug, 'upstream_id': uid, 'method': method,
        'path_tpl': path_tpl, 'group1': group1, 'group2': group2,
        'pub_name': pub_name, 'doc_md': doc_md})
    assert r.status_code == 200, r.text
    api_id = r.json()['data']['id']
    r = client.post('/api/apihub/admin/tokens', headers=auth_headers, json={'name': f't-{slug}'})
    data = r.json()['data']
    return api_id, data['id'], data['key']


# ─── 内部信任令牌（服务内 API 不走用户身份验证）──────────────────

class TestInternalToken:
    def test_internal_token_bypasses_auth(self, client):
        from app.shared.auth import INTERNAL_TOKEN_HEADER, internal_token
        r = client.get('/api/todo/tasks', headers={INTERNAL_TOKEN_HEADER: internal_token()})
        assert r.status_code == 200, r.text
        assert r.json()['success'] is True

    def test_wrong_internal_token_rejected(self, client):
        r = client.get('/api/todo/tasks', headers={'X-Apihub-Token': 'forged'})
        assert r.status_code == 401


# ─── 管理端分组校验 ─────────────────────────────────────────────

class TestGroupValidation:
    def test_group2_requires_group1(self, client, auth_headers, upstream_base):
        uid = client.post('/api/apihub/admin/upstreams', headers=auth_headers, json={
            'name': 'u-gv1', 'slug': 'u-gv1', 'base_url': upstream_base,
            'auth_config': BEARER_AUTH}).json()['data']['id']
        r = client.post('/api/apihub/admin/apis', headers=auth_headers, json={
            'name': 'a', 'slug': 'a-gv1', 'upstream_id': uid,
            'group1': '', 'group2': 'sub'})
        assert r.status_code == 400
        assert '二级分组需要一级分组' in r.json()['message']

    def test_group_charset(self, client, auth_headers, upstream_base):
        uid = client.post('/api/apihub/admin/upstreams', headers=auth_headers, json={
            'name': 'u-gv2', 'slug': 'u-gv2', 'base_url': upstream_base,
            'auth_config': BEARER_AUTH}).json()['data']['id']
        r = client.post('/api/apihub/admin/apis', headers=auth_headers, json={
            'name': 'a', 'slug': 'a-gv2', 'upstream_id': uid, 'group1': '非法/组'})
        assert r.status_code == 400

    def test_doc_name_reserved(self, client, auth_headers, upstream_base):
        uid = client.post('/api/apihub/admin/upstreams', headers=auth_headers, json={
            'name': 'u-gv3', 'slug': 'u-gv3', 'base_url': upstream_base,
            'auth_config': BEARER_AUTH}).json()['data']['id']
        r = client.post('/api/apihub/admin/apis', headers=auth_headers, json={
            'name': 'a', 'slug': 'doc', 'upstream_id': uid, 'group1': 'g'})
        assert r.status_code == 400
        assert '保留字' in r.json()['message']

    def test_pub_name_unique_in_group(self, client, auth_headers, upstream_base):
        _mk(client, auth_headers, upstream_base, slug='op-dup-a',
            group1='g', pub_name='same')
        uid = client.post('/api/apihub/admin/upstreams', headers=auth_headers, json={
            'name': 'u-gv4', 'slug': 'u-gv4', 'base_url': upstream_base,
            'auth_config': BEARER_AUTH}).json()['data']['id']
        r = client.post('/api/apihub/admin/apis', headers=auth_headers, json={
            'name': 'a', 'slug': 'op-dup-b', 'upstream_id': uid,
            'group1': 'g', 'pub_name': 'same'})
        assert r.status_code == 400

    def test_fields_roundtrip(self, client, auth_headers, upstream_base):
        _mk(client, auth_headers, upstream_base, slug='op-rt',
            group1='svc', group2='mod', pub_name='my-api', doc_md='说明')
        r = client.get('/api/apihub/admin/apis', headers=auth_headers)
        row = next(a for a in r.json()['data'] if a['slug'] == 'op-rt')
        assert (row['group1'], row['group2'], row['pub_name'], row['doc_md']) == \
            ('svc', 'mod', 'my-api', '说明')


# ─── /openapi 调用入口 ─────────────────────────────────────────

class TestOpenapiCall:
    @pytest.fixture(autouse=True)
    def _env(self, client, auth_headers, upstream_base):
        self.api_id, self.tok_id, self.sk = _mk(
            client, auth_headers, upstream_base, slug='op-echo',
            path_tpl='/echo/{path.item}', method='POST',
            group1='g1', group2='g2', pub_name='echo-api', doc_md='自定义文档段落')
        self.h = {'Authorization': f'Bearer {self.sk}'}

    def test_no_token_401(self, client):
        assert client.post('/openapi/g1/g2/echo-api').status_code == 401

    def test_unknown_404(self, client):
        r = client.post('/openapi/g1/g2/nope', headers=self.h)
        assert r.status_code == 404

    def test_wrong_method_405(self, client):
        r = client.get('/openapi/g1/g2/echo-api?item=1', headers=self.h)
        assert r.status_code == 405

    def test_forward_and_path_var(self, client):
        r = client.post('/openapi/g1/g2/echo-api?item=42&x=1', headers=self.h,
                        json={'k': 1})
        assert r.status_code == 200
        d = r.json()
        assert d['path'] == '/echo/42'          # path 变量从 query 提取
        assert d['query'] == {'x': '1'}         # 其余 query 透传（item 已消费）
        assert d['body'] == {'k': 1}            # body 透传
        assert d['headers'].get('authorization') == 'Bearer good-key'  # 上游凭证注入
        assert 'X-Hub-Latency-Ms' in r.headers

    def test_missing_path_var_400(self, client):
        r = client.post('/openapi/g1/g2/echo-api?x=1', headers=self.h, json={})
        assert r.status_code == 400
        assert 'item' in r.json()['message']

    def test_one_level_group(self, client, auth_headers, upstream_base):
        _mk(client, auth_headers, upstream_base, slug='op-flat',
            method='GET', group1='solo', pub_name='flat-api')
        r = client.get('/openapi/solo/flat-api', headers=self.h)
        assert r.status_code == 200
        assert r.json()['method'] == 'GET'


# ─── /doc 文档 ─────────────────────────────────────────────────

class TestOpenapiDoc:
    @pytest.fixture(autouse=True)
    def _env(self, client, auth_headers, upstream_base):
        self.api_id, self.tok_id, self.sk = _mk(
            client, auth_headers, upstream_base, slug='op-doc',
            path_tpl='/echo/{path.item}', method='POST',
            group1='g1', group2='g2', pub_name='doc-api', doc_md='自定义文档段落')
        client.post('/api/apihub/admin/rules', headers=auth_headers, json={
            'scope': 'api', 'api_id': self.api_id,
            'algorithm': 'token_bucket', 'rate_per_sec': 10, 'burst': 20})

    def test_doc_public_and_markdown(self, client):
        r = client.get('/openapi/g1/g2/doc-api/doc')     # 无令牌（文档公开）
        assert r.status_code == 200
        assert r.headers['content-type'].startswith('text/markdown')
        md = r.text
        assert '# doc-api' in md
        assert '`g1/g2`' in md                       # 分组
        assert '`POST`' in md                        # 方法
        assert '/echo/{path.item}' in md             # 路径模板
        assert '| `item` |' in md                    # 路径变量表
        assert 'Bearer sk-' in md                    # 认证说明 + curl 示例
        assert '10/s' in md                          # 限流值
        assert '自定义文档段落' in md                  # doc_md

    def test_doc_unknown_404(self, client):
        assert client.get('/openapi/g1/g2/nope/doc').status_code == 404


# ─── /openapi 限流（与 gw 共用 api 级规则）─────────────────────

class TestOpenapiRateLimit:
    @pytest.fixture(autouse=True)
    def _env(self, client, auth_headers, upstream_base):
        self.api_id, self.tok_id, self.sk = _mk(
            client, auth_headers, upstream_base, slug='op-rl',
            method='GET', group1='g1', group2='g2', pub_name='rl-api')
        client.post('/api/apihub/admin/rules', headers=auth_headers, json={
            'scope': 'api', 'api_id': self.api_id,
            'algorithm': 'fixed_window', 'window_s': 60, 'max_count': 2})

    def test_429(self, client):
        h = {'Authorization': f'Bearer {self.sk}'}
        codes = [client.get('/openapi/g1/g2/rl-api', headers=h).status_code for _ in range(3)]
        assert codes[:2] == [200, 200] and codes[2] == 429
        r = client.get('/openapi/g1/g2/rl-api', headers=h)
        assert r.status_code == 429
        assert r.headers.get('retry-after')
        assert r.headers.get('x-ratelimit-scope') == 'api'


# ─── 一键启停（管理页行内开关）─────────────────────────────────

class TestToggleApi:
    @pytest.fixture(autouse=True)
    def _env(self, client, auth_headers, upstream_base):
        self.api_id, self.tok_id, self.sk = _mk(
            client, auth_headers, upstream_base, slug='op-tg',
            method='GET', group1='g1', group2='g2', pub_name='tg-api')
        self.h = {'Authorization': f'Bearer {self.sk}'}

    def test_toggle_off_blocks_calls(self, client, auth_headers):
        r = client.put(f'/api/apihub/admin/apis/{self.api_id}/enabled',
                       headers=auth_headers, json={'enabled': False})
        assert r.status_code == 200 and r.json()['data']['enabled'] is False
        # 两个入口都立即 503「已关闭，不可用」
        r = client.get('/openapi/g1/g2/tg-api', headers=self.h)
        assert r.status_code == 503 and '已关闭，不可用' in r.json()['message']
        r = client.post(f'/api/apihub/gw/apis/op-tg', headers=self.h, json={})
        assert r.status_code == 503 and '已关闭，不可用' in r.json()['message']
        # doc 仍可访问（文档不受启停影响）
        assert client.get('/openapi/g1/g2/tg-api/doc').status_code == 200

    def test_toggle_on_restores(self, client, auth_headers):
        client.put(f'/api/apihub/admin/apis/{self.api_id}/enabled',
                   headers=auth_headers, json={'enabled': False})
        r = client.put(f'/api/apihub/admin/apis/{self.api_id}/enabled',
                       headers=auth_headers, json={'enabled': True})
        assert r.status_code == 200 and r.json()['data']['enabled'] is True
        assert client.get('/openapi/g1/g2/tg-api', headers=self.h).status_code == 200

    def test_toggle_unknown_404(self, client, auth_headers):
        r = client.put('/api/apihub/admin/apis/999999/enabled',
                       headers=auth_headers, json={'enabled': True})
        assert r.status_code == 404


# ─── 存量库补列 ─────────────────────────────────────────────────

class TestEnsureMigrations:
    def test_adds_columns_idempotent(self):
        from app.apihub import ensure_migrations
        eng = create_engine('sqlite://')
        with eng.begin() as conn:
            conn.execute(text('CREATE TABLE apihub_apis (id INTEGER PRIMARY KEY, slug VARCHAR(64))'))
        ensure_migrations(eng)
        cols = {c['name'] for c in __import__('sqlalchemy').inspect(eng).get_columns('apihub_apis')}
        assert {'group1', 'group2', 'pub_name', 'doc_md'} <= cols
        ensure_migrations(eng)   # 幂等
        _ = json.dumps(sorted(cols))
