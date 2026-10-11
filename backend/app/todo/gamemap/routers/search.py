"""搜索路由:中文关键词包含搜索(源 routers/search.py 照搬)。"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.response import api_response

from ..models import Character, Chapter, ChapterCharacter, ChapterRelation, Board, Game, StoryEvent
from ..schemas import SearchHit
from ._base import _dump, _guard

router = APIRouter(prefix="/api/todo/gamemap/search", tags=["gamemap-search"],
                   dependencies=[Depends(require_basic)])


def snippet(text: str, q: str, width: int = 50) -> str:
    pos = text.find(q)
    if pos < 0:
        return text[:width]
    start = max(0, pos - width // 2)
    return ("…" if start > 0 else "") + text[start:start + width] + ("…" if start + width < len(text) else "")


@router.get("")
async def search(q: str = Query(min_length=1), scope: str = "all",
                 game_id: int | None = None, chapter_id: int | None = None):
    """中文关键词包含搜索，不依赖数据库特有全文检索。scope: all / game / chapter"""
    def _impl():
        session = db.session
        hits: list[SearchHit] = []

        games = []
        if scope == "all":
            games = session.scalars(select(Game).where(or_(Game.name.contains(q), Game.description.contains(q)))).all()
            hits += [SearchHit(game_id=g.id, chapter_id=None, kind="game", title=g.name,
                               snippet=snippet(g.description, q), ref_id=g.id) for g in games]

        # 章节
        stmt = select(Chapter).where(or_(Chapter.title.contains(q), Chapter.summary.contains(q),
                                         Chapter.notes.contains(q)))
        if game_id:
            stmt = stmt.where(Chapter.game_id == game_id)
        if chapter_id:
            stmt = stmt.where(Chapter.id == chapter_id)
        for c in session.scalars(stmt).all():
            hits.append(SearchHit(game_id=c.game_id, chapter_id=c.id, kind="chapter", title=c.title,
                                  snippet=snippet(c.summary or c.notes, q), ref_id=c.id))

        # 人物（含章节称呼与备注）
        stmt = select(ChapterCharacter, Character).join(Character, ChapterCharacter.character_id == Character.id)
        if game_id:
            stmt = stmt.where(Character.game_id == game_id)
        if chapter_id:
            stmt = stmt.where(ChapterCharacter.chapter_id == chapter_id)
        seen = set()
        for state, ch in session.execute(stmt).all():
            if q in ch.name or (state.alias and q in state.alias) or q in state.notes:
                if ch.id not in seen:
                    seen.add(ch.id)
                    hits.append(SearchHit(game_id=ch.game_id, chapter_id=state.chapter_id, kind="character",
                                          title=state.alias or ch.name,
                                          snippet=snippet(state.notes or ch.description, q), ref_id=ch.id))

        # 关系说明
        stmt = select(ChapterRelation).where(ChapterRelation.description.contains(q))
        if chapter_id:
            stmt = stmt.join(Board).where(Board.chapter_id == chapter_id)
        for r in session.scalars(stmt).all():
            board = session.get(Board, r.board_id)
            hits.append(SearchHit(game_id=0, chapter_id=board.chapter_id if board else None,
                                  kind="relation", title="", snippet=snippet(r.description, q), ref_id=r.id))

        # 剧情事件
        stmt = select(StoryEvent).where(or_(StoryEvent.title.contains(q), StoryEvent.content.contains(q)))
        if chapter_id:
            stmt = stmt.where(StoryEvent.chapter_id == chapter_id)
        for e in session.scalars(stmt).all():
            ch = session.get(Chapter, e.chapter_id)
            hits.append(SearchHit(game_id=ch.game_id if ch else 0, chapter_id=e.chapter_id,
                                  kind="event", title=e.title, snippet=snippet(e.content, q), ref_id=e.id))

        return api_response(_dump(hits[:100]))
    return await run_db(_guard(_impl))
