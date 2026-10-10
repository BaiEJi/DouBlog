"""confcenter 测试共享件：假 Redis 客户端（内存 dict）+ 一键启用缓存的夹具。"""
import json

import pytest

AUTH = {'Authorization': 'Basic ' + __import__('base64').b64encode(b"admin:lizy111A").decode()}


class FakeRedis:
    """内存版 Redis 客户端：记录 DEL/SETEX 调用，可模拟连接故障。"""

    def __init__(self, fail=False):
        self.store = {}
        self.ttls = {}
        self.deleted = []
        self.set_calls = []
        self.fail = fail

    def _check(self):
        if self.fail:
            raise ConnectionError('fake redis down')

    def get(self, key):
        self._check()
        return self.store.get(key)

    def setex(self, key, ttl, value):
        self._check()
        self.store[key] = value
        self.ttls[key] = ttl
        self.set_calls.append((key, ttl, value))

    def delete(self, *keys):
        self._check()
        n = 0
        for k in keys:
            self.deleted.append(k)
            if k in self.store:
                del self.store[k]
                n += 1
        return n

    def ping(self):
        self._check()
        return True

    def scan_iter(self, match=None):
        self._check()
        if match is None:
            return iter(list(self.store))
        import fnmatch
        return iter([k for k in self.store if fnmatch.fnmatch(k, match)])

    def flushdb(self):
        self._check()
        n = len(self.store)
        self.store.clear()
        return n


@pytest.fixture
def fake_redis():
    return FakeRedis()


@pytest.fixture
def cache_env(client, auth_headers, fake_redis, monkeypatch):
    """启用缓存（enabled=true + 假客户端注入 _build_client），返回假客户端。

    PUT /cache/config 走真实端点（落盘 tmp data/redis_config.json + 应用配置）。
    """
    from app.confcenter import cache as cache_mod
    monkeypatch.setattr(cache_mod, '_build_client', lambda c: fake_redis)
    body = {'enabled': True, 'host': '127.0.0.1', 'port': 6379, 'db': 0,
            'password': '', 'ttl_seconds': 60}
    r = client.put('/api/confcenter/cache/config', json=body, headers=auth_headers)
    assert r.status_code == 200, r.json()
    return fake_redis


def cached_payload(namespace, key, data, type_='str', updated_at='2020-01-01T00:00:00'):
    """构造一份可直接塞进假 Redis 的缓存载荷（与 cache_put 写入的形状一致）。"""
    return json.dumps({'type': type_, 'data': data, 'updated_at': updated_at},
                      ensure_ascii=False)
