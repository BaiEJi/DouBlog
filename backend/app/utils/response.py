"""
API响应格式化工具
"""

from flask import jsonify
from typing import Any


def api_response(data: Any = None, code: int = 200, message: str = '操作成功'):
    """
    统一API响应格式
    
    Args:
        data: 响应数据
        code: 状态码
        message: 消息
    
    Returns:
        Flask Response对象
    """
    return jsonify({
        'success': 200 <= code < 300,
        'code': code,
        'message': message,
        'data': data
    }), code