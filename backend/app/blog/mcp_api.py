"""Curated search and content retrieval across the knowledge module."""
from typing import Literal

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import func, select

from app.db import db
from app.shared.mcp_read import Input, IntId, Paged, Search, TextId, one_row, page_rows, read_provider, read_tool
from app.shared.mcp_write import ContentText, Write, add_writes, existing_write_tool, response_data, scoped_mutation, write_tool
from .assets import routes as asset_routes
from .assets.models import AssetItem
from .bookmarks import services as bookmark_service
from .bookmarks.models import BookmarkItem
from .bookmarks.schemas import ItemCreate, ItemUpdate
from .diary import routes as diary_routes
from .diary.models import Diary, DiaryJournal
from .models import Post, Workspace
from .routes.posts import _update_post, create_post_data

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
                       Post.status, Post.revision, Post.updated_at).outerjoin(Workspace, Post.workspace_id == Workspace.id)
                .where(Post.id > 0), Post.content, Post.updated_at)
    if kind == 'diary':
        return (Diary.id, Diary.content,
                select(Diary.id, Diary.entry_date, Diary.journal_id, Diary.kind, Diary.word_count, Diary.revision, Diary.updated_at)
                .where(Diary.deleted_at.is_(None), Diary.archived_at.is_(None)), Diary.content, Diary.entry_date)
    if kind == 'bookmark':
        return (BookmarkItem.id, BookmarkItem.title,
                select(BookmarkItem.id, BookmarkItem.title, BookmarkItem.url, BookmarkItem.description,
                       BookmarkItem.status, BookmarkItem.updated_at).where(BookmarkItem.deleted_at.is_(None)),
                BookmarkItem.snapshot_md, BookmarkItem.updated_at)
    return (AssetItem.id, AssetItem.title,
            select(AssetItem.id, AssetItem.title, AssetItem.summary, AssetItem.kind, AssetItem.status, AssetItem.version, AssetItem.updated_at)
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


def list_diary_journals(args):
    """查询可用于新建日记的日记本及其 ID。"""
    query = select(DiaryJournal.id, DiaryJournal.name, DiaryJournal.emoji).order_by(DiaryJournal.sort, DiaryJournal.id)
    return page_rows(query, args)


mcp_provider = read_provider('博客 · 知识库', 'blog', '检索知识库文章、日记、书签或资产。', {
    'search_knowledge': read_tool('检索资料', '知识检索', KnowledgeSearch, search_knowledge),
    'read_knowledge': read_tool('读取资料正文', '知识检索', KnowledgeRead, read_knowledge),
    'list_diary_journals': read_tool('查询日记本', '知识检索', Paged, list_diary_journals),
})


class ArticleSave(Write):
    id: IntId | None = Field(default=None, description='编辑时填写文章 ID，省略则新建。', examples=[1])
    revision: IntId | None = Field(default=None, description='编辑时填写查询返回的文章版本。', examples=[1])
    workspace_id: IntId | None = Field(default=None, description='新建时指定知识库，省略使用默认知识库。', examples=[1])
    name: str | None = Field(default=None, max_length=100, description='用于 URL 的英文标识，新建必填。', examples=['project-plan'])
    title: str | None = Field(default=None, min_length=1, max_length=200, description='文章标题，新建必填。', examples=['项目规划'])
    content: ContentText | None = Field(default=None, max_length=200000, description='文章 Markdown 正文。', examples=['## 项目目标'])
    summary: str | None = Field(default=None, max_length=2000, description='简短摘要。', examples=['本周交付范围'])


class DiarySave(Write):
    id: IntId | None = Field(default=None, description='日记 ID，省略则新建。', examples=[1])
    revision: IntId | None = Field(default=None, description='编辑时需要查询返回的日记版本。', examples=[1])
    entry_date: str | None = Field(default=None, pattern=r'^\d{4}-\d{2}-\d{2}$', description='日记日期，新建必填。', examples=['2026-11-28'])
    content: ContentText = Field(min_length=1, max_length=100000, description='日记 Markdown 正文。', examples=['今天完成了版本验收。'])
    journal_id: IntId | None = Field(default=None, description='新建日记时填写日记本 ID，可通过日记本查询获得。', examples=[1])


class BookmarkSave(Write):
    id: TextId | None = Field(default=None, description='书签 ID，省略则新建。', examples=['018f1531-0000-7000-8000-000000000001'])
    url: str | None = Field(default=None, min_length=1, max_length=2048, description='书签链接，新建必填。', examples=['https://example.com/guide'])
    title: str | None = Field(default=None, min_length=1, max_length=512, description='书签名称。', examples=['开发文档'])
    note: str | None = Field(default=None, max_length=10000, description='附加备注。', examples=['部署章节供团队查阅'])
    starred: bool | None = Field(default=None, description='是否加星。', examples=[True])


class AssetSave(Write):
    id: IntId | None = Field(default=None, description='资产 ID，省略则新建。', examples=[1])
    kind: Literal['prompt', 'skill'] | None = Field(default=None, description='新建资产时的类型。', examples=['prompt'])
    title: str | None = Field(default=None, min_length=1, max_length=200, description='资产标题，新建必填。', examples=['周报模板'])
    content: ContentText | None = Field(default=None, max_length=100000, description='资产正文，新建必填。', examples=['整理 {{本周进展}}。'])
    summary: str | None = Field(default=None, max_length=2000, description='资产的简短说明。', examples=['项目周报提纲'])


def _body(args):
    return args.model_dump(mode='json', exclude={'id', 'mutation_id'}, exclude_unset=True, exclude_none=True)


def save_article(args):
    """新建草稿或按当前版本编辑现有文章。"""
    body = _body(args)
    if args.id is None:
        return response_data(create_post_data({**body, 'status': 'draft'}, None, commit=False))
    if args.revision is None:
        raise HTTPException(400, '编辑文章必须提供 revision')
    post = db.session.get(Post, args.id)
    if post is None:
        raise HTTPException(404, '文章不存在')
    return response_data(_update_post(db.session, post, body, None, commit=False))


def save_diary(args, token_id):
    """新建日记，或按版本替换已有日记的正文。"""
    body = _body(args)
    body['mutation_id'] = scoped_mutation(token_id, args.mutation_id)
    if args.id is None:
        result = response_data(diary_routes.save_new_entry(body))
    else:
        if args.revision is None:
            raise HTTPException(400, '编辑日记必须提供 revision')
        result = response_data(diary_routes.save_existing_entry(args.id, body))
    return {key: result[key] for key in ('id', 'entry_date', 'revision')}


def save_bookmark(args):
    """保存新书签，或更新链接、标题、备注和加星状态。"""
    body = _body(args)
    if args.id is None:
        if args.url is None:
            raise HTTPException(400, '新建书签必须提供 url')
        return bookmark_service.create_item(db.session, ItemCreate(**body), [])
    return bookmark_service.update_item(db.session, args.id, ItemUpdate(**body), None)


def save_asset(args):
    """创建文本资产，或编辑正文并保存版本快照。"""
    body = _body(args)
    if args.id is None:
        result = response_data(asset_routes.create_asset_data(body, commit=False))
    else:
        # Serialize competing edits while the existing versioning code runs.
        db.session.get(AssetItem, args.id, with_for_update=True)
        result = response_data(asset_routes.update_asset_data(args.id, body, commit=False))
    return {key: result[key] for key in ('id', 'title', 'kind', 'version')}


mcp_provider = add_writes(mcp_provider, {
    'save_article': write_tool('保存文章', '资料编辑', ArticleSave, save_article),
    'save_diary': existing_write_tool('保存日记', '资料编辑', DiarySave, save_diary),
    'save_bookmark': write_tool('保存书签', '资料编辑', BookmarkSave, save_bookmark),
    'save_asset': write_tool('保存资产', '资料编辑', AssetSave, save_asset),
})
