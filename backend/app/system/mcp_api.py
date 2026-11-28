from app.db import current_runtime
from app.shared.mcp_read import Input, read_provider, read_tool
from app.shared.pools import pool_stats
from .home import _load_layout


def get_runtime_status(args):
    """汇总当前数据库类型、排队读写任务和执行池状态。"""
    snapshot = current_runtime().snapshot()
    fields = ('running_backend', 'pending_tasks', 'pending_writes', 'pending_controls',
              'pending_restart', 'closed', 'admissions_paused')
    return {'database': {key: snapshot[key] for key in fields}, 'pools': pool_stats()}


def get_portal_layout(args):
    """读取门户分组、模块卡片的顺序和当前版本。"""
    return _load_layout()


mcp_provider = read_provider('系统配置', 'system', '查看本站运行状态和门户布局。', {
    'get_runtime_status': read_tool('查看运行状态', '系统概况', Input, get_runtime_status),
    'get_portal_layout': read_tool('查看门户布局', '系统概况', Input, get_portal_layout),
})
