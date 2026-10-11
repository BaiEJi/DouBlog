"""规律生活计划:规则引擎 + 任务实例物化 + CRUD。

规则四种:
- weekly        每周的周几(可多选,weekdays=[0..6] 周一=0)
- interval      每隔 N 天(自 start_date 起算)
- weekly_times  每周 N 次(N 个周几自动均摊,全局固定:1→周一,2→周一/周四,3→周一/三/五…)
- monthly_times 每月 N 次(N 个日期自动均摊到月内,按月天数取整)

物化:把 [catchup, today+PREGENERATE_DAYS] 窗口内命中的日期落成真实 Task
(幂等:按 plan_id+task_date 去重)。计划任务豁免每日容量上限。
"""
from __future__ import annotations

import json
import math
from datetime import date, datetime, time, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Plan, Task
from ..schemas import PlanCreate, PlanOut, PlanUpdate
from ..timeutil import get_zone, iso, local_today, now_utc, uuid7
from . import get_settings

#: 未来预生成天数(月历全月可见;统计按实例所属日期计,不会灌水"今日新建")
PREGENERATE_DAYS = 90
#: 追补天数:服务中断时最多回补近几天的实例,更久的不补(避免逾期堆积)
CATCHUP_DAYS = 2

RULE_TYPES = ("weekly", "interval", "weekly_times", "monthly_times")

#: 象限号 → (is_important, is_urgent)
QUADRANT_FLAGS = {1: (True, True), 2: (True, False), 3: (False, True), 4: (False, False)}

WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


# ---------- 规则解析与命中判定 ----------

def _parse_rule(rule_type: str, rule_data: Optional[str]) -> dict:
    try:
        data = json.loads(rule_data) if rule_data else {}
    except Exception:
        data = {}
    return {"type": rule_type, **(data if isinstance(data, dict) else {})}


def validate_rule(rule_type: str, rule: dict) -> None:
    if rule_type not in RULE_TYPES:
        raise HTTPException(422, f"未知规则类型: {rule_type}")
    if rule_type == "weekly":
        wd = rule.get("weekdays")
        if not isinstance(wd, list) or not wd or not all(isinstance(x, int) and 0 <= x <= 6 for x in wd):
            raise HTTPException(422, "每周固定需要 weekdays:[0-6](周一=0),至少选一天")
    elif rule_type == "interval":
        n = rule.get("interval_days")
        if not isinstance(n, int) or not 1 <= n <= 366:
            raise HTTPException(422, "每隔几天需要 interval_days:1-366")
    elif rule_type == "weekly_times":
        n = rule.get("times")
        if not isinstance(n, int) or not 1 <= n <= 7:
            raise HTTPException(422, "每周几次需要 times:1-7")
    else:  # monthly_times
        n = rule.get("times")
        if not isinstance(n, int) or not 1 <= n <= 31:
            raise HTTPException(422, "每月几次需要 times:1-31")


def weekdays_for_weekly_times(times: int) -> list[int]:
    """每周 N 次自动均摊到的固定周几(0-6)。1→[0] 2→[0,3] 3→[0,2,4] 4→[0,1,3,5] …"""
    return sorted({math.floor(i * 7 / times) for i in range(times)})


def days_for_monthly_times(times: int, days_in_month: int) -> set[int]:
    """每月 N 次自动均摊到的日期(1-based):按当月天数均分取上整。"""
    return {min(days_in_month, math.ceil((i + 1) * days_in_month / times)) for i in range(times)}


def plan_occurs_on(plan: Plan, d: date) -> bool:
    if d < plan.start_date or (plan.end_date is not None and d > plan.end_date):
        return False
    rule = _parse_rule(plan.rule_type, plan.rule_data)
    t = rule["type"]
    if t == "weekly":
        return d.weekday() in rule["weekdays"]
    if t == "interval":
        return (d - plan.start_date).days % rule["interval_days"] == 0
    if t == "weekly_times":
        return d.weekday() in weekdays_for_weekly_times(rule["times"])
    # monthly_times
    return d.day in days_for_monthly_times(rule["times"], ((d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)).day)


def describe_rule(plan: Plan) -> str:
    rule = _parse_rule(plan.rule_type, plan.rule_data)
    t = rule["type"]
    if t == "weekly":
        return "每周" + "/".join(WEEKDAY_LABELS[w] for w in sorted(rule["weekdays"]))
    if t == "interval":
        return f"每隔 {rule['interval_days']} 天"
    if t == "weekly_times":
        return f"每周 {rule['times']} 次(" + "/".join(WEEKDAY_LABELS[w] for w in weekdays_for_weekly_times(rule["times"])) + ")"
    return f"每月 {rule['times']} 次(月内自动均摊)"


