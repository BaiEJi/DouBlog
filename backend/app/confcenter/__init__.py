"""配置中心：独立 namespace、KV 存储与可选 Redis 读缓存。"""
from .routes import router
from .migrations import ensure_migrations

__all__ = ['router', 'ensure_migrations']
