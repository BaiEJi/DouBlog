"""namespace 维度限流测试：本地降级 / Redis（lizysdk SlidingWindowCounter）/ 配置与重置。

覆盖：
- 默认未启用不限流；启用后 GET/PUT/DELETE 三条单条路由均按 namespace 计数
  （PUT 写入同样占额度——测试期望值已计入）
- 本地滑动窗口：超限 429 信封（RATE_LIMITED + details.retry_after/mode）、
  空间隔离、窗口到期恢复（monkeypatch _monotonic 时间接缝）、覆盖行更严/豁免
- Redis 路径：confcenter_rl 前缀 ZSET、被拒也占名额（allow 先计数语义）、
  状态端点 tracked、缓存 flush 不误伤限流键
- 降级：EVAL 抛错 → 本次即时本地判定（429 details.mode=local）
- 配置端点：保存/回显/部分缺省沿用/非法 400；reset 本地与 Redis 双路径
"""

import pytest

from app.confcenter import ratelimit as rl


@pytest.fixture
def enable(client, auth_headers):
    """启用限流（走真实 PUT 端点落盘 tmp data/ratelimit_config.json）。"""
    def _enable(**cfg):
        body = {'enabled': True, 'limit': 3, 'window_seconds': 60}
        body.update(cfg)
        r = client.put('/api/confcenter/ratelimit/config', json=body, headers=auth_headers)
        assert r.status_code == 200, r.json()
        return r.json()['data']
    return _enable


def put_kv(client, auth_headers, ns, key='k', value='v'):
    return client.put(f'/api/confcenter/{ns}/{key}', headers=auth_headers,
                      json={'type': 'str', 'data': value})


# ─── 未启用 / 生效范围 ─────────────────────────────────────

def test_disabled_by_default_no_limit(client, auth_headers):
    assert put_kv(client, auth_headers, 'app').status_code == 201
    for _ in range(30):
        r = client.get('/api/confcenter/app/k', headers=auth_headers)
        assert r.status_code == 200
    r = client.get('/api/confcenter/ratelimit/status', headers=auth_headers)
    assert r.json()['data']['mode'] == 'off'
    assert r.json()['data']['enabled'] is False


def test_get_put_delete_all_limited(client, auth_headers, enable):
    enable(limit=1)
    assert put_kv(client, auth_headers, 'app').status_code == 201   # 第 1 次：额度用完
    assert client.put('/api/confcenter/app/k2', headers=auth_headers,
                      json={'type': 'str', 'data': 'x'}).status_code == 429
    assert client.get('/api/confcenter/app/k', headers=auth_headers).status_code == 429
    assert client.delete('/api/confcenter/app/k', headers=auth_headers).status_code == 429
    # 浏览与管理端点不受限流影响
    assert client.get('/api/confcenter/namespaces', headers=auth_headers).status_code == 200
    assert client.get('/api/confcenter/entries', headers=auth_headers).status_code == 200


# ─── 本地滑动窗口 ─────────────────────────────────────────

def test_local_limit_429_envelope(client, auth_headers, enable):
    enable(limit=4, window_seconds=60)
    put_kv(client, auth_headers, 'app')                     # 1
    for _ in range(3):                                      # 2 3 4
        assert client.get('/api/confcenter/app/k', headers=auth_headers).status_code == 200
    r = client.get('/api/confcenter/app/k', headers=auth_headers)
    assert r.status_code == 429
    body = r.json()
    assert body['success'] is False and body['code'] == 429
    assert body['data']['error_code'] == 'RATE_LIMITED'
    details = body['data']['details']
    assert details['namespace'] == 'app' and details['limit'] == 4
    assert details['mode'] == 'local' and details['retry_after'] >= 1


def test_namespace_isolation(client, auth_headers, enable):
    enable(limit=2)
    put_kv(client, auth_headers, 'a')                        # a: 1
    put_kv(client, auth_headers, 'b')                        # b: 1
    assert client.get('/api/confcenter/a/k', headers=auth_headers).status_code == 200   # a: 2
    assert client.get('/api/confcenter/a/k', headers=auth_headers).status_code == 429
    # b 空间额度独立
    assert client.get('/api/confcenter/b/k', headers=auth_headers).status_code == 200


