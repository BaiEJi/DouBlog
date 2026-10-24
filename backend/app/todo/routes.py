"""todo 路由:MyTodo /api/v1/* → Doublog /api/todo/* 信封化移植(docs/todo-migration.md)。

移植要点:
- 全部端点挂 Depends(require_basic)(router 级);响应一律 api_response(原返回值)
- 服务层 HTTPException(code, msg) 就地转 api_response(None, code, msg)——
  Doublog 全局 404 处理器会把 detail 覆盖为"资源不存在",必须显式返回保住原文案
- pydantic body 校验失败由 Doublog 处理器统一出 400 信封(规范允许)
- 会话 = db.session;DB 端点 async def + 同步闭包进 run_db;写端点显式 commit
- /today 路由内保留 30s 节流的计划物化(节流时间戳挂 app.state,多 app 测试互不干扰)
"""
from __future__ import annotations

import json
import time
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, select

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.response import api_response

from . import readcache
from .models import Category, Plan, Task, TaskEvent
from .schemas import (
    BulkMigrateIn,
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    CompleteIn,
    DecideIn,
    EventOut,
    MigrateIn,
    PlanCreate,
    PlanUpdate,
    SettingsUpdate,
    TaskCreate,
    TaskDetailOut,
    TaskMoveIn,
    TaskReorderIn,
    TaskUpdate,
)
from .services import day as day_svc
from .services import get_settings, save_settings
from .services import migrations as mig
from .services import plans as plan_svc
from .services import stats as stats_svc
from .services import tasks as task_svc
from .services.notify import CHANNEL_LABELS, IMPLEMENTED_CHANNELS, dispatch
from app.shared.timeutil import local_today, now_utc, uuid7

# ---------- 子路由(全部挂 require_basic) ----------

tasks_router = APIRouter(prefix="/api/todo/tasks", tags=["todo"],
                         dependencies=[Depends(require_basic)])
categories_router = APIRouter(prefix="/api/todo/categories", tags=["todo"],
                              dependencies=[Depends(require_basic)])
plans_router = APIRouter(prefix="/api/todo/plans", tags=["todo"],
                         dependencies=[Depends(require_basic)])
day_router = APIRouter(prefix="/api/todo", tags=["todo"],
                       dependencies=[Depends(require_basic)])
migrations_router = APIRouter(prefix="/api/todo", tags=["todo"],
                              dependencies=[Depends(require_basic)])
stats_router = APIRouter(prefix="/api/todo/stats", tags=["todo"],
                         dependencies=[Depends(require_basic)])
settings_router = APIRouter(prefix="/api/todo/settings", tags=["todo"],
                            dependencies=[Depends(require_basic)])
notifications_router = APIRouter(prefix="/api/todo/notifications", tags=["todo"],
                                 dependencies=[Depends(require_basic)])

router = APIRouter()
for _r in (tasks_router, categories_router, plans_router, day_router,
           migrations_router, stats_router, settings_router, notifications_router):
    router.include_router(_r)


# ---------- 公共小工具 ----------

def _dump(x):
    """pydantic Out 模型(含嵌套)→ 原生 JSON 结构(信封序列化不再走 FastAPI 管线)。"""
    if isinstance(x, BaseModel):
        return x.model_dump(mode="json")
    if isinstance(x, list):
        return [_dump(i) for i in x]
    if isinstance(x, dict):
        return {k: _dump(v) for k, v in x.items()}
    return x


def _today(session):
    return local_today(get_settings(session)["timezone"])


def _tz(session) -> str:
    return get_settings(session)["timezone"]


def _guard(fn):
    """同步闭包包装:服务层 HTTPException(code, msg) → 显式错误信封(保留原始文案)。

    异常被就地吞掉后 run_db 结束照常 rollback(等同 MyTodo 依赖的异常回滚语义)。
    """
    def inner():
        try:
            return fn()
        except HTTPException as e:
            return api_response(None, e.status_code, str(e.detail))
    return inner


# ---------- tasks ----------

@tasks_router.get('/calendar')
async def task_calendar(from_: str = Query(..., alias='from'), to: str = ..., plan_only: bool = False):
    return await run_db(_guard(lambda: api_response(task_svc.calendar_summary(db.session, from_, to, plan_only))))

