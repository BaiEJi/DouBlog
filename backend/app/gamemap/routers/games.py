"""游戏路由:CRUD + 统计面板(读缓存) + 备份导出/导入。

源 gamemap routers/games.py 照搬;适配:信封 api_response / run_db 会话 /
写端点 commit 后显式失效响应缓存(源由中间件按路径失效,粒度一致)。
"""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.response import api_response

from .. import cache as response_cache
from ..models import (
    Attachment, Board, BoardNode, Chapter, ChapterCharacter, ChapterRelation,
    Character, EventCharacter, Game, RelationType, StoryEvent,
)
from ..schemas import GameCreate, GameOut, GameUpdate
from ._base import _dump, _guard, envelope_body

router = APIRouter(prefix="/api/gamemap/games", tags=["gamemap-games"],
                   dependencies=[Depends(require_basic)])

_FILES_URL = "/api/gamemap/files/"


def _attach_urls(db: Session, games: list[Game]) -> None:
    """给 ORM 对象挂 cover_url 属性（GameOut 序列化时读取）。"""
    ids = {g.cover_attachment_id for g in games if g.cover_attachment_id}
    url_by_id = {}
    if ids:
        for a in db.scalars(select(Attachment).where(Attachment.id.in_(ids))):
            url_by_id[a.id] = _FILES_URL + a.file_path.replace("\\", "/").split("/")[-1]
    for g in games:
        g.cover_url = url_by_id.get(g.cover_attachment_id, "") if g.cover_attachment_id else ""


@router.get("")
async def list_games():
    def _impl():
        session = db.session
        games = list(session.scalars(select(Game).order_by(Game.updated_at.desc())).all())
        _attach_urls(session, games)
        return api_response(_dump([GameOut.model_validate(g) for g in games]))
    return await run_db(_guard(_impl))


@router.post("")
async def create_game(data: GameCreate):
    def _impl():
        session = db.session
        game = Game(name=data.name, description=data.description, play_status=data.play_status)
        session.add(game)
        session.commit()
        session.refresh(game)
        response_cache.invalidate_all()
        _attach_urls(session, [game])
        return api_response(_dump(GameOut.model_validate(game)))
    return await run_db(_guard(_impl))


@router.get("/{game_id}")
async def get_game(game_id: int):
    def _impl():
        session = db.session
        game = session.get(Game, game_id)
        if not game:
            raise HTTPException(404, "游戏不存在")
        _attach_urls(session, [game])
        return api_response(_dump(GameOut.model_validate(game)))
    return await run_db(_guard(_impl))


@router.patch("/{game_id}")
async def update_game(game_id: int, data: GameUpdate):
    def _impl():
        session = db.session
        game = session.get(Game, game_id)
        if not game:
            raise HTTPException(404, "游戏不存在")
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(game, k, v)
        session.commit()
        session.refresh(game)
        response_cache.invalidate_game(game_id)
        _attach_urls(session, [game])
        return api_response(_dump(GameOut.model_validate(game)))
    return await run_db(_guard(_impl))


@router.delete("/{game_id}")
async def delete_game(game_id: int):
    def _impl():
        session = db.session
        game = session.get(Game, game_id)
        if not game:
            raise HTTPException(404, "游戏不存在")
        session.delete(game)  # 有章节/人物时 ORM 置空 NOT NULL 外键 → 500（源行为锁定，见测试）
        session.commit()
        response_cache.invalidate_game(game_id)
        return api_response({"ok": True})
    return await run_db(_guard(_impl))


# ---- 统计面板 ----

