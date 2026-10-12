"""
认证：统一登录系统（会话 Cookie）+ Basic Auth 兼容通道

- 登录：POST /api/auth/login，JSON {username, password}（或 Authorization: Basic，
  兼容 API 工具与既有测试）→ 验证通过签发 HttpOnly 会话 Cookie（doublog_session，
  HMAC-SHA256 签名，默认 30 天）
- require_basic：路由依赖，**优先会话 Cookie，其次 Basic**——前端登录一次后所有
  模块免再登录；curl / 单测 / SDK 发送端继续用 Basic
- 登出：POST /api/auth/logout 清除会话 Cookie
- 免认证端点保持不变：sdklogs 摄入 / diary 分享 / apihub gw(sk-) / 图片下载
"""

import base64
import hashlib
import hmac
import time

from fastapi import APIRouter, Depends, Request, Response

from app.config import settings
from app.shared.response import api_response
from lizysdk.errors import AuthError

router = APIRouter(prefix='/api/auth', tags=['auth'])

SESSION_COOKIE = 'doublog_session'
SESSION_TTL_S = 30 * 24 * 3600   # 30 天


def verify_password(username: str, password: str) -> bool:
    """验证用户名密码（auth_enabled=False 时放行）。

    2026-10-12 起凭据存 system_accounts 表（PBKDF2 哈希，system 模块播种/管理）；
    config.py 的 auth_username/auth_password 仅作首次播种默认与中间态回退。
    延迟导入避免 shared ↔ system 模块环（system.routes 依赖本文件的 require_basic）。
    """
    if not settings.auth_enabled:
        return True
    from app.system.accounts import verify_account
    return verify_account(username, password)


def _parse_basic(header: str) -> tuple[str, str] | None:
    """解析 Authorization: Basic base64(user:pass)"""
    if not header or not header.lower().startswith('basic '):
        return None
    try:
        raw = base64.b64decode(header[6:].strip()).decode('utf-8')
        user, _, pwd = raw.partition(':')
    except (ValueError, UnicodeDecodeError):
        return None
    return user, pwd


# ─── 会话令牌（HMAC 签名，纯标准库）──────────────────────

def _sign(payload: str) -> str:
    return hmac.new(settings.secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()


def issue_session(username: str) -> str:
    """签发会话令牌：{user}.{exp}.{sig}"""
    exp = int(time.time()) + SESSION_TTL_S
    return f'{username}.{exp}.{_sign(f"{username}.{exp}")}'


def verify_session(token: str | None) -> str | None:
    """校验会话令牌，返回用户名；无效/过期返回 None"""
    if not token:
        return None
    parts = token.split('.')
    if len(parts) != 3:
        return None
    user, exp, sig = parts
    try:
        exp_i = int(exp)
    except ValueError:
        return None
    if exp_i < time.time():
        return None
    if not hmac.compare_digest(sig, _sign(f'{user}.{exp}')):
        return None
    return user


def _session_user(request: Request) -> str | None:
    """从请求 Cookie 解析已登录用户"""
    return verify_session(request.cookies.get(SESSION_COOKIE))


def _set_session_cookie(response: Response, token: str):
    response.set_cookie(
        SESSION_COOKIE, token,
        max_age=SESSION_TTL_S, httponly=True, samesite='lax', path='/',
    )


def _clear_session_cookie(response: Response):
    response.delete_cookie(SESSION_COOKIE, path='/')


# ─── 内部服务令牌（apihub 网关回源用）────────────────────

INTERNAL_TOKEN_HEADER = 'X-Apihub-Token'
_internal_token_cache: dict[str, str] = {}


def internal_token() -> str:
    """内部服务令牌：data/internal_token 首次访问自动生成（32 字节 hex）。

    apihub 网关以 api_key_header 注入本令牌回源，后端见此头即信任（服务到服务，
    不以用户身份执行）；与 pwsvc.key/apihub.key 同属密钥文件模式。
    """
    import os
    import secrets

    path = os.path.join(settings.data_dir, 'internal_token')
    cached = _internal_token_cache.get(path)
    if cached and os.path.isfile(path):
        return cached
    try:
        with open(path, encoding='utf-8') as f:
            tok = f.read().strip()
        if tok:
            _internal_token_cache[path] = tok
            return tok
    except OSError:
        pass
    tok = secrets.token_hex(32)
    os.makedirs(settings.data_dir, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(tok)
    _internal_token_cache[path] = tok
    return tok


async def require_basic(request: Request) -> None:
    """统一认证依赖（历史名保留）：会话 Cookie 优先，其次 Basic；失败统一 401 信封。

    例外：携带有效 X-Apihub-Token 内部令牌的请求（apihub 网关回源）直接放行——
    服务内 API 以 OpenAPI 形式对外提供时，调用方鉴权由 apihub 平台令牌（sk-）承担。
    """
    if not settings.auth_enabled:
        return
    hdr = request.headers.get(INTERNAL_TOKEN_HEADER)
    if hdr and hmac.compare_digest(hdr, internal_token()):
        return
    if _session_user(request) is not None:
        return
    creds = _parse_basic(request.headers.get('Authorization', ''))
    if creds is None or not verify_password(*creds):
        raise AuthError(message='认证失败')


# ─── 端点 ───────────────────────────────────────────────

@router.post('/login')
async def login(request: Request):
    """登录：JSON {username, password}（前端登录页）或 Basic 头（API 工具）。

    成功签发会话 Cookie；30 天内全站免登录。
    """
    username = None
    password = None

    body = None
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 - 无 body 时走 Basic 通道
        body = None
    if isinstance(body, dict):
        username = body.get('username')
        password = body.get('password')

    if username is None or password is None:
        creds = _parse_basic(request.headers.get('Authorization', ''))
        if creds is not None:
            username, password = creds

    if not isinstance(username, str) or not isinstance(password, str) \
            or not verify_password(username, password):
        raise AuthError(message='认证失败')

    # cookie 必须设在最终返回的 Response 上（直接返回 Response 时
    # FastAPI 不合并注入参数 response 的 Set-Cookie）
    resp = api_response({'username': username}, 200, '登录成功')
    _set_session_cookie(resp, issue_session(username))
    return resp


@router.get('/check')
async def check_auth(_: None = Depends(require_basic)):
    """检查认证状态（Cookie 或 Basic）"""
    return api_response({
        'authenticated': True,
        'username': settings.auth_username,
    }, 200, '已认证')


@router.post('/logout')
async def logout():
    """登出：清除会话 Cookie（幂等，无需认证）"""
    resp = api_response(None, 200, '已登出')
    _clear_session_cookie(resp)
    return resp
