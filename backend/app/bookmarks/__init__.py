"""bookmarks 能力包：书签与稍后阅读（docs/modules/bookmarks.md）。

- 导出 router（~23 端点，/api/bookmarks/*）；bookmarks_* 4 表挂 app.db.Base，
  建表由骨架 init_db 的 create_all 完成；全新表无存量迁移——
  不提供 start_background / ensure_migrations（死链检测为手动触发的批量任务）
- 网络抓取（元信息/快照/死链检测）在 fetcher.py，纯函数不落库；
  导入导出（Netscape HTML + JSON）在 transfer.py
"""
from .routes import router

__all__ = ["router"]
