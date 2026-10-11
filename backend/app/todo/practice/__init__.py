"""practice 子模块：刷题管理（题目/解法/代码/标签/间隔复习/一键抓题，docs/practice-spec.md）。

- 本包导出 practice_router（~22 端点，/api/todo/practice/*），由
  app/todo/__init__.py 组合挂载到 todo 模块 router（骨架契约是单 router）
- practice_* 6 表挂 Doublog app.db.Base，建表由骨架 init_db 的 create_all 完成；
  无后台线程、无存量迁移（全新表）——不提供 start_background/ensure_migrations
- 抓题适配器（fetchers）纯网络调用不落库；导入导出（importer）JSON 无损 + Obsidian zip
"""
from .routes import router as practice_router

__all__ = ["practice_router"]
