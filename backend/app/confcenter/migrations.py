"""为已有 KV 补齐 namespace 记录；create_all 后调用，可重复执行。"""
from sqlalchemy import inspect, select, text

from .models import ConfEntry, ConfNamespace


def ensure_migrations(engine):
    namespaces = ConfNamespace.__table__
    entries = ConfEntry.__table__
    missing = select(entries.c.namespace).distinct().where(
        ~select(namespaces.c.namespace).where(
            namespaces.c.namespace == entries.c.namespace).exists())
    with engine.begin() as conn:
        inspector = inspect(conn)
        if inspector.has_table('confcenter_mcp_tokens') and 'module' not in {
                c['name'] for c in inspector.get_columns('confcenter_mcp_tokens')}:
            conn.execute(text("ALTER TABLE confcenter_mcp_tokens ADD COLUMN module VARCHAR(64) NOT NULL DEFAULT 'todo'"))
        conn.execute(namespaces.insert().from_select(['namespace'], missing))