def test_window_expiry_recovers(client, auth_headers, enable, monkeypatch):
    enable(limit=3, window_seconds=60)
    clock = {'now': 1000.0}
    monkeypatch.setattr(rl, '_monotonic', lambda: clock['now'])
    put_kv(client, auth_headers, 'app')                      # 1
    assert client.get('/api/confcenter/app/k', headers=auth_headers).status_code == 200   # 2
    assert client.get('/api/confcenter/app/k', headers=auth_headers).status_code == 200   # 3
    assert client.get('/api/confcenter/app/k', headers=auth_headers).status_code == 429
    clock['now'] += 60.1                                     # 最老事件出窗
    assert client.get('/api/confcenter/app/k', headers=auth_headers).status_code == 200


def test_override_tighter_and_exempt(client, auth_headers, enable):
    enable(limit=10, overrides={
        'tight': {'limit': 1, 'window_seconds': 60},
        'free': {'limit': 0, 'window_seconds': 60},
    })
    put_kv(client, auth_headers, 'tight')                    # tight: 1（额度即满）
    assert client.get('/api/confcenter/tight/k', headers=auth_headers).status_code == 429
    put_kv(client, auth_headers, 'free')
    for _ in range(15):                                      # 豁免空间不限流
        assert client.get('/api/confcenter/free/k', headers=auth_headers).status_code == 200


def test_local_status_tracked_and_counters(client, auth_headers, enable):
    enable(limit=5)
    put_kv(client, auth_headers, 'app')
    client.get('/api/confcenter/app/k', headers=auth_headers)
    client.get('/api/confcenter/app/k', headers=auth_headers)
    client.get('/api/confcenter/none/k', headers=auth_headers)     # 404 前也已计数
    r = client.get('/api/confcenter/ratelimit/status', headers=auth_headers)
    d = r.json()['data']
    assert d['enabled'] is True and d['mode'] == 'local'
    assert d['tracked'] == {'app': 3, 'none': 1}
    assert d['allowed'] == 4 and d['rejected'] == 0
    assert d['redis']['configured'] is False


# ─── Redis 路径（lizysdk SlidingWindowCounter + FakeRedis）──

def test_redis_mode_uses_sliding_window(cache_env, client, auth_headers, enable):
    enable(limit=3, window_seconds=60)
    put_kv(client, auth_headers, 'app')                      # ZSET: 1
    assert client.get('/api/confcenter/app/k', headers=auth_headers).status_code == 200   # 2
    assert client.get('/api/confcenter/app/k', headers=auth_headers).status_code == 200   # 3
    r = client.get('/api/confcenter/app/k', headers=auth_headers)
    assert r.status_code == 429
    assert r.json()['data']['details']['mode'] == 'redis'
    # allow 先计数再判定：被拒请求同样占名额（3 允许 + 1 拒绝 = 4 member）
    assert cache_env.zcard('confcenter_rl:app') == 4
    st = client.get('/api/confcenter/ratelimit/status', headers=auth_headers).json()['data']
    assert st['mode'] == 'redis' and st['tracked'] == {'app': 4}
    assert st['redis']['reachable'] is True


def test_redis_prefix_not_flushed_by_cache(cache_env, client, auth_headers, enable):
    enable(limit=5)
    put_kv(client, auth_headers, 'app')
    client.get('/api/confcenter/app/k', headers=auth_headers)
    assert 'confcenter_rl:app' in cache_env.zsets
    r = client.post('/api/confcenter/cache/flush', headers=auth_headers)
    assert r.status_code == 200
    assert 'confcenter_rl:app' in cache_env.zsets      # 下划线前缀不被 confcenter:* 误伤


def test_redis_eval_failure_degrades_local(client, auth_headers, monkeypatch, enable):
    from tests.confcenter.conftest import FakeRedis
    fake = FakeRedis(eval_fail=True)
    monkeypatch.setattr('app.confcenter.cache._build_client', lambda c: fake)
    body = {'enabled': True, 'host': '127.0.0.1', 'port': 6379, 'db': 0,
            'password': '', 'ttl_seconds': 60}
    assert client.put('/api/confcenter/cache/config', json=body,
                      headers=auth_headers).status_code == 200
    enable(limit=3)
    put_kv(client, auth_headers, 'app')                      # EVAL 失败 → 本地 1
    assert client.get('/api/confcenter/app/k', headers=auth_headers).status_code == 200   # 2
    assert client.get('/api/confcenter/app/k', headers=auth_headers).status_code == 200   # 3
    r = client.get('/api/confcenter/app/k', headers=auth_headers)
    assert r.status_code == 429
    assert r.json()['data']['details']['mode'] == 'local'   # EVAL 抛错即时降级


