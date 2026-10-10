"""核心 API 场景测试(移植 MyTodo test_api.py;信封 unwrap + /api/todo 前缀)。

原版差异:舍弃 /health 与 system export/import(骨架/舍弃端点)、?token= 用例
(auth 机制不同);依赖跨用例累积状态的断言(today/stats)改为用例内自备数据。
"""
from datetime import date, timedelta


def today_str(client) -> str:
    return client.get("/api/todo/today").json()["data"]["date"]


def test_requires_auth(app):
    """router 级 Depends(require_basic):无凭据一律 401。"""
    from fastapi.testclient import TestClient

    c = TestClient(app)
    assert c.get("/api/todo/tasks").status_code == 401
    assert c.get("/api/todo/settings").status_code == 401


# ---------- 基础 ----------

def test_settings_flow(client):
    s = client.get("/api/todo/settings").json()["data"]
    assert s["quadrant_labels"]["q1"] == "立即做"
    assert "timezone" in s
    r = client.put("/api/todo/settings", json={"timezone": "Asia/Shanghai", "auto_migrate": False})
    assert r.status_code == 200
    assert r.json()["data"]["timezone"] == "Asia/Shanghai"
    assert client.put("/api/todo/settings", json={"timezone": "Not/AZone"}).status_code == 422


def test_categories_crud(client):
    cats = client.get("/api/todo/categories").json()["data"]
    assert any(c["name"] == "工作" for c in cats)  # 空库种子(ensure_migrations)

    r = client.post("/api/todo/categories", json={"name": "测试类别", "color": "#FF0000"})
    assert r.status_code == 201
    cid = r.json()["data"]["id"]
    assert client.patch(f"/api/todo/categories/{cid}", json={"name": "测试类别改"}).json()["data"]["name"] == "测试类别改"

    # 删除类别 → 任务转未分类
    tr = client.post(
        "/api/todo/tasks",
        json={"title": "归类任务", "category_id": cid, "task_date": "today", "is_important": True},
    )
    tid = tr.json()["data"]["id"]
    r = client.delete(f"/api/todo/categories/{cid}")
    assert r.status_code == 200 and r.json()["data"]["moved_to_uncategorized"] >= 1
    assert client.get(f"/api/todo/tasks/{tid}").json()["data"]["category_id"] is None


# ---------- 任务生命周期 ----------

def test_task_lifecycle(client):
    today = today_str(client)
    r = client.post(
        "/api/todo/tasks",
        json={
            "title": "Q1任务",
            "task_date": "today",
            "is_important": True,
            "is_urgent": True,
            "estimate_minutes": 30,
        },
    )
    assert r.status_code == 201
    t = r.json()["data"]
    assert t["quadrant"] == 1 and t["original_date"] == today and t["status"] == "pending"
    tid = t["id"]

    # 完成 → 重开 → 再完成
    t = client.post(f"/api/todo/tasks/{tid}/complete").json()["data"]
    assert t["status"] == "done" and t["completed_at"]
    t = client.post(f"/api/todo/tasks/{tid}/reopen").json()["data"]
    assert t["status"] == "pending" and t["completed_at"] is None
    t = client.post(f"/api/todo/tasks/{tid}/complete").json()["data"]
    assert t["status"] == "done"

    # 象限移动 Q1 → Q2
    t = client.post(f"/api/todo/tasks/{tid}/move", json={"is_important": True, "is_urgent": False}).json()["data"]
    assert t["quadrant"] == 2

    # 乐观锁:旧 revision 更新 → 409(信封保留原始文案)
    stale_rev = t["revision"]
    client.post(f"/api/todo/tasks/{tid}/reopen")
    r = client.patch(f"/api/todo/tasks/{tid}", json={"title": "改名", "revision": stale_rev})
    assert r.status_code == 409 and "revision" in r.json()["message"]
    # 恢复完成态:统计现在按任务当前状态计算,供后续统计断言使用
    client.post(f"/api/todo/tasks/{tid}/complete")


def test_quadrant_ordering(client):
    """C 移到 A 前:position C < A < B(浮点中点)。"""
    ids = []
    for i in "ABC":
        r = client.post("/api/todo/tasks", json={"title": f"排序{i}", "task_date": "today"})
        ids.append(r.json()["data"]["id"])
    a, b, c = ids
    client.post(f"/api/todo/tasks/{c}/move", json={"is_important": False, "is_urgent": False, "before_task_id": a})
    tasks = {t["id"]: t for t in client.get("/api/todo/tasks?date=today&status=active").json()["data"]}
    assert tasks[c]["position"] < tasks[a]["position"] < tasks[b]["position"]


