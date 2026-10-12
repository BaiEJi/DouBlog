"""账号挂机工作线程: 每个账号一个线程, 持有独立的 gevent hub。

负责: CM 连接(access_token 登录) -> games_played 挂机 -> 断线自动重连 -> 自动恢复挂机。
所有 gevent 调用都发生在本线程内; 与 FastAPI/manager 之间用线程安全队列与锁交互。
"""
import queue
import threading
import time
from collections import deque

import gevent

from steam.client import SteamClient
from steam.core.msg import MsgProto
from steam.enums import EResult, EOSType
from steam.enums.emsg import EMsg
from steam.steamid import SteamID
from steam.utils import ip4_to_int

from . import config


def _token_logon(client, account_name, steamid64, token):
    """用 access_token/refresh_token 执行 CM 登录 (对应已弃用的密码登录)"""
    if client.logged_on:
        raise RuntimeError("already logged on")

    if not client.connected and not client._connecting:
        if not client.connect():
            return EResult.Fail

    if not client.channel_secured:
        client.wait_event(client.EVENT_CHANNEL_SECURED, timeout=10)

    if not client.channel_secured or not client.connected:
        return EResult.TryAnotherCM

    message = MsgProto(EMsg.ClientLogon)
    message.header.steamid = SteamID(int(steamid64))
    message.body.protocol_version = 65580
    message.body.client_package_version = 1561159470
    message.body.client_os_type = EOSType.Linux64 if config.HOST_OS == "linux" else EOSType.Windows10
    message.body.client_language = "english"
    message.body.should_remember_password = False
    message.body.supports_rate_limit_response = True
    message.body.chat_mode = client.chat_mode
    try:
        message.body.obfuscated_private_ip.v4 = ip4_to_int(client.connection.local_address) ^ 0xF00DBAAD
    except Exception:
        pass
    if account_name:
        message.body.account_name = account_name
    message.body.access_token = token

    client.send(message)
    resp = client.wait_msg(EMsg.ClientLogOnResponse, timeout=30)
    if resp and resp.body.eresult == EResult.OK:
        client.sleep(0.5)
        return EResult.OK
    return EResult(resp.body.eresult) if resp else EResult.Fail


