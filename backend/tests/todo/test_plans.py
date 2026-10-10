"""规律生活计划:规则引擎、物化幂等、编辑清理未来、删除、豁免容量。

移植自 MyTodo test_plans.py;日期一律相对"今天"动态计算,保证落在预生成窗口内。
"""
import pytest
from datetime import date, timedelta

from app.todo.services.plans import (
    days_for_monthly_times,
    weekdays_for_weekly_times,
)

TODAY = date.today()


def D(offset: int) -> str:
    return (TODAY + timedelta(days=offset)).isoformat()


def _wd(offset: int) -> int:
    """offset 天后是周几(0=周一)。"""
    return (TODAY + timedelta(days=offset)).weekday()


def _next_weekday(offset_from: int, weekday: int) -> int:
    """从 offset_from 起(含)第一个指定周几的 offset。"""
    o = offset_from
    while _wd(o) != weekday:
        o += 1
    return o


def _mk(client, cat_id, **kw):
    body = {"title": kw.pop("title", "晨跑5公里"), "start_date": kw.pop("start_date", D(0)),
            "rule": kw.pop("rule", {"type": "weekly", "weekdays": [0, 1, 2, 3, 4, 5, 6]}), **kw}
    body.setdefault("category_id", cat_id)
    r = client.post("/api/todo/plans", json=body)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _tasks_on(client, day, plan_id=None):
    rows = client.get(f"/api/todo/tasks?date={day}&status=all").json()["data"]
    plan_rows = [t for t in rows if t["plan_id"]]
    if plan_id:
        plan_rows = [t for t in plan_rows if t["plan_id"] == plan_id]
    return plan_rows


def test_weekly_rule_and_materialization(client, cat_id):
    mon = _next_weekday(1, 0)  # 明天起的第一个周一
    wed = _next_weekday(1, 2)
    fri = _next_weekday(1, 4)
    p = _mk(client, cat_id, start_date=D(1), rule={"type": "weekly", "weekdays": [0, 2, 4]})
    assert len(_tasks_on(client, D(mon))) == 1
    assert len(_tasks_on(client, D(mon + 1))) == 0
    assert len(_tasks_on(client, D(wed))) == 1
    assert len(_tasks_on(client, D(fri))) == 1
    # 返回体语义
    assert p["rule_text"].startswith("每周")
    assert p["next_occurrence"] == D(min(mon, wed, fri))
    # 生成的任务可正常完成
    t = _tasks_on(client, D(mon))[0]
    r = client.post(f"/api/todo/tasks/{t['id']}/complete", json={"note": "跑完了"})
    assert r.status_code == 200 and r.json()["data"]["completion_note"] == "跑完了"
    # 物化幂等:再触发不重复
    n = len(_tasks_on(client, D(wed)))
    client.get(f"/api/todo/tasks?date={D(wed)}&status=all")
    assert len(_tasks_on(client, D(wed))) == n


def test_interval_rule(client, cat_id):
    p = _mk(client, cat_id, title="每隔2天体检", start_date=D(2), rule={"type": "interval", "interval_days": 2})
    assert len(_tasks_on(client, D(2), p["id"])) == 1
    assert len(_tasks_on(client, D(3), p["id"])) == 0
    assert len(_tasks_on(client, D(4), p["id"])) == 1
    assert p["rule_text"] == "每隔 2 天"


def test_weekly_times_spread(client, cat_id):
    assert weekdays_for_weekly_times(1) == [0]
    assert weekdays_for_weekly_times(3) == [0, 2, 4]
    p = _mk(client, cat_id, title="每周3次背单词", start_date=D(1), rule={"type": "weekly_times", "times": 3})
    # 均摊到周一/三/五
    for wd, expect in [(0, 1), (1, 0), (2, 1), (3, 0), (4, 1)]:
        off = _next_weekday(1, wd)
        got = len(_tasks_on(client, D(off), p["id"]))
        assert got == expect, f"周{wd+1}: {got} != {expect}"


