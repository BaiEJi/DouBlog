"""
配置中心 API：KV 配置浏览/读写 + Redis 缓存管理（全部 require_basic，Doublog 信封）。

值语义（读写约定）：
- type=str → data 原样字符串（"123" 就是字符串，不会被误判 JSON）
- type=json → data 为解析后的对象/数组/数字（信封内）
- PUT 同一 namespace+key 即整体覆盖（type 允许变更）；201 新建 / 200 覆盖
- DELETE 不存在 404

缓存：读单条先缓存后 DB 回填、写/删先落库再 DEL，详见 cache.py。

路由顺序注意：字面量路径（/namespaces /entries /cache/*）必须先于
/{namespace}/{key} 注册，否则会被两段参数路由吞掉。
"""

import json
import re
import time

from fastapi import APIRouter, Depends, Request
from sqlalchemy import bindparam, func, select
from sqlalchemy.exc import IntegrityError, OperationalError

from app.confcenter import cache
from app.confcenter.models import ConfEntry
from app.config import settings
from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.response import api_response
from app.shared.timestamps import _iso, _utcnow
from lizysdk.errors import NotFoundError, ParamError

router = APIRouter(prefix='/api/confcenter', tags=['confcenter'],
                   dependencies=[Depends(require_basic)])

#: namespace/key 字符白名单（防注入；: 允许——缓存键本身就以冒号分隔）
NAME_RE = re.compile(r'^[A-Za-z0-9_.:-]+$')
NAMESPACE_MAX = 100
KEY_MAX = 200
TYPES = ('str', 'json')

# ─── 数据访问层（Core 语句模块级缓存 + 引擎级连接）────────
# 性能注记：单条读写原为 ORM session.get/flush（每请求新 Session + 实体装配
# + rollback/remove 全套机制，实测约为裸 SQL 的 4-6 倍开销）。本模块是纯 KV
# 访问，改用 Core 表级语句（模块级构建一次，SQLAlchemy 编译缓存按语句对象
# 命中）+ engine 直连执行；仍在 run_db 池内运行，行为与信封语义完全不变。
# WHERE 全部走绑定参数（值永不拼进 SQL），路由层另有 NAME_RE 白名单双保险。

_TBL = ConfEntry.__table__

#: 单条读：{type, data, updated_at}
_GET_ROW = select(
    _TBL.c.type, _TBL.c.data, _TBL.c.updated_at,
).where(
    _TBL.c.namespace == bindparam('ns'),
    _TBL.c.key == bindparam('k'),
)

#: 覆盖写：rowcount=0 即不存在（免"先 SELECT 再 UPDATE"一个来回）
_UPDATE_ROW = _TBL.update().where(
    _TBL.c.namespace == bindparam('ns'),
    _TBL.c.key == bindparam('k'),
).values(
    type=bindparam('v_type'), data=bindparam('v_data'),
    updated_at=bindparam('v_at', type_=_TBL.c.updated_at.type),
)

#: 删除：rowcount=0 即不存在
_DELETE_ROW = _TBL.delete().where(
    _TBL.c.namespace == bindparam('ns'),
    _TBL.c.key == bindparam('k'),
)

#: namespaces 聚合（GROUP BY 下推数据库，不做内存聚合）
_NS_AGG = select(
    _TBL.c.namespace, func.count(),
).group_by(_TBL.c.namespace).order_by(_TBL.c.namespace)

#: entries 浏览取数（条件/分页动态拼，只取响应需要的 5 列，不装配 ORM 实体）
_ENTRY_COLS = (_TBL.c.namespace, _TBL.c.key, _TBL.c.type,
               _TBL.c.data, _TBL.c.updated_at)

#: SQLite 写锁竞争退避（WAL checkpoint 期短暂尖刺；busy_timeout 耗尽才到这里）
_LOCK_RETRY_DELAYS = (0.005, 0.02, 0.08, 0.3)


def _is_lock_conflict(exc: Exception) -> bool:
    return isinstance(exc, OperationalError) and 'database is locked' in str(
        getattr(exc, 'orig', '') or exc)


def _run_write(fn):
    """写事务执行器：锁竞争（OperationalError: database is locked）与并发建行
    撞主键（IntegrityError）短暂退避后整事务重试，其余异常原样抛出。

    旧实现对锁竞争直接 500（并发写同一热键时可复现）；重试窗口总上限约
    0.4s，远小于用户的忍耐阈值，且不阻塞读路径（读走独立连接）。
    """
    last = None
    for delay in _LOCK_RETRY_DELAYS:
        try:
            return fn()
        except (OperationalError, IntegrityError) as e:
            if not (_is_lock_conflict(e) or isinstance(e, IntegrityError)):
                raise
            last = e
            time.sleep(delay)
    raise last


