"""mihomo 控制器转发层测试：假控制器（http.server）覆盖鉴权/编码/形状/错误分支。"""
from tests.clash.conftest import AUTH


def _get(client, path, expect=200):
    r = client.get(f'/api/clash{path}', headers=AUTH)
    assert r.status_code == expect, r.json()
    return r.json()


def _call(client, method, path, json=None, expect=200):
    r = client.request(method, f'/api/clash{path}', json=json, headers=AUTH)
    assert r.status_code == expect, r.json()
    return r.json()


# ─── 基础：version / configs ─────────────────────────────

def test_version_and_configs(client, fake_controller):
    assert _get(client, '/controller/version')['data']['meta'] is True
    cfg = _get(client, '/controller/configs')['data']
    assert cfg == {'mode': 'rule', 'allow-lan': False, 'log-level': 'info',
                   'port': None, 'socks-port': None, 'mixed-port': 7890,
                   'bind-address': None, 'ipv6': None, 'tun': None}


def test_configs_patch_validation_and_pass(client, fake_controller, monkeypatch):
    """mode 白名单 400；合法 PATCH 转发到控制器并回读。"""
    _call(client, 'patch', '/controller/configs', {'mode': 'beta'}, expect=400)
    _call(client, 'patch', '/controller/configs', {'log_level': 'loud'}, expect=400)
    _call(client, 'patch', '/controller/configs', {}, expect=400)
    body = _call(client, 'patch', '/controller/configs',
                 {'mode': 'global', 'allow_lan': True, 'log_level': 'warning'})
    assert body['message'] == '运行时配置已热切换'
    import urllib.parse
    sent = [p for m, p in fake_controller[1] if m == 'PATCH'][-1]
    assert sent == '/configs'


# ─── 代理组 / 切换 / 延迟 ────────────────────────────────

def test_proxies_list_shape(client, fake_controller):
    data = _get(client, '/controller/proxies')['data']
    groups = {g['name']: g for g in data['groups']}
    assert set(groups) == {'🚀 节点选择', '♻️ 自动选择'}
    sel = groups['🚀 节点选择']
    assert sel['type'] == 'Selector' and sel['now'] == '香港 01'
    nodes = {n['name']: n for n in sel['nodes']}
    assert nodes['香港 01']['delay'] == 42 and nodes['香港 01']['alive'] is True
    assert nodes['日本 02']['delay'] is None and nodes['日本 02']['alive'] is False
    assert nodes['美国 03']['delay'] == 0            # 0 = 测过但失败


def test_proxy_select_encodes_path(client, fake_controller):
    """组名/节点名含 emoji 与空格——路径段必须正确编码且鉴权头携带密钥。"""
    body = _call(client, 'put', '/controller/proxies',
                 {'group': '🚀 节点选择', 'name': '日本 02'})
    assert body['data'] == {'group': '🚀 节点选择', 'now': '日本 02'}
    import urllib.parse
    sent = [p for m, p in fake_controller[1] if m == 'PUT'][-1]
    assert sent == '/proxies/' + urllib.parse.quote('🚀 节点选择', safe='')


def test_delay_single_and_group(client, fake_controller):
    d = _get(client, '/controller/proxies/delay?name=香港 01')['data']
    assert d == {'delay': 42}
    d = _get(client, '/controller/group/delay?group=🚀 节点选择')['data']
    assert d == {'香港 01': 42, '日本 02': 43, '美国 03': 44}
    # 延迟 url 校验：必须 http(s) 且无空格引号
    _get(client, '/controller/proxies/delay?name=x&url=ftp://a', expect=400)
    _get(client, '/controller/proxies/delay?name=x&url=https://a b', expect=400)


def test_controller_error_passthrough(client, fake_controller):
    """mihomo 4xx/408 → 400 信封透传其 message。"""
    body = _get(client, '/controller/proxies/delay?name=nope&url=bad', expect=400)
    assert 'delay test' in body['message'] or body['message']


# ─── 连接 ────────────────────────────────────────────────

def test_connections_shape_and_close(client, fake_controller):
    data = _get(client, '/controller/connections')['data']
    assert data['uploadTotal'] == 1024 and data['downloadTotal'] == 2048
    c = data['connections'][0]
    assert c['id'] == 'c1' and c['host'] == 'www.baidu.com'
    assert c['rule'] == 'GeoSite' and c['rulePayload'] == 'CN'
    assert c['chains'] == ['🚀 节点选择', '香港 01'] and c['source'] == '127.0.0.1:40000'
    body = _call(client, 'delete', '/controller/connections/c1')
    assert body['data'] == {'closed': 'c1'}
    body = _call(client, 'delete', '/controller/connections')
    assert body['data'] == {'closed': 'all'}


# ─── 规则 / Provider ─────────────────────────────────────

def test_rules_and_providers(client, fake_controller):
    data = _get(client, '/controller/rules')['data']
    assert data['total'] == 2 and data['rules'][0]['type'] == 'DOMAIN-SUFFIX'
    data = _get(client, '/controller/providers')['data']
    p = data['providers'][0]
    assert p['name'] == 'sub1' and p['vehicleType'] == 'HTTP'
    assert p['proxies'][0]['delay'] == 42
    body = _call(client, 'put', '/controller/providers', {'name': 'sub1'})
    assert body['message'] == '节点池已热更新'


# ─── 控制器不可达 / 鉴权 ─────────────────────────────────

def test_controller_unreachable(client, fake_clashctl):
    """runtime 指向不存在的端口 → 503「内核未运行」。"""
    import yaml
    path = fake_clashctl / 'resources' / 'runtime.yaml'
    cfg = yaml.safe_load(path.read_text()) or {}
    cfg['external-controller'] = '127.0.0.1:1'
    path.write_text(yaml.safe_dump(cfg))
    r = client.get('/api/clash/controller/version', headers=AUTH)
    assert r.status_code in (503, 500), r.json()
    assert '内核未运行' in r.json()['message'] or '控制器不可达' in r.json()['message']


def test_controller_endpoints_require_auth(client, fake_controller):
    r = client.get('/api/clash/controller/proxies')
    assert r.status_code == 401
