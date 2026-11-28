from sqlalchemy import func, select

from app.db import db
from app.shared.mcp_read import Input, Paged, page_rows, read_provider, read_tool
from .models import VaultAccount, VaultAttachment, VaultAuditLog, VaultItem


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


mcp_provider = read_provider('密码库', 'vault', '检查密码库使用状态及审计记录。', {
    'get_vault_status': read_tool('查看密码库状态', '状态与审计', Input, get_vault_status),
    'list_vault_audit': read_tool('查询密码库审计', '状态与审计', Paged, list_vault_audit),
})
