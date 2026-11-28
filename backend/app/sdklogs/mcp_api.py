from datetime import timedelta

from pydantic import Field
from sqlalchemy import func, select

from app.shared.mcp_read import Hours, Paged, page_rows, read_provider, read_tool
from app.shared.timestamps import _utcnow
from .models import SdkAlert, SdkLog


class LogActivity(Paged):
    hours: Hours = 24
    sys_name: str | None = Field(default=None, max_length=100, description='指定系统标识，省略时统计全部系统。', examples=['doublog.todo'])


class Alerts(Paged):
    only_unacked: bool = Field(default=True, description='只查看尚未确认的告警。', examples=[True])


def get_log_activity(args):
    """按系统和级别汇总日志数量，可查看近一周内的活动。"""
    start = _utcnow() - timedelta(hours=args.hours)
    count = func.count().label('count')
    query = (select(SdkLog.sys_name, SdkLog.level_text, count).where(SdkLog.ts >= start)
             .group_by(SdkLog.sys_name, SdkLog.level_text))
    if args.sys_name:
        query = query.where(SdkLog.sys_name == args.sys_name)
    return {'hours': args.hours, **page_rows(query.order_by(count.desc(), SdkLog.sys_name, SdkLog.level_text), args)}


def list_log_alerts(args):
    """查看告警级别、涉及系统、触发次数和确认状态。"""
    query = select(SdkAlert.id, SdkAlert.created_at, SdkAlert.level_text, SdkAlert.sys_name, SdkAlert.count,
                   SdkAlert.window_minutes, SdkAlert.notified, SdkAlert.acked)
    if args.only_unacked:
        query = query.where(SdkAlert.acked.is_(False))
    return page_rows(query.order_by(SdkAlert.id.desc()), args)


mcp_provider = read_provider('日志查询', 'sdklogs', '查看日志活动和告警摘要。', {
    'get_log_activity': read_tool('查询日志活动', '日志与告警', LogActivity, get_log_activity),
    'list_log_alerts': read_tool('查询告警记录', '日志与告警', Alerts, list_log_alerts),
})
