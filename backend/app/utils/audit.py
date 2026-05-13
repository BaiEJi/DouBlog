"""
操作日志工具

记录 create/update/delete 操作，不单独 commit，跟随主操作一起提交。
"""

import json
from flask import request
from app.db import db
from app.models.models import AuditLog


def log_action(action: str, resource_type: str, resource_id: int = None, detail: dict = None):
    """
    记录操作日志

    Args:
        action: 操作类型 (create/update/delete)
        resource_type: 资源类型 (post/image)
        resource_id: 资源ID
        detail: 操作详情
    """
    entry = AuditLog(
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        detail=json.dumps(detail, ensure_ascii=False) if detail else None,
        ip_address=request.remote_addr,
    )
    db.session.add(entry)
