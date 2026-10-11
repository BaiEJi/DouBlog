"""关系类型路由:全局默认+游戏覆盖+游戏自定义的 effective 列表与管理端 CRUD(源照搬)。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.response import api_response

from .. import cache as response_cache
from ..models import GameRelationOverride, RelationType
from ..schemas import EffectiveRelationType, RelationTypeCreate
from ._base import _dump, _guard

router = APIRouter(prefix="/api/todo/gamemap", tags=["gamemap-relation-types"],
                   dependencies=[Depends(require_basic)])

OVERRIDABLE_FIELDS = {"name", "color", "line_style", "directional", "default_description", "order_index", "enabled"}


def effective_types(db: Session, game_id: int | None) -> list[EffectiveRelationType]:
    """全局默认 + 游戏覆盖 + 游戏自定义 = 当前游戏可用的关系类型。"""
    stmt = select(RelationType)
    types = db.scalars(stmt.order_by(RelationType.order_index)).all()
    overrides: dict[int, dict] = {}
    if game_id:
        for o in db.scalars(select(GameRelationOverride).where(GameRelationOverride.game_id == game_id)):
            overrides[o.relation_type_id] = o.fields or {}

    result = []
    for t in types:
        if t.game_id is not None and t.game_id != game_id:
            continue
        fields = {c.name: getattr(t, c.name) for c in t.__table__.columns
                  if c.name in OVERRIDABLE_FIELDS}
        ov = overrides.get(t.id, {})
        overridden = bool(ov)
        for k, v in ov.items():
            if k in fields:
                fields[k] = v
        result.append(EffectiveRelationType(
            id=t.id, game_id=t.game_id, key=t.key, overridden=overridden, **fields))
    return result


@router.get("/relation-types")
async def list_global_types():
    def _impl():
        return api_response(_dump(effective_types(db.session, None)))
    return await run_db(_guard(_impl))


@router.get("/games/{game_id}/relation-types")
async def list_game_types(game_id: int):
    def _impl():
        return api_response(_dump(effective_types(db.session, game_id)))
    return await run_db(_guard(_impl))


# ---- 管理端：全局类型 CRUD（第一版提供基础接口） ----

@router.post("/relation-types")
async def create_type(data: RelationTypeCreate):
    def _impl():
        session = db.session
        rt = RelationType(game_id=data.game_id, key=data.key, name=data.name or data.key,
                          color=data.color, line_style=data.line_style,
                          directional=data.directional,
                          default_description=data.default_description,
                          order_index=data.order_index)
        session.add(rt)
        session.commit()
        response_cache.invalidate_all()
        return api_response({"id": rt.id})
    return await run_db(_guard(_impl))


@router.put("/games/{game_id}/relation-types/{type_id}/override")
async def override_type(game_id: int, type_id: int, data: dict):
    """游戏覆盖全局类型的部分字段；fields 传 {} 并指定 reset=true 可恢复继承。"""
    def _impl():
        session = db.session
        rt = session.get(RelationType, type_id)
        if not rt or rt.game_id is not None:
            raise HTTPException(404, "全局类型不存在")
        if data.get("reset"):
            session.query(GameRelationOverride).filter_by(game_id=game_id, relation_type_id=type_id).delete()
            session.commit()
            response_cache.invalidate_all()
            return api_response({"ok": True, "reset": True})
        fields = {k: v for k, v in (data.get("fields") or {}).items() if k in OVERRIDABLE_FIELDS}
        o = session.scalars(select(GameRelationOverride).where(
            GameRelationOverride.game_id == game_id,
            GameRelationOverride.relation_type_id == type_id)).first()
        if o:
            o.fields = {**(o.fields or {}), **fields}
        else:
            o = GameRelationOverride(game_id=game_id, relation_type_id=type_id, fields=fields)
            session.add(o)
        session.commit()
        response_cache.invalidate_all()
        return api_response({"ok": True})
    return await run_db(_guard(_impl))
