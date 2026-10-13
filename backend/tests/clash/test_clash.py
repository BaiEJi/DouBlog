"""clash 模块测试：安装检测 / 内核启停 / 状态语义 / 校验 / 配置读写 / 订阅管理 / 鉴权。

全部基于假 clashctl（conftest.fake_clashctl），无真实内核与网络依赖。
"""
from tests.clash.conftest import AUTH


def _get(client, path, expect=200):
    r = client.get(f'/api/clash{path}', headers=AUTH)
    assert r.status_code == expect, r.json()
    return r.json()


def _post(client, path, json=None, expect=200):
    r = client.post(f'/api/clash{path}', json=json, headers=AUTH)
    assert r.status_code == expect, r.json()
    return r.json()


# ─── 安装检测（门户卡片置灰依据）──────────────────────────

def test_availability_missing(client, tmp_path, monkeypatch):
    monkeypatch.setenv('DOUBLOG_CLASHCTL_DIR', str(tmp_path / 'nowhere'))
    body = _get(client, '/availability')
    assert body['data'] == {'available': False, 'base_dir': str(tmp_path / 'nowhere'), 'kernel': ''}


def test_avability_installed(client, fake_clashctl):
    body = _get(client, '/availability')
    assert body['data']['available'] is True
    assert body['data']['kernel'] == 'mihomo'
    assert body['data']['base_dir'] == str(fake_clashctl)


def test_endpoints_404_when_not_installed(client, tmp_path, monkeypatch):
    """未安装时除 availability 外全部 404（NotFoundError 信封），不 500。"""
    monkeypatch.setenv('DOUBLOG_CLASHCTL_DIR', str(tmp_path / 'nowhere'))
    # 带体端点给合法体——确保走到安装检测而不是先被参数校验拦下
    bodies = {'/proxy': {'enable': True}, '/tun': {'enable': True},
              '/secret': {'secret': 'x'}, '/config': {'content': ''},
              '/sub': {'action': 'add', 'url': 'https://x.example/s'}}
    for method, path in [('get', '/status'), ('post', '/on'), ('post', '/off'),
                         ('get', '/proxy'), ('post', '/proxy'), ('get', '/tun'),
                         ('post', '/tun'), ('get', '/ui'), ('get', '/secret'),
                         ('put', '/secret'), ('post', '/upgrade'), ('get', '/log'),
                         ('get', '/config'), ('put', '/config'), ('get', '/sub'),
                         ('post', '/sub'), ('get', '/sub/log')]:
        kwargs = {} if method == 'get' else {'json': bodies.get(path, {})}
        r = getattr(client, method)(f'/api/clash{path}', **kwargs, headers=AUTH)
        assert r.status_code == 404, (method, path, r.json())
        assert 'clashctl 未安装' in r.json()['message']


def test_auth_required(client, fake_clashctl):
    r = client.get('/api/clash/status')
    assert r.status_code == 401


# ─── 内核启停与状态 ───────────────────────────────────────

def test_status_running_roundtrip(client, fake_clashctl, state_dir, calls):
    assert _get(client, '/status')['data'] == {
        'running': False, 'output': ''}          # pgrep 无进程：rc=1、输出空

    body = _post(client, '/on')
    assert '已开启代理环境' in body['message']
    assert _get(client, '/status')['data']['running'] is True
    assert 'mihomo' in _get(client, '/status')['data']['output']

    _post(client, '/off')
    assert _get(client, '/status')['data']['running'] is False
    assert 'clashon' in calls() and 'clashoff' in calls()


def test_action_failure_passthrough(client, fake_clashctl, monkeypatch, calls):
    """动作失败（rc≠0）→ 400，message 透传 clashctl 首行输出。"""
    import app.clash.service as svc
    monkeypatch.setattr(svc, 'run_clashctl', lambda *a, **k: (1, '😾 启动失败: 执行 clashlog 查看日志'))
    body = _post(client, '/on', expect=400)
    assert '启动失败' in body['message']


