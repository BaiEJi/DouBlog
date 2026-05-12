"""
Flask-SQLAlchemy 扩展初始化

使用 Flask-SQLAlchemy 替代手动的 SQLAlchemy engine + session 管理。
- db.session 自动 scoped 到 Flask app context，请求结束时自动清理
- 无需手动 close_db / teardown_appcontext
- PRAGMA 设置通过 SQLAlchemy event listener
"""

import os
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event
from app.config import settings

db = SQLAlchemy()


def init_db(app):
    """
    初始化数据库扩展
    
    配置:
    - SQLite with WAL mode for concurrent read/write
    - NORMAL synchronous (balance safety & performance)
    - busy_timeout to handle lock contention
    - Composite index on (level, order) for tree queries
    """
    database_url = f'sqlite:///{os.path.join(settings.data_dir, "blog.db")}'
    
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SQLALCHEMY_ECHO'] = False
    
    # SQLite engine options — WAL 模式下支持大量并发读
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        'connect_args': {'check_same_thread': False},
        'pool_pre_ping': True,
        'pool_size': 50,
        'max_overflow': 100,
    }
    
    os.makedirs(settings.data_dir, exist_ok=True)
    os.makedirs(settings.images_dir, exist_ok=True)
    
    db.init_app(app)
    
    with app.app_context():
        db.create_all()
        
        # 设置 SQLite PRAGMA（每次新连接时执行）
        _set_sqlite_pragma(db.engine)
    
    return db


def _set_sqlite_pragma(engine):
    """SQLite 连接初始化：WAL + NORMAL synchronous + busy timeout + 索引"""
    
    @event.listens_for(engine, "connect")
    def _pragma_on_connect(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_posts_level_order ON posts (level, \"order\")"
        )
        cursor.close()
