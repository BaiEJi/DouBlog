"""Redis 缓存层测试（monkeypatch 假 Redis）：五路径 + 缓存管理端点。

五路径（docs/confcenter-spec.md 第 6 节）：
1. 命中（直接返回缓存值，hits+1）
2. 未命中回填（介 DB，SETEX 键/TTL/载荷，misses+1）
3. 写后失效（先落库再 DEL）
4. 未启用 → 直连 DB（零 Redis 交互、零计数）
5. 连接抛错 → 静默降级直连 DB（不计数、进程内只 warn 一次）
"""
import json
import logging
import os

from app.confcenter import cache as cache_mod
from app.config import settings
from tests.confcenter.conftest import AUTH, FakeRedis

def _key():
    return cache_mod.cache_key('app', 'k1')


def _put(client, namespace, key, type_, data, expect=201):
    r = client.put(f'/api/confcenter/{namespace}/{key}',
                   json={'type': type_, 'data': data}, headers=AUTH)
    assert r.status_code == expect, r.json()
    return r


def _status(client):
    r = client.get('/api/confcenter/cache/status', headers=AUTH)
    assert r.status_code == 200
    return r.json()['data']


# ─── 路径 4：未启用 → 直连 DB ───────────────────────────

def test_disabled_bypasses_redis(client, monkeypatch):
    calls = []

    def _should_not_build(cfg):
        calls.append(cfg)
        raise AssertionError('未启用时不应构建 Redis 客户端')

    monkeypatch.setattr(cache_mod, '_build_client', _should_not_build)
    _put(client, 'app', 'k1', 'str', 'v1')
    r = client.get('/api/confcenter/app/k1', headers=AUTH)
    assert r.status_code == 200 and r.json()['data']['data'] == 'v1'
    assert calls == []
    st = _status(client)
    assert st['enabled'] is False and st['reachable'] is False
    assert st['hits'] == 0 and st['misses'] == 0


# ─── 路径 2：未命中 → 介 DB + 回填 ──────────────────────

def test_miss_backfills_cache(client, auth_headers, cache_env):
    _put(client, 'app', 'k1', 'str', 'v1')
    cache_env.store.clear()          # 写路径 DEL 后应无键
    assert cache_env.store == {}

    r = client.get('/api/confcenter/app/k1', headers=AUTH)
    assert r.status_code == 200 and r.json()['data']['data'] == 'v1'

    # 回填：键名/载荷/TTL 正确
    assert _key() in cache_env.store
    payload = json.loads(cache_env.store[_key()])
    assert payload['type'] == 'str' and payload['data'] == 'v1' and payload['updated_at']
    assert cache_env.ttls[_key()] == 60

    st = _status(client)
    assert st['misses'] == 1 and st['hits'] == 0
    assert st['enabled'] is True and st['reachable'] is True

    # 第二次读 → 命中（hits+1、misses 不变）
    r = client.get('/api/confcenter/app/k1', headers=AUTH)
    assert r.json()['data']['data'] == 'v1'
    st = _status(client)
    assert st['hits'] == 1 and st['misses'] == 1


# ─── 路径 1：命中 → 直接返回缓存值 ──────────────────────

def test_hit_returns_cached_value_without_db(client, auth_headers, cache_env):
    _put(client, 'app', 'k1', 'json', '{"real": false}')
    cache_env.store.clear()
    # 篡改缓存：命中路径应原样返回缓存值（不查库）
    cache_env.store[_key()] = json.dumps(
        {'type': 'json', 'data': '{"stale": true}', 'updated_at': '2020-01-01T00:00:00'})

    r = client.get('/api/confcenter/app/k1', headers=AUTH)
    assert r.status_code == 200
    assert r.json()['data']['data'] == {'stale': True}     # json 命中也按解析后返回
    st = _status(client)
    assert st['hits'] == 1 and st['misses'] == 0


def test_hit_corrupt_payload_counts_as_miss(client, auth_headers, cache_env):
    _put(client, 'app', 'k1', 'str', 'v1')
    cache_env.store.clear()
    cache_env.store[_key()] = json.dumps({'no_type_field': 1})   # 损坏载荷
    r = client.get('/api/confcenter/app/k1', headers=AUTH)
    assert r.status_code == 200 and r.json()['data']['data'] == 'v1'
    st = _status(client)
    assert st['misses'] == 1
    assert json.loads(cache_env.store[_key()])['data'] == 'v1'   # 已被正确载荷覆盖


# ─── 路径 3：写/删后失效（先落库再 DEL）────────────────

