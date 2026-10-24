"""gamemap 子模块测试(docs/gamemap-migration.md 第 4 节)。

覆盖:games CRUD+导出导入往返、chapters/characters CRUD+批量导入、boards merged 聚合+
拖动 PATCH+乐观锁 409、relation_types CRUD+覆盖/重置、events 时间线、photos CRUD、
search、uploads 白名单+越界 404、鉴权 401、seed 幂等、响应缓存写失效。

与源 gamemap 的适配点(规范允许的骨架差异):
- 响应为 {success,code,message,data} 信封:统一 .json()['data'] unwrap
- 前缀 /api/gamemap;鉴权走 Basic(上层 conftest 的 auth_headers)
- pydantic body 校验失败出 400(Doublog 全局处理器)
- 删除章节/游戏在同一事务按外键依赖清理；上传文件保留以避免破坏其他引用。
- 响应缓存按应用数据库runtime隔离；fixture同时检验显式失效入口。
"""
import pytest


@pytest.fixture(autouse=True)
def _reset_gamemap_cache(app):
    """每用例前后调用当前 app 的缓存失效入口。"""
    from app.gamemap import cache
    cache.invalidate_all()
    yield
    cache.invalidate_all()


# ---------- 构造小工具 ----------

def make_game(client, name="测试游戏", **kw):
    r = client.post("/api/gamemap/games", json={"name": name, **kw})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def make_chapter(client, game_id, title="章节", **kw):
    r = client.post(f"/api/gamemap/games/{game_id}/chapters", json={"title": title, **kw})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def make_character(client, game_id, name="人物", **kw):
    r = client.post(f"/api/gamemap/games/{game_id}/characters", json={"name": name, **kw})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def add_node(client, game_id, chapter_id, character_id):
    r = client.post(f"/api/gamemap/games/{game_id}/boards/chapters/{chapter_id}/nodes/{character_id}")
    assert r.status_code == 200, r.text
    return r.json()["data"]


def get_board(client, game_id, chapter_id):
    r = client.get(f"/api/gamemap/games/{game_id}/boards/chapters/{chapter_id}")
    assert r.status_code == 200, r.text
    return r.json()["data"]


def type_id_by_key(client, key, game_id=None):
    url = (f"/api/gamemap/games/{game_id}/relation-types" if game_id
           else "/api/gamemap/relation-types")
    types = client.get(url).json()["data"]
    for t in types:
        if t["key"] == key:
            return t["id"]
    raise AssertionError(f"relation type {key} not found")


# ---------- 鉴权与信封 ----------

def test_requires_auth(app):
    """router 级 Depends(require_basic):无凭据一律 401。"""
    from fastapi.testclient import TestClient

    c = TestClient(app)
    for url in ("/api/gamemap/games",
                "/api/gamemap/relation-types",
                "/api/gamemap/search?q=x",
                "/api/gamemap/chapters/1/events"):
        assert c.get(url).status_code == 401, url
    r = c.post("/api/gamemap/uploads", files={"file": ("a.png", b"x", "image/png")})
    assert r.status_code == 401


def test_response_envelope(client):
    """全部响应为 {success,code,message,data} 信封(files 二进制除外)。"""
    r = client.get("/api/gamemap/games")
    body = r.json()
    assert set(body) == {"success", "code", "message", "data"}
    assert body["success"] is True and body["code"] == 200
    r = client.get("/api/gamemap/games/999")
    body = r.json()
    assert body["success"] is False and body["code"] == 404
    assert body["message"] == "游戏不存在" and body["data"] is None


# ---------- games ----------

def test_games_crud(client):
    g = make_game(client, "游戏A", description="简介", play_status="planned")
    assert g["id"] > 0 and g["play_status"] == "planned" and g["cover_url"] == ""
    assert g["current_chapter_id"] is None

    games = client.get("/api/gamemap/games").json()["data"]
    assert any(x["name"] == "游戏A" for x in games)

    got = client.get(f"/api/gamemap/games/{g['id']}").json()["data"]
    assert got["name"] == "游戏A" and got["description"] == "简介"

    r = client.patch(f"/api/gamemap/games/{g['id']}", json={"play_status": "finished", "name": "游戏A改"})
    assert r.status_code == 200
    assert r.json()["data"]["play_status"] == "finished" and r.json()["data"]["name"] == "游戏A改"

    # 空游戏可删;删除后 404
    assert client.delete(f"/api/gamemap/games/{g['id']}").status_code == 200
    r = client.get(f"/api/gamemap/games/{g['id']}")
    assert r.status_code == 404 and r.json()["message"] == "游戏不存在"
    assert client.delete(f"/api/gamemap/games/{g['id']}").status_code == 404


def test_game_delete_with_children_is_atomic(client, app):
    """有章节/人物时也能删除，不再将子行外键置空。"""
    g = make_game(client)
    make_chapter(client, g["id"])
    make_character(client, g["id"], "甲")
    r = client.delete(f"/api/gamemap/games/{g['id']}")
    assert r.status_code == 200
    assert client.get(f"/api/gamemap/games/{g['id']}").status_code == 404


