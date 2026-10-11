"""看板路由:单章看板(读缓存)/节点增删/整板保存(乐观锁)/跨章聚合 merged/
聚合模式增量写入(拖动 PATCH/单条关系 POST-PATCH-DELETE)(源 routers/boards.py 照搬)。

适配:信封 api_response / run_db 会话;源版经中间件失效缓存,改为各写端点
commit 后显式 invalidate_game(粒度一致);源版 SDK 参数错误改为 HTTPException(400)。
"""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.response import api_response

from .. import cache as response_cache
from ..models import Board, BoardNode, Character, Chapter, ChapterCharacter, ChapterRelation
from ..schemas import (
    BoardOut, BoardSave, ChapterCharacterOut, ChapterOut, CharacterOut, MergedBoardOut,
    MergedNodeOut, MergedRelationOut, MergedStateOut, NodeOut, NodePositionUpdate,
    RelationCreate, RelationDescriptionUpdate, RelationOut,
)
from ._base import _dump, _guard, envelope_body

router = APIRouter(prefix="/api/todo/gamemap/games/{game_id}/boards", tags=["gamemap-boards"],
                   dependencies=[Depends(require_basic)])


def get_board(db: Session, game_id: int, chapter_id: int) -> Board:
    chapter = db.get(Chapter, chapter_id)
    if not chapter or chapter.game_id != game_id:
        raise HTTPException(404, "章节不存在")
    board = db.scalars(select(Board).where(Board.chapter_id == chapter_id)).first()
    if not board:
        board = Board(chapter_id=chapter_id)
        db.add(board)
        db.commit()
        db.refresh(board)
    return board


def get_chapter_board(db: Session, game_id: int, chapter_id: int) -> Response:
    """单章看板响应(读缓存;信封化正文)。"""
    key = f"board:{game_id}:{chapter_id}"
    e0 = response_cache.epoch_for(game_id)
    cached = response_cache.cache_get(key, e0)
    if cached is not None:
        return Response(content=cached, media_type="application/json")
    board = get_board(db, game_id, chapter_id)
    char_ids = {n.character_id for n in board.nodes} | {
        c for r in board.relations for c in (r.from_character_id, r.to_character_id)}
    chars = db.scalars(select(Character).where(Character.id.in_(char_ids))).all() if char_ids else []
    states = db.scalars(select(ChapterCharacter).where(ChapterCharacter.chapter_id == chapter_id)).all()
    out = BoardOut(
        id=board.id, chapter_id=board.chapter_id, version=board.version,
        nodes=[NodeOut(id=n.id, board_id=board.id, character_id=n.character_id,
                       x=n.x, y=n.y, width=n.width, height=n.height) for n in board.nodes],
        relations=[RelationOut(id=r.id, board_id=board.id,
                               from_character_id=r.from_character_id, to_character_id=r.to_character_id,
                               relation_type_id=r.relation_type_id, description=r.description,
                               event_ids=list(r.event_ids or [])) for r in board.relations],
        characters=[CharacterOut.model_validate(c) for c in chars],
        states=[ChapterCharacterOut.model_validate(s) for s in states],
    )
    body = envelope_body(_dump(out))
    response_cache.cache_put(key, e0, body)
    return Response(content=body, media_type="application/json")


@router.get("/chapters/{chapter_id}")
async def get_chapter_board_ep(game_id: int, chapter_id: int):
    def _impl():
        return get_chapter_board(db.session, game_id, chapter_id)
    return await run_db(_guard(_impl))


