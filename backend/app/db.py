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
from contextlib import contextmanager
from contextvars import ContextVar
import hashlib
import json
import os
import threading
import time
import uuid
import weakref

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
    # apihub 2026-10-17 重构：upstream 维度改为 system（列级迁移见 app/apihub/__init__.py）
    'apihub_upstreams': 'apihub_systems',
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
    runtime = _runtime_context.get()
    return os.path.join(runtime.data_dir if runtime else settings.data_dir, DB_CONFIG_FILE)


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
    from app.shared.files import atomic_write_json
    atomic_write_json(db_config_path(), cfg)


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
    runtime = _runtime_context.get()
    return f'sqlite:///{os.path.join(runtime.data_dir if runtime else settings.data_dir, "blog.db")}'


# ─── 声明基类（自带 query 描述符，兼容 Model.query 写法）────

class _QueryProperty:
    """Model.query ≡ 当前线程 scoped session 的 query(Model)"""

    def __get__(self, obj, cls):
        return current_runtime().sessions.query(cls)


class Base(DeclarativeBase):
    query = _QueryProperty()


# ─── 引擎与 scoped session（init_db 时重建）──────────────

_engine = None
_session_registry = None   # scoped_session 实例
_default_runtime = None
_runtime_lock = threading.Lock()
_runtime_context = ContextVar('doublog_database_runtime', default=None)
_write_context = ContextVar('doublog_database_write', default=False)


class DatabaseRuntime:
    """An app owns its engine. Submitted work retains this exact generation."""

    def __init__(self, engine):
        self.engine = engine
        self.data_dir = settings.data_dir
        self.sessions = scoped_session(sessionmaker(bind=engine, expire_on_commit=False))
        self.generation = uuid.uuid4().hex
        # The identity excludes passwords and is opaque to clients.
        self.identity = hashlib.sha256(engine.url.render_as_string(hide_password=True)
                                       .encode()).hexdigest()[:24]
        self.condition = threading.Condition()
        self.pending = 0
        self.pending_writes = 0
        self.pending_controls = 0
        self.writes_paused = False
        self.admissions_paused = False
        self.closed = False
        self.caches = {}

    def admit(self, write=False, *, control=False):
        from fastapi import HTTPException
        with self.condition:
            if self.closed or self.admissions_paused or (write and self.writes_paused and not control):
                raise HTTPException(503, '数据库正在切换，请等待服务就绪后重试')
            if control:
                self.pending_controls += 1
            else:
                self.pending += 1
                self.pending_writes += int(write)

    def release(self, write=False, *, control=False):
        with self.condition:
            if control:
                self.pending_controls -= 1
            else:
                self.pending -= 1
                self.pending_writes -= int(write)
            self.condition.notify_all()

    def drain(self, timeout=5.0, writes_only=False, *, include_controls=False):
        deadline = time.monotonic() + timeout
        with self.condition:
            while (self.pending_writes if writes_only else self.pending) or (include_controls and self.pending_controls):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self.condition.wait(remaining)
            return True

    def snapshot(self):
        with self.condition:
            return {'identity': self.identity, 'generation': self.generation,
                    'running_backend': self.engine.url.get_backend_name().replace('postgresql', 'postgres'),
                    'pending_tasks': self.pending, 'pending_writes': self.pending_writes,
                    'pending_controls': self.pending_controls,
                    'pending_restart': self.writes_paused, 'closed': self.closed,
                    'admissions_paused': self.admissions_paused}


def current_runtime():
    runtime = _runtime_context.get() or _default_runtime
    if runtime is None:
        raise RuntimeError('Database is not initialized')
    return runtime


def runtime_binding():
    """Only explicit request/background bindings; no implicit default-app ticket."""
    return _runtime_context.get(), _write_context.get()


@contextmanager
def database_context(app_or_runtime, *, write=True):
    runtime = (app_or_runtime if isinstance(app_or_runtime, DatabaseRuntime)
               else app_or_runtime.state.db_runtime)
    token = _runtime_context.set(runtime)
    write_token = _write_context.set(write)
    try:
        yield runtime
    finally:
        _write_context.reset(write_token)
        _runtime_context.reset(token)


class _DbFacade:
    """兼容门面：旧代码 `from app.db import db` 后 db.session / db.engine 同义可用。

    db.session 即 scoped_session 本体（query/add/commit/rollback/get/remove）。
    """

    @property
    def engine(self):
        return current_runtime().engine

    @property
    def session(self):
        return current_runtime().sessions


