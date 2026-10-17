"""博客/知识库能力（含资产库子域：app/blog/assets/，路由前缀 /api/assets）。"""
from fastapi import APIRouter

from .routes.posts import router as posts_router
from .routes.images import router as images_router
from .routes.workspaces import router as workspaces_router
from .routes.export import router as export_router
from .assets import router as assets_router
from .assets import ensure_migrations as _assets_migrations
from .services.migrations import ensure_migrations as _kb_migrations

router = APIRouter()
router.include_router(posts_router)
router.include_router(images_router)
router.include_router(workspaces_router)
router.include_router(export_router)
router.include_router(assets_router)


def ensure_migrations(engine):
    """知识库 + 资产库两级幂等迁移（骨架 init_db 在建表/改名后调用）。"""
    _kb_migrations(engine)
    _assets_migrations(engine)


__all__ = ['router', 'ensure_migrations']
