"""
FastAPI 应用入口

初始化 FastAPI 应用：CORS、gzip 压缩、统一异常信封、动态模块注册与数据库。
无限流；后台线程随模块 start_background 钩子启动（TESTING 空转）。
"""

import importlib
import logging
import os

# uvicorn --reload 的重启戳文件（数据库切换时 touch 它），
# 必须被 import 才会进入 reload 监听列表
os.makedirs(os.path.dirname(os.path.abspath(__file__)), exist_ok=True)
_stamp = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_reload_stamp.py')
if not os.path.isfile(_stamp):
    with open(_stamp, 'w', encoding='utf-8') as f:
        f.write('# reload stamp - touched to trigger dev-server reload\n')
import app._reload_stamp  # noqa: F401,E402

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.middleware.gzip import GZipMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from starlette.exceptions import HTTPException as StarletteHTTPException  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import init_db  # noqa: E402
from app.shared import auth_router  # noqa: E402
from app.shared.logging_setup import setup_logging_for_app  # noqa: E402
from app.shared.modules import module_for_path, sys_name_for  # noqa: E402
from app.shared.response import api_response  # noqa: E402
from lizysdk.errors import AppError  # noqa: E402

#: 业务模块注册表（按此顺序 import；未迁移/导入失败的模块跳过并告警）
MODULES = ('blog', 'diary', 'vault', 'pwsvc', 'sdklogs', 'subs', 'apihub', 'system',
           'todo', 'gamemap', 'practice', 'steamidler', 'confcenter', 'clash', 'assets',
           'devtoolbox')

setup_logging_for_app()
logger = logging.getLogger('doublog.main')


def _log_extra(request: Request) -> dict:
    """按路径标注来源模块 sys_name；摄入端点自身的错误防自摄回环"""
    mod = module_for_path(request.url.path)
    extra = {'sys_name': sys_name_for(mod)}
    if request.url.path.startswith('/api/v1/logs'):
        extra['no_remote'] = True
    return extra


