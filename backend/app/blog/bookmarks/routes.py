"""bookmarks 路由：/api/bookmarks/*（~23 端点）。

风格严格照 practice/routes.py：
- router 级 Depends(require_basic)；响应一律 api_response(...) 信封
- DB 端点 async def + 同步闭包进 run_db；写端点闭包内显式 commit
- 服务层 HTTPException(code, msg) 就地转 api_response 错误信封（_guard）
- 网络端点（meta / snapshot / check）不在 DB 池里跑：网络部分经模块池
  get_pool('bookmarks') 并发或 run_in_threadpool 单发，DB 读写各自独立 run_db
- 字面量路由（duplicates / queue / batch / stats …）先于 /{id} 注册
- import/export 混合路径：JSON 走信封；HTML 走二进制 Response
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.pools import get_pool, run_blocking
from app.shared.response import api_response

from . import fetcher, services, transfer
from .schemas import (
    BatchIn,
    CategoryCreate,
    CategoryUpdate,
    CheckIn,
    ItemCreate,
    ItemUpdate,
    TagCreate,
    TagUpdate,
)


class _EnvelopeRoute(APIRoute):
    """pydantic 校验失败 → 统一 400 错误信封（不依赖宿主 app 的全局处理器）。"""

    def get_route_handler(self):
        original = super().get_route_handler()

        async def envelope_handler(request: Request) -> Response:
            try:
                return await original(request)
            except RequestValidationError:
                return api_response(None, 400, "请求参数错误")

        return envelope_handler


router = APIRouter(prefix="/api/bookmarks", tags=["bookmarks"],
                   dependencies=[Depends(require_basic)],
                   route_class=_EnvelopeRoute)


def _guard(fn):
    """同步闭包包装：HTTPException(code, msg) → 显式错误信封（保留原始文案）。"""
    def inner():
        try:
            return fn()
        except HTTPException as e:
            return api_response(None, e.status_code, str(e.detail))
    return inner


# ---------- 元信息抓取（纯网络，不落库） ----------

@router.get("/meta")
async def fetch_meta(url: str = Query(..., min_length=1)):
    def _impl():
        try:
            return api_response(fetcher.fetch_meta(url))
        except fetcher.FetchError as e:
            return api_response(None, 502, str(e))
    return await run_blocking('bookmarks-network', _impl, workers=8)


# ---------- 分类 ----------

@router.get("/categories")
async def list_categories():
    return await run_db(_guard(lambda: api_response(services.list_categories(db.session))))


@router.post("/categories")
async def create_category(c: CategoryCreate):
    def _impl():
        out = services.create_category(db.session, c.name, c.parent_id, c.after_sort)
        db.session.commit()
        return api_response(out, 201, "创建成功")
    return await run_db(_guard(_impl))


@router.patch("/categories/{cid}")
async def update_category(cid: str, c: CategoryUpdate):
    def _impl():
        out = services.update_category(
            db.session, cid, c.name, c.parent_id,
            'parent_id' in c.model_fields_set, c.sort_order)
        db.session.commit()
        return api_response(out)
    return await run_db(_guard(_impl))


@router.delete("/categories/{cid}")
async def delete_category(cid: str):
    def _impl():
        out = services.delete_category(db.session, cid)
        db.session.commit()
        return api_response(out, 200, "已删除（子分类与书签已上提一级）")
    return await run_db(_guard(_impl))


# ---------- 标签 ----------

@router.get("/tags")
async def list_tags():
    return await run_db(_guard(lambda: api_response(services.list_tags(db.session))))


@router.post("/tags")
async def create_tag(t: TagCreate):
    def _impl():
        out = services.create_tag(db.session, t.name, t.color)
        db.session.commit()
        return api_response(out, 201, "创建成功")
    return await run_db(_guard(_impl))


@router.patch("/tags/{tid}")
async def update_tag(tid: str, t: TagUpdate):
    def _impl():
        out = services.update_tag(db.session, tid, t.name, t.color)
        db.session.commit()
        return api_response(out)
    return await run_db(_guard(_impl))


@router.delete("/tags/{tid}")
async def delete_tag(tid: str):
    def _impl():
        services.delete_tag(db.session, tid)
        db.session.commit()
        return api_response({"ok": True}, 200, "已删除")
    return await run_db(_guard(_impl))


# ---------- 条目：字面量路由（先于 /{id}） ----------

@router.get("/items/duplicates")
async def list_duplicates():
    return await run_db(_guard(lambda: api_response(services.duplicates(db.session))))


@router.get("/items/queue/next")
async def queue_next(category_id: str = "", tag_id: str = ""):
    return await run_db(_guard(lambda: api_response(
        services.queue_next(db.session, category_id=category_id, tag_id=tag_id))))


@router.post("/items/batch")
async def batch_items(b: BatchIn):
    def _impl():
        tag_ids = (services._resolve_tag_ids(db.session, [], b.tag_names)
                   if b.action == "add_tags" else None)
        out = services.batch_action(db.session, b.ids, b.action, b.value, tag_ids)
        db.session.commit()
        return api_response(out)
    return await run_db(_guard(_impl))


@router.get("/items")
async def list_items(
    q: str = "",
    status: str = "",
    category_id: str = "",
    include_descendants: bool = True,
    tag_ids: str = "",
    tags_op: str = "or",
    starred: Optional[bool] = None,
    link_status: str = "",
    trash: bool = False,
    sort: str = "created_desc",
    page: int = 1,
    page_size: int = 20,
):
    def _impl():
        return api_response(services.list_items(
            db.session, q=q, status=status, category_id=category_id,
            include_descendants=include_descendants, tag_ids=tag_ids, tags_op=tags_op,
            starred=starred, link_status=link_status, trash=trash,
            sort=sort, page=page, page_size=page_size))
    return await run_db(_guard(_impl))


@router.post("/items")
async def create_item(p: ItemCreate):
    def _impl():
        tag_ids = services._resolve_tag_ids(db.session, p.tag_ids, p.tag_names)
        out = services.create_item(db.session, p, tag_ids)
        db.session.commit()
        return api_response(out, 201, "创建成功")
    return await run_db(_guard(_impl))


@router.get("/items/{iid}")
async def get_item(iid: str):
    return await run_db(_guard(lambda: api_response(
        services.get_item(db.session, iid, with_deleted=True))))


@router.patch("/items/{iid}")
async def update_item(iid: str, p: ItemUpdate):
    def _impl():
        tag_ids = None
        if p.tag_ids is not None or p.tag_names is not None:
            tag_ids = services._resolve_tag_ids(db.session, p.tag_ids or [], p.tag_names or [])
        out = services.update_item(db.session, iid, p, tag_ids)
        db.session.commit()
        return api_response(out)
    return await run_db(_guard(_impl))


@router.delete("/items/{iid}")
async def delete_item(iid: str):
    def _impl():
        services.delete_item(db.session, iid)
        db.session.commit()
        return api_response({"ok": True}, 200, "已移入回收站")
    return await run_db(_guard(_impl))


@router.post("/items/{iid}/restore")
async def restore_item(iid: str):
    def _impl():
        services.restore_item(db.session, iid)
        db.session.commit()
        return api_response({"ok": True}, 200, "已还原")
    return await run_db(_guard(_impl))


@router.delete("/items/{iid}/purge")
async def purge_item(iid: str):
    def _impl():
        services.purge_item(db.session, iid)
        db.session.commit()
        return api_response({"ok": True}, 200, "已彻底删除")
    return await run_db(_guard(_impl))


@router.post("/items/{iid}/snapshot")
async def create_snapshot(iid: str):
    # 1) DB：取条目 URL；2) 网络：抽正文（线程池，不占 DB 池）；3) DB：落快照
    def _pick():
        it = services._get_item(db.session, iid)
        return {"id": it.id, "url": it.url}

    def _save(snap):
        def _impl():
            out = services.save_snapshot(db.session, iid, snap["content_md"],
                                         snap["words"], snap.get("final_url", ""))
            db.session.commit()
            return api_response(out, 200, "快照已保存")
        return _impl

    try:
        target = await run_db(_guard(_pick))
        if not isinstance(target, Response):   # _guard 命中错误时返回错误信封 Response
            snap = await run_blocking('bookmarks-network', fetcher.fetch_snapshot, target["url"], workers=8)
            return await run_db(_guard(_save(snap)))
        return target
    except fetcher.FetchError as e:
        return api_response(None, 502, str(e))


@router.delete("/items/{iid}/snapshot")
async def delete_snapshot(iid: str):
    def _impl():
        services.drop_snapshot(db.session, iid)
        db.session.commit()
        return api_response({"ok": True}, 200, "快照已删除")
    return await run_db(_guard(_impl))


# ---------- 死链检测 ----------

@router.post("/check")
async def check_links(b: CheckIn):
    # 网络并发走模块池（get_pool.map 保序）；DB 侧各自独立 run_db
    def _pick():
        return services.pick_check_targets(db.session, b.ids)

    def _save(results):
        def _impl():
            out = services.apply_check_results(db.session, results)
            db.session.commit()
            return api_response(out)
        return _impl

    targets = await run_db(_guard(_pick))
    if isinstance(targets, Response):
        return targets
    if not targets:
        return api_response({"checked": 0, "ok": 0, "dead": 0, "error": 0})
    urls = [t["url"] for t in targets]

    def _check_one(url: str) -> dict:
        return fetcher.check_url(url)

    # pool.map 本身是阻塞调用——包进 run_in_threadpool，不冻住事件循环
    pool = get_pool('bookmarks', workers=8)
    results_raw = await run_blocking('bookmarks-check-dispatch', lambda: list(pool.map(_check_one, urls)), workers=1)
    results = [{"id": t["id"], **r} for t, r in zip(targets, results_raw)]
    return await run_db(_guard(_save(results)))


# ---------- 统计 ----------

@router.get("/stats/overview")
async def stats_overview():
    return await run_db(_guard(lambda: api_response(services.stats_overview(db.session))))


# ---------- 导入导出 ----------

@router.post("/import")
async def import_bookmarks(file: UploadFile, dry_run: bool = False):
    try:
        chunks, total = [], 0
        while chunk := await file.read(64 * 1024):
            total += len(chunk)
            if total > transfer.IMPORT_MAX_BYTES:
                return api_response(None, 400, '书签文件不能超过 16MB')
            chunks.append(chunk)
        raw = b''.join(chunks)
        content = raw.decode("utf-8-sig", errors="replace")
    finally:
        await file.close()

    def _impl():
        if dry_run:
            return api_response(transfer.preflight_import(db.session, content))
        out = transfer.import_bookmarks(db.session, content)
        db.session.commit()
        return api_response(out, 200,
                            f"导入 {out['imported']} 条（跳过重复 {out['skipped']}）")
    return await run_db(_guard(_impl))


@router.get("/export")
async def export_bookmarks(output_format: str = "json"):
    fmt = (output_format or "json").lower()
    if fmt not in ("json", "html"):
        return api_response(None, 400, "output_format 仅支持 json/html")

    if fmt == "json":
        def _impl():
            return api_response(transfer.export_json(db.session))
        return await run_db(_guard(_impl))

    def _impl():
        html_text = transfer.export_html(db.session)
        return Response(content=html_text.encode("utf-8"), media_type="text/html; charset=utf-8",
                        headers={"Content-Disposition":
                                 'attachment; filename="bookmarks.html"'})
    return await run_db(_guard(_impl))
