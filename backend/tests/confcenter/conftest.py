"""confcenter 测试共享件：假 Redis 客户端（内存 dict）+ 一键启用缓存的夹具。

FakeRedis 除 KV（get/setex/delete/ping/scan_iter）外，还实现 lizysdk
SlidingWindowCounter 依赖的 EVAL/ZRANGE/ZCARD：按脚本内容识别 lizysdk 的
两段 Lua（incr / count）并以内存 ZSET 语义等价执行（TTL 忽略——测试不等待）。
"""
import base64

import pytest

AUTH = {'Authorization': 'Basic ' + base64.b64encode(b"admin:lizy111A").decode()}


class FakeRedis:
    """内存版 Redis 客户端：记录 DEL/SETEX 调用，可模拟连接故障。

    eval_fail=True 时仅 EVAL 抛错（其余命令正常）——模拟限流降级而缓存可用。
    """

    def __init__(self, fail=False, eval_fail=False):
        self.store = {}
        self.ttls = {}
        self.deleted = []
        self.set_calls = []
        self.zsets = {}          # key -> {member: score}
        self.fail = fail
        self.eval_fail = eval_fail

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
            if k in self.zsets:
                del self.zsets[k]
                n += 1
        return n

    def ping(self):
        self._check()
        return True

    def scan_iter(self, match=None):
        self._check()
        keys = list(self.store) + list(self.zsets)
        if match is None:
            return iter(keys)
        import fnmatch
        return iter([k for k in keys if fnmatch.fnmatch(k, match)])

    # ─── ZSET（lizysdk SlidingWindowCounter 所需）──────────

    def zcard(self, key):
        self._check()
        return len(self.zsets.get(key, {}))

    def zrange(self, key, start, stop, withscores=False):
        self._check()
        items = sorted(self.zsets.get(key, {}).items(), key=lambda kv: kv[1])
        n = len(items)

        def norm(i):
            if i < 0:
                i += n
            return max(0, min(n - 1, i)) if n else 0

        sel = items[norm(start):norm(stop) + 1] if n else []
        return [(m, s) for m, s in sel] if withscores else [m for m, _ in sel]

    def eval(self, script, numkeys, *args):
        self._check()
        if self.eval_fail:
            raise ConnectionError('fake redis eval down')
        key = args[0]
        argv = args[1:]
        zset = self.zsets.setdefault(key, {})
        if 'ZADD' in script:      # lizysdk _INCR_LUA：ZADD×amount → 清窗 → ZCARD
            now, member, cutoff, amount = float(argv[0]), argv[1], float(argv[2]), int(argv[4])
            for i in range(1, amount + 1):
                zset[member if amount == 1 else f'{member}:{i}'] = now
            for m in [m for m, s in zset.items() if s <= cutoff]:
                del zset[m]
        else:                      # lizysdk _COUNT_LUA：清窗 → ZCARD
            cutoff = float(argv[0])
            for m in [m for m, s in zset.items() if s <= cutoff]:
                del zset[m]
        return len(zset)


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
