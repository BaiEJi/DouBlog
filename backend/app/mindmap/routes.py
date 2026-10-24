"""Authenticated mind-map HTTP contracts; heavy database work uses the SDK pool."""
import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from lizysdk.errors import NotFoundError

from app.db import run_db
from app.mindmap.models import MindMap, MindMapVersion
from app.mindmap import services
from app.mindmap.validation import MAX_REQUEST_BYTES, invalid, json_bytes, positive_int, validate_request_json
from app.shared.auth import request_username, require_basic
from app.shared.response import api_response
from app.shared.timestamps import _iso

router = APIRouter(prefix='/api/mindmap', tags=['mindmap'], dependencies=[Depends(require_basic)])


def _response(data=None, code=200, message='操作成功'):
    try:
        return api_response(data, code, message)
    except TypeError:
        # A valid native 128-level tree exceeds orjson's 254-container depth.
        # Keep the exact shared envelope for this rare boundary case.
        return Response(json_bytes({'success': 200 <= code < 300, 'code': code,
                                    'message': message, 'data': data}),
                        status_code=code, media_type='application/json')


async def _body(request):
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_REQUEST_BYTES:
            invalid('HTTP 请求体不能超过 10MiB + 32KiB', limit_bytes=MAX_REQUEST_BYTES)
        chunks.append(chunk)
    try:
        def reject_constant(value):
            raise ValueError(value)
        value = json.loads(b''.join(chunks).decode('utf-8'), parse_constant=reject_constant)
    except (ValueError, UnicodeDecodeError, RecursionError):
        invalid('请求必须是有效 UTF-8 JSON，不能含 NaN、Infinity 或循环引用')
    if not isinstance(value, dict):
        invalid('请求 JSON 必须是对象')
    validate_request_json(value)
    return value


def _context(request):
    return request_username(request), request.client.host if request.client else None


def _integer(params, key, default=None, maximum=None):
    raw = params.get(key)
    if raw is None:
        return default
    try:
        value = int(raw)
    except (ValueError, TypeError):
        invalid(f'{key} 必须是正整数', field=key)
    positive_int(value, key)
    if maximum is not None and value > maximum:
        invalid(f'{key} 不能超过 {maximum}', field=key)
    return value


def _paging(params):
    return _integer(params, 'page', 1), _integer(params, 'page_size', 20, 100)


async def _write(request, scope, fn):
    data = await _body(request)
    actor, ip = _context(request)

    def impl():
        status, result = services.mutation(scope, data, lambda: fn(data, actor, ip))
        return _response(result, status)
    return await run_db(impl)