def test_write_invalidates_cache(client, auth_headers, cache_env):
    _put(client, 'app', 'k1', 'str', 'v1')
    client.get('/api/confcenter/app/k1', headers=AUTH)   # 回填
    assert _key() in cache_env.store

    _put(client, 'app', 'k1', 'str', 'v2', expect=200)   # 覆盖写 → DEL
    assert _key() in cache_env.deleted                      # DEL 被调用
    assert _key() not in cache_env.store

    r = client.get('/api/confcenter/app/k1', headers=AUTH)   # 重建缓存
    assert r.json()['data']['data'] == 'v2'
    assert json.loads(cache_env.store[_key()])['data'] == 'v2'


def test_delete_invalidates_cache(client, auth_headers, cache_env):
    _put(client, 'app', 'k1', 'str', 'v1')
    client.get('/api/confcenter/app/k1', headers=AUTH)
    assert _key() in cache_env.store

    r = client.delete('/api/confcenter/app/k1', headers=AUTH)
    assert r.status_code == 200
    assert _key() in cache_env.deleted and _key() not in cache_env.store
    r = client.get('/api/confcenter/app/k1', headers=AUTH)
    assert r.status_code == 404


# ─── 路径 5：连接抛错 → 静默降级 ────────────────────────

def test_connection_error_degrades_to_db(client, auth_headers, monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(cache_mod, '_build_client', lambda c: fake)
    r = client.put('/api/confcenter/cache/config',
                   json={'enabled': True, 'ttl_seconds': 60}, headers=AUTH)
    assert r.status_code == 200

    _put(client, 'app', 'k1', 'str', 'v1')                # DEL 正常
    client.get('/api/confcenter/app/k1', headers=AUTH)    # 回填正常
    assert _key() in fake.store

    # 连接开始抛错 → 读回退 DB，不计数、不报错
    fake.fail = True
    r = client.get('/api/confcenter/app/k1', headers=AUTH)
    assert r.status_code == 200 and r.json()['data']['data'] == 'v1'
    st = _status(client)                                  # 状态端点不报错
    assert st['enabled'] is False and st['reachable'] is False
    state = cache_mod.get_cache_state(client.app)
    assert state.failed is True

    # failed 标记后读写路径直接跳过缓存（DB 语义完整保持）
    _put(client, 'app', 'k1', 'str', 'v2', expect=200)
    r = client.get('/api/confcenter/app/k1', headers=AUTH)
    assert r.json()['data']['data'] == 'v2'
    # 降级期间不累计 hits/misses
    state = cache_mod.get_cache_state(client.app)
    assert state.hits == 0 and state.misses == 1          # 1 = 抛错前那次未命中回填

    # 探活成功（test 端点）→ 自愈恢复缓存
    fake.fail = False
    r = client.post('/api/confcenter/cache/test', headers=AUTH)
    assert r.status_code == 200 and r.json()['data']['ok'] is True
    assert cache_mod.get_cache_state(client.app).failed is False
    # 故障恢复先清理旧键，再允许缓存命中；不能复活降级前的 v1。
    r = client.get('/api/confcenter/app/k1', headers=AUTH)
    assert r.json()['data']['data'] == 'v2'
    assert cache_mod.get_cache_state(client.app).hits == 0
    r = client.post('/api/confcenter/cache/flush', headers=AUTH)
    assert r.json()['data']['ok'] is True
    r = client.get('/api/confcenter/app/k1', headers=AUTH)
    assert r.json()['data']['data'] == 'v2'               # 清理后重建为新值


def test_degrade_warns_once_per_process(client, auth_headers, monkeypatch, caplog):
    monkeypatch.setattr(cache_mod, '_WARNED', False)
    fake = FakeRedis(fail=True)
    monkeypatch.setattr(cache_mod, '_build_client', lambda c: fake)
    client.put('/api/confcenter/cache/config',
               json={'enabled': True, 'ttl_seconds': 60}, headers=AUTH)

    with caplog.at_level(logging.WARNING, logger='doublog.confcenter'):
        for _ in range(3):
            r = client.put('/api/confcenter/app/k1', json={'type': 'str', 'data': 'v'},
                           headers=AUTH)
            assert r.status_code in (200, 201)             # DB 写不受降级影响
            state = cache_mod.get_cache_state(client.app)
            state.failed = False                           # 强制反复触发连接失败
    warns = [rec for rec in caplog.records if '降级' in rec.getMessage()]
    assert len(warns) == 1                                 # 进程内只 warn 一次


# ─── 库缺失降级（三态之一）─────────────────────────────

def test_library_missing_degrades(client, monkeypatch):
    monkeypatch.setattr(cache_mod, 'REDIS_AVAILABLE', False)
    _put(client, 'app', 'k1', 'str', 'v1')
    r = client.get('/api/confcenter/app/k1', headers=AUTH)
    assert r.status_code == 200 and r.json()['data']['data'] == 'v1'
    st = _status(client)
    assert st['enabled'] is False and st['library_available'] is False
    assert st['hits'] == 0 and st['misses'] == 0


# ─── 缓存管理端点 ───────────────────────────────────────

def test_cache_config_persists_to_file(client, auth_headers, cache_env):
    path = os.path.join(settings.data_dir, 'redis_config.json')
    assert os.path.isfile(path)
    with open(path, encoding='utf-8') as f:
        stored = json.load(f)
    assert stored['enabled'] is True and stored['port'] == 6379 and stored['ttl_seconds'] == 60

    # GET /cache/config 回显
    r = client.get('/api/confcenter/cache/config', headers=AUTH)
    assert r.status_code == 200
    assert r.json()['data'] == {'enabled': True, 'host': '127.0.0.1', 'port': 6379,
                                'db': 0, 'password': '', 'ttl_seconds': 60}

    # 配置变更 → 客户端作废重建（ttl 变化反映在新回填里）
    r = client.put('/api/confcenter/cache/config',
                   json={'ttl_seconds': 120, 'db': 2}, headers=AUTH)
    assert r.status_code == 200
    assert r.json()['data']['ttl_seconds'] == 120 and r.json()['data']['db'] == 2
    _put(client, 'app', 'k9', 'str', 'x')
    client.get('/api/confcenter/app/k9', headers=AUTH)
    assert cache_env.ttls[cache_mod.cache_key('app', 'k9')] == 120


def test_cache_config_invalid_400(client, auth_headers):
    for bad in ({'port': 'abc'}, {'enabled': 'yes'}, {'ttl_seconds': 0},
                {'host': ''}, {'db': -1}):
        r = client.put('/api/confcenter/cache/config', json=bad, headers=AUTH)
        assert r.status_code == 400, bad
    # 坏配置不影响默认未启用状态
    assert _status(client)['enabled'] is False


def test_cache_test_endpoint(client, auth_headers, cache_env):
    r = client.post('/api/confcenter/cache/test', headers=AUTH)
    assert r.status_code == 200
    assert r.json()['data'] == {'ok': True, 'message': '连接成功'}

    # 带请求体配置测试（保存前试连）
    r = client.post('/api/confcenter/cache/test',
                    json={'host': '10.0.0.9', 'port': 1234}, headers=AUTH)
    assert r.json()['data']['ok'] is True          # 假客户端不看参数

    # 连接失败 → ok=False，不抛错
    cache_env.fail = True
    r = client.post('/api/confcenter/cache/test', headers=AUTH)
    assert r.status_code == 200 and r.json()['data']['ok'] is False
    assert '连接失败' in r.json()['data']['message']


def test_cache_test_library_missing(client, auth_headers, monkeypatch):
    monkeypatch.setattr(cache_mod, 'REDIS_AVAILABLE', False)
    r = client.post('/api/confcenter/cache/test', headers=AUTH)
    assert r.json()['data']['ok'] is False and '未安装' in r.json()['data']['message']


def test_cache_flush_prefix_scan_del(client, auth_headers, cache_env):
    _put(client, 'app', 'k1', 'str', 'v1')
    _put(client, 'infra', 'k2', 'str', 'v2')
    client.get('/api/confcenter/app/k1', headers=AUTH)
    client.get('/api/confcenter/infra/k2', headers=AUTH)
    cache_env.store['other:business:key'] = 'x'    # 同 db 其他业务的键

    r = client.post('/api/confcenter/cache/flush', headers=AUTH)
    assert r.status_code == 200
    d = r.json()['data']
    assert d['ok'] is True and d['deleted'] == 2
    assert set(cache_env.store) == {'other:business:key'}   # 只清本模块前缀


def test_cache_flush_failure_returns_ok_false(client, auth_headers, cache_env):
    cache_env.fail = True
    r = client.post('/api/confcenter/cache/flush', headers=AUTH)
    assert r.status_code == 200
    d = r.json()['data']
    assert d['ok'] is False and '清理失败' in d['message'] and d['deleted'] == 0


def test_status_url_masked(client, auth_headers, cache_env):
    r = client.put('/api/confcenter/cache/config',
                   json={'password': 's3cret'}, headers=AUTH)
    assert r.status_code == 200
    st = _status(client)
    assert st['url_masked'] == 'redis://:********@127.0.0.1:6379/0'
    assert 's3cret' not in st['url_masked']
