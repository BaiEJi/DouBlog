"""任务服务:CRUD、完成/重开、象限移动(浮点中点排序)、软删除。"""
from __future__ import annotations

import json
import hashlib
from datetime import date
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from ..limits import DAY_TOTAL_LIMIT, QUADRANT_DAILY_LIMIT
from ..models import Category, Task, TaskMutation, TaskDayLock
from ..schemas import TaskCreate, TaskMoveIn, TaskOut, TaskReorderIn, TaskUpdate
from app.shared.timeutil import ensure_aware, iso, local_today, now_utc, uuid7
from . import get_settings, log_event

ACTIVE_STATUSES = ("pending", "in_progress")


def _notify_channels_list(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    try:
        v = json.loads(raw)
        return v if isinstance(v, list) else []
    except Exception:
        return []


def _check_notify_complete(enabled: bool, when: Optional[str], channels: list[str]) -> None:
    """启用通知时必须同时有时间与至少一个渠道(合并校验,更新场景拼接既有值后判断)。"""
    if enabled and (not when or not channels):
        missing = []
        if not when:
            missing.append("notify_time")
        if not channels:
            missing.append("notify_channels")
        raise HTTPException(422, f"启用通知需要同时提供: {','.join(missing)}")

STEP = 1024.0


def quadrant_of(is_important: bool, is_urgent: bool) -> int:
    if is_important and is_urgent:
        return 1
    if is_important:
        return 2
    if is_urgent:
        return 3
    return 4


def flags_of(quadrant: int) -> tuple[bool, bool]:
    return {
        1: (True, True),
        2: (True, False),
        3: (False, True),
        4: (False, False),
    }[quadrant]


# ---------- 序列化 ----------

def _category_map(session: Session) -> dict[str, Category]:
    return {c.id: c for c in session.scalars(select(Category))}


def serialize_task(t: Task, today: date, cats: dict[str, Category] | None = None) -> TaskOut:
    """model_construct 跳过字段验证:字段全部来自已校验的 DB 列,省 pydantic 开销。"""
    cat = (cats or {}).get(t.category_id) if t.category_id else None
    days = None
    if t.status == "pending" and t.original_date is not None:
        days = (today - t.original_date).days
    return TaskOut.model_construct(
        id=t.id,
        title=t.title,
        description=t.description,
        category_id=t.category_id,
        category_name=cat.name if cat else None,
        category_color=cat.color if cat else None,
        is_important=t.is_important,
        is_urgent=t.is_urgent,
        quadrant=quadrant_of(t.is_important, t.is_urgent),
        position=t.position,
        status=t.status,
        task_date=iso(t.task_date),
        original_date=iso(t.original_date),
        due_at=ensure_aware(t.due_at),
        due_is_full_day=t.due_is_full_day,
        migrated_count=t.migrated_count,
        last_migrated_from=iso(t.last_migrated_from),
        days_procrastinated=days,
        shelved_at=ensure_aware(t.shelved_at),
        estimate_minutes=t.estimate_minutes,
        notify_enabled=bool(t.notify_enabled),
        notify_time=t.notify_time,
        notify_channels=_notify_channels_list(t.notify_channels),
        completion_note=t.completion_note,
        plan_id=t.plan_id,
        completed_at=ensure_aware(t.completed_at),
        created_at=ensure_aware(t.created_at),
        updated_at=ensure_aware(t.updated_at),
        revision=t.revision,
        deleted_at=ensure_aware(t.deleted_at),
    )


def _iso_ts(d) -> Optional[str]:
    """datetime → 与 pydantic model_dump(mode="json") 一致的 ISO 字符串。

    pydantic v2 对 UTC 偏移输出 "...Z" 后缀(isoformat 是 "+00:00"),需对齐;
    naive 一律按 UTC(全库时间约定),避免逐值 replace() 分配。"""
    if d is None:
        return None
    if d.tzinfo is None:
        return d.isoformat() + "Z"
    s = d.isoformat()
    return s[:-6] + "Z" if s.endswith("+00:00") else s


def serialize_task_dict(t: Task, today: date, cats: dict[str, Category] | None = None) -> dict:
    """serialize_task 的原生 dict 版本(键值与 TaskOut.model_dump(mode="json") 完全一致)。

    列表/聚合接口专用:跳过 pydantic construct + dump 两层往返,
    大列表(/tasks、/today、待迁移)下省一半以上的序列化 CPU。
    """
    cat = (cats or {}).get(t.category_id) if t.category_id else None
    days = None
    if t.status == "pending" and t.original_date is not None:
        days = (today - t.original_date).days
    return {
        "id": t.id,
        "title": t.title,
        "description": t.description,
        "category_id": t.category_id,
        "category_name": cat.name if cat else None,
        "category_color": cat.color if cat else None,
        "is_important": t.is_important,
        "is_urgent": t.is_urgent,
        "quadrant": quadrant_of(t.is_important, t.is_urgent),
        "position": t.position,
        "status": t.status,
        "task_date": iso(t.task_date),
        "original_date": iso(t.original_date),
        "due_at": _iso_ts(t.due_at),
        "due_is_full_day": t.due_is_full_day,
        "migrated_count": t.migrated_count,
        "last_migrated_from": iso(t.last_migrated_from),
        "days_procrastinated": days,
        "shelved_at": _iso_ts(t.shelved_at),
        "estimate_minutes": t.estimate_minutes,
        "notify_enabled": bool(t.notify_enabled),
        "notify_time": t.notify_time,
        "notify_channels": _notify_channels_list(t.notify_channels),
        "completion_note": t.completion_note,
        "plan_id": t.plan_id,
        "completed_at": _iso_ts(t.completed_at),
        "created_at": _iso_ts(t.created_at),
        "updated_at": _iso_ts(t.updated_at),
        "revision": t.revision,
        "deleted_at": _iso_ts(t.deleted_at),
    }


# ---------- 排序:浮点中点插入 + 兜底重排 ----------

def _quadrant_rows(session: Session, imp: bool, urg: bool) -> list[tuple[str, float]]:
    rows = session.execute(
        select(Task.id, Task.position)
        .where(
            Task.is_important == imp,
            Task.is_urgent == urg,
            Task.deleted_at.is_(None),
            Task.status.in_(ACTIVE_STATUSES),
        )
        .order_by(Task.position)
    ).all()
    return [(r[0], float(r[1])) for r in rows]


def rebalance_quadrant(session: Session, imp: bool, urg: bool) -> None:
    rows = _quadrant_rows(session, imp, urg)
    for i, (tid, _) in enumerate(rows):
        t = session.get(Task, tid)
        if t is not None:
            t.position = float((i + 1) * STEP)


def append_position(session: Session, imp: bool, urg: bool) -> float:
    """尾部追加位置:聚合 max 下推到 SQL,不再全量拉取象限行排序。"""
    mx = session.scalar(
        select(func.max(Task.position)).where(
            Task.is_important == imp,
            Task.is_urgent == urg,
            Task.deleted_at.is_(None),
            Task.status.in_(ACTIVE_STATUSES),
        )
    )
    return (mx or 0.0) + STEP


def insert_position(session: Session, imp: bool, urg: bool, before_task_id: Optional[str]) -> float:
    """before_task_id 前的中点;None 或不存在 → 追加尾部。

    不变量:返回值恒 > 0 且不与现有 position 重复;间距耗尽/历史脏数据
    (重复、≤0)时先整体重排该象限再取中点,重排后间隔为 STEP 的整数倍,
    递归必然终止。旧实现"首行前中点"会算出 0 乃至负数,是脏 position 的来源。
    """
    rows = _quadrant_rows(session, imp, urg)
    if not rows or before_task_id is None:
        return append_position(session, imp, urg)
    ids = [r[0] for r in rows]
    if before_task_id not in ids:
        return append_position(session, imp, urg)
    i = ids.index(before_task_id)
    nxt = rows[i][1]
    if i == 0:
        if nxt > 1:
            return nxt / 2.0  # 首行前:取首行一半,恒为正
        rebalance_quadrant(session, imp, urg)
        return insert_position(session, imp, urg, before_task_id)
    prev = rows[i - 1][1]
    if nxt - prev < 1e-6 or prev <= 0 or nxt <= 0:
        rebalance_quadrant(session, imp, urg)
        return insert_position(session, imp, urg, before_task_id)
    return (prev + nxt) / 2.0


# ---------- 日期解析 ----------

def _parse_task_date(session: Session, s: Optional[str]) -> Optional[date]:
    if s is None or s == "":
        return None
    if s == "today":
        return local_today(get_settings(session)["timezone"])
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(422, f"非法日期: {s},应为 YYYY-MM-DD")


def _get_or_404(session: Session, task_id: str, include_deleted: bool = False) -> Task:
    t = session.get(Task, task_id)
    if t is None or (t.deleted_at is not None and not include_deleted):
        raise HTTPException(404, "任务不存在")
    return t


def _check_revision(t: Task, expected: int) -> None:
    if expected != t.revision:
        raise HTTPException(409, f"任务已被修改(当前 revision={t.revision}),请刷新后重试")


def claim_revision(session: Session, task: Task, expected: int | None = None) -> None:
    """先 CAS 取得写入权，再修改 ORM；校验到 flush 的窗口不能丢失并发更新。"""
    version = task.revision if expected is None else expected
    with session.no_autoflush:
        result = session.execute(update(Task).where(Task.id == task.id, Task.revision == version)
            .values(revision=version + 1).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        raise HTTPException(409, "任务已被修改，请刷新后重试")
    set_committed_value(task, 'revision', version + 1)


def reorder_mutation(session, task_id, body, operation, mutate):
    if not body.mutation_id:
        return mutate()
    session.execute(update(Task).where(Task.id == task_id).values(revision=Task.revision)
                    .execution_options(synchronize_session=False))
    fingerprint = hashlib.sha256(json.dumps({'id': task_id, 'operation': operation,
        **body.model_dump(mode='json')}, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    receipt = session.get(TaskMutation, body.mutation_id)
    if receipt:
        if receipt.fingerprint != fingerprint:
            raise HTTPException(409, 'mutation_id 已被其他内容使用')
        return receipt.result
    result = mutate()
    session.add(TaskMutation(mutation_id=body.mutation_id, fingerprint=fingerprint,
                             result=result, created_at=now_utc()))
    return result


# ---------- 每日容量上限(见 limits.py,常量可一键调整) ----------

def _native_cutoff(session: Session, day: date) -> date:
    """原生计数阈值:original_date >= cutoff 才计入当天配额。

    历史任务迁移进 day(original_date 同时早于 day 与"今天")不占配额;
    未来日之间正常改期(original_date >= 今天)仍算原生,不能借道绕限。
    """
    tz = get_settings(session)["timezone"]
    return min(day, local_today(tz))


def _day_native_cond(session: Session, day: date, imp: Optional[bool], urg: Optional[bool], exclude_id: Optional[str] = None):
    """当天"原生"任务筛选:迁移进当天的(original_date < min(day,今天))不计入。"""
    cond = [
        Task.task_date == day,
        Task.deleted_at.is_(None),
        or_(Task.original_date.is_(None), Task.original_date >= _native_cutoff(session, day)),
    ]
    if imp is not None and urg is not None:
        cond += [Task.is_important == imp, Task.is_urgent == urg]
    if exclude_id:
        cond.append(Task.id != exclude_id)
    return cond


def _is_migrated_into(session: Session, t: Task, day: date) -> bool:
    """任务是否为历史迁移进 day 的(这类不计数、不受限)。"""
    return t.original_date is not None and t.original_date < _native_cutoff(session, day)


def check_quadrant_capacity(session: Session, day: date, imp: bool, urg: bool, exclude_id: Optional[str] = None) -> None:
    if day is None:
        return
    _lock_day(session, day)
    n = session.scalar(select(func.count()).select_from(Task).where(*_day_native_cond(session, day, imp, urg, exclude_id))) or 0
    if n >= QUADRANT_DAILY_LIMIT:
        raise HTTPException(
            422,
            f"该象限当天任务已达上限({QUADRANT_DAILY_LIMIT} 个),请先完成、移出或改期",
        )


def check_day_capacity(session: Session, day: date, imp: bool, urg: bool, exclude_id: Optional[str] = None) -> None:
    """新增/改期到 day 的完整校验:单象限上限 + 四象限合计上限。

    计数经 COUNT 下推到 SQL,且两计数合并为一条查询(SUM(CASE) + COUNT)。"""
    if day is None:
        return
    _lock_day(session, day)
    cond = _day_native_cond(session, day, None, None, exclude_id)
    row = session.execute(
        select(
            func.sum(case((and_(Task.is_important == imp, Task.is_urgent == urg), 1), else_=0)),
            func.count(),
        ).where(*cond)
    ).one()
    q_n, total = int(row[0] or 0), row[1]
    if q_n >= QUADRANT_DAILY_LIMIT:
        raise HTTPException(
            422,
            f"该象限当天任务已达上限({QUADRANT_DAILY_LIMIT} 个),请先完成、移出或改期",
        )
    if total >= DAY_TOTAL_LIMIT:
        raise HTTPException(422, f"当天四象限任务合计已达上限({DAY_TOTAL_LIMIT} 个)")


def _lock_day(session, day):
    if session.bind.dialect.name == 'postgresql':
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    session.execute(insert(TaskDayLock).values(day=day, touch=0).on_conflict_do_nothing(index_elements=['day']))
    session.execute(update(TaskDayLock).where(TaskDayLock.day == day).values(touch=TaskDayLock.touch)
                    .execution_options(synchronize_session=False))


# ---------- CRUD ----------

def create_task(session: Session, p: TaskCreate) -> Task:
    tz = get_settings(session)["timezone"]
    today = local_today(tz)
    td = _parse_task_date(session, p.task_date)
    now = now_utc()
    channels = p.notify_channels or []
    _check_notify_complete(p.notify_enabled, p.notify_time, channels)
    if td is not None:
        check_day_capacity(session, td, p.is_important, p.is_urgent)
    t = Task(
        id=uuid7(),
        title=p.title.strip(),
        description=p.description,
        category_id=p.category_id,
        is_important=p.is_important,
        is_urgent=p.is_urgent,
        position=append_position(session, p.is_important, p.is_urgent),
        status="pending",
        task_date=td,
        original_date=td,
        due_at=ensure_aware(p.due_at),
        due_is_full_day=p.due_is_full_day,
        estimate_minutes=p.estimate_minutes,
        notify_enabled=p.notify_enabled,
        notify_time=p.notify_time if p.notify_enabled else None,
        notify_channels=json.dumps(channels, ensure_ascii=False) if p.notify_enabled else None,
        created_at=now,
        updated_at=now,
        revision=1,
    )
    session.add(t)
    session.flush()
    log_event(
        session,
        t.id,
        "created",
        {"task_date": iso(td), "quadrant": quadrant_of(p.is_important, p.is_urgent), "today": iso(today)},
    )
    return t


def update_task(session: Session, task_id: str, p: TaskUpdate) -> Task:
    t = _get_or_404(session, task_id)
    _check_revision(t, p.revision)
    claim_revision(session, t, p.revision)
    changed: dict = {}
    fields = p.model_fields_set

    if "title" in fields and p.title is not None:
        t.title = p.title.strip()
        changed["title"] = True
    if "description" in fields:
        t.description = p.description
        changed["description"] = True
    if "category_id" in fields:
        t.category_id = p.category_id
        changed["category_id"] = True
    if "due_at" in fields:
        t.due_at = ensure_aware(p.due_at)
        changed["due_at"] = True
    if "due_is_full_day" in fields and p.due_is_full_day is not None:
        t.due_is_full_day = p.due_is_full_day
    if "estimate_minutes" in fields:
        t.estimate_minutes = p.estimate_minutes
        changed["estimate_minutes"] = True

    # 任务级通知:按提交字段合并,启用时校验合并结果完整
    if "notify_enabled" in fields and p.notify_enabled is not None:
        t.notify_enabled = p.notify_enabled
        changed["notify_enabled"] = True
    if "notify_time" in fields:
        t.notify_time = p.notify_time
        changed["notify_time"] = True
    if "notify_channels" in fields and p.notify_channels is not None:
        t.notify_channels = (
            json.dumps(p.notify_channels, ensure_ascii=False) if p.notify_channels else None
        )
        changed["notify_channels"] = True
    _check_notify_complete(
        bool(t.notify_enabled), t.notify_time, _notify_channels_list(t.notify_channels)
    )

    old_q = quadrant_of(t.is_important, t.is_urgent)
    if "is_important" in fields and p.is_important is not None:
        t.is_important = p.is_important
    if "is_urgent" in fields and p.is_urgent is not None:
        t.is_urgent = p.is_urgent
    new_q = quadrant_of(t.is_important, t.is_urgent)
    if new_q != old_q:
        t.position = append_position(session, t.is_important, t.is_urgent)
        changed["quadrant"] = [old_q, new_q]

    if "task_date" in fields:
        new_date = _parse_task_date(session, p.task_date)
        if new_date != t.task_date:
            changed["task_date"] = [iso(t.task_date), iso(new_date)]
            t.task_date = new_date
            t.shelved_at = None  # 重新排期即脱离搁置
            # 首次排期:写入 original_date;改回收件箱:清空迁移链起点
            if new_date is not None and t.original_date is None:
                t.original_date = new_date
            elif new_date is None:
                t.original_date = None

    # 容量上限:改期或换象限时,校验目标(日期,象限);迁移进当天的任务不受限
    date_changed = bool(changed.get("task_date"))
    if (date_changed or new_q != old_q) and t.task_date is not None and not _is_migrated_into(session, t, t.task_date):
        if date_changed:
            check_day_capacity(session, t.task_date, t.is_important, t.is_urgent, exclude_id=t.id)
        else:
            check_quadrant_capacity(session, t.task_date, t.is_important, t.is_urgent, exclude_id=t.id)

    if changed:
        t.updated_at = now_utc()
        log_event(session, t.id, "updated", changed)
    return t


def complete_task(session: Session, task_id: str, completed_at=None, note: Optional[str] = None) -> Task:
    t = _get_or_404(session, task_id)
    if t.status == "done":
        return t
    claim_revision(session, t)
    t.status = "done"
    t.completed_at = ensure_aware(completed_at) or now_utc()
    t.shelved_at = None
    # 完成备注:可选;重复完成(幂等)不覆盖已有备注
    t.completion_note = (note or "").strip() or None
    t.updated_at = now_utc()
    log_event(
        session,
        t.id,
        "completed",
        {
            "task_date": iso(t.task_date),
            "quadrant": quadrant_of(t.is_important, t.is_urgent),
            "has_note": t.completion_note is not None,
        },
    )
    return t


def reopen_task(session: Session, task_id: str) -> Task:
    t = _get_or_404(session, task_id)
    if t.status != "done" and t.status != "cancelled":
        return t
    claim_revision(session, t)
    t.status = "pending"
    t.completed_at = None
    t.shelved_at = None
    t.updated_at = now_utc()
    log_event(session, t.id, "reopened", {"from": "done_or_cancelled"})
    return t


def move_task(session: Session, task_id: str, p: TaskMoveIn) -> Task:
    """拖拽跨象限 / 象限内排序的统一入口。"""
    t = _get_or_404(session, task_id)
    claim_revision(session, t, p.revision)
    old_q = quadrant_of(t.is_important, t.is_urgent)
    new_q = quadrant_of(p.is_important, p.is_urgent)
    if (
        new_q != old_q
        and t.task_date is not None
        and not _is_migrated_into(session, t, t.task_date)
    ):
        check_quadrant_capacity(session, t.task_date, p.is_important, p.is_urgent, exclude_id=t.id)
    t.is_important = p.is_important
    t.is_urgent = p.is_urgent
    t.position = insert_position(session, p.is_important, p.is_urgent, p.before_task_id)
    t.updated_at = now_utc()
    if new_q != old_q:
        log_event(session, t.id, "quadrant_changed", {"from": old_q, "to": new_q})
    else:
        log_event(session, t.id, "reordered", {"quadrant": new_q})
    return t


def reorder_task(session: Session, task_id: str, p: TaskReorderIn) -> Task:
    t = _get_or_404(session, task_id)
    claim_revision(session, t, p.revision)
    t.position = insert_position(session, t.is_important, t.is_urgent, p.before_task_id)
    t.updated_at = now_utc()
    log_event(session, t.id, "reordered", {"quadrant": quadrant_of(t.is_important, t.is_urgent)})
    return t


def soft_delete_task(session: Session, task_id: str) -> Task:
    t = _get_or_404(session, task_id)
    claim_revision(session, t)
    t.deleted_at = now_utc()
    t.updated_at = now_utc()
    log_event(session, t.id, "deleted", {"title": t.title})
    return t


def restore_task(session: Session, task_id: str) -> Task:
    t = _get_or_404(session, task_id, include_deleted=True)
    claim_revision(session, t)
    t.deleted_at = None
    t.updated_at = now_utc()
    log_event(session, t.id, "restored", {})
    return t


# ---------- 查询 ----------

def list_tasks(
    session: Session,
    *,
    date_str: Optional[str] = None,
    from_str: Optional[str] = None,
    to_str: Optional[str] = None,
    inbox: bool = False,
    overdue: bool = False,
    status: str = "active",
    category_id: Optional[str] = None,
    quadrant: Optional[int] = None,
    q: Optional[str] = None,
    sort: str = "position",
    plan_only: bool = False,
    exclude_plans: bool = False,
    page: int | None = None,
    page_size: int = 50,
    today: Optional[date] = None,
) -> list[Task]:
    stmt = select(Task).where(Task.deleted_at.is_(None))
    if plan_only:
        stmt = stmt.where(Task.plan_id.is_not(None))
    elif exclude_plans:
        stmt = stmt.where(Task.plan_id.is_(None))
    if today is None:
        today = local_today(get_settings(session)["timezone"])

    if date_str:
        task_date = today if date_str == 'today' else _parse_task_date(session, date_str)
        stmt = stmt.where(Task.task_date == task_date)
    if from_str:
        stmt = stmt.where(Task.task_date >= date.fromisoformat(from_str))
    if to_str:
        stmt = stmt.where(Task.task_date <= date.fromisoformat(to_str))
    if inbox:
        stmt = stmt.where(Task.task_date.is_(None))
    if overdue:
        stmt = stmt.where(Task.status == "pending", Task.task_date.is_not(None), Task.task_date < today)
    if status == "active":
        stmt = stmt.where(Task.status.in_(ACTIVE_STATUSES))
    elif status in ("pending", "done", "cancelled"):
        stmt = stmt.where(Task.status == status)
    elif status == "all":
        pass
    if category_id:
        stmt = stmt.where(Task.category_id == category_id)
    if quadrant is not None:
        imp, urg = flags_of(quadrant)
        stmt = stmt.where(Task.is_important == imp, Task.is_urgent == urg)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Task.title).like(like), func.lower(Task.description).like(like)))

    order_col = {
        "position": Task.position,
        "due_at": Task.due_at,
        "created_at": Task.created_at,
        "migrated_count": Task.migrated_count,
    }.get(sort, Task.position)
    stmt = stmt.order_by(order_col, Task.id)
    if page is not None:
        if page < 1 or not 1 <= page_size <= 100:
            raise HTTPException(422, 'page/page_size 超出范围')
        total = session.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
        items = list(session.scalars(stmt.offset((page - 1) * page_size).limit(page_size)))
        return {'items': items, 'total': total, 'page': page, 'page_size': page_size}
    return list(session.scalars(stmt))


def calendar_summary(session, start, end, plan_only=False):
    try:
        start_day, end_day = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError:
        raise HTTPException(422, '日期必须为 YYYY-MM-DD') from None
    if start_day > end_day or (end_day - start_day).days > 366:
        raise HTTPException(422, '日历范围最多 367 天且开始不能晚于结束')
    conditions = [Task.deleted_at.is_(None), Task.task_date >= start_day, Task.task_date <= end_day]
    if plan_only:
        conditions.append(Task.plan_id.is_not(None))
    ranked = select(Task.id, Task.title, Task.task_date, Task.status, Task.is_important, Task.is_urgent,
        func.row_number().over(partition_by=Task.task_date, order_by=(Task.position, Task.id)).label('rank'),
        func.count().over(partition_by=Task.task_date).label('total'),
        func.sum(case((Task.status == 'done', 1), else_=0)).over(partition_by=Task.task_date).label('done')
    ).where(*conditions).subquery()
    days = {}
    for row in session.execute(select(ranked).where(ranked.c.rank <= 4).order_by(ranked.c.task_date, ranked.c.rank)):
        key = iso(row.task_date)
        day = days.setdefault(key, {'date': key, 'total': row.total, 'done': row.done, 'items': []})
        day['items'].append({'id': row.id, 'title': row.title, 'task_date': key,
                            'status': row.status, 'quadrant': quadrant_of(row.is_important, row.is_urgent)})
    return {'days': list(days.values()), 'total': sum(day['total'] for day in days.values())}
