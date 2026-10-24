"""刷题子模块业务逻辑：题目/解法/代码/标签 CRUD、多维筛选、复习状态机、统计。

约定：
- 全部函数为同步（由 routes 的 run_db 闭包调用）；session = db.session
- 错误经 HTTPException(code, msg) 抛出，routes 层转 api_response 错误信封
- SQLite 未开外键强制 → 子行级联（解法/代码/复习/关联）在删除路径显式执行
- 「今天」一律 local_today(todo 设置的时区)（docs/practice-spec.md 复习算法）
"""
from __future__ import annotations

import hashlib
import json

from datetime import date, datetime, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, defer
from sqlalchemy.engine import Row

from app.todo.services import get_settings

from app.shared.timeutil import ensure_aware, local_day_bounds_utc, local_today, now_utc, uuid7
from .models import (
    PROBLEM_SOURCES,
    PROBLEM_STATUSES,
    SOLUTION_LANGUAGES,
    PracticeProblem,
    PracticeProblemTag,
    PracticeReview,
    PracticeSolution,
    PracticeSolutionCode,
    PracticeTag,
    PracticeMutation,
)
from .schemas import (
    CodeCreate,
    CodeUpdate,
    ProblemCreate,
    ProblemUpdate,
    ProblemAggregateUpdate,
    ProblemOut,
    ProblemSummaryOut,
    SolutionCreate,
    SolutionUpdate,
    TagCreate,
    TagUpdate,
)

# 复习间隔档位（天）——档位值即成员值，不存下标（docs/practice-spec.md）
INTERVALS: tuple[int, ...] = (1, 2, 4, 7, 15, 30, 60, 120)


def clamp_interval_days(value: int) -> int:
    """间隔档位白名单 clamp：非法/越界值就近取最近合法档（第 6 轮-2，不回 0 档）。

    导入（importer）与打卡（do_review）共用：数据来源（异构 JSON/手工改库）
    不可信时，就近取档比硬回第 0 档更贴近原值语义（如 3 → 2 而非 1、200 → 120）。
    """
    if value in INTERVALS:
        return value
    return min(INTERVALS, key=lambda x: abs(x - value))

# 标签默认色板（indigo 主色系 + 常用色），按现有标签数轮询
TAG_PALETTE = (
    "#6366F1", "#8B5CF6", "#EC4899", "#F59E0B",
    "#10B981", "#06B6D4", "#3B82F6", "#EF4444",
)

SORT_OPTIONS = ("created_desc", "solved_desc", "difficulty_asc", "review_asc")

# 列表DTO确实消费的12列；正文已经由既有路径排除，Core投影再避免ORM状态装配。
_SUMMARY_COLUMNS = (
    PracticeProblem.id, PracticeProblem.source, PracticeProblem.source_no,
    PracticeProblem.title, PracticeProblem.difficulty, PracticeProblem.url,
    PracticeProblem.status, PracticeProblem.first_solved_at, PracticeProblem.last_reviewed_at,
    PracticeProblem.revision, PracticeProblem.created_at, PracticeProblem.updated_at,
)


# ─── 公共小工具 ──────────────────────────────────────────

def _tz(session: Session) -> str:
    return get_settings(session)["timezone"]


def _today(session: Session) -> date:
    return local_today(_tz(session))


def _check_source(source: str) -> str:
    if source not in PROBLEM_SOURCES:
        raise HTTPException(400, f"非法来源: {source}（可选 {'/'.join(PROBLEM_SOURCES)}）")
    return source


def _check_status(status: str) -> str:
    if status not in PROBLEM_STATUSES:
        raise HTTPException(400, f"非法状态: {status}（可选 {'/'.join(PROBLEM_STATUSES)}）")
    return status


def _check_language(language: str) -> str:
    if language not in SOLUTION_LANGUAGES:
        raise HTTPException(400, f"非法语言: {language}（可选 {'/'.join(SOLUTION_LANGUAGES)}）")
    return language


def _get_problem(session: Session, pid: str) -> PracticeProblem:
    p = session.get(PracticeProblem, pid)
    if p is None or p.deleted_at is not None:
        raise HTTPException(404, "题目不存在")
    return p


def _lock_problem(session: Session, pid: str) -> None:
    """先取得题目写锁；SQLite 与 PG 的旧子行 API 也参与聚合编辑的事务边界。"""
    result = session.execute(update(PracticeProblem).where(
        PracticeProblem.id == pid, PracticeProblem.deleted_at.is_(None)
    ).values(revision=PracticeProblem.revision).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        raise HTTPException(404, "题目不存在")


def _get_solution(session: Session, sid: str) -> PracticeSolution:
    s = session.get(PracticeSolution, sid)
    if s is None:
        raise HTTPException(404, "解法不存在")
    p = session.get(PracticeProblem, s.problem_id)
    if p is None or p.deleted_at is not None:
        raise HTTPException(404, "解法不存在")
    return s


def _get_code(session: Session, cid: str) -> tuple[PracticeSolutionCode, PracticeSolution]:
    c = session.get(PracticeSolutionCode, cid)
    if c is None:
        raise HTTPException(404, "代码不存在")
    sol = session.get(PracticeSolution, c.solution_id)
    if sol is None:
        raise HTTPException(404, "代码不存在")
    p = session.get(PracticeProblem, sol.problem_id)
    if p is None or p.deleted_at is not None:
        raise HTTPException(404, "代码不存在")
    return c, sol


def _problem_fields(p: PracticeProblem) -> dict:
    """ORM → 原生 JSON dict（键与 schemas.ProblemOut 一致）。"""
    return ProblemOut.model_validate(p).model_dump(mode="json")


def _summary_fields(p: PracticeProblem | Row) -> dict:
    """Core Row或ORM → 列表摘要dict（键与schemas.ProblemSummaryOut一致）。

    列表只投影小字段，review_today仍defer description_md/pitfall_md（Text大字段），
    此处不得触碰这两个属性（否则逐行惰性加载退化成 N+1）；键补 None 保持响应形状。
    """
    d = ProblemSummaryOut.model_validate(p._mapping if isinstance(p, Row) else p).model_dump(mode="json", exclude={
        "tags", "solution_count", "code_languages", "next_review",
    })  # 四个聚合字段由_build_summaries填写，不先序列化其默认值再覆盖。
    d["description_md"] = None  # 前端列表不消费，详情端点才返回
    d["pitfall_md"] = None
    return d


def _iso(v: Optional[datetime]) -> Optional[str]:
    """datetime → isoformat（naive 视为 UTC，恒带 +00:00；与 ProblemOut 校验器一致）。"""
    return ensure_aware(v).isoformat() if v else None


def _code_fields(c: PracticeSolutionCode) -> dict:
    return {"id": c.id, "solution_id": c.solution_id, "language": c.language,
            "code": c.code, "note": c.note}


def _solution_fields(s: PracticeSolution,
                     codes: list[PracticeSolutionCode]) -> dict:
    return {
        "id": s.id, "problem_id": s.problem_id, "name": s.name,
        "approach_md": s.approach_md, "time_complexity": s.time_complexity,
        "space_complexity": s.space_complexity, "is_preferred": s.is_preferred,
        "sort_order": s.sort_order, "revision": s.revision,
        "created_at": _iso(s.created_at), "updated_at": _iso(s.updated_at),
        "codes": [_code_fields(c) for c in codes],
    }


def _tag_briefs(tags: list[PracticeTag]) -> list[dict]:
    """已加载标签对象 → 摘要列表（排序与 _tags_of 的 JOIN 排序一致：sort_order, name）。"""
    return [{"id": t.id, "name": t.name, "color": t.color}
            for t in sorted(tags, key=lambda t: (t.sort_order, t.name))]


def _problem_detail_fields(problem: PracticeProblem,
                           solutions: list[PracticeSolution],
                           codes_by_sid: dict[str, list[PracticeSolutionCode]],
                           tags: list[dict],
                           next_review: Optional[PracticeReview]) -> dict:
    """纯拼装详情响应（R16-2）：入参全为已加载 ORM 对象/现成摘要——create/update
    尾部直构响应不再回读 get_problem_detail，省去 4-5 条回读 SELECT。"""
    detail = _problem_fields(problem)
    detail["tags"] = tags
    detail["solutions"] = [
        _solution_fields(s, codes_by_sid.get(s.id, [])) for s in solutions]
    detail["next_review"] = _review_brief(next_review) if next_review else None
    return detail


# ─── 标签 ────────────────────────────────────────────────

def serialize_tag(t: PracticeTag, problem_count: int = 0) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "color": t.color,
        "sort_order": t.sort_order,
        "problem_count": problem_count,
        "created_at": _iso(t.created_at),
    }


