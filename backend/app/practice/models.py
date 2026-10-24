"""刷题（practice）子模块 6 表模型（docs/practice-spec.md 数据模型全规格）。

类型约定同 todo 模块（SQLite/Postgres 公共类型子集）：
- 主键 String(36) + uuid7()（时间有序，避免随机主键打碎 B-tree）
- 时间戳 DateTime(timezone=True) 存 UTC；本地日历日（scheduled_date/
  first_solved_at）用 Date 列
- SQLite 未开 PRAGMA foreign_keys，ondelete=CASCADE 仅对 PG 生效——
  子行级联删除由 services 层显式执行（双后端一致）
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# 白名单（services 层校验；列宽与规范一致）
PROBLEM_SOURCES = ("leetcode", "luogu", "nowcoder", "sword", "other")
PROBLEM_STATUSES = ("todo", "solved", "reviewing", "mastered")

SOLUTION_LANGUAGES = (
    "python", "javascript", "typescript", "java", "c", "cpp", "csharp",
    "go", "rust", "sql", "bash", "kotlin", "swift", "ruby", "php", "other",
)

REVIEW_RESULTS = ("remembered", "fuzzy", "forgot")
REVIEW_STATUSES = ("pending", "done", "cancelled")


class PracticeProblem(Base):
    """题目主表。软删（deleted_at）；revision 乐观锁。"""

    __tablename__ = "practice_problems"
    __table_args__ = (
        Index("ix_practice_status_diff", "status", "difficulty"),
        Index("ix_practice_source", "source"),
        Index("ix_practice_created", "created_at"),
        Index("ix_practice_solved", "first_solved_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="other")
    source_no: Mapped[Optional[str]] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    difficulty: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    url: Mapped[Optional[str]] = mapped_column(String(512))
    description_md: Mapped[Optional[str]] = mapped_column(Text)
    pitfall_md: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="todo")
    first_solved_at: Mapped[Optional[date]] = mapped_column(Date)
    last_reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class PracticeTag(Base):
    """标签。name 全库唯一；color 缺省按色板轮询（services 层）。"""

    __tablename__ = "practice_tags"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#6366F1")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PracticeProblemTag(Base):
    """题目↔标签 多对多关联。"""

    __tablename__ = "practice_problem_tags"
    __table_args__ = (
        UniqueConstraint("problem_id", "tag_id", name="pk_problem_tag"),
        Index("ix_practice_ptag_tag", "tag_id", "problem_id"),
    )

    problem_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("practice_problems.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("practice_tags.id", ondelete="CASCADE"), primary_key=True
    )


class PracticeSolution(Base):
    """解法。sort_order 浮点中点插入；revision 乐观锁。"""

    __tablename__ = "practice_solutions"
    __table_args__ = (Index("ix_practice_sol_problem", "problem_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    problem_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("practice_problems.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    approach_md: Mapped[Optional[str]] = mapped_column(Text)
    time_complexity: Mapped[Optional[str]] = mapped_column(String(32))
    space_complexity: Mapped[Optional[str]] = mapped_column(String(32))
    is_preferred: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PracticeSolutionCode(Base):
    """解法的某语言实现。(solution_id, language) 唯一。"""

    __tablename__ = "practice_solution_codes"
    __table_args__ = (
        UniqueConstraint("solution_id", "language", name="uq_code_solution_language"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    solution_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("practice_solutions.id", ondelete="CASCADE"), nullable=False
    )
    language: Mapped[str] = mapped_column(String(20), nullable=False)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text)


class PracticeReview(Base):
    """复习流水行。每题至多一条 pending（partial unique index 保证）。

    - cycle: 第几轮复习（退出再加入递增）
    - seq: 累计打卡次数（跨 cycle 连续递增）
    - prev_interval_days: 本行打卡所依据的间隔档位（INTERVALS 成员值）
    """

    __tablename__ = "practice_reviews"
    __table_args__ = (
        # 每题至多一条未完成复习（双后端 partial unique index）
        Index(
            "uq_reviews_open",
            "problem_id",
            unique=True,
            sqlite_where=text("status = 'pending'"),
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_reviews_due", "status", "scheduled_date"),
        Index("ix_reviews_chain", "problem_id", "cycle", "seq"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    problem_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("practice_problems.id", ondelete="CASCADE"), nullable=False
    )
    cycle: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    seq: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    prev_interval_days: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False)
    result: Mapped[Optional[str]] = mapped_column(String(10))
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    next_interval_days: Mapped[Optional[int]] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PracticeMutation(Base):
    """聚合编辑的耐久回执；重试同一请求返回原结果，不再次修改子行。"""

    __tablename__ = "practice_mutations"
    mutation_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    problem_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    result: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