def test_game_stats(client):
    g = make_game(client)
    ch = make_chapter(client, g["id"], "一章")
    c1 = make_character(client, g["id"], "甲", faction="朝廷")
    c2 = make_character(client, g["id"], "乙", faction="朝廷")
    c3 = make_character(client, g["id"], "丙")
    add_node(client, g["id"], ch["id"], c1["id"])
    add_node(client, g["id"], ch["id"], c2["id"])
    tid = type_id_by_key(client, "friend")
    r = client.post(
        f"/api/gamemap/games/{g['id']}/boards/chapters/{ch['id']}/relations",
        json={"from_character_id": c1["id"], "to_character_id": c2["id"],
              "relation_type_id": tid, "description": "结义"})
    assert r.status_code == 200, r.text
    client.post(f"/api/gamemap/chapters/{ch['id']}/events", json={"title": "事件", "character_ids": [c3["id"]]})

    stats = client.get(f"/api/gamemap/games/{g['id']}/stats").json()["data"]
    assert stats["totals"] == {"chapters": 1, "characters": 3, "relations": 1, "relations_all": 1, "events": 1}
    assert stats["chapters"][0]["characters"] == 2 and stats["chapters"][0]["relations"] == 1
    top_names = [t["name"] for t in stats["top_characters"]]
    assert set(top_names) == {"甲", "乙"}
    assert stats["factions"] == [{"name": "朝廷", "count": 2, "alive": 2}]
    assert stats["type_usage"][0]["key"] == "friend" and stats["type_usage"][0]["count"] == 1


def _build_exportable_game(client):
    """两人物/一章节/看板(节点+关系+状态)/一事件,返回 (game, chapter, chars)。"""
    g = make_game(client, "导出源")
    ch = make_chapter(client, g["id"], "第一章", summary="概要", notes="笔记")
    c1 = make_character(client, g["id"], "甲", faction="朝廷", description="主角")
    c2 = make_character(client, g["id"], "乙", alive=False)
    add_node(client, g["id"], ch["id"], c1["id"])
    add_node(client, g["id"], ch["id"], c2["id"])
    tid = type_id_by_key(client, "enemy")
    client.post(
        f"/api/gamemap/games/{g['id']}/boards/chapters/{ch['id']}/relations",
        json={"from_character_id": c1["id"], "to_character_id": c2["id"],
              "relation_type_id": tid, "description": "宿敌"})
    client.put(f"/api/gamemap/games/{g['id']}/characters/{c1['id']}/chapters/{ch['id']}/state",
               json={"alias": "甲爷", "role": "将军", "alive_override": False})
    client.post(f"/api/gamemap/chapters/{ch['id']}/events",
                json={"title": "决战", "content": "内容", "character_ids": [c1["id"], c2["id"]]})
    return g, ch, (c1, c2)


def test_game_export(client):
    g, ch, (c1, c2) = _build_exportable_game(client)
    backup = client.get(f"/api/gamemap/games/{g['id']}/export").json()["data"]
    assert backup["format"] == "gamemap-backup" and backup["version"] == 1
    assert backup["game"]["name"] == "导出源"
    assert [c["name"] for c in backup["characters"]] == ["甲", "乙"]
    assert backup["characters"][1]["alive"] is False
    assert backup["custom_relation_types"] == []  # 只导出游戏自定义类型
    chd = backup["chapters"][0]
    assert chd["title"] == "第一章" and len(chd["nodes"]) == 2 and len(chd["relations"]) == 1
    assert chd["relations"][0]["type"] == "enemy" and chd["relations"][0]["from"] == 0
    assert chd["states"][0]["alias"] == "甲爷" and chd["states"][0]["alive_override"] is False
    assert chd["events"][0]["title"] == "决战" and chd["events"][0]["characters"] == [0, 1]
    assert client.get("/api/gamemap/games/999/export").status_code == 404


def test_game_import_roundtrip(client):
    """导出 → 导入 → 新游戏结构等价(全局关系类型按 key 复用)。"""
    g, ch, (c1, c2) = _build_exportable_game(client)
    backup = client.get(f"/api/gamemap/games/{g['id']}/export").json()["data"]

    r = client.post("/api/gamemap/games/import", json=backup)
    assert r.status_code == 200, r.text
    g2 = r.json()["data"]
    assert g2["id"] != g["id"] and g2["name"] == "导出源"

    chars = {c["name"]: c for c in client.get(f"/api/gamemap/games/{g2['id']}/characters").json()["data"]}
    assert set(chars) == {"甲", "乙"} and chars["乙"]["alive"] is False

    chapters = client.get(f"/api/gamemap/games/{g2['id']}/chapters").json()["data"]
    assert len(chapters) == 1 and chapters[0]["title"] == "第一章"
    assert g2["current_chapter_id"] == chapters[0]["id"]

    board = get_board(client, g2["id"], chapters[0]["id"])
    assert len(board["nodes"]) == 2 and len(board["relations"]) == 1
    # 关系类型按 key 复用全局 enemy
    assert board["relations"][0]["relation_type_id"] == type_id_by_key(client, "enemy")
    st = {s["character_id"]: s for s in board["states"]}
    assert st[chars["甲"]["id"]]["alias"] == "甲爷" and st[chars["甲"]["id"]]["alive_override"] is False

    events = client.get(f"/api/gamemap/chapters/{chapters[0]['id']}/events").json()["data"]
    assert events[0]["title"] == "决战"
    assert sorted(events[0]["character_ids"]) == sorted([chars["甲"]["id"], chars["乙"]["id"]])


def test_game_import_rejects_bad_format(client):
    r = client.post("/api/gamemap/games/import", json={"format": "other"})
    assert r.status_code == 400 and r.json()["message"] == "不是有效的 GameMap 备份文件"


def test_seed_relation_types_idempotent(client, app):
    """ensure_migrations 种子 7 个全局类型;直接再调 seed 不重复。"""
    from sqlalchemy.orm import Session

    from app.gamemap.seed import seed_global_relation_types

    types = client.get("/api/gamemap/relation-types").json()["data"]
    assert len(types) == 7
    keys = [t["key"] for t in types]
    assert keys[:3] == ["friend", "enemy", "family"]
    assert all(t["game_id"] is None for t in types)

    with Session(app.state.engine) as s:
        seed_global_relation_types(s)
        s.commit()
    assert len(client.get("/api/gamemap/relation-types").json()["data"]) == 7