def test_soft_delete_restore(client):
    r = client.post("/api/todo/tasks", json={"title": "将删除", "task_date": "today"})
    tid = r.json()["data"]["id"]
    assert client.delete(f"/api/todo/tasks/{tid}").status_code == 200
    assert client.get(f"/api/todo/tasks/{tid}").status_code == 404
    assert client.get(f"/api/todo/tasks/{tid}").json()["message"] == "任务不存在"
    assert client.post(f"/api/todo/tasks/{tid}/restore").status_code == 200
    assert client.get(f"/api/todo/tasks/{tid}").status_code == 200


def test_inbox_and_schedule(client):
    r = client.post("/api/todo/tasks", json={"title": "收件箱任务"})
    t = r.json()["data"]
    assert t["task_date"] is None and t["original_date"] is None
    assert any(x["id"] == t["id"] for x in client.get("/api/todo/tasks?inbox=true").json()["data"])

    t2 = client.patch(
        f"/api/todo/tasks/{t['id']}", json={"task_date": "today", "revision": t["revision"]}
    ).json()["data"]
    assert t2["task_date"] == t2["original_date"]  # 首次排期写 original_date


# ---------- 迁移链(核心差异化) ----------

def test_migration_chain_and_intervention(client):
    today = today_str(client)
    past = (date.fromisoformat(today) - timedelta(days=5)).isoformat()

    r = client.post("/api/todo/tasks", json={"title": "旧任务", "task_date": past})
    tid = r.json()["data"]["id"]

    pm = [x for x in client.get("/api/todo/migrations/pending").json()["data"] if x["id"] == tid]
    assert pm and pm[0]["days_procrastinated"] == 5 and pm[0]["intervention_required"] is False

    # 只能迁到今天或未来
    assert client.post(f"/api/todo/tasks/{tid}/migrate", json={"to_date": past}).status_code == 422

    t = client.post(f"/api/todo/tasks/{tid}/migrate", json={"to_date": "today", "reason": "测试迁移"}).json()["data"]
    assert t["task_date"] == today
    assert t["migrated_count"] == 1 and t["last_migrated_from"] == past and t["original_date"] == past

    # 已不属于逾期
    assert not [x for x in client.get("/api/todo/migrations/pending").json()["data"] if x["id"] == tid]

    # 再迁移两次凑满 3 → 干预标记
    def back_to_past():
        rev = client.get(f"/api/todo/tasks/{tid}").json()["data"]["revision"]
        client.patch(f"/api/todo/tasks/{tid}", json={"task_date": past, "revision": rev})

    for _ in range(2):
        back_to_past()
        client.post(f"/api/todo/tasks/{tid}/migrate", json={"to_date": "today"})
    back_to_past()
    mine = [x for x in client.get("/api/todo/migrations/pending").json()["data"] if x["id"] == tid][0]
    assert mine["migrated_count"] == 3 and mine["intervention_required"] is True

    # 事件日志完整
    detail = client.get(f"/api/todo/tasks/{tid}").json()["data"]
    migrated_events = [e for e in detail["events"] if e["event_type"] == "migrated"]
    assert len(migrated_events) == 3


def test_migration_bulk_and_decide(client):
    today = today_str(client)
    past = (date.fromisoformat(today) - timedelta(days=2)).isoformat()
    tids = []
    for i in range(2):
        r = client.post("/api/todo/tasks", json={"title": f"批量{i}", "task_date": past})
        tids.append(r.json()["data"]["id"])

    r = client.post("/api/todo/migrations/bulk", json={"task_ids": tids, "to_date": "today"})
    assert r.json()["data"]["migrated"] == 2

    # decide: 搁置(keep → 进入搁置列表,不再催办) + 删除
    r = client.post("/api/todo/tasks", json={"title": "将被搁置", "task_date": past})
    keep_id = r.json()["data"]["id"]
    assert client.post("/api/todo/migrations/decide", json={"task_id": keep_id, "decision": "keep"}).json()["data"]["ok"]
    assert not [x for x in client.get("/api/todo/migrations/pending").json()["data"] if x["id"] == keep_id]
    assert [x for x in client.get("/api/todo/migrations/shelved").json()["data"] if x["id"] == keep_id]

    r = client.post("/api/todo/tasks", json={"title": "将被删除", "task_date": past})
    del_id = r.json()["data"]["id"]
    client.post("/api/todo/migrations/decide", json={"task_id": del_id, "decision": "delete"})
    assert not [x for x in client.get("/api/todo/migrations/pending").json()["data"] if x["id"] == del_id]


