"""
管理 API：数据库后端管理（SQLite / PostgreSQL 双后端切换）

- GET  /api/admin/database          当前状态（后端、连接配置、数据量）
- POST /api/admin/database/test     测试目标后端连通性（不切换）
- POST /api/admin/database/switch   切换后端连接（不迁移数据）

切换语义：只更换连接配置（data/db_config.json）并重启生效，直接读取目标库的
现有数据（空库会自动建表并播种默认知识库/虚拟根）。两侧数据互不影响，
随时可切回。开发模式（settings.debug，uvicorn --reload 监听 app/ 目录）下
touch app/_reload_stamp.py 自动重启；生产模式返回 restart_required。
"""

import logging
import os
import threading
from urllib.parse import quote_plus

from fastapi import APIRouter, Depends, Request
from sqlalchemy import create_engine, text

from app.config import settings
from app.db import db, load_db_config, save_db_config, get_database_url, run_db, SUPPORTED_BACKENDS
from app.shared.auth import require_basic
from app.shared.response import api_response

router = APIRouter(prefix='/api/admin', dependencies=[Depends(require_basic)])

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
    开发模式（uvicorn --reload）下触发自动重启：
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


async def _json_body(request: Request) -> dict:
    """解析请求体 JSON，非法/缺失时回退空 dict（对齐 get_json(silent=True) or {}）"""
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001 - 非法 JSON 按空体处理，走原有参数校验
        return {}
    return data if isinstance(data, dict) else {}


@router.get('/database')
async def database_status():
    """当前数据库后端状态"""
    def _payload() -> dict:
        cfg = load_db_config()
        with db.engine.connect() as conn:
            # 文章数不含虚拟根（id=0）
            posts = conn.execute(text('SELECT COUNT(*) FROM blog_posts WHERE id != 0')).scalar() or 0
            audits = conn.execute(text('SELECT COUNT(*) FROM blog_audit_logs')).scalar() or 0
        return {
            'backend': cfg['backend'],
            'database_url_masked': get_database_url(cfg).split('@')[-1] if cfg['backend'] == 'postgres' else get_database_url(cfg),
            'data_dir': settings.data_dir,
            'postgres': cfg['postgres'],
            'counts': {'posts': posts, 'audit_logs': audits},
            'running_under_reloader': bool(settings.debug),
        }

    return api_response(await run_db(_payload))


@router.post('/database/test')
async def database_test(request: Request):
    """
    测试目标后端连通性（不切换）

    请求体：{"target": "postgres"|"sqlite", "postgres": {"host","port","user","password","dbname"}}
    """
    data = await _json_body(request)
    return await run_db(_database_test_sync, data)


def _database_test_sync(data: dict):
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


@router.post('/database/switch')
async def database_switch(request: Request):
    """
    切换数据库后端（只换连接，不迁移数据，直接读目标库现有数据）

    请求体：
    - target: "postgres" | "sqlite"
    - postgres: {host, port, user, password, dbname}（可选,覆盖连接参数）

    Returns:
        {backend, restart_required}
    """
    data = await _json_body(request)
    return await run_db(_database_switch_sync, data)


def _database_switch_sync(data: dict):
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

        # 引擎重建交给重启后的 init_db（uvicorn --reload 触发或生产手动重启）
        restart_required = not settings.debug
        if not restart_required:
            _request_reload_after_response()

        return api_response({
            'backend': target,
            'restart_required': restart_required,
        }, 200, '切换成功')
    finally:
        _switch_lock.release()

# ─── 日志上报配置（管理页）：每模块 sys_name + 服务地址/开关/级别 ──

@router.get('/logging')
async def get_logging_config():
    from app.shared.modules import load_logs_config, ALL_MODULES, sys_name_for
    cfg = load_logs_config()
    cfg['modules'] = [{'module': m, 'sys_name': sys_name_for(m)} for m in ALL_MODULES]
    return api_response(cfg)


@router.put('/logging')
async def put_logging_config(request: Request):
    """保存并**立即生效**（重装配 lizysdk 日志管道，幂等）。"""
    from app.shared.modules import load_logs_config, save_logs_config
    data = await _json_body(request)
    cfg = load_logs_config()
    if 'enabled' in data:
        if not isinstance(data['enabled'], bool):
            return api_response(None, 400, 'enabled 需为布尔值')
        cfg['enabled'] = data['enabled']
    if 'url' in data:
        url = (data.get('url') or '').strip()
        if not url.startswith(('http://', 'https://')):
            return api_response(None, 400, 'url 需为 http(s):// 开头')
        cfg['url'] = url
    if 'level' in data:
        if data['level'] not in ('INFO', 'WARNING'):
            return api_response(None, 400, 'level 仅 INFO / WARNING')
        cfg['level'] = data['level']
    save_logs_config(cfg)
    from app.shared.logging_setup import setup_logging_for_app
    setup_logging_for_app()
    return api_response(cfg)


@router.post('/logging/test')
async def test_logging_send():
    """发一条 WARNING 测试日志（sys_name=doublog.system），到日志查询页验证链路。"""
    from app.shared.modules import mod_logger
    import time as _t
    marker = f'log-send-test-{int(_t.time())}'
    mod_logger('system').warning('日志上报链路测试 %s', marker)
    return api_response({'marker': marker, 'hint': '到 /logs 页搜索 marker 验证'})
