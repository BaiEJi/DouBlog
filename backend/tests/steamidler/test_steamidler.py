"""steamidler 子模块测试(docs/steamidler-migration.md"测试"节)。

覆盖:CRUD 路径(accounts 列表/删除)、登录流程状态机(begin→code→status,
Fake LoginAttempt,不连真实 Steam)、配置端点(shared_secret/auto_resume 写读)、
idle 配置校验与读写、games/log 端点(manager 打桩)、鉴权 401、信封形状、
Manager 生命周期挂载与 start/shutdown 对接(打桩 AccountWorker)。

与源 steam-idler 的适配点(规范允许的骨架差异):
- 响应为 {success,code,message,data} 信封:统一 .json()['data'] unwrap
- 前缀 /api/steamidler;鉴权走 Basic(上层 conftest 的 auth_headers)
- Manager 挂 app.state.steamidler_manager(测试经 get_manager 注入/替换)
- 不做真实 Steam 连接:登录用 FakeAttempt 注入 manager.attempts / 打桩
  LoginAttempt;maybe_complete 的头像抓取与 worker 重启同样打桩
"""
import base64
import time

import pytest


@pytest.fixture
def manager(app):
    """该 app 的 steamidler Manager(挂 app.state;构造不启动任何线程)。"""
    from app.steamidler.manager import get_manager
    return get_manager(app)


@pytest.fixture
def db_svc():
    from app.steamidler import db_svc
    return db_svc


def seed_account(db_svc, steamid="76561198000000001", name="tester",
                 refresh=None, avatar="", **fields):
    db_svc.upsert_account(steamid, name, refresh or f"rt-{steamid}", avatar)
    if fields:
        db_svc.update_fields(steamid, **fields)
    return db_svc.get_account(steamid)


class FakeAttempt:
    """LoginAttempt 桩:状态机由测试直接编排,不打真实 Steam 接口。"""

    _seq = 0

    def __init__(self, username="tester", state="pending", steamid="",
                 allowed=None, tokens=None):
        FakeAttempt._seq += 1
        self.id = f"fake{FakeAttempt._seq}"
        self.username = username
        self.state = state
        self.error = ""
        self.steamid = steamid
        self.account_name = username
        self.allowed = allowed or []
        self.tokens = tokens
        self.created_at = time.time()   # 新鲜,不会被 600s 清理回收
        self.submitted = []

    def status(self):
        return {
            "attempt_id": self.id,
            "username": self.username,
            "state": self.state,
            "error": self.error,
            "steamid": self.steamid,
            "account_name": self.account_name,
            "allowed": list(self.allowed),
            "elapsed": 1.0,
        }

    def begin(self):
        return self.status()

    def submit_code(self, code, code_type):
        self.submitted.append((code, code_type))
        self.state = "polling"
        return self.status()

    def cancel(self):
        self.state = "failed"
        self.error = "已取消"


# ---------- 鉴权与信封 ----------

def test_requires_auth(app):
    """router 级 Depends(require_basic):无凭据一律 401。"""
    from fastapi.testclient import TestClient

    c = TestClient(app)
    for method, url, kw in (
        ("get", "/api/steamidler/meta", {}),
        ("get", "/api/steamidler/accounts", {}),
        ("get", "/api/steamidler/login/status", {"params": {"attempt_id": "x"}}),
        ("post", "/api/steamidler/login/begin",
         {"json": {"username": "u", "password": "p"}}),
        ("delete", "/api/steamidler/accounts/123", {}),
    ):
        r = getattr(c, method)(url, **kw)
        assert r.status_code == 401, (method, url, r.status_code)


def test_meta_envelope(client):
    r = client.get("/api/steamidler/meta")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"success", "code", "message", "data"}
    assert body["success"] is True and body["code"] == 200
    assert body["data"] == {"max_idle_games": 32}


# ---------- accounts CRUD 路径(真实 Manager,无 worker 不连 Steam) ----------

def test_accounts_empty(client):
    r = client.get("/api/steamidler/accounts")
    assert r.status_code == 200
    assert r.json()["data"] == []


def test_accounts_list_and_delete(client, manager, db_svc):
    seed_account(db_svc, "76561198000000001", "acc1")
    seed_account(db_svc, "76561198000000002", "acc2", avatar="https://a/x.jpg")

    data = client.get("/api/steamidler/accounts").json()["data"]
    assert [a["account_name"] for a in data] == ["acc1", "acc2"]  # 按 created_at 排序
    first = data[0]
    assert first["steamid"] == "76561198000000001"
    assert first["state"] == "offline" and first["worker_alive"] is False
    assert first["idle_appids"] == [] and first["auto_resume"] is True
    assert first["shared_secret_set"] is False and first["farmed_total"] == 0
    assert data[1]["avatar_url"] == "https://a/x.jpg"

    # 删除:先清 idle 配置再删行;源语义删不存在账号也返回 ok
    assert client.delete("/api/steamidler/accounts/76561198000000001").json()["data"] == {"ok": True}
    data = client.get("/api/steamidler/accounts").json()["data"]
    assert [a["steamid"] for a in data] == ["76561198000000002"]
    assert db_svc.get_account("76561198000000001") is None
    r = client.delete("/api/steamidler/accounts/999")
    assert r.status_code == 200 and r.json()["data"] == {"ok": True}