# ---------- chapters ----------

def test_chapters_crud(client, app):
    g = make_game(client)
    ch1 = make_chapter(client, g["id"], "一", summary="s1")
    ch2 = make_chapter(client, g["id"], "二")
    assert ch1["order_index"] == 1 and ch2["order_index"] == 2

    r = client.patch(f"/api/gamemap/games/{g['id']}/chapters/{ch1['id']}",
                     json={"title": "一改", "notes": "n"})
    assert r.json()["data"]["title"] == "一改" and r.json()["data"]["notes"] == "n"

    titles = [c["title"] for c in client.get(f"/api/gamemap/games/{g['id']}/chapters").json()["data"]]
    assert titles == ["一改", "二"]

    # 跨游戏访问 → 404;缺游戏 → 404(单章仅有 PATCH/DELETE,无 GET 单条路由)
    g2 = make_game(client, "他游戏")
    r = client.patch(f"/api/gamemap/games/{g2['id']}/chapters/{ch1['id']}", json={"title": "x"})
    assert r.status_code == 404 and r.json()["message"] == "章节不存在"
    assert client.delete(f"/api/gamemap/games/{g2['id']}/chapters/{ch1['id']}").status_code == 404
    assert client.get("/api/gamemap/games/999/chapters").status_code == 404

    # 建章自动建板
    assert len(get_board(client, g["id"], ch1["id"])["nodes"]) == 0

    # API 建章必带板;无板章(API 造不出)可用 DB 直插验证删除通路
    from sqlalchemy.orm import Session

    from app.gamemap.models import Chapter
    with Session(app.state.engine) as s:
        ch3 = Chapter(game_id=g["id"], title="无板章", order_index=3)
        s.add(ch3)
        s.commit()
        ch3_id = ch3.id
    r = client.delete(f"/api/gamemap/games/{g['id']}/chapters/{ch3_id}")
    assert r.status_code == 200 and r.json()["data"] == {"ok": True}
    assert client.delete(f"/api/gamemap/games/{g['id']}/chapters/{ch3_id}").status_code == 404


def test_chapter_delete_with_board_is_atomic(client):
    """建章必带板，删除章节应连同从属板正常提交。"""
    g = make_game(client)
    ch = make_chapter(client, g["id"])
    r = client.delete(f"/api/gamemap/games/{g['id']}/chapters/{ch['id']}")
    assert r.status_code == 200
    assert client.get(f"/api/gamemap/games/{g['id']}/chapters").json()['data'] == []


def test_chapter_copy_from_previous(client):
    g = make_game(client)
    ch1 = make_chapter(client, g["id"], "一章")
    c1 = make_character(client, g["id"], "甲")
    c2 = make_character(client, g["id"], "乙")
    add_node(client, g["id"], ch1["id"], c1["id"])
    add_node(client, g["id"], ch1["id"], c2["id"])
    client.put(f"/api/gamemap/games/{g['id']}/characters/{c1['id']}/chapters/{ch1['id']}/state",
               json={"alias": "甲一章称呼", "role": "侠客"})
    tid = type_id_by_key(client, "family")
    client.post(
        f"/api/gamemap/games/{g['id']}/boards/chapters/{ch1['id']}/relations",
        json={"from_character_id": c1["id"], "to_character_id": c2["id"],
              "relation_type_id": tid, "description": "兄弟"})

    ch2 = make_chapter(client, g["id"], "二章", copy_from_previous=True)
    assert ch2["order_index"] == 2
    b2 = get_board(client, g["id"], ch2["id"])
    assert b2["version"] == 1
    assert {n["character_id"] for n in b2["nodes"]} == {c1["id"], c2["id"]}
    assert len(b2["relations"]) == 1 and b2["relations"][0]["description"] == "兄弟"
    st = {s["character_id"]: s for s in b2["states"]}
    assert st[c1["id"]]["alias"] == "甲一章称呼" and st[c1["id"]]["role"] == "侠客"
    # 状态/坐标独立:改二章状态不影响一章
    client.put(f"/api/gamemap/games/{g['id']}/characters/{c1['id']}/chapters/{ch2['id']}/state",
               json={"alias": "甲二章称呼"})
    b1 = get_board(client, g["id"], ch1["id"])
    st1 = {s["character_id"]: s for s in b1["states"]}
    assert st1[c1["id"]]["alias"] == "甲一章称呼"


# ---------- characters ----------

def test_characters_crud(client):
    g = make_game(client)
    c = make_character(client, g["id"], "甲", faction="朝廷", description="主角", alive=True)
    assert c["avatar_url"] == "" and c["faction"] == "朝廷"

    chars = client.get(f"/api/gamemap/games/{g['id']}/characters").json()["data"]
    assert [x["name"] for x in chars] == ["甲"]

    r = client.patch(f"/api/gamemap/games/{g['id']}/characters/{c['id']}",
                     json={"faction": "义军", "alive": False})
    assert r.json()["data"]["faction"] == "义军" and r.json()["data"]["alive"] is False

    # 未上板人物可删;跨游戏 → 404;缺游戏 → 404(人物仅有 PATCH/DELETE 单条路由)
    g2 = make_game(client, "他游戏")
    assert client.patch(f"/api/gamemap/games/{g2['id']}/characters/{c['id']}",
                        json={"name": "x"}).status_code == 404
    assert client.post("/api/gamemap/games/999/characters", json={"name": "x"}).status_code == 404
    assert client.delete(f"/api/gamemap/games/{g['id']}/characters/{c['id']}").status_code == 200
    assert client.get(f"/api/gamemap/games/{g['id']}/characters").json()["data"] == []