class AccountWorker(threading.Thread):
    """states: starting / connecting / online / reconnecting / error / stopped"""

    def __init__(self, manager, steamid, account_name, refresh_token, access_token="", idle_appids=None):
        super().__init__(name=f"worker-{account_name}", daemon=True)
        self.manager = manager
        self.steamid = str(steamid)
        self.account_name = account_name
        self.refresh_token = refresh_token
        self.access_token = access_token

        self.idle_appids = list(idle_appids or [])
        self.state = "starting"
        self.last_error = ""
        self.idle_since = 0.0            # 本次连续挂机开始时间
        self.farmed_session = 0.0        # 本次进程内挂机秒数
        self.logined_at = 0.0

        self._client = None
        self._cmd_q = queue.Queue()
        self._stop_flag = threading.Event()
        self._disconnected = threading.Event()
        self._lock = threading.Lock()
        self._log = deque(maxlen=300)
        self._log_hook = None            # manager 侧可挂回调

    # ================= 对外接口 (任意线程调用) =================
    def log(self, line):
        stamp = time.strftime("%H:%M:%S")
        with self._lock:
            self._log.append(f"[{stamp}] {line}")
        if self._log_hook:
            try:
                self._log_hook(self.steamid, line)
            except Exception:
                pass

    def get_log(self, limit=200):
        with self._lock:
            return list(self._log)[-limit:]

    def send_command(self, cmd, payload=None):
        self._cmd_q.put((cmd, payload))

    def stop(self, remove=False):
        self._remove = remove
        self._stop_flag.set()
        self.send_command("__stop__")

    def snapshot(self):
        with self._lock:
            return {
                "steamid": self.steamid,
                "account_name": self.account_name,
                "state": self.state,
                "last_error": self.last_error,
                "idle_appids": list(self.idle_appids),
                "idle_since": self.idle_since,
                "farmed_session": round(self.farmed_session, 1),
                "online_for": round(time.time() - self.logined_at, 1) if self.logined_at else 0,
            }

    # ================= 内部实现 =================
    def _set(self, **kw):
        with self._lock:
            for k, v in kw.items():
                setattr(self, k, v)

    def _build_client(self):
        client = SteamClient()
        client.credential_location = None  # 使用默认位置
        client.on(client.EVENT_DISCONNECTED, self._on_disconnected)
        client.on(client.EVENT_ERROR, self._on_error)
        client.on(client.EVENT_LOGGED_ON, lambda: None)
        return client

    def _on_disconnected(self, *a):
        self._disconnected.set()
        self.log("CM 连接断开")

    def _on_error(self, result):
        self.log(f"CM 错误: {EResult(result)}")

    def run(self):
        self.log("工作线程启动")
        try:
            self._run_loop()
        finally:
            self._teardown()

    def _run_loop(self):
        delay = config.RECONNECT_MIN_DELAY
        consecutive_fail = 0

        while not self._stop_flag.is_set():
            self._set(state="connecting", last_error="")
            self._disconnected.clear()

            client = self._build_client()
            self._client = client

            try:
                result = self._logon_with_token_fallback(client)
            except Exception as e:
                self.log(f"登录异常: {e}")
                result = EResult.Fail

            if result != EResult.OK:
                consecutive_fail += 1
                self._set(state="error" if consecutive_fail > 3 else "reconnecting",
                          last_error=config.eresult_text(int(result)))
                self.log(f"CM 登录失败: {config.eresult_text(int(result))} ({result})")

                # 令牌被撤销/拒绝: 重登也没用, 等待用户重新登录账号
                if result in (EResult.AccessDenied, EResult.InvalidPassword, EResult.AccountDisabled,
                              EResult.InvalidLoginAuthCode, EResult.Expired, EResult.Revoked):
                    self._set(state="error")
                    self.log("令牌已失效, 请在页面上重新登录该账号")
                    self._park_stopped()
                    return

                try:
                    client.disconnect()
                except Exception:
                    pass
                if self._stop_flag.wait(min(delay, config.RECONNECT_MAX_DELAY)):
                    break
                delay = min(delay * 2, config.RECONNECT_MAX_DELAY)
                continue

            consecutive_fail = 0
            delay = config.RECONNECT_MIN_DELAY
            self._set(state="online", last_error="", logined_at=time.time())
            self.farmed_session = 0.0
            self._persisted = 0.0
            self.log("已登录 Steam 网络")

            if self.idle_appids:
                self._apply_idle(client, self.idle_appids)

            self._park_loop(client)

            if self._stop_flag.is_set():
                break
            self._set(state="reconnecting")

        self._set(state="stopped")

    def _logon_with_token_fallback(self, client):
        """优先 access_token, 失败再试 refresh_token, 再失败则刷新 access_token 重试一次"""
        attempts = []
        if self.access_token:
            attempts.append(("access_token", self.access_token))
        attempts.append(("refresh_token", self.refresh_token))

        for kind, token in attempts:
            self.log(f"正在连接 Steam CM ({kind}) ...")
            result = _token_logon(client, self.account_name, self.steamid, token)
            if result == EResult.OK:
                return result
            self.log(f"{kind} 登录未通过: {result}")

            # access_token 过期属于预期, 继续用 refresh_token;
            # 其他错误换一种 token 再试一次
            try:
                client.disconnect()
            except Exception:
                pass
            self._disconnected.clear()
            client = self._build_client()
            self._client = client

        # 最后: 用 refresh_token 现换一个 access_token 再试
        try:
            self.log("尝试刷新 access_token ...")
            new_token = self.manager.refresh_access_token(self.steamid)
            self.access_token = new_token
            result = _token_logon(client, self.account_name, self.steamid, new_token)
            if result == EResult.OK:
                return result
            try:
                client.disconnect()
            except Exception:
                pass
            return result
        except Exception as e:
            self.log(f"刷新 access_token 失败: {e}")
            try:
                client.disconnect()
            except Exception:
                pass
            return EResult.Fail

    def _apply_idle(self, client, appids):
        appids = [int(a) for a in appids][: config.MAX_IDLE_GAMES]
        if not appids:
            client.games_played([])
            self._set(idle_appids=[], idle_since=0.0)
            self.log("已停止挂机")
            return
        client.games_played(appids)
        self._set(idle_appids=appids, idle_since=time.time())
        self.log(f"开始挂机 {len(appids)} 个游戏: {appids}")

    def _park_loop(self, client):
        """驻留循环: 保持 gevent hub 运转, 处理命令, 累计挂机时长"""
        last_persist = time.time()
        while not self._stop_flag.is_set():
            client.sleep(1.0)

            # 处理命令
            while True:
                try:
                    cmd, payload = self._cmd_q.get_nowait()
                except queue.Empty:
                    break
                if cmd == "__stop__":
                    self._stop_flag.set()
                    break
                try:
                    if cmd == "idle":
                        self._apply_idle(client, payload)
                    elif cmd == "stop_idle":
                        self._apply_idle(client, [])
                except Exception as e:
                    self.log(f"命令执行失败 ({cmd}): {e}")

            if self._stop_flag.is_set():
                break

            # 掉线检测
            if self._disconnected.is_set() or not client.connected:
                self.log("检测到掉线, 准备重连")
                break

            # 挂机时长累计与落盘
            if self.idle_appids and self.idle_since:
                self.farmed_session += 1.0
            if time.time() - last_persist >= 60:
                last_persist = time.time()
                if self.farmed_session:
                    try:
                        self.manager.db.add_farmed(self.steamid, self.farmed_session - self._persisted)
                        self._persisted = self.farmed_session
                    except Exception:
                        pass

        # 退出前落盘
        if self.farmed_session and self.farmed_session > getattr(self, "_persisted", 0):
            try:
                self.manager.db.add_farmed(self.steamid, self.farmed_session - getattr(self, "_persisted", 0))
            except Exception:
                pass

    def _park_stopped(self):
        """令牌失效后驻留等待, 不再重连 (等待用户重新登录)"""
        while not self._stop_flag.is_set():
            gevent.sleep(1.0)
            while True:
                try:
                    cmd, payload = self._cmd_q.get_nowait()
                except queue.Empty:
                    break
                if cmd == "__stop__":
                    self._stop_flag.set()

    def _teardown(self):
        client = self._client
        if client:
            try:
                if client.logged_on:
                    client.logout()
                else:
                    client.disconnect()
            except Exception:
                try:
                    client.disconnect()
                except Exception:
                    pass
        self._set(state="stopped")
        self.log("工作线程退出")

    _persisted = 0.0
    _remove = False
