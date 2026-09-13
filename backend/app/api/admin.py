"""
管理 API：数据库后端管理（SQLite / PostgreSQL 双后端切换）

- GET  /api/admin/database          当前状态（后端、连接配置、数据量）
- POST /api/admin/database/test     测试目标后端连通性（不切换）
- POST /api/admin/database/switch   切换后端连接（不迁移数据）

切换语义：只更换连接配置（data/db_config.json）并重启生效，直接读取目标库的
现有数据（空库会自动建表并播种默认知识库/虚拟根）。两侧数据互不影响，
随时可切回。开发模式自动重启（exit code 3 触发 Werkzeug reloader），
生产模式返回 restart_required。
"""

import logging
import os
import threading
from urllib.parse import quote_plus

from flask import Blueprint, request
from sqlalchemy import create_engine, text

from app.api.auth import auth
from app.config import settings
from app.db import db, load_db_config, save_db_config, get_database_url, SUPPORTED_BACKENDS
from app.utils.response import api_response

bp = Blueprint('admin', __name__, url_prefix='/api/admin')

logger = logging.getLogger(__name__)

# 防并发切换
_switch_lock = threading.Lock()


def _pg_connection_url(pg: dict) -> str:
    return (
        f"postgresql+psycopg2://{quote_plus(pg['user'])}:{quote_plus(str(pg.get('password', '')))}"
        f"@{pg['host']}:{pg['port']}/{pg['dbname']}"
    )


def _merged_cfg(target: str, overrides: dict | None) -> dict:
    """以当前存储配置为基础，合并请求体中的 postgres 连接覆盖项"""
    cfg = load_db_config()
    cfg['backend'] = target
    if target == 'postgres' and isinstance(overrides, dict):
        for key in ('host', 'port', 'user', 'password', 'dbname'):
            if overrides.get(key) not in (None, ''):
                cfg['postgres'][key] = overrides[key]
    return cfg


def _try_connect(url: str, timeout: int = 3):
    """尝试连接，返回 (engine|None, error_message|None)"""
    connect_args = {}
    if url.startswith('postgresql'):
        connect_args['connect_timeout'] = timeout
    try:
        engine = create_engine(url, connect_args=connect_args)
        with engine.connect():
            pass
        return engine, None
    except Exception as e:  # noqa: BLE001 - 连接错误统一上报给前端
        return None, str(e).split('\n')[0]


def _ensure_postgres_database(pg: dict) -> str | None:
    """
    目标库不存在时自动创建（连接 postgres 系统库执行 CREATE DATABASE）。
    返回错误消息或 None。
    """
    engine, err = _try_connect(_pg_connection_url(pg))
    if err is None:
        return None

    if 'does not exist' not in err.lower() and '不存在' not in err:
        return err

    admin_url = _pg_connection_url({**pg, 'dbname': 'postgres'})
    admin_engine, admin_err = _try_connect(admin_url)
    if admin_err:
        return admin_err
    try:
        with admin_engine.connect().execution_options(isolation_level='AUTOCOMMIT') as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {'name': pg['dbname']}
            ).first()
            if not exists:
                conn.execute(text(f'CREATE DATABASE "{pg["dbname"]}"'))
    except Exception as e:  # noqa: BLE001
        return str(e).split('\n')[0]
    finally:
        admin_engine.dispose()

    # 创建后重试
    _, retry_err = _try_connect(_pg_connection_url(pg))
    return retry_err


def _request_reload_after_response():
    """
    开发模式（Werkzeug reloader 子进程）下触发自动重启：
    touch 被 reloader 监听的 app/_reload_stamp.py（与编辑源码触发的重启同一机制，
    比 os._exit 自杀式退出可靠——后者在部分平台上会与请求线程竞争导致重启丢失）。
    放在延时线程中确保响应先送达。
    """
    def _worker():
        threading.Event().wait(1.0)
        stamp = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_reload_stamp.py')
        try:
            with open(stamp, 'a', encoding='utf-8') as f:
                f.write(f'# reload {os.getpid()}\n')
            logger.info('Database switched, dev-server reload triggered via stamp file')
        except OSError as e:
            logger.error(f'Failed to trigger reload: {e}')

    threading.Thread(target=_worker, daemon=True).start()


