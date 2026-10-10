"""任务级通知:创建/更新携带通知配置,查询接口返回通知字段。

移植自 MyTodo test_task_notify.py(丢弃 ?token= 用例——Doublog 无 URL token 机制)。
差异:pydantic 入参校验失败由 Doublog 全局处理器出 400(原文案不可见);
服务层合并校验仍出 422 且保留原始文案。
"""
from __future__ import annotations

import pytest


@pytest.fixture()
def today_iso(client):
    return client.get("/api/todo/today").json()["data"].get("date")


def _find(client, title):
    for block in client.get("/api/todo/today").json()["data"]["quadrants"]:
        for t in block["tasks"]:
            if t["title"] == title:
                return t
    return None


def test_create_with_notification(client):
    r = client.post(
        "/api/todo/tasks",
        json={
            "title": "通知测试-创建",
            "task_date": "today",
            "notify_enabled": True,
            "notify_time": "09:30",
            "notify_channels": ["email", "chrome"],
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()["data"]
    assert body["notify_enabled"] is True
    assert body["notify_time"] == "09:30"
    assert body["notify_channels"] == ["email", "chrome"]

    # /today 与 /tasks 列表同样返回通知字段
    t = _find(client, "通知测试-创建")
    assert t and t["notify_enabled"] is True and t["notify_channels"] == ["email", "chrome"]
    listed = [x for x in client.get("/api/todo/tasks").json()["data"] if x["title"] == "通知测试-创建"]
    assert listed and listed[0]["notify_time"] == "09:30"


def test_create_without_notification_defaults(client):
    """老客户端不带通知字段:默认关闭,字段返回安全默认值(能力不变)。"""
    r = client.post("/api/todo/tasks", json={"title": "通知测试-默认", "task_date": "today"})
    assert r.status_code == 201
    body = r.json()["data"]
    assert body["notify_enabled"] is False
    assert body["notify_time"] is None
    assert body["notify_channels"] == []


@pytest.mark.parametrize(
    "payload,needle,code",
    [
        # pydantic 字段校验失败 → Doublog 统一 400 信封(规范允许的骨架差异)
        ({"notify_enabled": True, "notify_time": "9:30", "notify_channels": ["email"]}, None, 400),
        ({"notify_enabled": True, "notify_time": "25:00", "notify_channels": ["email"]}, None, 400),
        ({"notify_enabled": True, "notify_time": "09:30", "notify_channels": ["sms"]}, None, 400),
        # 启用通知但缺渠道 → 服务层合并校验 422(文案保留)
        ({"notify_enabled": True, "notify_time": "09:30"}, "notify_channels", 422),
    ],
)
def test_create_validation(client, payload, needle, code):
    r = client.post("/api/todo/tasks", json={"title": "通知测试-非法", "task_date": "today", **payload})
    assert r.status_code == code, r.text
    if needle:
        assert needle in r.text


def test_update_notification(client):
    r = client.post("/api/todo/tasks", json={"title": "通知测试-更新", "task_date": "today"})
    tid, rev = r.json()["data"]["id"], r.json()["data"]["revision"]

    # 补全通知配置并启用
    r = client.patch(
        f"/api/todo/tasks/{tid}",
        json={"revision": rev, "notify_enabled": True, "notify_time": "18:45", "notify_channels": ["apk", "email"]},
    )
    assert r.status_code == 200, r.text
    body = r.json()["data"]
    assert body["notify_enabled"] is True
    assert body["notify_channels"] == ["apk", "email"]

    # 仅改渠道,时间保留(字段级合并)
    r = client.patch(
        f"/api/todo/tasks/{tid}",
        json={"revision": body["revision"], "notify_channels": ["chrome"]},
    )
    assert r.status_code == 200
    assert r.json()["data"]["notify_time"] == "18:45"
    assert r.json()["data"]["notify_channels"] == ["chrome"]

    # 关闭通知
    r = client.patch(f"/api/todo/tasks/{tid}", json={"revision": r.json()["data"]["revision"], "notify_enabled": False})
    assert r.status_code == 200
    assert r.json()["data"]["notify_enabled"] is False


def test_update_enable_without_full_config(client):
    r = client.post("/api/todo/tasks", json={"title": "通知测试-启用校验", "task_date": "today"})
    tid, rev = r.json()["data"]["id"], r.json()["data"]["revision"]
    # 只给 enabled=true 不给时间/渠道 → 422
    r = client.patch(f"/api/todo/tasks/{tid}", json={"revision": rev, "notify_enabled": True})
    assert r.status_code == 422
    assert "notify_time" in r.text
    # 清掉时间后启用 → 422
    r2 = client.patch(
        f"/api/todo/tasks/{tid}",
        json={"revision": rev, "notify_time": "08:00", "notify_channels": ["email"]},
    )
    assert r2.status_code == 200
    r3 = client.patch(
        f"/api/todo/tasks/{tid}", json={"revision": r2.json()["data"]["revision"], "notify_time": None, "notify_enabled": True}
    )
    assert r3.status_code == 422


def test_today_returns_notify_fields(client, today_iso):
    """看板聚合同样携带通知字段(无 ?token= 通道,直接带 Basic 查询)。"""
    r = client.post(
        "/api/todo/tasks",
        json={"title": "通知测试-看板", "task_date": "today", "notify_enabled": True,
              "notify_time": "20:00", "notify_channels": ["email"]},
    )
    assert r.status_code == 201

    resp = client.get(f"/api/todo/today?date={today_iso}")
    assert resp.status_code == 200, resp.text
    found = any(
        t["title"] == "通知测试-看板" and t["notify_channels"] == ["email"] and t["notify_time"] == "20:00"
        for b in resp.json()["data"]["quadrants"] for t in b["tasks"]
    )
    assert found
