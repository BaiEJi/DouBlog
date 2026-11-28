from fastapi import HTTPException
from pydantic import Field

from app.db import current_runtime
from app.shared.mcp_read import Input, read_provider, read_tool
from app.shared.mcp_write import Write, add_writes, existing_write_tool, scoped_mutation
from app.shared.pools import pool_stats
from .home import _load_layout, _parse_layout, _save_layout


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


class Layout(Write):
    revision: int = Field(ge=0, description='查询门户布局时返回的版本号。', examples=[0])
    groups: list[dict] = Field(min_length=1, max_length=50, description='完整门户分组和每组的卡片列表。',
                               examples=[[{'name': '常用', 'cards': [{'key': 'todo'}, {'key': 'subs'}]}]])


def save_portal_layout(args, token_id):
    """按版本号保存门户分组、卡片顺序和文案。"""
    body = {'revision': args.revision, 'groups': args.groups, 'mutation_id': scoped_mutation(token_id, args.mutation_id)}
    parsed, error = _parse_layout(body)
    if error:
        raise HTTPException(400, error)
    return _save_layout(parsed, body)


mcp_provider = add_writes(mcp_provider, {
    'save_portal_layout': existing_write_tool('保存门户布局', '门户设置', Layout, save_portal_layout),
})
