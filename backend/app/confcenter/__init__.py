"""配置中心能力包：扁平 KV 配置存储 + 可选 Redis 读缓存（docs/confcenter-spec.md）。

对外契约：仅 router——无后台线程（不需要 start_background），
新表由骨架 create_all 直接建（无列级迁移，不需要 ensure_migrations）。
"""
from .routes import router

__all__ = ['router']