@router.post("/chapters/{chapter_id}/nodes/{character_id}")
async def add_node(game_id: int, chapter_id: int, character_id: int):
    """从人物库添加人物到本章看板（不存在章节状态时创建空状态）。"""
    def _impl():
        session = db.session
        board = get_board(session, game_id, chapter_id)
        character = session.get(Character, character_id)
        if not character or character.game_id != game_id:
            raise HTTPException(404, "人物不存在")
        exists = any(n.character_id == character_id for n in board.nodes)
        if not exists:
            offset = len(board.nodes)
            session.add(BoardNode(board_id=board.id, character_id=character_id,
                                  x=80 + (offset % 4) * 330, y=80 + (offset // 4) * 220))
            if not session.scalars(select(ChapterCharacter).where(
                    ChapterCharacter.chapter_id == chapter_id,
                    ChapterCharacter.character_id == character_id)).first():
                session.add(ChapterCharacter(chapter_id=chapter_id, character_id=character_id))
            session.commit()
            session.refresh(board)
            response_cache.invalidate_game(game_id)
        return get_chapter_board(session, game_id, chapter_id)
    return await run_db(_guard(_impl))


@router.delete("/chapters/{chapter_id}/nodes/{character_id}")
async def remove_node(game_id: int, chapter_id: int, character_id: int):
    """从本章看板移除人物：只删节点和相关连线，不动人物档案和章节状态。"""
    def _impl():
        session = db.session
        board = get_board(session, game_id, chapter_id)
        session.query(BoardNode).filter_by(board_id=board.id, character_id=character_id).delete()
        session.query(ChapterRelation).filter(
            ChapterRelation.board_id == board.id,
            ((ChapterRelation.from_character_id == character_id) | (ChapterRelation.to_character_id == character_id)),
        ).delete(synchronize_session=False)
        session.commit()
        response_cache.invalidate_game(game_id)
        return api_response({"ok": True})
    return await run_db(_guard(_impl))


@router.put("/chapters/{chapter_id}")
async def save_board(game_id: int, chapter_id: int, data: BoardSave):
    """整板保存（打散布局等入口），带版本号做乐观锁。

    性能：存在性检查合并为一条 IN 查询，三类插入用 executemany 批量执行。"""
    def _impl():
        session = db.session
        board = get_board(session, game_id, chapter_id)
        if data.version != board.version:
            raise HTTPException(409, f"看板已被其他页面修改（当前版本 {board.version}），请刷新后重试")

        board_char_ids = {n.character_id for n in data.nodes}
        if len(board_char_ids) != len(data.nodes):
            raise HTTPException(400, "同一看板内一个人物只能有一个节点")
        for rel in data.relations:
            if rel.from_character_id not in board_char_ids or rel.to_character_id not in board_char_ids:
                raise HTTPException(400, "关系两端人物必须存在于当前看板")

        # 全量替换，同一事务保存
        session.query(BoardNode).filter_by(board_id=board.id).delete()
        session.query(ChapterRelation).filter_by(board_id=board.id).delete()
        if data.nodes:
            session.execute(insert(BoardNode), [
                {"board_id": board.id, "character_id": n.character_id, "x": n.x, "y": n.y,
                 "width": n.width, "height": n.height} for n in data.nodes])
            # 批量补齐缺失的章节状态（一条 IN 查询 + executemany）
            existing = {row[0] for row in session.execute(
                select(ChapterCharacter.character_id).where(
                    ChapterCharacter.chapter_id == chapter_id,
                    ChapterCharacter.character_id.in_(board_char_ids))).all()}
            missing = [cid for cid in board_char_ids if cid not in existing]
            if missing:
                session.execute(insert(ChapterCharacter),
                                [{"chapter_id": chapter_id, "character_id": cid} for cid in missing])
        if data.relations:
            session.execute(insert(ChapterRelation), [
                {"board_id": board.id, "from_character_id": r.from_character_id,
                 "to_character_id": r.to_character_id, "relation_type_id": r.relation_type_id,
                 "description": r.description, "event_ids": r.event_ids} for r in data.relations])
        board.version += 1
        session.commit()
        session.refresh(board)
        response_cache.invalidate_game(game_id)
        return get_chapter_board(session, game_id, chapter_id)
    return await run_db(_guard(_impl))


@router.get("/merged")
async def merged_board(game_id: int, chapter_ids: str):
    """跨章节聚合视图：多章看板合成一张图。

    - 节点按人物去重：位置/状态取所选范围内最新包含该人物的一章，并记录来源章节；
    - 关系按（甲、乙、类型）去重：保留最新一章的实例，携带来源章节信息；
    - anchor_chapter_id = 所选范围最后一章，作为聚合模式下的写入目标。

    性能：固定 6 条 SQL（章节/看板/节点/关系/状态/人物各一条），不随章节数增长；
    响应带写失效缓存。"""
    def _impl():
        session = db.session
        key = f"merged:{game_id}:{chapter_ids}"
        e0 = response_cache.epoch_for(game_id)
        cached = response_cache.cache_get(key, e0)
        if cached is not None:
            return Response(content=cached, media_type="application/json")
        try:
            ids = [int(x) for x in chapter_ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(400, f"chapter_ids 参数非法: {chapter_ids[:50]}")
        chapters = session.scalars(select(Chapter).where(Chapter.id.in_(ids), Chapter.game_id == game_id)).all()
        chapters.sort(key=lambda c: c.order_index)
        if not chapters:
            out = MergedBoardOut(chapters=[], anchor_chapter_id=None, nodes=[], relations=[], characters=[], states=[])
            return Response(content=envelope_body(_dump(out)), media_type="application/json")
        ch_ids = [c.id for c in chapters]

        boards = session.scalars(select(Board).where(Board.chapter_id.in_(ch_ids))).all()
        board_by_ch = {b.chapter_id: b for b in boards}
        b_ids = [b.id for b in boards]
        nodes_by_board: dict[int, list[BoardNode]] = {}
        rels_by_board: dict[int, list[ChapterRelation]] = {}
        if b_ids:
            for n in session.scalars(select(BoardNode).where(BoardNode.board_id.in_(b_ids))):
                nodes_by_board.setdefault(n.board_id, []).append(n)
            for r in session.scalars(select(ChapterRelation).where(ChapterRelation.board_id.in_(b_ids))):
                rels_by_board.setdefault(r.board_id, []).append(r)
        states_by_ch: dict[int, list[ChapterCharacter]] = {}
        for s in session.scalars(select(ChapterCharacter).where(ChapterCharacter.chapter_id.in_(ch_ids))):
            states_by_ch.setdefault(s.chapter_id, []).append(s)

        node_map: dict[int, MergedNodeOut] = {}
        rel_map: dict[tuple[int, int, int], MergedRelationOut] = {}
        state_map: dict[int, MergedStateOut] = {}
        for ch in chapters:  # 章节顺序处理，靠后的（更新的）覆盖靠前的
            board = board_by_ch.get(ch.id)
            if not board:
                continue
            for n in nodes_by_board.get(board.id, []):
                node_map[n.character_id] = MergedNodeOut(
                    character_id=n.character_id, x=n.x, y=n.y, chapter_id=ch.id)
            for r in rels_by_board.get(board.id, []):
                rel_map[(r.from_character_id, r.to_character_id, r.relation_type_id)] = MergedRelationOut(
                    id=r.id, chapter_id=ch.id, chapter_title=ch.title,
                    from_character_id=r.from_character_id, to_character_id=r.to_character_id,
                    relation_type_id=r.relation_type_id, description=r.description)
            for s in states_by_ch.get(ch.id, []):
                state_map[s.character_id] = MergedStateOut(
                    character_id=s.character_id, chapter_id=ch.id,
                    alias=s.alias, role=s.role, status=s.status,
                    alive=s.alive_override, faction=s.faction_override or "")

        board_char_ids = set(node_map) | {c for k in rel_map for c in k[:2]}
        # 状态里也可能有未上板的人物（被移出但保留状态），一并取档案用于解析
        char_ids = board_char_ids | set(state_map)
        chars = session.scalars(select(Character).where(Character.id.in_(char_ids))).all() if char_ids else []
        char_by_id = {c.id: c for c in chars}

        def resolved_state(s: MergedStateOut) -> MergedStateOut:
            c = char_by_id.get(s.character_id)
            s.alive = s.alive if s.alive is not None else (c.alive if c else True)
            if not s.faction:
                s.faction = (c.faction if c else "") or ""
            return s

        out = MergedBoardOut(
            chapters=[ChapterOut.model_validate(c) for c in chapters],
            anchor_chapter_id=chapters[-1].id,
            nodes=list(node_map.values()),
            relations=list(rel_map.values()),
            characters=[CharacterOut.model_validate(c) for c in chars if c.id in board_char_ids],
            states=[resolved_state(s) for s in state_map.values()],
        )
        body = envelope_body(_dump(out))
        response_cache.cache_put(key, e0, body)
        return Response(content=body, media_type="application/json")
    return await run_db(_guard(_impl))


# ---- 聚合模式下的增量写入端点（单章模式仍走整板 PUT） ----

def _bump(board: Board) -> None:
    board.version += 1


@router.patch("/chapters/{chapter_id}/nodes/{character_id}")
async def update_node_position(game_id: int, chapter_id: int, character_id: int,
                               data: NodePositionUpdate):
    """聚合视图拖动结束：把位置写回该节点来源章节的看板（返回最新版本号供乐观锁）。"""
    def _impl():
        session = db.session
        board = get_board(session, game_id, chapter_id)
        node = session.scalars(select(BoardNode).where(
            BoardNode.board_id == board.id, BoardNode.character_id == character_id)).first()
        if not node:
            raise HTTPException(404, "该人物不在此章节看板上")
        node.x, node.y = data.x, data.y
        _bump(board)
        session.commit()
        response_cache.invalidate_game(game_id)
        return api_response({"ok": True, "version": board.version})
    return await run_db(_guard(_impl))


@router.post("/chapters/{chapter_id}/relations")
async def create_relation(game_id: int, chapter_id: int, data: RelationCreate):
    """在看板上创建单条关系；端点人物若不在看板则自动补入节点（可用坐标）。"""
    def _impl():
        session = db.session
        board = get_board(session, game_id, chapter_id)
        dup = session.scalars(select(ChapterRelation).where(
            ChapterRelation.board_id == board.id,
            ChapterRelation.from_character_id == data.from_character_id,
            ChapterRelation.to_character_id == data.to_character_id,
            ChapterRelation.relation_type_id == data.relation_type_id)).first()
        if dup:
            raise HTTPException(409, "该关系已存在于本章看板")

        offset = len(board.nodes)
        for cid, px, py in ((data.from_character_id, data.from_x, data.from_y),
                            (data.to_character_id, data.to_x, data.to_y)):
            char = session.get(Character, cid)
            if not char or char.game_id != game_id:
                raise HTTPException(404, f"人物 #{cid} 不存在")
            if any(n.character_id == cid for n in board.nodes):
                continue
            session.add(BoardNode(board_id=board.id, character_id=cid,
                                  x=px if px is not None else 80 + (offset % 4) * 330,
                                  y=py if py is not None else 80 + (offset // 4) * 220))
            offset += 1
            if not session.scalars(select(ChapterCharacter).where(
                    ChapterCharacter.chapter_id == chapter_id,
                    ChapterCharacter.character_id == cid)).first():
                session.add(ChapterCharacter(chapter_id=chapter_id, character_id=cid))

        rel = ChapterRelation(board_id=board.id, from_character_id=data.from_character_id,
                              to_character_id=data.to_character_id,
                              relation_type_id=data.relation_type_id, description=data.description)
        session.add(rel)
        _bump(board)
        session.commit()
        session.refresh(rel)
        response_cache.invalidate_game(game_id)
        return api_response(_dump(RelationOut(
            id=rel.id, board_id=rel.board_id, from_character_id=rel.from_character_id,
            to_character_id=rel.to_character_id, relation_type_id=rel.relation_type_id,
            description=rel.description, event_ids=list(rel.event_ids or []))))
    return await run_db(_guard(_impl))


@router.patch("/chapters/{chapter_id}/relations/{relation_id}")
async def update_relation(game_id: int, chapter_id: int, relation_id: int,
                          data: RelationDescriptionUpdate):
    def _impl():
        session = db.session
        rel = session.get(ChapterRelation, relation_id)
        board = get_board(session, game_id, chapter_id)
        if not rel or rel.board_id != board.id:
            raise HTTPException(404, "关系不存在")
        if data.description is not None:
            rel.description = data.description
        _bump(board)
        session.commit()
        response_cache.invalidate_game(game_id)
        return api_response({"ok": True})
    return await run_db(_guard(_impl))


@router.delete("/chapters/{chapter_id}/relations/{relation_id}")
async def delete_relation(game_id: int, chapter_id: int, relation_id: int):
    def _impl():
        session = db.session
        rel = session.get(ChapterRelation, relation_id)
        board = get_board(session, game_id, chapter_id)
        if not rel or rel.board_id != board.id:
            raise HTTPException(404, "关系不存在")
        session.delete(rel)
        _bump(board)
        session.commit()
        response_cache.invalidate_game(game_id)
        return api_response({"ok": True})
    return await run_db(_guard(_impl))