def test_monthly_times_spread(client, cat_id):
    assert days_for_monthly_times(2, 30) == {15, 30}
    # 用下个月:1号起,每月2次 → 1日与月末(均分)
    nxt = (TODAY.replace(day=28) + timedelta(days=4)).replace(day=1)
    if (nxt - TODAY).days > 90:
        nxt = TODAY  # 窗口兜底
    p = _mk(client, cat_id, title="每月2次复盘", start_date=nxt.isoformat(), rule={"type": "monthly_times", "times": 2})
    dim = (nxt.replace(day=28) + timedelta(days=4)).replace(day=1)
    dim = (dim - timedelta(days=1)).day
    days = sorted(days_for_monthly_times(2, dim))
    for d in days:
        ds = nxt.replace(day=d).isoformat()
        assert len(_tasks_on(client, ds, p["id"])) == 1, ds
    skipped = next(d for d in range(1, dim + 1) if d not in days)
    assert len(_tasks_on(client, nxt.replace(day=skipped).isoformat(), p["id"])) == 0


def test_end_date_and_start_bounds(client, cat_id):
    p = _mk(client, cat_id, title="到月中为止", start_date=D(1), end_date=D(10),
            rule={"type": "weekly", "weekdays": [0, 1, 2, 3, 4, 5, 6]})
    assert len(_tasks_on(client, D(1), p["id"])) == 1
    assert len(_tasks_on(client, D(10), p["id"])) == 1
    assert len(_tasks_on(client, D(11), p["id"])) == 0  # 结束后不再生成
    # start 之前也不会有
    assert len(_tasks_on(client, D(0), p["id"])) == 0


def test_edit_regenerates_future_keeps_past(client, cat_id):
    mon = _next_weekday(3, 0)
    p = _mk(client, cat_id, title="计划A", start_date=D(3), rule={"type": "weekly", "weekdays": [0]})
    assert len(_tasks_on(client, D(mon), p["id"])) == 1
    # 改成每周二
    tue = _next_weekday(3, 1)
    r = client.patch(f"/api/todo/plans/{p['id']}", json={"rule": {"type": "weekly", "weekdays": [1]}})
    assert r.status_code == 200 and r.json()["data"]["rule"]["weekdays"] == [1]
    rows = client.get(f"/api/todo/tasks?from={D(1)}&to={D(60)}&status=all").json()["data"]
    mine = [t for t in rows if t["plan_id"] == p["id"]]
    assert all(_weekday(t["task_date"]) == 1 for t in mine), "全部实例应为周二"
    assert any(t["task_date"] == D(tue) for t in mine)


def _weekday(ds: str) -> int:
    return date.fromisoformat(ds).weekday()


def test_delete_plan_removes_future(client, cat_id):
    p = _mk(client, cat_id, title="将删除", start_date=D(1),
            rule={"type": "weekly", "weekdays": [0, 1, 2, 3, 4, 5, 6]})
    assert client.delete(f"/api/todo/plans/{p['id']}").status_code == 200
    rows = client.get(f"/api/todo/tasks?from={D(1)}&to={D(60)}&status=all").json()["data"]
    assert not [t for t in rows if t["plan_id"] == p["id"]]