# ---------- 物化 ----------

def materialize_plans(session: Session, today: date, tz_name: str = "Asia/Shanghai") -> int:
    """把窗口内的计划实例落成真实任务(幂等),返回新建条数。

    窗口:[max(start, today-CATCHUP_DAYS), today+PREGENERATE_DAYS]。
    计划任务豁免每日容量上限(它们正是"要做的事"本身)。
    """
    created = 0
    plans = session.scalars(select(Plan).where(Plan.enabled.is_(True))).all()
    if not plans:
        return 0
    win_start, win_end = today - timedelta(days=CATCHUP_DAYS), today + timedelta(days=PREGENERATE_DAYS)
    for p in plans:
        if p.end_date is not None and p.end_date < win_start:
            continue
        if p.start_date > win_end:
            continue
        lo, hi = max(p.start_date, win_start), min(p.end_date or win_end, win_end)
        existing = set(
            session.scalars(
                select(Task.task_date).where(
                    Task.plan_id == p.id,
                    Task.deleted_at.is_(None),
                    Task.task_date >= lo,
                    Task.task_date <= hi,
                )
            ).all()
        )
        imp, urg = QUADRANT_FLAGS.get(p.quadrant, (True, False))
        d = lo
        while d <= hi:
            if d not in existing and plan_occurs_on(p, d):
                # 统计按 created_at 计"每日新建":实例归属所属日期(当地中午),避免预生成灌水
                stamp = datetime(d.year, d.month, d.day, 12, 0, tzinfo=get_zone(tz_name))
                session.add(
                    Task(
                        id=uuid7(),
                        title=p.title,
                        description=p.description,
                        category_id=p.category_id,
                        is_important=imp,
                        is_urgent=urg,
                        status="pending",
                        task_date=d,
                        original_date=d,  # 原生任务:计入当日配额口径但不参与上限校验
                        created_at=stamp,
                        updated_at=stamp,
                        revision=1,
                        plan_id=p.id,
                    )
                )
                created += 1
            d += timedelta(days=1)
    if created:
        session.flush()
    return created


def _purge_future_instances(session: Session, plan_id: int | str, today: date) -> None:
    """编辑/停用后,清掉未来的未完成实例(过去的保留作历史)。"""
    rows = session.scalars(
        select(Task).where(
            Task.plan_id == plan_id,
            Task.deleted_at.is_(None),
            Task.status == "pending",
            Task.task_date >= today,
        )
    ).all()
    now = now_utc()
    for t in rows:
        t.deleted_at = now
        t.updated_at = now


# ---------- CRUD ----------

def _rule_json(rule_type: str, rule: dict) -> str:
    validate_rule(rule_type, rule)
    payload = {k: v for k, v in rule.items() if k != "type"}
    return json.dumps(payload, ensure_ascii=False)


def generated_counts(session: Session) -> dict[str, int]:
    """各计划的已生成实例数(单条 GROUP BY;列表视图用它免逐计划 COUNT 的 N+1)。"""
    return dict(
        session.execute(
            select(Task.plan_id, func.count())
            .where(Task.plan_id.is_not(None), Task.deleted_at.is_(None))
            .group_by(Task.plan_id)
        ).all()
    )


def serialize_plan(session: Session, p: Plan, today: date, counts: dict[str, int] | None = None) -> PlanOut:
    next_occurrence: Optional[date] = None
    if p.enabled:
        d = max(today, p.start_date)
        limit = p.end_date or today + timedelta(days=PREGENERATE_DAYS)
        while d <= limit:
            if plan_occurs_on(p, d):
                next_occurrence = d
                break
            d += timedelta(days=1)
    # 已生成实例统计(批量计数表优先,单计划场景退化为一条 COUNT)
    if counts is not None:
        generated = counts.get(p.id, 0)
    else:
        generated = session.scalar(
            select(func.count()).select_from(Task).where(
                Task.plan_id == p.id, Task.deleted_at.is_(None))
        ) or 0
    return PlanOut(
        id=p.id,
        title=p.title,
        description=p.description,
        category_id=p.category_id,
        start_date=iso(p.start_date),
        end_date=iso(p.end_date),
        rule_type=p.rule_type,
        rule=_parse_rule(p.rule_type, p.rule_data),
        rule_text=describe_rule(p),
        enabled=p.enabled,
        next_occurrence=iso(next_occurrence),
        generated_count=generated,
        created_at=p.created_at.isoformat(),
        updated_at=p.updated_at.isoformat(),
    )