db = _DbFacade()


def rebuild_engine(*, return_runtime=False):
    """按当前 db_config 重建引擎与 scoped session（测试/切换/启动时调用）"""
    global _engine, _session_registry, _default_runtime
    cfg = load_db_config()
    url = get_database_url(cfg)
    if cfg['backend'] == 'sqlite':
        os.makedirs(settings.data_dir, exist_ok=True)
        os.makedirs(settings.images_dir, exist_ok=True)
        opts = {'connect_args': {'check_same_thread': False}, 'pool_pre_ping': True}
    else:
        opts = {'pool_pre_ping': True, 'pool_size': 5, 'max_overflow': 10}
    engine = create_engine(url, **opts)
    runtime = DatabaseRuntime(engine)
    with _runtime_lock:
        _engine, _session_registry, _default_runtime = engine, runtime.sessions, runtime
    return runtime if return_runtime else engine


async def run_db(fn, *args, _pool=None, **kwargs):
    """把同步 DB 逻辑提交到共享 SDK 线程池（doublog-db）执行。

    清理（rollback + remove）必须在**池工作线程内**执行——scoped_session 按
    线程隔离，在等待方（事件循环线程）清理清不到工作线程的 session，读事务
    不 commit 时连接会滞留、高并发下耗尽连接池。
    """
    from app.shared.pools import DB_POOL
    from lizysdk.pools.exceptions import PoolRejectedError
    from fastapi import HTTPException

    runtime = current_runtime()
    write = _write_context.get()
    runtime.admit(write)

    def _task():
        with database_context(runtime, write=write):
            try:
                return fn(*args, **kwargs)
            finally:
                # rollback() proxies through registry() and would otherwise
                # allocate a Session for cache hits / Core-only work.
                if runtime.sessions.registry.has():
                    try:
                        runtime.sessions.rollback()
                    finally:
                        runtime.sessions.remove()

    try:
        fut = (_pool or DB_POOL).submit(_task)
    except BaseException as exc:
        runtime.release(write)
        if isinstance(exc, PoolRejectedError):
            raise HTTPException(503, '数据库工作队列繁忙，请稍后重试') from exc
        raise
    # Callback also covers tasks cancelled while still queued.
    fut.add_done_callback(lambda completed: runtime.release(write))
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
    """初始化数据库：存量表改名 → 建表 → 模块级幂等迁移 → 播种虚拟根。

    模块迁移钩子：app/<mod>/ 包可定义 ``ensure_migrations(engine)``（列级
    幂等 ALTER），本函数在改名之后逐模块调用。
    """
    # App construction must not inherit a caller's existing app/database scope.
    # In particular, create_app() nested in an HTTP/background context must read
    # the new settings directory and run every migration against the new engine.
    context_token = _runtime_context.set(None)
    try:
        runtime = rebuild_engine(return_runtime=True)
    finally:
        _runtime_context.reset(context_token)
    app.state.db_runtime = runtime
    with database_context(runtime):
        return _initialize_runtime_schema(app, runtime)


def _initialize_runtime_schema(app, runtime):
    import importlib
    import logging
    engine = runtime.engine

    # 存量表改名必须**先于** create_all：模型已注册时 create_all 会先建出
    # 全新空的新名表，RENAME 因「新表已存在」被跳过 → 存量数据滞留旧表
    renamed = _rename_legacy_tables(engine)
    if renamed:
        logging.getLogger('doublog.db').info('存量表改名: ' + ', '.join(renamed))

    Base.metadata.create_all(engine)

    from app.shared.modules import MODULES_WITH_DB
    for mod in MODULES_WITH_DB:
        m = importlib.import_module(f'app.{mod}')
        hook = getattr(m, 'ensure_migrations', None)
        if callable(hook):
            hook(engine)

    seed_virtual_root(engine)

    if engine.url.get_backend_name() == 'sqlite':
        # WAL 是文件级持久属性：必须在无并发窗口一次性设置并校验
        # （并发下切换会静默失败回 delete 模式 → 读写互斥锁死）
        with engine.connect() as conn:
            mode = conn.exec_driver_sql('PRAGMA journal_mode=WAL').scalar()
        if str(mode).lower() != 'wal':
            raise RuntimeError(f'无法启用 WAL 模式（当前 {mode}）——检查磁盘/文件系统支持')
        _set_sqlite_pragma(engine)

    app.state.engine = engine
    weakref.finalize(app, engine.dispose)
    return engine