def create_app() -> FastAPI:
    """创建并配置 FastAPI 应用实例"""
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        docs_url=None, redoc_url=None, openapi_url=None,   # 单用户内部服务，不暴露 schema
    )
    app.state.testing = bool(os.environ.get('DOUBLOG_TESTING'))

    # CORS：凭据模式（会话 Cookie 跨端口携带）必须显式来源 + allow_credentials，
    # 不能再用通配 *；来源收敛为前端端口 60101（dev/preview 同端口）
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r'^https?://.*:60101$',
        allow_credentials=True,
        allow_methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allow_headers=['Content-Type', 'Authorization'],
    )
    # gzip：≥1KB 响应压缩传输（level 6 为体积/CPU 权衡——starlette 默认 9，
    # 压测显示 9 在大响应上每请求多耗 ~3-4ms CPU，全模块读吞吐受损）
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)

    # ── 请求级 trace：纯 ASGI 中间件（微秒级开销，不用 BaseHTTPMiddleware）──
    # 每个请求绑定 lizysdk trace_id（本请求内所有日志自动携带）并回写 X-Trace-Id 响应头；
    # 上游已带 X-Trace-Id（网关/SDK 调用方）则透传延续链路
    from lizysdk.logs import bind_context
    from lizysdk import new_trace_id

    def trace_middleware(app_to_wrap):
        async def middleware(scope, receive, send):
            if scope['type'] != 'http':
                await app_to_wrap(scope, receive, send)
                return
            trace_id = None
            for k, v in scope.get('headers') or []:
                if k == b'x-trace-id':
                    trace_id = v.decode('latin-1')[:64]
                    break
            if not trace_id:
                trace_id = new_trace_id()
            bind_context(trace_id=trace_id)

            # 访问日志（INFO，随 trace 上下文自动携带 trace_id）：/logs 页实时
            # 可见全部流量；/api/v1/logs 自身路径 no_remote（防摄入回环）
            import time as _time
            path = scope.get('path', '')
            method = scope.get('method', '')
            t0 = _time.monotonic()
            status_holder = {'status': 0}

            async def send_with_trace(message):
                if message['type'] == 'http.response.start':
                    status_holder['status'] = message['status']
                    message.setdefault('headers', []).append((b'x-trace-id', trace_id.encode('latin-1')))
                await send(message)

            try:
                await app_to_wrap(scope, receive, send_with_trace)
            finally:
                extra = {'sys_name': 'doublog.main'}
                if path.startswith('/api/v1/logs'):
                    extra['no_remote'] = True
                logger.info(f"access {method} {path} -> {status_holder['status']}"
                            f" ({(_time.monotonic() - t0) * 1000:.0f}ms)", extra=extra)
        return middleware

    app.add_middleware(trace_middleware)

    # ── 统一异常信封（与 Flask 时代行为一致）──────────────
    async def handle_app_error(request: Request, err: AppError) -> JSONResponse:
        logger.info(f"AppError {err.code}: {err.message} [{request.method} {request.url.path}]",
                    extra=_log_extra(request))
        # 401 不附带 WWW-Authenticate: Basic——浏览器 fetch 收到该头会弹出原生
        # Basic 认证框叠在页面 UI 上（前端表现为"双层"）。SPA 有自己的登录页，
        # curl / 单测 / SDK 发送端本就主动携带 Basic 头，无人依赖浏览器原生弹框。
        return JSONResponse(
            {'success': False, 'code': err.http_status, 'message': err.message,
             'data': {'error_code': err.code, 'details': err.details or None}},
            status_code=err.http_status)

    async def handle_http_exception(request: Request,
                                    exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            message = '资源不存在'
        elif exc.status_code == 405:
            message = '方法不被允许'
        else:
            message = str(exc.detail)
        logger.info(f"HTTP {exc.status_code}: {request.method} {request.url.path}",
                    extra=_log_extra(request))
        return api_response(None, exc.status_code, message)

    async def handle_validation(request: Request,
                                exc: RequestValidationError) -> JSONResponse:
        logger.info(f"400 validation: {request.method} {request.url.path}",
                    extra=_log_extra(request))
        return api_response(None, 400, '请求参数错误')

    async def handle_exception(request: Request, exc: Exception) -> JSONResponse:
        logger.error(f"[{module_for_path(request.url.path)}] Unhandled exception: {exc}",
                     exc_info=True, extra=_log_extra(request))
        return api_response(None, 500, '服务器内部错误')

    app.add_exception_handler(AppError, handle_app_error)
    app.add_exception_handler(StarletteHTTPException, handle_http_exception)
    app.add_exception_handler(RequestValidationError, handle_validation)
    app.add_exception_handler(Exception, handle_exception)

    # ── 动态模块导入（先注册模型，建表才能看到全部表）────
    loaded = []
    for name in MODULES:
        try:
            mod = importlib.import_module(f'app.{name}')
        except Exception as e:  # noqa: BLE001 - 未迁移模块（Flask 残码）跳过不致命
            logger.warning(f'模块 app.{name} 未注册（未迁移或依赖缺失）: {e}')
            continue
        loaded.append((name, mod))

    # ── 数据库（建表 → 存量改名 → 模块迁移钩子 → 播种）───
    init_db(app)

    # ── 路由挂载 + 后台线程钩子 ─────────────────────────
    for name, mod in loaded:
        router = getattr(mod, 'router', None)
        if router is not None:
            app.include_router(router)
        starter = getattr(mod, 'start_background', None)
        if callable(starter):
            starter(app)

    app.include_router(auth_router)

    @app.get('/')
    async def root():
        return {'message': f'Welcome to {settings.app_name}', 'version': settings.app_version}

    @app.get('/health')
    async def health_check():
        return {'status': 'healthy'}

    logger.info(f"{settings.app_name} v{settings.app_version} initialized "
                f"(fastapi, backend={app.state.engine.url.get_backend_name()})")
    return app


app = create_app()


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host=settings.host, port=settings.port)