def test_auto_migrate_skips_intervention(client):
    today = today_str(client)
    past = (date.fromisoformat(today) - timedelta(days=1)).isoformat()
    r = client.post("/api/todo/tasks", json={"title": "自动迁移目标", "task_date": past})
    tid = r.json()["data"]["id"]
    n = client.post("/api/todo/migrations/auto").json()["data"]["migrated"]
    assert n >= 1
    t = client.get(f"/api/todo/tasks/{tid}").json()["data"]
    assert t["task_date"] == today


# ---------- 今日聚合与统计 ----------

def test_today_aggregate(client):
    # 自备数据(原版依赖跨用例累积):当天完成一个任务
    r = client.post("/api/todo/tasks", json={"title": "看板前置", "task_date": "today"})
    client.post(f"/api/todo/tasks/{r.json()['data']['id']}/complete")

    data = client.get("/api/todo/today").json()["data"]
    assert len(data["quadrants"]) == 4
    assert data["quadrants"][0]["quadrant"] == 1
    assert data["quadrants"][0]["label"]
    assert "current" in data["streak"]
    assert data["streak"]["current"] >= 1


def test_stats(client):
    # 自备数据:当天完成一个 Q1 任务
    r = client.post("/api/todo/tasks", json={"title": "统计前置", "task_date": "today",
                                             "is_important": True, "is_urgent": True})
    client.post(f"/api/todo/tasks/{r.json()['data']['id']}/complete")

    d = client.get("/api/todo/stats/daily").json()["data"]
    assert d["completed"] >= 1
    assert set(d["quadrant_completed"]) == {"q1", "q2", "q3", "q4"}
    assert d["quadrant_completed"]["q1"] >= 1

    year = date.fromisoformat(today_str(client)).year
    hm = client.get(f"/api/todo/stats/heatmap?year={year}").json()["data"]
    assert hm["year"] == year and sum(x["count"] for x in hm["days"]) >= 1

    st = client.get("/api/todo/stats/streak").json()["data"]
    assert st["current"] >= 1 and st["total_active"] >= 1

    frm = (date.fromisoformat(today_str(client)) - timedelta(days=6)).isoformat()
    rng = client.get(f"/api/todo/stats/range?from={frm}&to={today_str(client)}").json()["data"]
    assert len(rng["days"]) == 7 and rng["totals"]["completed"] >= 1
    # to 早于 from / 年份非法
    assert client.get(f"/api/todo/stats/range?from={today_str(client)}&to={frm}").status_code == 422
    assert client.get("/api/todo/stats/heatmap?year=1999").status_code == 422


def test_stats_reopen_updates_immediately(client):
    """问题修复验证:取消完成后,统计数字立即回退(任务当前状态口径)。"""
    r = client.post("/api/todo/tasks", json={"title": "统计回退验证", "task_date": "today"})
    tid = r.json()["data"]["id"]

    pending = client.get("/api/todo/stats/daily").json()["data"]  # 新任务 pending 态的基线
    before_completed = pending["completed"]

    client.post(f"/api/todo/tasks/{tid}/complete")
    after = client.get("/api/todo/stats/daily").json()["data"]
    assert after["completed"] == before_completed + 1
    assert after["completion_rate"] != pending["completion_rate"]

    # 取消完成 → 完成数与完成率都回到基线
    client.post(f"/api/todo/tasks/{tid}/reopen")
    reverted = client.get("/api/todo/stats/daily").json()["data"]
    assert reverted["completed"] == before_completed
    assert reverted["completion_rate"] == pending["completion_rate"]

    client.delete(f"/api/todo/tasks/{tid}")


def test_shelve_flow(client):
    """搁置:keep → 不再催办且可在 /migrations/shelved 查看;unshelve/migrate 会脱离搁置。"""
    today = today_str(client)
    past = (date.fromisoformat(today) - timedelta(days=3)).isoformat()
    r = client.post("/api/todo/tasks", json={"title": "搁置验证", "task_date": past})
    tid = r.json()["data"]["id"]
    assert [x for x in client.get("/api/todo/migrations/pending").json()["data"] if x["id"] == tid]

    # 搁置
    assert client.post("/api/todo/migrations/decide", json={"task_id": tid, "decision": "keep"}).json()["data"]["ok"]
    assert not [x for x in client.get("/api/todo/migrations/pending").json()["data"] if x["id"] == tid]
    shelved = client.get("/api/todo/migrations/shelved").json()["data"]
    mine = [x for x in shelved if x["id"] == tid]
    assert mine and mine[0]["shelved_at"] is not None and mine[0]["days_procrastinated"] == 3

    # 自动迁移也跳过搁置任务
    client.post("/api/todo/migrations/auto")
    t = client.get(f"/api/todo/tasks/{tid}").json()["data"]
    assert t["task_date"] == past  # 未被自动迁走

    # 恢复搁置 → 重新进入待迁移
    client.post("/api/todo/migrations/decide", json={"task_id": tid, "decision": "unshelve"})
    assert [x for x in client.get("/api/todo/migrations/pending").json()["data"] if x["id"] == tid]

    # 再搁置后手动迁移 → 脱离搁置
    client.post("/api/todo/migrations/decide", json={"task_id": tid, "decision": "keep"})
    t = client.post(f"/api/todo/tasks/{tid}/migrate", json={"to_date": "today"}).json()["data"]
    assert t["task_date"] == today and t["shelved_at"] is None
    assert not [x for x in client.get("/api/todo/migrations/shelved").json()["data"] if x["id"] == tid]


