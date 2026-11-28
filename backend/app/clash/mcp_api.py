from app.shared.mcp_read import Input, read_provider, read_tool
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
