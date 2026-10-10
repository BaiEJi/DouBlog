"""每日容量上限:单象限 8 / 四象限合计 30 / 历史迁移不计入。

移植自 MyTodo test_day_limits.py(422 文案断言 detail → 信封 message)。
差异:MyTodo 原版跨用例共享一个库(前置用例先填满 D1/D2),Doublog 每用例独立
临时库 → 各用例自行填满前置配额,断言本身不变。
"""
import pytest

from app.todo.limits import DAY_TOTAL_LIMIT, QUADRANT_DAILY_LIMIT
from app.todo.services import tasks as tasks_svc

D1 = "2099-01-05"  # 象限上限用日期
D2 = "2099-02-10"  # 合计上限用日期
OLD = "2020-01-01"  # 构造逾期任务用

#: 填满一天合计上限(DAY_TOTAL_LIMIT)的象限组合
_FILL_PLAN = [(True, True)] * 8 + [(True, False)] * 8 + [(False, True)] * 8 + [(False, False)] * 6


@pytest.fixture(autouse=True)
def _real_limits():
    """确保本文件用真实默认值测限制本身(模块常量可能被其他用例临时改过,兜底恢复)。"""
    saved = (tasks_svc.QUADRANT_DAILY_LIMIT, tasks_svc.DAY_TOTAL_LIMIT)
    tasks_svc.QUADRANT_DAILY_LIMIT = QUADRANT_DAILY_LIMIT
    tasks_svc.DAY_TOTAL_LIMIT = DAY_TOTAL_LIMIT
    yield
    tasks_svc.QUADRANT_DAILY_LIMIT, tasks_svc.DAY_TOTAL_LIMIT = saved


def _create(client, date, imp, urg, title):
    return client.post(
        "/api/todo/tasks",
        json={"title": title, "is_important": imp, "is_urgent": urg, "task_date": date},
    )


def _fill_day_total(client, day):
    """把某天四象限合计填满(30 个原生)。"""
    for i, (imp, urg) in enumerate(_FILL_PLAN):
        r = _create(client, day, imp, urg, f"T-{i}")
        assert r.status_code == 201, r.text


def test_quadrant_daily_limit(client):
    for i in range(QUADRANT_DAILY_LIMIT):
        r = _create(client, D1, True, True, f"Q1-{i}")
        assert r.status_code == 201, r.text
    r = _create(client, D1, True, True, "Q1-超额")
    assert r.status_code == 422
    assert "象限" in r.json()["message"] and "上限" in r.json()["message"]
    # 其他象限不受影响
    assert _create(client, D1, True, False, "Q2-正常").status_code == 201


def test_day_total_limit(client):
    _fill_day_total(client, D2)
    # 合计已到 30,Q4 仍有象限余量 → 撞合计上限
    r = _create(client, D2, False, False, "T-超额")
    assert r.status_code == 422
    assert "合计" in r.json()["message"]


def test_migrated_tasks_not_counted_nor_blocked(client):
    # 先把 D1 的 Q1 填满(8 个原生)
    for i in range(QUADRANT_DAILY_LIMIT):
        assert _create(client, D1, True, True, f"M-native-{i}").status_code in (201, 422)
    # 逾期任务迁移到 D1:不计入、也不被拦
    r = client.post("/api/todo/tasks", json={"title": "M-old", "is_important": True, "is_urgent": True, "task_date": OLD})
    assert r.status_code == 201, r.text
    old_id = r.json()["data"]["id"]
    r = client.post(f"/api/todo/tasks/{old_id}/migrate", json={"to_date": D1})
    assert r.status_code == 200, r.text
    # 迁移后 D1 Q1 仍只算 8 个原生 → 第 9 个原生仍被拒
    r = _create(client, D1, True, True, "M-超额")
    assert r.status_code == 422


def test_move_blocked_when_target_quadrant_full(client):
    # 前置:D1 Q1 填满 → 移动 Q2 任务过去应被拒
    for i in range(QUADRANT_DAILY_LIMIT):
        assert _create(client, D1, True, True, f"F-{i}").status_code == 201
    r = client.post("/api/todo/tasks", json={"title": "Mv", "is_important": True, "is_urgent": False, "task_date": D1})
    assert r.status_code == 201, r.text
    tid = r.json()["data"]["id"]
    r = client.post(f"/api/todo/tasks/{tid}/move", json={"is_important": True, "is_urgent": True})
    assert r.status_code == 422
    assert "象限" in r.json()["message"]
    # 象限内重排不受影响
    r = client.post(f"/api/todo/tasks/{tid}/move", json={"is_important": True, "is_urgent": False, "before_task_id": None})
    assert r.status_code == 200, r.text


def test_patch_quadrant_change_blocked(client):
    # 前置:D1 Q1 填满 → Q4 任务改象限进 Q1 应被拒
    for i in range(QUADRANT_DAILY_LIMIT):
        assert _create(client, D1, True, True, f"F-{i}").status_code == 201
    r = client.post("/api/todo/tasks", json={"title": "Pe", "is_important": False, "is_urgent": False, "task_date": D1})
    tid, rev = r.json()["data"]["id"], r.json()["data"]["revision"]
    r = client.patch(f"/api/todo/tasks/{tid}", json={"revision": rev, "is_important": True, "is_urgent": True})
    assert r.status_code == 422
    assert "象限" in r.json()["message"]


def test_reschedule_blocked_when_day_total_full(client):
    # 前置:D2 合计已满 → 把 D1 的任务改期到 D2 应被拒(选 Q4:象限有余量,专撞合计上限)
    _fill_day_total(client, D2)
    r = client.post("/api/todo/tasks", json={"title": "Rs", "is_important": False, "is_urgent": False, "task_date": D1})
    tid, rev = r.json()["data"]["id"], r.json()["data"]["revision"]
    r = client.patch(f"/api/todo/tasks/{tid}", json={"revision": rev, "task_date": D2})
    assert r.status_code == 422
    assert "合计" in r.json()["message"]


def test_inbox_and_delete_not_affected(client):
    # 待办池(不排期)不受上限限制
    for i in range(QUADRANT_DAILY_LIMIT + 3):
        r = client.post("/api/todo/tasks", json={"title": f"Pool-{i}", "is_important": True, "is_urgent": True})
        assert r.status_code == 201, r.text
    # 前置:D1 Q1 填满;删除满额象限里的任务后可再补
    for i in range(QUADRANT_DAILY_LIMIT):
        assert _create(client, D1, True, True, f"Q1-{i}").status_code == 201
    r = client.get(f"/api/todo/tasks?date={D1}")
    q1 = [t for t in r.json()["data"] if t["quadrant"] == 1 and t["original_date"] == D1]
    victim = q1[0]["id"]
    assert client.delete(f"/api/todo/tasks/{victim}").status_code == 200
    assert _create(client, D1, True, True, "Q1-回补").status_code == 201