def test_upsert_avatar_semantics(db_svc):
    """源 ON CONFLICT 语义:avatar_url 仅在非空时覆盖。"""
    seed_account(db_svc, "76561198000000003", "a3", avatar="https://a/3.jpg")
    db_svc.upsert_account("76561198000000003", "a3b", "rt2", "")   # 空 avatar 不覆盖
    acc = db_svc.get_account("76561198000000003")
    assert acc["avatar_url"] == "https://a/3.jpg"
    assert acc["account_name"] == "a3b" and acc["refresh_token"] == "rt2"
    db_svc.upsert_account("76561198000000003", "a3c", "rt3", "https://a/new.jpg")
    assert db_svc.get_account("76561198000000003")["avatar_url"] == "https://a/new.jpg"


# ---------- idle 配置端点 ----------

def test_idle_config_roundtrip(client, manager, db_svc):
    sid = seed_account(db_svc)["steamid"]

    r = client.post(f"/api/steamidler/accounts/{sid}/idle", json={"appids": [730, 570]})
    assert r.status_code == 200 and r.json()["data"] == {"ok": True}
    assert db_svc.get_idle_appids(sid) == [730, 570]

    r = client.post(f"/api/steamidler/accounts/{sid}/stop")
    assert r.status_code == 200 and r.json()["data"] == {"ok": True}
    assert db_svc.get_idle_appids(sid) == []

    # 校验分支:空列表 / 超上限 / 账号不存在
    r = client.post(f"/api/steamidler/accounts/{sid}/idle", json={"appids": []})
    assert r.status_code == 400 and r.json()["message"] == "请至少选择一个游戏"
    r = client.post(f"/api/steamidler/accounts/{sid}/idle",
                    json={"appids": list(range(1, 34))})
    assert r.status_code == 400 and r.json()["message"] == "最多同时挂机 32 个游戏"
    r = client.post("/api/steamidler/accounts/999/idle", json={"appids": [730]})
    assert r.status_code == 400 and r.json()["message"] == "账号不存在"


# ---------- 配置端点:shared_secret / auto_resume ----------

def test_shared_secret_write_read(client, manager, db_svc):
    sid = seed_account(db_svc)["steamid"]
    secret = base64.b64encode(b"01234567890123456789").decode()

    r = client.post(f"/api/steamidler/accounts/{sid}/shared_secret",
                    json={"shared_secret": secret})
    assert r.status_code == 200 and r.json()["data"] == {"ok": True}
    assert db_svc.get_account(sid)["shared_secret"] == secret
    assert client.get("/api/steamidler/accounts").json()["data"][0]["shared_secret_set"] is True

    # 清空同样合法
    r = client.post(f"/api/steamidler/accounts/{sid}/shared_secret",
                    json={"shared_secret": ""})
    assert r.status_code == 200
    assert client.get("/api/steamidler/accounts").json()["data"][0]["shared_secret_set"] is False

    # 未知账号 404(原始文案,不被全局 404 处理器覆盖)
    r = client.post("/api/steamidler/accounts/999/shared_secret",
                    json={"shared_secret": secret})
    assert r.status_code == 404 and r.json()["message"] == "账号不存在"


def test_auto_resume_write_read(client, manager, db_svc):
    sid = seed_account(db_svc)["steamid"]
    r = client.post(f"/api/steamidler/accounts/{sid}/auto_resume",
                    json={"enabled": False})
    assert r.status_code == 200 and r.json()["data"] == {"ok": True}
    assert client.get("/api/steamidler/accounts").json()["data"][0]["auto_resume"] is False
    client.post(f"/api/steamidler/accounts/{sid}/auto_resume", json={"enabled": True})
    assert client.get("/api/steamidler/accounts").json()["data"][0]["auto_resume"] is True


# ---------- 登录流程状态机(Fake LoginAttempt,不连 Steam) ----------

def test_login_begin_validation(client):
    r = client.post("/api/steamidler/login/begin",
                    json={"username": "  ", "password": "p"})
    assert r.status_code == 400 and r.json()["message"] == "请输入账号和密码"
    r = client.post("/api/steamidler/login/begin",
                    json={"username": "u", "password": ""})
    assert r.status_code == 400 and r.json()["message"] == "请输入账号和密码"


