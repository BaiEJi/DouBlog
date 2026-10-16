"""bookmarks 导入导出：Netscape HTML（浏览器通用书签格式）+ JSON（全量备份）。

- export_html / export_json：HTML 面向浏览器互操作（自定义 DATA-* 属性带出
  状态/星标/笔记，浏览器忽略未知属性）；JSON 面向本模块全量备份（含快照）
- import_bookmarks：按内容嗅探格式（'<' 开头 → HTML，'{'/'[' 开头 → JSON）；
  文件夹链 → 分类树（同名同级复用）；URL 规范化后与库内未删除条目查重，
  重复跳过（计入 skipped）
"""
from __future__ import annotations

import html as html_mod
import json
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.shared.timeutil import now_utc, uuid7

from .fetcher import normalize_url
from .models import (
    BookmarkCategory,
    BookmarkItem,
    BookmarkItemTag,
)
from . import services


# ─── 导出 ───────────────────────────────────────────────────

def _unix_ts(d: Optional[datetime]) -> int:
    if d is None:
        return 0
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return int(d.timestamp())


def _iter_category_tree(session: Session) -> tuple[list[dict], dict[Optional[str], list[dict]]]:
    """分类树节点 + 按 parent 分组（含未挂分类条目的归宿 None）。"""
    cats = session.scalars(
        select(BookmarkCategory).order_by(BookmarkCategory.sort_order)).all()
    nodes = {c.id: {"id": c.id, "name": c.name, "parent_id": c.parent_id,
                    "created_at": c.created_at} for c in cats}
    children: dict[Optional[str], list[dict]] = {None: []}
    for c in cats:
        children.setdefault(c.parent_id if c.parent_id in nodes else None, []).append(nodes[c.id])
        children.setdefault(c.id, [])
    return [nodes[c.id] for c in cats], children


def _items_by_category(session: Session) -> dict[Optional[str], list[BookmarkItem]]:
    out: dict[Optional[str], list[BookmarkItem]] = {}
    for it in session.scalars(
            select(BookmarkItem).where(BookmarkItem.deleted_at.is_(None))
            .order_by(BookmarkItem.created_at)).all():
        out.setdefault(it.category_id, []).append(it)
    return out


def export_html(session: Session) -> str:
    _, children = _iter_category_tree(session)
    items_by_cat = _items_by_category(session)
    tag_names = services._tags_of(session, [i.id for vals in items_by_cat.values() for i in vals])

    def _link(it: BookmarkItem, indent: str) -> list[str]:
        tags = ",".join(t["name"] for t in tag_names.get(it.id, []))
        attrs = [f'HREF="{html_mod.escape(it.url, quote=True)}"',
                 f'ADD_DATE="{_unix_ts(it.created_at)}"']
        if tags:
            attrs.append(f'TAGS="{html_mod.escape(tags, quote=True)}"')
        if it.status != "unread":
            attrs.append(f'DATA-STATUS="{it.status}"')
        if it.starred:
            attrs.append("DATA-STARRED=\"1\"")
        if it.note:
            attrs.append(f'DATA-NOTE="{html_mod.escape(it.note, quote=True)}"')
        lines = [f'{indent}<DT><A {" ".join(attrs)}>{html_mod.escape(it.title)}</A>']
        if it.description:
            lines.append(f'{indent}<DD>{html_mod.escape(it.description)}')
        return lines

    def _walk(cat: dict, indent: str) -> list[str]:
        lines = [f'{indent}<DT><H3 ADD_DATE="{_unix_ts(cat["created_at"])}">'
                 f'{html_mod.escape(cat["name"])}</H3>',
                 f'{indent}<DL><p>']
        inner = indent + "    "
        for it in items_by_cat.get(cat["id"], []):
            lines += _link(it, inner)
        for kid in children.get(cat["id"], []):
            lines += _walk(kid, inner)
        lines.append(f'{indent}</DL><p>')
        return lines

    out = [
        "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
        "<!-- This is an automatically generated file. DouBookmarks export. DO NOT EDIT! -->",
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
        "<TITLE>Bookmarks</TITLE>",
        "<H1>Bookmarks</H1>",
        "<DL><p>",
    ]
    for it in items_by_cat.get(None, []):
        out += _link(it, "    ")
    for cat in children.get(None, []):
        out += _walk(cat, "    ")
    out.append("</DL><p>")
    return "\n".join(out) + "\n"


