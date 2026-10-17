"""bookmarks 模块测试：分类树 / 条目状态机 / 标签 / 筛选 / 批量 / 队列 /
查重 / 快照 / 死链检测 / 统计 / 导入导出 / URL 规范化与正文抽取单元测试。

网络端点（meta / snapshot / check）一律 monkeypatch fetcher，不触网。
"""
from __future__ import annotations

import pytest

from app.blog.bookmarks.fetcher import (
    count_words,
    extract_content,
    normalize_url,
)

P = "/api/bookmarks"


# ─── 单元：URL 规范化 / 正文抽取 ────────────────────────────

@pytest.mark.parametrize("raw,expect", [
    ("example.com/path", "https://example.com/path"),
    ("HTTP://Example.COM:80/a/", "http://example.com/a"),
    ("https://x.com:443/", "https://x.com/"),
    ("https://x.com/a#frag", "https://x.com/a"),
    ("https://x.com/a?utm_source=n&q=2&utm_medium=x", "https://x.com/a?q=2"),
    ("https://x.com/a/?q=2", "https://x.com/a?q=2"),
    ("mailto:a@b.c", "mailto:a@b.c"),
    ("https://X.COM/Path", "https://x.com/Path"),
])
def test_normalize_url(raw, expect):
    assert normalize_url(raw) == expect


def test_extract_content_prefers_article_and_strips_noise():
    page = """
    <html><body><nav>导航 导航</nav><script>var x = 1;</script>
    <article><h1>标题一</h1><p>第一段 hello world</p>
    <ul><li>项目甲</li><li>项目乙</li></ul>
    <p><a href="/rel">相对链接</a> and <strong>粗体</strong></p></article>
    <footer>页脚 页脚</footer></body></html>
    """
    md = extract_content(page, "https://ex.com/post/1")
    assert "# 标题一" in md
    assert "第一段" in md
    assert "- 项目甲" in md and "- 项目乙" in md
    assert "[相对链接](https://ex.com/rel)" in md
    assert "**粗体**" in md
    assert "var x" not in md and "导航" not in md and "页脚" not in md


def test_extract_content_falls_back_to_body():
    page = "<html><body><p>只有正文一句话</p></body></html>"
    md = extract_content(page, "")
    assert "只有正文一句话" in md


def test_count_words_mixed():
    assert count_words("hello 世界 abc") == 2 + 2  # 2 西文词 + 2 汉字


# ─── 认证 ───────────────────────────────────────────────────

def test_requires_auth(app):
    from fastapi.testclient import TestClient
    c = TestClient(app)
    assert c.get(f"{P}/items").status_code == 401


# ─── 分类 ───────────────────────────────────────────────────

def _mk_cat(client, name, parent_id=None, after_sort=None):
    r = client.post(f"{P}/categories", json={"name": name, "parent_id": parent_id,
                                             "after_sort": after_sort})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def test_category_crud_and_tree(client):
    a = _mk_cat(client, "工作")
    b = _mk_cat(client, "子夹", parent_id=a["id"])
    tree = client.get(f"{P}/categories").json()["data"]
    assert len(tree) == 1 and tree[0]["name"] == "工作"
    assert tree[0]["children"][0]["id"] == b["id"]
    # 改名
    r = client.patch(f"{P}/categories/{b['id']}", json={"name": "子夹2"})
    assert r.status_code == 200 and r.json()["data"]["name"] == "子夹2"
    # 同级重名 409
    assert client.post(f"{P}/categories", json={"name": "工作"}).status_code == 409


def test_category_depth_limit(client):
    l0 = _mk_cat(client, "a")
    l1 = _mk_cat(client, "b", parent_id=l0["id"])
    l2 = _mk_cat(client, "c", parent_id=l1["id"])     # 第 3 层合法
    assert client.post(f"{P}/categories", json={"name": "d", "parent_id": l2["id"]}).status_code == 400
    # 移动超层：顶层树 d>e 挂到 l1 下 → 深度超限
    d = _mk_cat(client, "d")
    _mk_cat(client, "e", parent_id=d["id"])
    r = client.patch(f"{P}/categories/{d['id']}", json={"parent_id": l1["id"]})
    assert r.status_code == 400


