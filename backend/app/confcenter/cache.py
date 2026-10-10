"""
配置中心 Redis 缓存层（核心设计：可选、可降级）

- 配置持久化 ``data/redis_config.json``（默认 enabled=false）
- 读路径：先查缓存（键 ``confcenter:{ns}:{key}``，值为整个 {type,data,updated_at}
  JSON，带 TTL 默认 3600）→ 命中直接返回并 hits+1；未命中介 DB、回填（misses+1）
- 写/删路径：先落库再 DEL 对应键（下次读重建；不做双写，避免一致性窗口）
- 降级三态：redis 库缺失 / 配置未启用 / 连接失败 → 静默直连 DB
  （连接异常只 warn 一次/进程，不刷日志、不抛错；hits/misses 仅在缓存生效时累计）
- 运行态（客户端 + 计数器 + 配置快照）挂 ``app.state.confcenter_cache``，
  每 app 一份（禁模块级单例——测试多 app 不泄漏）
- 惰性连接：首次用到才建客户端；配置变更后重建；
  连接失败标记 failed 后读/写路径跳过缓存，status/test/flush 探活成功自愈
"""

from __future__ import annotations

import json
import os
import threading

from app.config import settings
from app.shared.modules import mod_logger

try:  # 可选依赖：缺库时整体降级为直连 DB（测试可用 monkeypatch sys.modules 模拟）
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False

logger = mod_logger('confcenter')

REDIS_CONFIG_FILE = 'redis_config.json'
KEY_PREFIX = 'confcenter'
DEFAULT_TTL = 3600

#: 进程级"只 warn 一次"开关（跨 app 共享是刻意的——降级不刷日志）
_WARNED = False


# ─── 配置读写（data/redis_config.json）──────────────────

def default_config() -> dict:
    return {'enabled': False, 'host': '127.0.0.1', 'port': 6379, 'db': 0,
            'password': '', 'ttl_seconds': DEFAULT_TTL}


def redis_config_path() -> str:
    return os.path.join(settings.data_dir, REDIS_CONFIG_FILE)


def load_redis_config() -> dict:
    """读缓存配置；文件缺失/损坏回退默认（enabled=false）。"""
    cfg = default_config()
    try:
        with open(redis_config_path(), encoding='utf-8') as f:
            stored = json.load(f)
    except (OSError, json.JSONDecodeError):
        return cfg
    if isinstance(stored, dict):
        for k in cfg:
            if stored.get(k) is not None:
                cfg[k] = stored[k]
    return cfg


def save_redis_config(cfg: dict) -> None:
    os.makedirs(settings.data_dir, exist_ok=True)
    with open(redis_config_path(), 'w', encoding='utf-8') as f:
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
    """校验并归一化配置体（允许部分字段缺省，沿用当前值）；非法抛 ValueError。"""
    if not isinstance(body, dict):
        raise ValueError('配置体必须是 JSON 对象')
    cfg = dict(current or load_redis_config())

    if 'enabled' in body:
        if not isinstance(body['enabled'], bool):
            raise ValueError('enabled 必须为布尔值')
        cfg['enabled'] = body['enabled']
    if 'host' in body:
        host = body['host']
        if not isinstance(host, str) or not host.strip() or len(host.strip()) > 200:
            raise ValueError('host 必须为非空字符串')
        cfg['host'] = host.strip()
    if 'port' in body:
        cfg['port'] = _int_field(body['port'], 'port', 1, 65535)
    if 'db' in body:
        cfg['db'] = _int_field(body['db'], 'db', 0, 1 << 30)
    if 'password' in body:
        pwd = body['password']
        if pwd is None:
            pwd = ''
        if not isinstance(pwd, str):
            raise ValueError('password 必须为字符串')
        cfg['password'] = pwd
    if 'ttl_seconds' in body:
        cfg['ttl_seconds'] = _int_field(body['ttl_seconds'], 'ttl_seconds', 1, 30 * 86400)
    return cfg


# ─── 每 app 运行态（挂 app.state.confcenter_cache）────────

class CacheState:
    """每 app 一份的缓存运行态：惰性客户端 + 失败标记 + 计数器 + 配置快照。"""

    def __init__(self):
        self.lock = threading.RLock()
        self.client = None       # 惰性建立的 Redis 客户端（配置变更后置空重建）
        self.failed = False      # 连接失败标记：读/写路径跳过缓存直连 DB
        self.hits = 0
        self.misses = 0
        self.config = load_redis_config()

    def hit(self):
        with self.lock:
            self.hits += 1

    def miss(self):
        with self.lock:
            self.misses += 1

    def apply_config(self, cfg: dict):
        """配置变更：更新快照并作废客户端（下次用到才重建——惰性连接）。"""
        with self.lock:
            self.config = cfg
            self.client = None
            self.failed = False


def get_cache_state(app) -> CacheState:
    """取/建该 app 的缓存运行态（挂 app.state.confcenter_cache；禁模块级单例）。"""
    state = getattr(app.state, 'confcenter_cache', None)
    if state is None:
        state = CacheState()
        app.state.confcenter_cache = state
    return state


# ─── 客户端（惰性连接 + 降级三态）────────────────────────

def cache_key(namespace: str, key: str) -> str:
    return f'{KEY_PREFIX}:{namespace}:{key}'


