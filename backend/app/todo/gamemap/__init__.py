"""gamemap 子模块:剧情图谱(gamemap 后端迁入 todo,docs/gamemap-migration.md)。

- 本包导出 gamemap_router(9 组路由,/api/todo/gamemap/*),由 app/todo/__init__.py
  组合挂载到 todo 模块 router(骨架契约是单 router)
- 表 gamemap_* 13 张,挂在 Doublog app.db.Base;建表由骨架 init_db 的 create_all 完成
- seed 7 默认关系类型 + 附件目录 ensure 由 app/todo/__init__.py 的 ensure_migrations 调用
- 舍弃源版的 /api/db 切换、SDK 日志/异常组件、CORS、SPA 托管与 config.py(Doublog 统一提供)
"""
from .routers import gamemap_router

__all__ = ["gamemap_router"]
