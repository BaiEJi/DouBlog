"""Steam 新版认证流程 (IAuthenticationService)

注意: 2025-10 之后该服务不再接受表单编码, 必须发送 protobuf 请求体
(响应也是 protobuf 字节), 错误码在响应头 x-eresult / x-error_message。

流程:
  1. GetPasswordRSAPublicKey     (GET, JSON)  取 RSA 公钥
  2. BeginAuthSessionViaCredentials  发起登录, 返回可用的验证方式
  3. (可选) UpdateAuthSessionWithSteamGuardCode  提交邮箱/令牌验证码
  4. PollAuthSessionStatus       轮询直到拿到 refresh_token / access_token
  5. GenerateAccessTokenForApp   用 refresh_token 换新的 access_token
"""
import base64
import json
import threading
import time
import uuid

import requests
from steam.core.crypto import rsa_publickey, pkcs1v15_encrypt
from steam.protobufs.steammessages_auth_pb2 import (
    CAuthentication_AccessToken_GenerateForApp_Request as GenReq,
    CAuthentication_AccessToken_GenerateForApp_Response as GenResp,
    CAuthentication_BeginAuthSessionViaCredentials_Request as BeginReq,
    CAuthentication_BeginAuthSessionViaCredentials_Response as BeginResp,
    CAuthentication_PollAuthSessionStatus_Request as PollReq,
    CAuthentication_PollAuthSessionStatus_Response as PollResp,
    CAuthentication_UpdateAuthSessionWithSteamGuardCode_Request as UpdateReq,
    CAuthentication_UpdateAuthSessionWithSteamGuardCode_Response as UpdateResp,
)

from . import config

API_BASE = "https://api.steampowered.com/IAuthenticationService"
PROTO_CONTENT_TYPE = "application/octet-stream"


class AuthError(Exception):
    """Steam 认证错误。code 为 EResult 数值, 0 表示非 EResult 错误"""

    def __init__(self, message, code=0):
        super().__init__(message)
        self.code = code


def _http():
    s = requests.Session()
    s.headers.update({
        "User-Agent": config.USER_AGENT,
        "Origin": "https://store.steampowered.com",
        "Referer": "https://store.steampowered.com/login/",
    })
    return s


def _headers_eresult(resp):
    for h in ("x-eresult", "X-Eresult", "X-EResult", "x-EResult"):
        if resp.headers.get(h) is not None:
            try:
                return int(resp.headers[h]), (resp.headers.get("x-error_message")
                                              or resp.headers.get("X-Error_Message") or "")
            except ValueError:
                pass
    return 0, ""


def _call_proto(session, method, request_msg, response_cls, timeout=20):
    """POST protobuf 请求体, 返回解析后的 response 消息; 失败抛 AuthError"""
    url = f"{API_BASE}/{method}/v1/"
    try:
        resp = session.post(url, data=request_msg.SerializeToString(),
                            headers={"Content-Type": PROTO_CONTENT_TYPE}, timeout=timeout)
    except requests.RequestException as e:
        raise AuthError(f"网络请求失败: {e}")

    eresult, err_msg = _headers_eresult(resp)
    if resp.status_code >= 400 or eresult not in (0, 1):
        if eresult:
            raise AuthError(err_msg or config.eresult_text(eresult), eresult)
        raise AuthError(err_msg or f"HTTP {resp.status_code}: {method} 失败", 0)

    out = response_cls()
    try:
        out.ParseFromString(resp.content)
    except Exception:
        # 错误响应体可能不是期望的消息结构, 此时以上面的 eresult 头为准
        if not (resp.status_code == 200 and len(resp.content) <= 32):
            raise AuthError(f"{method} 响应解析失败", 0)
    return out


