"""practice 子模块测试（docs/practice-spec.md"测试"节，≥20 用例，全部 Mock 不连外网）。

覆盖：鉴权 401、题目 CRUD/乐观锁/筛选组合、解法代码级联、标签多对多、
复习状态机全分支（加入/三键打卡/连续 forgot 降级/毕业/退出/今日队列）、
导入导出无损往返、LeetCode/洛谷适配器（Mock 响应）、HTML→MD、统计、空库初始化。

适配点（同 todo 域其他测试）：信封统一 .json()['data'] unwrap；鉴权走 Basic
（tests/todo/conftest.py 的 client 已带认证头）；抓题经 monkeypatch 打桩，
清 fetchers 模块缓存防跨用例串味。
"""
import io
import zipfile
from datetime import timedelta

import pytest

from app.shared.timeutil import local_today

from app.practice import fetchers

TZ = "Asia/Shanghai"  # todo 默认设置时区


def _today():
    return local_today(TZ)


def mk_problem(client, **fields):
    body = {"title": "两数之和", "source": "leetcode", "source_no": "1",
            "difficulty": 2, **fields}
    r = client.post("/api/practice/problems", json=body)
    assert r.status_code == 201, r.text
    return r.json()["data"]


def mk_tag(client, name, **fields):
    r = client.post("/api/practice/tags", json={"name": name, **fields})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def join_review(client, pid):
    """加入复习 = PATCH 进入 reviewing 态（状态机入口，规范无独立 join 端点）。"""
    d = client.get(f"/api/practice/problems/{pid}").json()["data"]
    r = client.patch(f"/api/practice/problems/{pid}",
                     json={"status": "reviewing", "revision": d["revision"]})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def set_scheduled(client_app, review_id, day):
    """直改复习行 scheduled_date（今日队列/逾期筛选用例造数）。"""
    from sqlalchemy import update
    from sqlalchemy.orm import Session

    from app.practice.models import PracticeReview

    with Session(client_app.state.engine) as s:
        s.execute(update(PracticeReview)
                  .where(PracticeReview.id == review_id)
                  .values(scheduled_date=day))
        s.commit()


# ---------- 1. 鉴权 ----------

def test_requires_auth(app):
    """5 个代表性端点匿名访问一律 401（router 级 require_basic）。"""
    from fastapi.testclient import TestClient

    c = TestClient(app)
    targets = [
        ("get", "/api/practice/problems"),
        ("post", "/api/practice/problems"),
        ("get", "/api/practice/review/today"),
        ("get", "/api/practice/stats/overview"),
        ("get", "/api/practice/export?output_format=json"),
    ]
    for method, url in targets:
        r = getattr(c, method)(url, **({"json": {}} if method == "post" else {}))
        assert r.status_code == 401, f"{method} {url} -> {r.status_code}"


# ---------- 2. 题目 CRUD ----------

def test_problem_crud(client):
    """创建→列表→详情→PATCH→软删→404 全流程。"""
    d = mk_problem(client, description_md="题面", pitfall_md="易错",
                   url="https://leetcode.com/problems/two-sum/")
    assert d["id"] and d["status"] == "todo" and d["revision"] == 1
    assert d["title"] == "两数之和"

    lst = client.get("/api/practice/problems").json()["data"]
    assert lst["total"] == 1 and lst["items"][0]["title"] == "两数之和"
    assert lst["items"][0]["solution_count"] == 0

    detail = client.get(f"/api/practice/problems/{d['id']}").json()["data"]
    assert detail["description_md"] == "题面" and detail["pitfall_md"] == "易错"

    r = client.patch(f"/api/practice/problems/{d['id']}",
                     json={"status": "solved", "difficulty": 3, "revision": 1})
    assert r.status_code == 200
    upd = r.json()["data"]
    assert upd["status"] == "solved" and upd["difficulty"] == 3 and upd["revision"] == 2
    assert upd["first_solved_at"] == _today().isoformat()  # solved 自动补首解日期

    r = client.delete(f"/api/practice/problems/{d['id']}")
    assert r.status_code == 200
    assert client.get(f"/api/practice/problems/{d['id']}").status_code == 404
    assert client.get("/api/practice/problems").json()["data"]["total"] == 0

    # 非法 source/status → 400
    r = client.post("/api/practice/problems",
                    json={"title": "x", "source": "atcoder"})
    assert r.status_code == 400
    r = client.post("/api/practice/problems",
                    json={"title": "x", "status": "wat"})
    assert r.status_code == 400


# ---------- 3. 乐观锁 ----------

def test_optimistic_lock(client):
    d = mk_problem(client)
    r = client.patch(f"/api/practice/problems/{d['id']}",
                     json={"title": "v2", "revision": 1})
    assert r.status_code == 200 and r.json()["data"]["revision"] == 2
    # 旧 revision 再改 → 409
    r = client.patch(f"/api/practice/problems/{d['id']}",
                     json={"title": "v3", "revision": 1})
    assert r.status_code == 409
    assert r.json()["message"] == "数据已被修改，请刷新后重试"


# ---------- 4. 多维筛选 ----------

def test_list_filters(client, app):
    t1, t2 = mk_tag(client, "数组"), mk_tag(client, "哈希")
    both = mk_problem(client, title="A+B Problem", source="luogu",
                      source_no="P1001", difficulty=1,
                      tag_ids=[t1["id"], t2["id"]],
                      solutions=[{"name": "暴力",
                                  "codes": [{"language": "python", "code": "print(1)"}]}])
    only_t1 = mk_problem(client, title="三数之和", source_no="15",
                         difficulty=2, tag_ids=[t1["id"]])
    hard = mk_problem(client, title="Hard One", source_no="42", difficulty=3,
                      status="solved")

    base = "/api/practice/problems"

    # q：标题 / source_no icontains
    assert client.get(base, params={"q": "三数"}).json()["data"]["total"] == 1
    assert client.get(base, params={"q": "P1001"}).json()["data"]["total"] == 1

    # tags OR
    r = client.get(base, params={"tags": f"{t1['id']},{t2['id']}", "tags_op": "or"})
    assert r.json()["data"]["total"] == 2
    # tags AND：同时挂两标签的只有 both
    r = client.get(base, params={"tags": f"{t1['id']},{t2['id']}", "tags_op": "and"})
    assert r.json()["data"]["total"] == 1
    assert r.json()["data"]["items"][0]["id"] == both["id"]

    # difficulty IN / status / source
    assert client.get(base, params={"difficulty": "1,2"}).json()["data"]["total"] == 2
    assert client.get(base, params={"status": "solved"}).json()["data"]["total"] == 1
    assert client.get(base, params={"source": "luogu"}).json()["data"]["total"] == 1

    # language：有 python 代码的题
    r = client.get(base, params={"language": "python"})
    assert r.json()["data"]["total"] == 1
    assert r.json()["data"]["items"][0]["id"] == both["id"]
    assert client.get(base, params={"language": "go"}).json()["data"]["total"] == 0

    # from/to：今天创建（含）明天创建（不含）
    today = _today().isoformat()
    assert client.get(base, params={"from": today, "to": today}).json()["data"]["total"] == 3
    tomorrow = (_today() + timedelta(days=1)).isoformat()
    r = client.get(base, params={"from": tomorrow})
    assert r.json()["data"]["total"] == 0
    yesterday = (_today() - timedelta(days=1)).isoformat()
    r = client.get(base, params={"to": yesterday})
    assert r.json()["data"]["total"] == 0

    # only_due_review：only_t1 进入复习并改到今天到期
    join_review(client, only_t1["id"])
    d = client.get(f"/api/practice/problems/{only_t1['id']}").json()["data"]
    set_scheduled(app, d["next_review"]["id"], _today())
    r = client.get(base, params={"only_due_review": "true"})
    assert r.json()["data"]["total"] == 1
    assert r.json()["data"]["items"][0]["id"] == only_t1["id"]

    # 摘要聚合：both 的标签/解法数/语言
    item = [i for i in client.get(base, params={"q": "A+B"}).json()["data"]["items"]][0]
    assert {t["name"] for t in item["tags"]} == {"数组", "哈希"}
    assert item["solution_count"] == 1 and item["code_languages"] == ["python"]

    # 排序：difficulty_asc
    items = client.get(base, params={"sort": "difficulty_asc"}).json()["data"]["items"]
    assert [i["difficulty"] for i in items] == [1, 2, 3]
    # 未知标签 → 400
    assert client.get(base, params={"tags": "nope"}).status_code == 400


# ---------- 5. 解法与代码 ----------

