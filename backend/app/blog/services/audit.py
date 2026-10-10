"""
操作日志工具

记录 create/update/delete 操作，不单独 commit，跟随主操作一起提交。

DB 逻辑经 run_db 在工作线程执行（无请求代理），客户端 IP 由路由层
提前从 Request 读取后显式传入。
"""

import json
from app.db import db
from app.blog.models import AuditLog


def request_ip(request) -> str | None:
    """读取请求客户端 IP（在事件循环线程里调用，值随闭包传入 DB 线程）"""
    return request.client.host if request.client else None


def log_action(action: str, resource_type: str, resource_id: int = None, detail: dict = None,
               ip_address: str = None):
    """
    记录操作日志

    Args:
        action: 操作类型 (create/update/delete)
        resource_type: 资源类型 (post/image)
        resource_id: 资源ID
        detail: 操作详情
        ip_address: 请求客户端IP
    """
    entry = AuditLog(
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        detail=json.dumps(detail, ensure_ascii=False) if detail else None,
        ip_address=ip_address,
    )
    db.session.add(entry)
