"""API Hub 能力包：system → api 两维聚合 + 平台令牌 + 多级限流 + 一键探活。

三契约：
- router：/api/apihub/**（管理端 + gw 网关）
- start_background：探活调度 daemon（TESTING 空转）
- ensure_migrations：2026-10-17 重构迁移——上游(upstream)维度改名系统(system)；
  删除自注册的系统内部 API（doublog 系统/doublog-self 令牌）与 OpenAPI 发布列
"""

from fastapi import APIRouter

from app.apihub.routes import probe_api
from app.apihub.routes import router as _apihub_router
from app.apihub.routes import start_apihub_loop as start_background

router = APIRouter()
router.include_router(_apihub_router)

__all__ = ['router', 'start_background', 'probe_api', 'start_apihub_loop']

# 自注册体系（tools/apihub_register_self.py，已删除）留下的标识；
# 仅在旧列 group1 仍存在（= 老库首次迁移）时清理一次
_SELFREG_SYSTEM_SLUG = 'doublog'
_SELFREG_TOKEN_NAME = 'doublog-self'


def ensure_migrations(engine):
    """init_db 钩子：upstream → system 重构的幂等迁移（SQLite/PG 通用）。

    1. 表改名兜底 apihub_upstreams → apihub_systems（常规路径由 db.LEGACY_TABLE_MAP
       在 create_all 之前完成，这里兜住直接调用 ensure_migrations 的场景）；
    2. 列改名 *_upstream_id → system_id（apihub_apis / apihub_keys / apihub_call_logs）；
    3. 旧列 group1 仍存在 = 老库首次迁移：删除自注册的系统内部 API
       （doublog 系统及其 API/密钥/规则/日志 + doublog-self 令牌），随后 DROP
       OpenAPI 发布四列（group1/group2/pub_name/doc_md）——此后不再执行。
    """
    import logging
    from sqlalchemy import inspect, text

    log = logging.getLogger('doublog.apihub')
    insp = inspect(engine)

    def _cols(table):
        try:
            return {c['name'] for c in insp.get_columns(table)}
        except Exception:  # noqa: BLE001 - 表不存在
            return set()

    def _has(table):
        return insp.has_table(table)

    # ── 1) 表改名兜底 ──
    if _has('apihub_upstreams') and not _has('apihub_systems'):
        with engine.begin() as conn:
            conn.execute(text('ALTER TABLE apihub_upstreams RENAME TO apihub_systems'))
        log.info('apihub_upstreams 已改名 apihub_systems')

    # ── 2) 列改名 upstream_id → system_id ──
    for table in ('apihub_keys', 'apihub_apis', 'apihub_call_logs'):
        if 'upstream_id' in _cols(table) and 'system_id' not in _cols(table):
            with engine.begin() as conn:
                conn.execute(text(f'ALTER TABLE {table} RENAME COLUMN upstream_id TO system_id'))
            log.info('%s.upstream_id 已改名 system_id', table)

    # ── 3) 老库一次性清理自注册数据 + DROP OpenAPI 发布列 ──
    api_cols = _cols('apihub_apis')
    if 'group1' in api_cols:
        with engine.begin() as conn:
            sys_ids = text('SELECT id FROM apihub_systems WHERE slug = :slug') \
                .bindparams(slug=_SELFREG_SYSTEM_SLUG)
            ids = [r[0] for r in conn.execute(sys_ids)]
            if ids:
                conn.execute(text(
                    'DELETE FROM apihub_health_logs WHERE api_id IN '
                    '(SELECT id FROM apihub_apis WHERE system_id IN (SELECT id FROM apihub_systems WHERE slug = :slug))'
                ).bindparams(slug=_SELFREG_SYSTEM_SLUG))
                conn.execute(text(
                    'DELETE FROM apihub_rules WHERE api_id IN '
                    '(SELECT id FROM apihub_apis WHERE system_id IN (SELECT id FROM apihub_systems WHERE slug = :slug))'
                ).bindparams(slug=_SELFREG_SYSTEM_SLUG))
                conn.execute(text(
                    'DELETE FROM apihub_call_logs WHERE system_id IN '
                    '(SELECT id FROM apihub_systems WHERE slug = :slug)'
                ).bindparams(slug=_SELFREG_SYSTEM_SLUG))
                conn.execute(text(
                    'DELETE FROM apihub_apis WHERE system_id IN '
                    '(SELECT id FROM apihub_systems WHERE slug = :slug)'
                ).bindparams(slug=_SELFREG_SYSTEM_SLUG))
                conn.execute(text(
                    'DELETE FROM apihub_keys WHERE system_id IN '
                    '(SELECT id FROM apihub_systems WHERE slug = :slug)'
                ).bindparams(slug=_SELFREG_SYSTEM_SLUG))
                conn.execute(text(
                    'DELETE FROM apihub_systems WHERE slug = :slug'
                ).bindparams(slug=_SELFREG_SYSTEM_SLUG))
                log.info('已删除自注册系统 %s（%d 个）及其 API/密钥/日志',
                         _SELFREG_SYSTEM_SLUG, len(ids))
            # 自注册签发的平台令牌及其 token 级规则
            conn.execute(text(
                'DELETE FROM apihub_rules WHERE token_id IN '
                '(SELECT id FROM apihub_tokens WHERE name = :name)'
            ).bindparams(name=_SELFREG_TOKEN_NAME))
            conn.execute(text('DELETE FROM apihub_tokens WHERE name = :name')
                         .bindparams(name=_SELFREG_TOKEN_NAME))
        # DROP OpenAPI 发布四列（group1 已证实存在，其余列老库必带）；
        # 列清单用进入分支前的快照（Inspector 反射有缓存，改表后不重读）
        dropped = 0
        for col in ('group1', 'group2', 'pub_name', 'doc_md'):
            if col not in api_cols:
                continue
            try:
                with engine.begin() as conn:
                    conn.execute(text(f'ALTER TABLE apihub_apis DROP COLUMN {col}'))
                dropped += 1
            except Exception as e:  # noqa: BLE001 - 旧 SQLite(<3.35) 不支持 DROP COLUMN
                log.warning('DROP COLUMN apihub_apis.%s 失败（残留列不影响功能）: %s', col, e)
        if dropped:
            log.info('已删除 OpenAPI 发布列 %d 个', dropped)