@bp.route('/database', methods=['GET'])
@auth.login_required
def database_status():
    """当前数据库后端状态"""
    cfg = load_db_config()
    with db.engine.connect() as conn:
        # 文章数不含虚拟根（id=0）
        posts = conn.execute(text('SELECT COUNT(*) FROM posts WHERE id != 0')).scalar() or 0
        audits = conn.execute(text('SELECT COUNT(*) FROM audit_logs')).scalar() or 0
    return api_response({
        'backend': cfg['backend'],
        'database_url_masked': get_database_url(cfg).split('@')[-1] if cfg['backend'] == 'postgres' else get_database_url(cfg),
        'data_dir': settings.data_dir,
        'postgres': cfg['postgres'],
        'counts': {'posts': posts, 'audit_logs': audits},
        'running_under_reloader': bool(os.environ.get('WERKZEUG_RUN_MAIN')),
    })


@bp.route('/database/test', methods=['POST'])
@auth.login_required
def database_test():
    """
    测试目标后端连通性（不切换）

    请求体：{"target": "postgres"|"sqlite", "postgres": {"host","port","user","password","dbname"}}
    """
    data = request.get_json() or {}
    target = data.get('target')
    if target not in SUPPORTED_BACKENDS:
        return api_response(None, 400, 'target 必须是 sqlite 或 postgres')

    if target == 'sqlite':
        return api_response({'ok': True, 'message': 'SQLite 本地文件可用'})

    cfg = _merged_cfg(target, data.get('postgres'))
    url = _pg_connection_url(cfg['postgres'])
    engine, err = _try_connect(url)
    if engine:
        version = ''
        try:
            with engine.connect() as conn:
                version = (conn.execute(text('SELECT version()')).scalar() or '')[:40]
        finally:
            engine.dispose()
        return api_response({'ok': True, 'message': f'连接成功 {version}'})

    # 目标库可能只是不存在——单独探测并报告，便于前端提示"切换时会自动创建"
    created_check = _ensure_postgres_database(cfg['postgres'])
    if created_check is None:
        return api_response({'ok': True, 'message': '连接成功（已自动创建数据库）'})
    return api_response(None, 400, f'连接失败：{err}')


@bp.route('/database/switch', methods=['POST'])
@auth.login_required
def database_switch():
    """
    切换数据库后端（只换连接，不迁移数据，直接读目标库现有数据）

    请求体：
    - target: "postgres" | "sqlite"
    - postgres: {host, port, user, password, dbname}（可选,覆盖连接参数）

    Returns:
        {backend, restart_required}
    """
    data = request.get_json() or {}
    target = data.get('target')
    if target not in SUPPORTED_BACKENDS:
        return api_response(None, 400, 'target 必须是 sqlite 或 postgres')

    current = load_db_config()
    if target == current['backend']:
        return api_response(None, 400, f'当前已在使用 {target}，无需切换')

    if not _switch_lock.acquire(blocking=False):
        return api_response(None, 429, '已有切换操作进行中')

    try:
        if target == 'postgres':
            cfg = _merged_cfg(target, data.get('postgres'))
            err = _ensure_postgres_database(cfg['postgres'])
            if err:
                return api_response(None, 400, f'无法连接 PostgreSQL：{err}')
        else:
            cfg = {**current, 'backend': 'sqlite'}
            os.makedirs(settings.data_dir, exist_ok=True)

        save_db_config(cfg)

        restart_required = not os.environ.get('WERKZEUG_RUN_MAIN')
        if not restart_required:
            _request_reload_after_response()

        return api_response({
            'backend': target,
            'restart_required': restart_required,
        }, 200, '切换成功')
    finally:
        _switch_lock.release()
