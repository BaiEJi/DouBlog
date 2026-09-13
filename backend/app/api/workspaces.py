"""
知识库（Workspace）API

文章的顶层分组容器。删除保护：非空知识库与最后一个知识库不可删除。
"""

from flask import Blueprint, request
from sqlalchemy import func

from app.api.auth import auth
from app.db import db
from app.models.models import Workspace, Post
from app.utils.response import api_response
from app.utils.audit import log_action

bp = Blueprint('workspaces', __name__, url_prefix='/api/workspaces')


def _get_or_404(workspace_id):
    ws = db.session.query(Workspace).filter(Workspace.id == workspace_id).first()
    return ws


@bp.route('', methods=['GET'])
@auth.login_required
def list_workspaces():
    """知识库列表（含每个库的文章数）"""
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


@bp.route('', methods=['POST'])
@auth.login_required
def create_workspace():
    """
    创建知识库

    请求体：{ name: str（必填，全局唯一）, description?: str }
    """
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return api_response(None, 400, '知识库名称不能为空')

    if db.session.query(Workspace).filter(Workspace.name == name).first():
        return api_response(None, 400, '同名知识库已存在')

    ws = Workspace(name=name, description=(data.get('description') or '').strip() or None)
    db.session.add(ws)
    log_action('create', 'workspace', None, {'name': name})
    db.session.commit()

    return api_response(ws.to_dict(post_count=0), 201, '创建成功')


@bp.route('/<int:workspace_id>', methods=['PUT'])
@auth.login_required
def update_workspace(workspace_id):
    """
    更新知识库（改名/描述）

    请求体：{ name?, description? }
    """
    ws = _get_or_404(workspace_id)
    if not ws:
        return api_response(None, 404, '知识库不存在')

    data = request.get_json() or {}
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

    log_action('update', 'workspace', workspace_id, {'fields': list(data.keys())})
    db.session.commit()

    return api_response(ws.to_dict(), 200, '更新成功')


@bp.route('/<int:workspace_id>', methods=['DELETE'])
@auth.login_required
def delete_workspace(workspace_id):
    """
    删除知识库（仅允许删除空库；最后一个知识库不可删除）
    """
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
    log_action('delete', 'workspace', workspace_id, {'name': ws.name})
    db.session.commit()

    return api_response(None, 200, '删除成功')