def test_plan_instances_isolated_from_todo_views(client, cat_id):
    """计划实例豁免每日上限,但不进 Todo 四象限看板/迁移池;tasks 过滤参数按需取。"""
    from app.todo.limits import QUADRANT_DAILY_LIMIT
    from app.todo.services import tasks as tasks_svc

    saved = (tasks_svc.QUADRANT_DAILY_LIMIT, tasks_svc.DAY_TOTAL_LIMIT)
    tasks_svc.QUADRANT_DAILY_LIMIT = QUADRANT_DAILY_LIMIT
    tasks_svc.DAY_TOTAL_LIMIT = 30
    try:
        for other in client.get("/api/todo/plans").json()["data"]:
            client.delete(f"/api/todo/plans/{other['id']}")
        day_off = _next_weekday(70, 3)
        for i in range(QUADRANT_DAILY_LIMIT):
            r = client.post("/api/todo/tasks", json={"title": f"F{i}", "is_important": True, "is_urgent": False, "task_date": D(day_off)})
            assert r.status_code == 201
        # 计划实例照常生成(豁免每日上限),当天手工第 9 个仍被拒
        p = _mk(client, cat_id, title="豁免验证", start_date=D(day_off),
                rule={"type": "weekly", "weekdays": [0, 1, 2, 3, 4, 5, 6]})
        assert len(_tasks_on(client, D(day_off), p["id"])) == 1
        r = client.post("/api/todo/tasks", json={"title": "超额", "is_important": True, "is_urgent": False, "task_date": D(day_off)})
        assert r.status_code == 422
        # 不再进 Todo 四象限看板
        board = client.get(f"/api/todo/today?date={D(day_off)}").json()["data"]
        board_titles = [t["title"] for q in board["quadrants"] for t in q["tasks"]]
        assert "豁免验证" not in board_titles
        assert "F0" in board_titles
        # /tasks 默认全量(兼容);plan_only / exclude_plans 互为补集
        default = [t["title"] for t in client.get(f"/api/todo/tasks?date={D(day_off)}&status=all").json()["data"]]
        only = [t["title"] for t in client.get(f"/api/todo/tasks?date={D(day_off)}&status=all&plan_only=true").json()["data"]]
        excl = [t["title"] for t in client.get(f"/api/todo/tasks?date={D(day_off)}&status=all&exclude_plans=true").json()["data"]]
        assert "豁免验证" in default and "F0" in default
        assert only == ["豁免验证"]
        assert "豁免验证" not in excl and "F0" in excl
    finally:
        tasks_svc.QUADRANT_DAILY_LIMIT, tasks_svc.DAY_TOTAL_LIMIT = saved


def test_category_required(client, cat_id):
    r = client.post("/api/todo/plans", json={"title": "无类型", "start_date": D(1), "rule": {"type": "weekly", "weekdays": [1]}})
    assert r.status_code in (400, 422)  # pydantic 缺字段→400(Doublog 处理器);服务层校验→422
    p = _mk(client, cat_id, title="有类型")
    assert "quadrant" not in p  # 计划不再有象限字段
    r = client.patch(f"/api/todo/plans/{p['id']}", json={"category_id": None})
    assert r.status_code == 422 and "类型" in r.json()["message"]


def test_life_today_and_report(client, cat_id):
    for other in client.get("/api/todo/plans").json()["data"]:
        client.delete(f"/api/todo/plans/{other['id']}")
    _mk(client, cat_id, title="打卡计划", start_date=D(-10),
        rule={"type": "weekly", "weekdays": [0, 1, 2, 3, 4, 5, 6]})
    r = client.get("/api/todo/plans/today")
    assert r.status_code == 200
    items = [i for i in r.json()["data"]["items"] if i["plan"] is not None]
    assert len(items) == 1 and items[0]["plan"]["title"] == "打卡计划"
    assert items[0]["task"]["status"] == "pending"
    tid = items[0]["task"]["id"]
    assert client.post(f"/api/todo/tasks/{tid}/complete", json={"note": "打卡"}).status_code == 200
    rep = client.get("/api/todo/plans/report?days=14").json()["data"]
    row = next(x for x in rep["plans"] if x["plan"]["title"] == "打卡计划")
    assert row["completed"] >= 1 and row["current_streak"] >= 1
    assert row["last_done"] == D(0)
    today_trend = next(d for d in rep["trend"] if d["date"] == D(0))
    assert today_trend["scheduled"] >= 1 and today_trend["completed"] >= 1


def test_rule_validation(client, cat_id):
    cat = {"category_id": cat_id}
    r = client.post("/api/todo/plans", json={"title": "x", "start_date": D(1), "rule": {"type": "weekly", "weekdays": []}, **cat})
    assert r.status_code == 422
    r = client.post("/api/todo/plans", json={"title": "x", "start_date": D(1), "rule": {"type": "interval", "interval_days": 0}, **cat})
    assert r.status_code == 422
    r = client.post("/api/todo/plans", json={"title": "x", "start_date": D(1), "end_date": D(0), "rule": {"type": "weekly", "weekdays": [1]}, **cat})
    assert r.status_code == 422 and "结束" in r.json()["message"]
    r = client.post("/api/todo/plans", json={"title": "x", "start_date": D(1), "rule": {"type": "monthly_times", "times": 99}})
    assert r.status_code in (400, 422)  # pydantic 不限 times 范围 → 服务层 422


