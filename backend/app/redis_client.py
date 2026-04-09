"""
Redis 客户端模块

使用 redis-py 直连，替代已废弃的 Flask-Redis。
- decode_responses=True 自动将 bytes 转换为 str
- 配置连接池、超时、重试、健康检查
"""

import redis
from app.config import settings

_redis_client = None


def get_redis():
    """
    获取 Redis 客户端实例（全局单例）
    
    使用连接池 + 健康检查 + 自动重试，生产环境推荐配置。
    连接异常在调用方捕获（不再每次调用前 PING）。
    """
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
            retry_on_timeout=True,
            health_check_interval=30,
            max_connections=10,
        )
    return _redis_client


def init_redis(app):
    """Flask 扩展初始化（兼容 Flask app factory 模式）"""
    get_redis()
    return get_redis
