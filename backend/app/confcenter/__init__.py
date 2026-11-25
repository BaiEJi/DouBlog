"""配置中心：独立 namespace、KV 存储与可选 Redis 读缓存。"""
from fastapi import APIRouter

from .mcp_admin import router as mcp_admin_router
from .mcp_transport import router as mcp_transport_router
from .routes import router as kv_router
from .migrations import ensure_migrations

__all__ = ['router', 'ensure_migrations']

router = APIRouter()
router.include_router(mcp_admin_router)
router.include_router(mcp_transport_router)
router.include_router(kv_router)


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