def _get_or_404(session: Session, plan_id: str) -> Plan:
    p = session.get(Plan, plan_id)
    if p is None:
        raise HTTPException(404, "计划不存在")
    return p


def create_plan(session: Session, p: PlanCreate, today: date, tz_name: str) -> Plan:
    if p.end_date is not None and p.end_date < p.start_date:
        raise HTTPException(422, "结束时间不能早于开始时间")
    if not (p.category_id or "").strip():
        raise HTTPException(422, "计划必须选择类型(类别)")
    plan = Plan(
        id=uuid7(),
        title=p.title.strip(),
        description=p.description,
        category_id=p.category_id,
        quadrant=2,  # 计划不分象限;实例存储沿用任务表的象限列,固定占位不对外
        start_date=p.start_date,
        end_date=p.end_date,
        rule_type=p.rule.type,
        rule_data=_rule_json(p.rule.type, p.rule.model_dump()),
        enabled=True,
        created_at=now_utc(),
        updated_at=now_utc(),
    )
    session.add(plan)
    session.flush()
    materialize_plans(session, today, tz_name)
    return plan


def update_plan(session: Session, plan_id: str, p: PlanUpdate, today: date, tz_name: str) -> Plan:
    plan = _get_or_404(session, plan_id)
    fields = p.model_fields_set
    changed = False
    if "title" in fields and p.title is not None:
        plan.title = p.title.strip()
        changed = True
    if "description" in fields:
        plan.description = p.description
        changed = True
    if "category_id" in fields:
        if not (p.category_id or "").strip():
            raise HTTPException(422, "计划必须选择类型(类别)")
        plan.category_id = p.category_id
        changed = True
    if "start_date" in fields and p.start_date is not None:
        plan.start_date = p.start_date
        changed = True
    if "end_date" in fields:
        plan.end_date = p.end_date
        changed = True
    if plan.end_date is not None and plan.end_date < plan.start_date:
        raise HTTPException(422, "结束时间不能早于开始时间")
    if "rule" in fields and p.rule is not None:
        plan.rule_type = p.rule.type
        plan.rule_data = _rule_json(p.rule.type, p.rule.model_dump())
        changed = True
    if "enabled" in fields and p.enabled is not None:
        plan.enabled = p.enabled
        changed = True
    if changed:
        plan.updated_at = now_utc()
        # 规则/日期/类别变更或停用:清未来未完成实例重新生成;仅改标题等则同步未来实例文案
        disabling = "enabled" in fields and plan.enabled is False
        if (
            "rule" in fields
            or "start_date" in fields
            or "end_date" in fields
            or "category_id" in fields
            or disabling
        ):
            _purge_future_instances(session, plan.id, today)
        else:
            for t in session.scalars(
                select(Task).where(
                    Task.plan_id == plan.id, Task.deleted_at.is_(None), Task.task_date >= today
                )
            ).all():
                if "title" in fields:
                    t.title = plan.title
                if "description" in fields:
                    t.description = plan.description
                t.updated_at = now_utc()
        materialize_plans(session, today, tz_name)
    return plan


def delete_plan(session: Session, plan_id: str, today: date) -> None:
    plan = _get_or_404(session, plan_id)
    _purge_future_instances(session, plan.id, today)
    session.delete(plan)


# ---------- 规律生活专用视图 ----------

def life_today(session: Session, view: date) -> dict:
    """今日打卡视图:每个"今天有安排"的计划 + 其实例任务(可能已完成/错过)。"""
    today = local_today_view(session)
    plans = session.scalars(select(Plan).where(Plan.enabled.is_(True))).all()
    rows = session.scalars(
        select(Task).where(
            Task.plan_id.is_not(None),
            Task.deleted_at.is_(None),
            Task.task_date == view,
        )
    ).all()
    counts = generated_counts(session)
    plan_ids = {p.id for p in plans}
    by_plan: dict[str, Task] = {t.plan_id: t for t in rows if t.plan_id in plan_ids}
    orphans = [t for t in rows if t.plan_id not in plan_ids]
    items = []
    for p in sorted(plans, key=lambda x: x.created_at):
        if not plan_occurs_on(p, view):
            continue
        t = by_plan.get(p.id)
        items.append(
            {
                "title": t.title if t else p.title,
                "plan": serialize_plan(session, p, today, counts),
                "task": serialize_life_task(t),
            }
        )
    # 计划已删除的历史实例:照样展示,否则打卡记录凭空消失
    for t in sorted(orphans, key=lambda x: x.title):
        items.append({"title": t.title, "plan": None, "task": serialize_life_task(t)})
    return {"date": iso(view), "items": items}