def test_output_ansi_stripped(client, fake_clashctl):
    """假脚本输出带真彩色 ANSI 码，响应里必须已剥离。"""
    body = _post(client, '/on')
    assert '\x1b' not in body['message']
    assert body['message'] == '😼 已开启代理环境'


# ─── 系统代理 / Tun（rc 语义：0=启用 / 1=关闭）────────────

def test_system_proxy_toggle(client, fake_clashctl):
    assert _get(client, '/proxy')['data']['enabled'] is False
    _post(client, '/proxy', {'enable': True})
    data = _get(client, '/proxy')['data']
    assert data['enabled'] is True and '系统代理：开启' in data['output']
    _post(client, '/proxy', {'enable': False})
    assert _get(client, '/proxy')['data']['enabled'] is False


def test_tun_toggle(client, fake_clashctl):
    assert _get(client, '/tun')['data']['enabled'] is False
    _post(client, '/tun', {'enable': True})
    assert _get(client, '/tun')['data']['enabled'] is True
    _post(client, '/tun', {'enable': False})
    assert _get(client, '/tun')['data']['enabled'] is False


# ─── Web 控制台 / 密钥 / 升级 ──────────────────────────────

def test_ui_passthrough(client, fake_clashctl):
    assert '9090/ui' in _get(client, '/ui')['data']['output']


def test_secret_roundtrip_and_validation(client, fake_clashctl):
    assert _get(client, '/secret')['data']['secret'] == ''
    r = client.put('/api/clash/secret', json={'secret': 'new secret'}, headers=AUTH)
    assert r.status_code == 400                       # 含空格 → 拒绝
    r = client.put('/api/clash/secret', json={'secret': "a'b"}, headers=AUTH)
    assert r.status_code == 400                       # 含引号 → 拒绝
    body = client.put('/api/clash/secret', json={'secret': 'mysecret'}, headers=AUTH).json()
    assert body['success'] is True
    assert _get(client, '/secret')['data']['secret'] == 'mysecret'


def test_upgrade_channel_validation(client, fake_clashctl):
    body = _post(client, '/upgrade', {'channel': 'beta'}, expect=400)
    assert 'channel' in body['message']
    assert '内核升级成功' in _post(client, '/upgrade', {})['message']


# ─── 内核日志 / 配置文件 ──────────────────────────────────

def test_log_tail(client, fake_clashctl):
    data = _get(client, '/log?tail=5')['data']
    assert data['content'].splitlines() == [f'line-{i}' for i in range(46, 51)]


def test_log_missing_file(client, fake_clashctl):
    (fake_clashctl / 'resources' / 'mihomo.log').unlink()
    _get(client, '/log', expect=404)


def test_config_read_three_files(client, fake_clashctl):
    for name, expect in [('mixin', '_custom:'), ('base', 'proxies:'), ('runtime', 'mixed-port')]:
        data = _get(client, f'/config?file={name}')['data']
        assert expect in data['content'] and data['file'] == name
    assert _get(client, '/config?file=mixin')['data']['editable'] is True
    assert _get(client, '/config?file=base')['data']['editable'] is False
    _get(client, '/config?file=evil', expect=400)


def test_config_write_mixin_triggers_merge_restart(client, fake_clashctl, state_dir):
    r = client.put('/api/clash/config', json={'content': 'tun:\n  enable: true\n'}, headers=AUTH)
    assert r.status_code == 200, r.json()
    assert (state_dir / 'merge-restart').exists()          # 保存后合并+重启（同 clashmixin -e）
    assert 'tun:' in (fake_clashctl / 'resources' / 'mixin.yaml').read_text()


# ─── 订阅管理 ─────────────────────────────────────────────

def test_sub_list_parse(client, fake_clashctl):
    data = _get(client, '/sub')['data']
    assert data['profiles'] == [{'id': 1, 'url': 'https://example.com/sub',
                                 'path': None}] or data['profiles'][0]['url'] == 'https://example.com/sub'
    assert data['profiles'][0]['id'] == 1