def _tag_count(session: Session) -> int:
    """现有标签总数（新标签缺省色板轮询 / sort_order 递增共用）。"""
    return session.scalar(select(func.count()).select_from(PracticeTag)) or 0


def list_tags(session: Session) -> list[dict]:
    counts: dict[str, int] = dict(
        session.execute(
            select(PracticeProblemTag.tag_id, func.count())
            .join(PracticeProblem, PracticeProblem.id == PracticeProblemTag.problem_id)
            .where(PracticeProblem.deleted_at.is_(None))
            .group_by(PracticeProblemTag.tag_id)
        ).all()
    )
    rows = session.scalars(
        select(PracticeTag).order_by(PracticeTag.sort_order, PracticeTag.created_at)
    ).all()
    return [serialize_tag(t, counts.get(t.id, 0)) for t in rows]


def get_or_create_tag(session: Session, name: str,
                      color: Optional[str] = None) -> Optional[PracticeTag]:
    """按名取标签，无则建（一键抓题→落库、导入通道）。

    - 第 6 轮-5：strip 后空名返回 None（调用方跳过）；超长截断到 100（name 列宽）
    - 第 6 轮-1：竞态撞 name 唯一约束时在嵌套 savepoint 内重试——只回滚
      savepoint，不污染外层事务（原 session.rollback() 会连带丢掉外层
      未提交的题目/关联行）
    """
    name = name.strip()
    if not name:
        return None
    name = name[:100]
    tag = session.scalar(select(PracticeTag).where(PracticeTag.name == name))
    if tag is not None:
        return tag
    n = _tag_count(session)
    tag = PracticeTag(
        id=uuid7(), name=name,
        color=color or TAG_PALETTE[n % len(TAG_PALETTE)],
        sort_order=n, created_at=now_utc(),
    )
    try:
        # 注意 add 必须在 savepoint 内：begin_nested() 建立 SAVEPOINT 前会先
        # flush 既有 pending 对象，若提前 add，INSERT 会落在 savepoint 外，
        # 失败时同样污染外层事务
        with session.begin_nested():
            session.add(tag)
            session.flush()
    except IntegrityError:
        # 并发竞态：同名标签已被其他请求抢先提交（name 唯一约束）→
        # savepoint 已随异常回滚（外层事务完好），重查复用已存在行
        existed = session.scalar(select(PracticeTag).where(PracticeTag.name == name))
        if existed is None:
            raise
        return existed
    return tag


def create_tag(session: Session, data: TagCreate) -> dict:
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "标签名不能为空")
    if session.scalar(select(PracticeTag).where(PracticeTag.name == name)) is not None:
        raise HTTPException(400, "标签已存在")
    n = _tag_count(session)
    tag = PracticeTag(
        id=uuid7(), name=name,
        color=data.color or TAG_PALETTE[n % len(TAG_PALETTE)],
        sort_order=data.sort_order if data.sort_order is not None else n,
        created_at=now_utc(),
    )
    session.add(tag)
    try:
        session.flush()
    except IntegrityError:
        # 校验与写入之间被并发抢先 → 400（而非裸 500）
        session.rollback()
        raise HTTPException(400, "标签已存在") from None
    return serialize_tag(tag)


def update_tag(session: Session, tag_id: str, data: TagUpdate) -> dict:
    tag = session.get(PracticeTag, tag_id)
    if tag is None:
        raise HTTPException(404, "标签不存在")
    if data.name is not None:
        name = data.name.strip()
        if not name:
            raise HTTPException(400, "标签名不能为空")
        dup = session.scalar(select(PracticeTag).where(PracticeTag.name == name))
        if dup is not None and dup.id != tag_id:
            raise HTTPException(400, "标签已存在")
        tag.name = name
    if data.color is not None:
        tag.color = data.color
    if data.sort_order is not None:
        tag.sort_order = data.sort_order
    try:
        session.flush()
    except IntegrityError:
        # 撞名竞态：重名预检与写入之间被并发抢先（name 唯一约束）→
        # 整体回滚改名并 400（而非裸 500）；与 create_tag 竞态分支同语义
        session.rollback()
        raise HTTPException(400, "标签名已存在") from None
    count = session.scalar(
        select(func.count()).select_from(PracticeProblemTag)
        .join(PracticeProblem, PracticeProblem.id == PracticeProblemTag.problem_id)
        .where(PracticeProblemTag.tag_id == tag_id, PracticeProblem.deleted_at.is_(None))
    ) or 0
    return serialize_tag(tag, count)


def delete_tag(session: Session, tag_id: str) -> None:
    """删除标签并解除全部题目关联（关联表显式清，双后端一致）。"""
    tag = session.get(PracticeTag, tag_id)
    if tag is None:
        raise HTTPException(404, "标签不存在")
    session.execute(delete(PracticeProblemTag).where(PracticeProblemTag.tag_id == tag_id))
    session.delete(tag)
    session.flush()


# ─── 题目 CRUD ───────────────────────────────────────────

