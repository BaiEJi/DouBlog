"""密码库能力。"""
from .routes import router  # noqa: F401


def ensure_migrations(engine):
    """幂等补建性能索引（存量库升级；新建库由 create_all 直接带上，此处 no-op）。

    - ix_vault_items_trash_order      列表 WHERE deleted_at + ORDER BY updated_at
    - ix_vault_audit_logs_created_at  审计分页 ORDER BY created_at DESC
    CREATE INDEX IF NOT EXISTS 同时兼容 SQLite / PostgreSQL。
    """
    from sqlalchemy import text
    stmts = (
        'CREATE INDEX IF NOT EXISTS ix_vault_items_trash_order '
        'ON vault_items (deleted_at, updated_at)',
        'CREATE INDEX IF NOT EXISTS ix_vault_audit_logs_created_at '
        'ON vault_audit_logs (created_at)',
    )
    with engine.begin() as conn:
        for stmt in stmts:
            conn.execute(text(stmt))
