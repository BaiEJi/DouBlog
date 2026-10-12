"""导入导出：JSON 无损备份（导出→导入完全还原）+ Obsidian Markdown（zip）。

- JSON：全字段保留（含 id/revision/复习流水），导入为按 id upsert——
  已存在则整体覆盖（含子行全删重建），软删行恢复为未删
- Markdown：frontmatter（手写 YAML 生成，json.dumps 双引号法保证合法）+
  正文分节；导入按 source+source_no（或标题）去重跳过，标签按名建/挂
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import date, datetime, timedelta
from typing import Any, Optional

import yaml
from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

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
)
from .schemas import CodeCreate, ProblemCreate, SolutionCreate
# 同包子模块复用私有助手：_today（todo 设置时区的「今天」，与 create_problem 同源）
from .services import _today, clamp_interval_days, get_or_create_tag
from app.shared.timeutil import ensure_aware, now_utc, uuid7

EXPORT_VERSION = 1

# ─── P1-A：导入体量上限（防 zip 炸弹 / 超大载荷拖垮内存与请求）──

MAX_UPLOAD_SIZE = 20 * 1024 * 1024  # multipart zip 上传字节上限（routes 层多读 1 字节探测）
MAX_ZIP_ENTRIES = 2000              # zip 条目数上限（超出整体拒绝）
MAX_ZIP_ENTRY_SIZE = 10 * 1024 * 1024   # 单条目解压上限 10MB（超出跳过该条目）
MAX_ZIP_TOTAL_SIZE = 50 * 1024 * 1024   # 累计解压上限 50MB（超出整体拒绝）
MAX_JSON_PROBLEMS = 5000            # JSON 导入题目数上限


# ─── JSON 导出 ───────────────────────────────────────────

def _iso_dt(v: Optional[datetime]) -> Optional[str]:
    return ensure_aware(v).isoformat() if v else None


def _iso_d(v: Optional[date]) -> Optional[str]:
    return v.isoformat() if v else None


def export_json(session: Session) -> dict:
    """全量导出（不含软删行）：标签 + 题目（含解法/代码/复习流水/标签关联）。"""
    tags = session.scalars(
        select(PracticeTag).order_by(PracticeTag.sort_order)).all()
    problems = session.scalars(
        select(PracticeProblem).where(PracticeProblem.deleted_at.is_(None))
        .order_by(PracticeProblem.created_at)).all()

    tag_ids_of: dict[str, list[str]] = {}
    for pt in session.scalars(select(PracticeProblemTag)):
        tag_ids_of.setdefault(pt.problem_id, []).append(pt.tag_id)

    solutions_by_pid: dict[str, list[PracticeSolution]] = {}
    for s in session.scalars(
            select(PracticeSolution).order_by(PracticeSolution.sort_order)):
        solutions_by_pid.setdefault(s.problem_id, []).append(s)

    codes_by_sid: dict[str, list[PracticeSolutionCode]] = {}
    for c in session.scalars(select(PracticeSolutionCode)):
        codes_by_sid.setdefault(c.solution_id, []).append(c)

    reviews_by_pid: dict[str, list[PracticeReview]] = {}
    for r in session.scalars(
            select(PracticeReview).order_by(PracticeReview.cycle, PracticeReview.seq)):
        reviews_by_pid.setdefault(r.problem_id, []).append(r)

    return {
        "version": EXPORT_VERSION,
        "exported_at": now_utc().isoformat(),  # R15-3：全库时间统一 UTC（原本地时区）
        "tags": [{
            "id": t.id, "name": t.name, "color": t.color,
            "sort_order": t.sort_order, "created_at": _iso_dt(t.created_at),
        } for t in tags],
        "problems": [{
            "id": p.id, "source": p.source, "source_no": p.source_no,
            "title": p.title, "difficulty": p.difficulty, "url": p.url,
            "description_md": p.description_md, "pitfall_md": p.pitfall_md,
            "status": p.status, "first_solved_at": _iso_d(p.first_solved_at),
            "last_reviewed_at": _iso_dt(p.last_reviewed_at),
            "revision": p.revision,
            "created_at": _iso_dt(p.created_at), "updated_at": _iso_dt(p.updated_at),
            "tags": tag_ids_of.get(p.id, []),
            "solutions": [{
                "id": s.id, "name": s.name, "approach_md": s.approach_md,
                "time_complexity": s.time_complexity,
                "space_complexity": s.space_complexity,
                "is_preferred": s.is_preferred, "sort_order": s.sort_order,
                "revision": s.revision,
                "created_at": _iso_dt(s.created_at), "updated_at": _iso_dt(s.updated_at),
                "codes": [{
                    "id": c.id, "language": c.language, "code": c.code, "note": c.note,
                } for c in codes_by_sid.get(s.id, [])],
            } for s in solutions_by_pid.get(p.id, [])],
            "reviews": [{
                "id": r.id, "cycle": r.cycle, "seq": r.seq,
                "prev_interval_days": r.prev_interval_days,
                "scheduled_date": _iso_d(r.scheduled_date), "result": r.result,
                "reviewed_at": _iso_dt(r.reviewed_at),
                "next_interval_days": r.next_interval_days, "status": r.status,
                "created_at": _iso_dt(r.created_at),
            } for r in reviews_by_pid.get(p.id, [])],
        } for p in problems],
    }


# ─── JSON 导入（按 id upsert，无损还原）─────────────────

def _req_date(v: Any, field: str) -> Optional[date]:
    if not v:
        return None
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        raise HTTPException(400, f"导入数据 {field} 日期格式错误: {v}") from None


def _req_dt(v: Any, field: str) -> Optional[datetime]:
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v))
    except ValueError:
        raise HTTPException(400, f"导入数据 {field} 时间格式错误: {v}") from None
    return dt


def _to_int(v: Any, default: Optional[int] = None) -> Optional[int]:
    """P2-D：数值字段防御转换——非法值（字符串/列表/对象等）回退默认，不再 500。"""
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _to_float(v: Any, default: float) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _valid_id(v: Any) -> Optional[str]:
    """P2-D：id 合法性——非空短字符串（uuid7/自拟 slug，≤36 列宽）；其余视为缺省。"""
    return v if isinstance(v, str) and 0 < len(v) <= 36 else None


def _map_tag_id(tag_id_map: dict, raw_id: Any, real_id: str) -> None:
    """P2-D：只有 str 原始 id 可作映射键（dict/list 不可哈希，直接丢弃）。"""
    if isinstance(raw_id, str):
        tag_id_map[raw_id] = real_id


def import_json(session: Session, payload: dict) -> dict:
    try:
        return _import_json(session, payload)
    except IntegrityError:
        # R17-2：手改/异构 JSON 撞唯一约束（子行重复 id、标签撞名等清洗盲区）
        # → 整体回滚 + 400 业务错误（而非裸 500）；run_db 结束照常不提交
        session.rollback()
        raise HTTPException(400, "数据冲突：标签名或子行 ID 重复") from None


def _import_json(session: Session, payload: dict) -> dict:
    if not isinstance(payload, dict) or not isinstance(payload.get("problems"), list):
        raise HTTPException(400, "导入数据格式不正确（缺少 problems 数组）")
    # P1-A：题目数上限（防超大 JSON 载荷长时间占用连接与逐题 upsert 拖垮请求）
    if len(payload["problems"]) > MAX_JSON_PROBLEMS:
        raise HTTPException(400, f"导入题目数超过上限（{MAX_JSON_PROBLEMS}）")

    tag_rows = payload.get("tags") or []
    if not isinstance(tag_rows, list):
        raise HTTPException(400, "导入数据格式不正确（tags 应为数组）")
    tag_id_map: dict[str, str] = {}
    n_tags = 0
    for t in tag_rows:
        if not isinstance(t, dict) or not t.get("name"):
            continue
        raw_id = t.get("id")  # 原始 id 作映射键；过 _valid_id 的才可落库（P2-D）
        tid = _valid_id(raw_id)
        existing = session.get(PracticeTag, tid) if tid else None
        if existing is None:
            existing = session.scalar(
                select(PracticeTag).where(PracticeTag.name == t["name"]))
        if existing is not None:
            _map_tag_id(tag_id_map, raw_id, existing.id)
            existing.name = t["name"]
            existing.color = t.get("color") or existing.color
            existing.sort_order = _to_int(t.get("sort_order") or existing.sort_order,
                                          existing.sort_order)
        else:
            new = PracticeTag(
                id=_valid_id(raw_id) or uuid7(),
                name=t["name"], color=t.get("color") or "#6366F1",
                sort_order=_to_int(t.get("sort_order") or 0, 0),
                created_at=_req_dt(t.get("created_at"), "tags.created_at")
                or now_utc(),  # R15-3：回退时间统一 UTC
            )
            session.add(new)
            session.flush()
            _map_tag_id(tag_id_map, raw_id, new.id)
        n_tags += 1

    n_problems = 0
    for p in payload["problems"]:
        # R8-4：title 必须是非空字符串——truthy 的数字/列表等异构值直接跳过该行
        # （title 是必填语义字段，无法像数值字段那样回退默认；非 str 落库会在
        # flush 时以类型错误炸 500）
        title = p.get("title") if isinstance(p, dict) else None
        if not isinstance(title, str) or not title.strip():
            continue
        _upsert_problem_row(session, p, tag_id_map)
        n_problems += 1
    session.flush()
    return {"imported_tags": n_tags, "imported_problems": n_problems}


def _upsert_problem_row(session: Session, p: dict, tag_id_map: dict[str, str]) -> None:
    """按 id upsert 单题：字段整体覆盖、子行（解法/代码/复习/关联）全删重建。

    no_autoflush：新题先 add 空行再赋值，若中途 delete 触发 autoflush 会以
    title=None 等空值 INSERT 撞 NOT NULL；显式 flush 时字段已齐。
    """
    with session.no_autoflush:
        pid = _valid_id(p.get("id"))  # P2-D：非法 id 视为缺省（生成 uuid7，不做主键）
        problem = session.get(PracticeProblem, pid) if pid else None
        if problem is None:
            problem = PracticeProblem(id=pid or uuid7())
            session.add(problem)

        # 字段先赋值后 flush：新题空行若提前 flush 会以 title=None 撞 NOT NULL
        # 白名单清洗：手改/异构 JSON 的非法值回退默认，避免落库后 stats/筛选 500
        source = p.get("source")
        problem.source = source if source in PROBLEM_SOURCES else "other"
        # R13-1：题号 strip，空白归一为 None（与 services 语义一致）
        problem.source_no = (str(p.get("source_no")).strip() or None) if p.get("source_no") else None
        problem.title = p["title"]
        difficulty = _to_int(p.get("difficulty") or 1, 1)
        problem.difficulty = max(1, min(3, difficulty))  # clamp 到 1-3
        problem.url = p.get("url") or None
        problem.description_md = p.get("description_md") or None
        problem.pitfall_md = p.get("pitfall_md") or None
        status = p.get("status")
        problem.status = status if status in PROBLEM_STATUSES else "todo"
        problem.first_solved_at = _req_date(p.get("first_solved_at"), "first_solved_at")
        problem.last_reviewed_at = _req_dt(p.get("last_reviewed_at"), "last_reviewed_at")
        problem.revision = _to_int(p.get("revision") or 1, 1)
        problem.created_at = _req_dt(p.get("created_at"), "created_at") or now_utc()  # R15-3
        problem.updated_at = _req_dt(p.get("updated_at"), "updated_at") or problem.created_at
        problem.deleted_at = None  # 导入即恢复

        # 子行先清（含关联表），保证与导入数据一致
        session.execute(delete(PracticeSolutionCode).where(PracticeSolutionCode.solution_id.in_(
            select(PracticeSolution.id).where(PracticeSolution.problem_id == problem.id))))
        session.execute(delete(PracticeSolution).where(PracticeSolution.problem_id == problem.id))
        session.execute(delete(PracticeReview).where(PracticeReview.problem_id == problem.id))
        session.execute(delete(PracticeProblemTag).where(PracticeProblemTag.problem_id == problem.id))
        session.flush()

        # 关联表 (problem_id, tag_id) 唯一：id 映射后去重再落库（重复 → IntegrityError 500）；
        # P2-D：畸形引用（非 str/空/超 36 列宽/不可哈希）直接跳过
        tags_ref = p.get("tags")
        if not isinstance(tags_ref, list):
            tags_ref = []
        refs = [r for r in tags_ref if isinstance(r, str) and 0 < len(r) <= 36]
        for real in dict.fromkeys(tag_id_map.get(tid, tid) for tid in refs):
            if session.get(PracticeTag, real) is not None:
                session.add(PracticeProblemTag(problem_id=problem.id, tag_id=real))
        for s in p.get("solutions") or []:
            sol = PracticeSolution(
                id=_valid_id(s.get("id")) or uuid7(), problem_id=problem.id,
                name=s.get("name") or "解法",
                approach_md=s.get("approach_md") or None,
                time_complexity=s.get("time_complexity") or None,
                space_complexity=s.get("space_complexity") or None,
                is_preferred=bool(s.get("is_preferred")),
                sort_order=_to_float(s.get("sort_order") or 0.0, 0.0),
                revision=_to_int(s.get("revision") or 1, 1),
                created_at=_req_dt(s.get("created_at"), "created_at") or problem.created_at,
                updated_at=_req_dt(s.get("updated_at"), "updated_at") or problem.created_at,
            )
            session.add(sol)
            session.flush()
            seen_langs: set[str] = set()
            for c in s.get("codes") or []:
                # R8-3：(solution, language) 唯一——同语言多段只收第一段
                # （与 _insert_draft 同语义；手改/异构 JSON 的重复语言不再撞唯一约束 500）
                # R13-3：语言过白名单 + lower 归一（复用 md 通道的别名表），
                # 白名单外回退 other——异构 JSON 不再落脏语言拖垮 stats/筛选
                raw_lang = str(c.get("language") or "other").strip().lower()
                lang = _LANG_ALIAS.get(raw_lang, raw_lang)
                if lang not in SOLUTION_LANGUAGES:
                    lang = "other"
                if lang in seen_langs:
                    continue
                seen_langs.add(lang)
                session.add(PracticeSolutionCode(
                    id=_valid_id(c.get("id")) or uuid7(), solution_id=sol.id,
                    language=lang,
                    code=c.get("code") or "", note=c.get("note") or None,
                ))
        seen_pending = False
        for r in p.get("reviews") or []:
            r_status = r.get("status") or "pending"
            if r_status == "pending":
                # 每题至多一条 pending（partial unique）：多余 pending 置 cancelled
                if seen_pending:
                    r_status = "cancelled"
                seen_pending = True
            next_iv = r.get("next_interval_days")
            session.add(PracticeReview(
                id=_valid_id(r.get("id")) or uuid7(), problem_id=problem.id,
                cycle=_to_int(r.get("cycle") or 1, 1),
                seq=_to_int(r.get("seq") or 1, 1),
                # 第 6 轮-2：prev_interval_days 过 INTERVALS 白名单——非法/越界
                # 值就近 clamp 到合法档（3→2、200→120），不再放行野档或硬回默认
                prev_interval_days=clamp_interval_days(
                    _to_int(r.get("prev_interval_days") or 1, 1)),
                scheduled_date=_req_date(r.get("scheduled_date"), "scheduled_date")
                or _today(session),  # R11-1：回退用 todo 设置时区的「今天」（原本 UTC 日，跨时区差一天）
                result=r.get("result") or None,
                reviewed_at=_req_dt(r.get("reviewed_at"), "reviewed_at"),
                next_interval_days=(_to_int(next_iv, None)
                                    if next_iv is not None else None),
                status=r_status,
                created_at=_req_dt(r.get("created_at"), "created_at") or problem.created_at,
            ))
        session.flush()

        # R13-6：修复复习状态机不变量（status=reviewing ⟺ 存在 pending 行）——
        # 手改/异构 JSON 可能造出两边不一致的脏数据：
        # - reviewing 却无 pending 行 → 补一条（明天到期，与 services._create_first_pending
        #   同语义；cycle/seq 接续已有流水），否则题目永远卡在复习态无到期日
        # - 非 reviewing 却带 pending 行 → 置 cancelled，否则今日队列会冒出
        #   非 reviewing 态的题（打卡端点对这类题直接 404）
        if problem.status == "reviewing":
            if not seen_pending:
                last = session.scalar(
                    select(PracticeReview).where(PracticeReview.problem_id == problem.id)
                    .order_by(PracticeReview.cycle.desc(), PracticeReview.seq.desc()).limit(1))
                session.add(PracticeReview(
                    id=uuid7(), problem_id=problem.id,
                    cycle=(last.cycle + 1) if last else 1,
                    seq=(last.seq + 1) if last else 1,
                    prev_interval_days=1,
                    scheduled_date=_today(session) + timedelta(days=1),
                    status="pending", created_at=now_utc(),
                ))
                session.flush()
        elif seen_pending:
            session.execute(
                update(PracticeReview)
                .where(PracticeReview.problem_id == problem.id,
                       PracticeReview.status == "pending")
                .values(status="cancelled"))


# ─── Obsidian Markdown 导出（zip）───────────────────────

_UNSAFE_FS = re.compile(r'[\\/:*?"<>|\r\n\t]')


def _yaml_scalar(s: Any) -> str:
    """需要引号的标量用 json.dumps（JSON 串是合法 YAML 双引号子集）。

    控制字符（tab/CR/任意 <0x20）裸写在 YAML 里会被折叠或报错，必须引号化
    （P2-E）；json.dumps 会转义为 \\t/\\r 等 YAML 双引号合法转义。
    """
    s = str(s)
    if any(c in s for c in [':', '#', '\n', '\t', '\r']) or s.strip() != s or not s \
       or any(ord(c) < 32 for c in s) \
       or s.lower() in ('true', 'false', 'yes', 'no', 'null') \
       or re.match(r'^[-+]?\d', s) \
       or s.startswith(('-', '?', '[', ']', '{', '}', '&', '*', '!', '|', '>',
                        "'", '"', '%', '@', '`')):
        return json.dumps(s, ensure_ascii=False)
    return s


def _problem_to_md(problem: PracticeProblem, tags: list[PracticeTag],
                   solutions: list[PracticeSolution],
                   codes_by_sid: dict[str, list[PracticeSolutionCode]]) -> str:
    fm = ["---"]
    fm.append(f"title: {_yaml_scalar(problem.title)}")
    fm.append(f"source: {problem.source}")
    if problem.source_no:
        fm.append(f"source_no: {_yaml_scalar(problem.source_no)}")
    fm.append(f"difficulty: {problem.difficulty}")
    if problem.url:
        fm.append(f"url: {_yaml_scalar(problem.url)}")
    fm.append(f"status: {problem.status}")
    if problem.first_solved_at:
        fm.append(f"first_solved_at: {problem.first_solved_at.isoformat()}")
    fm.append(f"created_at: {_yaml_scalar(_iso_dt(problem.created_at))}")
    if tags:
        fm.append("tags:")
        fm.extend(f"  - {_yaml_scalar(t.name)}" for t in tags)
    fm.append("---")

    parts = ["\n".join(fm), ""]
    if problem.description_md:
        parts += ["## 题目描述", "", problem.description_md.strip(), ""]
    if problem.pitfall_md:
        parts += ["## 易错点", "", problem.pitfall_md.strip(), ""]
    if solutions:
        parts += ["## 解法", ""]
        for s in solutions:
            mark = " ⭐" if s.is_preferred else ""
            parts.append(f"### {s.name}{mark}")
            parts.append("")
            meta = []
            if s.time_complexity:
                meta.append(f"**时间复杂度**: {s.time_complexity}")
            if s.space_complexity:
                meta.append(f"**空间复杂度**: {s.space_complexity}")
            if meta:
                parts += ["  \n".join(meta), ""]
            if s.approach_md:
                parts += [s.approach_md.strip(), ""]
            for c in codes_by_sid.get(s.id, []):
                parts += [f"#### {c.language}", "",
                          f"```{c.language}", (c.code or "").rstrip(), "```", ""]
                if c.note:
                    parts += [f"> {c.note}", ""]
    return "\n".join(parts).rstrip() + "\n"


def export_md_zip(session: Session) -> bytes:
    """全部题目导出为 Obsidian 风格 Markdown（内存 zip，一题一文件）。"""
    problems = session.scalars(
        select(PracticeProblem).where(PracticeProblem.deleted_at.is_(None))
        .order_by(PracticeProblem.created_at)).all()
    # P2-E：标签关联一次 JOIN 预载（同 services._tags_of 模式），
    # 替代逐行 session.get 的 N+1；顺带按 sort_order 确定导出顺序
    tag_rows = session.execute(
        select(PracticeProblemTag.problem_id, PracticeTag)
        .join(PracticeTag, PracticeTag.id == PracticeProblemTag.tag_id)
        .where(PracticeProblemTag.problem_id.in_([p.id for p in problems] or [""]))
        .order_by(PracticeTag.sort_order, PracticeTag.name)
    ).all()
    tags_by_pid: dict[str, list[PracticeTag]] = {}
    for pid, tag in tag_rows:
        tags_by_pid.setdefault(pid, []).append(tag)
    solutions_by_pid: dict[str, list[PracticeSolution]] = {}
    for s in session.scalars(select(PracticeSolution).order_by(PracticeSolution.sort_order)):
        solutions_by_pid.setdefault(s.problem_id, []).append(s)
    codes_by_sid: dict[str, list[PracticeSolutionCode]] = {}
    for c in session.scalars(select(PracticeSolutionCode)):
        codes_by_sid.setdefault(c.solution_id, []).append(c)

    buf = io.BytesIO()
    used_names: set[str] = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, p in enumerate(problems, start=1):
            base = _UNSAFE_FS.sub("_", f"{p.title}").strip(" .")[:80] or "untitled"
            name = f"{i:03d} {base}.md"
            k = 2
            while name in used_names:
                name = f"{i:03d} {base} ({k}).md"
                k += 1
            used_names.add(name)
            zf.writestr(name, _problem_to_md(
                p, tags_by_pid.get(p.id, []),
                solutions_by_pid.get(p.id, []),
                codes_by_sid))
    return buf.getvalue()


# ─── Obsidian Markdown 导入（zip）───────────────────────

_FM_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.S)
_FENCE_RE = re.compile(r"```([A-Za-z0-9+#-]*)[^\n]*\n(.*?)```", re.S)

# 常见语言别名 → 白名单语言（Obsidian 笔记里写法自由）
_LANG_ALIAS = {
    "c++": "cpp", "cc": "cpp", "cxx": "cpp", "py": "python", "python3": "python",
    "js": "javascript", "node": "javascript", "ts": "typescript",
    "cs": "csharp", "sh": "bash", "shell": "bash", "zsh": "bash",
    "golang": "go", "rs": "rust", "kt": "kotlin", "rb": "ruby",
}


def _split_sections(body: str, level: int = 2) -> dict[str, str]:
    pat = re.compile(rf"^{'#' * level} (.+)$", re.M)
    out: dict[str, str] = {}
    matches = list(pat.finditer(body))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        out[m.group(1).strip()] = body[m.end():end].strip()
    return out


def _parse_md_file(content: str) -> Optional[ProblemCreate]:
    """单篇 Obsidian Markdown → ProblemCreate（尽力解析；无 title 返回 None）。"""
    m = _FM_RE.match(content)
    meta: dict[str, Any] = {}
    body = content
    if m:
        try:
            meta = yaml.safe_load(m.group(1)) or {}
        except yaml.YAMLError:
            meta = {}
        body = content[m.end():]
    if not isinstance(meta, dict):
        meta = {}
    title = str(meta.get("title") or "").strip()
    if not title:
        # 退回首个一级/二级标题
        hm = re.search(r"^#{1,2} (.+)$", body, re.M)
        if not hm:
            return None
        title = hm.group(1).strip()

    sections = _split_sections(body, 2)
    description = sections.get("题目描述") or ""
    pitfall = sections.get("易错点") or sections.get("易错點") or ""

    solutions: list[SolutionCreate] = []
    sol_sections = _split_sections(sections.get("解法") or "", 3)
    for name, sec in sol_sections.items():
        clean_name = name.replace("⭐", "").strip()
        tc = sc = None
        approach_lines = []
        for line in sec.splitlines():
            cm = re.match(r"\*\*(?:时间|空间)复杂度\*\*:\s*(.+)$", line.strip())
            if cm:
                val = cm.group(1).strip()
                if line.strip().startswith("**时间"):
                    tc = val
                else:
                    sc = val
            else:
                approach_lines.append(line)
        code_section = "\n".join(approach_lines)
        codes: list[CodeCreate] = []
        for lang, text in _FENCE_RE.findall(code_section):
            norm = _LANG_ALIAS.get(lang.strip().lower(), lang.strip().lower())
            if norm in SOLUTION_LANGUAGES:
                codes.append(CodeCreate(language=norm, code=text.rstrip()))
            # 白名单外的 fence（如洛谷 input/output 样例块）留在正文，不当代码
        solutions.append(SolutionCreate(
            name=clean_name,
            approach_md=code_section.strip() or None,
            time_complexity=tc, space_complexity=sc,
            is_preferred="⭐" in name,
            codes=codes,
        ))

    tags_raw = meta.get("tags") or []
    if isinstance(tags_raw, str):
        tags_raw = [t.strip() for t in tags_raw.split(",") if t.strip()]
    tag_names = [str(t) for t in tags_raw if str(t).strip()]

    try:
        difficulty = int(meta.get("difficulty") or 1)
    except (TypeError, ValueError):
        difficulty = 1

    first_solved = None
    if meta.get("first_solved_at"):
        try:
            first_solved = date.fromisoformat(str(meta["first_solved_at"])[:10])
        except ValueError:
            first_solved = None

    # 白名单清洗：手改 frontmatter 的非法 source/status 回退默认
    # （与 _upsert_problem_row 同语义，避免落库后 stats/筛选 500）
    source = str(meta.get("source") or "other")
    if source not in PROBLEM_SOURCES:
        source = "other"
    status = str(meta.get("status") or "todo")
    if status not in PROBLEM_STATUSES:
        status = "todo"

    return ProblemCreate(
        title=title[:255],
        source=source,
        source_no=(str(meta["source_no"])[:64] if meta.get("source_no") else None),
        difficulty=max(1, min(3, difficulty)),
        url=(str(meta["url"])[:512] if meta.get("url") else None),
        description_md=description or None,
        pitfall_md=pitfall or None,
        status=status,
        first_solved_at=first_solved,
        tag_names=tag_names,
        solutions=solutions,
    )


def _insert_draft(session: Session, draft: ProblemCreate) -> None:
    """直插单题 ORM（P1-C）：不走 create_problem——省 detail 回读、逐解法 flush
    和 preferred/重复代码逐题查询（导入题恒为全新题，这些检查必然空转）。

    draft 来自 _parse_md_file：source/status/difficulty 已过白名单清洗，
    tag_ids 恒为空（frontmatter 只有 tag_names）；语义与 create_problem 对齐。
    """
    now = now_utc()
    solved = draft.status in ("solved", "reviewing", "mastered")
    problem = PracticeProblem(
        id=uuid7(),
        source=draft.source,
        source_no=((draft.source_no or "").strip() or None),  # R13-1
        title=draft.title.strip(),
        difficulty=draft.difficulty,
        url=draft.url,
        description_md=draft.description_md,
        pitfall_md=draft.pitfall_md,
        status=draft.status,
        first_solved_at=(draft.first_solved_at if draft.first_solved_at
                         else (_today(session) if solved else None)),
        revision=1, created_at=now, updated_at=now,
    )
    session.add(problem)
    # 标签按名建/挂（tag_names 可能重复 → 去重，关联表 (problem,tag) 唯一；
    # get_or_create_tag 内部 strip：空名返回 None 跳过、超长截断 100——第 6 轮-5）
    if draft.tag_names:
        tag_ids: list[str] = []
        for n in draft.tag_names:
            tag = get_or_create_tag(session, n)
            if tag is not None and tag.id not in tag_ids:
                tag_ids.append(tag.id)
        for tid in tag_ids:
            session.add(PracticeProblemTag(problem_id=problem.id, tag_id=tid))
    for i, s in enumerate(draft.solutions):
        sol = PracticeSolution(
            id=uuid7(), problem_id=problem.id, name=s.name.strip(),
            approach_md=s.approach_md,
            time_complexity=s.time_complexity, space_complexity=s.space_complexity,
            is_preferred=s.is_preferred, sort_order=1.0 + i,
            revision=1, created_at=now, updated_at=now,
        )
        session.add(sol)
        seen_langs: set[str] = set()
        for c in s.codes:
            # 手写笔记同一解法可能有多段同语言 fence：(solution,language) 唯一，
            # 重复语言只收第一段（导入尽力而为，不为单段重复炸整个 zip）
            if c.language in seen_langs:
                continue
            seen_langs.add(c.language)
            session.add(PracticeSolutionCode(
                id=uuid7(), solution_id=sol.id,
                language=c.language, code=c.code, note=c.note,
            ))
    if draft.status == "reviewing":
        # 新题直接以复习态导入 = 首条 pending 行（明天到期，与 create_problem 同语义；
        # 全新题无历史复习行，cycle/seq 恒为 1，免逐题查询）
        session.add(PracticeReview(
            id=uuid7(), problem_id=problem.id, cycle=1, seq=1,
            prev_interval_days=1,
            scheduled_date=_today(session) + timedelta(days=1),
            status="pending", created_at=now,
        ))


def import_md_zip(session: Session, data: bytes) -> dict:
    """Obsidian vault zip 导入：按 source+source_no（缺编号按标题）去重跳过。

    去重索引包含软删行（命中即跳过）：软删的题目重导 zip 不复活重复行，
    导入幂等（P2-H）；两套 set 索引把判重从 O(n×m) 降到 O(1)。
    """
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, OSError):
        raise HTTPException(400, "不是合法的 zip 文件") from None
    infos = zf.infolist()
    # P1-A：条目数上限（防海量小条目拖垮解析/判重索引）
    if len(infos) > MAX_ZIP_ENTRIES:
        raise HTTPException(400, f"zip 条目数超过上限（{MAX_ZIP_ENTRIES}）")

    # 判重只取 3 个小列（P1-C：不随全量实体把 Text 大字段拉进 identity map）
    rows = session.execute(
        select(PracticeProblem.source, PracticeProblem.source_no, PracticeProblem.title)
    ).all()
    dup_by_no = {(s, no) for s, no, _t in rows if no}
    dup_by_title = {(s, t) for s, _no, t in rows}

    def _is_dup(source: str, source_no: Optional[str], title: str) -> bool:
        # 有站内编号 → 按 (source, source_no) 去重；否则按 (source, title)
        if source_no:
            return (source, source_no) in dup_by_no
        return (source, title) in dup_by_title

    n_ok = n_skip = n_bad = 0
    total_decompressed = 0
    for info in infos:
        name = info.filename
        if not name.lower().endswith(".md") or name.endswith("/"):
            continue
        if info.file_size > MAX_ZIP_ENTRY_SIZE:
            # P1-A：声明解压超 10MB 的条目跳过（不读入内存）
            n_bad += 1
            continue
        try:
            content = zf.read(name).decode("utf-8-sig")
        except UnicodeDecodeError:
            n_bad += 1
            continue
        total_decompressed += len(content)
        if total_decompressed > MAX_ZIP_TOTAL_SIZE:
            # P1-A：累计解压超 50MB 整体拒绝（zip 炸弹；半途插入随事务回滚）
            raise HTTPException(400, "zip 解压总量超过上限（50MB）")
        draft = _parse_md_file(content)
        if draft is None:
            n_bad += 1
            continue
        if _is_dup(draft.source, draft.source_no, draft.title):
            n_skip += 1
            continue
        _insert_draft(session, draft)
        if draft.source_no:
            dup_by_no.add((draft.source, draft.source_no))
        dup_by_title.add((draft.source, draft.title))
        n_ok += 1
        if n_ok % 50 == 0:
            # P1-C：每 50 题分批 flush，事务中途分段落库（最终仍一次 commit）
            session.flush()
    session.flush()
    return {"imported_problems": n_ok, "skipped": n_skip, "invalid": n_bad}