def _attach_tags(session: Session, problem: PracticeProblem,
                 tag_ids: list[str], tag_names: list[str]) -> list[PracticeTag]:
    """挂标签并返回解析出的标签对象（R16-2：create 尾部直构响应用，避免回查）。"""
    resolved: list[PracticeTag] = []
    for tid in tag_ids:
        tag = session.get(PracticeTag, tid)
        if tag is None:
            raise HTTPException(400, f"标签不存在: {tid}")
        if tag not in resolved:
            resolved.append(tag)
    for name in tag_names:
        tag = get_or_create_tag(session, name)  # 空名返回 None（跳过）
        if tag is not None:
            resolved.append(tag)
    # tag_names 可能解析出与 tag_ids/彼此相同的 id → 去重（关联表 (problem,tag) 唯一；
    # 同一 session 的同主键恒为同一实例，按对象身份去重即可）
    resolved = list(dict.fromkeys(resolved))
    for tag in resolved:
        session.add(PracticeProblemTag(problem_id=problem.id, tag_id=tag.id))
    session.flush()
    return resolved


def _create_solution_rows(
    session: Session, problem: PracticeProblem, solutions: list[SolutionCreate]
) -> list[tuple[PracticeSolution, list[PracticeSolutionCode]]]:
    base = session.scalar(
        select(func.max(PracticeSolution.sort_order))
        .where(PracticeSolution.problem_id == problem.id)
    ) or 0.0
    return [_create_solution(session, problem.id, s, sort_order=base + 1.0 + i)
            for i, s in enumerate(solutions)]


def create_problem(session: Session, data: ProblemCreate) -> dict:
    if data.mutation_id:
        receipt = session.get(PracticeMutation, data.mutation_id)
        if receipt:
            if receipt.fingerprint != create_fingerprint(data):
                raise HTTPException(409, 'mutation_id 已被其他内容使用')
            return receipt.result
    _check_source(data.source)
    _check_status(data.status)
    title = data.title.strip()
    if not title:
        # R13-2：schema 的 min_length=1 拦不住纯空白标题
        raise HTTPException(400, "标题不能为空")
    now = now_utc()
    solved = data.status in ("solved", "reviewing", "mastered")
    problem = PracticeProblem(
        id=uuid7(),
        source=data.source,
        source_no=((data.source_no or "").strip() or None),  # R13-1：空白题号归一为 None
        title=title,
        difficulty=data.difficulty,
        url=data.url,
        description_md=data.description_md,
        pitfall_md=data.pitfall_md,
        status=data.status,
        first_solved_at=(data.first_solved_at if data.first_solved_at
                         else (_today(session) if solved else None)),
        revision=1, created_at=now, updated_at=now,
    )
    session.add(problem)
    session.flush()
    tags: list[PracticeTag] = []
    if data.tag_ids or data.tag_names:
        tags = _attach_tags(session, problem, data.tag_ids, data.tag_names)
    solution_rows: list[tuple[PracticeSolution, list[PracticeSolutionCode]]] = []
    if data.solutions:
        solution_rows = _create_solution_rows(session, problem, data.solutions)
    nr = None
    if data.status == "reviewing":
        # 直接以复习态建题 = 加入复习（首条 pending 行）
        nr = _create_first_pending(session, problem)
    # R16-2：响应由本次新建的 ORM 对象直构（不回读 detail，省 4 条 SELECT）
    codes_by_sid = {sol.id: codes for sol, codes in solution_rows}
    result = _problem_detail_fields(
        problem, [sol for sol, _ in solution_rows], codes_by_sid,
        _tag_briefs(tags), nr)
    if data.mutation_id:
        result['client_ids'] = {'solutions': {}, 'codes': {}}
        for source, (solution, codes) in zip(data.solutions, solution_rows):
            if source.client_id:
                result['client_ids']['solutions'][source.client_id] = solution.id
            for code_source, code in zip(source.codes, codes):
                if code_source.client_id:
                    result['client_ids']['codes'][code_source.client_id] = code.id
        session.add(PracticeMutation(mutation_id=data.mutation_id, problem_id=problem.id,
            fingerprint=create_fingerprint(data), result=result, created_at=now))
    return result


