import json
import time

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import select

from app.db import db
from app.shared.mcp_read import Paged, page_rows, read_provider, read_tool
from app.shared.mcp_write import Write, add_writes, write_tool
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


class IdlePreferences(Write):
    steamid: str = Field(pattern=r'^[0-9]{17}$', description='挂机配置列表中的 Steam ID。', examples=['76561198000000000'])
    auto_resume: bool = Field(description='重启后是否自动恢复已保存的挂机设置。', examples=[False])


def set_idle_preferences(args):
    """设置已登录账号的自动恢复选项。"""
    row = db.session.get(SteamidlerAccount, args.steamid, with_for_update=True)
    if row is None:
        raise HTTPException(404, '挂机账号不存在')
    row.auto_resume = int(args.auto_resume)
    row.updated_at = time.time()
    return {'steamid': row.steamid, 'auto_resume': bool(row.auto_resume)}


mcp_provider = add_writes(mcp_provider, {
    'set_idle_preferences': write_tool('更新挂机偏好', '挂机设置', IdlePreferences, set_idle_preferences),
})
