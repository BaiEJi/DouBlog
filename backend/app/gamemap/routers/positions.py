"""Position-only batches: one transaction and one revision per changed board."""
import math

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, update

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.mutations import fingerprint, mutation_id, resource_lock, revision
from app.shared.response import api_response
from ..models import Board, BoardNode, Chapter, PositionMutation
from .. import cache
from ._base import _guard

router = APIRouter(prefix='/api/gamemap/games/{game_id}/boards',
                   dependencies=[Depends(require_basic)])


def _parse_boards(raw):
    if not isinstance(raw, list) or not 1 <= len(raw) <= 100:
        raise HTTPException(400, 'boards 必须为 1 至 100 个看板')
    seen = set()
    parsed = []
    total = 0
    for board in raw:
        if not isinstance(board, dict) or type(board.get('chapter_id')) is not int:
            raise HTTPException(400, 'chapter_id 格式错误')
        chapter_id = board['chapter_id']
        if chapter_id in seen:
            raise HTTPException(400, '章节重复')
        seen.add(chapter_id)
        expected = revision(board.get('revision'))
        if expected is None or expected < 1:
            raise HTTPException(400, '必须提供看板 revision')
        rows = board.get('positions')
        if not isinstance(rows, list) or not rows:
            raise HTTPException(400, 'positions 必须为非空数组')
        total += len(rows)
        if total > 10000:
            raise HTTPException(400, '一次最多保存 10000 个位置')
        nodes = []
        ids = set()
        for node in rows:
            if not isinstance(node, dict) or type(node.get('character_id')) is not int:
                raise HTTPException(400, 'character_id 格式错误')
            char_id = node['character_id']
            if char_id in ids:
                raise HTTPException(400, '人物位置重复')
            ids.add(char_id)
            for axis in ('x', 'y'):
                coordinate = node.get(axis)
                if (type(coordinate) not in (int, float) or not math.isfinite(coordinate)
                        or abs(coordinate) > 10000000):
                    raise HTTPException(400, '坐标必须为有限数值且绝对值不超过 10000000')
            nodes.append({'character_id': char_id, 'x': float(node['x']), 'y': float(node['y'])})
        parsed.append({'chapter_id': chapter_id, 'revision': expected, 'positions': nodes})
    return sorted(parsed, key=lambda item: item['chapter_id'])


def _save(game_id, raw, mid):
    boards = _parse_boards(raw)
    mid = mutation_id(mid)
    if mid is None:
        raise HTTPException(400, '必须提供 mutation_id')
    digest = fingerprint(boards)
    with resource_lock(('gamemap-board', game_id)):
        receipt = db.session.get(PositionMutation, (game_id, mid))
        if receipt:
            if receipt.request_hash != digest:
                raise HTTPException(409, 'mutation_id 已用于其他位置变更')
            return receipt.response
        chapter_ids = [item['chapter_id'] for item in boards]
        found = db.session.execute(select(Board.id, Board.chapter_id).join(
            Chapter, Chapter.id == Board.chapter_id).where(
                Chapter.game_id == game_id, Chapter.id.in_(chapter_ids))).all()
        ids = {chapter_id: board_id for board_id, chapter_id in found}
        if len(ids) != len(boards):
            raise HTTPException(404, '章节看板不存在')
        result = []
        for item in boards:
            board_id = ids[item['chapter_id']]
            nodes = db.session.scalars(select(BoardNode).where(BoardNode.board_id == board_id)).all()
            by_character = {node.character_id: node for node in nodes}
            if any(node['character_id'] not in by_character for node in item['positions']):
                raise HTTPException(404, '人物不在该章节看板上')
            changed = db.session.execute(update(Board).where(
                Board.id == board_id, Board.version == item['revision']).values(
                    version=Board.version + 1).execution_options(synchronize_session=False)).rowcount
            if changed != 1:
                db.session.rollback()
                raise HTTPException(409, '看板已更新，请保留布局后读取最新版本')
            for node in item['positions']:
                target = by_character[node['character_id']]
                target.x, target.y = node['x'], node['y']
            result.append({**item, 'revision': item['revision'] + 1,
                           'version': item['revision'] + 1})
        response = {'boards': result, 'mutation_id': mid}
        db.session.add(PositionMutation(game_id=game_id, mutation_id=mid,
                                        request_hash=digest, response=response))
        db.session.commit()
        cache.invalidate_game(game_id)
        return response


async def _body(request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, '请求体必须为 JSON 对象')
    if not isinstance(body, dict):
        raise HTTPException(400, '请求体必须为 JSON 对象')
    return body


@router.post('/positions/batch')
async def save_positions_batch(game_id: int, request: Request):
    body = await _body(request)
    return await run_db(_guard(lambda: api_response(_save(game_id, body.get('boards'), body.get('mutation_id')))))


@router.put('/chapters/{chapter_id}/positions')
async def save_positions(game_id: int, chapter_id: int, request: Request):
    body = await _body(request)
    def save():
        result = _save(game_id, [{'chapter_id': chapter_id, 'revision': body.get('revision'),
                                 'positions': body.get('positions')}], body.get('mutation_id'))
        return api_response({**result['boards'][0], 'mutation_id': result['mutation_id']})
    return await run_db(_guard(save))
