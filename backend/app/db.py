"""
SQLAlchemy 2.0 数据层（FastAPI 版）

支持 SQLite 与 PostgreSQL 双后端，运行时由 data/db_config.json 决定：
- {"backend": "sqlite"}                          → <data_dir>/blog.db
- {"backend": "postgres", "postgres": {...}}     → postgresql+psycopg2://...

表名规范：模块名_表名（见 LEGACY_TABLE_MAP）；存量库启动时幂等改名。
会话模型：scoped_session（线程本地）+ run_db()（请求的 DB 逻辑统一经共享
SDK 线程池执行，任务结束 rollback+remove）。
"""

import asyncio
import json
import os

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, scoped_session, sessionmaker

from app.config import settings

DB_CONFIG_FILE = 'db_config.json'
SUPPORTED_BACKENDS = ('sqlite', 'postgres')

# 存量表名 → 规范表名（模块名_表名）；启动时旧存在且新不存在则 RENAME
LEGACY_TABLE_MAP = {
    'posts': 'blog_posts',
    'workspaces': 'blog_workspaces',
    'audit_logs': 'blog_audit_logs',
    'diaries': 'diary_diaries',
    'sdk_logs': 'sdklogs_logs',
    'sdk_alerts': 'sdklogs_alerts',
}


# ─── 配置（data/db_config.json）──────────────────────────

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
    """读取数据库后端配置（data/db_config.json），文件缺失/损坏时回退默认值"""
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
    """根据配置生成 SQLAlchemy 连接串"""
    cfg = cfg or load_db_config()
    if cfg['backend'] == 'postgres':
        pg = cfg['postgres']
        from urllib.parse import quote_plus
        return (
            f"postgresql+psycopg2://{quote_plus(pg['user'])}:{quote_plus(str(pg.get('password', '')))}"
            f"@{pg['host']}:{pg['port']}/{pg['dbname']}"
        )
    return f'sqlite:///{os.path.join(settings.data_dir, "blog.db")}'


# ─── 声明基类（自带 query 描述符，兼容 Model.query 写法）────

class _QueryProperty:
    """Model.query ≡ 当前线程 scoped session 的 query(Model)"""

    def __get__(self, obj, cls):
        return _session_registry.query(cls)


class Base(DeclarativeBase):
    query = _QueryProperty()


# ─── 引擎与 scoped session（init_db 时重建）──────────────

_engine = None
_session_registry = None   # scoped_session 实例


class _DbFacade:
    """兼容门面：旧代码 `from app.db import db` 后 db.session / db.engine 同义可用。

    db.session 即 scoped_session 本体（query/add/commit/rollback/get/remove）。
    """

    @property
    def engine(self):
        return _engine

    @property
    def session(self):
        return _session_registry


db = _DbFacade()


def rebuild_engine():
    """按当前 db_config 重建引擎与 scoped session（测试/切换/启动时调用）"""
    global _engine, _session_registry
    if _engine is not None:
        _engine.dispose()
    cfg = load_db_config()
    url = get_database_url(cfg)
    if cfg['backend'] == 'sqlite':
        os.makedirs(settings.data_dir, exist_ok=True)
        os.makedirs(settings.images_dir, exist_ok=True)
        opts = {'connect_args': {'check_same_thread': False}, 'pool_pre_ping': True}
    else:
        opts = {'pool_pre_ping': True, 'pool_size': 5, 'max_overflow': 10}
    _engine = create_engine(url, **opts)
    _session_registry = scoped_session(sessionmaker(bind=_engine, expire_on_commit=False))
    return _engine


async def run_db(fn, *args, **kwargs):
    """把同步 DB 逻辑提交到共享 SDK 线程池（doublog-db）执行。

    清理（rollback + remove）必须在**池工作线程内**执行——scoped_session 按
    线程隔离，在等待方（事件循环线程）清理清不到工作线程的 session，读事务
    不 commit 时连接会滞留、高并发下耗尽连接池。
    """
    from app.shared.pools import DB_POOL

    def _task():
        try:
            return fn(*args, **kwargs)
        finally:
            if _session_registry is not None:
                try:
                    _session_registry.rollback()
                finally:
                    _session_registry.remove()

    fut = DB_POOL.submit(_task)
    return await asyncio.wrap_future(fut)


# ─── 启动初始化（create_app 内调用）──────────────────────

def _rename_legacy_tables(engine):
    """存量表名 → 规范表名（幂等：旧存在且新不存在才 RENAME）"""
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    renamed = []
    for old, new in LEGACY_TABLE_MAP.items():
        if old in tables and new not in tables:
            with engine.begin() as conn:
                conn.execute(text(f'ALTER TABLE {old} RENAME TO {new}'))
            renamed.append(f'{old}->{new}')
    return renamed


def seed_virtual_root(engine):
    """播种虚拟根节点（id=0）。树形排序依赖 id=0 的根行，缺失时 /api/posts/tree 会 500。"""
    from app.blog.models import Post
    with engine.connect() as conn:
        exists = conn.execute(text('SELECT 1 FROM blog_posts WHERE id = 0')).first()
        if not exists:
            conn.execute(Post.__table__.insert().values(
                id=0, title='__root__', name='__root__', slug='',
                content='', parent_id=None, level=-1, author='system',
            ))
            conn.commit()


def _set_sqlite_pragma(engine):
    """SQLite 连接初始化（每连接生效的 PRAGMA；journal_mode=WAL 在 init 时一次设置）"""

    @event.listens_for(engine, 'connect')
    def _pragma_on_connect(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA cache_size=-20000")     # 20MB 页缓存
        cursor.execute("PRAGMA temp_store=MEMORY")
        cursor.close()


def init_db(app):
    """初始化数据库：建表 → 存量表改名 → 模块级幂等迁移 → 播种虚拟根。

    模块迁移钩子：app/<mod>/ 包可定义 ``ensure_migrations(engine)``（列级
    幂等 ALTER），本函数在改名之后逐模块调用。
    """
    import importlib
    import logging

    engine = rebuild_engine()

    # 存量表改名必须**先于** create_all：模型已注册时 create_all 会先建出
    # 全新空的新名表，RENAME 因「新表已存在」被跳过 → 存量数据滞留旧表
    renamed = _rename_legacy_tables(engine)
    if renamed:
        logging.getLogger('doublog.db').info('存量表改名: ' + ', '.join(renamed))

    Base.metadata.create_all(engine)

    from app.shared.modules import MODULES_WITH_DB
    for mod in MODULES_WITH_DB:
        try:
            m = importlib.import_module(f'app.{mod}')
        except Exception:  # noqa: BLE001 - 未迁移模块（Flask 残码）跳过
            continue
        hook = getattr(m, 'ensure_migrations', None)
        if callable(hook):
            hook(engine)

    try:
        seed_virtual_root(engine)
    except Exception:  # noqa: BLE001 - blog 模块未注册（中间态）时无 Post 模型
        pass

    if engine.url.get_backend_name() == 'sqlite':
        # WAL 是文件级持久属性：必须在无并发窗口一次性设置并校验
        # （并发下切换会静默失败回 delete 模式 → 读写互斥锁死）
        with engine.connect() as conn:
            mode = conn.exec_driver_sql('PRAGMA journal_mode=WAL').scalar()
        if str(mode).lower() != 'wal':
            raise RuntimeError(f'无法启用 WAL 模式（当前 {mode}）——检查磁盘/文件系统支持')
        _set_sqlite_pragma(engine)

    app.state.engine = engine
    return engine
