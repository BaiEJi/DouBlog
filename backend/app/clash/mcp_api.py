from pydantic import Field

from app.shared.mcp_read import Input, read_provider, read_tool
from app.shared.mcp_write import add_writes, existing_write_tool
from . import service


def get_proxy_status(args):
    """检查本机是否安装 Clash 管理组件，以及内核和系统代理的开关状态。"""
    if not service.is_available():
        return {'available': False, 'running': None, 'system_proxy_enabled': None}
    return {'available': True, 'running': service.kernel_status()['running'],
            'system_proxy_enabled': service.system_proxy_get()['enabled']}


mcp_provider = read_provider('Clash 代理', 'clash', '检查 Clash 是否可用和运行中的状态。', {
    'get_proxy_status': read_tool('查看代理运行状态', '运行状态', Input, get_proxy_status),
})


class ProxyChange(Input):
    enabled: bool = Field(description='启用或关闭本机系统代理。', examples=[False])


def set_proxy_enabled(args, token_id):
    """将本机系统代理设置为指定状态。"""
    service.ensure_available()
    if service.system_proxy_get()['enabled'] != args.enabled:
        service.system_proxy_set(args.enabled)
    return {'system_proxy_enabled': service.system_proxy_get()['enabled']}


mcp_provider = add_writes(mcp_provider, {
    'set_proxy_enabled': existing_write_tool('设置系统代理状态', '代理设置', ProxyChange, set_proxy_enabled),
})
