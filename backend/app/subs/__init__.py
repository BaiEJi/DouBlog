"""订阅管理能力（CrownFlow 迁移）：会员 / 订阅记录 / 分类 / 支出统计 / 到期提醒。"""
from .routes import router, start_daily_loop, stop_daily_loop


def start_background(app):
    """main.py 后台线程钩子：每日 10:00 支出摘要（app.state.testing 时空转）。"""
    start_daily_loop(app)


def stop_background(app, timeout=5):
    return stop_daily_loop(app, timeout)


drain_background = stop_background


def ensure_migrations(engine):
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    for table in ('subs_members', 'subs_subscriptions'):
        columns = {column['name'] for column in inspector.get_columns(table)}
        if 'revision' not in columns:
            with engine.begin() as connection:
                connection.execute(text(f'ALTER TABLE {table} ADD COLUMN revision INTEGER NOT NULL DEFAULT 1'))
