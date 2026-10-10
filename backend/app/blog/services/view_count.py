"""
文章浏览计数模块

直接读写数据库（SQLite/PostgreSQL 通用），每次浏览实时 UPDATE 写回，
无缓存层、无刷盘任务。
"""

import logging
from datetime import datetime, timezone

from app.db import db
from app.blog.models import Post

logger = logging.getLogger(__name__)


def increment_view(post_id: int) -> int:
    """
    递增文章浏览计数并刷新最近浏览时间（实时写库）

    Args:
        post_id: 文章ID

    Returns:
        int: 递增后的计数
    """
    rows = db.session.query(Post).filter(Post.id == post_id).update(
        {
            'view_count': Post.view_count + 1,
            'last_viewed_at': datetime.now(timezone.utc),
        }
    )
    if rows:
        db.session.commit()
    return get_view_count(post_id)


def get_view_count(post_id: int) -> int:
    """
    获取文章浏览计数

    Args:
        post_id: 文章ID

    Returns:
        int: 计数，文章不存在返回 0
    """
    value = db.session.query(Post.view_count).filter(Post.id == post_id).scalar()
    return value or 0


def get_all_view_counts(post_ids: list[int]) -> dict[int, int]:
    """
    批量获取多个文章的浏览计数

    Args:
        post_ids: 文章ID列表

    Returns:
        dict[int, int]: 文章ID到计数的映射
    """
    if not post_ids:
        return {}
    rows = db.session.query(Post.id, Post.view_count).filter(Post.id.in_(post_ids)).all()
    return {post_id: count or 0 for post_id, count in rows}
