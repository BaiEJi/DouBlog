"""
配置中心 namespace 维度限流（优先 Redis / lizysdk，可降级本地）

- **生效范围**：单条 KV 路由 GET/PUT/DELETE ``/{namespace}/{key}``（机器消费的
  热路径），按 namespace 计数；浏览（/namespaces /entries）与缓存管理端点不限流
- **Redis 优先**：redis 库可用且缓存配置（``data/redis_config.json``，与缓存层
  共用连接）已启用且可达时，走 ``lizysdk.dist.SlidingWindowCounter``
  （ZSET + Lua 原子滑动窗口，键前缀 ``confcenter_rl``——下划线避免被缓存
  flush 的 ``confcenter:*`` SCAN 误伤）
- **本地降级**：无 Redis（库缺失 / 未启用 / 连接失败）→ 进程内滑动窗口
  （deque + 锁；单进程 uvicorn 部署下语义一致）。Redis 调用抛错时本次即时
  降级本地判定，不阻断请求
- **语义注记**：Redis 路径用 ``allow()``（原子"先计数再判定"，被拒请求同样
  占窗口名额——超限即惩罚）；本地路径用"判定后计数"（被拒不追加，deque
  天然有界；lizysdk 文档对两种取舍均有说明）。两者持续速率一致，仅突发
  洪泛下的恢复节奏不同
- 配置持久化 ``data/ratelimit_config.json``：
  ``{enabled, limit, window_seconds, overrides}``；overrides 按 namespace
  覆盖 ``{limit, window_seconds}``（limit=0 表示该空间豁免不限流）
- 超限 → ``RateLimitError``（429 / RATE_LIMITED），details 带
  namespace/limit/window_seconds/retry_after/mode
- 运行态挂 ``app.state.confcenter_ratelimit``（禁模块级单例，测试多 app 不泄漏）
"""

from __future__ import annotations

import json
import math
import os
import re
import threading
import time
from collections import deque

from app.config import settings
from app.shared.modules import mod_logger
from lizysdk.errors import RateLimitError

logger = mod_logger('confcenter')

try:  # 与缓存层同源的可选依赖标记（真正建连走 cache._usable_client）
    import redis  # noqa: F401
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False

RATELIMIT_CONFIG_FILE = 'ratelimit_config.json'
#: 限流 ZSET 前缀（SlidingWindowCounter 实际键 = 前缀:namespace）
RL_KEY_PREFIX = 'confcenter_rl'

#: 与 routes.NAME_RE 一致的 namespace 白名单（不 import routes 防环）
_NAME_RE = re.compile(r'^[A-Za-z0-9_.:-]+$')

#: 进程级"只 warn 一次"开关（跨 app 共享是刻意的——降级不刷日志）
_WARNED = False


# ─── 配置读写（data/ratelimit_config.json）──────────────

def default_config() -> dict:
    return {'enabled': False, 'limit': 100, 'window_seconds': 60, 'overrides': {}}


def config_path() -> str:
    return os.path.join(settings.data_dir, RATELIMIT_CONFIG_FILE)


def load_config() -> dict:
    """读限流配置；文件缺失/损坏回退默认（enabled=false）。"""
    cfg = default_config()
    try:
        with open(config_path(), encoding='utf-8') as f:
            stored = json.load(f)
    except (OSError, json.JSONDecodeError):
        return cfg
    if isinstance(stored, dict):
        for k in ('enabled', 'limit', 'window_seconds'):
            if stored.get(k) is not None:
                cfg[k] = stored[k]
        if isinstance(stored.get('overrides'), dict):
            cfg['overrides'] = stored['overrides']
    return cfg