# ---------- 通知测试发送(错误分支,无需真实 SMTP) ----------

def test_notification_test_endpoint_errors(client):
    r = client.post("/api/todo/notifications/test", json={"channel": "sms"})
    assert r.status_code == 404 and "未知推送渠道" in r.json()["message"]
    # 默认配置:email 渠道结构存在但未启用
    r = client.post("/api/todo/notifications/test", json={"channel": "email"})
    assert r.status_code == 400 and "未启用" in r.json()["message"]
    # 渠道配置整体缺失(保存了不含 email 的渠道表)
    client.put("/api/todo/settings", json={"notifications": {"channels": {"apk": {"enabled": False}}}})
    r = client.post("/api/todo/notifications/test", json={"channel": "email"})
    assert r.status_code == 400 and "尚未配置" in r.json()["message"]
    # 已启用但发送端未接入的渠道
    client.put("/api/todo/settings", json={"notifications": {"channels": {"chrome": {"enabled": True}}}})
    r = client.post("/api/todo/notifications/test", json={"channel": "chrome"})
    assert r.status_code == 400 and "尚未接入" in r.json()["message"]


# ---------- 序列化等价性(性能优化的行为锁) ----------

def test_serializer_parity_dict_vs_pydantic(client):
    """serialize_task_dict(列表/聚合路径)与 pydantic serialize_task + model_dump(mode="json")
    键与值必须完全一致——dict 版是纯性能替身,不允许任何载荷差异。"""
    from app.db import db
    from app.todo.services import tasks as task_svc

    # 造一个字段尽量全的任务(带类别/截止/通知/备注/迁移链)
    cid = client.post("/api/todo/categories", json={"name": "等价", "color": "#123456"}).json()["data"]["id"]
    r = client.post("/api/todo/tasks", json={
        "title": "等价校验", "description": "d", "category_id": cid,
        "is_important": True, "is_urgent": True, "task_date": "today",
        "due_at": "2026-10-11T08:00:00+00:00", "notify_enabled": True,
        "notify_time": "09:30", "notify_channels": ["email"],
    })
    assert r.status_code == 201
    tid = r.json()["data"]["id"]
    client.post(f"/api/todo/tasks/{tid}/complete", json={"note": "备注"})
    client.patch(f"/api/todo/tasks/{tid}", json={"task_date": "today", "revision": 2})

    session = db.session
    t = task_svc._get_or_404(session, tid, include_deleted=True)
    today = task_svc.local_today("Asia/Shanghai")
    cats = task_svc._category_map(session)
    pyd = task_svc.serialize_task(t, today, cats).model_dump(mode="json")
    raw = task_svc.serialize_task_dict(t, today, cats)
    assert raw == pyd, f"dict 序列化与 pydantic 不一致:\n{raw}\nvs\n{pyd}"
    session.rollback()
    session.remove()


def test_today_response_cache_invalidation(client):
    """/today 响应缓存:重复读命中缓存;任何写(commit+bump)后立即反映新状态。"""
    r = client.post("/api/todo/tasks", json={"title": "缓存验证", "task_date": "today"})
    tid = r.json()["data"]["id"]

    d1 = client.get("/api/todo/today").json()["data"]
    assert d1["quadrants"][3]["pending_count"] == 1
    d2 = client.get("/api/todo/today").json()["data"]  # 命中缓存,同一份载荷
    assert d1 == d2

    client.post(f"/api/todo/tasks/{tid}/complete")  # 写 → 失效
    d3 = client.get("/api/todo/today").json()["data"]
    assert d3["quadrants"][3]["pending_count"] == 0
    assert d3["quadrants"][3]["tasks"][0]["status"] == "done"

    client.delete(f"/api/todo/tasks/{tid}")  # 再写 → 再失效
    d4 = client.get("/api/todo/today").json()["data"]
    assert d4["quadrants"][3]["tasks"] == []