def test_solutions_codes_cascade(client):
    d = mk_problem(client)
    # 建题时内联解法 + 双语言代码
    r = client.post(f"/api/practice/problems/{d['id']}/solutions",
                    json={"name": "哈希表", "time_complexity": "O(n)",
                          "space_complexity": "O(n)", "is_preferred": True,
                          "approach_md": "用哈希",
                          "codes": [{"language": "python", "code": "d={}"}]})
    assert r.status_code == 201, r.text
    sol = r.json()["data"]
    assert sol["is_preferred"] and len(sol["codes"]) == 1

    # 加第二种语言；同语言重复 → 409；白名单外语言 → 400
    r = client.post(f"/api/practice/solutions/{sol['id']}/codes",
                    json={"language": "cpp", "code": "map<int,int> m;", "note": "注意溢出"})
    assert r.status_code == 201
    code2 = r.json()["data"]
    r = client.post(f"/api/practice/solutions/{sol['id']}/codes",
                    json={"language": "cpp", "code": "// dup"})
    assert r.status_code == 409
    r = client.post(f"/api/practice/solutions/{sol['id']}/codes",
                    json={"language": "pascal", "code": "x"})
    assert r.status_code == 400

    # 改代码（revision 须取 code 写路径递增后的 solution.revision）/ 解法乐观锁 409
    sol_rev = client.get(f"/api/practice/problems/{d['id']}").json()[
        "data"]["solutions"][0]["revision"]
    r = client.patch(f"/api/practice/codes/{code2['id']}",
                     json={"note": "long long", "revision": sol_rev})
    assert r.status_code == 200 and r.json()["data"]["note"] == "long long"
    r = client.patch(f"/api/practice/solutions/{sol['id']}",
                     json={"name": "哈希表v2", "revision": 99})
    assert r.status_code == 409

    # 删代码
    assert client.delete(f"/api/practice/codes/{code2['id']}").status_code == 200
    detail = client.get(f"/api/practice/problems/{d['id']}").json()["data"]
    assert [c["language"] for c in detail["solutions"][0]["codes"]] == ["python"]

    # 删题目 → 解法/代码级联清空
    client.delete(f"/api/practice/problems/{d['id']}")
    assert client.get(f"/api/practice/problems/{d['id']}").status_code == 404

    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from app.practice.models import PracticeSolution, PracticeSolutionCode

    with Session(client.app.state.engine) as s:
        assert s.scalar(select(PracticeSolution).where(
            PracticeSolution.problem_id == d["id"])) is None
        assert s.scalars(select(PracticeSolutionCode)).all() == []


# ---------- 6. 标签 ----------

def test_tags_crud_and_association(client):
    t1 = mk_tag(client, "动态规划", color="#8B5CF6")
    t2 = mk_tag(client, "树")
    assert t1["color"] == "#8B5CF6" and t2["color"]  # 缺省色板轮询非空

    # 重名 → 400
    assert client.post("/api/practice/tags", json={"name": "树"}).status_code == 400

    d = mk_problem(client, tag_ids=[t1["id"], t2["id"]])
    tags = client.get("/api/practice/tags").json()["data"]
    assert {t["name"] for t in tags} == {"动态规划", "树"}
    assert all(t["problem_count"] == 1 for t in tags)

    # PATCH 题目整体替换关联 → t1 解除
    r = client.patch(f"/api/practice/problems/{d['id']}",
                     json={"tag_ids": [t2["id"]], "revision": 1})
    assert r.status_code == 200
    assert {t["name"] for t in r.json()["data"]["tags"]} == {"树"}

    # 删除标签自动解除关联
    assert client.delete(f"/api/practice/tags/{t2['id']}").status_code == 200
    detail = client.get(f"/api/practice/problems/{d['id']}").json()["data"]
    assert detail["tags"] == []
    assert client.get("/api/practice/tags").json()["data"] == [
        {**t1, "problem_count": 0}]
    assert client.delete(f"/api/practice/tags/{t2['id']}").status_code == 404

    # 按名建标签（一键抓题→落库通道）
    d2 = mk_problem(client, tag_names=["DP", "树"])
    assert {t["name"] for t in
            client.get(f"/api/practice/problems/{d2['id']}").json()["data"]["tags"]} \
        == {"DP", "树"}


# ---------- 7-13. 复习状态机 ----------

def test_review_join_and_first_pending(client):
    """加入复习：PATCH→reviewing，首条 pending scheduled=明天。"""
    d = mk_problem(client, status="solved")
    upd = join_review(client, d["id"])  # PATCH status=reviewing
    assert upd["status"] == "reviewing"
    nr = upd["next_review"]
    assert nr["cycle"] == 1 and nr["seq"] == 1
    assert nr["prev_interval_days"] == 1
    assert nr["scheduled_date"] == (_today() + timedelta(days=1)).isoformat()
    # 重复 PATCH reviewing（幂等）不再造行
    upd2 = join_review(client, d["id"])
    assert upd2["next_review"]["seq"] == 1


def test_review_remembered_advances(client):
    d = join_review(client, mk_problem(client)["id"])
    r = client.post(f"/api/practice/problems/{d['id']}/review",
                    json={"result": "remembered"})
    assert r.status_code == 200, r.text
    out = r.json()["data"]
    assert out["next_interval_days"] == 2  # 1 → 2 天
    assert out["next_scheduled_date"] == (_today() + timedelta(days=2)).isoformat()
    detail = client.get(f"/api/practice/problems/{d['id']}").json()["data"]
    assert detail["next_review"]["prev_interval_days"] == 2
    assert detail["last_reviewed_at"] is not None


def test_review_fuzzy_repeats(client):
    d = join_review(client, mk_problem(client)["id"])
    out = client.post(f"/api/practice/problems/{d['id']}/review",
                      json={"result": "fuzzy"}).json()["data"]
    assert out["next_interval_days"] == 1  # 原档重复
    assert out["next_scheduled_date"] == (_today() + timedelta(days=1)).isoformat()


def test_review_forgot_resets(client):
    d = join_review(client, mk_problem(client)["id"])
    # 先 remembered 到 2 天档，再 forgot 回 1 天
    client.post(f"/api/practice/problems/{d['id']}/review",
                json={"result": "remembered"})
    out = client.post(f"/api/practice/problems/{d['id']}/review",
                      json={"result": "forgot"}).json()["data"]
    assert out["next_interval_days"] == 1
    assert not out["demoted"]  # 上一条是 remembered，不降级
    assert out["next_review"]["seq"] == 3


def test_consecutive_forgot_demotes(client):
    d = join_review(client, mk_problem(client)["id"])
    r1 = client.post(f"/api/practice/problems/{d['id']}/review",
                     json={"result": "forgot"})
    assert not r1.json()["data"]["demoted"]  # 第 1 次：无上一条 done → 正常回 1 天
    r2 = client.post(f"/api/practice/problems/{d['id']}/review",
                     json={"result": "forgot"})
    out = r2.json()["data"]
    assert out["demoted"] is True            # 连续 2 次 forgot
    assert out["next_scheduled_date"] is None  # 不生成下一行
    detail = client.get(f"/api/practice/problems/{d['id']}").json()["data"]
    assert detail["status"] == "todo" and detail["next_review"] is None
    # 无 pending 时再打卡 → 404
    assert client.post(f"/api/practice/problems/{d['id']}/review",
                       json={"result": "remembered"}).status_code == 404
    # 重新加入复习 → 新 cycle、seq 跨轮累计
    rejoin = join_review(client, d["id"])
    assert rejoin["next_review"]["cycle"] == 2
    assert rejoin["next_review"]["seq"] == 3


def test_review_graduates(client):
    """连打 8 次 remembered：顶档（120 天）通关 → mastered 毕业。"""
    d = join_review(client, mk_problem(client)["id"])
    for i in range(7):  # 1→2→4→7→15→30→60→120
        out = client.post(f"/api/practice/problems/{d['id']}/review",
                          json={"result": "remembered"}).json()["data"]
        assert not out["graduated"]
    assert out["next_interval_days"] == 120
    out = client.post(f"/api/practice/problems/{d['id']}/review",
                      json={"result": "remembered"}).json()["data"]
    assert out["graduated"] is True
    assert out["next_scheduled_date"] is None
    detail = client.get(f"/api/practice/problems/{d['id']}").json()["data"]
    assert detail["status"] == "mastered" and detail["next_review"] is None


def test_unreview_cancels(client):
    d = join_review(client, mk_problem(client)["id"])
    r = client.post(f"/api/practice/problems/{d['id']}/unreview")
    assert r.status_code == 200 and r.json()["data"]["cancelled"] == 1
    detail = client.get(f"/api/practice/problems/{d['id']}").json()["data"]
    assert detail["status"] == "solved" and detail["next_review"] is None

    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from app.practice.models import PracticeReview

    with Session(client.app.state.engine) as s:
        rows = s.scalars(select(PracticeReview).where(
            PracticeReview.problem_id == d["id"])).all()
        assert len(rows) == 1 and rows[0].status == "cancelled"


def test_review_today_queue(client, app):
    """今日队列只含 scheduled<=today 且 pending 的行，按到期升序。"""
    d1 = join_review(client, mk_problem(client, title="逾期题")["id"])
    d2 = join_review(client, mk_problem(client, title="今日题")["id"])
    d3 = join_review(client, mk_problem(client, title="明日题")["id"])

    r1 = client.get(f"/api/practice/problems/{d1['id']}").json()["data"]["next_review"]
    r2 = client.get(f"/api/practice/problems/{d2['id']}").json()["data"]["next_review"]
    set_scheduled(app, r1["id"], _today() - timedelta(days=2))  # 逾期 2 天
    set_scheduled(app, r2["id"], _today())                       # 今天到期
    # d3 保持明天 → 不进队列

    out = client.get("/api/practice/review/today").json()["data"]
    assert out["today"] == _today().isoformat()
    assert [i["problem"]["title"] for i in out["items"]] == ["逾期题", "今日题"]
    assert out["items"][0]["overdue_days"] == 2
    assert out["items"][1]["overdue_days"] == 0


# ---------- 14. 导入导出 ----------

