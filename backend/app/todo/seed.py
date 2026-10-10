"""默认种子数据:四个类别。设置由 DEFAULT_SETTINGS 动态兜底,无需种子行。"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Category
from .timeutil import now_utc, uuid7

DEFAULT_CATEGORIES = [
    ("工作", "#3B82F6", "💼", 0),
    ("学习", "#8B5CF6", "📚", 1),
    ("生活", "#10B981", "🏠", 2),
    ("健康", "#F59E0B", "💪", 3),
]


def seed_if_empty(session: Session) -> None:
    if session.scalar(select(Category).limit(1)) is not None:
        return
    now = now_utc()
    for name, color, icon, order in DEFAULT_CATEGORIES:
        session.add(
            Category(
                id=uuid7(), name=name, color=color, icon=icon,
                sort_order=order, is_archived=False, created_at=now, updated_at=now,
            )
        )
