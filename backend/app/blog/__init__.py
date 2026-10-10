"""博客/知识库能力。"""
from fastapi import APIRouter

from .routes.posts import router as posts_router
from .routes.images import router as images_router
from .routes.workspaces import router as workspaces_router
from .routes.export import router as export_router
from .services.migrations import ensure_migrations

router = APIRouter()
router.include_router(posts_router)
router.include_router(images_router)
router.include_router(workspaces_router)
router.include_router(export_router)

__all__ = ['router', 'ensure_migrations']
