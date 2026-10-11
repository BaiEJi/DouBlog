"""刷题子模块 Pydantic v2 请求/响应模型（docs/practice-spec.md API 规格）。

体模型仅做形状/长度校验；白名单（source/language/status）校验在 services 层
（携带更精确的中文错误文案，走 400 信封）。
"""
from __future__ import annotations

from datetime import date, datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..timeutil import ensure_aware

# ---------------- Problem ----------------


class ProblemCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    source: str = "other"
    source_no: Optional[str] = Field(default=None, max_length=64)
    difficulty: int = Field(default=1, ge=1, le=3)
    url: Optional[str] = Field(default=None, max_length=512)
    description_md: Optional[str] = None
    pitfall_md: Optional[str] = None
    status: str = "todo"
    first_solved_at: Optional[date] = None
    # 初始标签：tag_ids 为已有标签 id；tag_names 按名建/挂（一键抓题→落库的顺畅通道）
    tag_ids: List[str] = Field(default_factory=list)
    tag_names: List[str] = Field(default_factory=list)
    solutions: List["SolutionCreate"] = Field(default_factory=list)


class ProblemUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    source: Optional[str] = None
    source_no: Optional[str] = Field(default=None, max_length=64)
    difficulty: Optional[int] = Field(default=None, ge=1, le=3)
    url: Optional[str] = Field(default=None, max_length=512)
    description_md: Optional[str] = None
    pitfall_md: Optional[str] = None
    status: Optional[str] = None
    first_solved_at: Optional[date] = None
    tag_ids: Optional[List[str]] = None  # 整体替换关联（None=不动）
    revision: int  # 乐观锁必填


class TagBrief(BaseModel):
    id: str
    name: str
    color: str


class NextReviewBrief(BaseModel):
    id: str
    cycle: int
    seq: int
    prev_interval_days: int
    scheduled_date: date


class ProblemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source: str
    source_no: Optional[str] = None
    title: str
    difficulty: int
    url: Optional[str] = None
    description_md: Optional[str] = None
    pitfall_md: Optional[str] = None
    status: str
    first_solved_at: Optional[date] = None
    last_reviewed_at: Optional[datetime] = None
    revision: int
    created_at: datetime
    updated_at: datetime

    @field_validator("last_reviewed_at", "created_at", "updated_at", mode="before")
    @classmethod
    def _naive_as_utc(cls, v):
        """SQLite 读回 naive（UTC）→ 统一 aware，序列化恒带 +00:00。

        新建对象的内存值（aware）与读库值（SQLite naive）序列化形态一致，
        创建响应与再查询响应逐字节相同。
        """
        return ensure_aware(v)


class ProblemSummaryOut(BaseModel):
    """列表项：批量聚合摘要（tags/解法数/语言/下一复习）+ 题目小字段。

    P1-B：独立模型，不继承 ProblemOut——不含 description_md/pitfall_md
    （Text 大字段，列表/review_today 查询 defer 不加载；services 序列化时
    补 None 键保持响应形状，前端列表不消费，详情端点才返回全文）。
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    source: str
    source_no: Optional[str] = None
    title: str
    difficulty: int
    url: Optional[str] = None
    status: str
    first_solved_at: Optional[date] = None
    last_reviewed_at: Optional[datetime] = None
    revision: int
    created_at: datetime
    updated_at: datetime

    @field_validator("last_reviewed_at", "created_at", "updated_at", mode="before")
    @classmethod
    def _naive_as_utc(cls, v):
        """SQLite 读回 naive（UTC）→ 统一 aware（与 ProblemOut 同规则）。"""
        return ensure_aware(v)

    tags: List[TagBrief] = Field(default_factory=list)
    solution_count: int = 0
    code_languages: List[str] = Field(default_factory=list)
    next_review: Optional[NextReviewBrief] = None


# ---------------- Solution / Code ----------------


class CodeCreate(BaseModel):
    language: str = Field(min_length=1, max_length=20)
    code: str = Field(min_length=1)
    note: Optional[str] = None


class CodeUpdate(BaseModel):
    language: Optional[str] = Field(default=None, min_length=1, max_length=20)
    code: Optional[str] = Field(default=None, min_length=1)
    note: Optional[str] = None
    revision: int  # 乐观锁必填


class SolutionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    approach_md: Optional[str] = None
    time_complexity: Optional[str] = Field(default=None, max_length=32)
    space_complexity: Optional[str] = Field(default=None, max_length=32)
    is_preferred: bool = False
    codes: List[CodeCreate] = Field(default_factory=list)


class SolutionUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    approach_md: Optional[str] = None
    time_complexity: Optional[str] = Field(default=None, max_length=32)
    space_complexity: Optional[str] = Field(default=None, max_length=32)
    is_preferred: Optional[bool] = None
    revision: int  # 乐观锁必填


# ---------------- Tag ----------------


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: Optional[str] = Field(default=None, max_length=20)
    sort_order: int = 0


class TagUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    color: Optional[str] = Field(default=None, max_length=20)
    sort_order: Optional[int] = None


# ---------------- Review ----------------


class ReviewIn(BaseModel):
    result: Literal["remembered", "fuzzy", "forgot"]


ProblemCreate.model_rebuild()