def test_characters_list_q_and_cache(client):
    """q 过滤(读缓存)+ 新建后缓存失效可见。"""
    g = make_game(client)
    make_character(client, g["id"], "张三")
    make_character(client, g["id"], "李四")
    assert [c["name"] for c in client.get(
        f"/api/gamemap/games/{g['id']}/characters", params={"q": "张"}).json()["data"]] == ["张三"]

    make_character(client, g["id"], "张飞")  # 写失效缓存
    names = [c["name"] for c in client.get(
        f"/api/gamemap/games/{g['id']}/characters", params={"q": "张"}).json()["data"]]
    # 排序键 updated_at 是 SQLite CURRENT_TIMESTAMP(秒级精度),两次建档跨秒边界时
    # DESC 顺序会翻转——本用例考察的是 q 过滤与缓存失效,不断言顺序
    assert sorted(names) == ["张三", "张飞"]


def test_characters_batch(client):
    g = make_game(client)
    ch = make_chapter(client, g["id"])
    r = client.post(f"/api/gamemap/games/{g['id']}/characters/batch",
                    json={"names": "王五、赵六，钱七\n孙八，王五", "add_to_chapter_id": ch["id"]})
    assert r.status_code == 200, r.text
    created = r.json()["data"]
    assert [c["name"] for c in created] == ["王五", "赵六", "钱七", "孙八"]

    # 批量同时上板(节点+空状态)
    board = get_board(client, g["id"], ch["id"])
    assert {n["character_id"] for n in board["nodes"]} == {c["id"] for c in created}
    assert len(board["states"]) == 4

    # 同名跳过(重复批量 → 空列表)
    r = client.post(f"/api/gamemap/games/{g['id']}/characters/batch", json={"names": "王五,赵六"})
    assert r.json()["data"] == []

    # add_to_chapter_id 跨游戏 → 404
    g2 = make_game(client, "他游戏")
    r = client.post(f"/api/gamemap/games/{g2['id']}/characters/batch",
                    json={"names": "周九", "add_to_chapter_id": ch["id"]})
    assert r.status_code == 404 and r.json()["message"] == "章节不存在"


def test_character_chapters(client):
    g = make_game(client)
    ch1 = make_chapter(client, g["id"], "一")
    ch2 = make_chapter(client, g["id"], "二")
    ch3 = make_chapter(client, g["id"], "三")
    c = make_character(client, g["id"], "甲")
    add_node(client, g["id"], ch2["id"], c["id"])
    add_node(client, g["id"], ch1["id"], c["id"])
    r = client.get(f"/api/gamemap/games/{g['id']}/characters/{c['id']}/chapters")
    assert [x["title"] for x in r.json()["data"]] == ["一", "二"]  # 按 order_index


def test_chapter_state(client):
    g = make_game(client)
    ch = make_chapter(client, g["id"])
    c = make_character(client, g["id"], "甲", faction="朝廷", alive=True)

    url = f"/api/gamemap/games/{g['id']}/characters/{c['id']}/chapters/{ch['id']}/state"
    assert client.get(url).status_code == 404 and client.get(url).json()["message"] == "该人物不在本章"

    add_node(client, g["id"], ch["id"], c["id"])  # 上板自动建空状态
    assert client.get(url).json()["data"]["alias"] == ""

    r = client.put(url, json={"alias": "甲爷", "role": "将军", "status": "重伤",
                              "notes": "备注", "alive_override": False, "faction_override": "叛军"})
    d = r.json()["data"]
    assert d["alias"] == "甲爷" and d["alive_override"] is False and d["faction_override"] == "叛军"

    # 显式 null → 回归跟随档案
    r = client.put(url, json={"faction_override": None})
    assert r.json()["data"]["faction_override"] is None


# ---------- boards ----------

def test_board_autocreate(client):
    g = make_game(client)
    ch = make_chapter(client, g["id"])
    b = get_board(client, g["id"], ch["id"])
    assert b["version"] == 1 and b["nodes"] == [] and b["relations"] == []
    assert b["characters"] == [] and b["states"] == []
    # 跨游戏章节 → 404
    g2 = make_game(client)
    assert client.get(f"/api/gamemap/games/{g2['id']}/boards/chapters/{ch['id']}").status_code == 404


def test_board_add_remove_node(client):
    g = make_game(client)
    ch = make_chapter(client, g["id"])
    c = make_character(client, g["id"], "甲")
    c2 = make_character(client, g["id"], "乙")
    add_node(client, g["id"], ch["id"], c["id"])
    add_node(client, g["id"], ch["id"], c["id"])  # 幂等:重复添加不重复建节点
    b = get_board(client, g["id"], ch["id"])
    assert len(b["nodes"]) == 1
    assert [x["name"] for x in b["characters"]] == ["甲"]
    assert len(b["states"]) == 1

    # 跨游戏人物 → 404(章节属 g2、人物属 g1,命中人物分支)
    g2 = make_game(client)
    ch2 = make_chapter(client, g2["id"], "他章")
    r = client.post(f"/api/gamemap/games/{g2['id']}/boards/chapters/{ch2['id']}/nodes/{c2['id']}")
    assert r.status_code == 404 and r.json()["message"] == "人物不存在"

    # 移除:只删节点与连线,保留章节状态
    r = client.delete(f"/api/gamemap/games/{g['id']}/boards/chapters/{ch['id']}/nodes/{c['id']}")
    assert r.status_code == 200 and r.json()["data"] == {"ok": True}
    b = get_board(client, g["id"], ch["id"])
    assert b["nodes"] == [] and len(b["states"]) == 1