def _encrypt_password(session, username, password):
    """RSA 公钥走 GET (该端点仍接受 query 参数, 返回 JSON)"""
    try:
        r = session.get(f"{API_BASE}/GetPasswordRSAPublicKey/v1/",
                        params={"account_name": username}, timeout=20)
    except requests.RequestException as e:
        raise AuthError(f"网络请求失败: {e}")
    if r.status_code != 200:
        raise AuthError("获取 RSA 公钥失败", 0)
    try:
        key_resp = r.json()["response"]
        mod, exp, ts = key_resp["publickey_mod"], key_resp["publickey_exp"], key_resp["timestamp"]
    except (ValueError, KeyError):
        raise AuthError("获取 RSA 公钥失败: 响应异常", 0)

    key = rsa_publickey(int(mod, 16), int(exp, 16))
    enc = base64.b64encode(pkcs1v15_encrypt(key, password.encode("utf-8"))).decode("ascii")
    return enc, int(ts)


def decode_steam_jwt(token):
    """解析 Steam JWT payload (不校验签名), 返回 dict; 失败返回 {}"""
    try:
        part = token.split(".")[1]
        part += "=" * (-len(part) % 4)
        return json.loads(base64.urlsafe_b64decode(part))
    except (IndexError, ValueError, TypeError):
        return {}


def generate_access_token(session, refresh_token, steamid):
    """用 refresh_token 换新的 access_token"""
    req = GenReq(refresh_token=refresh_token, steamid=int(steamid))
    resp = _call_proto(session, "GenerateAccessTokenForApp", req, GenResp)
    if not resp.access_token:
        raise AuthError("刷新 access_token 失败", 0)
    return resp.access_token


