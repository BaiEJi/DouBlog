"""
知识库（Workspace）API

文章的顶层分组容器。删除保护：非空知识库与最后一个知识库不可删除。
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func

from app.shared.auth import require_basic
from app.db import db, run_db
from app.blog.models import Workspace, Post
from app.shared.response import api_response
from app.blog.services.audit import log_action, request_ip

router = APIRouter(prefix='/api/workspaces', dependencies=[Depends(require_basic)])


def _get_or_404(workspace_id):
    ws = db.session.query(Workspace).filter(Workspace.id == workspace_id).first()
    return ws


async def _json_body(request: Request) -> dict:
    """读取 JSON 请求体（坏/缺 body 回退空 dict）"""
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001
        return {}
    return data if isinstance(data, dict) else {}


@router.get('')
async def list_workspaces():
    """知识库列表（含每个库的文章数）"""
    def _impl():
        counts = dict(
            db.session.query(Post.workspace_id, func.count(Post.id))
            .filter(Post.id != 0)
            .group_by(Post.workspace_id)
            .all()
        )
        workspaces = db.session.query(Workspace).order_by(Workspace.id.asc()).all()
        return api_response([
            ws.to_dict(post_count=counts.get(ws.id, 0)) for ws in workspaces
        ])
    return await run_db(_impl)


@router.post('')
async def create_workspace(request: Request):
    """
    创建知识库

    请求体：{ name: str（必填，全局唯一）, description?: str }
    """
    data = await _json_body(request)
    ip = request_ip(request)

    def _impl():
        name = (data.get('name') or '').strip()
        if not name:
            return api_response(None, 400, '知识库名称不能为空')

        if db.session.query(Workspace).filter(Workspace.name == name).first():
            return api_response(None, 400, '同名知识库已存在')

        ws = Workspace(name=name, description=(data.get('description') or '').strip() or None)
        db.session.add(ws)
        log_action('create', 'workspace', None, {'name': name}, ip_address=ip)
        db.session.commit()

        return api_response(ws.to_dict(post_count=0), 201, '创建成功')
    return await run_db(_impl)


@router.put('/{workspace_id}')
async def update_workspace(workspace_id: int, request: Request):
    """
    更新知识库（改名/描述）

    请求体：{ name?, description? }
    """
    data = await _json_body(request)
    ip = request_ip(request)

    def _impl():
        ws = _get_or_404(workspace_id)
        if not ws:
            return api_response(None, 404, '知识库不存在')

        if 'name' in data:
            name = (data.get('name') or '').strip()
            if not name:
                return api_response(None, 400, '知识库名称不能为空')
            existing = db.session.query(Workspace).filter(
                Workspace.name == name, Workspace.id != workspace_id
            ).first()
            if existing:
                return api_response(None, 400, '同名知识库已存在')
            ws.name = name

        if 'description' in data:
            ws.description = (data.get('description') or '').strip() or None

        log_action('update', 'workspace', workspace_id, {'fields': list(data.keys())}, ip_address=ip)
        db.session.commit()

        return api_response(ws.to_dict(), 200, '更新成功')
    return await run_db(_impl)


@router.delete('/{workspace_id}')
async def delete_workspace(workspace_id: int, request: Request):
    """
    删除知识库（仅允许删除空库；最后一个知识库不可删除）
    """
    ip = request_ip(request)

    def _impl():
        ws = _get_or_404(workspace_id)
        if not ws:
            return api_response(None, 404, '知识库不存在')

        post_count = db.session.query(func.count(Post.id)).filter(
            Post.workspace_id == workspace_id, Post.id != 0
        ).scalar() or 0
        if post_count > 0:
            return api_response(None, 400, f'知识库下仍有 {post_count} 篇文章，请先删除或移动后再删除')

        total = db.session.query(func.count(Workspace.id)).scalar() or 0
        if total <= 1:
            return api_response(None, 400, '至少保留一个知识库')

        db.session.delete(ws)
        log_action('delete', 'workspace', workspace_id, {'name': ws.name}, ip_address=ip)
        db.session.commit()

        return api_response(None, 200, '删除成功')
    return await run_db(_impl)