def test_board_save_optimistic_lock(client):
    g = make_game(client)
    ch = make_chapter(client, g["id"])
    c = make_character(client, g["id"], "甲")
    save_url = f"/api/gamemap/games/{g['id']}/boards/chapters/{ch['id']}"

    r = client.put(save_url, json={"version": 1, "nodes": [{"character_id": c["id"], "x": 10, "y": 20}],
                                   "relations": []})
    assert r.status_code == 200, r.text
    b = r.json()["data"]
    assert b["version"] == 2 and len(b["nodes"]) == 1

    # 旧版本再存 → 409(信封保留原始文案)
    r = client.put(save_url, json={"version": 1, "nodes": [], "relations": []})
    assert r.status_code == 409
    assert r.json()["message"].startswith("看板已被其他页面修改")
    assert "当前版本 2" in r.json()["message"]


def test_board_save_validations(client):
    g = make_game(client)
    ch = make_chapter(client, g["id"])
    c1 = make_character(client, g["id"], "甲")
    c2 = make_character(client, g["id"], "乙")
    save_url = f"/api/gamemap/games/{g['id']}/boards/chapters/{ch['id']}"

    # 同一看板同一人物两个节点 → 400
    r = client.put(save_url, json={"version": 1, "nodes": [
        {"character_id": c1["id"]}, {"character_id": c1["id"], "x": 1}], "relations": []})
    assert r.status_code == 400 and r.json()["message"] == "同一看板内一个人物只能有一个节点"

    # 关系端点不在板上 → 400
    r = client.put(save_url, json={"version": 1, "nodes": [{"character_id": c1["id"]}],
                                   "relations": [{"from_character_id": c1["id"],
                                                  "to_character_id": c2["id"],
                                                  "relation_type_id": 1}]})
    assert r.status_code == 400 and r.json()["message"] == "关系两端人物必须存在于当前看板"


def test_board_save_full_replace_and_state_backfill(client):
    g = make_game(client)
    ch = make_chapter(client, g["id"])
    c1 = make_character(client, g["id"], "甲")
    c2 = make_character(client, g["id"], "乙")
    tid = type_id_by_key(client, "friend")
    save_url = f"/api/gamemap/games/{g['id']}/boards/chapters/{ch['id']}"

    # 存一版(含状态)
    client.put(save_url, json={"version": 1,
                               "nodes": [{"character_id": c1["id"], "x": 1, "y": 2}],
                               "relations": []})
    # 全量替换:c1 移除、c2 加入(无状态 → 自动补);再整体保存 c1 回板,状态不丢
    client.put(save_url, json={"version": 2, "nodes": [{"character_id": c2["id"]}], "relations": []})
    b = get_board(client, g["id"], ch["id"])
    assert {n["character_id"] for n in b["nodes"]} == {c2["id"]}
    assert len(b["states"]) == 2  # c1 状态保留 + c2 补建

    r = client.put(save_url, json={
        "version": b["version"],
        "nodes": [{"character_id": c1["id"], "x": 5, "y": 6}, {"character_id": c2["id"]}],
        "relations": [{"from_character_id": c1["id"], "to_character_id": c2["id"],
                       "relation_type_id": tid, "description": "挚友", "event_ids": [1, 2]}]})
    assert r.status_code == 200, r.text
    b = r.json()["data"]
    assert len(b["relations"]) == 1 and b["relations"][0]["event_ids"] == [1, 2]
    assert len(b["states"]) == 2  # 不重复


def test_merged_board(client):
    g = make_game(client)
    ch1 = make_chapter(client, g["id"], "一")
    ch2 = make_chapter(client, g["id"], "二")
    ch3 = make_chapter(client, g["id"], "三")
    c1 = make_character(client, g["id"], "甲", faction="朝廷")
    c2 = make_character(client, g["id"], "乙")
    tid = type_id_by_key(client, "friend")

    add_node(client, g["id"], ch1["id"], c1["id"])
    client.patch(f"/api/gamemap/games/{g['id']}/boards/chapters/{ch1['id']}/nodes/{c1['id']}",
                 json={"x": 11, "y": 12})
    client.post(f"/api/gamemap/games/{g['id']}/boards/chapters/{ch1['id']}/relations",
                json={"from_character_id": c1["id"], "to_character_id": c2["id"],
                      "relation_type_id": tid, "description": "旧识", "from_x": 0, "from_y": 0})
    add_node(client, g["id"], ch2["id"], c1["id"])
    client.patch(f"/api/gamemap/games/{g['id']}/boards/chapters/{ch2['id']}/nodes/{c1['id']}",
                 json={"x": 21, "y": 22})
    client.put(f"/api/gamemap/games/{g['id']}/characters/{c1['id']}/chapters/{ch2['id']}/state",
               json={"alias": "甲二", "alive_override": False, "faction_override": "叛军"})

    r = client.get(f"/api/gamemap/games/{g['id']}/boards/merged",
                   params={"chapter_ids": f"{ch3['id']},{ch1['id']},{ch2['id']}"})
    assert r.status_code == 200, r.text
    m = r.json()["data"]
    # 章节按 order_index 排,anchor = 最后一章
    assert [c["title"] for c in m["chapters"]] == ["一", "二", "三"]
    assert m["anchor_chapter_id"] == ch3["id"]
    # 节点去重取最新章位置
    node = {n["character_id"]: n for n in m["nodes"]}[c1["id"]]
    assert (node["x"], node["y"]) == (21, 22) and node["chapter_id"] == ch2["id"]
    # 关系保留(仅在 ch1)+ 来源章节信息
    assert len(m["relations"]) == 1
    assert m["relations"][0]["chapter_id"] == ch1["id"] and m["relations"][0]["description"] == "旧识"
    # 状态解析:覆盖 > 档案
    st = {s["character_id"]: s for s in m["states"]}[c1["id"]]
    assert st["alias"] == "甲二" and st["alive"] is False and st["faction"] == "叛军"
    # 空选集
    r = client.get(f"/api/gamemap/games/{g['id']}/boards/merged", params={"chapter_ids": "99998,99999"})
    assert r.json()["data"] == {"board_versions": {}, "chapters": [], "anchor_chapter_id": None, "nodes": [],
                                "relations": [], "characters": [], "states": []}
    # 非法参数 → 400
    r = client.get(f"/api/gamemap/games/{g['id']}/boards/merged", params={"chapter_ids": "1,abc"})
    assert r.status_code == 400