def test_sub_add_url_validation(client, fake_clashctl, calls):
    for bad in ['', 'not-a-url', 'ftp://x.com/s', "https://x.com/a b", 'https://x.com/\'quote']:
        r = client.post('/api/clash/sub', json={'action': 'add', 'url': bad}, headers=AUTH)
        assert r.status_code == 400, bad
    assert not any(c.startswith('clashsub add') for c in calls())   # 校验失败不触达脚本

    body = _post(client, '/sub', {'action': 'add', 'url': 'https://airport.example/sub?token=abc'})
    assert '订阅已添加' in body['message']
    assert 'clashsub add https://airport.example/sub?token=abc' in calls()


def test_sub_id_validation_and_failure(client, fake_clashctl, calls):
    for bad in [None, 0, -1, 'x']:
        r = client.post('/api/clash/sub', json={'action': 'del', 'id': bad}, headers=AUTH)
        assert r.status_code == 400, bad
    body = _post(client, '/sub', {'action': 'del', 'id': 9}, expect=400)   # 假脚本：9 不存在
    assert '订阅 id 不存在' in body['message']
    assert 'clashsub del 9' in calls()


def test_sub_use_and_update_flags(client, fake_clashctl, calls):
    _post(client, '/sub', {'action': 'use', 'id': 1})
    assert 'clashsub use 1' in calls()
    _post(client, '/sub', {'action': 'update', 'id': 2, 'convert': True})
    assert 'clashsub update --convert 2' in calls()      # flag 必须在 id 前（clashctl 语义）
    _post(client, '/sub', {'action': 'update', 'auto': True})
    assert 'clashsub update --auto' in calls()
    r = client.post('/api/clash/sub', json={'action': 'fly'}, headers=AUTH)
    assert r.status_code == 400


def test_sub_log_tail(client, fake_clashctl):
    assert '已添加订阅' in _get(client, '/sub/log?tail=10')['data']['content']


# ─── 订阅下载直连（strip_proxy：不跟随后端进程的 *_proxy env）──

def test_sub_download_strips_proxy_env(client, fake_clashctl, monkeypatch, proxy_env_log):
    """带 *_proxy 的后端环境里，订阅 add/update 的子进程必须无代理 env（出口坏时不拖垮下载）。"""
    monkeypatch.setenv('https_proxy', 'http://127.0.0.1:7890')
    monkeypatch.setenv('HTTPS_PROXY', 'http://127.0.0.1:7890')
    body = _post(client, '/sub', {'action': 'add', 'url': 'https://x.example/s?token=1'})
    assert body['success'] is True
    _post(client, '/sub', {'action': 'update', 'id': 1})
    assert proxy_env_log()[-2:] == ['proxy=no', 'proxy=no']
    # 普通命令保留原 env（不动会话语径）
    _get(client, '/status')
    assert proxy_env_log()[-1] == 'proxy=yes'


# ─── 日志级别（实时日志开关：silent 时内核不写文件）─────────

def test_log_level_in_get_log(client, fake_clashctl):
    data = _get(client, '/log?tail=3')['data']
    assert data['level'] == 'info'          # runtime 未配置 → mihomo 默认 info


def test_log_level_switch_roundtrip(client, fake_clashctl, state_dir):
    body = client.post('/api/clash/log/level', json={'level': 'verbose'},
                       headers=AUTH).json()
    assert body['code'] == 400              # 非法级别

    r = client.post('/api/clash/log/level', json={'level': 'silent'}, headers=AUTH)
    assert r.status_code == 200, r.json()
    assert r.json()['data']['level'] == 'silent'
    assert (state_dir / 'merge-restart').exists()        # 切级别 = 写 mixin + 合并重启
    assert 'log-level: silent' in (fake_clashctl / 'resources' / 'mixin.yaml').read_text()
    assert _get(client, '/log?tail=3')['data']['level'] == 'silent'

    r = client.post('/api/clash/log/level', json={'level': 'info'}, headers=AUTH)
    assert r.json()['data']['level'] == 'info'
