"""API Hub 出站代理（全局可选，系统配置页 /config 读写）。

部分上游（如 QQ 开放平台 bots.qq.com）本机直连不通，需要经本机正向代理
（Clash 等）转发。配置持久化 data/apihub_proxy.json，连接池每次建连时读取
（含缓存，写路径 save 后立即生效；仅 https 目标走 CONNECT 隧道，
http 目标与 localhost 永不代理，本机自注册流量不受影响）。
"""
import json
import os
import threading

from app.config import settings

_LOCK = threading.Lock()
_CACHE: dict = {'cfg': None}

DEFAULTS = {'enabled': False, 'host': '127.0.0.1', 'port': 7890}

_LOCAL_HOSTS = {'localhost', '127.0.0.1', '::1'}


def _path() -> str:
    from app.db import current_runtime
    return os.path.join(current_runtime().data_dir, 'apihub_proxy.json')


def load_proxy_config() -> dict:
    """读配置：文件 > 默认值（进程内缓存，save 后刷新）。"""
    with _LOCK:
        path = _path()
        stat = os.stat(path) if os.path.exists(path) else None
        signature = (stat.st_mtime_ns, stat.st_size, stat.st_ino) if stat else None
        cached = _CACHE.get(path)
        if cached is not None and cached[0] == signature:
            return dict(cached[1])
        cfg = dict(DEFAULTS)
        try:
            with open(_path(), encoding='utf-8') as f:
                stored = json.load(f)
            if isinstance(stored, dict):
                if isinstance(stored.get('enabled'), bool):
                    cfg['enabled'] = stored['enabled']
                if isinstance(stored.get('host'), str) and stored['host'].strip():
                    cfg['host'] = stored['host'].strip()
                if isinstance(stored.get('port'), int) and 1 <= stored['port'] <= 65535:
                    cfg['port'] = stored['port']
        except (OSError, ValueError):
            pass
        if len(_CACHE) >= 16:
            _CACHE.clear()
        _CACHE[path] = (signature, dict(cfg))
        return cfg


def save_proxy_config(cfg: dict) -> dict:
    """写配置并刷新缓存（normalize：host 必填、port 1-65535）。"""
    normalized = {
        'enabled': bool(cfg.get('enabled')),
        'host': str(cfg.get('host') or DEFAULTS['host']).strip() or DEFAULTS['host'],
        'port': cfg.get('port') if isinstance(cfg.get('port'), int)
        and 1 <= cfg.get('port') <= 65535 else DEFAULTS['port'],
    }
    with _LOCK:
        from app.shared.files import atomic_write_json
        path = _path()
        atomic_write_json(path, normalized)
        stat = os.stat(path)
        _CACHE[path] = ((stat.st_mtime_ns, stat.st_size, stat.st_ino), dict(normalized))
    return normalized


def resolve_proxy(scheme: str, hostname: str | None):
    """(proxy_host, proxy_port)；None = 直连。仅 https 走代理；localhost 永不代理。"""
    cfg = load_proxy_config()
    if not cfg['enabled'] or scheme != 'https':
        return None
    if (hostname or '').lower() in _LOCAL_HOSTS:
        return None
    return cfg['host'], cfg['port']