def test_login_flow_state_machine(client, manager, monkeypatch):
    """begin → code → status:LoginAttempt 打桩,验证 manager 编排与推断逻辑。"""
    from app.steamidler import manager as manager_mod

    fake_holder = {}

    def _fake_factory(username, password):
        fake_holder["a"] = FakeAttempt(
            username=username, state="pending",
            allowed=[{"confirmation_type": 3, "name": "令牌验证码", "message": ""}],
        )
        return fake_holder["a"]

    monkeypatch.setattr(manager_mod, "LoginAttempt", _fake_factory)

    r = client.post("/api/steamidler/login/begin",
                    json={"username": "tester", "password": "pw"})
    assert r.status_code == 200
    data = r.json()["data"]
    fake = fake_holder["a"]
    assert data["state"] == "pending" and data["attempt_id"] == fake.id
    assert data["allowed"][0]["confirmation_type"] == 3

    # 提交验证码:未指定类型时按 allowed 推断为令牌验证码(3)
    r = client.post("/api/steamidler/login/code",
                    json={"attempt_id": fake.id, "code": "12345"})
    assert r.status_code == 200 and r.json()["data"]["state"] == "polling"
    assert fake.submitted == [("12345", 3)]

    # 显式 code_type:null(前端 api.js 默认参数即如此发)同样走推断,不得 422
    r = client.post("/api/steamidler/login/code",
                    json={"attempt_id": fake.id, "code": "12345", "code_type": None})
    assert r.status_code == 200 and r.json()["data"]["state"] == "polling"
    assert fake.submitted[-1] == ("12345", 3)

    # 显式指定邮箱验证码类型(2)
    client.post("/api/steamidler/login/code",
                json={"attempt_id": fake.id, "code": "99999", "code_type": 2})
    assert fake.submitted[-1] == ("99999", 2)

    # 状态查询:pending → polling
    r = client.get("/api/steamidler/login/status", params={"attempt_id": fake.id})
    assert r.status_code == 200 and r.json()["data"]["state"] == "polling"

    # 不存在的会话 404(原始文案)
    r = client.get("/api/steamidler/login/status", params={"attempt_id": "nope"})
    assert r.status_code == 404 and r.json()["message"] == "登录会话不存在或已过期"


def test_login_begin_auto_submits_totp(client, manager, db_svc, monkeypatch):
    """已配置 shared_secret 且 Steam 允许令牌验证码 → begin 后自动提交 TOTP。"""
    from app.steamidler import manager as manager_mod

    sid = "76561198000000009"
    seed_account(db_svc, sid, "totp_user",
                 shared_secret=base64.b64encode(b"01234567890123456789").decode())

    fake_holder = {}

    def _fake_factory(username, password):
        fake_holder["a"] = FakeAttempt(
            username=username, state="pending", steamid=sid,
            allowed=[{"confirmation_type": 3, "name": "令牌验证码", "message": ""}],
        )
        return fake_holder["a"]

    monkeypatch.setattr(manager_mod, "LoginAttempt", _fake_factory)

    r = client.post("/api/steamidler/login/begin",
                    json={"username": "totp_user", "password": "pw"})
    data = r.json()["data"]
    assert data["state"] == "polling"          # 自动提交后进入轮询
    fake = fake_holder["a"]
    assert len(fake.submitted) == 1 and fake.submitted[0][1] == 3
    assert len(fake.submitted[0][0]) == 5      # TOTP 5 位码


def test_login_status_success_completes(client, manager, db_svc, monkeypatch):
    """轮询到 success → 落库(真实 db_svc)+ 返回账号信息;maybe_complete 只执行一次。"""
    from app.steamidler import manager as manager_mod
    from app.steamidler.manager import Manager

    sid = "76561198000000010"
    monkeypatch.setattr(Manager, "_fetch_avatar", lambda self, s: f"https://a/{s}.jpg")
    restarts = []
    monkeypatch.setattr(Manager, "_restart_worker_for",
                        lambda self, acc: restarts.append(acc["steamid"]))

    fake = FakeAttempt(username="newacc", state="success", steamid=sid,
                       tokens={"refresh_token": "refresh.x", "access_token": "access.y"})
    with manager._lock:
        manager.attempts[fake.id] = fake

    r = client.get("/api/steamidler/login/status", params={"attempt_id": fake.id})
    data = r.json()["data"]
    assert data["state"] == "success"
    assert data["account"] == {"steamid": sid, "account_name": "newacc",
                               "avatar_url": f"https://a/{sid}.jpg"}

    acc = db_svc.get_account(sid)
    assert acc is not None and acc["refresh_token"] == "refresh.x"
    assert acc["account_name"] == "newacc"
    assert manager._tokens[sid]["access_token"] == "access.y"
    assert restarts == [sid]

    # 第二次查询:去重,不再触发 maybe_complete(无新落库/重启)
    r2 = client.get("/api/steamidler/login/status", params={"attempt_id": fake.id})
    assert r2.json()["data"]["state"] == "success"
    assert restarts == [sid]