@router.get('/maps')
async def list_maps(request: Request):
    """Paginated metadata only; filter by knowledge workspace, article, or title."""
    page, page_size = _paging(request.query_params)
    workspace_id = _integer(request.query_params, 'workspace_id')
    post_id = _integer(request.query_params, 'post_id')
    keyword = request.query_params.get('keyword', request.query_params.get('q', '')).strip()
    if len(keyword) > 200:
        invalid('keyword 不能超过 200 个字符')
    sort = request.query_params.get('sort', 'updated_desc')
    sorts = {
        'updated_desc': (MindMap.updated_at.desc(), MindMap.id.desc()),
        'created_desc': (MindMap.created_at.desc(), MindMap.id.desc()),
        'name_asc': (MindMap.name.asc(), MindMap.id.asc()),
    }
    if sort not in sorts:
        invalid('sort 必须为 updated_desc、created_desc 或 name_asc')

    def impl():
        query = MindMap.query.filter(MindMap.deleted.is_(False))
        if workspace_id is not None:
            services.associations(workspace_id)
            query = query.filter(MindMap.workspace_id == workspace_id)
        if post_id is not None:
            query = query.filter(MindMap.post_id == post_id)
        if keyword:
            term = keyword.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
            query = query.filter(MindMap.name.ilike(f'%{term}%', escape='\\'))
        total = query.count()
        # Do not load full JSON documents for the management list.
        from sqlalchemy.orm import defer
        rows = query.options(defer(MindMap.document)).order_by(*sorts[sort]).offset(
            (page - 1) * page_size).limit(page_size).all()
        return _response({'items': [row.to_dict(False) for row in rows], 'total': total,
                          'page': page, 'page_size': page_size,
                          'total_pages': (total + page_size - 1) // page_size})
    return await run_db(impl)


@router.post('/maps', status_code=201)
async def create_map(request: Request):
    """Create {name, workspace_id?, post_id?, document?, mutation_id}."""
    return await _write(request, 'create', services.create_map)


@router.post('/import')
async def import_map(request: Request):
    """Import {payload, mutation_id, target_id?, revision?, workspace_id?, post_id?}."""
    return await _write(request, 'import', services.import_map)


@router.get('/maps/{map_id}')
async def get_map(map_id: int):
    return await run_db(lambda: _response(services.require_map(map_id).to_dict()))


@router.patch('/maps/{map_id}')
async def patch_map(map_id: int, request: Request):
    """Patch metadata with mandatory revision + unique mutation_id."""
    return await _write(request, f'metadata:{map_id}',
                        lambda data, actor, ip: services.patch_map(map_id, data, actor, ip))


@router.delete('/maps/{map_id}')
async def delete_map(map_id: int, request: Request):
    """Delete {revision, mutation_id}; audit and retry receipts are retained."""
    return await _write(request, f'delete:{map_id}',
                        lambda data, actor, ip: services.delete_map(map_id, data, actor, ip))


@router.put('/maps/{map_id}/document')
async def save_document(map_id: int, request: Request):
    """Atomically save a complete native document with revision + mutation_id."""
    return await _write(request, f'document:{map_id}',
                        lambda data, actor, ip: services.save_document(map_id, data, actor, ip))


@router.post('/maps/{map_id}/duplicate')
async def duplicate_map(map_id: int, request: Request):
    return await _write(request, f'duplicate:{map_id}',
                        lambda data, actor, ip: services.duplicate_map(map_id, data, actor, ip))


@router.post('/maps/{map_id}/nodes/batch')
@router.post('/maps/{map_id}/operations', include_in_schema=False)
async def batch_nodes(map_id: int, request: Request):
    """Atomic {operations:[{op:add|update|delete|move,...}], revision, mutation_id}."""
    return await _write(request, f'nodes:{map_id}',
                        lambda data, actor, ip: services.batch_nodes(map_id, data, actor, ip))


@router.post('/maps/{map_id}/nodes')
async def add_node(map_id: int, request: Request):
    """Convenience add {node, parent_id, index?, revision, mutation_id}."""
    def action(data, actor, ip):
        merged = dict(data, operations=[{'op': 'add', 'node': data.get('node'),
                                        'parent_id': data.get('parent_id'), 'index': data.get('index')}])
        return services.batch_nodes(map_id, merged, actor, ip)
    return await _write(request, f'node-add:{map_id}', action)


@router.patch('/maps/{map_id}/nodes/{uid}')
async def update_node(map_id: int, uid: str, request: Request):
    """Convenience update {data, revision, mutation_id}; uid cannot change."""
    def action(data, actor, ip):
        return services.batch_nodes(map_id, dict(data, operations=[{
            'op': 'update', 'uid': uid, 'data': data.get('data')}]), actor, ip)
    return await _write(request, f'node-update:{map_id}:{uid}', action)


@router.delete('/maps/{map_id}/nodes/{uid}')
async def delete_node(map_id: int, uid: str, request: Request):
    def action(data, actor, ip):
        return services.batch_nodes(map_id, dict(data, operations=[{
            'op': 'delete', 'uid': uid}]), actor, ip)
    return await _write(request, f'node-delete:{map_id}:{uid}', action)


@router.get('/maps/{map_id}/export')
async def export_map(map_id: int):
    """Return the portable doublog.mindmap schema-v1 envelope in standard data."""
    return await run_db(lambda: _response(services.export_envelope(services.require_map(map_id))))


@router.get('/maps/{map_id}/versions')
async def list_versions(map_id: int, request: Request):
    page, page_size = _paging(request.query_params)

    def impl():
        services.require_map(map_id)
        query = MindMapVersion.query.filter_by(map_id=map_id)
        total = query.count()
        # JSON path extraction works on SQLite and PostgreSQL and avoids loading
        # twenty complete historical documents just to draw the version list.
        rows = query.with_entities(
            MindMapVersion.revision, MindMapVersion.action, MindMapVersion.actor,
            MindMapVersion.ip_address, MindMapVersion.created_at,
            MindMapVersion.snapshot['name'].as_string().label('name'),
            MindMapVersion.snapshot['workspace_id'].as_integer().label('workspace_id'),
            MindMapVersion.snapshot['post_id'].as_integer().label('post_id'),
            MindMapVersion.snapshot['node_count'].as_integer().label('node_count'),
        ).order_by(MindMapVersion.revision.desc()).offset(
            (page - 1) * page_size).limit(page_size).all()
        summaries = [{**dict(row._mapping), 'created_at': _iso(row.created_at)} for row in rows]
        return _response({'items': summaries, 'total': total,
                          'page': page, 'page_size': page_size,
                          'total_pages': (total + page_size - 1) // page_size})
    return await run_db(impl)


@router.get('/maps/{map_id}/versions/{revision}')
async def get_version(map_id: int, revision: int):
    positive_int(revision)
    def impl():
        services.require_map(map_id)
        row = MindMapVersion.query.filter_by(map_id=map_id, revision=revision).first()
        if row is None:
            raise NotFoundError(message='导图历史版本不存在')
        return _response(row.to_dict(True))
    return await run_db(impl)


@router.post('/maps/{map_id}/restore')
async def restore_map(map_id: int, request: Request):
    """Restore {version, revision, mutation_id}, appending a new immutable version."""
    return await _write(request, f'restore:{map_id}',
                        lambda data, actor, ip: services.restore_map(map_id, data, actor, ip))
