"""
Flask 应用入口

初始化 Flask 应用,配置 CORS、数据库、Redis 和定时任务。
"""

import logging
from flask import Flask, jsonify, request
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS
from flask_httpauth import HTTPBasicAuth
from werkzeug.exceptions import HTTPException
from app.config import settings
from app.db import init_db
from app.api import auth_bp, posts_bp, images_bp
from app.api.auth import auth
from app.utils.response import api_response
from app.redis_client import get_redis
from app.cron import scheduler


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
        Flask: 配置完成的Flask应用实例
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
    get_redis()

    scheduler.init_app(app)
    scheduler.start()

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

    @app.errorhandler(429)
    def handle_rate_limit(e):
        """
        429错误处理（请求过于频繁）
        
        Args:
            e: HTTPException实例
            
        Returns:
            tuple: 错误响应和状态码
        """
        return api_response(None, 429, "请求过于频繁，请稍后再试")

    @app.before_request
    def log_request():
        """请求日志记录"""
        logger.info(f"{request.method} {request.path}")

    app.register_blueprint(auth_bp)
    app.register_blueprint(posts_bp)
    app.register_blueprint(images_bp)

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

    logger.info(f"{settings.app_name} v{settings.app_version} initialized")
    return app


app = create_app()


if __name__ == "__main__":
    app.run(
        host=settings.host,
        port=settings.port,
        debug=settings.debug
    )