def save_config(cfg: dict) -> None:
    os.makedirs(settings.data_dir, exist_ok=True)
    with open(config_path(), 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def _int_field(value, name: str, lo: int, hi: int) -> int:
    """整数字段校验（容忍数字字符串；bool 显式拒绝——bool 是 int 子类）。"""
    if isinstance(value, bool):
        raise ValueError(f'{name} 必须为整数')
    if isinstance(value, int):
        ivalue = value
    else:
        try:
            ivalue = int(str(value).strip())
        except (TypeError, ValueError):
            raise ValueError(f'{name} 必须为整数') from None
    if not lo <= ivalue <= hi:
        raise ValueError(f'{name} 需在 {lo}-{hi} 之间')
    return ivalue


def normalize_config(body, current: dict | None = None) -> dict:
    """校验并归一化限流配置（允许部分字段缺省沿用当前值）；非法抛 ValueError。

    overrides 整体替换（每行 {limit, window_seconds} 需完整）；
    覆盖行 limit=0 表示该 namespace 豁免不限流。
    """
    if not isinstance(body, dict):
        raise ValueError('配置体必须是 JSON 对象')
    cfg = dict(current or load_config())
    if 'overrides' in cfg:
        cfg['overrides'] = dict(cfg['overrides'])

    if 'enabled' in body:
        if not isinstance(body['enabled'], bool):
            raise ValueError('enabled 必须为布尔值')
        cfg['enabled'] = body['enabled']
    if 'limit' in body:
        cfg['limit'] = _int_field(body['limit'], 'limit', 1, 1_000_000)
    if 'window_seconds' in body:
        cfg['window_seconds'] = _int_field(body['window_seconds'], 'window_seconds', 1, 86400)
    if 'overrides' in body:
        raw = body['overrides']
        if not isinstance(raw, dict):
            raise ValueError('overrides 必须是对象')
        overrides = {}
        for ns, row in raw.items():
            if (not isinstance(ns, str) or len(ns) > 100
                    or not _NAME_RE.fullmatch(ns)):
                raise ValueError(f'overrides 键 {ns!r} 不是合法 namespace')
            if not isinstance(row, dict) or 'limit' not in row or 'window_seconds' not in row:
                raise ValueError(f'overrides[{ns}] 需包含 limit 与 window_seconds')
            overrides[ns] = {
                'limit': _int_field(row['limit'], f'overrides[{ns}].limit', 0, 1_000_000),
                'window_seconds': _int_field(row['window_seconds'],
                                             f'overrides[{ns}].window_seconds', 1, 86400),
            }
        cfg['overrides'] = overrides
    return cfg


# ─── 每 app 运行态（挂 app.state.confcenter_ratelimit）──

def _monotonic() -> float:
    """本地窗口时间源（单调钟）；测试用它 monkeypatch 推进窗口。"""
    return time.monotonic()


class RateLimitState:
    """每 app 一份的限流运行态：配置快照 + 本地窗口 + 计数器 + Redis 降级标记。"""

    def __init__(self):
        self.lock = threading.RLock()
        self.config = load_config()
        self.local_windows: dict[str, deque] = {}   # namespace -> 窗口内事件时间戳
        self.allowed = 0
        self.rejected = 0
        self.redis_failed = False   # Redis 限流调用失败 → 后续直接走本地；探活自愈

    def apply_config(self, cfg: dict):
        """配置变更：更新快照并清空本地窗口（新额度立即生效；Redis 窗口由
        TTL 自然过期，可用 reset 端点立即清零）。"""
        with self.lock:
            self.config = cfg
            self.local_windows.clear()


def get_state(app) -> RateLimitState:
    """取/建该 app 的限流运行态（挂 app.state.confcenter_ratelimit）。"""
    state = getattr(app.state, 'confcenter_ratelimit', None)
    if state is None:
        state = RateLimitState()
        app.state.confcenter_ratelimit = state
    return state


# ─── 判定路径 ─────────────────────────────────────────

def _rule_for(state: RateLimitState, namespace: str) -> tuple[int, int]:
    """该 namespace 的 (limit, window)；覆盖行 limit=0 → 豁免。"""
    override = state.config.get('overrides', {}).get(namespace)
    if override is not None:
        return int(override['limit']), int(override['window_seconds'])
    return int(state.config.get('limit') or 0), int(state.config.get('window_seconds') or 60)


def _mark_redis_failed(state: RateLimitState):
    """Redis 限流失败：标记降级（后续走本地）+ 进程内只 warn 一次。"""
    global _WARNED
    state.redis_failed = True
    if not _WARNED:
        _WARNED = True
        logger.warning('Redis 限流不可用，confcenter 降级为本地限流（本进程不再重复告警）')


def _redis_check(state, cache_state, namespace: str, limit: int, window: int) -> bool | None:
    """Redis 滑动窗口判定（lizysdk SlidingWindowCounter，原子 allow）。

    None = Redis 不可用/调用失败（调用方降级本地）；True/False = 判定结果。
    """
    from app.confcenter import cache as cache_mod
    from lizysdk.dist import SlidingWindowCounter

    if state.redis_failed:
        return None
    client = cache_mod._usable_client(cache_state)
    if client is None:
        return None
    counter = SlidingWindowCounter(client, window=window, prefix=RL_KEY_PREFIX)
    try:
        return counter.allow(namespace, limit)
    except Exception:  # noqa: BLE001 - 任何连接异常都降级本地，不阻断请求
        _mark_redis_failed(state)
        return None


def _redis_retry_after(client, namespace: str, window: int) -> int:
    """Redis 路径的重试等待：窥视窗口内最老事件的 score 估算剩余等待。

    键结构与 SlidingWindowCounter 的 {prefix}:{key} 一致（公开构造参数决定，
    非私有内部）；窥探失败退回整窗上限（保守值）。
    """
    try:
        oldest = client.zrange(f'{RL_KEY_PREFIX}:{namespace}', 0, 0, withscores=True)
        if oldest:
            wait = window - (time.time() - oldest[0][1])
            return max(1, math.ceil(wait))
    except Exception:  # noqa: BLE001
        pass
    return max(1, window)


def _local_check(state: RateLimitState, namespace: str, limit: int, window: float) -> tuple[bool, int]:
    """本地滑动窗口：判定后计数（被拒不追加 → deque 天然有界）。

    返回 (allowed, retry_after)；retry_after 基于窗口内最老事件精确计算。
    """
    now = _monotonic()
    with state.lock:
        dq = state.local_windows.get(namespace)
        if dq is None:
            dq = state.local_windows[namespace] = deque()
        cutoff = now - window
        while dq and dq[0] <= cutoff:
            dq.popleft()
        if len(dq) >= limit:
            retry_after = max(1, math.ceil(dq[0] + window - now))
            state.rejected += 1
            return False, retry_after
        dq.append(now)
        state.allowed += 1
        return True, 0


def check(app, namespace: str) -> None:
    """入口判定：未启用/豁免直接放行；超限 raise RateLimitError(429)。

    在 run_db 池内调用（Redis EVAL 是阻塞套接字 IO，不占事件循环）。
    """
    state = get_state(app)
    if not state.config.get('enabled'):
        return
    limit, window = _rule_for(state, namespace)
    if limit <= 0:      # 覆盖行豁免
        return

    from app.confcenter import cache as cache_mod
    cache_state = cache_mod.get_cache_state(app)
    verdict = _redis_check(state, cache_state, namespace, limit, window)
    if verdict is not None:
        mode = 'redis'
        ok = verdict
        retry_after = 0 if ok else _redis_retry_after(cache_state.client, namespace, window)
        with state.lock:
            if ok:
                state.allowed += 1
            else:
                state.rejected += 1
    else:
        mode = 'local'
        ok, retry_after = _local_check(state, namespace, limit, window)

    if not ok:
        raise RateLimitError(
            message=f'namespace {namespace} 请求过于频繁（限 {limit} 次 / {window}s）',
            details={'namespace': namespace, 'limit': limit,
                     'window_seconds': window, 'retry_after': retry_after, 'mode': mode})


# ─── 管理端（status / reset）────────────────────────────

def _redis_tracked(cache_state) -> dict[str, int] | None:
    """Redis 模式下各 namespace 的当前窗口计数（SCAN confcenter_rl:* + ZCARD）。"""
    from app.confcenter import cache as cache_mod
    client = cache_mod._probe_client(cache_state)
    tracked = {}
    prefix_len = len(RL_KEY_PREFIX) + 1
    for key in client.scan_iter(match=f'{RL_KEY_PREFIX}:*'):
        tracked[key[prefix_len:]] = int(client.zcard(key))
    return tracked


def status(app) -> dict:
    """限流状态：{enabled, mode, limit, window_seconds, overrides_count,
    allowed, rejected, tracked, redis}。mode = off | local | redis（探活口径）。"""
    from app.confcenter import cache as cache_mod

    state = get_state(app)
    cfg = state.config
    cache_state = cache_mod.get_cache_state(app)
    configured = cache_mod.REDIS_AVAILABLE and bool(cache_state.config.get('enabled'))

    mode, reachable = 'off', False
    tracked: dict[str, int] | None = None
    if cfg.get('enabled'):
        if configured:
            try:
                cache_mod._probe_client(cache_state).ping()
                reachable = True
                state.redis_failed = False      # 探活成功 → 自愈
                mode = 'redis'
                tracked = _redis_tracked(cache_state)
            except Exception:  # noqa: BLE001
                _mark_redis_failed(state)
                mode = 'local'
        else:
            mode = 'local'
    if mode == 'local':
        with state.lock:
            tracked = {ns: len(dq) for ns, dq in state.local_windows.items()}

    return {
        'enabled': bool(cfg.get('enabled')),
        'mode': mode,
        'limit': cfg.get('limit'),
        'window_seconds': cfg.get('window_seconds'),
        'overrides': dict(cfg.get('overrides') or {}),
        'allowed': state.allowed,
        'rejected': state.rejected,
        'tracked': tracked,
        'redis': {'library_available': cache_mod.REDIS_AVAILABLE,
                  'configured': configured, 'reachable': reachable},
    }


def reset(app, namespace: str) -> dict:
    """清零某 namespace 的限流窗口（本地 deque + Redis ZSET 双路径都尝试）。"""
    from app.confcenter import cache as cache_mod
    from lizysdk.dist import SlidingWindowCounter

    state = get_state(app)
    cleared_local = False
    with state.lock:
        cleared_local = state.local_windows.pop(namespace, None) is not None
    cleared_redis = False
    if cache_mod.REDIS_AVAILABLE and cache_mod.get_cache_state(app).config.get('enabled'):
        try:
            client = cache_mod._probe_client(cache_mod.get_cache_state(app))
            SlidingWindowCounter(client, prefix=RL_KEY_PREFIX).reset(namespace)
            cleared_redis = True
        except Exception:  # noqa: BLE001
            _mark_redis_failed(state)
    return {'namespace': namespace, 'local_cleared': cleared_local,
            'redis_cleared': cleared_redis}
