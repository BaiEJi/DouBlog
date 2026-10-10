"""人物路由:CRUD + 批量建档 + 人物绑定章节 + 章节人物状态(源 routers/characters.py 照搬)。

list 带 q 过滤读缓存(chars:{gid}:{q});写端点 commit 后失效该游戏缓存。
"""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.response import api_response

from .. import cache as response_cache
from ..models import Board, BoardNode, Character, Chapter, ChapterCharacter, Game
from ..schemas import (
    ChapterCharacterOut,
    ChapterCharacterUpdate,
    ChapterOut,
    CharacterBatchCreate,
    CharacterCreate,
    CharacterOut,
    CharacterUpdate,
)
from ._base import _dump, _guard, envelope_body

router = APIRouter(prefix="/api/todo/gamemap/games/{game_id}/characters", tags=["gamemap-characters"],
                   dependencies=[Depends(require_basic)])


def get_chapter_or_404(db: Session, game_id: int, chapter_id: int) -> Chapter:
    chapter = db.get(Chapter, chapter_id)
    if not chapter or chapter.game_id != game_id:
        raise HTTPException(404, "章节不存在")
    return chapter


@router.get("")
async def list_characters(game_id: int, q: str = ""):
    def _impl():
        session = db.session
        key = f"chars:{game_id}:{q}"
        e0 = response_cache.epoch_for(game_id)
        cached = response_cache.cache_get(key, e0)
        if cached is not None:
            return Response(content=cached, media_type="application/json")
        stmt = select(Character).where(Character.game_id == game_id)
        if q:
            stmt = stmt.where(Character.name.contains(q))
        out = session.scalars(stmt.order_by(Character.updated_at.desc())).all()
        body = envelope_body(_dump([CharacterOut.model_validate(c) for c in out]))
        response_cache.cache_put(key, e0, body)
        return Response(content=body, media_type="application/json")
    return await run_db(_guard(_impl))


@router.post("")
async def create_character(game_id: int, data: CharacterCreate):
    def _impl():
        session = db.session
        if not session.get(Game, game_id):
            raise HTTPException(404, "游戏不存在")
        character = Character(game_id=game_id, name=data.name, description=data.description,
                              avatar_url=data.avatar_url, faction=data.faction, alive=data.alive)
        session.add(character)
        session.commit()
        session.refresh(character)
        response_cache.invalidate_game(game_id)
        return api_response(_dump(CharacterOut.model_validate(character)))
    return await run_db(_guard(_impl))


@router.patch("/{character_id}")
async def update_character(game_id: int, character_id: int, data: CharacterUpdate):
    def _impl():
        session = db.session
        character = session.get(Character, character_id)
        if not character or character.game_id != game_id:
            raise HTTPException(404, "人物不存在")
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(character, k, v)
        session.commit()
        session.refresh(character)
        response_cache.invalidate_game(game_id)
        return api_response(_dump(CharacterOut.model_validate(character)))
    return await run_db(_guard(_impl))


@router.delete("/{character_id}")
async def delete_character(game_id: int, character_id: int):
    """删除游戏人物档案；看板引用由外键约束一并清理。"""
    def _impl():
        session = db.session
        character = session.get(Character, character_id)
        if not character or character.game_id != game_id:
            raise HTTPException(404, "人物不存在")
        session.delete(character)
        session.commit()
        response_cache.invalidate_game(game_id)
        return api_response({"ok": True})
    return await run_db(_guard(_impl))


@router.post("/batch")
async def create_characters_batch(game_id: int, data: CharacterBatchCreate):
    """批量建档：换行/逗号/顿号分隔的人物名，跳过本游戏已存在同名，可选同时加入指定章节看板。"""
    def _impl():
        session = db.session
        if not session.get(Game, game_id):
            raise HTTPException(404, "游戏不存在")
        names, seen = [], set()
        for part in data.names.replace("，", ",").replace("、", ",").replace("\n", ",").split(","):
            name = part.strip()
            if name and name not in seen:
                seen.add(name)
                names.append(name)
        existing = {c.name for c in session.scalars(select(Character).where(Character.game_id == game_id)).all()}
        created: list[Character] = []
        for name in names:
            if name in existing:
                continue
            c = Character(game_id=game_id, name=name)
            session.add(c)
            created.append(c)
            existing.add(name)
        session.flush()

        if data.add_to_chapter_id is not None and created:
            chapter = session.get(Chapter, data.add_to_chapter_id)
            if not chapter or chapter.game_id != game_id:
                raise HTTPException(404, "章节不存在")
            board = session.scalars(select(Board).where(Board.chapter_id == chapter.id)).first()
            if not board:
                board = Board(chapter_id=chapter.id)
                session.add(board)
                session.flush()
            offset = len(board.nodes)
            for i, c in enumerate(created):
                session.add(BoardNode(board_id=board.id, character_id=c.id,
                                      x=80 + ((offset + i) % 4) * 330, y=80 + ((offset + i) // 4) * 220))
                if not session.scalars(select(ChapterCharacter).where(
                        ChapterCharacter.chapter_id == chapter.id,
                        ChapterCharacter.character_id == c.id)).first():
                    session.add(ChapterCharacter(chapter_id=chapter.id, character_id=c.id))
        session.commit()
        for c in created:
            session.refresh(c)
        response_cache.invalidate_game(game_id)
        return api_response(_dump([CharacterOut.model_validate(c) for c in created]))
    return await run_db(_guard(_impl))


@router.get("/{character_id}/chapters")
async def character_chapters(game_id: int, character_id: int):
    """人物绑定到哪些章节：以各章看板上的节点为准，按章节顺序返回。"""
    def _impl():
        session = db.session
        character = session.get(Character, character_id)
        if not character or character.game_id != game_id:
            raise HTTPException(404, "人物不存在")
        return api_response(_dump([ChapterOut.model_validate(c) for c in session.execute(
            select(Chapter).join(Board, Board.chapter_id == Chapter.id)
            .join(BoardNode, BoardNode.board_id == Board.id)
            .where(Chapter.game_id == game_id, BoardNode.character_id == character_id)
            .order_by(Chapter.order_index)
        ).scalars().all()]))
    return await run_db(_guard(_impl))


# ---- 章节人物状态 ----

@router.get("/{character_id}/chapters/{chapter_id}/state")
async def get_chapter_state(game_id: int, character_id: int, chapter_id: int):
    def _impl():
        session = db.session
        get_chapter_or_404(session, game_id, chapter_id)
        state = session.scalars(select(ChapterCharacter).where(
            ChapterCharacter.chapter_id == chapter_id,
            ChapterCharacter.character_id == character_id)).first()
        if not state:
            raise HTTPException(404, "该人物不在本章")
        return api_response(_dump(ChapterCharacterOut.model_validate(state)))
    return await run_db(_guard(_impl))


@router.put("/{character_id}/chapters/{chapter_id}/state")
async def put_chapter_state(game_id: int, character_id: int, chapter_id: int,
                            data: ChapterCharacterUpdate):
    def _impl():
        session = db.session
        get_chapter_or_404(session, game_id, chapter_id)
        state = session.scalars(select(ChapterCharacter).where(
            ChapterCharacter.chapter_id == chapter_id,
            ChapterCharacter.character_id == character_id)).first()
        if not state:
            raise HTTPException(404, "该人物不在本章")
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(state, k, v)
        session.commit()
        session.refresh(state)
        response_cache.invalidate_game(game_id)
        return api_response(_dump(ChapterCharacterOut.model_validate(state)))
    return await run_db(_guard(_impl))
