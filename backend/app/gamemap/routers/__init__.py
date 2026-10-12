"""gamemap 9 组路由(源 routers/ 结构照搬;统一前缀 /api/gamemap,全挂 require_basic)。

games/chapters/characters/boards/events/photos/relation_types/search/uploads+files。
"""
from fastapi import APIRouter

from . import (  # noqa: F401
    boards,
    chapters,
    characters,
    events,
    games,
    photos,
    relation_types,
    search,
    uploads,
)

gamemap_router = APIRouter()
for _r in (games.router, chapters.router, characters.router, relation_types.router,
           boards.router, events.router, photos.router, search.router, uploads.router):
    gamemap_router.include_router(_r)
