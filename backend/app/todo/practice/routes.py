"""practice 路由：/api/todo/practice/*（docs/practice-spec.md API 全规格，~22 端点）。

风格严格照 todo/routes.py：
- router 级 Depends(require_basic)；响应一律 api_response(...) 信封
- DB 端点 async def + 同步闭包进 run_db；写端点闭包内显式 commit
- 服务层 HTTPException(code, msg) 就地转 api_response 错误信封（保住原始文案，
  Doublog 全局 404 处理器会覆盖 detail）
- POST /fetch 是纯网络调用（不落库）：async def 手动解析 JSON（错误信封统一，
  不吃 FastAPI 422），网络请求经 run_in_threadpool 执行（Starlette 内置工作
  线程，非自建线程池），不阻塞事件循环也不挤占共享 DB 池
- POST /import / GET /export 混合路径：JSON 走信封；zip 走二进制 Response
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.response import api_response

from . import fetchers, importer, services
from .schemas import (
    CodeCreate,
    CodeUpdate,
    ProblemCreate,
    ProblemUpdate,
    ReviewIn,
    SolutionCreate,
    SolutionUpdate,
    TagCreate,
    TagUpdate,
)


class _EnvelopeRoute(APIRoute):
    """R17-1：practice 端点 pydantic 校验失败（body/query）→ 统一 400 错误信封。

    router 级方案（FastAPI APIRouter 不支持 exception_handler 注册）：自定义
    route_class 在路由处理器内就地兜住 RequestValidationError，随 include_router
    传播覆盖本 router 全部端点——不依赖宿主 app 是否注册全局处理器。
    """

    def get_route_handler(self):
        original = super().get_route_handler()

        async def envelope_handler(request: Request) -> Response:
            try:
                return await original(request)
            except RequestValidationError:
                return api_response(None, 400, "请求参数错误")

        return envelope_handler


router = APIRouter(prefix="/api/todo/practice", tags=["todo-practice"],
                   dependencies=[Depends(require_basic)],
                   route_class=_EnvelopeRoute)


def _guard(fn):
    """同步闭包包装：HTTPException(code, msg) → 显式错误信封（保留原始文案）。

    异常被就地吞掉后 run_db 结束照常 rollback（等同 todo 模块语义）。
    """
    def inner():
        try:
            return fn()
        except HTTPException as e:
            return api_response(None, e.status_code, str(e.detail))
    return inner


# ---------- 题目 ----------

@router.get("/problems")
async def list_problems(
    q: str = "",
    tags: str = "",
    tags_op: str = "or",
    difficulty: str = "",
    status: str = "",
    source: str = "",
    language: str = "",
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    only_due_review: bool = False,
    sort: str = "created_desc",
    page: int = 1,
    page_size: int = 20,
):
    def _impl():
        session = db.session
        return api_response(services.list_problems(
            session, q=q, tags=tags, tags_op=tags_op, difficulty=difficulty,
            status=status, source=source, language=language,
            from_=from_, to=to, only_due_review=only_due_review,
            sort=sort, page=page, page_size=page_size))
    return await run_db(_guard(_impl))


@router.post("/problems")
async def create_problem(p: ProblemCreate):
    def _impl():
        session = db.session
        out = services.create_problem(session, p)
        session.commit()
        return api_response(out, 201, "创建成功")
    return await run_db(_guard(_impl))


@router.get("/problems/{pid}")
async def get_problem(pid: str):
    def _impl():
        return api_response(services.get_problem_detail(db.session, pid))
    return await run_db(_guard(_impl))


@router.patch("/problems/{pid}")
async def update_problem(pid: str, p: ProblemUpdate):
    def _impl():
        session = db.session
        out = services.update_problem(session, pid, p)
        session.commit()
        return api_response(out)
    return await run_db(_guard(_impl))


@router.delete("/problems/{pid}")
async def delete_problem(pid: str):
    def _impl():
        session = db.session
        services.delete_problem(session, pid)
        session.commit()
        return api_response({"ok": True}, 200, "已删除")
    return await run_db(_guard(_impl))


@router.post("/problems/{pid}/review")
async def review_problem(pid: str, body: ReviewIn):
    def _impl():
        session = db.session
        out = services.do_review(session, pid, body.result)
        session.commit()
        return api_response(out)
    return await run_db(_guard(_impl))


@router.post("/problems/{pid}/unreview")
async def unreview_problem(pid: str):
    def _impl():
        session = db.session
        out = services.unreview(session, pid)
        session.commit()
        return api_response(out)
    return await run_db(_guard(_impl))


# ---------- 解法 / 代码 ----------

@router.post("/problems/{pid}/solutions")
async def create_solution(pid: str, s: SolutionCreate):
    def _impl():
        session = db.session
        out = services.create_solution(session, pid, s)
        session.commit()
        return api_response(out, 201, "创建成功")
    return await run_db(_guard(_impl))


@router.patch("/solutions/{sid}")
async def update_solution(sid: str, s: SolutionUpdate):
    def _impl():
        session = db.session
        out = services.update_solution(session, sid, s)
        session.commit()
        return api_response(out)
    return await run_db(_guard(_impl))


@router.delete("/solutions/{sid}")
async def delete_solution(sid: str):
    def _impl():
        session = db.session
        services.delete_solution(session, sid)
        session.commit()
        return api_response({"ok": True}, 200, "已删除")
    return await run_db(_guard(_impl))


@router.post("/solutions/{sid}/codes")
async def create_code(sid: str, c: CodeCreate):
    def _impl():
        session = db.session
        out = services.create_code(session, sid, c)
        session.commit()
        return api_response(out, 201, "创建成功")
    return await run_db(_guard(_impl))


@router.patch("/codes/{cid}")
async def update_code(cid: str, c: CodeUpdate):
    def _impl():
        session = db.session
        out = services.update_code(session, cid, c)
        session.commit()
        return api_response(out)
    return await run_db(_guard(_impl))


@router.delete("/codes/{cid}")
async def delete_code(cid: str):
    def _impl():
        session = db.session
        services.delete_code(session, cid)
        session.commit()
        return api_response({"ok": True}, 200, "已删除")
    return await run_db(_guard(_impl))


# ---------- 标签 ----------

@router.get("/tags")
async def list_tags():
    def _impl():
        return api_response(services.list_tags(db.session))
    return await run_db(_guard(_impl))


@router.post("/tags")
async def create_tag(t: TagCreate):
    def _impl():
        session = db.session
        out = services.create_tag(session, t)
        session.commit()
        return api_response(out, 201, "创建成功")
    return await run_db(_guard(_impl))


@router.patch("/tags/{tid}")
async def update_tag(tid: str, t: TagUpdate):
    def _impl():
        session = db.session
        out = services.update_tag(session, tid, t)
        session.commit()
        return api_response(out)
    return await run_db(_guard(_impl))


@router.delete("/tags/{tid}")
async def delete_tag(tid: str):
    def _impl():
        session = db.session
        services.delete_tag(session, tid)
        session.commit()
        return api_response({"ok": True}, 200, "已删除")
    return await run_db(_guard(_impl))


# ---------- 一键抓题（纯网络调用，不落库）----------

_FETCH_SOURCES = ("leetcode", "luogu", "auto")


@router.post("/fetch")
async def fetch_problem(request: Request):
    """{"source": "leetcode|luogu|auto", "url"|"slug"|"source_no"} → 标准化草稿。

    手动解析 JSON（不用 body: dict 参数模型）：非 JSON/非对象/source 白名单外
    一律走 api_response 400 信封，与全局错误格式统一（P1-C，避免 FastAPI 422）。
    网络调用进线程池，不阻塞事件循环（也不占共享 DB 池）。
    """
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 - 非 JSON 载荷（缺 body/畸形 JSON）
        return api_response(None, 400, "请求体应为 JSON 对象")
    if not isinstance(body, dict):
        return api_response(None, 400, "请求体应为 JSON 对象")
    source = str(body.get("source") or "auto")
    if source not in _FETCH_SOURCES:
        return api_response(None, 400, "source 应为 leetcode、luogu 或 auto")
    ident = body.get("url") or body.get("slug") or body.get("source_no") or ""
    try:
        draft = await run_in_threadpool(fetchers.fetch_problem, source, str(ident))
    except fetchers.FetchError as e:
        return api_response(None, 400, str(e))
    return api_response(draft)


# ---------- 复习 / 统计 / 导入导出 ----------

@router.get("/review/today")
async def review_today():
    def _impl():
        return api_response(services.review_today(db.session))
    return await run_db(_guard(_impl))


@router.get("/stats/overview")
async def stats_overview():
    def _impl():
        return api_response(services.stats_overview(db.session))
    return await run_db(_guard(_impl))


@router.post("/import")
async def import_data(request: Request):
    """JSON 载荷（{problems:[...], tags:[...]}）或 multipart zip（Obsidian vault，上限 20MB）。"""
    content_type = (request.headers.get("content-type") or "").lower()
    if "multipart" in content_type:
        form = await request.form()
        upload = form.get("file")
        if upload is None or isinstance(upload, str):
            return api_response(None, 400, "缺少 zip 文件字段 file")
        # P1-A：多读 1 字节探测超限，拒绝超上限上传（不整包读入内存）
        data = await upload.read(importer.MAX_UPLOAD_SIZE + 1)
        if len(data) > importer.MAX_UPLOAD_SIZE:
            return api_response(None, 400, "文件过大（上限 20MB）")

        def _impl():
            session = db.session
            out = importer.import_md_zip(session, data)
            session.commit()
            return api_response(out)
        return await run_db(_guard(_impl))

    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001 - 非 JSON 载荷
        return api_response(None, 400, "请求体应为 JSON 或 zip 文件")

    if not isinstance(payload, dict):
        return api_response(None, 400, "请求体应为 JSON 对象")

    def _impl():
        session = db.session
        out = importer.import_json(session, payload)
        session.commit()
        return api_response(out)
    return await run_db(_guard(_impl))


@router.get("/export")
async def export_data(output_format: str = "json"):
    """R20-3：参数 format → output_format（不遮内置名；路由与取值不变）。"""
    if output_format not in ("json", "md"):
        return api_response(None, 400, "output_format 应为 json 或 md")

    def _impl_json():
        return api_response(importer.export_json(db.session))

    def _impl_md():
        data = importer.export_md_zip(db.session)
        return Response(
            content=data, media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="practice-notes.zip"'},
        )

    return await run_db(_guard(_impl_json if output_format == "json" else _impl_md))