@tasks_router.get("")
async def list_tasks(
    date: Optional[str] = None,
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    inbox: bool = False,
    overdue: bool = False,
    status: str = "active",
    category_id: Optional[str] = None,
    quadrant: Optional[int] = None,
    q: Optional[str] = None,
    sort: str = "position",
    plan_only: bool = False,      # true: 只看规律生活计划实例
    exclude_plans: bool = False,  # true: 排除计划实例(Todo 视图用)
    page: Optional[int] = None,
    page_size: int = 50,
):
    def _impl():
        session = db.session
        today = _today(session)
        rows = task_svc.list_tasks(
            session,
            date_str=date,
            from_str=from_,
            to_str=to,
            inbox=inbox,
            overdue=overdue,
            status=status,
            category_id=category_id,
            quadrant=quadrant,
            q=q,
            sort=sort,
            plan_only=plan_only,
            exclude_plans=exclude_plans,
            page=page, page_size=page_size,
            today=today,
        )
        items = rows['items'] if page is not None else rows
        cats = task_svc._category_map(session) if any(t.category_id for t in items) else None
        # 列表序列化走原生 dict(与 TaskOut.model_dump(mode="json") 键值一致),省 pydantic 往返
        if page is not None:
            return api_response({**rows, 'items': [task_svc.serialize_task_dict(t, today, cats) for t in rows['items']]})
        return api_response([task_svc.serialize_task_dict(t, today, cats) for t in rows])
    return await run_db(_guard(_impl))


@tasks_router.post("")
async def create_task(p: TaskCreate):
    def _impl():
        session = db.session
        t = task_svc.create_task(session, p)
        session.commit()
        readcache.bump()
        # 无类别的任务免类别表查询(类别名/色必为 null)
        cats = task_svc._category_map(session) if t.category_id else None
        return api_response(
            _dump(task_svc.serialize_task(t, _today(session), cats)), 201
        )
    return await run_db(_guard(_impl))


@tasks_router.get("/{task_id}")
async def get_task(task_id: str):
    def _impl():
        session = db.session
        t = task_svc._get_or_404(session, task_id)
        base = task_svc.serialize_task(t, _today(session), task_svc._category_map(session))
        events = list(
            session.scalars(
                select(TaskEvent).where(TaskEvent.task_id == task_id).order_by(TaskEvent.created_at.desc()).limit(50)
            )
        )
        return api_response(
            _dump(TaskDetailOut(**base.model_dump(), events=[EventOut.model_validate(e) for e in events]))
        )
    return await run_db(_guard(_impl))


@tasks_router.patch("/{task_id}")
async def update_task(task_id: str, p: TaskUpdate):
    def _impl():
        session = db.session
        t = task_svc.update_task(session, task_id, p)
        session.commit()
        readcache.bump()
        return api_response(_dump(task_svc.serialize_task(t, _today(session), task_svc._category_map(session))))
    return await run_db(_guard(_impl))


@tasks_router.delete("/{task_id}")
async def delete_task(task_id: str):
    def _impl():
        task_svc.soft_delete_task(db.session, task_id)
        db.session.commit()
        readcache.bump()
        return api_response({"ok": True})
    return await run_db(_guard(_impl))


@tasks_router.post("/{task_id}/restore")
async def restore_task(task_id: str):
    def _impl():
        session = db.session
        t = task_svc.restore_task(session, task_id)
        session.commit()
        readcache.bump()
        return api_response(_dump(task_svc.serialize_task(t, _today(session), task_svc._category_map(session))))
    return await run_db(_guard(_impl))


@tasks_router.post("/{task_id}/complete")
async def complete_task(task_id: str, p: CompleteIn | None = None):
    def _impl():
        session = db.session
        t = task_svc.complete_task(session, task_id, p.completed_at if p else None, p.note if p else None)
        session.commit()
        readcache.bump()
        return api_response(_dump(task_svc.serialize_task(t, _today(session), task_svc._category_map(session))))
    return await run_db(_guard(_impl))


@tasks_router.post("/{task_id}/reopen")
async def reopen_task(task_id: str):
    def _impl():
        session = db.session
        t = task_svc.reopen_task(session, task_id)
        session.commit()
        readcache.bump()
        return api_response(_dump(task_svc.serialize_task(t, _today(session), task_svc._category_map(session))))
    return await run_db(_guard(_impl))


@tasks_router.post("/{task_id}/move")
async def move_task(task_id: str, p: TaskMoveIn):
    def _impl():
        session = db.session
        def mutate():
            t = task_svc.move_task(session, task_id, p)
            return _dump(task_svc.serialize_task(t, _today(session), task_svc._category_map(session)))
        result = task_svc.reorder_mutation(session, task_id, p, 'move', mutate)
        session.commit()
        readcache.bump()
        return api_response(result)
    return await run_db(_guard(_impl))


