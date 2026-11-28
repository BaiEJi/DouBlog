import json

from sqlalchemy import select

from app.shared.mcp_read import Paged, page_rows, read_provider, read_tool
from .models import SteamidlerAccount


def list_idle_profiles(args):
    """查看已登记的挂机账号、所选游戏 ID、自动恢复设置和累计挂机秒数。"""
    query = select(SteamidlerAccount.steamid, SteamidlerAccount.account_name, SteamidlerAccount.idle_appids,
                   SteamidlerAccount.auto_resume, SteamidlerAccount.farmed_seconds, SteamidlerAccount.updated_at)
    result = page_rows(query.order_by(SteamidlerAccount.created_at, SteamidlerAccount.steamid), args)
    for item in result['items']:
        try:
            app_ids = json.loads(item['idle_appids'] or '[]')
        except (ValueError, TypeError):
            app_ids = []
        item['idle_appids'] = app_ids if isinstance(app_ids, list) else []
        item['auto_resume'] = bool(item['auto_resume'])
    return result


mcp_provider = read_provider('Steam 挂机', 'steamidler', '查看已保存的挂机设置和历史累计时长。', {
    'list_idle_profiles': read_tool('查看挂机配置', '挂机概况', Paged, list_idle_profiles),
})
