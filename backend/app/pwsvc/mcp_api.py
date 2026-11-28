from datetime import timedelta
from typing import Literal

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import func, select

from app.db import db
from app.shared.mcp_read import Hours, Input, IntId, Search, one_row, page_rows, read_provider, read_tool
from app.shared.timestamps import _utcnow
from app.shared.mcp_write import Write, add_writes, write_tool
from .models import PwsvcProject, PwsvcType, PwsvcUser, PwsvcValidateLog


class ProjectRead(Input):
    project_id: IntId = Field(description='密码服务的项目 ID。', examples=[1])
    hours: Hours = 24


def list_password_projects(args):
    """查询密码服务项目，返回策略数、用户数和更新时间。"""
    users = select(func.count()).where(PwsvcUser.project_id == PwsvcProject.id).correlate(PwsvcProject).scalar_subquery()
    policies = select(func.count()).where(PwsvcType.project_id == PwsvcProject.id).correlate(PwsvcProject).scalar_subquery()
    query = select(PwsvcProject.id, PwsvcProject.name, PwsvcProject.updated_at,
                   users.label('user_count'), policies.label('policy_count'))
    if args.keyword:
        query = query.where(PwsvcProject.name.icontains(args.keyword, autoescape=True))
    return page_rows(query.order_by(PwsvcProject.id), args)


def get_project_health(args):
    """查看指定项目的密码校验次数与成功、失败统计。"""
    project = one_row(select(PwsvcProject.id, PwsvcProject.name).where(PwsvcProject.id == args.project_id), '项目不存在')
    start = _utcnow() - timedelta(hours=args.hours)
    total, success = db.session.execute(
        select(func.count(), func.count().filter(PwsvcValidateLog.valid.is_(True)))
        .where(PwsvcValidateLog.project_id == args.project_id, PwsvcValidateLog.created_at >= start)
    ).one()
    return {'project': project, 'hours': args.hours, 'total': total, 'success': success, 'failed': total - success}


class ProjectUsers(Search):
    project_id: IntId = Field(description='密码服务项目 ID。', examples=[1])


def list_project_users(args):
    """查看项目用户的 ID、显示名和启停状态。"""
    one_row(select(PwsvcProject.id).where(PwsvcProject.id == args.project_id), '项目不存在')
    query = select(PwsvcUser.id, PwsvcUser.username, PwsvcUser.display_name, PwsvcUser.status).where(
        PwsvcUser.project_id == args.project_id)
    if args.keyword:
        query = query.where(PwsvcUser.username.icontains(args.keyword, autoescape=True))
    return page_rows(query.order_by(PwsvcUser.id), args)


mcp_provider = read_provider('密码服务', 'pwsvc', '查看项目目录和聚合校验结果。', {
    'list_password_projects': read_tool('查询密码服务项目', '项目与校验', Search, list_password_projects),
    'get_project_health': read_tool('查看项目校验统计', '项目与校验', ProjectRead, get_project_health),
    'list_project_users': read_tool('查看项目用户状态', '项目与校验', ProjectUsers, list_project_users),
})


class ProjectEdit(Write):
    project_id: IntId = Field(description='要编辑的项目 ID。', examples=[1])
    name: str | None = Field(default=None, min_length=1, max_length=100, description='项目的新名称。', examples=['内部服务'])
    description: str | None = Field(default=None, max_length=300, description='项目说明。', examples=['内部账号管理'])


class UserStatus(Write):
    project_id: IntId = Field(description='用户所属项目 ID。', examples=[1])
    user_id: IntId = Field(description='项目里的用户 ID。', examples=[1])
    status: Literal['enabled', 'disabled'] = Field(description='目标启停状态。', examples=['disabled'])


def update_project_profile(args):
    """更新项目名称或说明。"""
    project = db.session.get(PwsvcProject, args.project_id, with_for_update=True)
    if project is None:
        raise HTTPException(404, '项目不存在')
    if args.name is not None:
        duplicate = db.session.scalar(select(PwsvcProject.id).where(PwsvcProject.name == args.name,
                                                                     PwsvcProject.id != project.id).limit(1))
        if duplicate is not None:
            raise HTTPException(409, '项目名已存在')
        project.name = args.name
    if 'description' in args.model_fields_set:
        project.description = args.description or ''
    return {'id': project.id, 'name': project.name, 'description': project.description}


def set_project_user_status(args):
    """启用或停用指定项目的已有用户。"""
    user = db.session.get(PwsvcUser, args.user_id, with_for_update=True)
    if user is None or user.project_id != args.project_id:
        raise HTTPException(404, '项目用户不存在')
    user.status = args.status
    return {'id': user.id, 'project_id': user.project_id, 'status': user.status}


mcp_provider = add_writes(mcp_provider, {
    'update_project_profile': write_tool('编辑项目资料', '项目管理', ProjectEdit, update_project_profile),
    'set_project_user_status': write_tool('设置项目用户状态', '项目管理', UserStatus, set_project_user_status),
})
