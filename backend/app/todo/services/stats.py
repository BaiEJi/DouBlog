"""统计服务:每日/范围/热力图/streak。

口径原则:
- created / completed / streak / heatmap 一律按【任务当前状态】计算
  (status=done 且 completed_at 落在当日)——取消完成后统计立即回退;
- migrated / migrated_in 是"发生过的流动",按事件日志计算,不回退。
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Category, Task, TaskEvent
from ..timeutil import local_day_bounds_utc, local_today, to_local


def _tz(session: Session) -> str:
    from . import get_settings
    return get_settings(session)["timezone"]


def _local(d, tz: str) -> date:
    return to_local(d, tz).date()


# ---------- 任务态查询 ----------

def _completed_ats_in(session: Session, start_utc, end_utc) -> list:
    """区间内完成(任务当前状态口径)的 completed_at 列——列查询,不装配 ORM 实体。"""
    return list(
        session.scalars(
            select(Task.completed_at).where(Task.plan_id.is_(None),
                Task.status == "done",
                Task.completed_at.is_not(None),
                Task.completed_at >= start_utc,
                Task.completed_at < end_utc,
            )
        )
    )


def _created_ats_in(session: Session, start_utc, end_utc) -> list:
    return list(
        session.scalars(
            select(Task.created_at).where(Task.plan_id.is_(None),
                Task.deleted_at.is_(None),
                Task.created_at >= start_utc,
                Task.created_at < end_utc,
            )
        )
    )


def day_task_counts(session: Session, tz: str, day: date) -> dict[str, int]:
    """某日的创建数/完成数(任务当前状态口径)。

    两计数条件不同(创建看 created_at 区间,完成看 completed_at 区间),全部放进
    CASE 条件、WHERE 只留公共谓词,合并为一次全表扫描(原先两次)。"""
    from sqlalchemy import case

    start, end = local_day_bounds_utc(day, tz)
    row = session.execute(
        select(
            func.sum(case(
                (Task.deleted_at.is_(None) & (Task.created_at >= start) & (Task.created_at < end), 1),
                else_=0)),
            func.sum(case(
                ((Task.status == "done") & Task.completed_at.is_not(None)
                 & (Task.completed_at >= start) & (Task.completed_at < end), 1),
                else_=0)),
        ).where(Task.plan_id.is_(None))
    ).one()
    return {"created": int(row[0] or 0), "completed": int(row[1] or 0)}


def _migrated_in_count(session: Session, tz: str, day: date) -> int:
    start, end = local_day_bounds_utc(day, tz)
    # LIKE 预过滤到目标日迁移事件(payload 为 ensure_ascii=False 的 JSON,日期字面量可直接匹配)
    evs = list(
        session.scalars(
            select(TaskEvent).where(
                TaskEvent.event_type == "migrated",
                TaskEvent.created_at >= start,
                TaskEvent.created_at < end,
                TaskEvent.payload.like(f'%"to": "{day.isoformat()}"%'),
            )
        )
    )
    n = 0
    for e in evs:
        if _local(e.created_at, tz) != day:
            continue
        if e.payload:
            try:
                if json.loads(e.payload).get("to") == day.isoformat():
                    n += 1
            except Exception:
                pass
    return n


# ---------- 每日 ----------

def daily_stats(session: Session, date_str: Optional[str] = None) -> dict:
    tz = _tz(session)
    day = date.fromisoformat(date_str) if date_str else local_today(tz)
    counts = day_task_counts(session, tz, day)
    migrated_in = _migrated_in_count(session, tz, day)

    tasks = list(
        session.scalars(
            select(Task).where(Task.plan_id.is_(None), Task.task_date == day, Task.deleted_at.is_(None))
        )
    )
    done_tasks = [t for t in tasks if t.status == "done"]
    pending_n = sum(1 for t in tasks if t.status in ("pending", "in_progress"))
    cancelled_n = sum(1 for t in tasks if t.status == "cancelled")
    denom = len(done_tasks) + pending_n
    rate = round(len(done_tasks) / denom, 4) if denom else None

    qc: Counter = Counter()
    for t in done_tasks:
        q = 1 if (t.is_important and t.is_urgent) else 2 if t.is_important else 3 if t.is_urgent else 4
        qc[f"q{q}"] += 1

    cats = {c.id: c for c in session.scalars(select(Category))}
    by_cat: Counter = Counter()
    for t in done_tasks:
        cat = cats.get(t.category_id) if t.category_id else None
        by_cat[(cat.name if cat else "未分类", cat.color if cat else "#94a3b8")] += 1

    return {
        "date": day.isoformat(),
        "created": counts["created"],
        "completed": counts["completed"],
        "completion_rate": rate,
        "migrated_in": migrated_in,
        "cancelled": cancelled_n,
        "quadrant_completed": {f"q{i}": qc.get(f"q{i}", 0) for i in (1, 2, 3, 4)},
        "by_category": [
            {"name": name, "color": color, "completed": n} for (name, color), n in by_cat.most_common()
        ],
    }


# ---------- 范围 ----------

def range_stats(session: Session, from_str: str, to_str: str) -> dict:
    tz = _tz(session)
    d0 = date.fromisoformat(from_str)
    d1 = date.fromisoformat(to_str)
    if d1 < d0:
        raise ValueError("to 不能早于 from")
    if (d1 - d0).days > 366:
        raise ValueError("范围过大(最多 366 天)")

    start, _ = local_day_bounds_utc(d0, tz)
    _, end = local_day_bounds_utc(d1, tz)

    created_counter: Counter = Counter(_local(d, tz) for d in _created_ats_in(session, start, end))
    completed_counter: Counter = Counter(_local(d, tz) for d in _completed_ats_in(session, start, end))

    evs = list(
        session.scalars(
            select(TaskEvent).where(
                TaskEvent.event_type == "migrated",
                TaskEvent.created_at >= start,
                TaskEvent.created_at < end,
            )
        )
    )
    migrated_counter: Counter = Counter(_local(e.created_at, tz) for e in evs)

    days = []
    totals = {"created": 0, "completed": 0, "migrated": 0}
    cur = d0
    while cur <= d1:
        row = {
            "date": cur.isoformat(),
            "created": created_counter.get(cur, 0),
            "completed": completed_counter.get(cur, 0),
            "migrated": migrated_counter.get(cur, 0),
        }
        days.append(row)
        for k in totals:
            totals[k] += row[k]
        cur += timedelta(days=1)
    return {"days": days, "totals": totals}


# ---------- 热力图 / streak ----------

def heatmap(session: Session, year: int) -> dict:
    tz = _tz(session)
    start, _ = local_day_bounds_utc(date(year, 1, 1), tz)
    _, end = local_day_bounds_utc(date(year, 12, 31), tz)
    c: Counter = Counter()
    for d in _completed_ats_in(session, start, end):
        local_d = _local(d, tz)
        if local_d.year == year:
            c[local_d.isoformat()] += 1
    return {
        "year": year,
        "days": [{"date": d, "count": n} for d, n in sorted(c.items())],
    }


def completed_dates(session: Session, tz: str) -> set[date]:
    """活跃日集合 = 有"当前仍是完成态"的任务完成的日期。"""
    evs = list(
        session.scalars(
            select(Task.completed_at).where(
                Task.status == "done", Task.completed_at.is_not(None)
            )
        )
    )
    return {_local(d, tz) for d in evs}


def compute_streak(session: Session, tz: str, today: date | None = None) -> dict:
    today = today or local_today(tz)
    dates = completed_dates(session, tz)
    if not dates:
        return {"current": 0, "best": 0, "total_active": 0, "last_active_date": None}

    total = len(dates)
    last = max(dates)

    # 当前连续:今天已活跃从今天起算;否则从昨天起算(今天还没结束)
    anchor = today if today in dates else today - timedelta(days=1)
    current = 0
    cur = anchor
    while cur in dates:
        current += 1
        cur -= timedelta(days=1)

    # 最长连续
    best = 1
    run = 1
    ordered = sorted(dates)
    for i in range(1, len(ordered)):
        run = run + 1 if (ordered[i] - ordered[i - 1]).days == 1 else 1
        best = max(best, run)

    return {
        "current": current,
        "best": max(best, current),
        "total_active": total,
        "last_active_date": last.isoformat(),
    }
