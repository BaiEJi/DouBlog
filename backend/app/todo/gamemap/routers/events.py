"""剧情事件路由:章节时间线 CRUD(源 routers/events.py 照搬;写端点全量失效缓存)。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.response import api_response

from .. import cache as response_cache
from ..models import Chapter, EventCharacter, StoryEvent
from ..schemas import EventCreate, EventOut, EventUpdate
from ._base import _dump, _guard

router = APIRouter(prefix="/api/todo/gamemap/chapters/{chapter_id}/events", tags=["gamemap-events"],
                   dependencies=[Depends(require_basic)])


def get_chapter(db: Session, chapter_id: int) -> Chapter:
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(404, "章节不存在")
    return chapter


def _attach_char_ids(db: Session, events: list[StoryEvent]) -> list[StoryEvent]:
    """给 ORM 对象挂 character_ids 属性供 EventOut 序列化(O(n+m) 分组,原为 O(n×m) 双层循环)。"""
    if not events:
        return events
    by_event: dict[int, list[int]] = {}
    for ec in db.scalars(select(EventCharacter).where(
            EventCharacter.event_id.in_([e.id for e in events]))):
        by_event.setdefault(ec.event_id, []).append(ec.character_id)
    for e in events:
        e.character_ids = by_event.get(e.id, [])
    return events


@router.get("")
async def list_events(chapter_id: int):
    def _impl():
        session = db.session
        get_chapter(session, chapter_id)
        events = list(session.scalars(select(StoryEvent).where(StoryEvent.chapter_id == chapter_id)
                                      .order_by(StoryEvent.order_index)).all())
        return api_response(_dump([EventOut.model_validate(e) for e in _attach_char_ids(session, events)]))
    return await run_db(_guard(_impl))


@router.post("")
async def create_event(chapter_id: int, data: EventCreate):
    def _impl():
        session = db.session
        get_chapter(session, chapter_id)
        event = StoryEvent(chapter_id=chapter_id, title=data.title, content=data.content,
                           order_index=data.order_index)
        session.add(event)
        session.flush()
        for cid in data.character_ids:
            session.add(EventCharacter(event_id=event.id, character_id=cid))
        session.commit()
        session.refresh(event)
        response_cache.invalidate_all()
        return api_response(_dump(EventOut.model_validate(_attach_char_ids(session, [event])[0])))
    return await run_db(_guard(_impl))


@router.patch("/{event_id}")
async def update_event(chapter_id: int, event_id: int, data: EventUpdate):
    def _impl():
        session = db.session
        event = session.get(StoryEvent, event_id)
        if not event or event.chapter_id != chapter_id:
            raise HTTPException(404, "事件不存在")
        payload = data.model_dump(exclude_unset=True)
        character_ids = payload.pop("character_ids", None)
        for k, v in payload.items():
            setattr(event, k, v)
        if character_ids is not None:
            session.query(EventCharacter).filter_by(event_id=event_id).delete()
            for cid in character_ids:
                session.add(EventCharacter(event_id=event_id, character_id=cid))
        session.commit()
        session.refresh(event)
        response_cache.invalidate_all()
        return api_response(_dump(EventOut.model_validate(_attach_char_ids(session, [event])[0])))
    return await run_db(_guard(_impl))


@router.delete("/{event_id}")
async def delete_event(chapter_id: int, event_id: int):
    def _impl():
        session = db.session
        event = session.get(StoryEvent, event_id)
        if not event or event.chapter_id != chapter_id:
            raise HTTPException(404, "事件不存在")
        # EventCharacter 无 ORM 级联，须显式清理，否则孤儿行会与新事件（rowid 复用）撞唯一约束
        session.query(EventCharacter).filter_by(event_id=event_id).delete()
        session.delete(event)
        session.commit()
        response_cache.invalidate_all()
        return api_response({"ok": True})
    return await run_db(_guard(_impl))
