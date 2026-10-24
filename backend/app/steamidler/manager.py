"""账号管理器: 登录会话、worker 生命周期、access_token 刷新、游戏库

源 manager.py 适配(docs/steamidler-migration.md):DB 调用换 db_svc(SQLAlchemy,
主库),其余逻辑不动;运行态挂 app.state.steamidler_manager(禁模块级单例),
get_manager(app) 懒建,Manager.start() 由 app/todo/__init__.py 的 start_background
调用(TESTING 空转),shutdown 经本模块 atexit 钩子尽力停止(sdklogs 同模式)。
"""
import atexit
import base64
import json
import re
import threading
import time
import weakref

import requests

from app.shared.modules import mod_logger

from . import config
from . import db_svc
from .auth import AuthError, LoginAttempt, _http, decode_steam_jwt, generate_access_token
from .worker import AccountWorker

_log = mod_logger('steamidler')


class _BoundDatabase:
    def __init__(self, app):
        self.app = app

    def __getattr__(self, name):
        target = getattr(db_svc, name)
        def call(*args, **kwargs):
            from app.db import database_context
            with database_context(self.app):
                return target(*args, **kwargs)
        return call


class Manager:
    def __init__(self, app=None):
        self.db = _BoundDatabase(app) if app is not None else db_svc
        self.attempts = {}                 # attempt_id -> LoginAttempt
        self.workers = {}                  # steamid -> AccountWorker
        self._tokens = {}                  # steamid -> {"access_token", "exp"}
        self._lock = threading.RLock()
        self._stop_all = False
        self._account_locks = {}
        self._completed_attempts = {}
        self._completion_locks = {}

    def _account_lock(self, steamid, kind='worker'):
        with self._lock:
            return self._account_locks.setdefault((steamid, kind), threading.RLock())

    # ================= 启动 / 停止 =================
    def start(self):
        """服务启动: 恢复所有已保存账号"""
        self._stop_all = False
        for acc in self.db.list_accounts():
            try:
                self._start_worker_for(acc)
            except Exception as e:
                _log.warning(f"恢复账号 {acc['account_name']} 失败: {e}")

    def shutdown(self, timeout=8):
        self._stop_all = True
        deadline = time.monotonic() + timeout
        with self._lock:
            workers = list(self.workers.values())
            attempts = list(self.attempts.values())
        for attempt in attempts:
            if getattr(attempt, 'state', '') in ('pending', 'polling'):
                attempt.cancel()
        for w in workers:
            w.stop()
        for w in workers:
            w.join(timeout=max(0, deadline - time.monotonic()))
        return all(not w.is_alive() for w in workers)

    # ================= 登录流程 =================
    def begin_login(self, username, password):
        self._prune_attempts()
        with self._lock:
            # 同一账号不允许并发登录
            for a in self.attempts.values():
                if a.username == username and a.state in ("pending", "polling"):
                    a.cancel()
        attempt = LoginAttempt(username.strip(), password)
        with self._lock:
            if self._stop_all:
                raise AuthError('服务正在停止', 0)
            if len(self.attempts) >= 128:
                raise AuthError('登录会话过多，请稍后重试', 0)
            self.attempts[attempt.id] = attempt
        status = attempt.begin()

        # 若账号配置过 shared_secret 且支持令牌验证码 -> 自动提交
        if status["state"] in ("pending", "polling") and status.get("steamid"):
            acc = self.db.get_account(status["steamid"])
            if acc and acc.get("shared_secret"):
                types = [c["confirmation_type"] for c in status.get("allowed", [])]
                if config.GUARD_DEVICE_CODE in types:
                    code = self._totp_code(acc["shared_secret"])
                    if code:
                        attempt.submit_code(code, config.GUARD_DEVICE_CODE)
                        return attempt.status()
        return status

    def submit_code(self, attempt_id, code, code_type=None):
        attempt = self._get_attempt(attempt_id)
        if not attempt:
            return {"state": "failed", "error": "登录会话不存在或已过期"}
        if code_type is None:
            # 未指定类型时根据 Steam 允许的方式推断: 优先令牌验证码
            types = [c["confirmation_type"] for c in attempt.allowed]
            code_type = config.GUARD_DEVICE_CODE if config.GUARD_DEVICE_CODE in types \
                else (config.GUARD_EMAIL_CODE if config.GUARD_EMAIL_CODE in types else config.GUARD_DEVICE_CODE)
        return attempt.submit_code(code, code_type)

    def attempt_status(self, attempt_id):
        attempt = self._get_attempt(attempt_id)
        return attempt.status() if attempt else {"state": "failed", "error": "登录会话不存在或已过期"}

    def _get_attempt(self, attempt_id):
        self._prune_attempts()
        with self._lock:
            a = self.attempts.get(attempt_id)
            if a and a.state in ("success", "failed", "timeout"):
                # 已结束的会话保留一小段时间供查询
                if time.time() - a.created_at > 600:
                    self.attempts.pop(attempt_id, None)
                    return None
            return a

    def _prune_attempts(self):
        with self._lock:
            cutoff = time.time() - 600
            for aid, attempt in list(self.attempts.items()):
                if attempt.created_at >= cutoff:
                    continue
                if attempt.state in ('pending', 'polling'):
                    attempt.cancel()
                self.attempts.pop(aid, None)
                self._completed_attempts.pop(aid, None)
                lock = self._completion_locks.get(aid)
                if lock is not None and lock.acquire(blocking=False):
                    lock.release()
                    self._completion_locks.pop(aid, None)

    def complete_login(self, attempt):
        with self._lock:
            lock = self._completion_locks.setdefault(attempt.id, threading.Lock())
        with lock:
            with self._lock:
                cached = self._completed_attempts.get(attempt.id)
            if cached is not None:
                return cached
            account = self.maybe_complete(attempt)
            if account is not None:
                with self._lock:
                    self._completed_attempts[attempt.id] = account
            return account

    def _totp_code(self, shared_secret):
        try:
            from steam.guard import generate_twofactor_code
            key = shared_secret.encode("utf-8")
            try:
                key = base64.b64decode(shared_secret, validate=True)
            except Exception:
                pass
            return generate_twofactor_code(key)
        except Exception:
            return None

    # ================= 登录完成 -> 落库并启动 worker =================
    def maybe_complete(self, attempt):
        """轮询到 success 后调用"""
        if not attempt.tokens:
            return None
        refresh = attempt.tokens["refresh_token"]
        access = attempt.tokens["access_token"]
        claims = decode_steam_jwt(refresh)
        steamid = attempt.steamid or str(claims.get("sub", ""))
        if not steamid:
            return None

        avatar = self._fetch_avatar(steamid)
        self.db.upsert_account(steamid, attempt.account_name or attempt.username, refresh, avatar)
        acc = self.db.get_account(steamid)
        with self._lock:
            self._tokens[steamid] = {
                "access_token": access,
                "exp": claims.get("exp", 0) or self._jwt_exp(access),
            }
        # 已存在 worker (重新登录) -> 更新其令牌并停止旧实例, 重启
        self._restart_worker_for(acc)
        return acc

    def _fetch_avatar(self, steamid):
        try:
            r = requests.get(f"https://steamcommunity.com/profiles/{steamid}/",
                             headers={"User-Agent": config.USER_AGENT}, timeout=10)
            m = re.search(r'<link rel="image_src" href="([^"]+)"', r.text)
            if m:
                return m.group(1)
        except Exception:
            pass
        return ""

    def _jwt_exp(self, token):
        return decode_steam_jwt(token).get("exp", 0)

    # ================= worker 生命周期 =================
    def _restart_worker_for(self, acc):
        with self._account_lock(acc['steamid']):
            return self._restart_worker_locked(acc)

    def _restart_worker_locked(self, acc):
        steamid = acc["steamid"]
        if self._stop_all:
            raise AuthError('服务正在停止', 0)
        with self._lock:
            old = self.workers.get(steamid)
        if old:
            old.stop()
            old.join(timeout=6)
            if old.is_alive():
                raise AuthError('旧挂机进程尚未停止，请稍后重试', 0)
        idle = self.db.get_idle_appids(steamid) if acc.get("auto_resume") else []
        token_info = self._tokens.get(steamid, {})
        w = AccountWorker(self, steamid, acc["account_name"], acc["refresh_token"],
                          access_token=token_info.get("access_token", ""), idle_appids=idle)
        with self._lock:
            if self._stop_all:
                raise AuthError('服务正在停止', 0)
            w.start()
            self.workers[steamid] = w

    def _start_worker_for(self, acc):
        """启动(通常用于服务启动时恢复)"""
        with self._account_lock(acc['steamid']):
            with self._lock:
                old = self.workers.get(acc['steamid'])
                if old is not None and old.is_alive():
                    return old
            return self._start_worker_locked(acc)

    def _start_worker_locked(self, acc):
        if self._stop_all:
            return
        idle = self.db.get_idle_appids(acc["steamid"]) if acc.get("auto_resume") else []
        w = AccountWorker(self, acc["steamid"], acc["account_name"], acc["refresh_token"], idle_appids=idle)
        with self._lock:
            if self._stop_all:
                return
            w.start()
            self.workers[acc["steamid"]] = w

    # ================= access token / 游戏库 =================
    def refresh_access_token(self, steamid):
        requested = time.time()
        with self._account_lock(steamid, 'token'):
            with self._lock:
                info = self._tokens.get(steamid, {})
                if info.get('refreshed_at', 0) >= requested:
                    return info['access_token']
            return self._refresh_access_token_locked(steamid)

    def _refresh_access_token_locked(self, steamid):
        acc = self.db.get_account(steamid)
        if not acc:
            raise AuthError("账号不存在", 0)
        token = generate_access_token(_http(), acc["refresh_token"], steamid)
        with self._lock:
            self._tokens[steamid] = {"access_token": token, "exp": self._jwt_exp(token),
                                    'refreshed_at': time.time()}
        return token

    def get_access_token(self, steamid, force=False):
        with self._lock:
            info = self._tokens.get(steamid)
        if not force and info and info.get("access_token") and info.get("exp", 0) > time.time() + 60:
            return info["access_token"]
        return self.refresh_access_token(steamid)

    def fetch_games(self, steamid, force=False):
        """IPlayerService/GetOwnedGames, 带缓存"""
        requested = time.time()
        with self._account_lock(steamid, 'games'):
            acc = self.db.get_account(steamid)
            if acc and acc.get('games_cache') and (acc.get('games_cached_at') or 0) >= requested:
                return json.loads(acc['games_cache'])
            return self._fetch_games_locked(steamid, force)

    def _fetch_games_locked(self, steamid, force=False):
        acc = self.db.get_account(steamid)
        if not acc:
            raise AuthError("账号不存在", 0)
        if not force and acc.get("games_cache") and time.time() - (acc.get("games_cached_at") or 0) < 3600:
            return json.loads(acc["games_cache"])

        token = self.get_access_token(steamid)
        r = requests.get(
            "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/",
            params={
                "access_token": token,
                "steamid": steamid,
                "include_appinfo": "true",
                "include_played_free_games": "true",
            },
            headers={"User-Agent": config.USER_AGENT},
            timeout=20,
        )
        if r.status_code == 401:
            token = self.get_access_token(steamid, force=True)
            r = requests.get(
                "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/",
                params={
                    "access_token": token, "steamid": steamid,
                    "include_appinfo": "true", "include_played_free_games": "true",
                },
                headers={"User-Agent": config.USER_AGENT}, timeout=20,
            )
        if r.status_code != 200:
            raise AuthError(f"获取游戏库失败 (HTTP {r.status_code})", 0)
        resp = r.json().get("response", {})
        games = [
            {
                "appid": g["appid"],
                "name": g.get("name", f"App {g['appid']}"),
                "playtime_forever": g.get("playtime_forever", 0),
                "rtime_last_played": g.get("rtime_last_played", 0),
            }
            for g in resp.get("games", [])
            if g.get("appid")
        ]
        games.sort(key=lambda g: -(g["playtime_forever"] or 0))
        self.db.update_fields(steamid, games_cache=json.dumps(games, ensure_ascii=False), games_cached_at=time.time())
        return games

    # ================= 挂机控制 =================
    def start_idle(self, steamid, appids):
        if not appids:
            raise AuthError("请至少选择一个游戏", 0)
        if len(appids) > config.MAX_IDLE_GAMES:
            raise AuthError(f"最多同时挂机 {config.MAX_IDLE_GAMES} 个游戏", 0)
        if not self.db.get_account(steamid):
            raise AuthError("账号不存在", 0)
        self.db.set_idle_appids(steamid, appids)
        with self._lock:
            w = self.workers.get(steamid)
        if w:
            w.send_command("idle", [int(a) for a in appids])
        return True

    def stop_idle(self, steamid):
        self.db.set_idle_appids(steamid, [])
        with self._lock:
            w = self.workers.get(steamid)
        if w:
            w.send_command("stop_idle")
        return True

    def remove_account(self, steamid):
        with self._account_lock(steamid):
            return self._remove_account_locked(steamid)

    def _remove_account_locked(self, steamid):
        self.stop_idle(steamid)
        with self._lock:
            w = self.workers.pop(steamid, None)
        if w:
            w.stop(remove=True)
            w.join(timeout=6)
            if w.is_alive():
                with self._lock:
                    self.workers[steamid] = w
                raise AuthError('挂机进程尚未停止，请稍后重试删除', 0)
        self.db.delete_account(steamid)
        with self._lock:
            self._tokens.pop(steamid, None)
        return True

    # ================= 状态汇总 =================
    def accounts_snapshot(self):
        out = []
        self._prune_attempts()
        for acc in self.db.list_accounts_public():
            steamid = acc["steamid"]
            with self._lock:
                w = self.workers.get(steamid)
            try:
                idle_appids = json.loads(acc.get("idle_appids") or "[]")
            except ValueError:
                idle_appids = []
            item = {
                "steamid": steamid,
                "account_name": acc["account_name"],
                "avatar_url": acc.get("avatar_url") or "",
                "idle_appids": idle_appids,
                "auto_resume": bool(acc.get("auto_resume")),
                "shared_secret_set": bool(acc.get("shared_secret_set")),
                "farmed_total": round(acc.get("farmed_seconds") or 0, 1),
                "state": "offline",
                "last_error": "",
                "idle_since": 0,
                "farmed_session": 0,
                "online_for": 0,
                "worker_alive": False,
            }
            if w:
                item.update(w.snapshot())
                item["worker_alive"] = w.is_alive()
            out.append(item)
        return out

    def account_log(self, steamid):
        with self._lock:
            w = self.workers.get(steamid)
        return w.get_log() if w else []