def test_import_export_json_roundtrip(client):
    """导出→删→导入→无损恢复（含解法/代码/复习流水/标签）。"""
    t = mk_tag(client, "数组")
    d = mk_problem(client, title="环形链表", difficulty=2,
                   description_md="题面", pitfall_md="坑",
                   tag_ids=[t["id"]],
                   solutions=[{"name": "快慢指针", "time_complexity": "O(n)",
                               "space_complexity": "O(1)", "is_preferred": True,
                               "codes": [
                                   {"language": "python", "code": "slow=fast=head"},
                                   {"language": "go", "code": "package main"}]}])
    join_review(client, d["id"])
    client.post(f"/api/practice/problems/{d['id']}/review",
                json={"result": "remembered"})  # 留一条 done + 一条 pending

    before = client.get(f"/api/practice/problems/{d['id']}").json()["data"]
    payload = client.get("/api/practice/export?output_format=json").json()["data"]
    assert payload["version"] == 1 and len(payload["problems"]) == 1
    assert payload["problems"][0]["solutions"][0]["codes"][0]["code"] == "slow=fast=head"

    assert client.delete(f"/api/practice/problems/{d['id']}").status_code == 200
    assert client.get(f"/api/practice/problems/{d['id']}").status_code == 404

    r = client.post("/api/practice/import", json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["imported_problems"] == 1

    after = client.get(f"/api/practice/problems/{d['id']}").json()["data"]
    assert after == before  # 全字段无损（id/revision/时间戳/解法/代码/下一复习）


def test_export_import_md_zip(client):
    """Obsidian zip 导出 frontmatter 可解析、导出→导入按 source_no 去重。"""
    mk_problem(client, title="有效括号: 合法序列 #1", source_no="20",
               tag_names=["栈"],
               solutions=[{"name": "栈", "time_complexity": "O(n)",
                           "codes": [{"language": "python", "code": "stack=[]"}]}])
    r = client.get("/api/practice/export?output_format=md")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/zip")
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = zf.namelist()
    assert len(names) == 1 and names[0].endswith(".md")
    md = zf.read(names[0]).decode("utf-8")
    assert md.startswith("---\n") and "title: " in md and "source_no: \"20\"" in md
    assert "```python" in md and "- 栈" in md

    # 导回：同 source+source_no 去重跳过
    r2 = client.post("/api/practice/import",
                     files={"file": ("notes.zip", r.content, "application/zip")})
    assert r2.status_code == 200, r2.text
    assert r2.json()["data"]["imported_problems"] == 0
    assert r2.json()["data"]["skipped"] == 1
    assert client.get("/api/practice/problems").json()["data"]["total"] == 1


# ---------- 15-17. 抓题适配器（Mock，禁外网）----------

class FakeResp:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise fetchers.requests.HTTPError(f"{self.status_code}")

    def json(self):
        return self._payload


def test_fetch_leetcode_mock(client, monkeypatch):
    fetchers.clear_cache()
    calls = {}

    def fake_post(url, json=None, timeout=None):
        calls["url"], calls["body"], calls["timeout"] = url, json, timeout
        return FakeResp({"data": {"question": {
            "questionFrontendId": "1",
            "title": "Two Sum",
            "translatedTitle": "两数之和",
            "difficulty": "Easy",
            "content": "<p>Given <strong>nums</strong></p>",
            "translatedContent": "<p>给定一个整数数组 <code>nums</code></p>",
            "isPaidOnly": False,
            "topicTags": [{"name": "Array", "slug": "array", "translatedName": "数组"},
                          {"name": "Hash Table", "slug": "hash-table"}],
        }}})

    monkeypatch.setattr(fetchers.requests, "post", fake_post)

    r = client.post("/api/practice/fetch",
                    json={"source": "auto", "url": "https://leetcode.cn/problems/two-sum/"})
    assert r.status_code == 200, r.text
    draft = r.json()["data"]
    # 国际版端点 + 查询体 + 10s 超时
    assert calls["url"] == fetchers.LEETCODE_GRAPHQL
    assert calls["timeout"] == 10 and "question(" in calls["body"]["query"]
    # 解析：中文优先 / 难度映射 / 标签 translatedName 优先 / HTML→MD
    assert draft["source"] == "leetcode" and draft["source_no"] == "1"
    assert draft["title"] == "两数之和" and draft["difficulty"] == 1
    assert draft["description_md"] == "给定一个整数数组 `nums`"
    assert draft["tag_names"] == ["数组", "Hash Table"]

    # 不存在 / 会员题 / 网络错误 → 400
    monkeypatch.setattr(fetchers.requests, "post",
                        lambda *a, **k: FakeResp({"data": {"question": None}}))
    assert client.post("/api/practice/fetch",
                       json={"source": "leetcode", "slug": "nope"}).status_code == 400
    fetchers.clear_cache()
    monkeypatch.setattr(fetchers.requests, "post",
                        lambda *a, **k: FakeResp({"data": {"question": {
                            "title": "x", "isPaidOnly": True}}}))
    assert client.post("/api/practice/fetch",
                       json={"source": "leetcode", "slug": "vip"}).json()["message"] == "会员题"
    fetchers.clear_cache()

    def boom(*a, **k):
        raise fetchers.requests.RequestException("timeout")

    monkeypatch.setattr(fetchers.requests, "post", boom)
    r = client.post("/api/practice/fetch", json={"source": "leetcode", "slug": "x"})
    assert r.status_code == 400 and "请求失败" in r.json()["message"]


def test_fetch_luogu_mock(client, monkeypatch):
    """洛谷新 API（content-only 头 + data.currentData.problem + name/formatI/formatO）。"""
    fetchers.clear_cache()

    problem_payload = {
        "instance": "main", "status": 200,
        "data": {"currentData": {"problem": {
            "pid": "P1001", "name": "A+B Problem", "difficulty": 4,
            "content": {
                "background": "这是一道经典题",
                "description": "给定 $a,b$，求 $a+b$",
                "formatI": "一行两个整数",
                "formatO": "一行一个整数",
                "samples": [["1 2", "3"]],
                "hint": "注意数据范围",
            },
            "tags": [10, 11],
        }}},
    }
    tags_payload = [[10, 5, "入门"], [11, 6, "暴力枚举"]]

    class FakeSession:
        def __init__(self):
            self.calls = []

        def get(self, url, headers=None, timeout=None):
            self.calls.append((url, headers, timeout))
            if "_lfe/tags" in url:
                return FakeResp(tags_payload)
            assert headers == {"x-lentille-request": "content-only"}
            return FakeResp(problem_payload)

    fake = FakeSession()
    monkeypatch.setattr(fetchers, "_luogu_session", lambda: fake)

    r = client.post("/api/practice/fetch",
                    json={"source": "auto", "url": "https://www.luogu.com.cn/problem/P1001"})
    assert r.status_code == 200, r.text
    draft = r.json()["data"]
    assert draft["source"] == "luogu" and draft["source_no"] == "P1001"
    assert draft["title"] == "A+B Problem"
    assert draft["difficulty"] == 2  # 9 级制：4 → 中等
    desc = draft["description_md"]
    assert "## 题目背景" in desc and "这是一道经典题" in desc
    assert "给定 $a,b$，求 $a+b$" in desc and "一行两个整数" in desc
    assert "```input\n1 2\n```" in desc and "```output\n3\n```" in desc
    assert draft["tag_names"] == ["入门", "暴力枚举"]
    assert fake.calls[0][0] == "https://www.luogu.com.cn/problem/P1001"

    # 难度 9 级映射单元（0 = 暂无评定 → 2 中性，第 6 轮-3）
    assert fetchers._luogu_difficulty(0) == 2
    assert fetchers._luogu_difficulty(3) == 1
    assert fetchers._luogu_difficulty(5) == 2
    assert fetchers._luogu_difficulty(6) == 3
    assert fetchers._luogu_difficulty(8) == 3


def test_html_to_md():
    html = ('<p>Given <strong>nums</strong> and&nbsp;<em>target</em></p>'
            '<pre><code>x = 1\ny = 2</code></pre>'
            '<ul><li>item1</li><li>item2</li></ul>'
            '<p>line1<br/>line2 &amp; more</p>')
    md = fetchers._html_to_md(html)
    assert md.startswith("Given **nums** and *target*")
    assert "```\nx = 1\ny = 2\n```" in md
    assert "- item1" in md and "- item2" in md
    assert "line1\nline2 & more" in md
    assert "<" not in md and ">" not in md.replace("->", "")  # 无残余标签
    assert fetchers._html_to_md("") == ""
    assert fetchers._html_to_md(None) == ""


# ---------- 18-20. 统计 / 空库 ----------

def test_stats_overview(client):
    mk_problem(client, title="a", source="leetcode", difficulty=1,
               solutions=[{"name": "s1",
                           "codes": [{"language": "python", "code": "1"},
                                     ]}])
    mk_problem(client, title="b", source="luogu", difficulty=3, status="solved")
    d = join_review(client, mk_problem(client, title="c", difficulty=2)["id"])
    client.post(f"/api/practice/problems/{d['id']}/review",
                json={"result": "remembered"})

    out = client.get("/api/practice/stats/overview").json()["data"]
    assert out["total"] == 3
    assert out["by_status"] == {"todo": 1, "solved": 1, "reviewing": 1, "mastered": 0}
    # JSON 对象键恒为字符串
    assert out["by_difficulty"] == {"1": 1, "2": 1, "3": 1}
    assert out["by_source"]["leetcode"] == 2 and out["by_source"]["luogu"] == 1
    assert out["languages"] == {"python": 1}
    assert out["trend"][-1]["count"] == 3  # 今天创建 3 题
    assert len(out["trend"]) == 30
    assert out["review"]["pending"] == 1 and out["review"]["done"] == 1
    assert out["review"]["completion_rate"] == 0.5


def test_seed_empty(client):
    """空库初始化：全部读端点可用，结构完整、零数据。"""
    assert client.get("/api/practice/problems").json()["data"] == {
        "items": [], "total": 0, "page": 1, "page_size": 20}
    assert client.get("/api/practice/tags").json()["data"] == []
    out = client.get("/api/practice/review/today").json()["data"]
    assert out["items"] == []
    stats = client.get("/api/practice/stats/overview").json()["data"]
    assert stats["total"] == 0 and stats["review"]["completion_rate"] == 0.0
    payload = client.get("/api/practice/export?output_format=json").json()["data"]
    assert payload["problems"] == [] and payload["tags"] == []
    # 未知格式 → 400
    assert client.get("/api/practice/export?output_format=csv").status_code == 400


# ---------- 21-24. 第 1 轮评审回归 ----------

def test_duplicate_tag_patch_no_500(client):
    """P1-2: PATCH tag_ids 含重复值不炸（关联表唯一约束去重）。"""
    t = mk_tag(client, "DP")
    d = mk_problem(client, tag_ids=[t["id"]])
    r = client.patch(f"/api/practice/problems/{d['id']}",
                     json={"tag_ids": [t["id"], t["id"]], "revision": d["revision"]})
    assert r.status_code == 200, r.text
    tags = r.json()["data"]["tags"]
    assert len(tags) == 1 and tags[0]["id"] == t["id"]

    # 建题路径：tag_names 解析出重复 id 同样只挂一次
    d2 = mk_problem(client, title="重名标签", source_no="2",
                    tag_names=["DP", "DP"])
    assert len(d2["tags"]) == 1 and d2["tags"][0]["name"] == "DP"


def test_import_invalid_whitelist_sanitized(client):
    """P1-3: 导入脏数据被清洗（source/status/difficulty/多 pending），stats 不 500。"""
    payload = {
        "version": 1, "tags": [],
        "problems": [{
            "id": "p-dirty-1",
            "source": "atcoder",   # 白名单外 → other
            "title": "脏数据题",
            "difficulty": 9,       # 越界 → clamp 3
            "status": "weird",     # 白名单外 → todo
            "tags": ["no-such-tag", "no-such-tag"],  # 不存在标签跳过（且去重）
            "reviews": [
                {"id": "rv-1", "cycle": 1, "seq": 1, "status": "pending",
                 "scheduled_date": "2026-01-01", "prev_interval_days": 1},
                {"id": "rv-2", "cycle": 1, "seq": 2, "status": "pending",
                 "scheduled_date": "2026-01-02", "prev_interval_days": 2},
            ],
        }],
    }
    r = client.post("/api/practice/import", json=payload)
    assert r.status_code == 200, r.text
    d = client.get("/api/practice/problems/p-dirty-1").json()["data"]
    assert d["source"] == "other" and d["status"] == "todo" and d["difficulty"] == 3
    assert d["tags"] == []
    # R13-6：题目 status 净化为 todo → pending 行一律置 cancelled（状态机不变量：
    # 非 reviewing 态不得有 pending），next_review 为空
    assert d["next_review"] is None

    stats = client.get("/api/practice/stats/overview")
    assert stats.status_code == 200, stats.text
    out = stats.json()["data"]
    assert out["total"] == 1
    assert out["by_source"]["other"] == 1 and out["by_source"].get("atcoder", 0) == 0
    assert out["by_difficulty"]["3"] == 1
    assert out["review"]["pending"] == 0
    assert out["review"]["cancelled"] == 2


def test_unreview_non_reviewing_idempotent(client):
    """P1-4: 对 todo/solved 题调 unreview 幂等返回，不改状态。"""
    d = mk_problem(client)  # status=todo
    r = client.post(f"/api/practice/problems/{d['id']}/unreview")
    assert r.status_code == 200 and r.json()["data"]["cancelled"] == 0
    detail = client.get(f"/api/practice/problems/{d['id']}").json()["data"]
    assert detail["status"] == "todo"
    assert detail["revision"] == d["revision"]  # 未触碰乐观锁版本

    d2 = mk_problem(client, title="已解题", source_no="2", status="solved")
    r = client.post(f"/api/practice/problems/{d2['id']}/unreview")
    assert r.status_code == 200 and r.json()["data"]["cancelled"] == 0
    detail2 = client.get(f"/api/practice/problems/{d2['id']}").json()["data"]
    assert detail2["status"] == "solved"
    assert detail2["revision"] == d2["revision"]


def test_code_write_increments_solution_revision(client):
    """P1-1: code 写路径递增父级 solution.revision（借用乐观锁防并发丢更新）。"""
    d = mk_problem(client, solutions=[{"name": "解法",
                                       "codes": [{"language": "python", "code": "x=1"}]}])
    sol = d["solutions"][0]
    assert sol["revision"] == 1

    r = client.post(f"/api/practice/solutions/{sol['id']}/codes",
                    json={"language": "go", "code": "package main"})
    assert r.status_code == 201, r.text
    code = r.json()["data"]
    detail = client.get(f"/api/practice/problems/{d['id']}").json()["data"]
    assert detail["solutions"][0]["revision"] == 2  # add_code 递增

    # 旧 revision 改代码 → 409（乐观锁生效）
    r = client.patch(f"/api/practice/codes/{code['id']}",
                     json={"note": "n", "revision": 1})
    assert r.status_code == 409
    # 正确 revision → 200 且再递增
    r = client.patch(f"/api/practice/codes/{code['id']}",
                     json={"note": "n", "revision": 2})
    assert r.status_code == 200
    detail = client.get(f"/api/practice/problems/{d['id']}").json()["data"]
    assert detail["solutions"][0]["revision"] == 3
    # 删代码同样递增
    assert client.delete(f"/api/practice/codes/{code['id']}").status_code == 200
    detail = client.get(f"/api/practice/problems/{d['id']}").json()["data"]
    assert detail["solutions"][0]["revision"] == 4


# ---------- 25-32. 第 2 轮评审回归 ----------

def test_html_to_md_entity_order():
    """P1-A: 实体在标签剥离后解码，约束文本不丢。"""
    import re as re_mod

    from app.practice.fetchers import _html_to_md
    html = '<strong>2 &lt;= i &lt;= j &lt;= 10<sup>4</sup></strong>'
    md = _html_to_md(html)
    assert '10^4^' in md or '10^4' in md  # sup 保留
    # 无残余标签：解码后的 '<=' 是文本字符，只断言不存在 HTML 标签形态
    assert not re_mod.search(r'</?[a-zA-Z][^>]*>', md)
    assert '2' in md and 'j' in md  # 约束文本不丢
    assert '2 <= i <= j <= 10' in md  # 实体解码为比较符
    # 命名实体（&le;/&ge;/&amp;）也由 unescape 兜底（映射为 Unicode 字符 ≤/≥）
    assert _html_to_md('<p>1 &le; n &le; 10<sup>5</sup>, a &amp; b</p>') == \
        '1 ≤ n ≤ 10^5^, a & b'


def test_leetcode_numeric_ref_friendly_error(client):
    """P1-B: 纯数字 LeetCode 题号给出友好提示（不空跑 GraphQL 必然落空）。"""
    r = client.post("/api/practice/fetch",
                    json={"source": "leetcode", "slug": "205"})
    assert r.status_code == 400, r.text
    assert "题号" in r.json()["message"]
    assert "https://leetcode.cn/problems/" in r.json()["message"]
    # auto 模式纯数字同样命中引导（不会落到 GraphQL）
    r = client.post("/api/practice/fetch",
                    json={"source": "auto", "url": "205"})
    assert r.status_code == 400 and "题号" in r.json()["message"]


def test_leetcode_not_found_hint_message(client, monkeypatch):
    """P1-B: 查不到时区分文案（提示中文站独有 → 换 leetcode.cn 链接/slug）。"""
    fetchers.clear_cache()
    monkeypatch.setattr(fetchers.requests, "post",
                        lambda *a, **k: FakeResp({"data": {"question": None}}))
    r = client.post("/api/practice/fetch",
                    json={"source": "leetcode", "slug": "no-such-problem"})
    assert r.status_code == 400
    assert "国际版" in r.json()["message"] and "leetcode.cn" in r.json()["message"]


def test_fetch_route_error_envelope(client):
    """P1-C: 非法请求体统一 400 信封（不再 FastAPI 422）。"""
    # 非 JSON 载荷
    r = client.post("/api/practice/fetch", content=b"not json",
                    headers={"content-type": "application/json"})
    assert r.status_code == 400, r.text
    assert r.json()["code"] == 400 and r.json()["success"] is False
    assert r.json()["message"] == "请求体应为 JSON 对象"
    # JSON 数组（非对象）
    r = client.post("/api/practice/fetch", json=[1, 2])
    assert r.status_code == 400 and r.json()["code"] == 400
    # source 白名单外
    r = client.post("/api/practice/fetch",
                    json={"source": "atcoder", "slug": "abc"})
    assert r.status_code == 400 and "source" in r.json()["message"]
    # 空 body（无 JSON）
    r = client.post("/api/practice/fetch")
    assert r.status_code == 400 and r.json()["code"] == 400


def test_luogu_404_friendly_error(client, monkeypatch):
    """P2-D: 洛谷 404 给出明确文案（而不是 raise_for_status 的裸 HTTP 错误）。"""
    fetchers.clear_cache()

    class Fake404Session:
        def get(self, url, headers=None, timeout=None):
            return FakeResp({}, status_code=404)

    monkeypatch.setattr(fetchers, "_luogu_session", lambda: Fake404Session())
    r = client.post("/api/practice/fetch",
                    json={"source": "luogu", "slug": "P99999"})
    assert r.status_code == 400, r.text
    assert "题目不存在" in r.json()["message"] and "题号" in r.json()["message"]


def test_luogu_malformed_samples_skipped(client, monkeypatch):
    """P2-D: 畸形样例（None/字符串/缺输出）跳过，不炸整个抓题。"""
    fetchers.clear_cache()
    payload = {"data": {"currentData": {"problem": {
        "pid": "P1002", "name": "畸形样例", "difficulty": 1,
        "content": {"description": "题面",
                    "samples": [None, "1 2", ["only-input"], ["1 2", "3"]]},
        "tags": [],
    }}}}

    class FakeSession:
        def get(self, url, headers=None, timeout=None):
            if "_lfe/tags" in url:
                return FakeResp([])
            return FakeResp(payload)

    monkeypatch.setattr(fetchers, "_luogu_session", lambda: FakeSession())
    r = client.post("/api/practice/fetch",
                    json={"source": "luogu", "slug": "P1002"})
    assert r.status_code == 200, r.text
    desc = r.json()["data"]["description_md"]
    assert "```input\n1 2\n```" in desc and "```output\n3\n```" in desc
    assert desc.count("## 样例") == 1  # 前三个畸形样例被跳过


def test_yaml_scalar_tab():
    """P2-E: 含 tab 的标题导出后导入不丢。"""
    from app.practice.importer import _yaml_scalar
    assert _yaml_scalar('two\tsum').startswith('"')  # 应被引号化
    import json as json_mod
    assert json_mod.loads(_yaml_scalar('two\tsum')) == 'two\tsum'  # 转义合法
    assert _yaml_scalar('car\rreturn').startswith('"')
    assert _yaml_scalar('ctrl\x01char').startswith('"')
    assert _yaml_scalar('普通标量') == '普通标量'


def test_md_parse_whitelist_fallback():
    """P2-F: md 导入 source/status 过白名单回退（与 JSON 导入同语义）。"""
    from app.practice.importer import _parse_md_file
    md = ("---\n"
          "title: 白名单回退\n"
          "source: atcoder\n"
          "status: weird\n"
          "difficulty: 9\n"
          "---\n\n"
          "## 题目描述\n\n题面\n")
    draft = _parse_md_file(md)
    assert draft.source == "other" and draft.status == "todo"
    assert draft.difficulty == 3 and draft.title == "白名单回退"
    # 合法值原样保留
    md_ok = "---\ntitle: T\nsource: luogu\nstatus: solved\n---\n"
    assert _parse_md_file(md_ok).source == "luogu"
    assert _parse_md_file(md_ok).status == "solved"


def test_import_md_zip_soft_deleted_counts_as_dup(client):
    """P2-H: 软删行也算已存在，zip 重导不复活重复题（导入幂等）。"""
    d = mk_problem(client, title="软删题", source_no="100")
    assert client.delete(f"/api/practice/problems/{d['id']}").status_code == 200
    md = ("---\n"
          "title: 手写新题\n"
          "source: leetcode\n"
          "source_no: \"100\"\n"
          "difficulty: 2\n"
          "status: solved\n"
          "---\n\n"
          "## 题目描述\n\n同编号重导\n")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("note.md", md)
    r = client.post("/api/practice/import",
                    files={"file": ("notes.zip", buf.getvalue(), "application/zip")})
    assert r.status_code == 200, r.text
    out = r.json()["data"]
    assert out["imported_problems"] == 0 and out["skipped"] == 1
    assert client.get("/api/practice/problems").json()["data"]["total"] == 0


# ---------- 33-37. 第 3 轮评审（性能）回归 ----------

def test_list_summary_defers_text_fields(client):
    """P1-B: 列表摘要不携带 Text 大字段（恒 None），详情端点仍返回全文。"""
    mk_problem(client, title="大字段题", source_no="500",
               description_md="题面" * 100, pitfall_md="易错",
               solutions=[{"name": "s",
                           "codes": [{"language": "python", "code": "1"}]}])
    item = client.get("/api/practice/problems",
                      params={"q": "大字段"}).json()["data"]["items"][0]
    assert item["description_md"] is None and item["pitfall_md"] is None
    assert item["solution_count"] == 1  # 其余摘要聚合不受 defer 影响
    detail = client.get(f"/api/practice/problems/{item['id']}").json()["data"]
    assert detail["description_md"] == "题面" * 100 and detail["pitfall_md"] == "易错"


def test_review_today_summary_defers_text(client, app):
    """P1-B: 今日复习队列的题目摘要同样不携带 Text 大字段。"""
    d = join_review(client, mk_problem(client, title="复习大字段",
                                       description_md="题面" * 50)["id"])
    set_scheduled(app, d["next_review"]["id"], _today())
    items = client.get("/api/practice/review/today").json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["problem"]["description_md"] is None


def test_import_md_zip_direct_insert(client):
    """P1-C: zip 导入直插 ORM（不走 create_problem）——题/标签去重/解法/复习行齐全。"""
    md1 = ("---\n"
           "title: 直插题一\n"
           "source: leetcode\n"
           "source_no: \"300\"\n"
           "difficulty: 2\n"
           "status: solved\n"
           "tags:\n"
           "  - DP\n"
           "  - DP\n"
           "---\n\n"
           "## 题目描述\n\n题面一\n\n"
           "## 易错点\n\n注意边界\n")
    md2 = ("---\n"
           "title: 直插题二\n"
           "source: luogu\n"
           "status: reviewing\n"
           "---\n\n"
           "## 题目描述\n\n题面二\n\n"
           "## 解法\n\n"
           "### 暴力\n\n```python\nprint(1)\n```\n")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("a.md", md1)
        zf.writestr("b.md", md2)
    r = client.post("/api/practice/import",
                    files={"file": ("notes.zip", buf.getvalue(), "application/zip")})
    assert r.status_code == 200, r.text
    assert r.json()["data"] == {"imported_problems": 2, "skipped": 0, "invalid": 0}

    d1 = client.get("/api/practice/problems",
                    params={"q": "直插题一"}).json()["data"]["items"][0]
    detail1 = client.get(f"/api/practice/problems/{d1['id']}").json()["data"]
    assert detail1["source_no"] == "300" and detail1["status"] == "solved"
    assert detail1["first_solved_at"] == _today().isoformat()  # solved 自动补首解日期
    assert detail1["description_md"] == "题面一" and detail1["pitfall_md"] == "注意边界"
    assert detail1["revision"] == 1
    assert [t["name"] for t in detail1["tags"]] == ["DP"]  # frontmatter 重复标签去重

    d2 = client.get("/api/practice/problems",
                    params={"q": "直插题二"}).json()["data"]["items"][0]
    detail2 = client.get(f"/api/practice/problems/{d2['id']}").json()["data"]
    assert detail2["status"] == "reviewing"
    nr = detail2["next_review"]  # reviewing 导入即加入复习：首条 pending 明天到期
    assert nr["cycle"] == 1 and nr["seq"] == 1 and nr["prev_interval_days"] == 1
    assert nr["scheduled_date"] == (_today() + timedelta(days=1)).isoformat()
    sol = detail2["solutions"][0]
    assert sol["name"] == "暴力" and sol["revision"] == 1
    assert [c["language"] for c in sol["codes"]] == ["python"]
    # 导入的标签确实建了出来
    assert any(t["name"] == "DP" for t in client.get("/api/practice/tags").json()["data"])


def test_list_page_capped_at_1000(client):
    """P2-D: page 超上限钳到 1000（防深翻页大 OFFSET）。"""
    mk_problem(client)
    out = client.get("/api/practice/problems",
                     params={"page": 99999}).json()["data"]
    assert out["page"] == 1000 and out["items"] == [] and out["total"] == 1
    assert client.get("/api/practice/problems",
                      params={"page": 0}).json()["data"]["page"] == 1


def test_luogu_tags_negative_cache(client, monkeypatch):
    """P2-F: 标签表拉取失败写 60s 负缓存，同批第二题不再重打 /_lfe/tags。"""
    fetchers.clear_cache()
    problem_payload = {"data": {"currentData": {"problem": {
        "pid": "P2001", "name": "题一", "difficulty": 1,
        "content": {"description": "题面", "samples": []}, "tags": [10],
    }}}}

    class FakeFailTagsSession:
        def __init__(self):
            self.tag_calls = 0

        def get(self, url, headers=None, timeout=None):
            if "_lfe/tags" in url:
                self.tag_calls += 1
                raise fetchers.requests.RequestException("boom")
            return FakeResp(problem_payload)

    fake = FakeFailTagsSession()
    monkeypatch.setattr(fetchers, "_luogu_session", lambda: fake)
    for pid in ("P2001", "P2002"):
        problem_payload["data"]["currentData"]["problem"]["pid"] = pid
        r = client.post("/api/practice/fetch",
                        json={"source": "luogu", "slug": pid})
        assert r.status_code == 200, r.text
        assert r.json()["data"]["tag_names"] == []  # 失败静默降级为空
    assert fake.tag_calls == 1  # 第二题命中 60s 负缓存，未再请求标签表
    fetchers.clear_cache()


# ---------- 38-43. 第 5 轮评审（安全）回归 ----------

def _zip_bytes(entries) -> bytes:
    """[(name, content)] → zip bytes（DEFLATED；重复字符压缩比极高，体量测试不用真传大包）。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in entries:
            zf.writestr(name, content)
    return buf.getvalue()


def test_import_upload_size_capped_20mb(client):
    """P1-A: multipart zip 上传超 20MB → 400（多读 1 字节探测，不整包读入）。"""
    import os
    r = client.post("/api/practice/import",
                    files={"file": ("bomb.zip", os.urandom(20 * 1024 * 1024 + 1),
                                    "application/zip")})
    assert r.status_code == 400, r.text
    assert r.json()["message"] == "文件过大（上限 20MB）"
    assert r.json()["code"] == 400 and r.json()["success"] is False


def test_import_zip_entry_and_total_limits(client):
    """P1-A: 条目数 >2000 → 400；单条目解压 >10MB 跳过；累计解压 >50MB → 400。"""
    # 条目数上限：2001 个微型条目（zip 本身仅几十 KB）
    r = client.post("/api/practice/import",
                    files={"file": ("many.zip", _zip_bytes(
                        [(f"{i:05d}.md", "x") for i in range(2001)]),
                        "application/zip")})
    assert r.status_code == 400, r.text
    assert "条目" in r.json()["message"]

    # 单条目声明解压 10MB+1 → 跳过计 invalid，其余条目照常导入
    good_md = "---\ntitle: 正常题\n---\n\n## 题目描述\n\n题面\n"
    r = client.post("/api/practice/import",
                    files={"file": ("big-entry.zip", _zip_bytes(
                        [("huge.md", "x" * (10 * 1024 * 1024 + 1)),
                         ("good.md", good_md)]), "application/zip")})
    assert r.status_code == 200, r.text
    assert r.json()["data"] == {"imported_problems": 1, "skipped": 0, "invalid": 1}

    # 累计解压：51 × 1MB（单条目均低于 10MB 上限）→ 51MB > 50MB 整体 400
    r = client.post("/api/practice/import",
                    files={"file": ("total.zip", _zip_bytes(
                        [(f"{i:03d}.md", "y" * (1024 * 1024)) for i in range(51)]),
                        "application/zip")})
    assert r.status_code == 400 and "50MB" in r.json()["message"]
    # 半途插入的题目随事务回滚，上一段导入的 1 题保留
    assert client.get("/api/practice/problems").json()["data"]["total"] == 1


def test_import_json_problem_cap(client):
    """P1-A: JSON 导入 problems 超 5000 条 → 400（不逐题 upsert）。"""
    payload = {"problems": [{"title": f"p{i}"} for i in range(5001)]}
    r = client.post("/api/practice/import", json=payload)
    assert r.status_code == 400, r.text
    assert "5000" in r.json()["message"]
    assert client.get("/api/practice/problems").json()["data"]["total"] == 0


def test_luogu_content_html_stripped(client, monkeypatch):
    """P1-B: 洛谷 content 各段防御性剥离混入的 HTML 标签（正常 Markdown 不受影响）。"""
    fetchers.clear_cache()
    payload = {"data": {"currentData": {"problem": {
        "pid": "P3001", "name": "标签混入", "difficulty": 1,
        "content": {
            "background": "背景 <b>加粗</b>",
            "description": "题面<script src=//evil.js></script> 与 <img src=x onerror=alert(2)>",
            "formatI": "输入 <i>斜体</i>",
            "formatO": "输出 <a href='javascript:alert(3)'>链接</a>",
            "hint": "提示 <iframe src=//xss></iframe>",
            "samples": [["1 2", "3"]],
        },
        "tags": [],
    }}}}

    class FakeSession:
        def get(self, url, headers=None, timeout=None):
            if "_lfe/tags" in url:
                return FakeResp([])
            return FakeResp(payload)

    monkeypatch.setattr(fetchers, "_luogu_session", lambda: FakeSession())
    r = client.post("/api/practice/fetch",
                    json={"source": "luogu", "slug": "P3001"})
    assert r.status_code == 200, r.text
    desc = r.json()["data"]["description_md"]
    # 标签连同属性整体剥掉，无脚本地址/事件处理器残留
    assert "<" not in desc and "alert" not in desc and "evil" not in desc
    assert "xss" not in desc and "javascript:" not in desc
    # 正文文本保留
    assert "背景 加粗" in desc and "题面" in desc and "与" in desc
    assert "## 输入格式" in desc and "输入 斜体" in desc
    assert "## 输出格式" in desc and "输出 链接" in desc
    assert "## 说明/提示" in desc and "提示" in desc
    assert "```input\n1 2\n```" in desc  # 样例块不受剥离影响
    fetchers.clear_cache()


def test_cache_put_lru_eviction():
    """P2-C: 缓存满 256 条按插入序驱逐最旧（不再只清过期项）。"""
    fetchers.clear_cache()
    try:
        for i in range(300):
            fetchers._cache_put(f"k{i}", i)
        assert len(fetchers._CACHE) == 256   # 恒有界
        for i in range(44):                  # 最旧 44 条按插入序被驱逐
            assert f"k{i}" not in fetchers._CACHE
        assert "k44" in fetchers._CACHE and "k299" in fetchers._CACHE
        assert fetchers._cache_get("k299") == 299  # 未驱逐项值完好
    finally:
        fetchers.clear_cache()


def test_import_json_type_guards(client, app):
    """P2-D: 数值字段非法回退默认值、id 非法（非 str/超 36 列宽）回退生成，不 500。"""
    payload = {
        "tags": [
            {"id": 12345, "name": "数值id标签", "sort_order": "abc"},
            {"id": "t" * 40, "name": "超长id标签", "sort_order": {"x": 1}},
            {"id": "good-tag-1", "name": "合法标签", "sort_order": 5},
        ],
        "problems": [{
            "id": 98765,                      # 非法（int）→ 自动生成 uuid7
            "title": "类型防护题",
            "difficulty": "high",             # 非法 → 1
            "revision": ["nope"],             # 非法 → 1
            "tags": [12345, "t" * 40, "good-tag-1", "ghost"],  # 只挂合法且存在的
            "solutions": [{
                "id": {"bad": 1}, "name": "解法",
                "sort_order": "zero", "revision": "x",
                "codes": [{"id": ["l"], "language": "python", "code": "1"}],
            }],
            "reviews": [
                {"id": 3.14, "cycle": "one", "seq": [7],           # 全非法 → 1
                 "prev_interval_days": "x", "next_interval_days": "y",
                 "scheduled_date": "2026-01-01", "status": "done",
                 "result": "remembered"},
                {"id": "rv-ok", "cycle": 1, "seq": 2, "prev_interval_days": 2,
                 "scheduled_date": "2026-01-02", "status": "pending"},
            ],
        }],
    }
    r = client.post("/api/practice/import", json=payload)
    assert r.status_code == 200, r.text
    out = r.json()["data"]
    assert out["imported_tags"] == 3 and out["imported_problems"] == 1

    tags = {t["name"]: t for t in client.get("/api/practice/tags").json()["data"]}
    assert tags["数值id标签"]["sort_order"] == 0    # 非法回退默认 0
    assert tags["超长id标签"]["sort_order"] == 0
    assert tags["合法标签"]["sort_order"] == 5      # 合法值原样保留
    assert tags["合法标签"]["id"] == "good-tag-1"   # 合法 id 原样落库

    items = client.get("/api/practice/problems").json()["data"]["items"]
    assert len(items) == 1
    d = client.get(f"/api/practice/problems/{items[0]['id']}").json()["data"]
    assert d["id"] != "98765" and len(d["id"]) == 36    # 非法 id → 生成 uuid7
    assert d["revision"] == 1 and d["difficulty"] == 1  # 数值字段回退默认
    assert [t["name"] for t in d["tags"]] == ["合法标签"]  # 畸形/未知引用跳过
    sol = d["solutions"][0]
    assert len(sol["id"]) == 36 and sol["sort_order"] == 0.0 and sol["revision"] == 1
    assert len(sol["codes"][0]["id"]) == 36
    # R13-6：题目 status 缺省净化为 todo → 合法 pending 行 rv-ok 也置 cancelled
    assert d["next_review"] is None

    # done 复习行的非法数值直接查库验证回退（详情端点不回传历史流水）
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from app.practice.models import PracticeReview

    with Session(app.state.engine) as s:
        done = s.scalar(select(PracticeReview).where(
            PracticeReview.problem_id == d["id"],
            PracticeReview.status == "done"))
        assert done.cycle == 1 and done.seq == 1
        assert done.prev_interval_days == 1
        assert done.next_interval_days is None       # 非法 → None（不 500）
        pend = s.get(PracticeReview, "rv-ok")
        assert pend is not None and pend.status == "cancelled"


def test_fetch_error_classified(client, monkeypatch, caplog):
    """P2-E: 网络异常按类型收敛文案（超时/连接/其他），原文记 warning 日志。"""
    import logging
    fetchers.clear_cache()

    cases = [
        (fetchers.requests.Timeout("read timed out"), "网络超时"),
        (fetchers.requests.ConnectionError("connection refused"), "无法连接"),
        (fetchers.requests.RequestException("ssl boom"), "请求异常"),
    ]
    for i, (exc, word) in enumerate(cases):
        def boom(*a, _exc=exc, **k):
            raise _exc

        monkeypatch.setattr(fetchers.requests, "post", boom)
        with caplog.at_level(logging.WARNING, logger="doublog.todo"):
            r = client.post("/api/practice/fetch",
                            json={"source": "leetcode", "slug": f"slug-{i}"})
        assert r.status_code == 400, r.text
        assert r.json()["message"] == f"LeetCode 请求失败: {word}"

    # 洛谷路径同样收敛
    class FailSession:
        def get(self, url, headers=None, timeout=None):
            raise fetchers.requests.ConnectionError("refused")

    monkeypatch.setattr(fetchers, "_luogu_session", lambda: FailSession())
    r = client.post("/api/practice/fetch",
                    json={"source": "luogu", "slug": "P5000"})
    assert r.status_code == 400
    assert r.json()["message"] == "洛谷 请求失败: 无法连接"

    # 原始异常文本只进日志，不透给用户
    logged = " ".join(rec.getMessage() for rec in caplog.records)
    assert "read timed out" in logged and "connection refused" in logged
    assert "ssl boom" in logged
    fetchers.clear_cache()


# ---------- 44-48. 第 6 轮评审（边界）回归 ----------

def test_get_or_create_tag_race_keeps_outer_transaction(app):
    """第6轮-1: 竞态撞名只回滚嵌套 savepoint——外层未提交数据不被污染、复用已存在行。"""
    from sqlalchemy import func, select
    from sqlalchemy.orm import Session

    from app.practice import services
    from app.practice.models import PracticeProblem, PracticeTag

    with Session(app.state.engine) as s:
        s.add(PracticeTag(id="tag-keep", name="KEEP", color="#111111",
                          sort_order=0, created_at=services.now_utc()))
        s.commit()

    with Session(app.state.engine) as s:
        # 外层事务已有未提交写入（同 create_problem：先 flush 题目再挂标签）
        problem = PracticeProblem(
            id="prob-outer", source="other", title="外层题", difficulty=1,
            status="todo", revision=1,
            created_at=services.now_utc(), updated_at=services.now_utc())
        s.add(problem)
        s.flush()

        # 模拟竞态：预检（第一次按名查询）打桩看不到对手行，写入时撞唯一约束
        orig_scalar = s.scalar
        state = {"missed": False}

        def scalar_with_race(stmt):
            if not state["missed"]:
                state["missed"] = True
                return None
            return orig_scalar(stmt)

        s.scalar = scalar_with_race
        try:
            tag = services.get_or_create_tag(s, "KEEP")
        finally:
            s.scalar = orig_scalar
        assert tag is not None and tag.id == "tag-keep"  # 复用已存在行
        s.commit()  # 外层题目行未被 session.rollback() 连带丢掉

    with Session(app.state.engine) as s:
        assert s.get(PracticeProblem, "prob-outer") is not None
        # 失败的 INSERT 被 savepoint 回滚，库内不残留重复 KEEP
        assert s.scalar(select(func.count()).select_from(PracticeTag)) == 1


def test_interval_whitelist_clamped_on_import(client, app):
    """第6轮-2: JSON 导入 prev_interval_days 过 INTERVALS 白名单——非法值就近 clamp。"""
    payload = {"tags": [], "problems": [{
        "id": "iv-clamp", "title": "档位清洗题", "status": "reviewing",
        "reviews": [
            {"id": "rv-lo", "cycle": 1, "seq": 1, "status": "done",
             "prev_interval_days": 0, "scheduled_date": "2026-01-01",
             "result": "forgot", "next_interval_days": 1},
            {"id": "rv-mid", "cycle": 1, "seq": 2, "status": "done",
             "prev_interval_days": 3, "scheduled_date": "2026-01-02",
             "result": "fuzzy", "next_interval_days": 3},
            {"id": "rv-hi", "cycle": 1, "seq": 3, "status": "done",
             "prev_interval_days": 200, "scheduled_date": "2026-01-03",
             "result": "remembered", "next_interval_days": 200},
            {"id": "rv-bad", "cycle": 1, "seq": 4, "status": "pending",
             "prev_interval_days": "x", "scheduled_date": "2026-01-04"},
        ],
    }]}
    r = client.post("/api/practice/import", json=payload)
    assert r.status_code == 200, r.text
    nr = client.get("/api/practice/problems/iv-clamp").json()["data"]["next_review"]
    assert nr["prev_interval_days"] == 1  # "x" → 默认 1（合法档）

    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from app.practice.models import PracticeReview

    with Session(app.state.engine) as s:
        rows = {row.id: row.prev_interval_days for row in s.scalars(
            select(PracticeReview).where(PracticeReview.problem_id == "iv-clamp"))}
    # 0→1、3→2（等距取低档）、200→120、垃圾值→1
    assert rows == {"rv-lo": 1, "rv-mid": 2, "rv-hi": 120, "rv-bad": 1}


def test_do_review_clamps_offlist_interval(client, app):
    """第6轮-2: 打卡时档位值异常（手工改库）→ 就近 clamp（不再硬回第 0 档）。"""
    from sqlalchemy import update
    from sqlalchemy.orm import Session

    from app.practice.models import PracticeReview

    d = join_review(client, mk_problem(client)["id"])
    with Session(app.state.engine) as s:
        s.execute(update(PracticeReview)
                  .where(PracticeReview.id == d["next_review"]["id"])
                  .values(prev_interval_days=3))
        s.commit()
    # clamp(3)→2 → remembered 进 4 天档（旧 stage=0 行为会回 2 天档）
    out = client.post(f"/api/practice/problems/{d['id']}/review",
                      json={"result": "remembered"}).json()["data"]
    assert out["next_interval_days"] == 4

    # 越顶档（200）→ clamp 到 120 → remembered 直接毕业
    d2 = join_review(client, mk_problem(client, title="越界档", source_no="2")["id"])
    with Session(app.state.engine) as s:
        s.execute(update(PracticeReview)
                  .where(PracticeReview.id == d2["next_review"]["id"])
                  .values(prev_interval_days=200))
        s.commit()
    out2 = client.post(f"/api/practice/problems/{d2['id']}/review",
                       json={"result": "remembered"}).json()["data"]
    assert out2["graduated"] is True and out2["next_interval_days"] == 120


def test_fetch_unknown_difficulty_defaults_medium(client, monkeypatch):
    """第6轮-3: 未知难度 → 2（中等，中性），不再偏置为 1（简单）。"""
    fetchers.clear_cache()
    monkeypatch.setattr(fetchers.requests, "post",
                        lambda *a, **k: FakeResp({"data": {"question": {
                            "title": "Weird One", "difficulty": "Unknown",
                            "isPaidOnly": False}}}))
    r = client.post("/api/practice/fetch",
                    json={"source": "leetcode", "slug": "weird-one"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["difficulty"] == 2
    fetchers.clear_cache()

    # 洛谷：0=暂无评定 / 非数值 → 2；正常档位映射不变
    assert fetchers._luogu_difficulty(0) == 2
    assert fetchers._luogu_difficulty(None) == 2
    assert fetchers._luogu_difficulty("x") == 2
    assert fetchers._luogu_difficulty(1) == 1 and fetchers._luogu_difficulty(5) == 2
    assert fetchers._luogu_difficulty(7) == 3


def test_update_tag_name_race_returns_400(app):
    """第6轮-4: update_tag 撞名竞态（预检被绕过）→ 400 标签名已存在（而非裸 500）。"""
    from fastapi import HTTPException
    from sqlalchemy.orm import Session

    from app.practice import services
    from app.practice.models import PracticeTag
    from app.practice.schemas import TagUpdate

    with Session(app.state.engine) as s:
        s.add_all([
            PracticeTag(id="tag-a", name="A", color="#111111", sort_order=0,
                        created_at=services.now_utc()),
            PracticeTag(id="tag-b", name="B", color="#222222", sort_order=1,
                        created_at=services.now_utc()),
        ])
        s.commit()

    with Session(app.state.engine) as s:
        orig_scalar = s.scalar
        state = {"missed": False}

        def scalar_with_race(stmt):
            if not state["missed"]:
                state["missed"] = True
                return None  # 重名预检被竞态绕过，flush 时才撞唯一约束
            return orig_scalar(stmt)

        s.scalar = scalar_with_race
        try:
            with pytest.raises(HTTPException) as ei:
                services.update_tag(s, "tag-a", TagUpdate(name="B"))
        finally:
            s.scalar = orig_scalar
        assert ei.value.status_code == 400
        assert "标签名已存在" in str(ei.value.detail)
        assert s.get(PracticeTag, "tag-a").name == "A"  # rollback 后改名未生效
        assert s.get(PracticeTag, "tag-b").name == "B"


def test_tag_names_empty_and_overlong_sanitized(client):
    """第6轮-5: 按名建标签——strip 后空名跳过（不建空标签）、超长截断到 100。"""
    d = mk_problem(client, tag_names=["   ", "好" * 150])
    assert len(d["tags"]) == 1
    assert len(d["tags"][0]["name"]) == 100  # 截断到 name 列宽
    tags = client.get("/api/practice/tags").json()["data"]
    assert len(tags) == 1 and all(t["name"].strip() for t in tags)  # 无空名标签

    # md zip 导入通道（_insert_draft）同语义：空白 tag 跳过
    md = ("---\n"
          "title: 空白标签题\n"
          "source: leetcode\n"
          "tags:\n"
          "  - '  '\n"
          "  - 正常标签\n"
          "---\n\n"
          "## 题目描述\n\n题面\n")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("note.md", md)
    r = client.post("/api/practice/import",
                    files={"file": ("notes.zip", buf.getvalue(), "application/zip")})
    assert r.status_code == 200, r.text
    names = {t["name"] for t in client.get("/api/practice/tags").json()["data"]}
    assert names == {d["tags"][0]["name"], "正常标签"}


# ---------- 49-52. R11-R15 批量评审回归 ----------

def test_blank_title_and_solution_name_rejected(client):
    """R13-2: 标题/解法名 strip 后为空 → 400（schema min_length 拦不住纯空白）。"""
    r = client.post("/api/practice/problems", json={"title": "   "})
    assert r.status_code == 400 and r.json()["message"] == "标题不能为空"

    d = mk_problem(client)
    r = client.patch(f"/api/practice/problems/{d['id']}",
                     json={"title": "  ", "revision": d["revision"]})
    assert r.status_code == 400 and "标题" in r.json()["message"]

    r = client.post(f"/api/practice/problems/{d['id']}/solutions",
                    json={"name": " ", "codes": []})
    assert r.status_code == 400 and "解法名称" in r.json()["message"]

    # source_no 纯空白 → 落库归一为 None（R13-1）
    d2 = mk_problem(client, title="空白题号", source_no="   ", status="solved")
    assert d2["source_no"] is None


def test_import_review_invariant_repaired(client):
    """R13-6: 导入后修复状态机不变量——reviewing 无 pending 补一条（明天）；
    非 reviewing 带 pending 置 cancelled。R13-3: 代码语言白名单归一回退。"""
    payload = {"tags": [], "problems": [
        {"id": "p-inv-1", "title": "缺行复习题", "status": "reviewing",
         "solutions": [{"name": "解法", "codes": [
             {"language": "Python", "code": "x=1"},        # 大写 → lower 归一 python
             {"language": "pascal", "code": "begin"}]}],   # 白名单外 → other
         "reviews": [{"id": "rv-done", "cycle": 1, "seq": 1, "status": "done",
                      "scheduled_date": "2026-01-01", "result": "remembered"}]},
        {"id": "p-inv-2", "title": "带行待做题", "status": "todo",
         "reviews": [{"id": "rv-pend", "cycle": 1, "seq": 1, "status": "pending",
                      "scheduled_date": "2026-01-01"}]},
    ]}
    r = client.post("/api/practice/import", json=payload)
    assert r.status_code == 200, r.text

    # reviewing + 无 pending → 补一条（接续 cycle/seq，明天到期）
    d1 = client.get("/api/practice/problems/p-inv-1").json()["data"]
    nr = d1["next_review"]
    assert nr is not None and nr["cycle"] == 2 and nr["seq"] == 2
    assert nr["scheduled_date"] == (_today() + timedelta(days=1)).isoformat()
    # R13-3：语言归一（Python→python、pascal→other）
    assert sorted(c["language"] for c in d1["solutions"][0]["codes"]) == ["other", "python"]

    # 非 reviewing + pending → 置 cancelled，不再进今日队列
    d2 = client.get("/api/practice/problems/p-inv-2").json()["data"]
    assert d2["next_review"] is None
    queue = client.get("/api/practice/review/today").json()["data"]
    assert all(i["problem"]["id"] != "p-inv-2" for i in queue["items"])


def test_import_scheduled_date_fallback_local_today(client, app):
    """R11-1: 复习行缺 scheduled_date → 回退本地时区今天（非 created_at 的 UTC 日）。"""
    payload = {"tags": [], "problems": [{
        "id": "p-fb", "title": "回退日期题", "status": "reviewing",
        # created_at 取本地深夜边界也保证 UTC 日 ≠ 本地日的用例由时区决定，
        # 这里只断言回退值与 _today() 一致（Asia/Shanghai 下 UTC 16 点后必然不同日）
        "reviews": [{"id": "rv-fb", "cycle": 1, "seq": 1, "status": "pending"}],
    }]}
    r = client.post("/api/practice/import", json=payload)
    assert r.status_code == 200, r.text
    nr = client.get("/api/practice/problems/p-fb").json()["data"]["next_review"]
    assert nr["scheduled_date"] == _today().isoformat()


# ---------- 53-60. R16-R20 最终评审回归 ----------

def test_graduate_then_rejoin(client):
    """R18-1: 8 次 remembered 毕业（mastered）→ PATCH reviewing 重新加入 → cycle=2、seq 跨轮累计。"""
    d = join_review(client, mk_problem(client)["id"])
    out = None
    for _ in range(8):  # 1→2→4→7→15→30→60→120→毕业
        out = client.post(f"/api/practice/problems/{d['id']}/review",
                          json={"result": "remembered"}).json()["data"]
    assert out["graduated"] is True and out["next_scheduled_date"] is None
    detail = client.get(f"/api/practice/problems/{d['id']}").json()["data"]
    assert detail["status"] == "mastered" and detail["next_review"] is None

    rejoin = join_review(client, d["id"])  # mastered → reviewing = 重新加入复习
    nr = rejoin["next_review"]
    assert rejoin["status"] == "reviewing"
    assert nr["cycle"] == 2        # 新一轮次
    assert nr["seq"] == 9          # seq 跨轮累计（前 8 次 done + 1）
    assert nr["prev_interval_days"] == 1
    assert nr["scheduled_date"] == (_today() + timedelta(days=1)).isoformat()


def test_concurrent_review_409(client, app, monkeypatch):
    """R18-2: 并发打卡——本请求持有旧 pending 快照，对手已提交新 pending →
    生成下一行撞每题至多一条 pending 的 partial unique → 409。"""
    from fastapi import HTTPException
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from app.practice import services
    from app.practice.models import PracticeReview
    from app.shared.timeutil import now_utc

    d = join_review(client, mk_problem(client)["id"])
    # 模拟并发：对手请求已提交推进（原 pending→done + 新 pending 已落库）；
    # partial unique 使库里永远只有一条 pending，两条 pending 只存在于竞态窗口——
    # 本请求读到的是推进前的旧快照（detached 副本，status 仍 pending）
    with Session(app.state.engine) as s:
        row = s.get(PracticeReview, d["next_review"]["id"])
        stale = PracticeReview(
            id=row.id, problem_id=row.problem_id, cycle=row.cycle, seq=row.seq,
            prev_interval_days=row.prev_interval_days,
            scheduled_date=row.scheduled_date, status="pending",
            created_at=row.created_at)
        row.status = "done"
        row.result = "remembered"
        row.reviewed_at = now_utc()
        s.add(PracticeReview(id="rv-raced", problem_id=row.problem_id, cycle=1, seq=2,
                             prev_interval_days=2,
                             scheduled_date=_today() + timedelta(days=2),
                             status="pending", created_at=now_utc()))
        s.commit()

    monkeypatch.setattr(services, "_next_review_row", lambda session, pid: stale)
    with Session(app.state.engine) as s:
        with pytest.raises(HTTPException) as ei:
            services.do_review(s, d["id"], "remembered")
    assert ei.value.status_code == 409
    assert "请刷新后重试" in str(ei.value.detail)
    monkeypatch.undo()
    # 库内状态未被旧快照改写：仍是一条 done + 一条 pending
    with Session(app.state.engine) as s:
        statuses = sorted(
            r.status for r in s.scalars(
                select(PracticeReview).where(
                    PracticeReview.problem_id == d["id"])))
    assert statuses == ["done", "pending"]


def test_language_and_tag_combined_filter(client):
    """R18-4: language + tags(+tags_op=and) 组合筛选命中两者交集。"""
    t_dp = mk_tag(client, "DP")
    t_tree = mk_tag(client, "树")
    hit = mk_problem(client, title="命中题", source_no="101",
                     tag_ids=[t_dp["id"], t_tree["id"]],
                     solutions=[{"name": "解法",
                                 "codes": [{"language": "python", "code": "1"}]}])
    mk_problem(client, title="只有语言", source_no="102",
               solutions=[{"name": "解法",
                           "codes": [{"language": "python", "code": "1"}]}])
    mk_problem(client, title="只有标签", source_no="103",
               tag_ids=[t_dp["id"], t_tree["id"]])
    base = "/api/practice/problems"
    r = client.get(base, params={"language": "python",
                                 "tags": f"{t_dp['id']},{t_tree['id']}",
                                 "tags_op": "and"})
    out = r.json()["data"]
    assert out["total"] == 1 and out["items"][0]["id"] == hit["id"]
    # 单维度各自命中 2 题，组合后只剩交集——确认两个条件同时生效
    assert client.get(base, params={"language": "python"}).json()["data"]["total"] == 2
    assert client.get(base, params={
        "tags": f"{t_dp['id']},{t_tree['id']}", "tags_op": "and"}
    ).json()["data"]["total"] == 2


def test_list_param_guards(client):
    """R19-1/2/3: tags_op 白名单外 400；q 超长截断不报错；from > to 400。"""
    base = "/api/practice/problems"
    r = client.get(base, params={"tags_op": "xor"})
    assert r.status_code == 400, r.text
    assert r.json()["message"] == "tags_op 仅支持 and|or"
    # 合法取值照常（默认 or）
    assert client.get(base, params={"tags_op": "or"}).status_code == 200
    assert client.get(base, params={"tags_op": "and"}).status_code == 200

    # q 超 200 截断后照常执行（不 500）
    r = client.get(base, params={"q": "x" * 500})
    assert r.status_code == 200 and r.json()["data"]["total"] == 0

    today = _today().isoformat()
    yesterday = (_today() - timedelta(days=1)).isoformat()
    r = client.get(base, params={"from": today, "to": yesterday})
    assert r.status_code == 400 and "日期区间无效" in r.json()["message"]
    assert client.get(base, params={"from": yesterday, "to": today}).status_code == 200


def test_pydantic_422_envelope(client):
    """R17-1: pydantic 校验失败统一 400 错误信封（不裸 422），body 与 query 双路径。"""
    # body：title 类型非法
    r = client.post("/api/practice/problems", json={"title": 123})
    assert r.status_code == 400, r.text
    assert r.json()["code"] == 400 and r.json()["success"] is False
    assert r.json()["message"] == "请求参数错误"
    # body：Literal 外取值（ReviewIn）
    r = client.post("/api/practice/problems/some-pid/review",
                    json={"result": "wat"})
    assert r.status_code == 400 and r.json()["message"] == "请求参数错误"
    # query：page 非整数
    r = client.get("/api/practice/problems", params={"page": "abc"})
    assert r.status_code == 400 and r.json()["message"] == "请求参数错误"


def test_import_integrity_conflict_400(client):
    """R17-2: 导入撞唯一约束（复习流水重复 id）→ 整体回滚 + 400（不裸 500）。"""
    payload = {"tags": [], "problems": [{
        "id": "p-conflict", "title": "冲突题",
        "reviews": [
            {"id": "rv-dup", "cycle": 1, "seq": 1, "status": "done",
             "scheduled_date": "2026-01-01", "result": "remembered"},
            {"id": "rv-dup", "cycle": 1, "seq": 2, "status": "done",
             "scheduled_date": "2026-01-02", "result": "fuzzy"},
        ],
    }]}
    r = client.post("/api/practice/import", json=payload)
    assert r.status_code == 400, r.text
    assert r.json()["message"] == "数据冲突：标签名或子行 ID 重复"
    # 半途插入随回滚清空，库内无残留
    assert client.get("/api/practice/problems").json()["data"]["total"] == 0
    assert client.get("/api/practice/problems/p-conflict").status_code == 404

