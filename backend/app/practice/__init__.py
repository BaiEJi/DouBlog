"""practice 能力包:刷题管理(题目/解法/代码/标签/间隔复习/一键抓题,docs/practice-spec.md + docs/modules/practice.md)。

- 导出 router(~22 端点,/api/practice/*);practice_* 6 表挂 Doublog app.db.Base,
  建表由骨架 init_db 的 create_all 完成;无后台线程、无存量迁移(全新表)——
  不提供 start_background/ensure_migrations
- 复习调度的时区设置复用 todo 模块(app.todo.services.get_settings,读 todo_app_settings)
- 抓题适配器(fetchers)纯网络调用不落库;导入导出(importer)JSON 无损 + Obsidian zip
"""
from .routes import router

__all__ = ["router"]