def test_disable_stops_generation(client, cat_id):
    p = _mk(client, cat_id, title="可停用", start_date=D(1), rule={"type": "weekly", "weekdays": [0, 1, 2, 3, 4, 5, 6]})
    r = client.patch(f"/api/todo/plans/{p['id']}", json={"enabled": False})
    assert r.status_code == 200 and r.json()["data"]["enabled"] is False
    rows = client.get(f"/api/todo/tasks?from={D(1)}&to={D(60)}&status=all").json()["data"]
    assert not [t for t in rows if t["plan_id"] == p["id"]]
    assert r.json()["data"]["next_occurrence"] is None


def test_deleted_plan_history_still_reported(client, cat_id):
    """计划删除后,已完成的历史实例仍要在报表/今日视图可见(孤儿统计)。"""
    for other in client.get("/api/todo/plans").json()["data"]:
        client.delete(f"/api/todo/plans/{other['id']}")
    p = _mk(client, cat_id, title="将删除但有历史", start_date=D(-2),
            rule={"type": "weekly", "weekdays": [0, 1, 2, 3, 4, 5, 6]})
    # 完成昨天与今天的本计划实例(排除同日其他计划的实例)
    for off in (-1, 0):
        items = client.get(f"/api/todo/plans/today?date={D(off)}").json()["data"]["items"]
        mine = next(i for i in items if i["plan"] is not None and i["plan"]["id"] == p["id"])
        assert client.post(f"/api/todo/tasks/{mine['task']['id']}/complete", json={"note": f"day{off}"}).status_code == 200
    # 删除计划 → 未来/今日 pending 实例被清理,已完成历史保留为孤儿
    assert client.delete(f"/api/todo/plans/{p['id']}").status_code == 200

    rep = client.get("/api/todo/plans/report?days=14").json()["data"]
    orphan_row = next(r for r in rep["plans"] if r["plan"] is None)
    assert orphan_row["title"] == "已删除的计划"
    assert orphan_row["completed"] >= 2
    # 趋势里 D(-1)/D(0) 的 completed 计入孤儿
    for off in (-1, 0):
        d = next(t for t in rep["trend"] if t["date"] == D(off))
        assert d["completed"] >= 1, off
    # 过去日期的孤儿待办也出现在今日视图(标题来自实例)
    past = client.get(f"/api/todo/plans/today?date={D(-2)}").json()["data"]
    assert any(i["plan"] is None and i["task"]["title"] == "将删除但有历史" for i in past["items"])


def test_today_route_materializes_plans(client, cat_id):
    """/today 路由的 30s 节流物化兜底:未经 API 物化的计划实例由看板打开时补齐。"""
    from datetime import date as _d

    from sqlalchemy import delete

    from app.db import db
    from app.todo.models import Task
    from app.todo.schemas import PlanCreate, PlanRule
    from app.todo.services import plans as plan_svc

    session = db.session
    try:
        plan = plan_svc.create_plan(
            session,
            PlanCreate(title="路由物化", category_id=cat_id, start_date=_d.today(),
                       rule=PlanRule(type="weekly", weekdays=[0, 1, 2, 3, 4, 5, 6])),
            _d.today(), "Asia/Shanghai",
        )
        pid = plan.id
        session.execute(delete(Task).where(Task.plan_id == pid))  # 清掉创建时已物化的实例
        session.commit()
    finally:
        db.session.remove()

    board = client.get("/api/todo/today").json()["data"]
    titles = [t["title"] for q in board["quadrants"] for t in q["tasks"]]
    assert "路由物化" not in titles  # 计划实例不进四象限看板
    rows = client.get("/api/todo/tasks",
                      params={"date": _d.today().isoformat(), "status": "all", "plan_only": "true"}).json()["data"]
    assert any(t["plan_id"] == pid for t in rows)