# ─── 配置管理端点 ─────────────────────────────────────────

def test_config_roundtrip_partial_update_and_persistence(client, auth_headers, enable):
    saved = enable(limit=7, window_seconds=120, overrides={
        'tight': {'limit': 1, 'window_seconds': 30}})
    assert saved['limit'] == 7 and saved['window_seconds'] == 120
    # 部分更新：只改 enabled，其余沿用
    r = client.put('/api/confcenter/ratelimit/config', json={'enabled': False},
                   headers=auth_headers)
    d = r.json()['data']
    assert d == {'enabled': False, 'limit': 7, 'window_seconds': 120,
                 'overrides': {'tight': {'limit': 1, 'window_seconds': 30}}}
    # 回显与落盘文件一致
    assert client.get('/api/confcenter/ratelimit/config',
                      headers=auth_headers).json()['data'] == d
    import json as _json
    with open(rl.config_path(), encoding='utf-8') as f:
        assert _json.load(f) == d


@pytest.mark.parametrize('body', [
    {'enabled': 'yes'},                          # enabled 非布尔
    {'limit': 'abc'},                            # limit 非整数
    {'limit': 0},                                # 全局 limit 不允许 0（豁免用 overrides）
    {'window_seconds': 0},                       # 窗口非法
    {'overrides': []},                           # overrides 非对象
    {'overrides': {'bad ns!': {'limit': 1, 'window_seconds': 60}}},   # 非法 namespace
    {'overrides': {'ok': {'limit': 1}}},         # 覆盖行缺 window_seconds
    {'overrides': {'ok': {'limit': -1, 'window_seconds': 60}}},       # 覆盖行 limit 非法
])
def test_config_validation_400(client, auth_headers, body):
    r = client.put('/api/confcenter/ratelimit/config', json=body, headers=auth_headers)
    assert r.status_code == 400


def test_reset_local_and_redis(cache_env, client, auth_headers, enable):
    enable(limit=3)
    put_kv(client, auth_headers, 'app')                      # 1
    assert client.get('/api/confcenter/app/k', headers=auth_headers).status_code == 200   # 2
    assert client.get('/api/confcenter/app/k', headers=auth_headers).status_code == 200   # 3
    assert client.get('/api/confcenter/app/k', headers=auth_headers).status_code == 429
    r = client.post('/api/confcenter/ratelimit/reset', json={'namespace': 'app'},
                    headers=auth_headers)
    assert r.status_code == 200
    d = r.json()['data']
    assert d['redis_cleared'] is True
    assert 'confcenter_rl:app' not in cache_env.zsets
    assert client.get('/api/confcenter/app/k', headers=auth_headers).status_code == 200


def test_reset_local_only(client, auth_headers, enable):
    enable(limit=1)
    put_kv(client, auth_headers, 'app')                      # 1（额度即满）
    assert client.get('/api/confcenter/app/k', headers=auth_headers).status_code == 429
    r = client.post('/api/confcenter/ratelimit/reset', json={'namespace': 'app'},
                    headers=auth_headers)
    assert r.status_code == 200
    assert r.json()['data']['local_cleared'] is True
    assert r.json()['data']['redis_cleared'] is False
    assert client.get('/api/confcenter/app/k', headers=auth_headers).status_code == 200


def test_reset_invalid_namespace_400(client, auth_headers):
    r = client.post('/api/confcenter/ratelimit/reset', json={'namespace': 'bad ns'},
                    headers=auth_headers)
    assert r.status_code == 400


def test_ratelimit_endpoints_require_auth(client):
    for method, path in [('get', '/api/confcenter/ratelimit/status'),
                         ('get', '/api/confcenter/ratelimit/config'),
                         ('put', '/api/confcenter/ratelimit/config'),
                         ('post', '/api/confcenter/ratelimit/reset')]:
        if method == 'get':
            assert getattr(client, method)(path).status_code == 401
        else:
            assert getattr(client, method)(path, json={}).status_code == 401