@tasks_router.post("/{task_id}/reorder")
async def reorder_task(task_id: str, p: TaskReorderIn):
    def _impl():
        session = db.session
        def mutate():
            t = task_svc.reorder_task(session, task_id, p)
            return _dump(task_svc.serialize_task(t, _today(session), task_svc._category_map(session)))
        result = task_svc.reorder_mutation(session, task_id, p, 'reorder', mutate)
        session.commit()
        readcache.bump()
        return api_response(result)
    return await run_db(_guard(_impl))


# ---------- categories ----------

def _to_out(c: Category, task_count: int) -> CategoryOut:
    out = CategoryOut.model_validate(c)
    out.task_count = task_count
    return out


def _count_active(session, cat_id: str) -> int:
    return (
        session.scalar(
            select(func.count())
            .select_from(Task)
            .where(
                Task.category_id == cat_id,
                Task.deleted_at.is_(None),
                Task.status.in_(("pending", "in_progress")),
            )
        )
        or 0
    )


@categories_router.get("")
async def list_categories(include_archived: bool = False):
    def _impl():
        session = db.session
        stmt = select(Category).order_by(Category.sort_order, Category.created_at)
        if not include_archived:
            stmt = stmt.where(Category.is_archived.is_(False))
        cats = list(session.scalars(stmt))
        # 单条 GROUP BY 取全部类别的活跃任务数(原先逐类别一条 COUNT,N+1)
        counts = dict(
            session.execute(
                select(Task.category_id, func.count())
                .where(
                    Task.deleted_at.is_(None),
                    Task.status.in_(("pending", "in_progress")),
                    Task.category_id.is_not(None),
                )
                .group_by(Task.category_id)
            ).all()
        )
        return api_response(_dump([_to_out(c, counts.get(c.id, 0)) for c in cats]))
    return await run_db(_impl)


@categories_router.post("")
async def create_category(p: CategoryCreate):
    def _impl():
        session = db.session
        now = now_utc()
        c = Category(
            id=uuid7(), name=p.name.strip(), color=p.color, icon=p.icon,
            sort_order=p.sort_order, is_archived=False, created_at=now, updated_at=now,
        )
        session.add(c)
        session.commit()
        readcache.bump()
        return api_response(_dump(_to_out(c, 0)), 201)
    return await run_db(_impl)


@categories_router.patch("/{cat_id}")
async def update_category(cat_id: str, p: CategoryUpdate):
    def _impl():
        session = db.session
        c = session.get(Category, cat_id)
        if c is None:
            return api_response(None, 404, "类别不存在")
        for field in ("name", "color", "icon", "sort_order", "is_archived"):
            v = getattr(p, field)
            if v is not None:
                setattr(c, field, v)
        c.updated_at = now_utc()
        session.commit()
        readcache.bump()
        return api_response(_dump(_to_out(c, _count_active(session, c.id))))
    return await run_db(_impl)


@categories_router.delete("/{cat_id}")
async def delete_category(cat_id: str):
    def _impl():
        session = db.session
        c = session.get(Category, cat_id)
        if c is None:
            return api_response(None, 404, "类别不存在")
        n = session.scalar(
            select(func.count()).select_from(Task).where(Task.category_id == cat_id, Task.deleted_at.is_(None))
        ) or 0
        session.query(Task).filter(Task.category_id == cat_id).update({"category_id": None})
        session.delete(c)
        session.commit()
        readcache.bump()
        return api_response({"ok": True, "moved_to_uncategorized": n})
    return await run_db(_impl)


# ---------- plans(规律生活) ----------

@plans_router.get("")
async def list_plans():
    def _impl():
        session = db.session
        today = _today(session)
        rows = session.scalars(select(Plan).order_by(Plan.created_at)).all()
        counts = plan_svc.generated_counts(session)
        return api_response(_dump([plan_svc.serialize_plan(session, p, today, counts) for p in rows]))
    return await run_db(_impl)


@plans_router.post("")
async def create_plan(p: PlanCreate):
    def _impl():
        session = db.session
        plan = plan_svc.create_plan(session, p, _today(session), _tz(session))
        session.commit()
        readcache.bump()
        return api_response(_dump(plan_svc.serialize_plan(session, plan, _today(session))), 201)
    return await run_db(_guard(_impl))


