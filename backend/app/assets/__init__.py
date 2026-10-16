"""Prompt 与 Skill 资产库能力。"""
from fastapi import APIRouter

from .routes import router as assets_router

router = APIRouter()
router.include_router(assets_router)

__all__ = ['router', 'ensure_migrations']


def ensure_migrations(engine):
    """幂等迁移：v1 建库无 archive 两列（f126af4），Skill 包功能引入后为存量库补列；
    assets_files 为新表由 create_all 建立。"""
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    if not insp.has_table('assets_items'):
        return
    cols = {c['name'] for c in insp.get_columns('assets_items')}
    blob_type = 'BYTEA' if engine.dialect.name == 'postgresql' else 'BLOB'
    with engine.begin() as conn:
        if 'archive' not in cols:
            conn.execute(text(f'ALTER TABLE assets_items ADD COLUMN archive {blob_type}'))
        if 'archive_name' not in cols:
            conn.execute(text('ALTER TABLE assets_items ADD COLUMN archive_name VARCHAR(200)'))