# ================= app.state 挂载与进程退出清理 =================

_MANAGERS = weakref.WeakSet()
_MANAGERS_LOCK = threading.Lock()


def get_manager(app):
    """取(或懒建)该 app 的 Manager——挂 app.state.steamidler_manager,多 app 测试互不干扰。"""
    m = getattr(app.state, "steamidler_manager", None)
    if m is None:
        with _MANAGERS_LOCK:
            m = getattr(app.state, 'steamidler_manager', None)
            if m is None:
                m = Manager(app)
                app.state.steamidler_manager = m
                _MANAGERS.add(m)
    return m


def stop_manager(app, timeout=5.0):
    """显式停止该 app 的 Manager(无 FastAPI shutdown 钩子时的手动通道)。"""
    m = getattr(app.state, "steamidler_manager", None)
    if m is None:
        return True
    ok = m.shutdown(timeout)
    with _MANAGERS_LOCK:
        if ok:
            _MANAGERS.discard(m)
            app.state.steamidler_manager = None
    return ok


@atexit.register
def _shutdown_managers():
    """进程退出前尽力停止全部 worker(强杀时为尽力而为;Manager.start 由
    app/todo/__init__.py 的 start_background 启动,TESTING 空转不会创建 worker)。"""
    with _MANAGERS_LOCK:
        managers = list(_MANAGERS)
    for m in managers:
        try:
            m.shutdown()
        except Exception:
            pass
    with _MANAGERS_LOCK:
        _MANAGERS.clear()
