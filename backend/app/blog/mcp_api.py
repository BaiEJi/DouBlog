"""Curated search and content retrieval across the knowledge module."""
from typing import Literal

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import func, select

from app.shared.mcp_read import Input, IntId, Search, TextId, one_row, page_rows, read_provider, read_tool
from .assets.models import AssetItem
from .bookmarks.models import BookmarkItem
from .diary.models import Diary
from .models import Post, Workspace

Kind = Literal['post', 'diary', 'bookmark', 'asset']
KIND_DESCRIPTION = '资料类型，分别对应知识库文章、日记、书签和资产。'


class KnowledgeSearch(Search):
    kind: Kind = Field(default='post', description=KIND_DESCRIPTION, examples=['post'])
    workspace_id: IntId | None = Field(default=None, description='仅对文章生效，限定知识库 ID。', examples=[1])


class KnowledgeRead(Input):
    kind: Kind = Field(description=KIND_DESCRIPTION, examples=['post'])
    id: IntId | TextId = Field(description='资料 ID，从搜索结果中获取。书签 ID 是字符串，其余是整数。',
                               examples=[1, '018f1531-0000-7000-8000-000000000001'])
    offset: int = Field(default=0, ge=0, le=2147483646, description='从第几个字符开始读取正文，从 0 开始。', examples=[0])


def _query(kind):
    if kind == 'post':
        return (Post.id, Post.title,
                select(Post.id, Post.title, Post.summary, Post.workspace_id, Workspace.name.label('workspace_name'),
                       Post.status, Post.updated_at).outerjoin(Workspace, Post.workspace_id == Workspace.id)
                .where(Post.id > 0), Post.content, Post.updated_at)
    if kind == 'diary':
        return (Diary.id, Diary.content,
                select(Diary.id, Diary.entry_date, Diary.journal_id, Diary.kind, Diary.word_count, Diary.updated_at)
                .where(Diary.deleted_at.is_(None), Diary.archived_at.is_(None)), Diary.content, Diary.entry_date)
    if kind == 'bookmark':
        return (BookmarkItem.id, BookmarkItem.title,
                select(BookmarkItem.id, BookmarkItem.title, BookmarkItem.url, BookmarkItem.description,
                       BookmarkItem.status, BookmarkItem.updated_at).where(BookmarkItem.deleted_at.is_(None)),
                BookmarkItem.snapshot_md, BookmarkItem.updated_at)
    return (AssetItem.id, AssetItem.title,
            select(AssetItem.id, AssetItem.title, AssetItem.summary, AssetItem.kind, AssetItem.status, AssetItem.updated_at)
            .where(AssetItem.status == 'active'), AssetItem.content, AssetItem.updated_at)


def search_knowledge(args):
    """按资料类型分页检索，文章可按知识库筛选，日记按正文关键词匹配。"""
    id_column, searchable, query, _, order = _query(args.kind)
    if args.workspace_id is not None and args.kind == 'post':
        query = query.where(Post.workspace_id == args.workspace_id)
    if args.keyword:
        query = query.where(searchable.icontains(args.keyword, autoescape=True))
    return {'kind': args.kind, **page_rows(query.order_by(order.desc(), id_column.desc()), args)}


def read_knowledge(args):
    """读取单条资料和最多 8000 个正文字符，返回可供继续读取的正文偏移量。"""
    if args.kind == 'bookmark' and not isinstance(args.id, str):
        raise HTTPException(400, '书签 ID 必须为字符串')
    if args.kind != 'bookmark' and not isinstance(args.id, int):
        raise HTTPException(400, '资料 ID 必须为整数')
    id_column, _, query, content, _ = _query(args.kind)
    chunk_size = 8000
    query = query.add_columns(func.substr(content, args.offset + 1, chunk_size + 1).label('content'))
    result = one_row(query.where(id_column == args.id), '资料不存在')
    body = result.pop('content') or ''
    return {'kind': args.kind, 'item': result, 'content': body[:chunk_size],
            'next_offset': args.offset + chunk_size if len(body) > chunk_size else None}


mcp_provider = read_provider('博客 · 知识库', 'blog', '检索知识库文章、日记、书签或资产。', {
    'search_knowledge': read_tool('检索资料', '知识检索', KnowledgeSearch, search_knowledge),
    'read_knowledge': read_tool('读取资料正文', '知识检索', KnowledgeRead, read_knowledge),
})