@plans_router.get("/today")
async def life_today(date: Optional[str] = None):
    """规律生活 · 今日:当天有安排的计划与其实例(打卡视图)。"""
    def _impl():
        session = db.session
        view = local_today(_tz(session))
        if date:
            from datetime import date as _d

            try:
                view = _d.fromisoformat(date)
            except ValueError:
                return api_response(None, 422, f"非法日期: {date}")
        return api_response(_dump(plan_svc.life_today(session, view)))
    return await run_db(_impl)


@plans_router.get("/report")
async def plan_report(days: int = 30):
    """规律生活 · 回顾/统计:按计划完成率与连续天数 + 每日趋势。"""
    def _impl():
        d = max(7, min(365, days))
        return api_response(_dump(plan_svc.plan_report(db.session, d)))
    return await run_db(_impl)


@plans_router.patch("/{plan_id}")
async def update_plan(plan_id: str, p: PlanUpdate):
    def _impl():
        session = db.session
        plan = plan_svc.update_plan(session, plan_id, p, _today(session), _tz(session))
        session.commit()
        readcache.bump()
        return api_response(_dump(plan_svc.serialize_plan(session, plan, _today(session))))
    return await run_db(_guard(_impl))


@plans_router.delete("/{plan_id}")
async def delete_plan(plan_id: str):
    def _impl():
        session = db.session
        plan_svc.delete_plan(session, plan_id, _today(session))
        session.commit()
        readcache.bump()
        return api_response({"ok": True})
    return await run_db(_guard(_impl))


# ---------- day(今日四象限聚合) ----------

def _today_envelope(data) -> bytes:
    """与 api_response 200 输出同构的信封字节(紧凑分隔符,同 starlette JSONResponse)。"""
    return json.dumps(
        {"success": True, "code": 200, "message": "操作成功", "data": data},
        ensure_ascii=False, separators=(",", ":"),
    ).encode("utf-8")


@day_router.get("/today")
async def today(request: Request, date: Optional[str] = None):
    def _impl():
        session = db.session
        # 规律生活计划:打开看板时按 30s 节流补齐任务实例(幂等,含回补近几天);
        # 节流时间戳挂 app.state(禁模块级单例,多 app 测试互不干扰)
        if time.time() - getattr(request.app.state, "todo_mat_at", 0.0) > 30:
            request.app.state.todo_mat_at = time.time()
            tz = _tz(session)
            created = plan_svc.materialize_plans(session, local_today(tz), tz)
            if created:  # 无新实例不 commit,避免 SQLite 写锁拖慢并发读
                session.commit()
                readcache.bump()
        view_date = date or "today"
        # 响应缓存:同一(view_date, 本地今日)且期间无 todo 写入 → 直接回信封字节。
        # 写端点 commit 后 bump 令全部键失效;跨午夜键自然变化,无需 TTL。
        cache_state = getattr(request.app.state, "todo_today_cache", None)
        if cache_state is None:
            cache_state = {}
            request.app.state.todo_today_cache = cache_state
        from app.db import current_runtime
        runtime = current_runtime()
        key = (runtime.identity, runtime.generation, view_date, local_today(_tz(session)))
        cached = readcache.get(cache_state, key)
        if cached is not None:
            return Response(content=cached, media_type="application/json")
        read_epoch = readcache.epoch()
        try:
            out = day_svc.get_today(session, view_date)
        except ValueError as e:
            return api_response(None, 422, str(e))
        body = _today_envelope(out)
        readcache.put(cache_state, key, body, read_epoch)
        return Response(content=body, media_type="application/json")
    return await run_db(_impl)


# ---------- migrations(迁移链) ----------

@migrations_router.get("/migrations/pending")
async def pending():
    def _impl():
        return api_response(_dump(mig.pending_migrations(db.session)))
    return await run_db(_guard(_impl))


@migrations_router.get("/migrations/shelved")
async def shelved():
    def _impl():
        return api_response(_dump(mig.shelved_tasks(db.session)))
    return await run_db(_guard(_impl))


@migrations_router.post("/tasks/{task_id}/migrate")
async def migrate_one(task_id: str, p: MigrateIn):
    def _impl():
        session = db.session
        t = mig.migrate_task(session, task_id, p.to_date, p.reason)
        session.commit()
        readcache.bump()
        return api_response(_dump(task_svc.serialize_task(t, _today(session))))
    return await run_db(_guard(_impl))


@migrations_router.post("/migrations/bulk")
async def migrate_bulk(p: BulkMigrateIn):
    def _impl():
        session = db.session
        n = mig.bulk_migrate(session, p.task_ids, p.to_date, p.reason)
        session.commit()
        readcache.bump()
        return api_response({"migrated": n})
    return await run_db(_guard(_impl))