def test_node_position_patch(client):
    g = make_game(client)
    ch = make_chapter(client, g["id"])
    c = make_character(client, g["id"], "甲")
    add_node(client, g["id"], ch["id"], c["id"])
    url = f"/api/gamemap/games/{g['id']}/boards/chapters/{ch['id']}/nodes/{c['id']}"
    r = client.patch(url, json={"x": 111, "y": 222})
    assert r.status_code == 200 and r.json()["data"] == {"ok": True, "version": 3}
    node = {n["character_id"]: n for n in get_board(client, g["id"], ch["id"])["nodes"]}[c["id"]]
    assert (node["x"], node["y"]) == (111.0, 222.0)

    # 不在板上 → 404
    c2 = make_character(client, g["id"], "乙")
    r = client.patch(f"/api/gamemap/games/{g['id']}/boards/chapters/{ch['id']}/nodes/{c2['id']}",
                     json={"x": 0, "y": 0})
    assert r.status_code == 404 and r.json()["message"] == "该人物不在此章节看板上"


def test_relations_crud(client):
    g = make_game(client)
    ch = make_chapter(client, g["id"])
    c1 = make_character(client, g["id"], "甲")
    c2 = make_character(client, g["id"], "乙")
    c3 = make_character(client, g["id"], "丙")
    tid = type_id_by_key(client, "enemy")
    base = f"/api/gamemap/games/{g['id']}/boards/chapters/{ch['id']}"

    # 创建:c3 不在板 → 按给定坐标自动补节点
    r = client.post(f"{base}/relations", json={
        "from_character_id": c1["id"], "to_character_id": c3["id"],
        "relation_type_id": tid, "description": "宿敌",
        "from_x": 10, "from_y": 11, "to_x": 20, "to_y": 21})
    assert r.status_code == 200, r.text
    rel = r.json()["data"]
    assert rel["description"] == "宿敌"
    b = get_board(client, g["id"], ch["id"])
    assert len(b["nodes"]) == 2 and len(b["states"]) == 2  # 端点人物自动上板+建状态
    pos = {n["character_id"]: (n["x"], n["y"]) for n in b["nodes"]}
    assert pos[c1["id"]] == (10.0, 11.0) and pos[c3["id"]] == (20.0, 21.0)

    # 重复关系 → 409
    r = client.post(f"{base}/relations", json={
        "from_character_id": c1["id"], "to_character_id": c3["id"], "relation_type_id": tid})
    assert r.status_code == 409 and r.json()["message"] == "该关系已存在于本章看板"

    # 端点人物不存在/跨游戏 → 404
    r = client.post(f"{base}/relations", json={
        "from_character_id": c1["id"], "to_character_id": 99999, "relation_type_id": tid})
    assert r.status_code == 404 and "99999" in r.json()["message"]

    # 改描述 / 版本随写递增
    v_before = get_board(client, g["id"], ch["id"])["version"]
    r = client.patch(f"{base}/relations/{rel['id']}", json={"description": "死敌"})
    assert r.status_code == 200
    r = client.get(f"/api/gamemap/games/{g['id']}/boards/chapters/{ch['id']}")
    assert r.json()["data"]["version"] == v_before + 1
    assert [x["description"] for x in r.json()["data"]["relations"]] == ["死敌"]

    # 他板关系 → 404
    ch2 = make_chapter(client, g["id"], "二")
    assert client.patch(
        f"/api/gamemap/games/{g['id']}/boards/chapters/{ch2['id']}/relations/{rel['id']}",
        json={"description": "x"}).status_code == 404

    assert client.delete(f"{base}/relations/{rel['id']}").status_code == 200
    assert get_board(client, g["id"], ch["id"])["relations"] == []
    assert client.delete(f"{base}/relations/{rel['id']}").status_code == 404


def test_response_cache_board_write_invalidates(client):
    """读缓存命中 → 写失效 → 再读见新数据(第二次 GET 走缓存,结果一致)。"""
    g = make_game(client)
    ch = make_chapter(client, g["id"])
    c = make_character(client, g["id"], "甲")
    save_url = f"/api/gamemap/games/{g['id']}/boards/chapters/{ch['id']}"
    client.put(save_url, json={"version": 1, "nodes": [{"character_id": c["id"], "x": 1, "y": 1}],
                               "relations": []})

    b1 = get_board(client, g["id"], ch["id"])
    b2 = get_board(client, g["id"], ch["id"])  # 缓存命中
    assert b1 == b2

    # 拖动(写) → 缓存失效 → 再读到新位置
    client.patch(f"{save_url}/nodes/{c['id']}", json={"x": 99, "y": 88})
    b3 = get_board(client, g["id"], ch["id"])
    node = {n["character_id"]: n for n in b3["nodes"]}[c["id"]]
    assert (node["x"], node["y"]) == (99.0, 88.0)