def test_category_move_cycle_guard(client):
    a = _mk_cat(client, "a")
    b = _mk_cat(client, "b", parent_id=a["id"])
    assert client.patch(f"{P}/categories/{a['id']}", json={"parent_id": a["id"]}).status_code == 400
    assert client.patch(f"{P}/categories/{a['id']}", json={"parent_id": b["id"]}).status_code == 400


def test_category_delete_reparents(client):
    a = _mk_cat(client, "a")
    b = _mk_cat(client, "b", parent_id=a["id"])
    item = client.post(f"{P}/items", json={"url": "https://x.com/1", "category_id": b["id"]}).json()["data"]
    r = client.delete(f"{P}/categories/{a['id']}")
    assert r.status_code == 200
    tree = client.get(f"{P}/categories").json()["data"]
    assert [c["name"] for c in tree] == ["b"]          # b 上提到顶级
    assert client.get(f"{P}/items/{item['id']}").json()["data"]["category_id"] == b["id"]


def test_category_after_sort_ordering(client):
    a = _mk_cat(client, "一")
    b = _mk_cat(client, "二")
    c = _mk_cat(client, "插中间", after_sort=a["sort_order"])
    tree = client.get(f"{P}/categories").json()["data"]
    assert [n["name"] for n in tree] == ["一", "插中间", "二"]
    assert a["sort_order"] < c["sort_order"] < b["sort_order"]


# ─── 条目 CRUD 与状态机 ─────────────────────────────────────

def _mk_item(client, url="https://x.com/1", **kw):
    r = client.post(f"{P}/items", json={"url": url, **kw})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def test_item_create_defaults(client):
    it = _mk_item(client, "https://Example.com/A/?utm_source=x&q=1")
    assert it["normalized_url"] == "https://example.com/A?q=1"
    assert it["title"] == "example.com"      # 缺省标题 = 域名
    assert it["status"] == "unread" and it["starred"] is False
    assert it["tags"] == []


def test_item_create_validates(client):
    assert client.post(f"{P}/items", json={"url": ""}).status_code == 400
    r = client.post(f"{P}/items", json={"url": "https://x.com/1", "status": "bogus"})
    assert r.status_code == 400 and "非法状态" in r.json()["message"]
    r = client.post(f"{P}/items", json={"url": "https://x.com/1", "category_id": "nope"})
    assert r.status_code == 404


def test_item_url_dedup(client):
    _mk_item(client, "https://x.com/a?utm_source=n")
    r = client.post(f"{P}/items", json={"url": "https://X.COM/a"})   # 规范化后同链
    assert r.status_code == 409 and "已存在" in r.json()["message"]


def test_item_status_transitions_set_read_at(client):
    it = _mk_item(client)
    iid = it["id"]
    r = client.patch(f"{P}/items/{iid}", json={"status": "reading"})
    assert r.json()["data"]["read_at"] is None
    r = client.patch(f"{P}/items/{iid}", json={"status": "read"})
    assert r.json()["data"]["read_at"] is not None
    r = client.patch(f"{P}/items/{iid}", json={"status": "unread"})
    assert r.json()["data"]["read_at"] is None


def test_item_update_url_rechecks_dup(client):
    a = _mk_item(client, "https://x.com/a")
    b = _mk_item(client, "https://x.com/b")
    r = client.patch(f"{P}/items/{b['id']}", json={"url": "https://x.com/a#frag"})
    assert r.status_code == 409
    r = client.patch(f"{P}/items/{b['id']}", json={"url": "https://x.com/c"})
    assert r.status_code == 200 and r.json()["data"]["normalized_url"] == "https://x.com/c"


def test_item_update_explicit_null_category(client):
    cat = _mk_cat(client, "c1")
    it = _mk_item(client, category_id=cat["id"])
    r = client.patch(f"{P}/items/{it['id']}", json={"title": "只改名"})
    assert r.json()["data"]["category_id"] == cat["id"]      # 未传字段不动
    r = client.patch(f"{P}/items/{it['id']}", json={"category_id": None})
    assert r.json()["data"]["category_id"] is None            # 显式 null = 未分类


