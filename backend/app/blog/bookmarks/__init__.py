"""bookmarks 能力包（blog 子域）：书签与稍后阅读（docs/modules/blog.md 书签子域节）。

- 导出 router（~23 端点，/api/bookmarks/*）；bookmarks_* 4 表挂 app.db.Base，
  新库由骨架 create_all 建表，ensure_migrations 为存量表幂等补联合索引；
  不提供 start_background（死链检测为手动触发的批量任务）
- 网络抓取（元信息/快照/死链检测）在 fetcher.py，纯函数不落库；
  导入导出（Netscape HTML + JSON）在 transfer.py
"""
from .routes import router
from .models import BookmarkItem
from sqlalchemy.schema import CreateIndex


def ensure_migrations(engine):
    """补软删过滤与创建时间/ID排序索引，保留原列、数据及其他索引。"""
    index = next(index for index in BookmarkItem.__table__.indexes
                 if index.name == 'ix_bmitem_deleted_created_id')
    # Let the database skip an existing index without a separate check/create gap.
    with engine.begin() as connection:
        connection.execute(CreateIndex(index, if_not_exists=True))


__all__ = ["router", "ensure_migrations"]
