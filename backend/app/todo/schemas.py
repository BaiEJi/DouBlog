"""Pydantic v2 请求/响应模型(照搬 MyTodo;auth/system/响应加密模型按迁移规范舍弃)。"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

# 任务级通知可选渠道(与 settings.notifications.channels 的 key 对齐)
NOTIFY_CHANNEL_KEYS = {"email", "apk", "chrome", "chatbot", "other"}
_NOTIFY_TIME_RE = re.compile(r"([01]\d|2[0-3]):[0-5]\d")


def _norm_notify_time(v: Optional[str]) -> Optional[str]:
    if v is None or v == "":
        return None
    if not _NOTIFY_TIME_RE.fullmatch(v):
        raise ValueError("notify_time 格式应为 HH:MM(如 09:30)")
    return v


def _norm_notify_channels(v: Optional[List[str]]) -> Optional[List[str]]:
    if v is None:
        return None
    bad = sorted({c for c in v if c not in NOTIFY_CHANNEL_KEYS})
    if bad:
        raise ValueError(f"未知通知渠道: {','.join(bad)}")
    return v

# ---------------- Category ----------------

class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str = Field(default="#64748B", max_length=20)
    icon: Optional[str] = Field(default=None, max_length=50)
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    color: Optional[str] = Field(default=None, max_length=20)
    icon: Optional[str] = Field(default=None, max_length=50)
    sort_order: Optional[int] = None
    is_archived: Optional[bool] = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    color: str
    icon: Optional[str] = None
    sort_order: int
    is_archived: bool
    task_count: int = 0
    created_at: datetime
    updated_at: datetime


# ---------------- Task ----------------

class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: Optional[str] = None
    category_id: Optional[str] = None
    is_important: bool = False
    is_urgent: bool = False
    task_date: Optional[str] = None  # None/""=收件箱;"today"=今天;"YYYY-MM-DD"
    due_at: Optional[datetime] = None
    due_is_full_day: bool = True
    estimate_minutes: Optional[int] = Field(default=None, ge=1, le=1440)
    # 任务级通知:当天 notify_time 仍未完成时向所选渠道推送(渠道 key 同 settings.notifications.channels)
    notify_enabled: bool = False
    notify_time: Optional[str] = None  # "HH:MM"
    notify_channels: Optional[List[str]] = None
    _v_time = field_validator("notify_time", check_fields=False)(_norm_notify_time)
    _v_chans = field_validator("notify_channels", check_fields=False)(_norm_notify_channels)


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=500)
    description: Optional[str] = None
    category_id: Optional[str] = None
    is_important: Optional[bool] = None
    is_urgent: Optional[bool] = None
    task_date: Optional[str] = None
    due_at: Optional[datetime] = None
    due_is_full_day: Optional[bool] = None
    estimate_minutes: Optional[int] = Field(default=None, ge=1, le=1440)
    notify_enabled: Optional[bool] = None
    notify_time: Optional[str] = None
    notify_channels: Optional[List[str]] = None
    revision: int  # 乐观锁必填
    _v_time = field_validator("notify_time", check_fields=False)(_norm_notify_time)
    _v_chans = field_validator("notify_channels", check_fields=False)(_norm_notify_channels)


class TaskOut(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    category_id: Optional[str] = None
    category_name: Optional[str] = None
    category_color: Optional[str] = None
    is_important: bool
    is_urgent: bool
    quadrant: int
    position: float
    status: str
    task_date: Optional[str] = None
    original_date: Optional[str] = None
    due_at: Optional[datetime] = None
    due_is_full_day: bool
    migrated_count: int
    last_migrated_from: Optional[str] = None
    days_procrastinated: Optional[int] = None
    shelved_at: Optional[datetime] = None
    estimate_minutes: Optional[int] = None
    notify_enabled: bool = False
    notify_time: Optional[str] = None
    notify_channels: List[str] = []
    completion_note: Optional[str] = None
    plan_id: Optional[str] = None  # 规律生活计划生成的实例指向所属计划
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    revision: int
    deleted_at: Optional[datetime] = None


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    task_id: str
    event_type: str
    payload: Optional[str] = None
    created_at: datetime


class TaskDetailOut(TaskOut):
    events: List[EventOut] = []


class TaskMoveIn(BaseModel):
    is_important: bool
    is_urgent: bool
    before_task_id: Optional[str] = None


class TaskReorderIn(BaseModel):
    before_task_id: Optional[str] = None  # None → 移到象限尾部


class CompleteIn(BaseModel):
    completed_at: Optional[datetime] = None
    # 完成备注(可选):老客户端不传也可完成
    note: Optional[str] = None


class MigrateIn(BaseModel):
    to_date: str  # "today" 或 "YYYY-MM-DD"
    reason: Optional[str] = Field(default=None, max_length=500)


class BulkMigrateIn(BaseModel):
    task_ids: List[str] = Field(min_length=1)
    to_date: str
    reason: Optional[str] = Field(default=None, max_length=500)


class DecideIn(BaseModel):
    task_id: str
    decision: Literal["keep", "delete", "unshelve"]


class MigrationPendingOut(TaskOut):
    intervention_required: bool = False


# ---------------- Today 聚合 ----------------

class QuadrantBlock(BaseModel):
    quadrant: int
    label: str
    subtitle: str
    pending_count: int
    over_limit: bool
    tasks: List[TaskOut] = []


class TodayOut(BaseModel):
    date: str
    quadrants: List[QuadrantBlock]
    pending_migrations: List[MigrationPendingOut] = []
    yesterday: Dict[str, int]
    streak: Dict[str, Any]
    quadrant_soft_limit: int
    migration_threshold: int


# ---------------- Stats ----------------

class DailyStatOut(BaseModel):
    date: str
    created: int
    completed: int
    completion_rate: Optional[float] = None
    migrated_in: int
    cancelled: int
    quadrant_completed: Dict[str, int]
    by_category: List[Dict[str, Any]] = []


class RangeStatOut(BaseModel):
    days: List[Dict[str, Any]]
    totals: Dict[str, int]


class HeatmapOut(BaseModel):
    year: int
    days: List[Dict[str, Any]]


class StreakOut(BaseModel):
    current: int
    best: int
    total_active: int
    last_active_date: Optional[str] = None


# ---------------- Settings ----------------

class SettingsOut(BaseModel):
    timezone: str
    quadrant_labels: Dict[str, str]
    quadrant_subtitles: Dict[str, str]
    auto_migrate: bool
    auto_urgent_days: int
    migration_intervene_threshold: int
    quadrant_soft_limit: int
    day_start_hour: int
    # 消息推送渠道配置(channels: {email/apk/chrome/chatbot/other -> {enabled, ...渠道字段}});
    # 宽松 dict 以兼容后续渠道增量扩展自有字段
    notifications: Dict[str, Any]


class SettingsUpdate(BaseModel):
    timezone: Optional[str] = None
    quadrant_labels: Optional[Dict[str, str]] = None
    quadrant_subtitles: Optional[Dict[str, str]] = None
    auto_migrate: Optional[bool] = None
    auto_urgent_days: Optional[int] = Field(default=None, ge=0, le=365)
    migration_intervene_threshold: Optional[int] = Field(default=None, ge=1, le=20)
    quadrant_soft_limit: Optional[int] = Field(default=None, ge=1, le=100)
    day_start_hour: Optional[int] = Field(default=None, ge=0, le=23)
    notifications: Optional[Dict[str, Any]] = None


# ---------------- 规律生活计划 ----------------

class PlanRule(BaseModel):
    """循环规则:type + 对应参数。"""
    type: Literal["weekly", "interval", "weekly_times", "monthly_times"]
    weekdays: Optional[List[int]] = None       # weekly:0-6,周一=0,可多选
    interval_days: Optional[int] = None        # interval:1-366
    times: Optional[int] = None                # weekly_times:1-7 / monthly_times:1-31


class PlanCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    category_id: str                           # 类型(类别)必选
    start_date: date
    end_date: Optional[date] = None            # null = 长期
    rule: PlanRule


class PlanUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    category_id: Optional[str] = None          # 修改时仍要求非空
    start_date: Optional[date] = None
    end_date: Optional[date] = None            # 传 null 表示改为长期
    rule: Optional[PlanRule] = None
    enabled: Optional[bool] = None
    revision: int = 0                          # 兼容常规 PATCH 语义,暂不校验


class PlanOut(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    category_id: Optional[str] = None
    start_date: str
    end_date: Optional[str] = None
    rule_type: str
    rule: Dict[str, Any]
    rule_text: str
    enabled: bool
    next_occurrence: Optional[str] = None
    generated_count: int
    created_at: str
    updated_at: str


class LifeTaskBrief(BaseModel):
    id: str
    title: str
    status: str
    completion_note: Optional[str] = None
    completed_at: Optional[str] = None
    task_date: Optional[str] = None
    revision: int


class LifeTodayItem(BaseModel):
    title: str
    plan: Optional[PlanOut] = None   # 计划已删除时为 null(历史打卡仍展示)
    task: Optional[LifeTaskBrief] = None


class LifeTodayOut(BaseModel):
    date: str
    items: List[LifeTodayItem]


class PlanReportRow(BaseModel):
    title: str                        # plan 为 null 时展示用(如"已删除的计划")
    plan: Optional[PlanOut] = None
    scheduled: int
    completed: int
    missed: int
    rate: Optional[float] = None
    current_streak: int
    best_streak: int
    last_done: Optional[str] = None


class PlanReportOut(BaseModel):
    days: int
    start: str
    end: str
    plans: List[PlanReportRow]
    trend: List[Dict[str, Any]]