def create_fingerprint(data):
    return hashlib.sha256(json.dumps({'operation': 'create', **data.model_dump(mode='json')},
        sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def update_problem(session: Session, pid: str, data: ProblemUpdate) -> dict:
    _lock_problem(session, pid)
    problem = _get_problem(session, pid)
    if data.revision != problem.revision:
        raise HTTPException(409, "数据已被修改，请刷新后重试")
    old_status = problem.status
    if data.source is not None:
        _check_source(data.source)
        problem.source = data.source
    if data.status is not None:
        _check_status(data.status)
        problem.status = data.status
    if data.title is not None:
        title = data.title.strip()
        if not title:
            raise HTTPException(400, "标题不能为空")  # R13-2：纯空白标题拒绝
        problem.title = title
    if data.source_no is not None:
        problem.source_no = ((data.source_no or "").strip() or None)  # R13-1
    if data.difficulty is not None:
        problem.difficulty = data.difficulty
    if data.url is not None:
        problem.url = data.url
    if data.description_md is not None:
        problem.description_md = data.description_md
    if data.pitfall_md is not None:
        problem.pitfall_md = data.pitfall_md
    if data.first_solved_at is not None:
        problem.first_solved_at = data.first_solved_at
    if problem.status in ("solved", "reviewing", "mastered") and problem.first_solved_at is None:
        problem.first_solved_at = _today(session)
    # 复习态与 pending 行保持一致（不变量：status=reviewing ⟺ 存在 pending 行）
    nr: Optional[PracticeReview] = None
    if data.status == "reviewing" and old_status != "reviewing":
        nr = _next_review_row(session, pid)
        if nr is None:
            nr = _create_first_pending(session, problem)
    elif data.status is not None and data.status != "reviewing" and old_status == "reviewing":
        for r in session.scalars(select(PracticeReview).where(
                PracticeReview.problem_id == pid, PracticeReview.status == "pending")):
            r.status = "cancelled"
    # R12-1：乐观锁双保险——revision 推进改为带 WHERE revision 条件的原子
    # UPDATE：上方 Python 比对只是快速路径，比对到写入之间被并发抢先提交时
    # rowcount=0 → 409（同事务内已 autoflush 的字段改动随 run_db 一并回滚）。
    # evaluate 同步会把新 revision/updated_at 回写到 problem 对象供响应使用。
    bumped = session.execute(
        update(PracticeProblem)
        .where(PracticeProblem.id == pid, PracticeProblem.revision == data.revision)
        .values(revision=data.revision + 1, updated_at=now_utc()))
    if bumped.rowcount == 0:
        raise HTTPException(409, "数据已被修改，请刷新后重试")
    new_tags: Optional[list[PracticeTag]] = None
    if data.tag_ids is not None:
        # 重复 tag_id → 去重（关联表 (problem_id, tag_id) 唯一约束，重复写会 IntegrityError 500）
        # 校验时顺带持有标签对象（R16-2：尾部直构响应用，免回查）
        new_tags = []
        for tid in dict.fromkeys(data.tag_ids):
            t = session.get(PracticeTag, tid)
            if t is None:
                raise HTTPException(400, f"标签不存在: {tid}")
            new_tags.append(t)
        session.execute(
            delete(PracticeProblemTag).where(PracticeProblemTag.problem_id == pid))
        session.flush()
        for t in new_tags:
            session.add(PracticeProblemTag(problem_id=pid, tag_id=t.id))
        session.flush()
    # R16-2：响应直构——problem/新标签/新复习行已在手；解法⋈代码一条 JOIN 查询补齐
    # （update 路径不加载子行，这是唯一必需的回读），不再整体调 get_problem_detail
    sol_rows = session.execute(
        select(PracticeSolution, PracticeSolutionCode)
        .outerjoin(PracticeSolutionCode,
                   PracticeSolutionCode.solution_id == PracticeSolution.id)
        .where(PracticeSolution.problem_id == pid)
    ).all()
    sol_map: dict[str, PracticeSolution] = {}
    codes_by_sid: dict[str, list[PracticeSolutionCode]] = {}
    for sol, code in sol_rows:
        sol_map.setdefault(sol.id, sol)
        if code is not None:
            codes_by_sid.setdefault(sol.id, []).append(code)
    solutions = sorted(sol_map.values(),
                       key=lambda s: (s.sort_order, s.created_at, s.id))
    if nr is None and problem.status == "reviewing":
        # 幂等重进/本就在复习态：本调用未触碰复习行，补查一次当前 pending
        nr = _next_review_row(session, pid)
    tags = _tag_briefs(new_tags) if new_tags is not None \
        else _tags_of(session, [pid]).get(pid, [])
    return _problem_detail_fields(problem, solutions, codes_by_sid, tags, nr)


def save_problem_aggregate(session: Session, pid: str, data: ProblemAggregateUpdate) -> dict:
    """题目、标签、解法与代码一次事务保存，任何校验/冲突都回滚整个集合。

    旧子行 API 也先锁题目，因此在这里核对完整 base 集合后，不会有子行插队。
    幂等回执与实际修改同事务落库，未知网络结果可用同 mutation_id 安全重试。
    """
    fingerprint = hashlib.sha256(json.dumps(
        {"id": pid, **data.model_dump(mode="json")}, sort_keys=True,
        ensure_ascii=False, separators=(",", ":")
    ).encode()).hexdigest()
    _lock_problem(session, pid)
    receipt = session.get(PracticeMutation, data.mutation_id)
    if receipt is not None:
        if receipt.problem_id != pid or receipt.fingerprint != fingerprint:
            raise HTTPException(409, "mutation_id 已被其他内容使用")
        return receipt.result
    problem = _get_problem(session, pid)
    if problem.revision != data.revision:
        raise HTTPException(409, "数据已被修改；本地输入已保留，请对照最新版本")
    existing = {s.id: s for s in session.scalars(select(PracticeSolution).where(
        PracticeSolution.problem_id == pid))}
    if {sid: s.revision for sid, s in existing.items()} != data.solution_revisions:
        raise HTTPException(409, "解法已被修改；本地输入已保留，请对照最新版本")
    existing_codes = {c.id: c for c in session.scalars(select(PracticeSolutionCode).where(
        PracticeSolutionCode.solution_id.in_(list(existing))))} if existing else {}
    seen_solutions, seen_codes, seen_clients = set(), set(), set()
    preferred_count = 0
    for item in data.solutions:
        if not item.name.strip():
            raise HTTPException(400, "解法名称不能为空")
        if item.id and (item.id not in existing or item.id in seen_solutions):
            raise HTTPException(400, "解法不属于此题目或重复")
        seen_solutions.add(item.id)
        preferred_count += bool(item.is_preferred)
        languages = set()
        for entry in [item, *item.codes]:
            if entry.client_id:
                if entry.client_id in seen_clients:
                    raise HTTPException(400, "client_id 重复")
                seen_clients.add(entry.client_id)
        for code in item.codes:
            _check_language(code.language)
            if code.language in languages:
                raise HTTPException(400, "同一解法的代码语言不能重复")
            languages.add(code.language)
            if code.id:
                old = existing_codes.get(code.id)
                if old is None or old.solution_id != item.id or code.id in seen_codes:
                    raise HTTPException(400, "代码不属于此解法或重复")
                seen_codes.add(code.id)
    if preferred_count > 1:
        raise HTTPException(400, "最多只能设置一个主解法")
    base = ProblemUpdate.model_validate(data.model_dump(exclude={
        "mutation_id", "solution_revisions", "solutions"}))
    update_problem(session, pid, base)
    # 先删除代码再插入，支持交换语言且不触碰唯一约束；保留已有代码 id。
    if existing:
        session.execute(delete(PracticeSolutionCode).where(
            PracticeSolutionCode.solution_id.in_(list(existing))))
    for sid in set(existing) - {s.id for s in data.solutions if s.id}:
        session.delete(existing[sid])
    session.flush()
    mapping = {"solutions": {}, "codes": {}}
    now = now_utc()
    for index, item in enumerate(data.solutions):
        sol = existing.get(item.id)
        if sol is None:
            sol = PracticeSolution(id=uuid7(), problem_id=pid, revision=1,
                                   created_at=now, updated_at=now)
            session.add(sol)
        else:
            sol.revision += 1
            sol.updated_at = now
        for field in ("name", "approach_md", "time_complexity", "space_complexity", "is_preferred"):
            setattr(sol, field, getattr(item, field))
        sol.name = sol.name.strip()
        sol.sort_order = float(index)
        if item.client_id:
            mapping["solutions"][item.client_id] = sol.id
        session.flush()
        for entry in item.codes:
            code = PracticeSolutionCode(id=entry.id or uuid7(), solution_id=sol.id,
                language=entry.language, code=entry.code, note=entry.note)
            session.add(code)
            if entry.client_id:
                mapping["codes"][entry.client_id] = code.id
    session.flush()
    out = get_problem_detail(session, pid)
    out["client_ids"] = mapping
    session.add(PracticeMutation(mutation_id=data.mutation_id, problem_id=pid,
        fingerprint=fingerprint, result=out, created_at=now))
    session.flush()
    return out


def delete_problem(session: Session, pid: str) -> None:
    """软删题目 + 级联硬删子行（解法/代码/复习/标签关联）。

    子行显式删除：SQLite 连接未开 PRAGMA foreign_keys，ondelete=CASCADE 不生效；
    软删后子行已无恢复入口，直接清掉避免孤儿行堆积。
    """
    problem = _get_problem(session, pid)
    now = now_utc()
    problem.deleted_at = now
    problem.updated_at = now
    problem.revision += 1
    session.execute(delete(PracticeSolutionCode).where(PracticeSolutionCode.solution_id.in_(
        select(PracticeSolution.id).where(PracticeSolution.problem_id == pid))))
    session.execute(delete(PracticeSolution).where(PracticeSolution.problem_id == pid))
    session.execute(delete(PracticeReview).where(PracticeReview.problem_id == pid))
    session.execute(delete(PracticeProblemTag).where(PracticeProblemTag.problem_id == pid))
    session.flush()


def _next_review_row(session: Session, pid: str) -> Optional[PracticeReview]:
    return session.scalar(
        select(PracticeReview)
        .where(PracticeReview.problem_id == pid, PracticeReview.status == "pending")
    )


def get_problem_detail(session: Session, pid: str) -> dict:
    problem = _get_problem(session, pid)
    solutions = session.scalars(
        select(PracticeSolution).where(PracticeSolution.problem_id == pid)
        .order_by(PracticeSolution.sort_order, PracticeSolution.created_at)
    ).all()
    codes = session.scalars(
        select(PracticeSolutionCode)
        .where(PracticeSolutionCode.solution_id.in_([s.id for s in solutions]))
        .order_by(PracticeSolutionCode.language)
    ).all() if solutions else []
    codes_by_sid: dict[str, list[PracticeSolutionCode]] = {}
    for c in codes:
        codes_by_sid.setdefault(c.solution_id, []).append(c)
    tags = _tags_of(session, [pid]).get(pid, [])
    nr = _next_review_row(session, pid)
    return _problem_detail_fields(problem, solutions, codes_by_sid, tags, nr)


def _review_brief(r: PracticeReview | Row) -> dict:
    return {
        "id": r.id, "cycle": r.cycle, "seq": r.seq,
        "prev_interval_days": r.prev_interval_days,
        "scheduled_date": r.scheduled_date.isoformat(),
    }


# ─── 多维筛选列表 ────────────────────────────────────────

def _parse_date_param(s: Optional[str], name: str) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(400, f"{name} 日期格式应为 YYYY-MM-DD") from None


def _parse_int_list(s: Optional[str]) -> list[int]:
    if not s:
        return []
    out = []
    for part in s.split(","):
        part = part.strip()
        if not part:
            continue
        if part not in ("1", "2", "3"):
            raise HTTPException(400, f"非法难度: {part}（可选 1/2/3）")
        out.append(int(part))
    return out


def list_problems(
    session: Session,
    q: str = "",
    tags: str = "",
    tags_op: str = "or",
    difficulty: str = "",
    status: str = "",
    source: str = "",
    language: str = "",
    from_: Optional[str] = None,
    to: Optional[str] = None,
    only_due_review: bool = False,
    sort: str = "created_desc",
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """多维筛选 + 分页 + 每题摘要（两段式批量加载）。

    from/to 为本地日历日（todo 设置时区）的创建时间区间。
    """
    if sort not in SORT_OPTIONS:
        raise HTTPException(400, f"非法排序: {sort}（可选 {'/'.join(SORT_OPTIONS)}）")
    if tags_op not in ("and", "or"):
        raise HTTPException(400, "tags_op 仅支持 and|or")  # R19-1：白名单外早失败
    q = q[:200]  # R19-2：超长关键词截断（防 LIKE 串随载荷失控）
    conds = [PracticeProblem.deleted_at.is_(None)]

    if q:
        # TODO(P2-G 性能): icontains 走 LIKE/ILIKE 全表扫描，题量上万后需换
        #   SQLite FTS5 / PG pg_trgm GIN 索引（超出本轮范围，暂维持现状）
        # icontains(autoescape)：SQLite LIKE（原生不区分大小写）/ PG ILIKE 双后端通吃
        conds.append(or_(
            PracticeProblem.title.icontains(q, autoescape=True),
            PracticeProblem.source_no.icontains(q, autoescape=True),
        ))
    if status:
        conds.append(PracticeProblem.status == _check_status(status))
    if source:
        conds.append(PracticeProblem.source == _check_source(source))
    diff_list = _parse_int_list(difficulty)
    if diff_list:
        conds.append(PracticeProblem.difficulty.in_(diff_list))

    from_d = _parse_date_param(from_, "from")
    to_d = _parse_date_param(to, "to")
    if from_d is not None and to_d is not None and from_d > to_d:
        raise HTTPException(400, "日期区间无效（from > to）")  # R19-3
    if from_d is not None:
        conds.append(PracticeProblem.created_at >= local_day_bounds_utc(from_d, _tz(session))[0])
    if to_d is not None:
        conds.append(PracticeProblem.created_at < local_day_bounds_utc(to_d, _tz(session))[1])

    tag_ids = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    if tag_ids:
        for tid in tag_ids:
            if session.get(PracticeTag, tid) is None:
                raise HTTPException(400, f"标签不存在: {tid}")
        if tags_op == "and":
            # AND：分组计数 = 标签数（同一题重复挂同一标签被 distinct 去重）
            sub = (
                select(PracticeProblemTag.problem_id)
                .where(PracticeProblemTag.tag_id.in_(tag_ids))
                .group_by(PracticeProblemTag.problem_id)
                .having(func.count(func.distinct(PracticeProblemTag.tag_id)) == len(tag_ids))
            )
        else:
            sub = select(PracticeProblemTag.problem_id).where(
                PracticeProblemTag.tag_id.in_(tag_ids))
        conds.append(PracticeProblem.id.in_(sub))

    if language:
        _check_language(language)
        lang_exists = (
            select(1)
            .select_from(PracticeSolution)
            .join(PracticeSolutionCode,
                  PracticeSolutionCode.solution_id == PracticeSolution.id)
            .where(PracticeSolution.problem_id == PracticeProblem.id,
                   PracticeSolutionCode.language == language)
            .exists()
        )
        conds.append(lang_exists)

    if only_due_review:
        today = _today(session)
        due_exists = (
            select(1)
            .select_from(PracticeReview)
            .where(PracticeReview.problem_id == PracticeProblem.id,
                   PracticeReview.status == "pending",
                   PracticeReview.scheduled_date <= today)
            .exists()
        )
        conds.append(due_exists)

    stmt = select(*_SUMMARY_COLUMNS).where(*conds)

    if sort == "solved_desc":
        stmt = stmt.order_by(PracticeProblem.first_solved_at.is_(None),
                             PracticeProblem.first_solved_at.desc(),
                             PracticeProblem.created_at.desc())
    elif sort == "difficulty_asc":
        stmt = stmt.order_by(PracticeProblem.difficulty.asc(), PracticeProblem.created_at.desc())
    elif sort == "review_asc":
        due_sub = (
            select(PracticeReview.problem_id,
                   func.min(PracticeReview.scheduled_date).label("next_date"))
            .where(PracticeReview.status == "pending")
            .group_by(PracticeReview.problem_id)
            .subquery()
        )
        stmt = (
            stmt.outerjoin(due_sub, due_sub.c.problem_id == PracticeProblem.id)
            .order_by(due_sub.c.next_date.is_(None), due_sub.c.next_date,
                      PracticeProblem.created_at.desc())
        )
    else:
        stmt = stmt.order_by(PracticeProblem.created_at.desc(), PracticeProblem.id.desc())

    total = session.scalar(
        select(func.count()).select_from(PracticeProblem).where(*conds)) or 0
    page = min(max(1, page), 1000)  # P2-D：深翻页 OFFSET 护栏
    page_size = min(max(1, page_size), 100)
    rows = session.execute(
        stmt.offset((page - 1) * page_size).limit(page_size)).all()

    items = _build_summaries(session, rows)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def _tags_of(session: Session, pids: list[str]) -> dict[str, list[dict]]:
    """批量：题目 → 标签摘要列表（IN 查询 1）。"""
    if not pids:
        return {}
    rows = session.execute(
        select(PracticeProblemTag.problem_id, PracticeTag.id, PracticeTag.name, PracticeTag.color)
        .join(PracticeTag, PracticeTag.id == PracticeProblemTag.tag_id)
        .where(PracticeProblemTag.problem_id.in_(pids))
        .order_by(PracticeTag.sort_order, PracticeTag.name)
    ).all()
    out: dict[str, list[dict]] = {}
    for pid, tag_id, name, color in rows:
        out.setdefault(pid, []).append(
            {"id": tag_id, "name": name, "color": color})
    return out


def _build_summaries(session: Session, rows: list[PracticeProblem | Row]) -> list[dict]:
    """当页 ids → 3 条 IN 查询（标签 / 解法⋈代码 / 待复习行）→ Python 拼装摘要。"""
    pids = [p.id for p in rows]
    if not pids:
        return []

    tag_map = _tags_of(session, pids)

    # 解法 LEFT JOIN 代码：一行 = (解法, 代码或 None)，count 与语言集合同源聚合
    sol_rows = session.execute(
        select(PracticeSolution.problem_id, PracticeSolution.id,
               PracticeSolutionCode.language)
        .outerjoin(PracticeSolutionCode,
                   PracticeSolutionCode.solution_id == PracticeSolution.id)
        .where(PracticeSolution.problem_id.in_(pids))
    ).all()
    sol_count: dict[str, set[str]] = {}
    lang_map: dict[str, set[str]] = {}
    for pid, _sid, lang in sol_rows:
        sol_count.setdefault(pid, set()).add(_sid)
        if lang:
            lang_map.setdefault(pid, set()).add(lang)

    next_map: dict[str, Row] = {}
    for r in session.execute(
        select(PracticeReview.problem_id, PracticeReview.id, PracticeReview.cycle,
               PracticeReview.seq, PracticeReview.prev_interval_days, PracticeReview.scheduled_date)
        .where(PracticeReview.problem_id.in_(pids), PracticeReview.status == "pending")
    ):
        next_map[r.problem_id] = r

    items = []
    for p in rows:
        d = _summary_fields(p)
        d["tags"] = tag_map.get(p.id, [])
        d["solution_count"] = len(sol_count.get(p.id, ()))
        d["code_languages"] = sorted(lang_map.get(p.id, ()))
        d["next_review"] = _review_brief(next_map[p.id]) if p.id in next_map else None
        items.append(d)
    return items


# ─── 解法 / 代码 ─────────────────────────────────────────

def _create_solution(session: Session, problem_id: str, data: SolutionCreate,
                     sort_order: float, commit: bool = True
                     ) -> tuple[PracticeSolution, list[PracticeSolutionCode]]:
    """建解法 + 内联代码，返回 (解法, 代码列表)（R16-2：调用方直构响应免回查）。"""
    now = now_utc()
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "解法名称不能为空")  # R13-2：纯空白解法名拒绝
    sol = PracticeSolution(
        id=uuid7(), problem_id=problem_id, name=name,
        approach_md=data.approach_md,
        time_complexity=data.time_complexity, space_complexity=data.space_complexity,
        is_preferred=data.is_preferred, sort_order=sort_order,
        revision=1, created_at=now, updated_at=now,
    )
    session.add(sol)
    session.flush()
    codes = [_create_code(session, sol.id, c, commit=False) for c in data.codes]
    if data.is_preferred:
        _set_preferred(session, problem_id, sol.id)
    if commit:
        session.flush()
    return sol, codes


def _set_preferred(session: Session, problem_id: str, solution_id: str) -> None:
    """单题至多一个 preferred 解法。"""
    others = session.scalars(
        select(PracticeSolution).where(
            PracticeSolution.problem_id == problem_id,
            PracticeSolution.id != solution_id,
            PracticeSolution.is_preferred.is_(True),
        )).all()
    for o in others:
        o.is_preferred = False


def create_solution(session: Session, pid: str, data: SolutionCreate) -> dict:
    _lock_problem(session, pid)
    _get_problem(session, pid)
    base = session.scalar(
        select(func.max(PracticeSolution.sort_order))
        .where(PracticeSolution.problem_id == pid)) or 0.0
    sol, codes = _create_solution(session, pid, data, sort_order=base + 1.0)
    session.flush()
    # R16-2：codes 已在手，直构响应（省 1 条回查 SELECT）
    return _solution_fields(sol, codes)


def _solution_out(session: Session, sol: PracticeSolution) -> dict:
    codes = session.scalars(
        select(PracticeSolutionCode).where(PracticeSolutionCode.solution_id == sol.id)
        .order_by(PracticeSolutionCode.language)).all()
    return _solution_fields(sol, codes)


def update_solution(session: Session, sid: str, data: SolutionUpdate) -> dict:
    sol = _get_solution(session, sid)
    _lock_problem(session, sol.problem_id)
    session.refresh(sol)
    if data.revision != sol.revision:
        raise HTTPException(409, "数据已被修改，请刷新后重试")
    if data.name is not None:
        name = data.name.strip()
        if not name:
            raise HTTPException(400, "解法名称不能为空")  # R13-2
        sol.name = name
    if data.approach_md is not None:
        sol.approach_md = data.approach_md
    if data.time_complexity is not None:
        sol.time_complexity = data.time_complexity
    if data.space_complexity is not None:
        sol.space_complexity = data.space_complexity
    if data.is_preferred is not None:
        sol.is_preferred = data.is_preferred
        if data.is_preferred:
            _set_preferred(session, sol.problem_id, sid)
    # R12-1：同 update_problem——原子 UPDATE 推进 revision（Python 比对为快速路径）
    bumped = session.execute(
        update(PracticeSolution)
        .where(PracticeSolution.id == sid, PracticeSolution.revision == data.revision)
        .values(revision=data.revision + 1, updated_at=now_utc()))
    if bumped.rowcount == 0:
        raise HTTPException(409, "数据已被修改，请刷新后重试")
    session.flush()
    return _solution_out(session, sol)


def delete_solution(session: Session, sid: str) -> None:
    sol = _get_solution(session, sid)
    _lock_problem(session, sol.problem_id)
    session.execute(delete(PracticeSolutionCode)
                    .where(PracticeSolutionCode.solution_id == sid))
    session.delete(sol)
    session.flush()


def _create_code(session: Session, solution_id: str, data: CodeCreate,
                 commit: bool = True) -> PracticeSolutionCode:
    _check_language(data.language)
    dup = session.scalar(select(PracticeSolutionCode).where(
        PracticeSolutionCode.solution_id == solution_id,
        PracticeSolutionCode.language == data.language))
    if dup is not None:
        raise HTTPException(409, f"该解法已有 {data.language} 代码")
    code = PracticeSolutionCode(
        id=uuid7(), solution_id=solution_id,
        language=data.language, code=data.code, note=data.note,
    )
    session.add(code)
    if commit:
        session.flush()
    return code


def create_code(session: Session, sid: str, data: CodeCreate) -> dict:
    sol = _get_solution(session, sid)
    _lock_problem(session, sol.problem_id)
    session.refresh(sol)
    c = _create_code(session, sid, data)
    sol.revision += 1  # code 写路径借用父级 solution 的乐观锁（与 update_code 校验一致）
    sol.updated_at = now_utc()
    session.flush()
    return {
        "id": c.id, "solution_id": c.solution_id, "language": c.language,
        "code": c.code, "note": c.note,
    }


def update_code(session: Session, cid: str, data: CodeUpdate) -> dict:
    c, sol = _get_code(session, cid)
    _lock_problem(session, sol.problem_id)
    session.refresh(sol)
    session.refresh(c)
    if data.revision != sol.revision:
        raise HTTPException(409, "数据已被修改，请刷新后重试")
    if data.language is not None:
        _check_language(data.language)
        if data.language != c.language:
            dup = session.scalar(select(PracticeSolutionCode).where(
                PracticeSolutionCode.solution_id == c.solution_id,
                PracticeSolutionCode.language == data.language))
            if dup is not None:
                raise HTTPException(409, f"该解法已有 {data.language} 代码")
            c.language = data.language
    if data.code is not None:
        c.code = data.code
    if data.note is not None:
        c.note = data.note
    sol.revision += 1  # 校验通过后递增，防并发丢更新
    sol.updated_at = now_utc()
    session.flush()
    return {
        "id": c.id, "solution_id": c.solution_id, "language": c.language,
        "code": c.code, "note": c.note,
    }


def delete_code(session: Session, cid: str) -> None:
    c, sol = _get_code(session, cid)
    _lock_problem(session, sol.problem_id)
    session.refresh(sol)
    sol.revision += 1
    sol.updated_at = now_utc()
    session.delete(c)
    session.flush()


# ─── 复习状态机 ──────────────────────────────────────────

def _create_first_pending(session: Session, problem: PracticeProblem) -> PracticeReview:
    """加入复习：首条 pending 行 scheduled = 明天（档位 1 天）。

    加入入口 = 题目进入 reviewing 态（PATCH/POST status='reviewing'）；
    cycle 递增（再次加入是新轮次），seq 跨轮次累计递增。
    """
    pid = problem.id
    now = now_utc()
    last = session.scalar(
        select(PracticeReview).where(PracticeReview.problem_id == pid)
        .order_by(PracticeReview.cycle.desc(), PracticeReview.seq.desc()).limit(1))
    cycle = (last.cycle + 1) if last else 1
    seq = (last.seq + 1) if last else 1
    row = PracticeReview(
        id=uuid7(), problem_id=pid, cycle=cycle, seq=seq,
        prev_interval_days=1,
        scheduled_date=_today(session) + timedelta(days=1),
        status="pending", created_at=now,
    )
    session.add(row)
    try:
        session.flush()
    except IntegrityError:
        # 并发加入复习：他人已先建 pending 行（每题至多一条 pending 的 partial unique）
        session.rollback()
        raise HTTPException(409, "复习状态已被其他人变更，请刷新后重试") from None
    return row


def do_review(session: Session, pid: str, result: str) -> dict:
    """三键打卡（docs/practice-spec.md 复习算法核心逻辑，逐分支照搬）。

    - remembered：进下一档；stage=7 → 毕业（mastered，不生成下一行）
    - fuzzy：原档重复
    - forgot：回 1 天；连续 2 次 forgot → 题目置回 todo，不生成下一行
    - 下一行 scheduled_date = 实际打卡日的今天 + next_days
    """
    problem = _get_problem(session, pid)
    row = _next_review_row(session, pid)
    if row is None:
        raise HTTPException(404, "无待打卡的复习记录")
    if result not in ("remembered", "fuzzy", "forgot"):
        raise HTTPException(400, f"非法打卡结果: {result}")

    # 档位白名单 clamp：值异常（手工改库）就近取合法档，不再硬回第 0 档（第 6 轮-2）
    prev_days = clamp_interval_days(row.prev_interval_days)
    stage = INTERVALS.index(prev_days)

    now = now_utc()
    today = _today(session)
    graduated = demoted = False

    if result == "remembered":
        next_days = INTERVALS[min(stage + 1, len(INTERVALS) - 1)]
        if stage == len(INTERVALS) - 1:
            graduated = True  # 顶档通关 → 毕业
    elif result == "fuzzy":
        next_days = INTERVALS[stage]
    else:  # forgot
        next_days = INTERVALS[0]
        prev = session.scalar(
            select(PracticeReview)
            .where(PracticeReview.problem_id == pid,
                   PracticeReview.cycle == row.cycle,
                   PracticeReview.seq < row.seq,
                   PracticeReview.status == "done")
            .order_by(PracticeReview.seq.desc()).limit(1))
        if prev is not None and prev.result == "forgot":
            demoted = True  # 连续 2 次 forgot → 打回 todo 重学

    out: dict[str, Any] = {
        "graduated": graduated,
        "demoted": demoted,
        "result": result,
        "next_interval_days": next_days,
        "next_scheduled_date": None,
    }
    try:
        row.result = result
        row.reviewed_at = now
        row.status = "done"
        row.next_interval_days = next_days
        if graduated:
            problem.status = "mastered"
        elif demoted:
            problem.status = "todo"
        else:
            next_row = PracticeReview(
                id=uuid7(), problem_id=pid, cycle=row.cycle, seq=row.seq + 1,
                prev_interval_days=next_days,
                scheduled_date=today + timedelta(days=next_days),
                status="pending", created_at=now,
            )
            session.add(next_row)
            session.flush()
            problem.status = "reviewing"
            out["next_review"] = _review_brief(next_row)
            out["next_scheduled_date"] = next_row.scheduled_date.isoformat()

        problem.last_reviewed_at = now
        problem.revision += 1
        problem.updated_at = now
        session.flush()
    except IntegrityError:
        # 并发打卡：他人已先把 pending 行推进（每题至多一条 pending 的 partial unique）
        session.rollback()
        raise HTTPException(409, "复习状态已被其他人变更，请刷新后重试") from None
    return out


def unreview(session: Session, pid: str) -> dict:
    """退出复习：仅 reviewing 态生效——pending 行全部置 cancelled，题目回 solved。

    非 reviewing 态幂等返回（不取消任何行、不改状态/revision/updated_at）。
    R12-2：取消改为单条原子 UPDATE（WHERE status='pending'）——与并发打卡
    （pending→done + 生成新 pending）竞态时，已 done 的历史行不会被按旧快照
    改写回 cancelled；之后重读题目状态，仍为 reviewing 才回 solved。
    """
    problem = _get_problem(session, pid)
    if problem.status != "reviewing":
        return {"cancelled": 0}
    res = session.execute(
        update(PracticeReview)
        .where(PracticeReview.problem_id == pid, PracticeReview.status == "pending")
        .values(status="cancelled"))
    cancelled = res.rowcount or 0
    # 打卡可能已在快照之后并发推进题目状态——以库内当前值为准再判一次
    session.refresh(problem)
    now = now_utc()
    if problem.status == "reviewing":
        problem.status = "solved"
        problem.revision += 1
        problem.updated_at = now
    session.flush()
    return {"cancelled": cancelled}


def review_today(session: Session) -> dict:
    """今日队列：pending 且 scheduled_date <= 今天（含逾期），按到期先后。

    R11-3：同日到期的次级排序按题目创建时间新→旧（先做最近加进来的题）。
    """
    today = _today(session)
    rows = session.scalars(
        select(PracticeReview)
        .join(PracticeProblem, PracticeProblem.id == PracticeReview.problem_id)
        .where(PracticeReview.status == "pending",
               PracticeReview.scheduled_date <= today)
        .order_by(PracticeReview.scheduled_date.asc(),
                  PracticeProblem.created_at.desc())
    ).all()
    problems = {
        p.id: p for p in session.scalars(
            select(PracticeProblem).where(
                PracticeProblem.id.in_([r.problem_id for r in rows]),
                PracticeProblem.deleted_at.is_(None),
            ).options(  # P1-B：队列卡片摘要不消费 Text 大字段
                defer(PracticeProblem.description_md),
                defer(PracticeProblem.pitfall_md),
            ))
    } if rows else {}
    summaries = {d["id"]: d for d in _build_summaries(session, list(problems.values()))}
    items = [{
        "review_id": r.id,
        "scheduled_date": r.scheduled_date.isoformat(),
        "prev_interval_days": r.prev_interval_days,
        "cycle": r.cycle,
        "seq": r.seq,
        "overdue_days": (today - r.scheduled_date).days,
        # 下方过滤保证 problem_id ∈ problems（summaries 即其键集），直接索引
        "problem": summaries[r.problem_id],
    } for r in rows if r.problem_id in problems]
    return {"today": today.isoformat(), "items": items}


# ─── 统计 ────────────────────────────────────────────────

def stats_overview(session: Session) -> dict:
    tz = _tz(session)
    today = local_today(tz)

    # P1-A：3 条 GROUP BY 聚合替代全实体加载——stats 不再把全部行（含 Text 大字段）
    # 拉进内存/identity map；白名单键先置 0 保证空档位也出现在响应里。
    by_status = {s: 0 for s in PROBLEM_STATUSES}
    by_status.update(dict(session.execute(
        select(PracticeProblem.status, func.count())
        .where(PracticeProblem.deleted_at.is_(None))
        .group_by(PracticeProblem.status)).all()))
    by_difficulty = {str(d): 0 for d in (1, 2, 3)}
    by_difficulty.update({str(k): v for k, v in session.execute(
        select(PracticeProblem.difficulty, func.count())
        .where(PracticeProblem.deleted_at.is_(None))
        .group_by(PracticeProblem.difficulty)).all()})
    by_source = {s: 0 for s in PROBLEM_SOURCES}
    by_source.update(dict(session.execute(
        select(PracticeProblem.source, func.count())
        .where(PracticeProblem.deleted_at.is_(None))
        .group_by(PracticeProblem.source)).all()))
    total = sum(by_status.values())

    # 30 天趋势：只取 created_at 单列（本地时区归日后 Python 计数）
    cutoff_utc = local_day_bounds_utc(today - timedelta(days=29), tz)[0]
    recent = session.execute(
        select(PracticeProblem.created_at)
        .where(PracticeProblem.deleted_at.is_(None),
               PracticeProblem.created_at >= cutoff_utc)
    ).scalars().all()
    trend_map: dict[str, int] = {}
    zone = ZoneInfo(tz)
    for created in recent:
        d = ensure_aware(created).astimezone(zone).date().isoformat()
        trend_map[d] = trend_map.get(d, 0) + 1

    trend = []
    for i in range(29, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        trend.append({"date": d, "count": trend_map.get(d, 0)})

    lang_rows = session.execute(
        select(PracticeSolutionCode.language, func.count())
        .join(PracticeSolution, PracticeSolution.id == PracticeSolutionCode.solution_id)
        .join(PracticeProblem, PracticeProblem.id == PracticeSolution.problem_id)
        .where(PracticeProblem.deleted_at.is_(None))
        .group_by(PracticeSolutionCode.language)
    ).all()

    tag_rows = session.execute(
        select(PracticeProblemTag.tag_id, PracticeTag.name, PracticeTag.color,
               PracticeProblem.status, func.count())
        .join(PracticeTag, PracticeTag.id == PracticeProblemTag.tag_id)
        .join(PracticeProblem, PracticeProblem.id == PracticeProblemTag.problem_id)
        .where(PracticeProblem.deleted_at.is_(None))
        .group_by(PracticeProblemTag.tag_id, PracticeTag.name, PracticeTag.color,
                  PracticeProblem.status)
    ).all()
    tags_acc: dict[str, dict] = {}
    for tid, name, color, status, cnt in tag_rows:
        acc = tags_acc.setdefault(
            tid, {"id": tid, "name": name, "color": color, "total": 0, "mastered": 0})
        acc["total"] += cnt
        if status == "mastered":
            acc["mastered"] += cnt

    status_counts = dict(session.execute(
        select(PracticeReview.status, func.count())
        .group_by(PracticeReview.status)).all())
    done = status_counts.get("done", 0)
    pending = status_counts.get("pending", 0)
    due = session.scalar(
        select(func.count()).select_from(PracticeReview)
        .where(PracticeReview.status == "pending",
               PracticeReview.scheduled_date <= today)) or 0

    return {
        "total": total,
        "by_status": by_status,
        "by_difficulty": by_difficulty,
        "by_source": by_source,
        "languages": {lang: cnt for lang, cnt in sorted(lang_rows)},
        "trend": trend,
        "tags": sorted(tags_acc.values(), key=lambda t: -t["total"]),
        "review": {
            "pending": pending,
            "due_today": due,
            "done": done,
            "cancelled": status_counts.get("cancelled", 0),
            "completion_rate": round(done / (done + pending), 4) if (done + pending) else 0.0,
        },
    }
