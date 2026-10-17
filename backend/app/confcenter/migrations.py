"""为已有 KV 补齐 namespace 记录；create_all 后调用，可重复执行。"""
from sqlalchemy import select

from .models import ConfEntry, ConfNamespace


def ensure_migrations(engine):
    namespaces = ConfNamespace.__table__
    entries = ConfEntry.__table__
    missing = select(entries.c.namespace).distinct().where(
        ~select(namespaces.c.namespace).where(
            namespaces.c.namespace == entries.c.namespace).exists())
    with engine.begin() as conn:
        conn.execute(namespaces.insert().from_select(['namespace'], missing))
