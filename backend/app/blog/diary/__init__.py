"""日记能力（blog 子域：app/blog/diary/，路由前缀 /api/diary，表名保留 diary_ 前缀）。"""
from .routes import router
from .models import ensure_migrations
