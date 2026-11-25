"""密码库能力。"""
from .routes import router  # noqa: F401


def ensure_migrations(engine):
    """幂等补充分组目录列和性能索引。

    - ix_vault_items_trash_order      列表 WHERE deleted_at + ORDER BY updated_at
    - ix_vault_audit_logs_created_at  审计分页 ORDER BY created_at DESC
    CREATE INDEX IF NOT EXISTS 同时兼容 SQLite / PostgreSQL。
    """
    from sqlalchemy import inspect, text
    stmts = (
        'CREATE INDEX IF NOT EXISTS ix_vault_items_trash_order '
        'ON vault_items (deleted_at, updated_at)',
        'CREATE INDEX IF NOT EXISTS ix_vault_audit_logs_created_at '
        'ON vault_audit_logs (created_at)',
    )
    with engine.begin() as conn:
        if 'group_catalog' not in {col['name'] for col in inspect(conn).get_columns('vault_accounts')}:
            conn.execute(text('ALTER TABLE vault_accounts ADD COLUMN group_catalog TEXT'))
        for stmt in stmts:
            conn.execute(text(stmt))
