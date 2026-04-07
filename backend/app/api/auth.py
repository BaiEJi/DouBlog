"""
认证API

提供登录验证和认证检查功能
"""

from flask import Blueprint
from flask_httpauth import HTTPBasicAuth
from app.utils.response import api_response
from app.config import settings

bp = Blueprint('auth', __name__, url_prefix='/api/auth')
auth = HTTPBasicAuth()


@auth.verify_password
def verify_password(username, password):
    """
    验证用户名和密码
    
    Args:
        username: 用户名
        password: 密码
    
    Returns:
        验证通过返回True，否则返回False
    """
    if not settings.auth_enabled:
        return True
    
    return username == settings.auth_username and password == settings.auth_password


@auth.error_handler
def auth_error():
    """
    认证失败处理
    
    Returns:
        401错误响应
    """
    return api_response(None, 401, '认证失败')


@bp.route('/login', methods=['POST'])
@auth.login_required
def login():
    """
    登录API
    
    验证用户名密码，成功返回用户信息。
    
    Request Headers:
        Authorization: Basic {base64(username:password)}
    
    Returns:
        {
            "success": true,
            "code": 200,
            "message": "登录成功",
            "data": {"username": "admin"}
        }
    """
    return api_response({'username': settings.auth_username}, 200, '登录成功')


@bp.route('/check', methods=['GET'])
@auth.login_required
def check_auth():
    """
    检查认证状态API
    
    验证当前请求是否已认证。
    
    Request Headers:
        Authorization: Basic {base64(username:password)}
    
    Returns:
        {
            "success": true,
            "code": 200,
            "message": "已认证",
            "data": {
                "authenticated": true,
                "username": "admin"
            }
        }
    """
    return api_response({
        'authenticated': True,
        'username': settings.auth_username
    }, 200, '已认证')