def test_item_list_defers_heavy_fields(client):
    it = _mk_item(client, note="很长的笔记" * 100)
    lst = client.get(f"{P}/items").json()["data"]["items"][0]
    assert "note" not in lst and "snapshot_md" not in lst
    full = client.get(f"{P}/items/{it['id']}").json()["data"]
    assert full["note"] == "很长的笔记" * 100


def test_item_trash_restore_purge(client):
    it = _mk_item(client)
    iid = it["id"]
    assert client.delete(f"{P}/items/{iid}").status_code == 200
    assert client.get(f"{P}/items").json()["data"]["total"] == 0
    trash = client.get(f"{P}/items", params={"trash": 1}).json()["data"]
    assert trash["total"] == 1 and trash["items"][0]["id"] == iid
    assert client.post(f"{P}/items/{iid}/restore").status_code == 200
    assert client.get(f"{P}/items").json()["data"]["total"] == 1
    client.delete(f"{P}/items/{iid}")
    assert client.delete(f"{P}/items/{iid}/purge").status_code == 200
    assert client.get(f"{P}/items", params={"trash": 1}).json()["data"]["total"] == 0
    # 回收站里的同链旧档不阻塞新建
    it2 = _mk_item(client)
    client.delete(f"{P}/items/{it2['id']}")
    assert client.post(f"{P}/items", json={"url": "https://x.com/1"}).status_code == 201


def test_item_restore_conflict_with_new_dup(client):
    it = _mk_item(client, "https://x.com/dup")
    client.delete(f"{P}/items/{it['id']}")
    _mk_item(client, "https://x.com/dup")
    r = client.post(f"{P}/items/{it['id']}/restore")
    assert r.status_code == 409


def test_item_404(client):
    assert client.get(f"{P}/items/nope").status_code == 404
    assert client.patch(f"{P}/items/nope", json={"title": "x"}).status_code == 404


# ─── 筛选 / 排序 / 分页 ─────────────────────────────────────

@pytest.fixture
def rich_data(client):
    """2 分类（父子）+ 4 条目 + 2 标签 的固定数据集。"""
    dev = _mk_cat(client, "开发")
    sub = _mk_cat(client, "子分类", parent_id=dev["id"])
    tag = client.post(f"{P}/tags", json={"name": "go"}).json()["data"]
    a = _mk_item(client, "https://go.dev/1", title="Go 官方", category_id=sub["id"],
                 tag_names=["go"], description="Go 语言官网")
    b = _mk_item(client, "https://blog.com/2", title="博客文章", category_id=dev["id"],
                 description="一篇好文章")
    c = _mk_item(client, "https://news.com/3", title="新闻", starred=True)
    d = _mk_item(client, "https://go.dev/2", title="Go 文档", tag_names=["go", "docs"])
    client.patch(f"{P}/items/{d['id']}", json={"status": "read"})
    return {"dev": dev, "sub": sub, "tag": tag, "items": [a, b, c, d]}


def test_filter_search_and_status(client, rich_data):
    data = client.get(f"{P}/items", params={"q": "文章"}).json()["data"]
    assert data["total"] == 1 and data["items"][0]["title"] == "博客文章"
    data = client.get(f"{P}/items", params={"q": "go.dev"}).json()["data"]
    assert data["total"] == 2                       # URL 命中
    data = client.get(f"{P}/items", params={"status": "read"}).json()["data"]
    assert data["total"] == 1 and data["items"][0]["title"] == "Go 文档"


def test_filter_category_descendants(client, rich_data):
    dev, sub = rich_data["dev"], rich_data["sub"]
    assert client.get(f"{P}/items", params={"category_id": dev["id"]}).json()["data"]["total"] == 2
    assert client.get(f"{P}/items", params={"category_id": dev["id"],
                                            "include_descendants": "false"}).json()["data"]["total"] == 1
    assert client.get(f"{P}/items", params={"category_id": sub["id"]}).json()["data"]["total"] == 1


