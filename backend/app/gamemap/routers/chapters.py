"""章节路由:CRUD + 建章自动建板 + 复制上一章看板(源 routers/chapters.py 照搬)。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.response import api_response

from .. import cache as response_cache
from ..models import (
    Board,
    BoardNode,
    Chapter,
    ChapterCharacter,
    ChapterRelation,
    Game,
)
from ..schemas import ChapterCreate, ChapterOut, ChapterUpdate
from ._base import _dump, _guard

router = APIRouter(prefix="/api/gamemap/games/{game_id}/chapters", tags=["gamemap-chapters"],
                   dependencies=[Depends(require_basic)])


def get_game_or_404(db: Session, game_id: int) -> Game:
    game = db.get(Game, game_id)
    if not game:
        raise HTTPException(404, "游戏不存在")
    return game


@router.get("")
async def list_chapters(game_id: int):
    def _impl():
        session = db.session
        get_game_or_404(session, game_id)
        return api_response(_dump([ChapterOut.model_validate(c) for c in session.scalars(
            select(Chapter).where(Chapter.game_id == game_id).order_by(Chapter.order_index)
        ).all()]))
    return await run_db(_guard(_impl))


@router.post("")
async def create_chapter(game_id: int, data: ChapterCreate):
    def _impl():
        session = db.session
        get_game_or_404(session, game_id)
        last = session.scalars(
            select(Chapter).where(Chapter.game_id == game_id).order_by(Chapter.order_index.desc())
        ).first()
        next_order = (last.order_index + 1) if last else 1

        chapter = Chapter(game_id=game_id, title=data.title, summary=data.summary,
                          notes=data.notes, order_index=next_order)
        session.add(chapter)
        session.flush()

        board = Board(chapter_id=chapter.id)
        session.add(board)
        session.flush()

        if data.copy_from_previous and last and last.board:
            # 复制上一章：引用相同人物档案，状态/关系/坐标独立保存
            for node in last.board.nodes:
                session.add(BoardNode(board_id=board.id, character_id=node.character_id,
                                      x=node.x, y=node.y, width=node.width, height=node.height))
                src_state = session.scalars(select(ChapterCharacter).where(
                    ChapterCharacter.chapter_id == last.id,
                    ChapterCharacter.character_id == node.character_id)).first()
                session.add(ChapterCharacter(
                    chapter_id=chapter.id, character_id=node.character_id,
                    alias=src_state.alias if src_state else "",
                    role=src_state.role if src_state else "",
                    status=src_state.status if src_state else "",
                    notes=src_state.notes if src_state else ""))
            for rel in last.board.relations:
                session.add(ChapterRelation(board_id=board.id,
                                            from_character_id=rel.from_character_id,
                                            to_character_id=rel.to_character_id,
                                            relation_type_id=rel.relation_type_id,
                                            description=rel.description,
                                            event_ids=list(rel.event_ids or [])))

        session.commit()
        session.refresh(chapter)
        response_cache.invalidate_game(game_id)
        return api_response(_dump(ChapterOut.model_validate(chapter)))
    return await run_db(_guard(_impl))


@router.patch("/{chapter_id}")
async def update_chapter(game_id: int, chapter_id: int, data: ChapterUpdate):
    def _impl():
        session = db.session
        chapter = session.get(Chapter, chapter_id)
        if not chapter or chapter.game_id != game_id:
            raise HTTPException(404, "章节不存在")
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(chapter, k, v)
        session.commit()
        session.refresh(chapter)
        response_cache.invalidate_game(game_id)
        return api_response(_dump(ChapterOut.model_validate(chapter)))
    return await run_db(_guard(_impl))


@router.delete("/{chapter_id}")
async def delete_chapter(game_id: int, chapter_id: int):
    def _impl():
        session = db.session
        chapter = session.get(Chapter, chapter_id)
        if not chapter or chapter.game_id != game_id:
            raise HTTPException(404, "章节不存在")
        session.delete(chapter)
        session.commit()
        response_cache.invalidate_game(game_id)
        return api_response({"ok": True})
    return await run_db(_guard(_impl))
