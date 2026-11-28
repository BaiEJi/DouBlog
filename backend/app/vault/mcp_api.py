from datetime import datetime, timezone

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import func, select

from app.db import db
from app.shared.mcp_read import Input, IntId, Paged, page_rows, read_provider, read_tool
from app.shared.mcp_write import Write, add_writes, write_tool
from .models import VaultAccount, VaultAttachment, VaultAuditLog, VaultItem
from .routes import _audit


def get_vault_status(args):
    """查看密码库是否已初始化，以及条目、收藏、回收站和附件的数量。"""
    active, favorite, deleted = db.session.execute(select(
        func.count().filter(VaultItem.deleted_at.is_(None)),
        func.count().filter(VaultItem.deleted_at.is_(None), VaultItem.favorite.is_(True)),
        func.count().filter(VaultItem.deleted_at.is_not(None)),
    ).select_from(VaultItem)).one()
    return {'initialized': bool(db.session.scalar(select(VaultAccount.id).limit(1))),
            'items': active, 'favorites': favorite, 'deleted': deleted,
            'attachments': db.session.scalar(select(func.count()).select_from(VaultAttachment))}


def list_vault_audit(args):
    """分页查看密码库操作类型及时间。"""
    query = select(VaultAuditLog.id, VaultAuditLog.action, VaultAuditLog.item_id, VaultAuditLog.created_at)
    return page_rows(query.order_by(VaultAuditLog.id.desc()), args)


class VaultEntries(Paged):
    trashed: bool = Field(default=False, description='查询回收站中的条目。', examples=[False])


def list_vault_entries(args):
    """分页查看条目 ID、收藏状态和更新时间，用于定位要修改的条目。"""
    query = select(VaultItem.id, VaultItem.favorite, VaultItem.updated_at, VaultItem.deleted_at)
    condition = VaultItem.deleted_at.is_not(None) if args.trashed else VaultItem.deleted_at.is_(None)
    return page_rows(query.where(condition).order_by(VaultItem.id.desc()), args)


mcp_provider = read_provider('密码库', 'vault', '检查密码库使用状态及审计记录。', {
    'get_vault_status': read_tool('查看密码库状态', '状态与审计', Input, get_vault_status),
    'list_vault_audit': read_tool('查询密码库审计', '状态与审计', Paged, list_vault_audit),
    'list_vault_entries': read_tool('列出条目状态', '状态与审计', VaultEntries, list_vault_entries),
})


class VaultEntryChange(Write):
    item_id: IntId = Field(description='从条目列表获取的 ID。', examples=[1])


class FavoriteChange(VaultEntryChange):
    favorite: bool = Field(description='是否将条目设为收藏。', examples=[True])


class TrashChange(VaultEntryChange):
    trashed: bool = Field(description='true 移入回收站，false 恢复。', examples=[True])


def _item(item_id):
    item = db.session.get(VaultItem, item_id, with_for_update=True)
    if item is None:
        raise HTTPException(404, '条目不存在')
    return item


def set_vault_favorite(args):
    """设置一个正常条目的收藏状态，保留其加密内容。"""
    item = _item(args.item_id)
    if item.deleted_at is not None:
        raise HTTPException(409, '请先恢复回收站条目')
    if bool(item.favorite) != args.favorite:
        item.favorite = args.favorite
        _audit('updated', item.id)
    return {'id': item.id, 'favorite': bool(item.favorite)}


def set_vault_trash_state(args):
    """将条目移入回收站或恢复，附件随条目保留。"""
    item = _item(args.item_id)
    if (item.deleted_at is not None) != args.trashed:
        item.deleted_at = datetime.now(timezone.utc) if args.trashed else None
        _audit('trashed' if args.trashed else 'restored', item.id)
    return {'id': item.id, 'trashed': args.trashed}


mcp_provider = add_writes(mcp_provider, {
    'set_vault_favorite': write_tool('设置条目收藏', '条目管理', FavoriteChange, set_vault_favorite),
    'set_vault_trash_state': write_tool('移动或恢复条目', '条目管理', TrashChange, set_vault_trash_state),
})
