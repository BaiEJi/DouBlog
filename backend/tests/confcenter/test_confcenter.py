"""配置中心 CRUD / 校验 / 浏览 / 鉴权测试（docs/confcenter-spec.md 第 6 节）。"""
from tests.confcenter.conftest import AUTH


def _put(client, namespace, key, type_, data, expect=201):
    r = client.put(f'/api/confcenter/{namespace}/{key}',
                   json={'type': type_, 'data': data}, headers=AUTH)
    assert r.status_code == expect, r.json()
    return r.json()['data']


def _get(client, namespace, key, expect=200):
    r = client.get(f'/api/confcenter/{namespace}/{key}', headers=AUTH)
    assert r.status_code == expect, r.json()
    return r.json()


# ─── CRUD：upsert 新建 201 / 覆盖 200 / 读回 / type 变更 / 删除 / 404 ──

def test_put_create_str_roundtrip(client):
    d = _put(client, 'app', 'site.name', 'str', 'DouBlog')
    assert d['namespace'] == 'app' and d['key'] == 'site.name'
    assert d['type'] == 'str' and d['data'] == 'DouBlog' and d['updated_at']
    body = _get(client, 'app', 'site.name')
    assert body['success'] is True and body['code'] == 200
    assert body['data']['data'] == 'DouBlog' and body['data']['type'] == 'str'


def test_str_keeps_string_shape(client):
    """str 值即使长得像 JSON/数字，读回也必须是字符串（显式 type 消歧义）。"""
    _put(client, 'app', 'num', 'str', '123')
    assert _get(client, 'app', 'num')['data']['data'] == '123'
    _put(client, 'app', 'arr', 'str', '[1,2]')
    assert _get(client, 'app', 'arr')['data']['data'] == '[1,2]'


def test_json_roundtrip_object_array_number(client):
    _put(client, 'cfg', 'feature.flags', 'json', '{"a":[1,2],"b":"x"}')
    assert _get(client, 'cfg', 'feature.flags')['data']['data'] == {'a': [1, 2], 'b': 'x'}

    _put(client, 'cfg', 'list', 'json', '[1,2,3]')
    assert _get(client, 'cfg', 'list')['data']['data'] == [1, 2, 3]

    _put(client, 'cfg', 'ratio', 'json', '0.75')
    assert _get(client, 'cfg', 'ratio')['data']['data'] == 0.75


def test_json_accepts_structured_body(client):
    """请求体里直接给 JSON 对象（非文本）同样合法。"""
    _put(client, 'cfg', 'inline', 'json', {'k': [True, None]})
    assert _get(client, 'cfg', 'inline')['data']['data'] == {'k': [True, None]}


def test_put_overwrite_200_whole_replace(client):
    _put(client, 'app', 'k1', 'str', 'v1')
    d = _put(client, 'app', 'k1', 'str', 'v2', expect=200)
    assert d['data'] == 'v2'
    assert _get(client, 'app', 'k1')['data']['data'] == 'v2'


def test_type_change_json_to_str(client):
    """type 变更：json→str 后读回字符串（整体覆盖语义）。"""
    _put(client, 'app', 'k2', 'json', '{"x":1}')
    assert _get(client, 'app', 'k2')['data']['data'] == {'x': 1}
    _put(client, 'app', 'k2', 'str', '{"x":1}', expect=200)
    body = _get(client, 'app', 'k2')['data']
    assert body['type'] == 'str' and body['data'] == '{"x":1}'


def test_type_change_str_to_json(client):
    _put(client, 'app', 'k3', 'str', 'plain')
    _put(client, 'app', 'k3', 'json', '[1,"a"]', expect=200)
    body = _get(client, 'app', 'k3')['data']
    assert body['type'] == 'json' and body['data'] == [1, 'a']


def test_get_missing_404(client):
    body = _get(client, 'nope', 'nope', expect=404)
    assert body['success'] is False and body['code'] == 404


def test_delete_lifecycle(client):
    _put(client, 'app', 'k4', 'str', 'gone')
    r = client.delete('/api/confcenter/app/k4', headers=AUTH)
    assert r.status_code == 200 and r.json()['success'] is True
    _get(client, 'app', 'k4', expect=404)
    r = client.delete('/api/confcenter/app/k4', headers=AUTH)
    assert r.status_code == 404


# ─── 校验：非法 type / json 非法 / key、namespace 非法字符 ──

def test_invalid_type_400(client):
    r = client.put('/api/confcenter/app/k', json={'type': 'num', 'data': '1'}, headers=AUTH)
    assert r.status_code == 400 and r.json()['code'] == 400
    r = client.put('/api/confcenter/app/k', json={'data': '1'}, headers=AUTH)
    assert r.status_code == 400


def test_invalid_json_400(client):
    r = client.put('/api/confcenter/app/k', json={'type': 'json', 'data': '[1,2'}, headers=AUTH)
    assert r.status_code == 400
    r = client.put('/api/confcenter/app/k', json={'type': 'json', 'data': '{"a":'}, headers=AUTH)
    assert r.status_code == 400
    # 数据库不应有残留
    _get(client, 'app', 'k', expect=404)


def test_str_requires_string_data(client):
    r = client.put('/api/confcenter/app/k', json={'type': 'str', 'data': 123}, headers=AUTH)
    assert r.status_code == 400
    r = client.put('/api/confcenter/app/k', json={'type': 'str'}, headers=AUTH)
    assert r.status_code == 400


