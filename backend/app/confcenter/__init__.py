"""配置中心：独立 namespace、KV 存储与可选 Redis 读缓存。"""
from .routes import router
from .migrations import ensure_migrations

__all__ = ['router', 'ensure_migrations']


def stop_background(app, timeout=5.0):
    state = getattr(app.state, 'confcenter_cache', None)
    if state:
        with state.lock:
            state.generation += 1
            state.failed = True
            if state.client and hasattr(state.client, 'close'):
                state.client.close()
            app.state.confcenter_cache = None
    app.state.confcenter_ratelimit = None
    return True