def test_filter_tags_or_and(client, rich_data):
    tid = rich_data["tag"]["id"]
    docs = client.get(f"{P}/tags").json()["data"]
    docs_id = next(t["id"] for t in docs if t["name"] == "docs")
    data = client.get(f"{P}/items", params={"tag_ids": tid}).json()["data"]
    assert data["total"] == 2
    data = client.get(f"{P}/items", params={"tag_ids": f"{tid},{docs_id}",
                                            "tags_op": "and"}).json()["data"]
    assert data["total"] == 1 and data["items"][0]["title"] == "Go 文档"
    assert client.get(f"{P}/items", params={"tag_ids": "missing"}).status_code == 404


def test_filter_starred_and_sort(client, rich_data):
    data = client.get(f"{P}/items", params={"starred": "true"}).json()["data"]
    assert data["total"] == 1 and data["items"][0]["title"] == "新闻"
    # created_asc：第一条是 Go 官方
    data = client.get(f"{P}/items", params={"sort": "created_asc", "page_size": 10}).json()["data"]
    assert data["items"][0]["title"] == "Go 官方"
    assert client.get(f"{P}/items", params={"sort": "bad"}).status_code == 400


def test_pagination(client, rich_data):
    data = client.get(f"{P}/items", params={"page": 1, "page_size": 3}).json()["data"]
    assert len(data["items"]) == 3 and data["total"] == 4 and data["page_size"] == 3
    data = client.get(f"{P}/items", params={"page": 2, "page_size": 3}).json()["data"]
    assert len(data["items"]) == 1


# ─── 标签 ───────────────────────────────────────────────────

def test_tag_crud_and_counts(client, rich_data):
    tags = {t["name"]: t for t in client.get(f"{P}/tags").json()["data"]}
    assert set(tags) == {"go", "docs"}
    assert tags["go"]["item_count"] == 2
    assert client.post(f"{P}/tags", json={"name": "go"}).status_code == 409
    r = client.patch(f"{P}/tags/{tags['docs']['id']}", json={"name": "文档"})
    assert r.status_code == 200
    assert client.patch(f"{P}/tags/{tags['docs']['id']}", json={"name": "go"}).status_code == 409
    r = client.delete(f"{P}/tags/{tags['go']['id']}")
    assert r.status_code == 200
    names = [t["name"] for t in client.get(f"{P}/tags").json()["data"]]
    assert "go" not in names
    # 条目上的关联同步消失
    it = client.get(f"{P}/items/{rich_data['items'][0]['id']}").json()["data"]
    assert it["tags"] == []


def test_item_tag_replace_on_update(client):
    t1 = client.post(f"{P}/tags", json={"name": "t1"}).json()["data"]
    it = _mk_item(client, tag_names=["t2"])
    r = client.patch(f"{P}/items/{it['id']}", json={"tag_ids": [t1["id"]]})
    assert [t["name"] for t in r.json()["data"]["tags"]] == ["t1"]
    # 不传 tags 字段 → 不动
    r = client.patch(f"{P}/items/{it['id']}", json={"title": "改名"})
    assert [t["name"] for t in r.json()["data"]["tags"]] == ["t1"]


# ─── 批量操作 ───────────────────────────────────────────────

def test_batch_actions(client, rich_data):
    ids = [x["id"] for x in rich_data["items"]]
    r = client.post(f"{P}/items/batch", json={"ids": ids, "action": "star"})
    assert r.status_code == 200 and r.json()["data"]["changed"] == 3
    r = client.post(f"{P}/items/batch", json={"ids": ids, "action": "status", "value": "read"})
    assert r.json()["data"]["changed"] == 3       # d 已是 read
    r = client.post(f"{P}/items/batch",
                    json={"ids": ids, "action": "move_category", "value": rich_data["sub"]["id"]})
    assert r.json()["data"]["changed"] == 3          # a 本就在 sub
    r = client.post(f"{P}/items/batch", json={"ids": ids[:2], "action": "add_tags",
                                              "tag_names": ["批量"]})
    assert r.status_code == 200
    it = client.get(f"{P}/items/{ids[0]}").json()["data"]
    assert "批量" in [t["name"] for t in it["tags"]]
    assert client.post(f"{P}/items/batch", json={"ids": ids, "action": "nope"}).status_code == 400
    assert client.post(f"{P}/items/batch", json={"ids": ["nope"], "action": "star"}).status_code == 404


