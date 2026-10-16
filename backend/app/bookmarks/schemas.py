"""bookmarks 模块 Pydantic v2 请求模型。

体模型仅做形状/长度校验；白名单（status 等）校验在 services 层
（携带更精确的中文错误文案，走 400 信封）。
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    parent_id: Optional[str] = Field(default=None, max_length=36)
    # 落在同级哪个位置之后（中点插入）；缺省追加末尾
    after_sort: Optional[float] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    parent_id: Optional[str] = None   # 显式传 null = 提升为顶级
    sort_order: Optional[float] = None


class ItemCreate(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    title: Optional[str] = Field(default=None, max_length=512)
    description: Optional[str] = None
    note: Optional[str] = None
    site_name: Optional[str] = Field(default=None, max_length=255)
    favicon_url: Optional[str] = Field(default=None, max_length=1024)
    category_id: Optional[str] = None
    status: str = "unread"
    starred: bool = False
    tag_ids: List[str] = Field(default_factory=list)
    tag_names: List[str] = Field(default_factory=list)


class ItemUpdate(BaseModel):
    url: Optional[str] = Field(default=None, min_length=1, max_length=2048)
    title: Optional[str] = Field(default=None, min_length=1, max_length=512)
    description: Optional[str] = None
    note: Optional[str] = None
    site_name: Optional[str] = Field(default=None, max_length=255)
    favicon_url: Optional[str] = Field(default=None, max_length=1024)
    category_id: Optional[str] = None   # 显式 null = 移到未分类
    status: Optional[str] = None
    starred: Optional[bool] = None
    tag_ids: Optional[List[str]] = None    # 整体替换（None = 不动）
    tag_names: Optional[List[str]] = None  # 与 tag_ids 合并去重


class BatchIn(BaseModel):
    ids: List[str] = Field(min_length=1, max_length=200)
    # status / star / unstar / move_category / add_tags / delete / restore
    action: str
    value: Optional[str] = None          # status 目标 / 分类 id
    tag_names: List[str] = Field(default_factory=list)


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: Optional[str] = Field(default=None, max_length=20)


class TagUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    color: Optional[str] = Field(default=None, max_length=20)


class CheckIn(BaseModel):
    ids: List[str] = Field(default_factory=list, max_length=50)  # 空 = 检测当前筛选下前 50 条