class LoginAttempt:
    """一次交互式登录会话。

    状态机:
      pending  -> 等待用户操作 (输入验证码 / 手机确认)
      polling  -> 正在轮询 Steam 等待令牌
      success  -> 登录成功, tokens 可用
      failed   -> 失败 (error 字段带原因)
      timeout  -> 轮询超时
    """

    def __init__(self, username, password):
        self.id = uuid.uuid4().hex[:16]
        self.username = username
        self.password = password            # 仅在登录期间保存在内存
        self.http = _http()

        self.state = "pending"
        self.error = ""
        self.eresult = 0

        self.client_id = 0
        self.request_id = b""
        self.steamid = ""
        self.interval = config.POLL_INTERVAL
        self.allowed = []                   # [{confirmation_type, name, message}]
        self.tokens = None                  # {"refresh_token","access_token"}
        self.account_name = ""
        self.guard_data = ""

        self._poller = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self.created_at = time.time()

    # ---------- 发起登录 ----------
    def begin(self):
        try:
            encrypted, ts = _encrypt_password(self.http, self.username, self.password)
            msg = BeginReq()
            msg.device_friendly_name = f"{config.DEVICE_NAME}@{config.HOST_OS}"
            msg.account_name = self.username
            msg.encrypted_password = encrypted
            msg.encryption_timestamp = ts
            msg.remember_login = True
            msg.platform_type = 1           # k_EAuthTokenPlatformType_SteamClient
            msg.persistence = 1             # k_ESessionPersistence_Persistent
            msg.website_id = "Client"
            msg.device_details.device_friendly_name = f"{config.DEVICE_NAME}@{config.HOST_OS}"
            msg.device_details.platform_type = 1
            resp = _call_proto(self.http, "BeginAuthSessionViaCredentials", msg, BeginResp)
        except AuthError as e:
            self._fail(str(e), e.code)
            return self.status()

        with self._lock:
            self.client_id = resp.client_id
            self.request_id = resp.request_id
            self.steamid = str(resp.steamid) if resp.steamid else ""
            self.interval = resp.interval or config.POLL_INTERVAL
            self.allowed = [
                {"confirmation_type": int(c.confirmation_type),
                 "name": config.GUARD_NAMES.get(int(c.confirmation_type), "其他方式"),
                 "message": c.associated_message}
                for c in resp.allowed_confirmations
            ]
        self._start_polling()
        return self.status()

    # ---------- 提交验证码 ----------
    def submit_code(self, code, code_type):
        code = (code or "").strip()
        if not code:
            return self._fail_state("验证码不能为空")
        if not self.client_id:
            return self._fail_state("登录会话不存在或已失效")
        if code_type not in (config.GUARD_EMAIL_CODE, config.GUARD_DEVICE_CODE):
            return self._fail_state("不支持的验证码类型")

        with self._lock:
            if self.state not in ("pending", "polling"):
                return self._fail_state(f"当前状态 ({self.state}) 无法提交验证码")

        try:
            req = UpdateReq(
                client_id=self.client_id,
                steamid=int(self.steamid) if self.steamid else 0,
                code=code,
                code_type=code_type,
            )
            _call_proto(self.http, "UpdateAuthSessionWithSteamGuardCode", req, UpdateResp)
        except AuthError as e:
            # 验证码错误: 会话仍有效, 用户可以重试
            with self._lock:
                self.error = str(e)
                self.eresult = e.code
            return self.status()

        with self._lock:
            self.error = ""
            self.eresult = 0
        if not self._poller or not self._poller.is_alive():
            self._start_polling()
        return self.status()

    # ---------- 轮询 ----------
    def _start_polling(self):
        with self._lock:
            self.state = "polling"
        self._stop.clear()
        self._poller = threading.Thread(target=self._poll_loop, daemon=True, name=f"poll-{self.id}")
        self._poller.start()

    def _poll_once(self):
        req = PollReq(client_id=self.client_id, request_id=self.request_id)
        resp = _call_proto(self.http, "PollAuthSessionStatus", req, PollResp)
        if resp.new_client_id:
            with self._lock:
                self.client_id = resp.new_client_id
        if resp.new_guard_data:
            with self._lock:
                self.guard_data = resp.new_guard_data
        if resp.account_name:
            with self._lock:
                self.account_name = resp.account_name

        if resp.refresh_token and resp.access_token:
            with self._lock:
                self.tokens = {
                    "refresh_token": resp.refresh_token,
                    "access_token": resp.access_token,
                }
                if not self.steamid:
                    claims = decode_steam_jwt(resp.refresh_token)
                    self.steamid = str(claims.get("sub", ""))
                if not self.account_name:
                    self.account_name = self.username
                self.state = "success"
            return True
        return False

    def _poll_loop(self):
        deadline = time.time() + config.POLL_TIMEOUT
        transient = 0
        while not self._stop.is_set() and time.time() < deadline:
            try:
                done = self._poll_once()
            except AuthError as e:
                # 29=会话过期, 87=账号锁定 -> 终止; 其他 (等待确认期间的临时错误) 继续
                if e.code in (29, 87, 15):
                    self._fail(str(e), e.code)
                    return
                transient += 1
                if transient > 12:
                    self._fail(f"等待登录确认失败: {e}", e.code)
                    return
            except Exception as e:
                transient += 1
                if transient > 12:
                    self._fail(f"轮询异常: {e}", 0)
                    return
            else:
                if done:
                    return
            time.sleep(max(2.0, min(self.interval, 10.0)))

        if not self._stop.is_set():
            with self._lock:
                if self.state != "success":
                    self.state = "timeout"

    # ---------- 状态 ----------
    def _fail(self, message, code=0):
        with self._lock:
            self.state = "failed"
            self.error = message
            self.eresult = code
        self._stop.set()

    def _fail_state(self, message):
        with self._lock:
            self.error = message
        return self.status()

    def cancel(self):
        self._stop.set()
        with self._lock:
            if self.state not in ("success",):
                self.state = "failed"
                self.error = "已取消"

    def status(self):
        with self._lock:
            return {
                "attempt_id": self.id,
                "username": self.username,
                "state": self.state,
                "error": self.error,
                "steamid": self.steamid,
                "account_name": self.account_name,
                "allowed": list(self.allowed),
                "elapsed": round(time.time() - self.created_at, 1),
            }
