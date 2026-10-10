"""模块级并发池注册表（lizysdk.pools 统一创建）。

每个模块的并发执行一律走这里（create_pool("thread", name="doublog-<module>")，
缓存复用）；禁止模块自行 `ThreadPoolExecutor`。结构性单写者/调度线程
（sdklogs 写者、各 daemon 调度器）保留 threading，执行体经本注册表取池。
"""

from lizysdk.pools import create_pool

_pools = {}

#: 请求 DB 执行共享池（run_db 使用）
DB_POOL = create_pool('thread', name='doublog-db', workers=16)


def get_pool(module: str, workers: int | None = None):
    """取模块命名池（首次创建后缓存；进程退出时统一 shutdown）"""
    if module not in _pools:
        _pools[module] = create_pool(
            'thread', name=f'doublog-{module}', workers=workers)
    return _pools[module]


def shutdown_pools():
    """应用关闭时统一回收（幂等）"""
    DB_POOL.shutdown(wait=False)
    for p in _pools.values():
        p.shutdown(wait=False)
    _pools.clear()