@router.get("/{game_id}/stats")
async def game_stats(game_id: int):
    """看板统计：各章人物/关系数、核心人物（关联度）、阵营规模、关系类型分布。"""
    def _impl():
        session = db.session
        key = f"stats:{game_id}"
        e0 = response_cache.epoch_for(game_id)
        cached = response_cache.cache_get(key, e0)
        if cached is not None:
            return Response(content=cached, media_type="application/json")
        game = session.get(Game, game_id)
        if not game:
            raise HTTPException(404, "游戏不存在")
        chapters = list(session.scalars(select(Chapter).where(Chapter.game_id == game_id)
                                        .order_by(Chapter.order_index)).all())
        ch_ids = [c.id for c in chapters]
        # selectinload 一次取全部看板的节点/关系(原先逐看板懒加载,2N 条查询)
        boards = {b.chapter_id: b for b in session.scalars(
            select(Board).where(Board.chapter_id.in_(ch_ids))
            .options(selectinload(Board.nodes), selectinload(Board.relations))
        )} if ch_ids else {}

        chars = list(session.scalars(select(Character).where(Character.game_id == game_id)).all())
        char_by_id = {c.id: c for c in chars}

        per_chapter, degree, type_usage = [], {}, {}
        total_rels = 0
        dedup_rels: set[tuple[int, int, int]] = set()
        for ch in chapters:
            b = boards.get(ch.id)
            n_count = len(b.nodes) if b else 0
            r_count = len(b.relations) if b else 0
            total_rels += r_count
            per_chapter.append({"id": ch.id, "title": ch.title, "order_index": ch.order_index,
                                "characters": n_count, "relations": r_count})
            for r in (b.relations if b else []):
                degree[r.from_character_id] = degree.get(r.from_character_id, 0) + 1
                degree[r.to_character_id] = degree.get(r.to_character_id, 0) + 1
                type_usage[r.relation_type_id] = type_usage.get(r.relation_type_id, 0) + 1
                dedup_rels.add((r.from_character_id, r.to_character_id, r.relation_type_id))

        top_characters = sorted(
            ({"id": cid, "name": char_by_id[cid].name if cid in char_by_id else f"#{cid}", "degree": d}
             for cid, d in degree.items()), key=lambda x: -x["degree"])[:8]

        factions: dict[str, dict] = {}
        for c in chars:
            if c.faction:
                f = factions.setdefault(c.faction, {"name": c.faction, "count": 0, "alive": 0})
                f["count"] += 1
                f["alive"] += 1 if c.alive else 0

        types = list(session.scalars(select(RelationType).where(RelationType.id.in_(type_usage)))) if type_usage else []
        type_stats = sorted(
            ({"type_id": t.id, "key": t.key, "name": t.name, "color": t.color, "count": type_usage[t.id]}
             for t in types), key=lambda x: -x["count"])

        event_count = 0
        if ch_ids:
            event_count = session.scalar(
                select(func.count()).select_from(StoryEvent).where(StoryEvent.chapter_id.in_(ch_ids))
            ) or 0

        data = {
            "totals": {"chapters": len(chapters), "characters": len(chars),
                       "relations": len(dedup_rels), "relations_all": total_rels, "events": event_count},
            "chapters": per_chapter,
            "top_characters": top_characters,
            "factions": sorted(factions.values(), key=lambda x: -x["count"]),
            "type_usage": type_stats,
        }
        body = envelope_body(data)
        response_cache.cache_put(key, e0, body)
        return Response(content=body, media_type="application/json")
    return await run_db(_guard(_impl))


# ---- 备份导出 / 导入 ----

@router.get("/{game_id}/export")
async def export_game(game_id: int):
    """整游戏导出为 JSON（人物/章节/看板/状态/事件/自定义关系类型，按索引引用）。"""
    def _impl():
        session = db.session
        game = session.get(Game, game_id)
        if not game:
            raise HTTPException(404, "游戏不存在")
        chapters = list(session.scalars(select(Chapter).where(Chapter.game_id == game_id)
                                        .order_by(Chapter.order_index)).all())
        chars = list(session.scalars(select(Character).where(Character.game_id == game_id)
                                     .order_by(Character.id)).all())
        char_idx = {c.id: i for i, c in enumerate(chars)}
        types_all = list(session.scalars(select(RelationType)))
        type_key = {t.id: t.key for t in types_all}
        game_type_ids = {t.id for t in types_all if t.game_id == game_id}

        ch_data = []
        ev_chars: dict[int, list[int]] = {}
        for ec in session.scalars(select(EventCharacter)):
            ev_chars.setdefault(ec.event_id, []).append(ec.character_id)
        for ch in chapters:
            b = session.scalars(select(Board).where(Board.chapter_id == ch.id)).first()
            states = list(session.scalars(select(ChapterCharacter).where(ChapterCharacter.chapter_id == ch.id)))
            events = list(session.scalars(select(StoryEvent).where(StoryEvent.chapter_id == ch.id)
                                          .order_by(StoryEvent.order_index)))
            ch_data.append({
                "title": ch.title, "order_index": ch.order_index, "summary": ch.summary, "notes": ch.notes,
                "nodes": ([{"character": char_idx[n.character_id], "x": n.x, "y": n.y} for n in b.nodes] if b else []),
                "relations": ([{"from": char_idx[r.from_character_id], "to": char_idx[r.to_character_id],
                                "type": type_key.get(r.relation_type_id), "description": r.description}
                               for r in b.relations] if b else []),
                "states": ([{"character": char_idx[s.character_id], "alias": s.alias, "role": s.role,
                             "status": s.status, "notes": s.notes,
                             "alive_override": s.alive_override, "faction_override": s.faction_override}
                            for s in states if s.character_id in char_idx]),
                "events": ([{"title": e.title, "content": e.content, "order_index": e.order_index,
                             "characters": [char_idx[c] for c in ev_chars.get(e.id, []) if c in char_idx]}
                            for e in events]),
            })
        return api_response({
            "format": "gamemap-backup", "version": 1,
            "game": {"name": game.name, "description": game.description, "play_status": game.play_status},
            "characters": [{"name": c.name, "description": c.description, "avatar_url": c.avatar_url,
                            "faction": c.faction, "alive": c.alive} for c in chars],
            "custom_relation_types": [
                {"key": t.key, "name": t.name, "color": t.color, "line_style": t.line_style,
                 "directional": t.directional, "default_description": t.default_description,
                 "order_index": t.order_index, "enabled": t.enabled}
                for t in types_all if t.id in game_type_ids],
            "chapters": ch_data,
        })
    return await run_db(_guard(_impl))


