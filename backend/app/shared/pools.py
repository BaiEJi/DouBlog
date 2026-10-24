"""模块级并发池注册表（lizysdk.pools 统一创建）。

每个模块的并发执行一律走这里（create_pool("thread", name="doublog-<module>")，
缓存复用）；禁止模块自行 `ThreadPoolExecutor`。结构性单写者/调度线程
（sdklogs 写者、各 daemon 调度器）保留 threading，执行体经本注册表取池。
"""

import atexit
import asyncio
import contextvars
import threading

from fastapi import HTTPException
from lizysdk.pools import create_pool
from lizysdk.pools.exceptions import PoolRejectedError

_pools = {}
_lock = threading.RLock()
_closed = False

#: 请求 DB 执行共享池（run_db 使用）
DB_POOL = create_pool('thread', name='doublog-db', workers=16,
                      queue_size=512, reject_policy='raise')


def get_pool(module: str, workers: int | None = None):
    """取模块命名池（首次创建后缓存；进程退出时统一 shutdown）"""
    with _lock:
        if _closed:
            raise RuntimeError('DouBlog pools have shut down')
        if module not in _pools:
            _pools[module] = create_pool(
                'thread', name=f'doublog-{module}', workers=workers,
                queue_size=max(64, (workers or 16) * 8), reject_policy='raise')
        return _pools[module]


async def run_blocking(module, fn, *args, workers=None, **kwargs):
    """Run blocking work with bounded admission and copied request context.

    Cancellation removes queued work. Running thread work owns its cleanup and is
    allowed to finish; cancelling an await never pretends to kill that thread.
    """
    context = contextvars.copy_context()
    from app.db import runtime_binding
    runtime, write = runtime_binding()
    # Authentication verifies stored hashes; a POST login or Basic dependency
    # must remain usable on the established recovery routes during write pause.
    write = write and module != 'auth'
    tracked = runtime is not None and module != 'lifecycle'
    # Switch must not wait for itself, while shutdown must wait for a switch
    # which continues in its SDK worker after the HTTP await was cancelled.
    control = module == 'system-config'
    if tracked:
        runtime.admit(write=write, control=control)
    try:
        future = get_pool(module, workers).submit(context.run, fn, *args, **kwargs)
    except BaseException as exc:
        if tracked:
            runtime.release(write=write, control=control)
        if isinstance(exc, PoolRejectedError):
            raise HTTPException(503, '工作队列繁忙，请稍后重试') from exc
        raise
    if tracked:
        future.add_done_callback(lambda completed: runtime.release(write=write, control=control))
    return await asyncio.wrap_future(future)


def pool_stats():
    with _lock:
        return {'db': DB_POOL.stats(), **{key: p.stats() for key, p in _pools.items()}}


def shutdown_pools():
    """Process lifetime cleanup; one app must not close another app's pools."""
    global _closed
    with _lock:
        if _closed:
            return
        _closed = True
        pools = [DB_POOL, *_pools.values()]
        _pools.clear()
    for pool in pools:
        pool.shutdown(wait=False)


atexit.register(shutdown_pools)
