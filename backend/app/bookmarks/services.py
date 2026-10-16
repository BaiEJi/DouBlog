"""bookmarks 模块业务逻辑：分类树 / 条目 CRUD 与状态机 / 标签 / 查重 / 统计。

约定（同 practice）：
- 全部函数为同步（由 routes 的 run_db 闭包调用）；session = db.session
- 错误经 HTTPException(code, msg) 抛出，routes 层转 api_response 错误信封
- SQLite 未开外键强制 → 关联清理（标签关联）在删除路径显式执行（双后端一致）
- 列表查询 defer snapshot_md/note 大字段；标签批量查避免 N+1
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, defer

from app.shared.timeutil import ensure_aware, now_utc, uuid7

from .fetcher import domain_of, normalize_url
from .models import (
    BOOKMARK_STATUSES,
    LINK_STATUSES,
    MAX_CATEGORY_LEVEL,
    BookmarkCategory,
    BookmarkItem,
    BookmarkItemTag,
    BookmarkTag,
)

# 标签默认色板（orange 主色系 + 常用色），按现有标签数轮询
TAG_PALETTE = (
    "#F97316", "#6366F1", "#10B981", "#EC4899",
    "#0EA5E9", "#F59E0B", "#8B5CF6", "#EF4444",
)

SORT_OPTIONS = (
    "created_desc", "created_asc", "updated_desc",
    "title_asc", "read_desc", "checked_asc",
)


# ─── 公共小工具 ─────────────────────────────────────────────

def _check_status(status: str) -> str:
    if status not in BOOKMARK_STATUSES:
        raise HTTPException(400, f"非法状态: {status}（可选 {'/'.join(BOOKMARK_STATUSES)}）")
    return status


def _get_item(session: Session, iid: str, *, with_deleted: bool = False) -> BookmarkItem:
    it = session.get(BookmarkItem, iid)
    if it is None or (it.deleted_at is not None and not with_deleted):
        raise HTTPException(404, "书签不存在")
    return it


def _iso(v: Optional[datetime]) -> Optional[str]:
    return ensure_aware(v).isoformat() if v else None


def _tags_of(session: Session, item_ids: list[str]) -> dict[str, list[dict]]:
    """批量取条目标签（列表页避免 N+1）。"""
    if not item_ids:
        return {}
    rows = session.execute(
        select(BookmarkItemTag.item_id, BookmarkTag.id, BookmarkTag.name, BookmarkTag.color)
        .join(BookmarkTag, BookmarkTag.id == BookmarkItemTag.tag_id)
        .where(BookmarkItemTag.item_id.in_(item_ids))
        .order_by(BookmarkTag.name)
    ).all()
    out: dict[str, list[dict]] = defaultdict(list)
    for item_id, tid, name, color in rows:
        out[item_id].append({"id": tid, "name": name, "color": color})
    return out


def _item_fields(it: BookmarkItem, tags: list[dict], *, full: bool = False) -> dict:
    """ORM → JSON dict。full=False（列表）不携带 note/snapshot_md 大字段。"""
    d = {
        "id": it.id,
        "url": it.url,
        "normalized_url": it.normalized_url,
        "domain": domain_of(it.url),
        "title": it.title,
        "description": it.description,
        "site_name": it.site_name,
        "favicon_url": it.favicon_url,
        "category_id": it.category_id,
        "status": it.status,
        "starred": it.starred,
        "read_at": _iso(it.read_at),
        "link_status": it.link_status,
        "link_code": it.link_code,
        "last_checked_at": _iso(it.last_checked_at),
        "snapshot_words": it.snapshot_words,
        "snapshot_at": _iso(it.snapshot_at),
        "created_at": _iso(it.created_at),
        "updated_at": _iso(it.updated_at),
        "deleted_at": _iso(it.deleted_at),
        "tags": tags,
    }
    if full:
        d["note"] = it.note
        d["snapshot_md"] = it.snapshot_md
    return d


# ─── 分类（文件夹树）────────────────────────────────────────

def _category_level(session: Session, cat: BookmarkCategory) -> int:
    level, seen = 0, set()
    cur = cat
    while cur.parent_id:
        if cur.id in seen:
            raise HTTPException(400, "分类层级出现环，数据异常")
        seen.add(cur.id)
        level += 1
        cur = session.get(BookmarkCategory, cur.parent_id)
        if cur is None:
            break
    return level


def _descendant_ids(session: Session, cat_id: str) -> set[str]:
    """全部子孙 id（不含自身）。"""
    out, frontier = set(), [cat_id]
    while frontier:
        rows = session.scalars(
            select(BookmarkCategory.id).where(BookmarkCategory.parent_id.in_(frontier))).all()
        frontier = [r for r in rows if r not in out]
        out.update(rows)
    return out


def _subtree_height(session: Session, cat_id: str) -> int:
    """以 cat 为根的子树高度（叶子=1）。移动子树时校验目标层深用。"""
    kids = session.scalars(
        select(BookmarkCategory.id).where(BookmarkCategory.parent_id == cat_id)).all()
    return 1 + max((_subtree_height(session, k) for k in kids), default=0)


def list_categories(session: Session) -> list[dict]:
    """分类树（含直接/累计条目计数），按 sort_order 稳定排序。"""
    cats = session.scalars(
        select(BookmarkCategory).order_by(BookmarkCategory.sort_order, BookmarkCategory.created_at)).all()
    counts = dict(session.execute(
        select(BookmarkItem.category_id, func.count(BookmarkItem.id))
        .where(BookmarkItem.deleted_at.is_(None))
        .group_by(BookmarkItem.category_id)).all())
    parent_of = {c.id: c.parent_id for c in cats}
    children: dict[str, list[dict]] = defaultdict(list)
    nodes = {}
    for c in cats:
        nodes[c.id] = {
            "id": c.id, "name": c.name, "parent_id": c.parent_id,
            "sort_order": c.sort_order, "count": counts.get(c.id, 0),
            "total_count": counts.get(c.id, 0), "children": [],
        }
    roots = []
    for c in cats:
        node = nodes[c.id]
        if c.parent_id and c.parent_id in nodes:
            children[c.parent_id].append(node)
        else:
            roots.append(node)
    # 累计计数自底向上：子孙数并入祖先（叶子先行——按深度倒序）
    def _depth(cid: str) -> int:
        d, cur, seen = 0, cid, set()
        while parent_of.get(cur) and cur not in seen:
            seen.add(cur)
            cur = parent_of[cur]
            d += 1
        return d
    for node in sorted(nodes.values(), key=lambda n: -_depth(n["id"])):
        pid = parent_of.get(node["id"])
        if pid in nodes:
            nodes[pid]["total_count"] += node["total_count"]
    for pid, kids in children.items():
        nodes[pid]["children"] = kids
    return roots


def create_category(session: Session, name: str, parent_id: Optional[str],
                    after_sort: Optional[float]) -> dict:
    name = (name or "").strip()
    if not name:
        raise HTTPException(400, "分类名不能为空")
    if parent_id:
        parent = session.get(BookmarkCategory, parent_id)
        if parent is None:
            raise HTTPException(404, "父分类不存在")
        if _category_level(session, parent) >= MAX_CATEGORY_LEVEL:
            raise HTTPException(400, f"分类最多 {MAX_CATEGORY_LEVEL + 1} 层")
    dup = session.scalars(
        select(BookmarkCategory.id).where(BookmarkCategory.name == name,
                                          BookmarkCategory.parent_id == parent_id)).first()
    if dup:
        raise HTTPException(409, "同级已存在同名分类")
    if after_sort is not None:
        # 中点插入：取同级 after_sort 之后最小 sort_order
        nxt = session.scalars(
            select(func.min(BookmarkCategory.sort_order))
            .where(BookmarkCategory.parent_id == parent_id,
                   BookmarkCategory.sort_order > after_sort)).first()
        sort_order = (after_sort + nxt) / 2 if nxt is not None else after_sort + 1.0
    else:
        mx = session.scalars(
            select(func.max(BookmarkCategory.sort_order))
            .where(BookmarkCategory.parent_id == parent_id)).first()
        sort_order = (mx or 0) + 1.0
    cat = BookmarkCategory(id=uuid7(), name=name, parent_id=parent_id or None,
                           sort_order=sort_order, created_at=now_utc())
    session.add(cat)
    session.flush()
    return {"id": cat.id, "name": cat.name, "parent_id": cat.parent_id,
            "sort_order": cat.sort_order, "count": 0, "total_count": 0, "children": []}


def _get_category(session: Session, cid: str) -> BookmarkCategory:
    cat = session.get(BookmarkCategory, cid)
    if cat is None:
        raise HTTPException(404, "分类不存在")
    return cat


def update_category(session: Session, cid: str, name: Optional[str],
                    parent_id: Optional[str], has_parent: bool,
                    sort_order: Optional[float]) -> dict:
    cat = _get_category(session, cid)
    if name is not None:
        name = name.strip()
        if not name:
            raise HTTPException(400, "分类名不能为空")
        dup = session.scalars(
            select(BookmarkCategory.id)
            .where(BookmarkCategory.name == name, BookmarkCategory.parent_id == cat.parent_id,
                   BookmarkCategory.id != cid)).first()
        if dup:
            raise HTTPException(409, "同级已存在同名分类")
        cat.name = name
    if has_parent:
        new_parent = parent_id or None
        if new_parent:
            if new_parent == cid:
                raise HTTPException(400, "不能把分类移动到自己名下")
            parent = _get_category(session, new_parent)
            if new_parent in _descendant_ids(session, cid):
                raise HTTPException(400, "不能把分类移动到自己的子孙分类下")
            # 移动的是整棵子树：目标父层深 + 子树高度 - 1（根自身）不能超上限
            parent_level = _category_level(session, parent)
            height = _subtree_height(session, cid)
            if parent_level + height > MAX_CATEGORY_LEVEL:
                raise HTTPException(400, f"分类最多 {MAX_CATEGORY_LEVEL + 1} 层（该子树挂过去会超）")
        cat.parent_id = new_parent
    if sort_order is not None:
        cat.sort_order = sort_order
    session.flush()
    return {"id": cat.id, "name": cat.name, "parent_id": cat.parent_id, "sort_order": cat.sort_order}


def delete_category(session: Session, cid: str) -> dict:
    """删除分类：子孙与条目上提一级（父分类或顶级），不删任何书签。"""
    cat = _get_category(session, cid)
    children = session.scalars(
        select(BookmarkCategory).where(BookmarkCategory.parent_id == cid)).all()
    for ch in children:
        ch.parent_id = cat.parent_id
    session.execute(
        update(BookmarkItem).where(BookmarkItem.category_id == cid)
        .values(category_id=cat.parent_id))
    session.delete(cat)
    return {"ok": True, "moved_children": len(children)}


# ─── 标签 ───────────────────────────────────────────────────

def list_tags(session: Session) -> list[dict]:
    rows = session.execute(
        select(BookmarkTag, func.count(BookmarkItemTag.item_id))
        .outerjoin(BookmarkItemTag, BookmarkItemTag.tag_id == BookmarkTag.id)
        .group_by(BookmarkTag.id)
        .order_by(func.count(BookmarkItemTag.item_id).desc(), BookmarkTag.name)).all()
    return [{"id": t.id, "name": t.name, "color": t.color, "item_count": n} for t, n in rows]


def create_tag(session: Session, name: str, color: Optional[str]) -> dict:
    name = (name or "").strip()
    if not name:
        raise HTTPException(400, "标签名不能为空")
    exists = session.scalars(select(BookmarkTag).where(BookmarkTag.name == name)).first()
    if exists:
        raise HTTPException(409, "标签已存在")
    n = session.scalar(select(func.count(BookmarkTag.id))) or 0
    tag = BookmarkTag(id=uuid7(), name=name,
                      color=color or TAG_PALETTE[n % len(TAG_PALETTE)], created_at=now_utc())
    session.add(tag)
    session.flush()
    return {"id": tag.id, "name": tag.name, "color": tag.color, "item_count": 0}


def update_tag(session: Session, tid: str, name: Optional[str], color: Optional[str]) -> dict:
    tag = session.get(BookmarkTag, tid)
    if tag is None:
        raise HTTPException(404, "标签不存在")
    if name is not None:
        name = name.strip()
        if not name:
            raise HTTPException(400, "标签名不能为空")
        dup = session.scalars(select(BookmarkTag.id).where(
            BookmarkTag.name == name, BookmarkTag.id != tid)).first()
        if dup:
            raise HTTPException(409, "标签已存在")
        tag.name = name
    if color is not None:
        tag.color = color
    session.flush()
    return {"id": tag.id, "name": tag.name, "color": tag.color}


def delete_tag(session: Session, tid: str) -> dict:
    tag = session.get(BookmarkTag, tid)
    if tag is None:
        raise HTTPException(404, "标签不存在")
    session.execute(delete(BookmarkItemTag).where(BookmarkItemTag.tag_id == tid))
    session.delete(tag)
    return {"ok": True}


def _resolve_tag_ids(session: Session, tag_ids: list[str], tag_names: list[str]) -> list[str]:
    """ids 校验存在性；names 按名取/建。返回去重后的 id 列表。"""
    out = []
    for tid in dict.fromkeys(tag_ids or []):
        if session.get(BookmarkTag, tid) is None:
            raise HTTPException(404, f"标签不存在: {tid}")
        out.append(tid)
    for name in dict.fromkeys((n or "").strip() for n in (tag_names or [])):
        if not name:
            continue
        tag = session.scalars(select(BookmarkTag).where(BookmarkTag.name == name)).first()
        if tag is None:
            n = session.scalar(select(func.count(BookmarkTag.id))) or 0
            tag = BookmarkTag(id=uuid7(), name=name,
                              color=TAG_PALETTE[n % len(TAG_PALETTE)], created_at=now_utc())
            session.add(tag)
            session.flush()
        if tag.id not in out:
            out.append(tag.id)
    return out


def _set_item_tags(session: Session, item_id: str, tag_ids: list[str]) -> None:
    session.execute(delete(BookmarkItemTag).where(BookmarkItemTag.item_id == item_id))
    for tid in tag_ids:
        session.add(BookmarkItemTag(item_id=item_id, tag_id=tid))


# ─── 条目 ───────────────────────────────────────────────────

def list_items(session: Session, *, q: str = "", status: str = "", category_id: str = "",
               include_descendants: bool = True, tag_ids: str = "", tags_op: str = "or",
               starred: Optional[bool] = None, link_status: str = "", trash: bool = False,
               sort: str = "created_desc", page: int = 1, page_size: int = 20) -> dict:
    if sort not in SORT_OPTIONS:
        raise HTTPException(400, f"非法排序: {sort}（可选 {'/'.join(SORT_OPTIONS)}）")
    if tags_op not in ("and", "or"):
        raise HTTPException(400, "tags_op 仅支持 and/or")
    page = max(1, page)
    page_size = min(max(1, page_size), 100)

    stmt = select(BookmarkItem).options(
        defer(BookmarkItem.snapshot_md), defer(BookmarkItem.note))
    stmt = stmt.where(BookmarkItem.deleted_at.isnot(None) if trash
                      else BookmarkItem.deleted_at.is_(None))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(BookmarkItem.title.ilike(like),
                              BookmarkItem.url.ilike(like),
                              BookmarkItem.description.ilike(like),
                              BookmarkItem.site_name.ilike(like)))
    if status:
        _check_status(status)
        stmt = stmt.where(BookmarkItem.status == status)
    if category_id:
        ids = {category_id}
        if include_descendants:
            ids |= _descendant_ids(session, category_id)
        stmt = stmt.where(BookmarkItem.category_id.in_(ids))
    if starred is not None:
        stmt = stmt.where(BookmarkItem.starred.is_(starred))
    if link_status:
        if link_status not in LINK_STATUSES:
            raise HTTPException(400, f"非法链路状态: {link_status}")
        stmt = stmt.where(BookmarkItem.link_status == link_status)
    tids = [t for t in (tag_ids.split(",") if tag_ids else []) if t]
    if tids:
        for tid in tids:
            if session.get(BookmarkTag, tid) is None:
                raise HTTPException(404, f"标签不存在: {tid}")
        matched = select(BookmarkItemTag.item_id).where(BookmarkItemTag.tag_id.in_(tids))
        if tags_op == "or":
            stmt = stmt.where(BookmarkItem.id.in_(matched))
        else:  # and：逐标签子查询交集
            for tid in tids:
                stmt = stmt.where(BookmarkItem.id.in_(
                    select(BookmarkItemTag.item_id).where(BookmarkItemTag.tag_id == tid)))

    order = {
        "created_desc": (BookmarkItem.created_at.desc(), BookmarkItem.id.desc()),
        "created_asc": (BookmarkItem.created_at.asc(), BookmarkItem.id.asc()),
        "updated_desc": (BookmarkItem.updated_at.desc(), BookmarkItem.id.desc()),
        "title_asc": (BookmarkItem.title.asc(), BookmarkItem.id.asc()),
        "read_desc": (BookmarkItem.read_at.desc().nullslast(), BookmarkItem.id.asc()),
        "checked_asc": (BookmarkItem.last_checked_at.asc().nullsfirst(), BookmarkItem.id.asc()),
    }[sort]
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = session.scalars(stmt.order_by(*order)
                           .offset((page - 1) * page_size).limit(page_size)).all()
    tags_map = _tags_of(session, [r.id for r in rows])
    items = [_item_fields(r, tags_map.get(r.id, [])) for r in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def get_item(session: Session, iid: str, *, with_deleted: bool = False) -> dict:
    it = _get_item(session, iid, with_deleted=with_deleted)
    tags = _tags_of(session, [it.id]).get(it.id, [])
    return _item_fields(it, tags, full=True)


def _assert_url_free(session: Session, normalized: str, exclude: Optional[str] = None) -> None:
    stmt = select(BookmarkItem.id).where(BookmarkItem.normalized_url == normalized,
                                         BookmarkItem.deleted_at.is_(None))
    if exclude:
        stmt = stmt.where(BookmarkItem.id != exclude)
    dup = session.scalars(stmt).first()
    if dup:
        raise HTTPException(409, f"该书签已存在（id={dup}）")


def create_item(session: Session, p, tag_ids_resolved: Optional[list[str]] = None) -> dict:
    """创建条目。title 缺省 = 域名；status=read 时记 read_at；URL 查重 409 带 id。"""
    url = (p.url or "").strip()
    if not url:
        raise HTTPException(400, "URL 不能为空")
    normalized = normalize_url(url)
    _assert_url_free(session, normalized)
    status = _check_status(p.status)
    if p.category_id and session.get(BookmarkCategory, p.category_id) is None:
        raise HTTPException(404, "分类不存在")
    tids = tag_ids_resolved if tag_ids_resolved is not None else []
    now = now_utc()
    it = BookmarkItem(
        id=uuid7(), url=url, normalized_url=normalized,
        title=(p.title or "").strip() or domain_of(url),
        description=p.description, note=p.note, site_name=p.site_name,
        favicon_url=p.favicon_url, category_id=p.category_id or None,
        status=status, starred=p.starred,
        read_at=now if status == "read" else None,
        created_at=now, updated_at=now)
    session.add(it)
    session.flush()
    _set_item_tags(session, it.id, tids)
    session.flush()
    tags = _tags_of(session, [it.id]).get(it.id, [])
    return _item_fields(it, tags, full=True)


def update_item(session: Session, iid: str, p, tag_ids_resolved: Optional[list[str]] = None) -> dict:
    it = _get_item(session, iid)
    now = now_utc()
    # 显式传了 category_id 字段（哪怕值为 null/空串）= 移动；未传 = 不动
    if 'category_id' in p.model_fields_set:
        new_cat = (p.category_id or None)
        if new_cat and session.get(BookmarkCategory, new_cat) is None:
            raise HTTPException(404, "分类不存在")
        it.category_id = new_cat
    if p.url is not None:
        url = p.url.strip()
        if not url:
            raise HTTPException(400, "URL 不能为空")
        normalized = normalize_url(url)
        if normalized != it.normalized_url:
            _assert_url_free(session, normalized, exclude=iid)
        it.url = url
        it.normalized_url = normalized
    if p.title is not None:
        title = p.title.strip()
        if not title:
            raise HTTPException(400, "标题不能为空")
        it.title = title
    if p.description is not None:
        it.description = p.description
    if p.note is not None:
        it.note = p.note
    if p.site_name is not None:
        it.site_name = p.site_name
    if p.favicon_url is not None:
        it.favicon_url = p.favicon_url
    if p.status is not None:
        new_status = _check_status(p.status)
        if new_status != it.status:
            it.status = new_status
            it.read_at = now if new_status == "read" else None
    if p.starred is not None:
        it.starred = p.starred
    it.updated_at = now
    if tag_ids_resolved is not None:
        _set_item_tags(session, iid, tag_ids_resolved)
    session.flush()
    tags = _tags_of(session, [iid]).get(iid, [])
    return _item_fields(it, tags, full=True)


def delete_item(session: Session, iid: str) -> dict:
    """软删 → 回收站。"""
    it = _get_item(session, iid)
    it.deleted_at = now_utc()
    it.updated_at = it.deleted_at
    return {"ok": True}


def restore_item(session: Session, iid: str) -> dict:
    """回收站还原；URL 若在还原期间被新建了同链书签 → 改挂回收站副本需手工处理：
    直接拒绝（409），提示先处理现有条目。"""
    it = _get_item(session, iid, with_deleted=True)
    if it.deleted_at is None:
        raise HTTPException(400, "书签不在回收站")
    dup = session.scalars(
        select(BookmarkItem.id).where(BookmarkItem.normalized_url == it.normalized_url,
                                      BookmarkItem.deleted_at.is_(None),
                                      BookmarkItem.id != iid)).first()
    if dup:
        raise HTTPException(409, f"已存在同链接书签（id={dup}），先删除或合并其一")
    it.deleted_at = None
    it.updated_at = now_utc()
    return {"ok": True}


def purge_item(session: Session, iid: str) -> dict:
    """彻底删除（级联标签关联）。"""
    it = session.get(BookmarkItem, iid)
    if it is None:
        raise HTTPException(404, "书签不存在")
    session.execute(delete(BookmarkItemTag).where(BookmarkItemTag.item_id == iid))
    session.delete(it)
    return {"ok": True}


BATCH_ACTIONS = ("status", "star", "unstar", "move_category", "add_tags", "delete", "restore")


def batch_action(session: Session, ids: list[str], action: str,
                 value: Optional[str], tag_names_resolved: Optional[list[str]] = None) -> dict:
    if action not in BATCH_ACTIONS:
        raise HTTPException(400, f"非法批量操作: {action}（可选 {'/'.join(BATCH_ACTIONS)}）")
    now = now_utc()
    with_deleted = action in ("restore", "delete")  # restore 面向回收站；delete 双态均可
    items = []
    for iid in dict.fromkeys(ids):
        it = session.get(BookmarkItem, iid)
        if it is None:
            continue
        if it.deleted_at is not None and not with_deleted:
            continue
        items.append(it)
    if not items:
        raise HTTPException(404, "没有可操作的书签")
    touched = 0
    if action == "status":
        status = _check_status(value or "")
        for it in items:
            if it.status != status:
                it.status = status
                it.read_at = now if status == "read" else None
                it.updated_at = now
                touched += 1
    elif action == "star":
        for it in items:
            if not it.starred:
                it.starred = True
                it.updated_at = now
                touched += 1
    elif action == "unstar":
        for it in items:
            if it.starred:
                it.starred = False
                it.updated_at = now
                touched += 1
    elif action == "move_category":
        if value and session.get(BookmarkCategory, value) is None:
            raise HTTPException(404, "分类不存在")
        for it in items:
            if it.category_id != (value or None):
                it.category_id = value or None
                it.updated_at = now
                touched += 1
    elif action == "add_tags":
        tids = tag_names_resolved or []
        for it in items:
            current = {r.tag_id for r in session.scalars(
                select(BookmarkItemTag).where(BookmarkItemTag.item_id == it.id)).all()}
            for tid in tids:
                if tid not in current:
                    session.add(BookmarkItemTag(item_id=it.id, tag_id=tid))
                    touched += 1
            it.updated_at = now
    elif action == "delete":
        for it in items:
            if it.deleted_at is None:
                it.deleted_at = now
                it.updated_at = now
                touched += 1
    elif action == "restore":
        for it in items:
            if it.deleted_at is not None:
                it.deleted_at = None
                it.updated_at = now
                touched += 1
    return {"ok": True, "affected": len(items), "changed": touched}


def queue_next(session: Session, category_id: str = "", tag_id: str = "") -> Optional[dict]:
    """阅读队列下一篇：最早的未读（可按分类/标签过滤）。"""
    stmt = (select(BookmarkItem).options(defer(BookmarkItem.snapshot_md), defer(BookmarkItem.note))
            .where(BookmarkItem.deleted_at.is_(None), BookmarkItem.status == "unread"))
    if category_id:
        ids = {category_id} | _descendant_ids(session, category_id)
        stmt = stmt.where(BookmarkItem.category_id.in_(ids))
    if tag_id:
        if session.get(BookmarkTag, tag_id) is None:
            raise HTTPException(404, "标签不存在")
        stmt = stmt.where(BookmarkItem.id.in_(
            select(BookmarkItemTag.item_id).where(BookmarkItemTag.tag_id == tag_id)))
    it = session.scalars(stmt.order_by(BookmarkItem.created_at.asc(),
                                       BookmarkItem.id.asc()).limit(1)).first()
    if it is None:
        return None
    tags = _tags_of(session, [it.id]).get(it.id, [])
    return _item_fields(it, tags)


def duplicates(session: Session) -> list[dict]:
    """重复链接分组（未删除条目按 normalized_url 聚合，count>1）。"""
    rows = session.execute(
        select(BookmarkItem.normalized_url, func.count(BookmarkItem.id))
        .where(BookmarkItem.deleted_at.is_(None))
        .group_by(BookmarkItem.normalized_url)
        .having(func.count(BookmarkItem.id) > 1)).all()
    out = []
    for normalized, _n in rows:
        items = session.scalars(
            select(BookmarkItem).options(defer(BookmarkItem.snapshot_md), defer(BookmarkItem.note))
            .where(BookmarkItem.normalized_url == normalized,
                   BookmarkItem.deleted_at.is_(None))
            .order_by(BookmarkItem.created_at)).all()
        tags_map = _tags_of(session, [i.id for i in items])
        out.append({"normalized_url": normalized,
                    "items": [_item_fields(i, tags_map.get(i.id, [])) for i in items]})
    return out


# ─── 快照 / 死链检测的 DB 侧 ────────────────────────────────

def save_snapshot(session: Session, iid: str, content_md: str, words: int, final_url: str) -> dict:
    it = _get_item(session, iid)
    it.snapshot_md = content_md
    it.snapshot_words = words
    it.snapshot_at = now_utc()
    it.updated_at = it.snapshot_at
    # 快照抓通即视为可达；url 不因重定向改写（保留用户原始录入）
    it.link_status = "ok"
    it.last_checked_at = it.snapshot_at
    tags = _tags_of(session, [iid]).get(iid, [])
    return _item_fields(it, tags, full=True)


def drop_snapshot(session: Session, iid: str) -> dict:
    it = _get_item(session, iid)
    it.snapshot_md = None
    it.snapshot_words = 0
    it.snapshot_at = None
    it.updated_at = now_utc()
    return {"ok": True}


def pick_check_targets(session: Session, ids: list[str]) -> list[dict]:
    """死链检测目标：显式 ids（未删除）或全库最久未检的前 50 条。"""
    if ids:
        out = []
        for iid in dict.fromkeys(ids):
            it = session.get(BookmarkItem, iid)
            if it is not None and it.deleted_at is None:
                out.append({"id": it.id, "url": it.url})
        return out[:50]
    rows = session.execute(
        select(BookmarkItem.id, BookmarkItem.url)
        .where(BookmarkItem.deleted_at.is_(None))
        .order_by(BookmarkItem.last_checked_at.asc().nullsfirst())
        .limit(50)).all()
    return [{"id": iid, "url": url} for iid, url in rows]


def apply_check_results(session: Session, results: list[dict]) -> dict:
    now = now_utc()
    summary = {"ok": 0, "dead": 0, "error": 0}
    for r in results:
        it = session.get(BookmarkItem, r["id"])
        if it is None or it.deleted_at is not None:
            continue
        it.link_status = r["status"]
        it.link_code = r["code"]
        it.last_checked_at = now
        summary[r["status"]] = summary.get(r["status"], 0) + 1
    return {"checked": sum(summary.values()), **summary}


# ─── 统计 ───────────────────────────────────────────────────

def stats_overview(session: Session) -> dict:
    base = select(BookmarkItem).where(BookmarkItem.deleted_at.is_(None))
    total = session.scalar(select(func.count()).select_from(base.subquery())) or 0
    by_status = dict(session.execute(
        select(BookmarkItem.status, func.count(BookmarkItem.id))
        .where(BookmarkItem.deleted_at.is_(None)).group_by(BookmarkItem.status)).all())
    starred = session.scalar(select(func.count(BookmarkItem.id)).where(
        BookmarkItem.deleted_at.is_(None), BookmarkItem.starred.is_(True))) or 0
    dead = session.scalar(select(func.count(BookmarkItem.id)).where(
        BookmarkItem.deleted_at.is_(None), BookmarkItem.link_status.in_(("dead", "error")))) or 0
    snapshots = session.scalar(select(func.count(BookmarkItem.id)).where(
        BookmarkItem.deleted_at.is_(None), BookmarkItem.snapshot_at.isnot(None))) or 0
    words = session.scalar(select(func.coalesce(func.sum(BookmarkItem.snapshot_words), 0)).where(
        BookmarkItem.deleted_at.is_(None))) or 0
    trash = session.scalar(select(func.count(BookmarkItem.id)).where(
        BookmarkItem.deleted_at.isnot(None))) or 0

    by_category_rows = session.execute(
        select(BookmarkItem.category_id, func.count(BookmarkItem.id))
        .where(BookmarkItem.deleted_at.is_(None)).group_by(BookmarkItem.category_id)).all()
    cat_names = {c.id: c.name for c in session.scalars(select(BookmarkCategory)).all()}
    by_category = [{"id": cid or None, "name": (cat_names.get(cid) or "未分类"), "value": n}
                   for cid, n in sorted(by_category_rows, key=lambda r: -r[1])]
    by_tag = [{"id": t.id, "name": t.name, "color": t.color, "value": n} for t, n in session.execute(
        select(BookmarkTag, func.count(BookmarkItemTag.item_id))
        .join(BookmarkItemTag, BookmarkItemTag.tag_id == BookmarkTag.id)
        .group_by(BookmarkTag.id).order_by(func.count(BookmarkItemTag.item_id).desc())
        .limit(10)).all()]
    domain_counts: dict[str, int] = defaultdict(int)
    for (u,) in session.execute(select(BookmarkItem.url).where(BookmarkItem.deleted_at.is_(None))):
        domain_counts[domain_of(u)] += 1
    domains = [{"name": d, "value": n} for d, n in
               sorted(domain_counts.items(), key=lambda kv: -kv[1])[:10]]

    since = now_utc() - timedelta(days=29)
    trend_rows = session.execute(
        select(func.date(BookmarkItem.created_at), func.count(BookmarkItem.id))
        .where(BookmarkItem.deleted_at.is_(None), BookmarkItem.created_at >= since)
        .group_by(func.date(BookmarkItem.created_at))).all()
    by_day = {str(d): n for d, n in trend_rows}
    trend = []
    cur = since.date()
    for i in range(30):
        day = str(cur + timedelta(days=i))
        trend.append({"date": day, "count": by_day.get(day, 0)})

    return {
        "total": total,
        "by_status": {s: by_status.get(s, 0) for s in BOOKMARK_STATUSES},
        "starred": starred, "dead": dead, "snapshots": snapshots,
        "snapshot_words": int(words), "trash": trash,
        "by_category": by_category, "by_tag": by_tag, "domains": domains,
        "trend": trend,
    }