# ---------- events ----------

def test_events_crud(client):
    g = make_game(client)
    ch = make_chapter(client, g["id"])
    c1 = make_character(client, g["id"], "甲")
    c2 = make_character(client, g["id"], "乙")
    base = f"/api/gamemap/chapters/{ch['id']}/events"

    assert client.get("/api/gamemap/chapters/99999/events").status_code == 404

    r = client.post(base, json={"title": "事件B", "order_index": 2, "character_ids": [c1["id"]]})
    e2 = r.json()["data"]
    r = client.post(base, json={"title": "事件A", "order_index": 1,
                                "content": "开端", "character_ids": [c1["id"], c2["id"]]})
    e1 = r.json()["data"]

    events = client.get(base).json()["data"]  # 按 order_index
    assert [e["title"] for e in events] == ["事件A", "事件B"]
    assert events[0]["character_ids"] == [c1["id"], c2["id"]]
    assert events[1]["character_ids"] == [c1["id"]]

    # 改标题/换人物
    r = client.patch(f"{base}/{e2['id']}", json={"title": "事件B改", "character_ids": [c2["id"]]})
    assert r.json()["data"]["title"] == "事件B改"
    assert r.json()["data"]["character_ids"] == [c2["id"]]

    # 跨章节访问 → 404
    ch2 = make_chapter(client, g["id"], "二")
    assert client.patch(f"/api/gamemap/chapters/{ch2['id']}/events/{e2['id']}",
                        json={"title": "x"}).status_code == 404
    assert client.delete(f"/api/gamemap/chapters/{ch2['id']}/events/{e2['id']}").status_code == 404

    assert client.delete(f"{base}/{e2['id']}").status_code == 200
    assert [e["title"] for e in client.get(base).json()["data"]] == ["事件A"]


# ---------- photos ----------

def test_photos_flow(client):
    g = make_game(client)
    ch1 = make_chapter(client, g["id"], "一")
    ch2 = make_chapter(client, g["id"], "二")
    c = make_character(client, g["id"], "甲")
    base = f"/api/gamemap/games/{g['id']}/characters/{c['id']}/photos"

    up = client.post("/api/gamemap/uploads",
                     files={"file": ("p.png", b"\x89PNG-fake", "image/png")}).json()["data"]
    att_id = up["attachment_id"]

    # 附件不存在 → 404;章节跨游戏 → 404
    assert client.post(base, json={"attachment_id": 99999}).status_code == 404
    g2 = make_game(client)
    assert client.post(f"/api/gamemap/games/{g2['id']}/characters/{c['id']}/photos",
                       json={"attachment_id": att_id}).status_code == 404  # 人物跨游戏

    r = client.post(base, json={"attachment_id": att_id, "chapter_id": ch2["id"], "caption": "战斗立绘"})
    p2 = r.json()["data"]
    assert p2["chapter_title"] == "二" and p2["chapter_order"] == 2
    assert p2["url"].startswith("/api/gamemap/files/")
    r = client.post(base, json={"attachment_id": att_id, "chapter_id": ch1["id"], "caption": "登场"})
    p1 = r.json()["data"]
    r = client.post(base, json={"attachment_id": att_id, "caption": "通用"})
    p0 = r.json()["data"]

    photos = client.get(base).json()["data"]  # 按章节顺序,无章最后
    assert [p["caption"] for p in photos] == ["登场", "战斗立绘", "通用"]

    r = client.patch(f"{base}/{p0['id']}", json={"caption": "通用改", "chapter_id": ch1["id"]})
    assert r.json()["data"]["chapter_title"] == "一" and r.json()["data"]["caption"] == "通用改"

    assert client.delete(f"{base}/{p0['id']}").status_code == 200
    assert client.delete(f"{base}/{p0['id']}").status_code == 404
    # 照片列表缓存随写失效
    assert [p["caption"] for p in client.get(base).json()["data"]] == ["登场", "战斗立绘"]


# ---------- relation types ----------

def test_relation_types_effective_and_override(client):
    g = make_game(client)
    g2 = make_game(client, "他游戏")

    # 建游戏自定义类型(name 缺省用 key;缺 key → 400 pydantic 校验)
    r = client.post("/api/gamemap/relation-types",
                    json={"game_id": g["id"], "key": "rival", "name": "对手", "color": "#FF6B00"})
    assert r.status_code == 200 and r.json()["data"]["id"] > 0
    assert client.post("/api/gamemap/relation-types", json={"name": "无key"}).status_code == 400

    # effective:本游戏 = 7 全局 + 1 自定义;他游戏不含
    mine = client.get(f"/api/gamemap/games/{g['id']}/relation-types").json()["data"]
    assert len(mine) == 8
    rival = next(t for t in mine if t["key"] == "rival")
    assert rival["game_id"] == g["id"] and rival["name"] == "对手" and rival["overridden"] is False
    other = client.get(f"/api/gamemap/games/{g2['id']}/relation-types").json()["data"]
    assert len(other) == 7 and all(t["key"] != "rival" for t in other)

    # 覆盖全局类型字段(合并语义)
    friend_id = type_id_by_key(client, "friend")
    r = client.put(f"/api/gamemap/games/{g['id']}/relation-types/{friend_id}/override",
                   json={"fields": {"name": "挚友"}})
    assert r.status_code == 200 and r.json()["data"] == {"ok": True}
    r = client.put(f"/api/gamemap/games/{g['id']}/relation-types/{friend_id}/override",
                   json={"fields": {"color": "#000000"}})
    assert r.status_code == 200
    mine = {t["key"]: t for t in client.get(f"/api/gamemap/games/{g['id']}/relation-types").json()["data"]}
    assert mine["friend"]["name"] == "挚友" and mine["friend"]["color"] == "#000000"
    assert mine["friend"]["overridden"] is True
    # 他游戏不受影响
    other = {t["key"]: t for t in client.get(f"/api/gamemap/games/{g2['id']}/relation-types").json()["data"]}
    assert other["friend"]["name"] == "朋友" and other["friend"]["overridden"] is False

    # reset 恢复继承
    r = client.put(f"/api/gamemap/games/{g['id']}/relation-types/{friend_id}/override",
                   json={"fields": {}, "reset": True})
    assert r.json()["data"] == {"ok": True, "reset": True}
    mine = {t["key"]: t for t in client.get(f"/api/gamemap/games/{g['id']}/relation-types").json()["data"]}
    assert mine["friend"]["name"] == "朋友" and mine["friend"]["overridden"] is False

    # 覆盖游戏自定义类型/不存在类型 → 404
    assert client.put(f"/api/gamemap/games/{g['id']}/relation-types/{rival['id']}/override",
                      json={"fields": {"name": "x"}}).status_code == 404
    assert client.put(f"/api/gamemap/games/{g['id']}/relation-types/99999/override",
                      json={"fields": {"name": "x"}}).status_code == 404


