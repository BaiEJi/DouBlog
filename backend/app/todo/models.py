"""todo 五表模型(自 MyTodo 迁移,列/索引/约束逐列照搬;users 表按规范删除)。

类型约定与 MyTodo 一致,只用 SQLite/Postgres 公共类型子集:
- UUID → String(36) 文本
- BOOLEAN → 通用 Boolean(PG boolean / SQLite INTEGER)
- 时间 → DateTime(timezone=True)(PG timestamptz / SQLite ISO 文本 UTC)
- JSON → Text 存 JSON 字符串
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Category(Base):
    __tablename__ = "todo_categories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#64748B")
    icon: Mapped[Optional[str]] = mapped_column(String(50))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


TASK_STATUSES = ("pending", "in_progress", "done", "cancelled")


class Task(Base):
    __tablename__ = "todo_tasks"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','in_progress','done','cancelled')", name="ck_tasks_status"
        ),
        Index("ix_tasks_date_status", "task_date", "status"),
        Index("ix_tasks_quadrant", "is_important", "is_urgent"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    category_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("todo_categories.id", ondelete="SET NULL")
    )

    # 四象限:两布尔正交存储,象限为派生值
    is_important: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_urgent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 象限内排序(浮点中点插入法,作用域 = 象限)
    position: Mapped[float] = mapped_column(Float, nullable=False, default=1024.0)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    # 日期体系:task_date 为空 = 收件箱;original_date 迁移后不变
    task_date: Mapped[Optional[date]] = mapped_column(Date)
    original_date: Mapped[Optional[date]] = mapped_column(Date)
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    due_is_full_day: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # 迁移链
    migrated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_migrated_from: Mapped[Optional[date]] = mapped_column(Date)
    # 搁置:逾期任务被有意搁置后,不再出现在待迁移列表,可在回顾/统计页查看
    shelved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    estimate_minutes: Mapped[Optional[int]] = mapped_column(Integer)

    # 任务级通知:task_date 当天 notify_time 仍未完成时,向 notify_channels(渠道 key 数组)推送
    notify_enabled: Mapped[Optional[bool]] = mapped_column(Boolean)
    notify_time: Mapped[Optional[str]] = mapped_column(String(5))  # "HH:MM"
    notify_channels: Mapped[Optional[str]] = mapped_column(Text)   # JSON 数组,如 ["email","chrome"]
    # 完成备注:完成任务时可选填写(老客户端不带备注也可完成,字段可空)
    completion_note: Mapped[Optional[str]] = mapped_column(Text)
    # 规律生活计划生成的任务实例指向所属计划(手工任务为 null)
    plan_id: Mapped[Optional[str]] = mapped_column(String(36))

    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class TaskEvent(Base):
    """不可变事件日志(Org-mode LOGBOOK 的结构化版)。"""

    __tablename__ = "todo_task_events"
    __table_args__ = (Index("ix_events_task_time", "task_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    task_id: Mapped[str] = mapped_column(
        ForeignKey("todo_tasks.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    payload: Mapped[Optional[str]] = mapped_column(Text)  # JSON 字符串
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AppSetting(Base):
    __tablename__ = "todo_app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)  # JSON 字符串


class Plan(Base):
    """规律生活计划:按规则循环生成任务实例(由物化逻辑落成真实 Task)。"""

    __tablename__ = "todo_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    category_id: Mapped[Optional[str]] = mapped_column(String(36))
    # 生成的任务落入的象限(1-4)
    quadrant: Mapped[int] = mapped_column(Integer, nullable=False, default=2)

    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[Optional[date]] = mapped_column(Date)  # null = 长期

    # 循环规则:type=weekly(weekdays:[0-6 周一=0]) / interval(interval_days:N)
    #           / weekly_times(times:N,自动均摊到固定周几) / monthly_times(times:N,自动均摊到月内固定日)
    rule_type: Mapped[str] = mapped_column(String(20), nullable=False)
    rule_data: Mapped[Optional[str]] = mapped_column(Text)  # JSON

    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
