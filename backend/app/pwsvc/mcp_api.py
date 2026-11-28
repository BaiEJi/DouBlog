from datetime import timedelta

from pydantic import Field
from sqlalchemy import func, select

from app.db import db
from app.shared.mcp_read import Hours, Input, IntId, Search, one_row, page_rows, read_provider, read_tool
from app.shared.timestamps import _utcnow
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


mcp_provider = read_provider('密码服务', 'pwsvc', '查看项目目录和聚合校验结果。', {
    'list_password_projects': read_tool('查询密码服务项目', '项目与校验', Search, list_password_projects),
    'get_project_health': read_tool('查看项目校验统计', '项目与校验', ProjectRead, get_project_health),
})
