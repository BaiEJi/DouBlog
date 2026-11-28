from datetime import timedelta

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import func, or_, select

from app.db import db
from app.shared.mcp_read import Hours, Input, IntId, Search, page_rows, read_provider, read_tool
from app.shared.timestamps import _utcnow
from app.shared.mcp_write import add_writes, existing_write_tool, mcp_application
from .models import ApihubApi, ApihubCallLog, ApihubSystem
from .routes import set_api_enabled as persist_api_enabled


class ApiSearch(Search):
    system_id: IntId | None = Field(default=None, description='指定系统 ID 时只查该系统的接口。', examples=[1])


class GatewayActivity(Input):
    hours: Hours = 24


def list_api_catalog(args):
    """搜索已登记的系统及接口名称、HTTP 方法、启停状态和探活状态。"""
    query = (select(ApihubApi.id, ApihubApi.name, ApihubApi.slug, ApihubApi.method, ApihubApi.enabled,
                    ApihubApi.health_status, ApihubApi.last_probe_at, ApihubSystem.id.label('system_id'),
                    ApihubSystem.name.label('system_name'), ApihubSystem.status.label('system_status'))
             .join(ApihubSystem, ApihubSystem.id == ApihubApi.system_id))
    if args.system_id is not None:
        query = query.where(ApihubApi.system_id == args.system_id)
    if args.keyword:
        query = query.where(or_(ApihubApi.name.icontains(args.keyword, autoescape=True),
                                ApihubSystem.name.icontains(args.keyword, autoescape=True)))
    return page_rows(query.order_by(ApihubApi.system_id, ApihubApi.id), args)


def get_gateway_health(args):
    """查看网关近期调用成功率和延迟，并按探活状态汇总接口数量。"""
    start = _utcnow() - timedelta(hours=args.hours)
    calls, success, latency = db.session.execute(
        select(func.count(), func.count().filter(ApihubCallLog.ok.is_(True)), func.avg(ApihubCallLog.latency_ms))
        .where(ApihubCallLog.created_at >= start)
    ).one()
    health = db.session.execute(select(ApihubApi.health_status, func.count()).group_by(ApihubApi.health_status)).all()
    return {'hours': args.hours, 'calls': calls, 'success': success, 'failed': calls - success,
            'average_latency_ms': round(float(latency), 2) if latency is not None else None,
            'api_health': {status: count for status, count in health}}


mcp_provider = read_provider('API Hub', 'apihub', '查接口目录及已有网关运行数据。', {
    'list_api_catalog': read_tool('查询接口目录', '接口与健康', ApiSearch, list_api_catalog),
    'get_gateway_health': read_tool('查看网关健康', '接口与健康', GatewayActivity, get_gateway_health),
})


class ApiAvailability(Input):
    api_id: IntId = Field(description='从网关接口目录获取的接口 ID。', examples=[1])
    enabled: bool = Field(description='是否允许已有接口继续通过网关调用。', examples=[False])


def set_api_enabled(args, token_id):
    """设置已登记 API 的启停，立即刷新网关目录。"""
    api = persist_api_enabled(mcp_application.get(), args.api_id, args.enabled)
    if api is None:
        raise HTTPException(404, 'API 不存在')
    return {'id': api.id, 'enabled': api.enabled}


mcp_provider = add_writes(mcp_provider, {
    'set_api_enabled': existing_write_tool('设置接口启停', '网关管理', ApiAvailability, set_api_enabled),
})
