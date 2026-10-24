"""博客/知识库能力（含子域：app/blog/assets/（/api/assets）、
app/blog/diary/（/api/diary）、app/blog/bookmarks/（/api/bookmarks））。"""
from fastapi import APIRouter

from .routes.posts import router as posts_router
from .routes.images import router as images_router
from .routes.workspaces import router as workspaces_router
from .routes.export import router as export_router
from .assets import router as assets_router
from .assets import ensure_migrations as _assets_migrations
from .diary import router as diary_router
from .diary import ensure_migrations as _diary_migrations
from .bookmarks import router as bookmarks_router
from .bookmarks import ensure_migrations as _bookmarks_migrations
from .services.migrations import ensure_migrations as _kb_migrations
from .services import links as _links  # noqa: F401 注册正文投影监听

router = APIRouter()
router.include_router(posts_router)
router.include_router(images_router)
router.include_router(workspaces_router)
router.include_router(export_router)
router.include_router(assets_router)
router.include_router(diary_router)
router.include_router(bookmarks_router)


def ensure_migrations(engine):
    """知识库及资产、日记、书签子域幂等迁移，均在建表/改名后调用。"""
    _kb_migrations(engine)
    _assets_migrations(engine)
    _diary_migrations(engine)
    _bookmarks_migrations(engine)


__all__ = ['router', 'ensure_migrations']
