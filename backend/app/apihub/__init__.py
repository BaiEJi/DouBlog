"""API Hub 能力包：system → api 两维聚合 + 平台令牌 + 多级限流 + 一键探活。

三契约：
- router：/api/apihub/**（管理端 + gw 网关）
- start_background：探活调度 daemon（TESTING 空转）
- ensure_migrations：幂等迁移——2026-10-17 上游(upstream)→系统(system) 改名 +
  清理自注册残留与 OpenAPI 发布列；2026-10-17 密钥池→API 内联鉴权（auth_config
  明文 JSON 回填到每个 API，删 apihub_keys 表与系统 auth_config_enc 列）。
"""

from fastapi import APIRouter

from app.apihub.routes import probe_api
from app.apihub.routes import drain_background, stop_background
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
    """init_db 钩子：upstream → system 重构 + 密钥池 → API 内联鉴权的幂等迁移
    （SQLite/PG 通用）。

    1. 表改名兜底 apihub_upstreams → apihub_systems（常规路径由 db.LEGACY_TABLE_MAP
       在 create_all 之前完成，这里兜住直接调用 ensure_migrations 的场景）；
    2. 列改名 *_upstream_id → system_id（apihub_apis / apihub_keys / apihub_call_logs）；
    3. 旧列 group1 仍存在 = 老库首次迁移：删除自注册的系统内部 API
       （doublog 系统及其 API/密钥/规则/日志 + doublog-self 令牌），随后 DROP
       OpenAPI 发布四列（group1/group2/pub_name/doc_md）——此后不再执行；
    4. 密钥池 → API 内联鉴权（系统 auth_config_enc 列仍存在 = 待迁移）：
       apihub_apis 补 auth_config 列 → 逐 API 回填（系统鉴权配置 + 第一把启用
       key 的凭证解密合并）→ DROP apihub_keys 表 / 系统 auth_config_enc 列 /
       call_logs.key_id 列——此后不再执行。
    """
    import logging
    from sqlalchemy import inspect, text

    from app.apihub.core import load_crypto

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

    # ── 4) 密钥池 → API 内联鉴权（系统 auth_config_enc 列仍存在 = 待迁移） ──
    # 4a. 系统补 transport 列（create_all 不给存量表加列；auth_config_enc 已删的库也兜）
    if _has('apihub_systems') and 'transport' not in _cols('apihub_systems'):
        with engine.begin() as conn:
            conn.execute(text('ALTER TABLE apihub_systems ADD COLUMN transport JSON'))
        log.info('apihub_systems.transport 列已添加')

    if _has('apihub_systems') and 'auth_config_enc' in _cols('apihub_systems'):
        from sqlalchemy import Integer, JSON, column, table

        # 4b. 补 auth_config 列（create_all 已按新模型建好则跳过；直接跑迁移的老库补列）
        if 'auth_config' not in _cols('apihub_apis'):
            with engine.begin() as conn:
                conn.execute(text('ALTER TABLE apihub_apis ADD COLUMN auth_config JSON'))
            log.info('apihub_apis.auth_config 列已添加')

        # 4c. 回填：每个 API 的 auth_config = 系统 providers/credential_fields + 第一把
        #     启用 key 的凭证（解密合并成明文 JSON；无 key 的系统凭证留空，用户后续在
        #     API 表单补填）；旧 auth_config 里的 transport 回种到系统级 transport 列
        try:
            crypto = load_crypto()
        except Exception as e:  # noqa: BLE001 - 缺 key 文件等：跳过回填，仅清理结构
            log.warning('CryptoBox 不可用，跳过 auth_config 回填: %s', e)
            crypto = None
        backfilled = 0
        if crypto is not None:
            with engine.begin() as conn:
                sys_rows = conn.execute(text(
                    'SELECT id, auth_config_enc FROM apihub_systems')).all()
                sys_auth = {}
                for sid, enc in sys_rows:
                    try:
                        sys_auth[sid] = crypto.decrypt(bytes(enc))
                    except Exception:  # noqa: BLE001 - 单行解密失败不阻断其余
                        continue
                key_cred = {}   # system_id -> 第一把启用 key 的凭证
                if _has('apihub_keys'):
                    for kid_sid, kenc in conn.execute(text(
                            'SELECT system_id, credential_enc FROM apihub_keys '
                            'WHERE status = 1 ORDER BY id')).all():
                        if kid_sid in key_cred:
                            continue
                        try:
                            key_cred[kid_sid] = crypto.decrypt(bytes(kenc))
                        except Exception:  # noqa: BLE001
                            continue
                sys_tbl = table('apihub_systems', column('id', Integer),
                                column('transport', JSON))
                for sid, auth in sys_auth.items():
                    if auth.get('transport'):
                        conn.execute(sys_tbl.update().where(sys_tbl.c.id == sid)
                                     .values(transport=auth['transport']))
                api_tbl = table('apihub_apis', column('id', Integer), column('auth_config', JSON))
                for api_id, api_sid in conn.execute(text(
                        'SELECT id, system_id FROM apihub_apis '
                        'WHERE auth_config IS NULL')).all():
                    src_auth = sys_auth.get(api_sid) or {}
                    cfg = {k: src_auth[k] for k in ('providers', 'credential_fields') if k in src_auth}
                    cfg['credential'] = key_cred.get(api_sid) or {}
                    conn.execute(api_tbl.update().where(api_tbl.c.id == api_id)
                                 .values(auth_config=cfg))
                    backfilled += 1
        if backfilled:
            log.info('auth_config 回填完成：%d 个 API（凭证取自各系统第一把启用 key）', backfilled)

        # 4c. 删旧表/旧列（旧 SQLite<3.35 不支持 DROP COLUMN 时告警不阻断）
        with engine.begin() as conn:
            conn.execute(text('DROP TABLE IF EXISTS apihub_keys'))
        log.info('apihub_keys 表已删除（密钥池废弃，鉴权内联到 API）')
        for tbl, col in (('apihub_systems', 'auth_config_enc'), ('apihub_call_logs', 'key_id')):
            if col not in _cols(tbl):
                continue
            try:
                with engine.begin() as conn:
                    conn.execute(text(f'ALTER TABLE {tbl} DROP COLUMN {col}'))
                log.info('%s.%s 列已删除', tbl, col)
            except Exception as e:  # noqa: BLE001
                log.warning('DROP COLUMN %s.%s 失败（残留列不影响功能）: %s', tbl, col, e)