def _row_payload(row) -> dict:
    """SELECT 行 → {type, data, updated_at} 载荷（与模型 payload() 同形）。"""
    return {'type': row[0], 'data': row[1], 'updated_at': _iso(row[2])}


async def _json_body(request: Request) -> dict:
    """`request.get_json(silent=True) or {}` 等价：坏 JSON/空体一律 {}。"""
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001
        return {}
    return data if isinstance(data, dict) else {}


def _arg_int(params, key: str, default=None):
    raw = params.get(key)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _client_value(entry_type: str, raw: str):
    """存储文本 → 客户端值：str 原样；json 解析（写时已校验，解析失败兜底回原文）。"""
    if entry_type == 'json':
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return raw
    return raw


def _entry_dict(namespace: str, key: str, payload: dict) -> dict:
    """单条响应：data 按解析后返回（str→字符串，json→结构）。"""
    return {
        'namespace': namespace,
        'key': key,
        'type': payload['type'],
        'data': _client_value(payload['type'], payload['data']),
        'updated_at': payload.get('updated_at'),
    }


# ─── 浏览（namespaces / entries）────────────────────────

@router.get('/namespaces')
async def list_namespaces():
    """distinct namespace + 每个 ns 的条目数（GROUP BY 聚合全部下推数据库）。"""
    def _q():
        with db.engine.connect() as conn:
            rows = conn.execute(_NS_AGG).all()
        return [{'namespace': ns, 'count': cnt} for ns, cnt in rows]
    return api_response(await run_db(_q))


@router.get('/entries')
async def list_entries(request: Request):
    """条目浏览：?namespace= 精确过滤（省略=全部）、?q= 模糊匹配 key、分页。

    count 直发 `SELECT count(*) ... WHERE`（旧 ORM Query.count 会把整条
    SELECT 包成子查询再数）；取数只查响应需要的 5 列，不装配 ORM 实体。
    """
    params = request.query_params
    namespace = (params.get('namespace') or '').strip() or None
    q = (params.get('q') or '').strip() or None
    page = max(1, _arg_int(params, 'page', 1) or 1)
    page_size = min(max(1, _arg_int(params, 'page_size', settings.default_page_size)
                        or settings.default_page_size), settings.max_page_size)

    def _q():
        conds = []
        if namespace:
            conds.append(_TBL.c.namespace == namespace)
        if q:
            conds.append(_TBL.c.key.contains(q, autoescape=True))
        with db.engine.connect() as conn:
            total = conn.execute(
                select(func.count()).select_from(_TBL).where(*conds)).scalar() or 0
            rows = conn.execute(
                select(*_ENTRY_COLS).where(*conds)
                .order_by(_TBL.c.namespace, _TBL.c.key)
                .offset((page - 1) * page_size).limit(page_size)
            ).all()
        items = [{'namespace': r[0], 'key': r[1], 'type': r[2],
                  'data': _client_value(r[2], r[3]), 'updated_at': _iso(r[4])}
                 for r in rows]
        return {
            'items': items,
            'total': total, 'page': page, 'page_size': page_size,
            'pages': (total + page_size - 1) // page_size,
        }
    return api_response(await run_db(_q))


# ─── Redis 缓存管理（系统配置页用；先于参数路由注册）──────

@router.get('/cache/status')
async def get_cache_status(request: Request):
    """缓存状态 {enabled, reachable, url_masked, hits, misses}——不可达时 enabled=false 不报错。"""
    state = cache.get_cache_state(request.app)
    return api_response(cache.cache_status(state))


@router.get('/cache/config')
async def get_cache_config(request: Request):
    """当前缓存配置（配置 Modal 回显用；单用户管理端，与 db_config 一致原样返回）。"""
    state = cache.get_cache_state(request.app)
    return api_response(dict(state.config))


@router.put('/cache/config')
async def put_cache_config(request: Request):
    """保存缓存配置 {enabled, host, port, db, password, ttl_seconds} → data/redis_config.json。"""
    state = cache.get_cache_state(request.app)
    body = await _json_body(request)
    try:
        cfg = cache.normalize_config(body, current=state.config)
    except ValueError as e:
        raise ParamError(message=str(e))
    cache.save_redis_config(cfg)
    state.apply_config(cfg)          # 快照更新 + 客户端作废（惰性重建）
    return api_response(cfg, 200, '缓存配置已保存')


@router.post('/cache/test')
async def test_cache_connection(request: Request):
    """用请求体配置（缺省=当前配置）即时 PING 测试连通；成功顺带自愈失败标记。"""
    state = cache.get_cache_state(request.app)
    body = await _json_body(request)
    cfg = state.config
    if body:
        try:
            cfg = cache.normalize_config(body, current=state.config)
        except ValueError as e:
            raise ParamError(message=str(e))
    ok, message = cache.test_connection(cfg)
    if ok:
        state.failed = False
    return api_response({'ok': ok, 'message': message})