def export_json(session: Session) -> dict:
    cats, children = _iter_category_tree(session)
    items = session.scalars(
        select(BookmarkItem).where(BookmarkItem.deleted_at.is_(None))
        .order_by(BookmarkItem.created_at)).all()
    tag_map = services._tags_of(session, [i.id for i in items])
    return {
        "version": 1,
        "exported_at": now_utc().isoformat(),
        "categories": [{"id": c["id"], "name": c["name"], "parent_id": c["parent_id"]} for c in cats],
        "items": [{
            "url": i.url, "title": i.title, "description": i.description, "note": i.note,
            "site_name": i.site_name, "favicon_url": i.favicon_url,
            "category_id": i.category_id, "status": i.status, "starred": i.starred,
            "tag_names": [t["name"] for t in tag_map.get(i.id, [])],
            "created_at": services._iso(i.created_at), "read_at": services._iso(i.read_at),
            "link_status": i.link_status,
            "snapshot_md": i.snapshot_md, "snapshot_words": i.snapshot_words,
            "snapshot_at": services._iso(i.snapshot_at),
        } for i in items],
    }


# ─── 导入 ───────────────────────────────────────────────────

class _NetscapeParser(HTMLParser):
    """解析 Netscape 书签文件：H3=文件夹（按 DL 深度建父子链）、A=链接、DD=描述。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.entries: list[dict] = []
        self.folders: list[dict] = []   # {name, depth}
        self._depth = 0
        self._last: Optional[dict] = None
        self._in_h3 = False
        self._in_a = False
        self._in_dd = False
        self._h3_buf: list[str] = []
        self._a_buf: list[str] = []
        self._dd_buf: list[str] = []
        self._cur_a: dict = {}

    def _finish_dd(self):
        """Netscape 的 <DD> 没有闭合标签——描述持续到下一个标记开始。"""
        if self._in_dd:
            self._in_dd = False
            text = "".join(self._dd_buf).strip()
            if text and self._last is not None and "description" not in self._last:
                self._last["description"] = text
            self._dd_buf = []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "dl":
            self._finish_dd()
            self._depth += 1
        elif tag == "h3":
            self._finish_dd()
            self._in_h3 = True
            self._h3_buf = []
        elif tag == "a":
            self._finish_dd()
            self._in_a = True
            self._a_buf = []
            self._cur_a = {
                "url": a.get("href", "").strip(),
                "add_date": a.get("add_date", ""),
                "tags": [t for t in a.get("tags", "").split(",") if t.strip()],
                "status": a.get("data-status", "") or a.get("STATUS", ""),
                "starred": bool(a.get("data-starred") or a.get("private")),
                "note": a.get("data-note", ""),
                "depth": self._depth,
            }
        elif tag == "dd":
            self._finish_dd()
            self._in_dd = True
            self._dd_buf = []

    def handle_endtag(self, tag):
        if tag == "dl":
            self._finish_dd()
            self._depth = max(0, self._depth - 1)
        elif tag == "h3" and self._in_h3:
            self._in_h3 = False
            name = "".join(self._h3_buf).strip()
            if name:
                self.folders.append({"name": name, "depth": self._depth})
        elif tag == "a" and self._in_a:
            self._in_a = False
            entry = dict(self._cur_a)
            entry["title"] = "".join(self._a_buf).strip()
            if entry["url"]:
                self._last = entry
                self.entries.append(entry)
        elif tag == "dd" and self._in_dd:
            self._finish_dd()

    def close(self):
        super().close()
        self._finish_dd()

    def handle_data(self, data):
        if self._in_h3:
            self._h3_buf.append(data)
        elif self._in_a:
            self._a_buf.append(data)
        elif self._in_dd:
            self._dd_buf.append(data)


def _folder_chains(parser: _NetscapeParser) -> list[dict]:
    """把 (name, depth) 序列还原成父子链：每条目 category_path=[顶级,...,自身]。"""
    out = []
    stack: list[dict] = []   # 已输出的文件夹（含 path）
    for f in parser.folders:
        while stack and stack[-1]["depth"] >= f["depth"]:
            stack.pop()
        parent = stack[-1] if stack else None
        node = {"name": f["name"], "path": (parent["path"] + [f["name"]]) if parent else [f["name"]]}
        out.append(node)
        stack.append({**node, "depth": f["depth"]})
    return out


def _entry_paths(parser: _NetscapeParser) -> dict[int, list[str]]:
    """条目 → 所属文件夹路径（条目记录的是其 A 标签所在 DL 深度）。
    深度 d 的条目归属：最后一个深度 < d 的文件夹链。"""
    chains = _folder_chains(parser)
    # 文件夹深度与其条目深度对应：文件夹节点在 depth d（其 DL 内容从 d+1 起），
    # 条目 depth 即其直接父文件夹的 depth+1
    result: dict[int, list[str]] = {}
    last_by_depth: dict[int, dict] = {}
    for node, f in zip(chains, parser.folders):
        last_by_depth[f["depth"]] = node
    for idx, entry in enumerate(parser.entries):
        d = entry["depth"]
        parent = None
        for fd in range(d - 1, -1, -1):
            if fd in last_by_depth:
                parent = last_by_depth[fd]
                break
        result[idx] = parent["path"] if parent else []
    return result


def _ensure_category_chain(session: Session, path: list[str], cache: dict) -> Optional[str]:
    """按名字链建/取分类（同级同名复用）。返回末端分类 id。"""
    parent: Optional[str] = None
    for name in path:
        key = (parent, name)
        if key in cache:
            parent = cache[key]
            continue
        dup = session.scalars(
            select(BookmarkCategory.id).where(
                BookmarkCategory.name == name, BookmarkCategory.parent_id == parent)).first()
        if dup:
            cache[key] = dup
            parent = dup
        else:
            mx = session.scalar(
                select(func.max(BookmarkCategory.sort_order))
                .where(BookmarkCategory.parent_id == parent))
            cat = BookmarkCategory(id=uuid7(), name=name, parent_id=parent,
                                   sort_order=(mx or 0) + 1.0, created_at=now_utc())
            session.add(cat)
            session.flush()
            cache[key] = cat.id
            cache["_created"] = cache.get("_created", 0) + 1
            parent = cat.id
    return parent


def _iso_from_unix(ts: str) -> Optional[datetime]:
    try:
        v = int(float(ts))
        if v <= 0:
            return None
        return datetime.fromtimestamp(v, tz=timezone.utc)
    except (ValueError, OSError, OverflowError):
        return None


def _iso_from_str(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _import_one(session: Session, url: str, title: str, description: Optional[str],
                note: Optional[str], status: str, starred: bool, tags: list[str],
                category_id: Optional[str], created_at: Optional[datetime],
                read_at: Optional[datetime], counters: dict,
                extra: Optional[dict] = None) -> None:
    url = (url or "").strip()
    if not url or not url.startswith(("http://", "https://")):
        counters["invalid"] = counters.get("invalid", 0) + 1
        return
    normalized = normalize_url(url)
    exists = session.scalars(
        select(BookmarkItem.id).where(BookmarkItem.normalized_url == normalized,
                                      BookmarkItem.deleted_at.is_(None))).first()
    if exists:
        counters["skipped"] += 1
        return
    if status not in ("unread", "reading", "read", "archived"):
        status = "unread"
    now = now_utc()
    it = BookmarkItem(
        id=uuid7(), url=url, normalized_url=normalized,
        title=(title or "").strip()[:512] or url[:512],
        description=description, note=note,
        category_id=category_id, status=status, starred=bool(starred),
        read_at=read_at or (created_at if status == "read" else None),
        created_at=created_at or now, updated_at=now)
    if extra:
        it.site_name = extra.get("site_name")
        it.favicon_url = extra.get("favicon_url")
        it.link_status = extra.get("link_status") or "unknown"
        if extra.get("snapshot_md"):
            it.snapshot_md = extra["snapshot_md"]
            it.snapshot_words = int(extra.get("snapshot_words") or 0)
            it.snapshot_at = _iso_from_str(extra.get("snapshot_at") or "")
    session.add(it)
    session.flush()
    tids = services._resolve_tag_ids(session, [], tags)
    for tid in tids:
        session.add(BookmarkItemTag(item_id=it.id, tag_id=tid))
    counters["imported"] += 1


def import_bookmarks(session: Session, content: str) -> dict:
    """导入书签文件（HTML/JSON 自动嗅探）。"""
    text = content.lstrip("\ufeff \t\r\n")
    counters = {"imported": 0, "skipped": 0, "invalid": 0}
    cache: dict = {}
    if text.startswith("<"):
        parser = _NetscapeParser()
        try:
            parser.feed(text)
            parser.close()
        except Exception as e:  # noqa: BLE001 - 容忍畸形 HTML，尽量解析
            raise HTTPException(400, f"书签文件解析失败: {e}") from e
        paths = _entry_paths(parser)
        for idx, entry in enumerate(parser.entries):
            cat_id = _ensure_category_chain(session, paths.get(idx) or [], cache)
            _import_one(
                session, entry["url"], entry["title"], entry.get("description"),
                entry.get("note") or None, entry.get("status", ""), entry.get("starred", False),
                entry.get("tags", []), cat_id, _iso_from_unix(entry.get("add_date", "")),
                None, counters)
    elif text.startswith(("{", "[")):
        try:
            data = json.loads(text)
        except ValueError as e:
            raise HTTPException(400, f"JSON 解析失败: {e}") from e
        if isinstance(data, list):   # 宽容：仅条目数组
            data = {"categories": [], "items": data}
        # 文件内分类按 parent 依赖递归落到本库（名字链复用，带环守卫）
        by_fid = {c["id"]: c for c in data.get("categories") or [] if isinstance(c, dict) and c.get("id")}
        resolved: dict[str, Optional[str]] = {}

        def _resolve_cat(fid: str, seen: set) -> Optional[str]:
            if fid in resolved:
                return resolved[fid]
            if fid not in by_fid or fid in seen:
                return None
            seen.add(fid)
            c = by_fid[fid]
            parent_fid = c.get("parent_id")
            parent_cat = _resolve_cat(parent_fid, seen) if parent_fid else None
            path = (_path_of(session, parent_cat, cache) if parent_cat else []) + [c.get("name") or "未命名"]
            resolved[fid] = _ensure_category_chain(session, path, cache)
            return resolved[fid]

        for it in data.get("items") or []:
            fid = it.get("category_id") if isinstance(it, dict) else None
            cat_id = _resolve_cat(fid, set()) if fid else None
            _import_one(
                session, it.get("url", ""), it.get("title", ""), it.get("description"),
                it.get("note"), it.get("status", "unread"), bool(it.get("starred")),
                it.get("tag_names") or [], cat_id,
                _iso_from_str(it.get("created_at") or ""),
                _iso_from_str(it.get("read_at") or ""), counters, extra=it)
    else:
        raise HTTPException(400, "无法识别的书签文件格式（支持 Netscape HTML / JSON）")
    return {"imported": counters["imported"], "skipped": counters["skipped"],
            "invalid": counters.get("invalid", 0),
            "categories_created": cache.get("_created", 0)}


def _path_of(session: Session, cat_id: str, cache: dict) -> list[str]:
    """分类 id → 名字链（导入时按名重建路径）。"""
    names = []
    cur = session.get(BookmarkCategory, cat_id)
    seen = set()
    while cur is not None and cur.id not in seen:
        seen.add(cur.id)
        names.append(cur.name)
        cur = session.get(BookmarkCategory, cur.parent_id) if cur.parent_id else None
    return list(reversed(names))