# ---------- search ----------

def test_search_kinds(client):
    g = make_game(client, "长月烬明", description="仙侠剧涉及澹台烬")
    ch = make_chapter(client, g["id"], "澹台烬觉醒", summary="剧情推进")
    c = make_character(client, g["id"], "澹台烬")
    c2 = make_character(client, g["id"], "叶清宇")
    add_node(client, g["id"], ch["id"], c["id"])
    client.put(f"/api/gamemap/games/{g['id']}/characters/{c['id']}/chapters/{ch['id']}/state",
               json={"alias": "魔神"})
    tid = type_id_by_key(client, "enemy")
    client.post(f"/api/gamemap/games/{g['id']}/boards/chapters/{ch['id']}/relations",
                json={"from_character_id": c["id"], "to_character_id": c2["id"],
                      "relation_type_id": tid, "description": "澹台烬的宿命纠葛"})
    client.post(f"/api/gamemap/chapters/{ch['id']}/events", json={"title": "澹台烬事件"})

    hits = client.get("/api/gamemap/search", params={"q": "澹台烬"}).json()["data"]
    kinds = {h["kind"] for h in hits}
    assert kinds == {"game", "chapter", "character", "relation", "event"}
    ch_hits = [h for h in hits if h["kind"] == "character"]
    assert ch_hits[0]["title"] == "魔神"  # 章节称呼命中,标题用 alias


def test_search_scope_and_validation(client):
    g1 = make_game(client, "游戏一")
    g2 = make_game(client, "游戏二")
    for g in (g1, g2):
        make_chapter(client, g["id"], "共同章名")
    make_character(client, g1["id"], "独有人物")

    hits = client.get("/api/gamemap/search", params={"q": "共同章名", "game_id": g1["id"]}).json()["data"]
    assert [h["game_id"] for h in hits if h["kind"] == "chapter"] == [g1["id"]]
    hits = client.get("/api/gamemap/search", params={"q": "游戏", "scope": "game",
                                                          "game_id": g2["id"]}).json()["data"]
    assert all(h["kind"] != "game" for h in hits)  # scope=game 不搜游戏本身

    # q 缺失/空 → 400(Doublog 校验处理器)
    assert client.get("/api/gamemap/search").status_code == 400
    assert client.get("/api/gamemap/search", params={"q": ""}).status_code == 400


# ---------- uploads / files ----------

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def test_upload_and_fetch(client):
    r = client.post("/api/gamemap/uploads", files={"file": ("头像.png", PNG, "image/png")})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["url"].startswith("/api/gamemap/files/") and d["url"].endswith(".png")
    assert d["attachment_id"] > 0

    fr = client.get(d["url"])
    assert fr.status_code == 200 and fr.content == PNG
    assert fr.headers["content-type"] == "image/png"
    assert "immutable" in fr.headers.get("cache-control", "")


def test_upload_whitelist(client):
    for fname, blob, ctype in [("a.txt", b"hello", "text/plain"),
                               ("b.svg", b"<svg/>", "image/svg+xml")]:
        r = client.post("/api/gamemap/uploads", files={"file": (fname, blob, ctype)})
        assert r.status_code == 400, fname
        assert r.json()["message"].startswith("仅支持图片格式"), fname


def test_files_fence(client, app):
    """越界路径/不存在/非白名单扩展 → 404 信封;目录内正常文件 → 200。"""
    # 正常文件先上传
    d = client.post("/api/gamemap/uploads", files={"file": ("ok.png", PNG, "image/png")}).json()["data"]
    assert client.get(d["url"]).status_code == 200

    # 不存在
    r = client.get("/api/gamemap/files/nothing.png")
    assert r.status_code == 404 and r.json()["message"] == "文件不存在"

    # 路径穿越(URL 编码的 ../)
    r = client.get("/api/gamemap/files/..%2F..%2F..%2Fconfig.py")
    assert r.status_code == 404
    r = client.get("/api/gamemap/files/%2e%2e%5c%2e%2e%5cconfig.py")  # 反斜杠变体
    assert r.status_code == 404

    # 目录内非白名单扩展文件(直写文件系统) → 404
    import os

    from app.gamemap.attachments import attachment_dir
    evil = os.path.join(str(attachment_dir()), "evil.svg")
    with open(evil, "wb") as f:
        f.write(b"<svg/>")
    assert client.get("/api/gamemap/files/evil.svg").status_code == 404
    os.unlink(evil)