@router.post('/cache/flush')
async def flush_cache(request: Request):
    """按前缀 SCAN+DEL 清理本模块缓存键（管理用）。"""
    state = cache.get_cache_state(request.app)
    ok, message, deleted = cache.cache_flush(state)
    return api_response({'ok': ok, 'deleted': deleted, 'message': message},
                        200, message if not ok else '缓存已清空')


# ─── 单条 CRUD（参数路由放最后）─────────────────────────

@router.get('/{namespace}/{key}')
async def get_entry(namespace: str, key: str, request: Request):
    """读单条：先缓存后 DB（未命中回填）；data 按解析后返回。"""
    def _read():
        state = cache.get_cache_state(request.app)
        payload = cache.cache_get(state, namespace, key)
        if payload is not None:
            return payload
        with db.engine.connect() as conn:
            row = conn.execute(_GET_ROW, {'ns': namespace, 'k': key}).first()
        if row is None:
            return None
        payload = _row_payload(row)
        cache.cache_put(state, namespace, key, payload)
        return payload

    payload = await run_db(_read)
    if payload is None:
        raise NotFoundError(message='配置项不存在')
    return api_response(_entry_dict(namespace, key, payload))


@router.put('/{namespace}/{key}')
async def put_entry(namespace: str, key: str, request: Request):
    """upsert {type:'str'|'json', data}：新建 201 / 整体覆盖 200（type 可变更）。"""
    if len(namespace) > NAMESPACE_MAX or not NAME_RE.match(namespace):
        raise ParamError(message='namespace 含非法字符（仅允许字母数字 _ . : -）')
    if len(key) > KEY_MAX or not NAME_RE.match(key):
        raise ParamError(message='key 含非法字符（仅允许字母数字 _ . : -）')

    body = await _json_body(request)
    entry_type = body.get('type')
    if entry_type not in TYPES:
        raise ParamError(message='type 只能是 str 或 json')
    if 'data' not in body:
        raise ParamError(message='缺少 data 字段')
    value = body['data']
    if entry_type == 'str':
        if not isinstance(value, str):
            raise ParamError(message='type=str 时 data 必须为字符串')
        stored = value
    elif isinstance(value, str):
        # json 文本（JsonArea 原样提交）：必须可 json.loads（"[1,2" 拒绝）
        try:
            json.loads(value)
        except ValueError:
            raise ParamError(message='type=json 时 data 必须是合法 JSON') from None
        stored = value
    else:
        # 结构化 JSON 值（对象/数组/数字）：本身即合法 JSON，规范文本入库
        try:
            stored = json.dumps(value, ensure_ascii=False)
        except (TypeError, ValueError):
            raise ParamError(message='type=json 时 data 必须是合法 JSON') from None

    def _upsert():
        state = cache.get_cache_state(request.app)
        now = _utcnow()

        def _attempt() -> bool:
            """单事务 upsert：UPDATE rowcount=0 → INSERT；返回是否新建。
            并发建同一新行时后者 INSERT 撞主键，由 _run_write 整事务重试。"""
            with db.engine.begin() as conn:
                r = conn.execute(_UPDATE_ROW, {'ns': namespace, 'k': key,
                                               'v_type': entry_type, 'v_data': stored,
                                               'v_at': now})
                if r.rowcount:
                    return False
                conn.execute(_TBL.insert().values(
                    namespace=namespace, key=key, type=entry_type,
                    data=stored, updated_at=now))
                return True

        created = _run_write(_attempt)
        payload = {'type': entry_type, 'data': stored, 'updated_at': _iso(now)}
        cache.cache_invalidate(state, namespace, key)   # 先落库再 DEL
        return created, payload

    created, payload = await run_db(_upsert)
    return api_response(_entry_dict(namespace, key, payload),
                        201 if created else 200,
                        '创建成功' if created else '更新成功')


@router.delete('/{namespace}/{key}')
async def delete_entry(namespace: str, key: str, request: Request):
    """删除单条：200；不存在 404。写路径同样先落库再 DEL 缓存。"""
    def _delete():
        state = cache.get_cache_state(request.app)

        def _attempt() -> int:
            with db.engine.begin() as conn:
                return conn.execute(_DELETE_ROW, {'ns': namespace, 'k': key}).rowcount

        found = _run_write(_attempt) > 0
        if found:
            cache.cache_invalidate(state, namespace, key)
        return found

    found = await run_db(_delete)
    if not found:
        raise NotFoundError(message='配置项不存在')
    return api_response({'namespace': namespace, 'key': key}, 200, '已删除')