def test_batch_delete_and_restore(client):
    a = _mk_item(client, "https://x.com/b1")
    b = _mk_item(client, "https://x.com/b2")
    client.post(f"{P}/items/batch", json={"ids": [a["id"], b["id"]], "action": "delete"})
    assert client.get(f"{P}/items").json()["data"]["total"] == 0
    client.post(f"{P}/items/batch", json={"ids": [a["id"], b["id"]], "action": "restore"})
    assert client.get(f"{P}/items").json()["data"]["total"] == 2


# ─── 阅读队列 / 查重 ────────────────────────────────────────

def test_queue_next(client, rich_data):
    dev = rich_data["dev"]
    data = client.get(f"{P}/items/queue/next").json()["data"]
    assert data["title"] == "Go 官方"              # 最早的未读
    data = client.get(f"{P}/items/queue/next", params={"category_id": dev["id"]}).json()["data"]
    assert data["title"] == "Go 官方"                 # dev 子树（含 sub）内最旧未读仍是 a
    tid = rich_data["tag"]["id"]
    data = client.get(f"{P}/items/queue/next", params={"tag_id": tid}).json()["data"]
    assert data["title"] == "Go 官方"                 # a 未读时标签命中 a
    client.patch(f"{P}/items/{rich_data['items'][0]['id']}", json={"status": "read"})
    data = client.get(f"{P}/items/queue/next", params={"category_id": dev["id"]}).json()["data"]
    assert data["title"] == "博客文章"
    # 全部读完 → null
    ids = [x["id"] for x in rich_data["items"]]
    client.post(f"{P}/items/batch", json={"ids": ids, "action": "status", "value": "read"})
    assert client.get(f"{P}/items/queue/next").json()["data"] is None


def test_duplicates_groups_by_normalized(client, app):
    # API 层创建会查重拦截——重复组来自规范化规则变化等历史数据，直插模拟
    from app.db import db
    from app.blog.bookmarks.models import BookmarkItem
    from app.shared.timeutil import now_utc, uuid7
    _mk_item(client, "https://dup.com/a?utm_source=x")
    _mk_item(client, "https://uniq.com/b")
    now = now_utc()
    with db.session() as s:
        s.add(BookmarkItem(id=uuid7(), url="https://dup.com/a", normalized_url="https://dup.com/a",
                           title="重复项", created_at=now, updated_at=now))
        s.commit()
    dups = client.get(f"{P}/items/duplicates").json()["data"]
    assert len(dups) == 1 and len(dups[0]["items"]) == 2
    assert dups[0]["normalized_url"] == "https://dup.com/a"


# ─── 元信息 / 快照 / 死链（monkeypatch 网络）────────────────

def test_meta_endpoint(client, monkeypatch):
    from app.blog.bookmarks import fetcher
    monkeypatch.setattr(fetcher, "fetch_meta",
                        lambda url: {"url": url, "title": "页面标题", "description": "描述",
                                     "site_name": "站名", "favicon_url": "https://x.com/f.ico"})
    r = client.get(f"{P}/meta", params={"url": "https://x.com/page"})
    assert r.status_code == 200 and r.json()["data"]["title"] == "页面标题"
    def boom(url):
        raise fetcher.FetchError("抓取元信息失败: 网络超时")
    monkeypatch.setattr(fetcher, "fetch_meta", boom)
    assert client.get(f"{P}/meta", params={"url": "https://x.com/page"}).status_code == 502


def test_snapshot_lifecycle(client, monkeypatch):
    from app.blog.bookmarks import fetcher
    it = _mk_item(client)
    monkeypatch.setattr(fetcher, "fetch_snapshot",
                        lambda url: {"content_md": "# 标题\n\n正文", "words": 5,
                                     "final_url": url})
    r = client.post(f"{P}/items/{it['id']}/snapshot")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["snapshot_words"] == 5 and data["snapshot_at"] and data["link_status"] == "ok"
    # 详情有快照，列表无 snapshot_md
    assert client.get(f"{P}/items/{it['id']}").json()["data"]["snapshot_md"] == "# 标题\n\n正文"
    def boom(url):
        raise fetcher.FetchError("抓取快照失败: 无法连接")
    monkeypatch.setattr(fetcher, "fetch_snapshot", boom)
    assert client.post(f"{P}/items/{it['id']}/snapshot").status_code == 502
    assert client.delete(f"{P}/items/{it['id']}/snapshot").status_code == 200
    assert client.get(f"{P}/items/{it['id']}").json()["data"]["snapshot_md"] is None