def _build_client(cfg: dict):
    """按配置构造客户端（不立即建连——redis-py 首条命令才连接；
    测试 monkeypatch 此入口注入假客户端）。"""
    return redis.Redis(
        host=cfg['host'], port=int(cfg['port']), db=int(cfg['db']),
        password=str(cfg.get('password') or '') or None,
        socket_connect_timeout=2, socket_timeout=2,
        decode_responses=True,
    )


def _mark_failed(state: CacheState):
    """连接失败：标记降级（后续读写跳过缓存）+ 进程内只 warn 一次。"""
    global _WARNED
    state.failed = True
    if not _WARNED:
        _WARNED = True
        logger.warning('Redis 缓存不可用，confcenter 降级直连数据库（本进程不再重复告警）')


def _usable_client(state: CacheState):
    """读/写路径用：库在、已启用、未失败且客户端就绪才返回；否则 None（静默直连 DB）。"""
    if not REDIS_AVAILABLE or not state.config.get('enabled') or state.failed:
        return None
    with state.lock:
        if state.client is None:
            try:
                state.client = _build_client(state.config)
            except Exception:
                _mark_failed(state)
                return None
        return state.client


def _probe_client(state: CacheState):
    """管理动作（status/test/flush）用：无视 failed 标记强制取/建客户端。"""
    with state.lock:
        if state.client is None:
            state.client = _build_client(state.config)
        return state.client


# ─── 读/写路径原语 ─────────────────────────────────────

def cache_get(state: CacheState, namespace: str, key: str) -> dict | None:
    """读缓存：返回 {type, data, updated_at} 载荷。

    None = 未命中或缓存不生效；未命中（含载荷损坏）计 misses+1 并回库回填，
    缓存不生效（未启用/库缺失/连接失败）不计数。
    """
    client = _usable_client(state)
    if client is None:
        return None
    try:
        raw = client.get(cache_key(namespace, key))
    except Exception:  # noqa: BLE001 - 任何连接异常都降级，不抛给调用方
        _mark_failed(state)
        return None
    if raw is None:
        state.miss()
        return None
    try:
        payload = json.loads(raw)
        if not isinstance(payload, dict) or 'type' not in payload or 'data' not in payload:
            raise ValueError('缓存载荷结构损坏')
    except (ValueError, TypeError):
        state.miss()   # 损坏视同未命中（读库后回填覆盖）
        return None
    state.hit()
    return payload


def cache_put(state: CacheState, namespace: str, key: str, payload: dict) -> None:
    """回填（setex 带 TTL，防漏删的陈旧）；缓存不生效/失败时静默跳过。"""
    client = _usable_client(state)
    if client is None:
        return
    ttl = max(1, int(state.config.get('ttl_seconds') or DEFAULT_TTL))
    try:
        client.setex(cache_key(namespace, key), ttl,
                     json.dumps(payload, ensure_ascii=False))
    except Exception:  # noqa: BLE001
        _mark_failed(state)


def cache_invalidate(state: CacheState, namespace: str, key: str) -> None:
    """写/删后失效：先落库再 DEL（不做双写，避免一致性窗口）。"""
    client = _usable_client(state)
    if client is None:
        return
    try:
        client.delete(cache_key(namespace, key))
    except Exception:  # noqa: BLE001
        _mark_failed(state)


# ─── 管理端（status / test / flush）─────────────────────

def _masked_url(cfg: dict) -> str:
    auth = f":{'*' * 8}@" if cfg.get('password') else ''
    return f"redis://{auth}{cfg.get('host')}:{cfg.get('port')}/{cfg.get('db')}"


def cache_status(state: CacheState) -> dict:
    """缓存状态：{enabled, reachable, url_masked, hits, misses}。

    enabled 反映**生效状态**（已配置启用且探活可达）；不可达时 enabled=false 不报错。
    """
    cfg = state.config
    configured = REDIS_AVAILABLE and bool(cfg.get('enabled'))
    reachable = False
    if configured:
        try:
            _probe_client(state).ping()
            reachable = True
            state.failed = False          # 探活成功 → 故障自愈
        except Exception:  # noqa: BLE001
            pass
    return {
        'enabled': configured and reachable,
        'configured': configured,
        'reachable': reachable,
        'library_available': REDIS_AVAILABLE,
        'url_masked': _masked_url(cfg),
        'ttl_seconds': cfg.get('ttl_seconds', DEFAULT_TTL),
        'hits': state.hits,
        'misses': state.misses,
    }


def test_connection(cfg: dict) -> tuple[bool, str]:
    """用给定配置即时建连 PING（临时客户端，不影响运行态）。"""
    if not REDIS_AVAILABLE:
        return False, 'redis 库未安装'
    try:
        _build_client(cfg).ping()
        return True, '连接成功'
    except Exception as e:  # noqa: BLE001
        return False, f'连接失败: {e}'


def cache_flush(state: CacheState) -> tuple[bool, str, int]:
    """按前缀 SCAN+DEL 清理本模块缓存键（比 FLUSHDB 更收敛：不误伤同 db 其他业务键）。"""
    if not REDIS_AVAILABLE:
        return False, 'redis 库未安装', 0
    try:
        client = _probe_client(state)
        keys = list(client.scan_iter(match=f'{KEY_PREFIX}:*'))
        deleted = int(client.delete(*keys)) if keys else 0
        state.failed = False              # 清理成功即连通 → 自愈
        return True, f'已清理 {deleted} 个缓存键', deleted
    except Exception as e:  # noqa: BLE001
        _mark_failed(state)
        return False, f'清理失败: {e}', 0
