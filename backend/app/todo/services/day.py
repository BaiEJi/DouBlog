"""今日聚合:四象限分组 + 待迁移列表 + 昨日概况 + streak。

性能口径(2026-10 优化):
- 载荷直接装配为 JSON-ready 原生 dict(与旧 TodayOut.model_dump(mode="json")
  键值完全一致),跳过 pydantic construct+dump 两层往返;
- 昨日创建/完成计数走 COUNT 下推(stats.day_task_counts);
- 待迁移列表走 dict 序列化(migrations.pending_migrations_dict)。
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Task
from ..timeutil import local_today
from . import get_settings
from .migrations import pending_migrations_dict
from .stats import compute_streak, day_task_counts
from .tasks import _category_map, flags_of, serialize_task_dict


def _view_date(session: Session, date_str: Optional[str]) -> date:
    if not date_str or date_str == "today":
        return local_today(get_settings(session)["timezone"])
    try:
        return date.fromisoformat(date_str)
    except ValueError:
        raise ValueError(f"非法日期: {date_str}")


def get_today(session: Session, date_str: Optional[str] = None) -> dict:
    st = get_settings(session)
    tz = st["timezone"]
    today = local_today(tz)
    view = _view_date(session, date_str)
    cats = _category_map(session)

    tasks = session.execute(
        select(Task.__table__).where(  # 裸 Row 加载:列表只读序列化,免 ORM 实体装配
            Task.task_date == view,
            Task.deleted_at.is_(None),
            Task.plan_id.is_(None),  # 规律生活计划实例不进四象限看板
        )
    ).all()
    active = [t for t in tasks if t.status in ("pending", "in_progress")]
    done = [t for t in tasks if t.status == "done"]
    done.sort(key=lambda t: t.completed_at or t.created_at, reverse=True)

    blocks: list[dict] = []
    for q in (1, 2, 3, 4):
        imp, urg = flags_of(q)
        q_active = sorted(
            [t for t in active if t.is_important == imp and t.is_urgent == urg],
            key=lambda t: t.position,
        )
        q_done = [t for t in done if t.is_important == imp and t.is_urgent == urg]
        pending_count = len(q_active)
        blocks.append(
            {
                "quadrant": q,
                "label": st["quadrant_labels"][f"q{q}"],
                "subtitle": st["quadrant_subtitles"][f"q{q}"],
                "pending_count": pending_count,
                "over_limit": pending_count > st["quadrant_soft_limit"],
                "tasks": [serialize_task_dict(t, today, cats) for t in q_active + q_done],
            }
        )

    yd = view - timedelta(days=1)
    yd_counts = day_task_counts(session, tz, yd)

    return {
        "date": view.isoformat(),
        "quadrants": blocks,
        "pending_migrations": pending_migrations_dict(
            session, today, st["migration_intervene_threshold"]
        ),
        "yesterday": {"created": yd_counts["created"], "completed": yd_counts["completed"]},
        "streak": compute_streak(session, tz),
        "quadrant_soft_limit": st["quadrant_soft_limit"],
        "migration_threshold": st["migration_intervene_threshold"],
    }
