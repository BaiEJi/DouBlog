"""完成备注:可选字段,老客户端(不带 body/不带 note)完成能力不受影响。

移植自 MyTodo test_completion_note.py(丢弃 ?token= 用例——Doublog 无 URL token 机制)。
"""
import pytest


@pytest.fixture()
def task(client):
    r = client.post("/api/todo/tasks", json={"title": "备注用例", "is_important": True, "is_urgent": False, "task_date": "2099-03-01"})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def test_complete_with_note_roundtrip(client, task):
    r = client.post(f"/api/todo/tasks/{task['id']}/complete", json={"note": "产出周报一份,耗时40分钟"})
    assert r.status_code == 200, r.text
    body = r.json()["data"]
    assert body["status"] == "done"
    assert body["completion_note"] == "产出周报一份,耗时40分钟"
    assert body["revision"] == task["revision"] + 1
    # 单查/列表/看板 均返回
    assert client.get(f"/api/todo/tasks/{task['id']}").json()["data"]["completion_note"] == "产出周报一份,耗时40分钟"
    listed = client.get("/api/todo/tasks?date=2099-03-01&status=all").json()["data"]
    assert any(t["completion_note"] == "产出周报一份,耗时40分钟" for t in listed)


def test_complete_without_body_old_client(client, task):
    """老 APK:不带请求体直接完成 —— 必须照常成功,备注为空。"""
    r = client.post(f"/api/todo/tasks/{task['id']}/complete")
    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "done"
    assert r.json()["data"]["completion_note"] is None


def test_complete_with_empty_body_and_blank_note(client, task):
    assert client.post(f"/api/todo/tasks/{task['id']}/complete", json={}).json()["data"]["completion_note"] is None


def test_blank_note_normalized_to_null(client, task):
    r = client.post(f"/api/todo/tasks/{task['id']}/complete", json={"note": "   \n  "})
    assert r.status_code == 200
    assert r.json()["data"]["completion_note"] is None


def test_recomplete_keeps_note(client, task):
    client.post(f"/api/todo/tasks/{task['id']}/complete", json={"note": "第一次的备注"})
    r = client.post(f"/api/todo/tasks/{task['id']}/complete", json={"note": "不应覆盖"})
    assert r.status_code == 200
    assert r.json()["data"]["completion_note"] == "第一次的备注"  # 幂等:已完成不再改


def test_reopen_then_complete_updates_note(client, task):
    client.post(f"/api/todo/tasks/{task['id']}/complete", json={"note": "旧备注"})
    reopened = client.post(f"/api/todo/tasks/{task['id']}/reopen").json()["data"]
    assert reopened["status"] == "pending"
    assert reopened["completion_note"] == "旧备注"  # 重开保留,供参考
    r = client.post(f"/api/todo/tasks/{task['id']}/complete", json={"note": "新备注"})
    assert r.json()["data"]["completion_note"] == "新备注"
    # 重开后无备注完成 → 清空
    client.post(f"/api/todo/tasks/{task['id']}/reopen")
    r = client.post(f"/api/todo/tasks/{task['id']}/complete")
    assert r.json()["data"]["completion_note"] is None