@migrations_router.post("/migrations/decide")
async def decide(p: DecideIn):
    def _impl():
        session = db.session
        out = mig.decide(session, p.task_id, p.decision)
        session.commit()
        readcache.bump()
        return api_response(out)
    return await run_db(_guard(_impl))


@migrations_router.post("/migrations/auto")
async def auto_migrate():
    def _impl():
        session = db.session
        n = mig.auto_migrate(session)
        session.commit()
        readcache.bump()
        return api_response({"migrated": n})
    return await run_db(_guard(_impl))


# ---------- stats ----------

@stats_router.get("/daily")
async def daily(date: Optional[str] = None):
    def _impl():
        return api_response(stats_svc.daily_stats(db.session, date))
    return await run_db(_impl)


@stats_router.get("/range")
async def range_stats(from_: str = Query(..., alias="from"), to: str = ...):
    def _impl():
        try:
            return api_response(stats_svc.range_stats(db.session, from_, to))
        except ValueError as e:
            return api_response(None, 422, str(e))
    return await run_db(_impl)


@stats_router.get("/heatmap")
async def heatmap(year: int):
    def _impl():
        if not 2000 <= year <= 2100:
            return api_response(None, 422, "年份非法")
        return api_response(stats_svc.heatmap(db.session, year))
    return await run_db(_impl)


@stats_router.get("/streak")
async def streak():
    def _impl():
        return api_response(stats_svc.compute_streak(db.session, _tz(db.session)))
    return await run_db(_impl)


# ---------- settings ----------

@settings_router.get("")
async def read_settings():
    def _impl():
        return api_response(get_settings(db.session))
    return await run_db(_impl)


@settings_router.put("")
async def update_settings(p: SettingsUpdate):
    def _impl():
        session = db.session
        patch = p.model_dump(exclude_unset=True)
        if "timezone" in patch and patch["timezone"]:
            try:
                ZoneInfo(patch["timezone"])
            except Exception:
                return api_response(None, 422, f"非法时区: {patch['timezone']}")
        if "notifications" in patch and patch["notifications"] is not None:
            n = patch["notifications"]
            channels = n.get("channels") if isinstance(n, dict) else None
            if not isinstance(channels, dict):
                return api_response(None, 422, "notifications 格式非法: 需要 {channels: {渠道名: 配置}}")
            for name, cfg in channels.items():
                if not isinstance(cfg, dict):
                    return api_response(None, 422, f"渠道 {name} 的配置必须是对象")
        out = save_settings(session, patch)
        session.commit()
        readcache.bump()
        return api_response(out)
    return await run_db(_impl)


# ---------- notifications(测试发送) ----------

class NotificationTestIn(BaseModel):
    channel: str


def _channel_config(session, channel: str) -> dict:
    if channel not in CHANNEL_LABELS:
        raise HTTPException(404, f"未知推送渠道: {channel}")
    settings = get_settings(session)
    channels = ((settings.get("notifications") or {}).get("channels")) or {}
    cfg = channels.get(channel)
    if not isinstance(cfg, dict):
        raise HTTPException(400, f"{CHANNEL_LABELS[channel]} 尚未配置,请先在设置页保存配置")
    if not cfg.get("enabled"):
        raise HTTPException(400, f"{CHANNEL_LABELS[channel]} 未启用,请先在设置页启用并保存")
    if channel not in IMPLEMENTED_CHANNELS:
        raise HTTPException(400, f"{CHANNEL_LABELS[channel]} 发送端尚未接入(预留),当前支持:邮件推送")
    return cfg


@notifications_router.post("/test")
async def test_notification(p: NotificationTestIn):
    """向指定渠道发送一条测试消息,用于配置页「测试发送」按钮。"""
    def _impl():
        session = db.session
        cfg = _channel_config(session, p.channel)
        try:
            dispatch(
                p.channel,
                cfg,
                "MyTodo 推送测试",
                "这是一封 MyTodo 测试消息:该渠道配置成功,未完成任务的定时提醒将推送到这里。",
            )
        except ValueError as e:
            return api_response(None, 422, str(e))
        except Exception as e:  # SMTP 连接/认证/发送失败等
            return api_response(None, 502, f"发送失败: {e}")
        return api_response({"ok": True, "message": f"测试消息已发送({CHANNEL_LABELS[p.channel]})"})
    return await run_db(_guard(_impl))
