"""迁移服务:逾期任务发现、单条/批量迁移、干预阈值、自动迁移。"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Task
from ..schemas import MigrationPendingOut, TaskOut
from ..timeutil import iso, local_today, now_utc
from . import get_settings, log_event
from .tasks import append_position, quadrant_of, serialize_task, serialize_task_dict


def _pending_rows(session: Session, today):
    """待迁移行:select(Task.__table__) 取裸 Row(列名访问),免 ORM 实体装配——
    该列表动辄几十行且只读序列化,是 /today 的主要载荷之一。"""
    return session.execute(
        select(Task.__table__)
        .where(
            Task.status == "pending",
            Task.plan_id.is_(None),  # 计划实例逾期=错过,不进迁移池
            Task.deleted_at.is_(None),
            Task.shelved_at.is_(None),  # 搁置任务不再催办
            Task.task_date.is_not(None),
            Task.task_date < today,
        )
        .order_by(Task.task_date)
    ).all()


def pending_migrations_dict(session: Session, today, threshold: int) -> list[dict]:
    """待迁移列表(dict 版,键值与 MigrationPendingOut.model_dump(mode="json") 一致)。

    /today 聚合走这里,与 pydantic 版共用同一条查询。"""
    return [
        dict(
            serialize_task_dict(t, today),
            intervention_required=t.migrated_count >= threshold,
        )
        for t in _pending_rows(session, today)
    ]


def pending_migrations(session: Session) -> list[MigrationPendingOut]:
    tz = get_settings(session)["timezone"]
    today = local_today(tz)
    threshold = get_settings(session)["migration_intervene_threshold"]
    out = []
    for t in _pending_rows(session, today):
        base = serialize_task(t, today)
        out.append(
            MigrationPendingOut(
                **base.model_dump(),
                intervention_required=t.migrated_count >= threshold,
            )
        )
    return out


def _resolve_to_date(session: Session, to_date: str) -> date:
    if to_date == "today":
        return local_today(get_settings(session)["timezone"])
    try:
        return date.fromisoformat(to_date)
    except ValueError:
        raise HTTPException(422, f"非法目标日期: {to_date}")


def migrate_task(session: Session, task_id: str, to_date: str, reason: Optional[str] = None) -> Task:
    tz = get_settings(session)["timezone"]
    today = local_today(tz)
    target = _resolve_to_date(session, to_date)
    if target < today:
        raise HTTPException(422, "只能迁移到今天或未来的日期")
    t = session.get(Task, task_id)
    if t is None or t.deleted_at is not None:
        raise HTTPException(404, "任务不存在")
    if t.status != "pending":
        raise HTTPException(422, "只有待办状态的任务可以迁移")
    if t.task_date is None:
        raise HTTPException(422, "收件箱任务请直接排期(PATCH task_date)")
    if t.task_date == target:
        raise HTTPException(422, f"任务已属于 {target.isoformat()}")

    old = t.task_date
    t.task_date = target
    t.last_migrated_from = old
    t.migrated_count += 1
    t.shelved_at = None  # 迁移即脱离搁置
    # 迁移后置于目标象限尾部,让"旧面孔"沉底、新计划在上方
    t.position = append_position(session, t.is_important, t.is_urgent)
    t.updated_at = now_utc()
    t.revision += 1
    log_event(
        session,
        t.id,
        "migrated",
        {
            "from": iso(old),
            "to": iso(target),
            "reason": reason,
            "count": t.migrated_count,
            "original_date": iso(t.original_date),
        },
    )
    return t


def bulk_migrate(session: Session, task_ids: list[str], to_date: str, reason: Optional[str] = None) -> int:
    n = 0
    for tid in task_ids:
        migrate_task(session, tid, to_date, reason)
        n += 1
    return n


def decide(session: Session, task_id: str, decision: str) -> dict:
    t = session.get(Task, task_id)
    if t is None or t.deleted_at is not None:
        raise HTTPException(404, "任务不存在")
    if decision == "keep":
        # 搁置:保留原日期,不再出现在待迁移列表;回顾/统计页可查看全部搁置
        t.shelved_at = now_utc()
        t.updated_at = now_utc()
        t.revision += 1
        log_event(session, t.id, "migration_decision", {"decision": "keep"})
        return {"ok": True}
    if decision == "unshelve":
        t.shelved_at = None
        t.updated_at = now_utc()
        t.revision += 1
        log_event(session, t.id, "migration_decision", {"decision": "unshelve"})
        return {"ok": True}
    if decision == "delete":
        t.deleted_at = now_utc()
        t.updated_at = now_utc()
        t.revision += 1
        log_event(session, t.id, "deleted", {"via": "migration_decide", "title": t.title})
        return {"ok": True}
    raise HTTPException(422, f"未知决策: {decision}")


def shelved_tasks(session: Session) -> list[TaskOut]:
    """全部搁置中的任务(回顾/统计页展示)。"""
    tz = get_settings(session)["timezone"]
    today = local_today(tz)
    rows = list(
        session.scalars(
            select(Task)
            .where(
                Task.status == "pending",
                Task.plan_id.is_(None),  # 计划实例逾期=错过,不进迁移池
                Task.deleted_at.is_(None),
                Task.shelved_at.is_not(None),
            )
            .order_by(Task.shelved_at.desc())
        )
    )
    return [serialize_task(t, today) for t in rows]


def auto_migrate(session: Session) -> int:
    """自动迁移:跳过达到干预阈值的任务,其余逾期待办全部迁到今天。"""
    st = get_settings(session)
    today = local_today(st["timezone"])
    threshold = st["migration_intervene_threshold"]
    rows = list(
        session.scalars(
            select(Task)
            .where(
                Task.status == "pending",
                Task.plan_id.is_(None),  # 计划实例逾期=错过,不进迁移池
                Task.deleted_at.is_(None),
                Task.shelved_at.is_(None),
                Task.task_date.is_not(None),
                Task.task_date < today,
                Task.migrated_count < threshold,
            )
            .order_by(Task.task_date)
        )
    )
    n = 0
    for t in rows:
        old = t.task_date
        t.task_date = today
        t.last_migrated_from = old
        t.migrated_count += 1
        t.position = append_position(session, t.is_important, t.is_urgent)
        t.updated_at = now_utc()
        t.revision += 1
        log_event(
            session,
            t.id,
            "migrated",
            {"from": iso(old), "to": iso(today), "reason": "auto", "count": t.migrated_count},
        )
        n += 1
    return n
