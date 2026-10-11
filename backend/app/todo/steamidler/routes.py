"""steamidler 路由:源 api.py 适配(docs/steamidler-migration.md)。

适配点(仅前缀/信封/鉴权,业务逻辑照搬):
- prefix /api → /api/todo/steamidler;router 级 Depends(require_basic)(统一登录)
- 响应一律 api_response(...) 信封;错误 HTTPException(code, msg) 就地转
  api_response(None, code, msg)——Doublog 全局 404 处理器会把 detail 覆盖为
  "资源不存在",必须显式返回保住原始文案
- /health 舍弃(Doublog 有全局 /health);manager 从 request.app.state 懒取
  (get_manager,禁模块级单例,多 app 测试互不干扰)
- 处理器保持源版 sync def(FastAPI 自动入线程池执行):manager 调用混合
  DB/Steam 网络/worker join,不适合挤占共享 DB 池;db_svc 每次调用自清理会话
"""
import threading

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.shared.auth import require_basic
from app.shared.response import api_response

from . import config
from .auth import AuthError
from .manager import get_manager

router = APIRouter(prefix="/api/todo/steamidler", tags=["todo-steamidler"],
                   dependencies=[Depends(require_basic)])

_completed_attempts = set()
_completed_lock = threading.Lock()


class BeginLoginBody(BaseModel):
    username: str
    password: str


class SubmitCodeBody(BaseModel):
    attempt_id: str
    code: str
    # pydantic v2 显式 null 也走 Optional:前端 api.js 默认参数即发 code_type:null
    code_type: int | None = None


class IdleBody(BaseModel):
    appids: list


class SharedSecretBody(BaseModel):
    shared_secret: str = ""


class AutoResumeBody(BaseModel):
    enabled: bool


# ---------------- 登录 ----------------
@router.post("/login/begin")
def login_begin(body: BeginLoginBody, request: Request):
    if not body.username.strip() or not body.password:
        return api_response(None, 400, "请输入账号和密码")
    m = get_manager(request.app)
    try:
        status = m.begin_login(body.username, body.password)
    except AuthError as e:
        return api_response(None, 400, str(e))
    return api_response(status)


@router.post("/login/code")
def login_code(body: SubmitCodeBody, request: Request):
    m = get_manager(request.app)
    return api_response(m.submit_code(body.attempt_id, body.code, body.code_type))


@router.get("/login/status")
def login_status(attempt_id: str, request: Request):
    m = get_manager(request.app)
    with m._lock:
        attempt = m.attempts.get(attempt_id)
    if not attempt:
        return api_response(None, 404, "登录会话不存在或已过期")
    status = attempt.status()

    # 登录成功 -> 落库并启动 worker (只执行一次)
    if status["state"] == "success":
        with _completed_lock:
            fresh = attempt.id not in _completed_attempts
            if fresh:
                _completed_attempts.add(attempt.id)
        if fresh:
            try:
                acc = m.maybe_complete(attempt)
                if acc:
                    status["account"] = {
                        "steamid": acc["steamid"],
                        "account_name": acc["account_name"],
                        "avatar_url": acc.get("avatar_url") or "",
                    }
            except Exception as e:
                status["state"] = "failed"
                status["error"] = f"保存账号失败: {e}"
    return api_response(status)


# ---------------- 账号 ----------------
@router.get("/accounts")
def list_accounts(request: Request):
    return api_response(get_manager(request.app).accounts_snapshot())


@router.delete("/accounts/{steamid}")
def remove_account(steamid: str, request: Request):
    get_manager(request.app).remove_account(steamid)
    return api_response({"ok": True})


@router.get("/accounts/{steamid}/log")
def account_log(steamid: str, request: Request):
    return api_response({"lines": get_manager(request.app).account_log(steamid)})


@router.get("/accounts/{steamid}/games")
def account_games(steamid: str, request: Request, force: bool = False):
    try:
        games = get_manager(request.app).fetch_games(steamid, force=force)
        return api_response({"games": games})
    except AuthError as e:
        return api_response(None, 400, str(e))


@router.post("/accounts/{steamid}/idle")
def start_idle(steamid: str, body: IdleBody, request: Request):
    try:
        get_manager(request.app).start_idle(steamid, body.appids)
    except AuthError as e:
        return api_response(None, 400, str(e))
    return api_response({"ok": True})


@router.post("/accounts/{steamid}/stop")
def stop_idle(steamid: str, request: Request):
    get_manager(request.app).stop_idle(steamid)
    return api_response({"ok": True})


@router.post("/accounts/{steamid}/shared_secret")
def set_shared_secret(steamid: str, body: SharedSecretBody, request: Request):
    m = get_manager(request.app)
    if not m.db.get_account(steamid):
        return api_response(None, 404, "账号不存在")
    secret = body.shared_secret.strip()
    if secret:
        code = m._totp_code(secret)
        if not code:
            return api_response(None, 400, "shared_secret 格式不正确 (应为 maFile 中的 base64 字符串)")
    m.db.update_fields(steamid, shared_secret=secret)
    return api_response({"ok": True})


@router.post("/accounts/{steamid}/auto_resume")
def set_auto_resume(steamid: str, body: AutoResumeBody, request: Request):
    get_manager(request.app).db.update_fields(steamid, auto_resume=1 if body.enabled else 0)
    return api_response({"ok": True})


@router.get("/meta")
def meta():
    return api_response({"max_idle_games": config.MAX_IDLE_GAMES})