def test_invalid_key_chars_400(client):
    """非法字符（percent-encode 后仍在单段内）→ 400 拒绝。"""
    from urllib.parse import quote
    for bad in ('bad key!', 'x?y', '注入', 'a\\b', 'p%q', 'k#1', 'a b'):
        r = client.put(f'/api/confcenter/app/{quote(bad, safe="")}',
                       json={'type': 'str', 'data': 'v'}, headers=AUTH)
        assert r.status_code == 400, bad


def test_invalid_namespace_chars_400(client):
    from urllib.parse import quote
    for bad in ('bad ns', 'ns?x', '空 格'):
        r = client.put(f'/api/confcenter/{quote(bad, safe="")}/k',
                       json={'type': 'str', 'data': 'v'}, headers=AUTH)
        assert r.status_code == 400, bad


def test_slash_cannot_reach_route(client):
    """含 / 的 namespace/key 拼进 URL 会变成三段路径——不匹配任何路由，404（天然防注入）。"""
    r = client.put('/api/confcenter/ns/x/k', json={'type': 'str', 'data': 'v'}, headers=AUTH)
    assert r.status_code == 404
    r = client.put('/api/confcenter/app/a/b', json={'type': 'str', 'data': 'v'}, headers=AUTH)
    assert r.status_code == 404


def test_length_limits_400(client):
    r = client.put('/api/confcenter/' + 'n' * 101 + '/k',
                   json={'type': 'str', 'data': 'v'}, headers=AUTH)
    assert r.status_code == 400
    r = client.put(f'/api/confcenter/app/{ "k" * 201 }',
                   json={'type': 'str', 'data': 'v'}, headers=AUTH)
    assert r.status_code == 400


def test_allowed_charset_boundary(client):
    """白名单字符（_ . : -）全部合法。"""
    _put(client, 'ns_1.v2:c-3', 'key_1.v2:c-3', 'str', 'ok')
    assert _get(client, 'ns_1.v2:c-3', 'key_1.v2:c-3')['data']['data'] == 'ok'


# ─── 浏览：namespaces 聚合、entries 过滤分页 ─────────────

def _seed(client):
    _put(client, 'app', 'site.name', 'str', 'DouBlog')
    _put(client, 'app', 'site.desc', 'str', 'blog')
    _put(client, 'app', 'feature.flags', 'json', '{"dark": true}')
    _put(client, 'infra', 'redis.port', 'str', '6379')


def test_namespaces_aggregation(client):
    _seed(client)
    r = client.get('/api/confcenter/namespaces', headers=AUTH)
    assert r.status_code == 200
    assert r.json()['data'] == [{'namespace': 'app', 'count': 3},
                                {'namespace': 'infra', 'count': 1}]


def test_entries_filter_by_namespace(client):
    _seed(client)
    d = client.get('/api/confcenter/entries', params={'namespace': 'infra'},
                   headers=AUTH).json()['data']
    assert d['total'] == 1 and d['items'][0]['key'] == 'redis.port'
    d = client.get('/api/confcenter/entries', headers=AUTH).json()['data']
    assert d['total'] == 4


def test_entries_search_q_matches_key(client):
    _seed(client)
    d = client.get('/api/confcenter/entries', params={'q': 'site'}, headers=AUTH).json()['data']
    assert d['total'] == 2 and {i['key'] for i in d['items']} == {'site.name', 'site.desc'}
    d = client.get('/api/confcenter/entries', params={'namespace': 'app', 'q': 'flags'},
                   headers=AUTH).json()['data']
    assert d['total'] == 1 and d['items'][0]['type'] == 'json'
    assert d['items'][0]['data'] == {'dark': True}     # 浏览视图同样按解析后返回
    d = client.get('/api/confcenter/entries', params={'q': 'zzz'}, headers=AUTH).json()['data']
    assert d['total'] == 0 and d['items'] == []


def test_entries_pagination(client):
    for i in range(5):
        _put(client, 'pg', f'k{i:02d}', 'str', f'v{i}')
    d = client.get('/api/confcenter/entries', params={'page': 1, 'page_size': 2},
                   headers=AUTH).json()['data']
    assert d['total'] == 5 and d['page'] == 1 and d['page_size'] == 2 and d['pages'] == 3
    assert [i['key'] for i in d['items']] == ['k00', 'k01']
    d = client.get('/api/confcenter/entries', params={'page': 3, 'page_size': 2},
                   headers=AUTH).json()['data']
    assert [i['key'] for i in d['items']] == ['k04']
    d = client.get('/api/confcenter/entries', params={'page': 9, 'page_size': 2},
                   headers=AUTH).json()['data']
    assert d['items'] == []
    # 非法分页参数回退默认
    d = client.get('/api/confcenter/entries', params={'page': 'x', 'page_size': 'y'},
                   headers=AUTH).json()['data']
    assert d['total'] == 5


# ─── 鉴权：无凭据 401 ───────────────────────────────────

def test_auth_required(client):
    for method, path in (
        ('get', '/api/confcenter/namespaces'),
        ('get', '/api/confcenter/entries'),
        ('get', '/api/confcenter/app/k'),
        ('put', '/api/confcenter/app/k'),
        ('delete', '/api/confcenter/app/k'),
        ('get', '/api/confcenter/cache/status'),
        ('put', '/api/confcenter/cache/config'),
        ('post', '/api/confcenter/cache/test'),
        ('post', '/api/confcenter/cache/flush'),
    ):
        r = getattr(client, method)(path)
        assert r.status_code == 401, (method, path)
        body = r.json()
        assert body['success'] is False and body['code'] == 401


def test_wrong_credentials_401(client):
    import base64
    bad = {'Authorization': 'Basic ' + base64.b64encode(b'admin:wrong').decode()}
    r = client.get('/api/confcenter/namespaces', headers=bad)
    assert r.status_code == 401