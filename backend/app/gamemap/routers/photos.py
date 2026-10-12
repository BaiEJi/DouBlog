"""角色图鉴照片：按章节归档（列表/关联/编辑/删除）。

源 routers/photos.py 照搬;url 前缀改为 /api/gamemap/files/。
"""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.response import api_response

from .. import cache as response_cache
from ..models import Attachment, Chapter, Character, CharacterPhoto
from ..schemas import CharacterPhotoCreate, CharacterPhotoOut, CharacterPhotoUpdate
from ._base import _dump, _guard, envelope_body

router = APIRouter(prefix="/api/gamemap/games/{game_id}/characters/{character_id}/photos",
                   tags=["gamemap-character-photos"], dependencies=[Depends(require_basic)])

_FILES_URL = "/api/gamemap/files/"


def _char_or_404(db: Session, game_id: int, character_id: int) -> Character:
    c = db.get(Character, character_id)
    if not c or c.game_id != game_id:
        raise HTTPException(404, "人物不存在")
    return c


def _to_out(db: Session, p: CharacterPhoto) -> CharacterPhotoOut:
    att = db.get(Attachment, p.attachment_id)
    url = _FILES_URL + (att.file_path.replace("\\", "/").split("/")[-1] if att else "missing")
    ch = db.get(Chapter, p.chapter_id) if p.chapter_id else None
    return CharacterPhotoOut(
        id=p.id, character_id=p.character_id,
        chapter_id=p.chapter_id,
        chapter_title=ch.title if ch else "",
        chapter_order=ch.order_index if ch else 0,
        url=url, caption=p.caption, created_at=p.created_at,
    )


@router.get("")
async def list_photos(game_id: int, character_id: int):
    """按章节顺序（无章在最后）、同章按创建时间排序。"""
    def _impl():
        session = db.session
        _char_or_404(session, game_id, character_id)
        key = f"photos:{game_id}:{character_id}"
        e0 = response_cache.epoch_for(game_id)
        cached = response_cache.cache_get(key, e0)
        if cached is not None:
            return Response(content=cached, media_type="application/json")
        rows = list(session.scalars(select(CharacterPhoto).where(
            CharacterPhoto.character_id == character_id)))
        outs = [_to_out(session, p) for p in rows]
        outs.sort(key=lambda o: (o.chapter_id is None, o.chapter_order, o.id))
        body = envelope_body(_dump(outs))
        response_cache.cache_put(key, e0, body)
        return Response(content=body, media_type="application/json")
    return await run_db(_guard(_impl))


@router.post("")
async def add_photo(game_id: int, character_id: int, data: CharacterPhotoCreate):
    """把已上传的附件（POST /api/gamemap/uploads）关联为角色的章节照片。"""
    def _impl():
        session = db.session
        _char_or_404(session, game_id, character_id)
        if not session.get(Attachment, data.attachment_id):
            raise HTTPException(404, "附件不存在")
        if data.chapter_id is not None:
            ch = session.get(Chapter, data.chapter_id)
            if not ch or ch.game_id != game_id:
                raise HTTPException(404, "章节不存在")
        p = CharacterPhoto(character_id=character_id, chapter_id=data.chapter_id,
                           attachment_id=data.attachment_id, caption=data.caption)
        session.add(p)
        session.commit()
        session.refresh(p)
        response_cache.invalidate_game(game_id)
        return api_response(_dump(_to_out(session, p)))
    return await run_db(_guard(_impl))


@router.patch("/{photo_id}")
async def update_photo(game_id: int, character_id: int, photo_id: int,
                       data: CharacterPhotoUpdate):
    def _impl():
        session = db.session
        _char_or_404(session, game_id, character_id)
        p = session.get(CharacterPhoto, photo_id)
        if not p or p.character_id != character_id:
            raise HTTPException(404, "照片不存在")
        payload = data.model_dump(exclude_unset=True)
        if "chapter_id" in payload and payload["chapter_id"] is not None:
            ch = session.get(Chapter, payload["chapter_id"])
            if not ch or ch.game_id != game_id:
                raise HTTPException(404, "章节不存在")
        for k, v in payload.items():
            setattr(p, k, v)
        session.commit()
        session.refresh(p)
        response_cache.invalidate_game(game_id)
        return api_response(_dump(_to_out(session, p)))
    return await run_db(_guard(_impl))


@router.delete("/{photo_id}")
async def delete_photo(game_id: int, character_id: int, photo_id: int):
    def _impl():
        session = db.session
        _char_or_404(session, game_id, character_id)
        p = session.get(CharacterPhoto, photo_id)
        if not p or p.character_id != character_id:
            raise HTTPException(404, "照片不存在")
        session.delete(p)  # 只删关联，不动附件文件
        session.commit()
        response_cache.invalidate_game(game_id)
        return api_response({"ok": True})
    return await run_db(_guard(_impl))