@router.post("/import")
async def import_game(data: dict):
    """从备份 JSON 创建一个全新游戏（原游戏不受影响；全局关系类型按 key 复用，缺失则建为游戏自定义）。"""
    def _impl():
        session = db.session
        if not isinstance(data, dict) or data.get("format") != "gamemap-backup":
            raise HTTPException(400, "不是有效的 GameMap 备份文件")
        g = data.get("game") or {}
        game = Game(name=(g.get("name") or "导入的游戏"), description=g.get("description") or "",
                    play_status=g.get("play_status") or "playing")
        session.add(game)
        session.flush()

        global_types = {t.key: t for t in session.scalars(select(RelationType).where(RelationType.game_id.is_(None)))}
        key_to_id = {k: t.id for k, t in global_types.items()}
        for ct in data.get("custom_relation_types") or []:
            if ct.get("key") in key_to_id:
                continue
            t = RelationType(game_id=game.id, key=ct["key"], name=ct["name"],
                             color=ct.get("color") or "#5B8FF9", line_style=ct.get("line_style") or "solid",
                             directional=bool(ct.get("directional")), default_description=ct.get("default_description") or "",
                             order_index=ct.get("order_index") or 0, enabled=bool(ct.get("enabled", True)))
            session.add(t)
            session.flush()
            key_to_id[t.key] = t.id

        char_ids = []
        for c in data.get("characters") or []:
            nc = Character(game_id=game.id, name=c["name"], description=c.get("description") or "",
                           avatar_url=c.get("avatar_url") or "", faction=c.get("faction") or "",
                           alive=bool(c.get("alive", True)))
            session.add(nc)
            session.flush()
            char_ids.append(nc.id)

        first_chapter_id = None
        for chd in data.get("chapters") or []:
            ch = Chapter(game_id=game.id, title=chd["title"], order_index=chd.get("order_index") or 1,
                         summary=chd.get("summary") or "", notes=chd.get("notes") or "")
            session.add(ch)
            session.flush()
            first_chapter_id = first_chapter_id or ch.id
            board = Board(chapter_id=ch.id)
            session.add(board)
            session.flush()
            for n in chd.get("nodes") or []:
                session.add(BoardNode(board_id=board.id, character_id=char_ids[n["character"]],
                                      x=n.get("x") or 0, y=n.get("y") or 0))
            for r in chd.get("relations") or []:
                tid = key_to_id.get(r.get("type"))
                if tid is None:
                    continue
                session.add(ChapterRelation(board_id=board.id, from_character_id=char_ids[r["from"]],
                                            to_character_id=char_ids[r["to"]], relation_type_id=tid,
                                            description=r.get("description") or ""))
            for s in chd.get("states") or []:
                session.add(ChapterCharacter(chapter_id=ch.id, character_id=char_ids[s["character"]],
                                             alias=s.get("alias") or "", role=s.get("role") or "",
                                             status=s.get("status") or "", notes=s.get("notes") or "",
                                             alive_override=s.get("alive_override"),
                                             faction_override=s.get("faction_override")))
            for e in chd.get("events") or []:
                ev = StoryEvent(chapter_id=ch.id, title=e["title"], content=e.get("content") or "",
                                order_index=e.get("order_index") or 0)
                session.add(ev)
                session.flush()
                for ci in e.get("characters") or []:
                    if 0 <= ci < len(char_ids):
                        session.add(EventCharacter(event_id=ev.id, character_id=char_ids[ci]))
        if first_chapter_id:
            game.current_chapter_id = first_chapter_id
        session.commit()
        session.refresh(game)
        response_cache.invalidate_all()
        _attach_urls(session, [game])
        return api_response(_dump(GameOut.model_validate(game)))
    return await run_db(_guard(_impl))
