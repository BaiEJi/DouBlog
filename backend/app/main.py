"""
Flask 应用入口

初始化 Flask 应用，配置 CORS、数据库（SQLite/PostgreSQL 双后端）与 gzip 压缩。
无限流、无定时任务（浏览计数实时写库）。
"""

import gzip
import logging
import os

# 触发 Werkzeug reloader 热重启的戳文件（数据库切换时 touch 它），
# 必须被 import 才会进入 reloader 的监听列表
os.makedirs(os.path.dirname(os.path.abspath(__file__)), exist_ok=True)
_stamp = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_reload_stamp.py')
if not os.path.isfile(_stamp):
    with open(_stamp, 'w', encoding='utf-8') as f:
        f.write('# reload stamp - touched to trigger dev-server reload\n')
import app._reload_stamp  # noqa: F401,E402
from flask import Flask, jsonify, request
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS
from werkzeug.exceptions import HTTPException
from app.config import settings
from app.db import init_db
from app.api import auth_bp, posts_bp, images_bp, admin_bp, workspaces_bp, export_bp
from app.api.auth import auth
from app.utils.response import api_response


class CustomJSONProvider(DefaultJSONProvider):
    """自定义JSON提供器，确保中文不被转义"""

    def __init__(self, app):
        """
        初始化JSON提供器

        Args:
            app: Flask应用实例
        """
        super().__init__(app)
        self.ensure_ascii = False


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@auth.error_handler
def auth_error(status=401):
    """
    认证失败错误处理

    Args:
        status: HTTP状态码，默认401

    Returns:
        tuple: 错误响应和状态码
    """
    return api_response(None, status, "认证失败")


def create_app():
    """
    创建并配置Flask应用实例

    Returns:
        Flask: 配置完成的Flask应用
    """
    app = Flask(__name__)
    app.config['SECRET_KEY'] = settings.secret_key
    app.json = CustomJSONProvider(app)

    CORS(app, resources={
        r"/api/*": {
            "origins": settings.cors_origins,
            "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            "allow_headers": ["Content-Type", "Authorization"]
        }
    })

    init_db(app)

    @app.errorhandler(Exception)
    def handle_exception(e):
        """
        全局异常处理

        Args:
            e: 异常实例

        Returns:
            tuple: 错误响应和状态码
        """
        logger.error(f"Unhandled exception: {str(e)}", exc_info=True)
        if isinstance(e, HTTPException):
            return api_response(None, e.code, e.description)
        return api_response(None, 500, "服务器内部错误")

    @app.errorhandler(400)
    def handle_bad_request(e):
        """
        400错误处理

        Args:
            e: HTTPException实例

        Returns:
            tuple: 错误响应和状态码
        """
        return api_response(None, 400, str(e.description))

    @app.errorhandler(404)
    def handle_not_found(e):
        """
        404错误处理

        Args:
            e: HTTPException实例

        Returns:
            tuple: 错误响应和状态码
        """
        return api_response(None, 404, "资源不存在")

    # gzip 压缩：JSON/文本响应超过 1KB 时压缩传输
    @app.after_request
    def compress_response(response):
        accept_encoding = request.headers.get('Accept-Encoding', '')
        if 'gzip' not in accept_encoding.lower():
            return response
        if response.direct_passthrough:
            return response  # 文件流等直通响应不压缩
        if response.status_code < 200 or response.status_code >= 300:
            return response
        if response.headers.get('Content-Encoding'):
            return response
        content_type = response.headers.get('Content-Type', '')
        if not (content_type.startswith('application/json') or content_type.startswith('text/')):
            return response
        body = response.get_data()
        if len(body) < 1024:
            return response
        response.set_data(gzip.compress(body, compresslevel=6))
        response.headers['Content-Encoding'] = 'gzip'
        response.headers['Vary'] = 'Accept-Encoding'
        return response

    app.register_blueprint(auth_bp)
    app.register_blueprint(posts_bp)
    app.register_blueprint(images_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(workspaces_bp)
    app.register_blueprint(export_bp)

    @app.route("/")
    def root():
        """
        根路径，返回欢迎信息

        Returns:
            dict: 欢迎信息和版本号
        """
        return jsonify({
            "message": f"Welcome to {settings.app_name}",
            "version": settings.app_version
        })

    @app.route("/health")
    def health_check():
        """
        健康检查端点

        Returns:
            dict: 健康状态
        """
        return jsonify({"status": "healthy"})

    logger.info(f"{settings.app_name} v{settings.app_version} initialized (backend={app.config['SQLALCHEMY_DATABASE_URI'].split('://')[0]})")
    return app


app = create_app()


if __name__ == "__main__":
    app.run(
        host=settings.host,
        port=settings.port,
        debug=settings.debug
    )