# ---------- games / log 端点(manager 打桩) ----------

def test_games_endpoint_mocked(client, manager, db_svc, monkeypatch):
    from app.steamidler.auth import AuthError

    sid = seed_account(db_svc)["steamid"]
    games = [{"appid": 730, "name": "CS2", "playtime_forever": 10, "rtime_last_played": 0}]
    monkeypatch.setattr(manager, "fetch_games", lambda s, force=False: list(games))
    r = client.get(f"/api/steamidler/accounts/{sid}/games")
    assert r.status_code == 200 and r.json()["data"] == {"games": games}

    def _boom(s, force=False):
        raise AuthError("账号不存在", 0)

    monkeypatch.setattr(manager, "fetch_games", _boom)
    r = client.get(f"/api/steamidler/accounts/{sid}/games")
    assert r.status_code == 400 and r.json()["message"] == "账号不存在"


def test_account_log_with_fake_worker(client, manager, db_svc):
    sid = seed_account(db_svc)["steamid"]

    r = client.get(f"/api/steamidler/accounts/{sid}/log")
    assert r.status_code == 200 and r.json()["data"] == {"lines": []}   # 无 worker

    class _W:  # 桩 worker:仅暴露 get_log
        @staticmethod
        def get_log(limit=200):
            return ["[00:00:01] 工作线程启动"]

    with manager._lock:
        manager.workers[sid] = _W()
    r = client.get(f"/api/steamidler/accounts/{sid}/log")
    assert r.json()["data"] == {"lines": ["[00:00:01] 工作线程启动"]}
    with manager._lock:
        del manager.workers[sid]


def test_snapshot_merges_worker_state(client, manager, db_svc):
    """accounts 快照在有 worker 时合并其 snapshot()(桩验证字段覆盖。"""
    sid = seed_account(db_svc)["steamid"]

    class _W:
        @staticmethod
        def snapshot():
            return {"state": "online", "idle_appids": [730], "farmed_session": 12.5,
                    "worker_alive": True}

        @staticmethod
        def is_alive():
            return True

    with manager._lock:
        manager.workers[sid] = _W()
    item = client.get("/api/steamidler/accounts").json()["data"][0]
    assert item["state"] == "online" and item["idle_appids"] == [730]
    assert item["farmed_session"] == 12.5 and item["worker_alive"] is True
    with manager._lock:
        del manager.workers[sid]


# ---------- Manager 生命周期(app.state 挂载 + start/shutdown 对接) ----------

def test_manager_mounted_on_app_state(app):
    from app.steamidler.manager import get_manager

    m1 = get_manager(app)
    m2 = get_manager(app)
    assert m1 is m2 and app.state.steamidler_manager is m1


def test_manager_start_resumes_accounts(app, db_svc, monkeypatch):
    """start() 为每个已保存账号启动 worker(auto_resume 只决定是否带挂机列表);
    AccountWorker 打桩,不连 Steam。"""
    from app.steamidler import manager as manager_mod
    from app.steamidler.manager import get_manager

    started = []

    class _FakeWorker:
        def __init__(self, manager, steamid, account_name, refresh_token,
                     access_token="", idle_appids=None):
            self.steamid = str(steamid)
            self.account_name = account_name
            self.refresh_token = refresh_token
            self.access_token = access_token
            self.idle_appids = list(idle_appids or [])
            self.stopped = False

        def start(self):
            started.append(self)

        def stop(self, remove=False):
            self.stopped = True

        def join(self, timeout=None):
            pass

        def is_alive(self):
            return not self.stopped

    monkeypatch.setattr(manager_mod, "AccountWorker", _FakeWorker)

    seed_account(db_svc, "76561198000000021", "resume_me", idle_appids="[730]")
    seed_account(db_svc, "76561198000000022", "no_resume", auto_resume=0)

    m = get_manager(app)
    m.start()
    assert set(m.workers) == {"76561198000000021", "76561198000000022"}
    by_sid = {w.steamid: w for w in started}
    assert by_sid["76561198000000021"].idle_appids == [730]   # auto_resume=1 恢复挂机列表
    assert by_sid["76561198000000021"].refresh_token == "rt-76561198000000021"
    assert by_sid["76561198000000022"].idle_appids == []      # auto_resume=0 只登录不挂机

    m.shutdown()
    assert all(w.stopped for w in started)
    assert m._stop_all is True


def test_testing_mode_skips_manager_start(app):
    """TESTING 空转:start_background 不创建 Manager(不启动 worker)。"""
    import app.todo as todo_pkg

    todo_pkg.start_background(app)
    assert getattr(app.state, "steamidler_manager", None) is None
