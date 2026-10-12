"""API Hub 能力包：异构上游 API 聚合 + 平台令牌 + 多级限流 + 一键探活 + OpenAPI 发布。

三契约：
- router：/api/apihub/**（管理端 + gw 网关）与顶级 /openapi/**（对外发布入口）合并挂载
- start_background：探活调度 daemon（TESTING 空转）
- ensure_migrations：apihub_apis 幂等补列（group1/group2/pub_name/doc_md，2026-10-12 OpenAPI 发布）
"""

from fastapi import APIRouter

from app.apihub.routes import openapi_router, probe_api
from app.apihub.routes import router as _apihub_router
from app.apihub.routes import start_apihub_loop as start_background

router = APIRouter()
router.include_router(_apihub_router)
router.include_router(openapi_router)

__all__ = ['router', 'start_background', 'probe_api', 'start_apihub_loop']


def ensure_migrations(engine):
    """init_db 钩子：存量 apihub_apis 补 OpenAPI 发布列（幂等，SQLite/PG 通用）。"""
    from sqlalchemy import inspect, text

    cols = {c['name'] for c in inspect(engine).get_columns('apihub_apis')}
    need = [('group1', 'VARCHAR(64)', "DEFAULT ''"),
            ('group2', 'VARCHAR(64)', "DEFAULT ''"),
            ('pub_name', 'VARCHAR(64)', "DEFAULT ''"),
            ('doc_md', 'TEXT', "DEFAULT ''")]
    with engine.begin() as conn:
        for name, typ, default in need:
            if name not in cols:
                conn.execute(text(f"ALTER TABLE apihub_apis ADD COLUMN {name} {typ} {default}"))
