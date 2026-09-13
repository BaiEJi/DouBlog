"""
Flask-SQLAlchemy 扩展初始化

支持 SQLite 与 PostgreSQL 双后端，运行时由 data/db_config.json 决定：
- {"backend": "sqlite"}                          → <data_dir>/blog.db
- {"backend": "postgres", "postgres": {...}}     → postgresql+psycopg2://...

切换由 /api/admin/database/switch 完成（含数据迁移），见 app/api/admin.py。
"""

import json
import os
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event
from app.config import settings

db = SQLAlchemy()

DB_CONFIG_FILE = 'db_config.json'
SUPPORTED_BACKENDS = ('sqlite', 'postgres')


def _default_db_config() -> dict:
    return {
        'backend': settings.database_backend,
        'postgres': {
            'host': settings.postgres_host,
            'port': settings.postgres_port,
            'user': settings.postgres_user,
            'password': settings.postgres_password,
            'dbname': settings.postgres_dbname,
        },
    }


def db_config_path() -> str:
    return os.path.join(settings.data_dir, DB_CONFIG_FILE)


def load_db_config() -> dict:
    """
    读取数据库后端配置（data/db_config.json），文件缺失/损坏时回退默认值
    """
    cfg = _default_db_config()
    path = db_config_path()
    if os.path.isfile(path):
        try:
            with open(path, encoding='utf-8') as f:
                stored = json.load(f)
            if stored.get('backend') in SUPPORTED_BACKENDS:
                cfg['backend'] = stored['backend']
            if isinstance(stored.get('postgres'), dict):
                cfg['postgres'].update({k: v for k, v in stored['postgres'].items() if v is not None})
        except (json.JSONDecodeError, OSError):
            pass
    return cfg


def save_db_config(cfg: dict):
    """持久化数据库后端配置（切换接口调用）"""
    os.makedirs(settings.data_dir, exist_ok=True)
    with open(db_config_path(), 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def get_database_url(cfg: dict | None = None) -> str:
    """
    根据配置生成 SQLAlchemy 连接串

    Args:
        cfg: load_db_config() 的结果；缺省时现场读取

    Returns:
        str: SQLAlchemy URI
    """
    cfg = cfg or load_db_config()
    if cfg['backend'] == 'postgres':
        pg = cfg['postgres']
        from urllib.parse import quote_plus
        return (
            f"postgresql+psycopg2://{quote_plus(pg['user'])}:{quote_plus(str(pg.get('password', '')))}"
            f"@{pg['host']}:{pg['port']}/{pg['dbname']}"
        )
    return f'sqlite:///{os.path.join(settings.data_dir, "blog.db")}'


def seed_virtual_root(session_or_engine=None):
    """
    播种虚拟根节点（id=0）。

    树形排序依赖 id=0 的根行，缺失时 /api/posts/tree 会 500。
    可在 Flask app context 中传 db.session，或传 engine（迁移目标库场景）。
    """
    if session_or_engine is None:
        from app.models.models import Post
        if not db.session.query(Post.id).filter(Post.id == 0).first():
            db.session.add(Post(
                id=0, title='__root__', name='__root__', slug='',
                content='', parent_id=None, level=-1, author='system',
            ))
            db.session.commit()
        return

    # 迁移目标库：用 Core 直接操作，不依赖 app context
    from sqlalchemy import text
    from app.models.models import Post
    with session_or_engine.connect() as conn:
        exists = conn.execute(text('SELECT 1 FROM posts WHERE id = 0')).first()
        if not exists:
            conn.execute(Post.__table__.insert().values(
                id=0, title='__root__', name='__root__', slug='',
                content='', parent_id=None, level=-1, author='system',
            ))
            conn.commit()


def init_db(app):
    """
    初始化数据库扩展

    - 依据 data/db_config.json 选择 SQLite / PostgreSQL
    - SQLite：WAL + busy_timeout（单文件嵌入式库的并发写兜底）
    - PostgreSQL：标准连接池
    - 建表并播种虚拟根节点（幂等）
    """
    cfg = load_db_config()
    database_url = get_database_url(cfg)

    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SQLALCHEMY_ECHO'] = False

    if cfg['backend'] == 'sqlite':
        os.makedirs(settings.data_dir, exist_ok=True)
        os.makedirs(settings.images_dir, exist_ok=True)
        app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
            'connect_args': {'check_same_thread': False},
            'pool_pre_ping': True,
        }
    else:
        app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
            'pool_pre_ping': True,
            'pool_size': 5,
            'max_overflow': 10,
        }

    db.init_app(app)

    with app.app_context():
        db.create_all()
        _ensure_workspace_migration()
        seed_virtual_root()

        # SQLite 专属 PRAGMA（每次新连接时执行）
        if db.engine.url.get_backend_name() == 'sqlite':
            _set_sqlite_pragma(db.engine)

    return db


def _ensure_workspace_migration():
    """
    知识库（Workspace）幂等迁移：

    1. 存量库的 posts 表缺 workspace_id 列 → ALTER TABLE 补列（create_all 不会改已有表）
    2. 无任何知识库 → 创建"默认知识库"
    3. 存量文章 workspace_id 为空 → 全部归入默认知识库
    4. 把虚拟根(id=0)的顶级文章顺序拷贝给默认知识库（首次升级时的顺序保留）
    """
    from sqlalchemy import inspect, text
    from app.models.models import Post, Workspace

    engine = db.engine

    # 1. 补列（sqlite/pg 同语法）
    inspector = inspect(engine)
    post_columns = {c['name'] for c in inspector.get_columns('posts')}
    if 'workspace_id' not in post_columns:
        with engine.begin() as conn:
            conn.execute(text('ALTER TABLE posts ADD COLUMN workspace_id INTEGER'))
        index_name = 'ix_posts_workspace_id'
        existing_indexes = {ix['name'] for ix in inspector.get_indexes('posts')}
        if index_name not in existing_indexes:
            with engine.begin() as conn:
                conn.execute(text(f'CREATE INDEX {index_name} ON posts (workspace_id)'))

    # 最近浏览时间列（幂等）
    if 'last_viewed_at' not in post_columns:
        with engine.begin() as conn:
            conn.execute(text('ALTER TABLE posts ADD COLUMN last_viewed_at TIMESTAMP'))

    with engine.begin() as conn:
        # 2. 默认知识库
        ws_count = conn.execute(text('SELECT COUNT(*) FROM workspaces')).scalar() or 0
        if ws_count == 0:
            root_order = conn.execute(
                text('SELECT children_order FROM posts WHERE id = 0')
            ).scalar()
            conn.execute(Workspace.__table__.insert().values(
                name='默认知识库',
                children_order=root_order,
            ))

        # 3. 回填归属
        default_ws_id = conn.execute(
            text('SELECT MIN(id) FROM workspaces')
        ).scalar()
        conn.execute(text(
            'UPDATE posts SET workspace_id = :ws_id WHERE workspace_id IS NULL'
        ).bindparams(ws_id=default_ws_id))


def _set_sqlite_pragma(engine):
    """SQLite 连接初始化：WAL + NORMAL synchronous + busy timeout"""

    @event.listens_for(engine, "connect")
    def _pragma_on_connect(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()