def test_snapshot_missing_item(client, monkeypatch):
    assert client.post(f"{P}/items/nope/snapshot").status_code == 404


def test_check_links_updates_status(client, monkeypatch):
    from app.blog.bookmarks import fetcher
    a = _mk_item(client, "https://ok.com/1")
    b = _mk_item(client, "https://dead.com/2")

    def fake_check(url):
        return ({"status": "ok", "code": 200} if "ok.com" in url
                else {"status": "dead", "code": 404})
    monkeypatch.setattr(fetcher, "check_url", fake_check)
    r = client.post(f"{P}/check", json={"ids": [a["id"], b["id"]]})
    assert r.status_code == 200
    data = r.json()["data"]
    assert data == {"checked": 2, "ok": 1, "dead": 1, "error": 0}
    it = client.get(f"{P}/items/{b['id']}").json()["data"]
    assert it["link_status"] == "dead" and it["link_code"] == 404 and it["last_checked_at"]
    # 按 link_status 过滤
    assert client.get(f"{P}/items", params={"link_status": "dead"}).json()["data"]["total"] == 1


def test_check_links_default_picks_unchecked(client, monkeypatch):
    from app.blog.bookmarks import fetcher
    for i in range(3):
        _mk_item(client, f"https://x.com/{i}")
    seen = []

    def fake_check(url):
        seen.append(url)
        return {"status": "ok", "code": 200}
    monkeypatch.setattr(fetcher, "check_url", fake_check)
    r = client.post(f"{P}/check", json={"ids": []})
    assert r.json()["data"]["checked"] == 3 and len(seen) == 3


# ─── 统计 ───────────────────────────────────────────────────

def test_stats_overview(client, rich_data, monkeypatch):
    from app.blog.bookmarks import fetcher
    monkeypatch.setattr(fetcher, "fetch_snapshot",
                        lambda url: {"content_md": "正文" * 60, "words": 120, "final_url": url})
    client.post(f"{P}/items/{rich_data['items'][0]['id']}/snapshot")
    s = client.get(f"{P}/stats/overview").json()["data"]
    assert s["total"] == 4
    assert s["by_status"] == {"unread": 3, "reading": 0, "read": 1, "archived": 0}
    assert s["starred"] == 1 and s["snapshots"] == 1 and s["snapshot_words"] == 120
    assert s["trash"] == 0
    names = [c["name"] for c in s["by_category"]]
    assert "开发" in names and "未分类" in names
    tag_names = [t["name"] for t in s["by_tag"]]
    assert "go" in tag_names
    domains = {d["name"]: d["value"] for d in s["domains"]}
    assert domains["go.dev"] == 2
    assert len(s["trend"]) == 30 and sum(t["count"] for t in s["trend"]) == 4


# ─── 导入导出 ───────────────────────────────────────────────

NETSCAPE_SAMPLE = """<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><A HREF="https://a.com/x" ADD_DATE="1700000000" TAGS="go,dev">A 页</A>
    <DT><H3 ADD_DATE="1700000000">工作</H3>
    <DL><p>
        <DT><A HREF="https://b.com/y" ADD_DATE="1700000001">B 页</A><DD>B 描述
        <DT><H3>子夹</H3>
        <DL><p>
            <DT><A HREF="https://c.com/z" ADD_DATE="1700000002" DATA-STATUS="read" DATA-STARRED="1">C 页</A>
        </DL><p>
    </DL><p>
</DL><p>
"""


def _import(client, content, name="bookmarks.html"):
    return client.post(f"{P}/import", files={"file": (name, content, "text/plain")})


