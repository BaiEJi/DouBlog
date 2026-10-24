"""书签与稍后阅读（bookmarks）模块 4 表模型。

类型约定同 practice/todo 模块（SQLite/Postgres 公共类型子集）：
- 主键 String(36) + uuid7()（时间有序，避免随机主键打碎 B-tree）
- 时间戳 DateTime(timezone=True) 存 UTC
- SQLite 未开 PRAGMA foreign_keys，ondelete=CASCADE 仅对 PG 生效——
  关联清理（标签关联等）由 services 层显式执行（双后端一致）
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

#: 条目状态机：unread（稍后阅读队列）→ reading（阅读中）→ read（已读）；
#: archived 为归档态（出队列但保留）；starred 是独立维度不占状态位
BOOKMARK_STATUSES = ("unread", "reading", "read", "archived")

#: 死链检测结论：unknown（未检测）/ ok（可达）/ dead（HTTP ≥400）/ error（网络失败）
LINK_STATUSES = ("unknown", "ok", "dead", "error")

#: 分类树层级上限（level 0/1/2，共 3 层，与 blog 文章树口径一致）
MAX_CATEGORY_LEVEL = 2


class BookmarkCategory(Base):
    """分类（文件夹）树。parent_id 为空 = 顶级；sort_order 浮点中点插入。"""

    __tablename__ = "bookmarks_categories"
    __table_args__ = (Index("ix_bmcat_parent", "parent_id", "sort_order"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    parent_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("bookmarks_categories.id", ondelete="SET NULL"))
    sort_order: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class BookmarkItem(Base):
    """书签条目。软删（deleted_at → 回收站）；正文快照 snapshot_md 大字段，
    列表查询必须 defer（同 practice 的 description_md 约定）。"""

    __tablename__ = "bookmarks_items"
    __table_args__ = (
        Index("ix_bmitem_status", "status"),
        Index("ix_bmitem_category", "category_id"),
        Index("ix_bmitem_created", "created_at"),
        Index("ix_bmitem_deleted_created_id", "deleted_at", "created_at", "id"),
        Index("ix_bmitem_normalized", "normalized_url"),
        Index("ix_bmitem_link", "link_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    #: URL 规范化形式（小写 host、去 fragment、去默认端口、去 utm_* 追踪参数），
    #: 查重与重复检测都基于它；非唯一索引（回收站里可存在同 URL 旧档）
    normalized_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    note: Mapped[Optional[str]] = mapped_column(Text)
    site_name: Mapped[Optional[str]] = mapped_column(String(255))
    favicon_url: Mapped[Optional[str]] = mapped_column(String(1024))
    category_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("bookmarks_categories.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="unread")
    starred: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    link_status: Mapped[str] = mapped_column(String(10), nullable=False, default="unknown")
    link_code: Mapped[Optional[int]] = mapped_column(SmallInteger)
    last_checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    snapshot_md: Mapped[Optional[str]] = mapped_column(Text)
    snapshot_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    snapshot_words: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class BookmarkTag(Base):
    """标签。name 全库唯一；color 缺省按色板轮询（services 层）。"""

    __tablename__ = "bookmarks_tags"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#F97316")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class BookmarkItemTag(Base):
    """条目↔标签 多对多关联。"""

    __tablename__ = "bookmarks_item_tags"
    __table_args__ = (
        UniqueConstraint("item_id", "tag_id", name="pk_bm_item_tag"),
        Index("ix_bmitemtag_tag", "tag_id", "item_id"),
    )

    item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("bookmarks_items.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("bookmarks_tags.id", ondelete="CASCADE"), primary_key=True)