def serialize_life_task(t: Optional[Task]) -> Optional[dict]:
    if t is None:
        return None
    return {
        "id": t.id,
        "title": t.title,
        "status": t.status,
        "completion_note": t.completion_note,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        "task_date": iso(t.task_date),
        "revision": t.revision,
    }


def local_today_view(session: Session) -> date:
    return local_today(get_settings(session)["timezone"])


def plan_report(session: Session, days: int = 30) -> dict:
    """规律生活回顾/统计:按计划的完成率、连续天数 + 每日趋势。"""
    today = local_today_view(session)
    days = max(7, min(365, days))
    start = today - timedelta(days=days - 1)
    plans = session.scalars(select(Plan).order_by(Plan.created_at)).all()
    tasks = session.scalars(
        select(Task).where(
            Task.plan_id.is_not(None),
            Task.deleted_at.is_(None),
            Task.task_date >= start,
            Task.task_date <= today,
        )
    ).all()
    plan_ids = {p.id for p in plans}
    by_plan: dict[str, dict[str, Task]] = {}
    orphans: dict[str, Task] = {}  # key=task id(同日可能有多条,不能按日期去重)
    for t in tasks:
        if t.plan_id in plan_ids:
            by_plan.setdefault(t.plan_id, {})[iso(t.task_date)] = t
        else:
            orphans[t.id] = t

    per_plan = []
    day_scheduled = {iso(start + timedelta(days=i)): 0 for i in range(days)}
    day_completed = dict(day_scheduled)
    gen_counts = generated_counts(session)
    for t in orphans.values():
        ds = iso(t.task_date)
        if ds in day_scheduled:
            day_scheduled[ds] += 1
            if t.status == "done":
                day_completed[ds] += 1
    for p in plans:
        inst = by_plan.get(p.id, {})
        sched_dates: list[date] = []
        completed = 0
        missed = 0
        for i in range(days):
            d = start + timedelta(days=i)
            if p.start_date > d or (p.end_date is not None and p.end_date < d):
                continue
            if not plan_occurs_on(p, d):
                continue
            sched_dates.append(d)
            ds = iso(d)
            day_scheduled[ds] += 1
            t = inst.get(ds)
            if t is not None and t.status == "done":
                completed += 1
                day_completed[ds] += 1
            elif d < today:
                missed += 1
        # 连续天数:从今天(或最后一个安排日)往回数连续完成
        cur = 0
        probe = today
        guard = 0
        while guard < 400:
            guard += 1
            if p.start_date > probe or (p.end_date is not None and p.end_date < probe):
                break
            if plan_occurs_on(p, probe):
                t = inst.get(iso(probe))
                if t is not None and t.status == "done":
                    cur += 1
                elif probe < today:
                    break  # 错过一天即断
                # 探测到今天且未完成 → 不计也不断(今天还没过完)
            probe -= timedelta(days=1)
        # 窗口内最佳连续
        best = run = 0
        for d in sched_dates:
            t = inst.get(iso(d))
            if t is not None and t.status == "done":
                run += 1
                best = max(best, run)
            else:
                run = 0
        last_done: Optional[str] = None
        for d in reversed(sched_dates):
            t = inst.get(iso(d))
            if t is not None and t.status == "done":
                last_done = iso(d)
                break
        per_plan.append(
            {
                "title": p.title,
                "plan": serialize_plan(session, p, today, gen_counts),
                "scheduled": len(sched_dates),
                "completed": completed,
                "missed": missed,
                "rate": round(completed / len(sched_dates), 4) if sched_dates else None,
                "current_streak": cur,
                "best_streak": best,
                "last_done": last_done,
            }
        )
    if orphans:
        items = sorted(orphans.values(), key=lambda t: (t.task_date, t.id))
        done = [t for t in items if t.status == "done"]
        missed = sum(
            1 for t in items if t.status != "done" and t.task_date is not None and t.task_date < today
        )
        best = run = 0
        for t in items:
            if t.status == "done":
                run += 1
                best = max(best, run)
            else:
                run = 0
        per_plan.append(
            {
                "plan": None,
                "title": "已删除的计划",
                "scheduled": len(items),
                "completed": len(done),
                "missed": missed,
                "rate": round(len(done) / len(items), 4) if items else None,
                "current_streak": 0,
                "best_streak": best,
                "last_done": max(
                    (iso(t.completed_at.date()) if t.completed_at else iso(t.task_date) for t in done),
                    default=None,
                ),
            }
        )
    return {
        "days": days,
        "start": iso(start),
        "end": iso(today),
        "plans": per_plan,
        "trend": [
            {"date": ds, "scheduled": day_scheduled[ds], "completed": day_completed[ds]}
            for ds in sorted(day_scheduled)
        ],
    }