def test_import_netscape_html(client):
    r = _import(client, NETSCAPE_SAMPLE)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["imported"] == 3 and data["skipped"] == 0 and data["categories_created"] == 2
    tree = {c["name"]: c for c in client.get(f"{P}/categories").json()["data"]}
    assert set(tree) == {"工作"}
    assert tree["工作"]["children"][0]["name"] == "子夹"
    # 条目归属与元数据
    items = {i["title"]: i for i in client.get(f"{P}/items", params={"page_size": 50}).json()["data"]["items"]}
    assert items["A 页"]["category_id"] is None
    assert items["B 页"]["category_id"] == tree["工作"]["id"]
    assert items["C 页"]["category_id"] == tree["工作"]["children"][0]["id"]
    assert items["C 页"]["status"] == "read" and items["C 页"]["starred"] is True
    assert items["B 页"]["description"] == "B 描述"
    # ADD_DATE → created_at
    assert items["A 页"]["created_at"].startswith("2023-11-14")
    # 标签建出来了
    names = {t["name"] for t in client.get(f"{P}/tags").json()["data"]}
    assert names == {"go", "dev"}
    # 重复导入 → 全跳过
    r = _import(client, NETSCAPE_SAMPLE)
    assert r.json()["data"] == {"imported": 0, "skipped": 3, "invalid": 0, "categories_created": 0}


def test_import_rejects_unknown_format(client):
    assert _import(client, "not a bookmark file").status_code == 400


def test_import_skips_non_http(client):
    r = _import(client, '<DL><p><DT><A HREF="javascript:alert(1)">x</A></DL><p>')
    assert r.status_code == 200 and r.json()["data"]["invalid"] == 1


def test_export_html_and_roundtrip(client):
    cat = _mk_cat(client, "导出夹")
    _mk_item(client, "https://exp.com/1", title="导出一", category_id=cat["id"],
             tag_names=["x"], note="备注")
    _mk_item(client, "https://exp.com/2", title="导出二", description="描述二")
    r = client.get(f"{P}/export", params={"output_format": "html"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    text = r.text
    assert "NETSCAPE-Bookmark-file-1" in text and "导出夹" in text and "https://exp.com/1" in text
    assert 'TAGS="x"' in text and "DATA-NOTE=" in text
    # 再导入同一份 → 跳过
    r2 = _import(client, text)
    assert r2.json()["data"]["imported"] == 0 and r2.json()["data"]["skipped"] == 2


def test_export_import_json_roundtrip_with_snapshot(client, monkeypatch):
    from app.blog.bookmarks import fetcher
    cat = _mk_cat(client, "一级")
    sub = _mk_cat(client, "二级", parent_id=cat["id"])
    it = _mk_item(client, "https://rt.com/1", title="往返", category_id=sub["id"],
                  note="备注", tag_names=["rt"])
    client.patch(f"{P}/items/{it['id']}", json={"status": "read"})
    monkeypatch.setattr(fetcher, "fetch_snapshot",
                        lambda url: {"content_md": "快照正文" * 30, "words": 60, "final_url": url})
    client.post(f"{P}/items/{it['id']}/snapshot")

    data = client.get(f"{P}/export", params={"output_format": "json"}).json()["data"]
    assert data["version"] == 1 and len(data["items"]) == 1
    assert data["items"][0]["snapshot_md"] == "快照正文" * 30

    # 删掉后用 JSON 恢复（快照/分类/标签/已读状态全还原）
    client.delete(f"{P}/items/{it['id']}")
    client.delete(f"{P}/items/{it['id']}/purge")
    import json as json_mod
    r = _import(client, json_mod.dumps(data, ensure_ascii=False), name="bookmarks.json")
    assert r.status_code == 200, r.text
    assert r.json()["data"]["imported"] == 1
    tree = client.get(f"{P}/categories").json()["data"]
    assert tree[0]["children"][0]["name"] == "二级"
    new = client.get(f"{P}/items", params={"q": "往返"}).json()["data"]["items"][0]
    assert new["status"] == "read" and new["category_id"] == tree[0]["children"][0]["id"]
    assert "rt" in [t["name"] for t in new["tags"]]
    full = client.get(f"{P}/items/{new['id']}").json()["data"]
    assert full["note"] == "备注" and full["snapshot_words"] == 60


def test_export_rejects_bad_format(client):
    assert client.get(f"{P}/export", params={"output_format": "yaml"}).status_code == 400
