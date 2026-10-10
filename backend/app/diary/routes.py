"""
日记 API（Memos / Day One 能力超集）

独立于文章体系的私人日记：
- 条目 CRUD：GET/POST /api/diary/entries、PUT/DELETE /api/diary/entries/<id>
- 视图：?view=timeline|archive|trash|pinned，过滤 ?date= ?search= ?tag= ?mood= ?journal_id= ?start= ?end=
- 日记本（分册）：GET/POST/PUT/DELETE /api/diary/journals
- 快速录入：POST /api/diary/quick（外部脚本/快捷指令一句话打卡）
- 日历/热力图：GET /api/diary/dates?year=&month=、GET /api/diary/heatmap?year=
- 回忆：GET /api/diary/onthisday（往年今日 + 随机旧记忆）
- 统计：GET /api/diary/stats、GET /api/diary/trends?months=、GET /api/diary/yearend?year=
- 分享：POST /api/diary/entries/<id>/share {expires_hours}、DELETE .../share（撤销）、
  GET /api/diary/share/<token>（**免登录**只读，过期即 404）
- 导出：GET /api/diary/export（全量 Markdown zip，frontmatter 含日期/心情/标签/天气）
- 模板与引导：GET /api/diary/templates、GET /api/diary/prompt?date=（按日期确定性轮换）

日期统一 YYYY-MM-DD 字符串（避免跨 SQLite/PG 时区问题）；同一天可多篇。
删除为软删除（回收站），PUT 支持 pin/archive/restore 动作；?hard=1 彻底删除。
"""

import io
import json
import re
import secrets
import zipfile
from datetime import date, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy import case, func

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.response import api_response
from app.shared.timestamps import _iso, _utcnow
from app.diary.models import Diary, DiaryJournal
from lizysdk.errors import ParamError, NotFoundError, ConflictError

# 挂 Basic Auth 的路由器（模块内全部端点）；免认证的分享只读端点在 public_router
_authed_router = APIRouter(prefix='/api/diary', tags=['diary'],
                           dependencies=[Depends(require_basic)])
_public_router = APIRouter(prefix='/api/diary', tags=['diary'])
router = APIRouter()
router.include_router(_authed_router)
router.include_router(_public_router)

MOODS = {'great', 'good', 'ok', 'low', 'bad'}
MOOD_SCORE = {'great': 5, 'good': 4, 'ok': 3, 'low': 2, 'bad': 1}
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')

#: 写作引导问题（按日期确定性轮换，无状态）
PROMPTS = [
    '今天最值得记住的一瞬间是什么？',
    '有什么事让你今天心情如此？写下来。',
    '今天学到了什么新东西？',
    '如果给今天起个标题，会是什么？',
    '今天和谁的对话最有意思？',
    '今天有什么想做但没做的事？为什么？',
    '描述今天看到的一个画面（颜色/声音/气味）。',
    '今天的自己比昨天进步了一点点吗？在哪里？',
    '此刻身体的感觉如何？累、轻松、还是紧绷？',
    '今天最想感谢的人或事是什么？',
    '如果明天可以重来今天，你会改变什么？',
    '最近反复出现在你脑海里的念头是什么？',
    '今天遇到的小确幸是什么？',
    '写一句想对一年后的自己说的话。',
    '今天规避了什么麻烦？怎么做到的？',
    '用三个词形容今天，再解释为什么。',
    '今天读/看/听到最打动你的一句话？',
    '最近在为什么事情焦虑？写下来看看它。',
    '今天帮助别人或被帮助的瞬间？',
    '睡前放空一分钟，此刻脑子里剩下什么？',
    '这周最期待的一件事是什么？',
]

#: 预置日记本（迁移时确保存在；随记必须归属其一或自建本）
PRESET_JOURNALS = [('日常', '🏡'), ('工作', '💼'), ('感悟', '🌱')]

#: 内置模板（标题 + Markdown 骨架）
TEMPLATES = [
    {'key': 'morning', 'name': '晨间规划', 'emoji': '🌅',
     'body': '## 今日三件事\n1. \n2. \n3. \n\n## 心情\n\n## 一句话意图\n> 今天我想…'},
    {'key': 'evening', 'name': '晚间复盘', 'emoji': '🌙',
     'body': '## 今天做得好的\n- \n\n## 可以更好的\n- \n\n## 明天最重要的一件事\n- '},
    {'key': 'weekly', 'name': '周回顾', 'emoji': '🗓️',
     'body': '## 本周关键词\n\n## 收获\n- \n\n## 遗憾\n- \n\n## 下周调整\n- '},
    {'key': 'gratitude', 'name': '感恩三件事', 'emoji': '💛',
     'body': '1. 感谢…\n2. 感谢…\n3. 感谢…'},
    {'key': 'blank', 'name': '自由书写', 'emoji': '✍️', 'body': ''},
]


async def _json_body(request: Request):
    """`request.get_json(silent=True) or {}` 的等价实现：解析失败/空体一律 {}"""
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001 - 对齐旧版 get_json(silent=True)（坏 JSON 不抛错）
        return {}
    return data or {}


def _arg_int(params, key, default=None):
    """werkzeug `request.args.get(key, default, type=int)` 等价：缺省/转换失败回默认"""
    raw = params.get(key)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


#: 单趟字数统计：CJK 逐字一个匹配 + 西文/数字连续段一个匹配（与两趟正则等价）
_WORDS_RE = re.compile(r'[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]|[A-Za-z0-9]+')


def _count_words(text: str) -> int:
    """CJK 逐字计数 + 西文按词计数（单趟扫描）"""
    if not text:
        return 0
    return len(_WORDS_RE.findall(text))


def _parse_date(raw):
    if not raw or not isinstance(raw, str) or not DATE_RE.match(raw):
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _clean_meta(raw, keys):
    """weather/location 元数据：保留白名单键、值转 str/float，防塞私货"""
    if not isinstance(raw, dict):
        return None
    out = {}
    for k in keys:
        v = raw.get(k)
        if v is None:
            continue
        if isinstance(v, (int, float)):
            out[k] = round(float(v), 5)
        elif isinstance(v, str) and len(v) <= 80:
            out[k] = v
    return out or None


def _validate_payload(data: dict, partial: bool = False):
    """校验并规范化 payload，返回 (payload, error)"""
    out = {}

    if 'entry_date' in data or not partial:
        d = _parse_date(data.get('entry_date'))
        if not d:
            return None, 'entry_date 必须是合法的 YYYY-MM-DD 日期'
        out['entry_date'] = d.isoformat()

    if 'content' in data or not partial:
        content = data.get('content')
        if not isinstance(content, str):
            return None, 'content 必须是字符串'
        if len(content) > 200_000:
            return None, '正文过长（上限 20 万字符）'
        out['content'] = content
        out['word_count'] = _count_words(content)

    if 'mood' in data or not partial:
        mood = data.get('mood') or None
        if mood is not None and mood not in MOODS:
            return None, 'mood 取值：great / good / ok / low / bad'
        out['mood'] = mood

    kind = data.get('kind') or 'note'
    if kind not in ('note', 'summary'):
        return None, 'kind 仅 note / summary'

    if 'journal_id' in data:
        jid = data.get('journal_id')
        if jid is not None:
            if not isinstance(jid, int) or not db.session.get(DiaryJournal, jid):
                return None, 'journal_id 无效'
        out['journal_id'] = jid
    elif not partial and kind == 'note':
        return None, '随记必须选择日记本（journal_id）'

    if 'weather' in data:
        w = _clean_meta(data.get('weather'), ('temp', 'code', 'text', 'wind', 'humidity'))
        out['weather'] = json.dumps(w, ensure_ascii=False) if w else None

    if 'location' in data:
        loc = _clean_meta(data.get('location'), ('lat', 'lon', 'place'))
        out['location'] = json.dumps(loc, ensure_ascii=False) if loc else None

    return out, None


def _live_query():
    return Diary.query.filter(Diary.deleted_at.is_(None))


def _fold_day_mood(rows):
    """(entry_date, mood, count) 分组行 → {date: {count, mood}}（心情取当天最好；SQL 聚合下推后的小集合内存折叠）"""
    days = {}
    for entry_date, mood, cnt in rows:
        d = days.setdefault(entry_date, {'count': 0, 'mood': None})
        d['count'] += cnt
        if mood and (not d['mood'] or MOOD_SCORE[mood] > MOOD_SCORE.get(d['mood'], 0)):
            d['mood'] = mood
    return days


def _longest_streak(dates):
    """连续日期段最长天数（dates 为 YYYY-MM-DD 集合）"""
    longest, run, prev = 0, 0, None
    for d in sorted(dates):
        dd = date.fromisoformat(d)
        run = run + 1 if (prev and (dd - prev).days == 1) else 1
        longest = max(longest, run)
        prev = dd
    return longest


# ─── 条目列表 / 搜索 / 过滤 ──────────────────────────────

@_authed_router.get('/entries')
async def list_entries(request: Request):
    """
    视图与过滤（可组合）：?view=timeline(默认未归档)|archive|trash|pinned，
    ?date= / ?start=&end= / ?search=（正文+标签） / ?tag= / ?mood= / ?journal_id=。
    排序：置顶优先，日期倒序、id 倒序；?limit= ?offset=（默认全量上限 500）。
    """
    def _impl():
        params = request.query_params
        q = Diary.query
        view = params.get('view', 'timeline')
        if view not in ('timeline', 'archive', 'trash', 'pinned'):
            raise ParamError(message='view 可选 timeline/archive/trash/pinned')
        if view == 'trash':
            q = q.filter(Diary.deleted_at.isnot(None))
        else:
            q = q.filter(Diary.deleted_at.is_(None))
            if view == 'archive':
                q = q.filter(Diary.archived_at.isnot(None))
            elif view == 'pinned':
                q = q.filter(Diary.pinned.is_(True), Diary.archived_at.is_(None))
            else:
                q = q.filter(Diary.archived_at.is_(None))
            journal_id = _arg_int(params, 'journal_id')
            if journal_id is not None:
                q = q.filter(Diary.journal_id == journal_id)
            if params.get('mood') in MOODS:
                q = q.filter(Diary.mood == params.get('mood'))

        if params.get('date'):
            d = _parse_date(params.get('date'))
            if not d:
                raise ParamError(message='date 非法')
            q = q.filter(Diary.entry_date == d.isoformat())
        else:
            if params.get('start'):
                d = _parse_date(params.get('start'))
                if not d:
                    raise ParamError(message='start 非法')
                q = q.filter(Diary.entry_date >= d.isoformat())
            if params.get('end'):
                d = _parse_date(params.get('end'))
                if not d:
                    raise ParamError(message='end 非法')
                q = q.filter(Diary.entry_date <= d.isoformat())
        if params.get('search'):
            kw = f"%{params.get('search').strip()}%"
            q = q.filter(Diary.content.like(kw))

        if view in ('timeline', 'pinned'):
            q = q.order_by(Diary.pinned.desc(), Diary.entry_date.desc(),
                           case((Diary.kind == 'summary', 0), else_=1),
                           Diary.id.desc())
        else:
            q = q.order_by(Diary.entry_date.desc(), Diary.id.desc())

        total = q.count()
        limit = min(500, _arg_int(params, 'limit', 500))
        offset = max(0, _arg_int(params, 'offset', 0))
        items = q.offset(offset).limit(limit).all()
        return api_response({'total': total, 'items': [e.to_dict() for e in items]})
    return await run_db(_impl)


@_authed_router.post('/entries')
async def create_entry(request: Request):
    data = await _json_body(request)

    def _impl():
        payload, err = _validate_payload(data)
        if err:
            raise ParamError(message=err)
        entry = Diary(kind=payload.get('kind') or 'note', **{k: v for k, v in payload.items() if k != 'kind'})
        db.session.add(entry)
        db.session.commit()
        return api_response(entry.to_dict(), 201, '创建成功')
    return await run_db(_impl)


@_authed_router.post('/quick')
async def quick_capture(request: Request):
    """一句话快速录入（外部脚本/快捷指令）：今天新开一篇，心情与标签可选。"""
    data = await _json_body(request)

    def _impl():
        content = (data.get('content') or '').strip()
        if not content:
            raise ParamError(message='content 必填')
        if len(content) > 20_000:
            raise ParamError(message='content 过长')
        jid = data.get('journal_id')
        if not isinstance(jid, int) or not db.session.get(DiaryJournal, jid):
            raise ParamError(message='随记必须选择日记本（journal_id）')
        entry = Diary(
            kind='note',
            content=content,
            entry_date=date.today().isoformat(),
            word_count=_count_words(content),
            mood=data.get('mood') if data.get('mood') in MOODS else None,
            journal_id=jid,
        )
        db.session.add(entry)
        db.session.commit()
        return api_response(entry.to_dict(), 201, '已记录')
    return await run_db(_impl)


@_authed_router.put('/entries/{entry_id}')
async def update_entry(entry_id: int, request: Request):
    """整包更新（自动保存）；或动作模式 ?action=pin|unpin|archive|unarchive|restore"""
    data = await _json_body(request)

    def _impl():
        entry = db.session.get(Diary, entry_id)
        if not entry:
            raise NotFoundError(message='日记不存在')

        action = request.query_params.get('action')
        if action:
            if action == 'pin':
                entry.pinned = True
            elif action == 'unpin':
                entry.pinned = False
            elif action == 'archive':
                entry.archived_at = _utcnow()
                entry.pinned = False
            elif action == 'unarchive':
                entry.archived_at = None
            elif action == 'restore':
                entry.deleted_at = None
            else:
                raise ParamError(message='action 可选 pin/unpin/archive/unarchive/restore')
            db.session.commit()
            return api_response(entry.to_dict())

        payload, err = _validate_payload(data, partial=True)
        if err:
            raise ParamError(message=err)
        for k, v in payload.items():
            setattr(entry, k, v)
        db.session.commit()
        return api_response(entry.to_dict())
    return await run_db(_impl)


@_authed_router.delete('/entries/{entry_id}')
async def delete_entry(entry_id: int, request: Request):
    """移入回收站（软删除）；?hard=1 彻底删除（回收站内才允许）"""
    def _impl():
        entry = db.session.get(Diary, entry_id)
        if not entry:
            raise NotFoundError(message='日记不存在')
        if request.query_params.get('hard'):
            if entry.deleted_at is None:
                raise ParamError(message='彻底删除前需先移入回收站')
            entry.share_token = None
            entry.share_expires = None
            db.session.delete(entry)
            db.session.commit()
            return api_response({'id': entry_id, 'purged': True})
        entry.deleted_at = _utcnow()
        entry.pinned = False
        db.session.commit()
        return api_response({'id': entry_id, 'trashed': True})
    return await run_db(_impl)


@_authed_router.post('/summary')
async def upsert_summary(request: Request):
    """每日总结（每天一篇，upsert）：{entry_date, content, mood?}。

    已有当天总结则整包更新；总结的 journal_id 恒为 NULL（不属于任何本）。
    """
    data = await _json_body(request)

    def _impl():
        d = _parse_date(data.get('entry_date'))
        if not d:
            raise ParamError(message='entry_date 必须是合法的 YYYY-MM-DD 日期')
        content = data.get('content')
        if not isinstance(content, str) or len(content) > 200_000:
            raise ParamError(message='content 必须是字符串（≤20 万字符）')
        mood = data.get('mood') or None
        if mood is not None and mood not in MOODS:
            raise ParamError(message='mood 取值：great / good / ok / low / bad')

        entry = Diary.query.filter(Diary.kind == 'summary', Diary.entry_date == d.isoformat(),
                                   Diary.deleted_at.is_(None)).first()
        created = False
        if not entry:
            entry = Diary(kind='summary', entry_date=d.isoformat())
            db.session.add(entry)
            created = True
        entry.content = content
        entry.word_count = _count_words(content)
        entry.mood = mood
        entry.journal_id = None
        db.session.commit()
        # 当天随记（挂在总结后）
        notes = (Diary.query.filter(Diary.kind == 'note', Diary.deleted_at.is_(None),
                                    Diary.archived_at.is_(None),
                                    Diary.entry_date == d.isoformat())
                 .order_by(Diary.id.desc()).all())
        return api_response({'summary': entry.to_dict(), 'created': created,
                             'notes': [n.to_dict() for n in notes]},
                            201 if created else 200, '总结已生成' if created else '总结已更新')
    return await run_db(_impl)


# ─── 日记本（分册）──────────────────────────────────────

@_authed_router.get('/journals')
async def list_journals():
    def _impl():
        # 单 GROUP BY 取每本计数（原逐本 COUNT 的 N+1 模式）
        counts = dict(db.session.query(Diary.journal_id, func.count(Diary.id))
                      .filter(Diary.deleted_at.is_(None), Diary.kind == 'note')
                      .group_by(Diary.journal_id).all())
        out = [{'id': j.id, 'name': j.name, 'emoji': j.emoji or '📖', 'sort': j.sort,
                'entry_count': counts.get(j.id, 0)}
               for j in DiaryJournal.query.order_by(DiaryJournal.sort, DiaryJournal.id).all()]
        return api_response(out)
    return await run_db(_impl)


@_authed_router.post('/journals')
async def create_journal(request: Request):
    data = await _json_body(request)

    def _impl():
        name = (data.get('name') or '').strip()
        if not name or len(name) > 50:
            raise ParamError(message='本子名必填（≤50 字符）')
        if DiaryJournal.query.filter_by(name=name).count():
            raise ConflictError(message='本子名已存在')
        j = DiaryJournal(name=name, emoji=(data.get('emoji') or '📖')[:8],
                         sort=data.get('sort') or 0)
        db.session.add(j)
        db.session.commit()
        return api_response(j.to_dict(), 201, '创建成功')
    return await run_db(_impl)


@_authed_router.put('/journals/{jid}')
async def update_journal(jid: int, request: Request):
    data = await _json_body(request)

    def _impl():
        j = db.session.get(DiaryJournal, jid)
        if not j:
            raise NotFoundError(message='日记本不存在')
        if 'name' in data:
            name = (data['name'] or '').strip()
            if not name:
                raise ParamError(message='本子名不能为空')
            if DiaryJournal.query.filter(DiaryJournal.name == name,
                                         DiaryJournal.id != jid).count():
                raise ConflictError(message='本子名已存在')
            j.name = name
        if 'emoji' in data:
            j.emoji = (data['emoji'] or '📖')[:8]
        if 'sort' in data and isinstance(data['sort'], int):
            j.sort = data['sort']
        db.session.commit()
        return api_response(j.to_dict())
    return await run_db(_impl)


@_authed_router.delete('/journals/{jid}')
async def delete_journal(jid: int):
    def _impl():
        j = db.session.get(DiaryJournal, jid)
        if not j:
            raise NotFoundError(message='日记本不存在')
        if _live_query().filter(Diary.journal_id == jid).count():
            raise ConflictError(message='本子下仍有日记，先清空或迁移')
        db.session.delete(j)
        db.session.commit()
        return api_response({'id': jid})
    return await run_db(_impl)


# ─── 日历 / 热力图 / 回忆 ───────────────────────────────

@_authed_router.get('/dates')
async def month_dates(request: Request):
    """某月日历：每天 {count, mood}（心情取当天最好），用于色点着色"""
    def _impl():
        params = request.query_params
        year = _arg_int(params, 'year', date.today().year)
        month = _arg_int(params, 'month', date.today().month)
        if not (1 <= month <= 12 and 1900 <= year <= 2200):
            raise ParamError(message='year/month 非法')
        prefix = f'{year:04d}-{month:02d}'
        # 聚合下推：GROUP BY (日期, 心情)，不再整行拉回（含 content 大列）
        rows = (db.session.query(Diary.entry_date, Diary.mood, func.count(Diary.id))
                .filter(Diary.deleted_at.is_(None), Diary.archived_at.is_(None),
                        Diary.entry_date.like(f'{prefix}%'))
                .group_by(Diary.entry_date, Diary.mood).all())
        return api_response({'year': year, 'month': month, 'days': _fold_day_mood(rows)})
    return await run_db(_impl)


@_authed_router.get('/heatmap')
async def heatmap(request: Request):
    """年度热力图：每天 {count, mood}（含归档），max 用于色阶归一化"""
    def _impl():
        year = _arg_int(request.query_params, 'year', date.today().year)
        if not (1900 <= year <= 2200):
            raise ParamError(message='year 非法')
        rows = (db.session.query(Diary.entry_date, Diary.mood, func.count(Diary.id))
                .filter(Diary.deleted_at.is_(None),
                        Diary.entry_date.like(f'{year:04d}%'))
                .group_by(Diary.entry_date, Diary.mood).all())
        days = _fold_day_mood(rows)
        return api_response({'year': year, 'days': days,
                             'max': max((v['count'] for v in days.values()), default=0)})
    return await run_db(_impl)


@_authed_router.get('/onthisday')
async def on_this_day():
    """那年今日：往年同月同日的条目 + 记忆不足三条时补一条随机旧记忆"""
    def _impl():
        today = date.today()
        md = f'{today.month:02d}-{today.day:02d}'
        rows = (_live_query().filter(Diary.archived_at.is_(None),
                                     Diary.entry_date.like(f'%-{md}'),
                                     Diary.entry_date != today.isoformat())
                .order_by(Diary.entry_date.desc()).limit(20).all())
        past = [e.to_dict() for e in rows]
        random = None
        if len(past) < 3:
            pool = (_live_query().filter(Diary.archived_at.is_(None),
                                         Diary.entry_date < today.isoformat())
                    .order_by(Diary.id.desc()).limit(300).all())
            if pool:
                pick = pool[(today.toordinal() * 31 + pool[0].id) % len(pool)]
                random = pick.to_dict()
        return api_response({'today': today.isoformat(), 'past': past, 'random': random})
    return await run_db(_impl)


# ─── 统计 / 趋势 / 年度回顾 ──────────────────────────────

@_authed_router.get('/stats')
async def stats():
    def _impl():
        # 聚合下推：按天 GROUP BY 拿 (天数×心情) 的小结果集，避免整行（含 content）拉回内存
        rows = (db.session.query(Diary.entry_date, func.count(Diary.id),
                                 func.coalesce(func.sum(Diary.word_count), 0))
                .filter(Diary.deleted_at.is_(None), Diary.archived_at.is_(None))
                .group_by(Diary.entry_date).all())
        total = sum(c for _, c, _ in rows)
        words = sum(w for _, _, w in rows)
        ds_set = {d for d, _, _ in rows}
        today = date.today()

        def streak_back(d):
            n = 0
            while d.isoformat() in ds_set:
                n += 1
                d -= timedelta(days=1)
            return n

        current = streak_back(today) if today.isoformat() in ds_set else streak_back(today - timedelta(days=1))
        month_prefix = today.strftime('%Y-%m')
        return api_response({
            'total': total,
            'words': words,
            'current_streak': current,
            'longest_streak': _longest_streak(ds_set),
            'month_count': sum(c for d, c, _ in rows if d.startswith(month_prefix)),
            'journals': DiaryJournal.query.count(),
        })
    return await run_db(_impl)


@_authed_router.get('/trends')
async def trends(request: Request):
    """近 N 个月（默认 12）：每月 {month, entries, words, mood_avg}，缺月补零"""
    def _impl():
        months = min(36, max(1, _arg_int(request.query_params, 'months', 12)))
        today = date.today()
        # 往前 months-1 个月的月初（不能用天数差，月份长度不一）
        m_off = today.month - (months - 1)
        first_y, first_m = today.year + (m_off - 1) // 12, (m_off - 1) % 12 + 1
        first = f'{first_y:04d}-{first_m:02d}'
        live = (Diary.deleted_at.is_(None), Diary.archived_at.is_(None),
                Diary.entry_date >= f'{first}-01')
        agg = {m: {'entries': n, 'words': w, 'mood_sum': 0, 'mood_n': 0}
               for m, n, w in db.session.query(
                   func.substr(Diary.entry_date, 1, 7), func.count(Diary.id),
                   func.coalesce(func.sum(Diary.word_count), 0))
               .filter(*live).group_by(func.substr(Diary.entry_date, 1, 7)).all()}
        for m, mood, n in (db.session.query(func.substr(Diary.entry_date, 1, 7),
                                            Diary.mood, func.count(Diary.id))
                           .filter(*live, Diary.mood.in_(MOOD_SCORE))
                           .group_by(func.substr(Diary.entry_date, 1, 7), Diary.mood).all()):
            a = agg.setdefault(m, {'entries': 0, 'words': 0, 'mood_sum': 0, 'mood_n': 0})
            a['mood_sum'] += MOOD_SCORE[mood] * n
            a['mood_n'] += n
        out = []
        cur = date(first_y, first_m, 1)
        for _ in range(months):
            key = cur.strftime('%Y-%m')
            a = agg.get(key, {'entries': 0, 'words': 0, 'mood_sum': 0, 'mood_n': 0})
            out.append({'month': key, 'entries': a['entries'], 'words': a['words'],
                        'mood_avg': round(a['mood_sum'] / a['mood_n'], 2) if a['mood_n'] else None})
            cur = (cur.replace(day=28) + timedelta(days=5)).replace(day=1)
        return api_response({'months': out})
    return await run_db(_impl)


@_authed_router.get('/yearend')
async def yearend(request: Request):
    """年度回顾：篇数/字数/心情分布/高频标签/最长连续/最活跃月"""
    def _impl():
        year = _arg_int(request.query_params, 'year', date.today().year)
        rows = (db.session.query(Diary.entry_date, Diary.mood, func.count(Diary.id),
                                 func.coalesce(func.sum(Diary.word_count), 0))
                .filter(Diary.deleted_at.is_(None),
                        Diary.entry_date.like(f'{year:04d}%'))
                .group_by(Diary.entry_date, Diary.mood).all())
        if not rows:
            return api_response({'year': year, 'empty': True})
        mood_dist, month_words, ds_set = {}, {}, set()
        entries = words = 0
        for entry_date, mood, cnt, wc in rows:
            entries += cnt
            words += wc
            ds_set.add(entry_date)
            if mood:
                mood_dist[mood] = mood_dist.get(mood, 0) + cnt
            month_words[entry_date[:7]] = month_words.get(entry_date[:7], 0) + wc
        top_month = max(month_words, key=month_words.get) if month_words else None
        return api_response({
            'year': year, 'entries': entries,
            'words': words, 'days': len(ds_set),
            'mood_dist': mood_dist,
            'longest_streak': _longest_streak(ds_set),
            'top_month': top_month,
            'top_month_words': month_words.get(top_month, 0) if top_month else 0,
        })
    return await run_db(_impl)


# ─── 分享（单篇只读，免登录）────────────────────────────

@_authed_router.post('/entries/{entry_id}/share')
async def create_share(entry_id: int, request: Request):
    data = await _json_body(request)

    def _impl():
        entry = db.session.get(Diary, entry_id)
        if not entry or entry.deleted_at:
            raise NotFoundError(message='日记不存在')
        hours = data.get('expires_hours', 72)
        if not isinstance(hours, int) or not (1 <= hours <= 24 * 365):
            raise ParamError(message='expires_hours 需为 1-8760 的整数（小时）')
        entry.share_token = secrets.token_urlsafe(24)
        entry.share_expires = _utcnow() + timedelta(hours=hours)
        db.session.commit()
        return api_response({'token': entry.share_token,
                             'expires_at': _iso(entry.share_expires)}, 201, '分享已创建')
    return await run_db(_impl)


@_authed_router.delete('/entries/{entry_id}/share')
async def revoke_share(entry_id: int):
    def _impl():
        entry = db.session.get(Diary, entry_id)
        if not entry:
            raise NotFoundError(message='日记不存在')
        entry.share_token = None
        entry.share_expires = None
        db.session.commit()
        return api_response({'id': entry_id, 'revoked': True})
    return await run_db(_impl)


@_public_router.get('/share/{token}')
async def public_share(token: str):
    """免登录只读分享（不挂 Basic Auth）：过期/撤销/删除一律 404，不泄露存在性"""
    def _impl():
        entry = Diary.query.filter_by(share_token=token).first()
        if not entry or entry.deleted_at:
            raise NotFoundError(message='分享不存在或已失效')
        if entry.share_expires and entry.share_expires < _utcnow():
            raise NotFoundError(message='分享已过期')
        return api_response({'entry': entry.to_public_dict()})
    return await run_db(_impl)


# ─── 导出 / 模板 / 引导问题 ──────────────────────────────

@_authed_router.get('/export')
async def export_zip():
    """全量 Markdown zip：按 本子/日期-ID.md 命名，frontmatter 含日期/心情/标签/天气/位置"""
    def _impl():
        buf = io.BytesIO()
        journals = {j.id: (j.emoji or '📖') + j.name for j in DiaryJournal.query.all()}
        rows = Diary.query.filter(Diary.deleted_at.is_(None)).order_by(Diary.entry_date).all()
        used = set()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
            for e in rows:
                folder = journals.get(e.journal_id, '默认')
                fname = f'{folder}/{e.entry_date}-{e.id}.md'
                while fname in used:
                    fname = f'{folder}/{e.entry_date}-{e.id}-{secrets.token_hex(2)}.md'
                used.add(fname)
                meta = [f'date: {e.entry_date}']
                if e.mood:
                    meta.append(f'mood: {e.mood}')
                tags = e._parse_tags()
                if tags:
                    meta.append('tags: [' + ', '.join(tags) + ']')
                if e.weather:
                    meta.append(f'weather: {e.weather}')
                if e.location:
                    meta.append(f'location: {e.location}')
                z.writestr(fname, '---\n' + '\n'.join(meta) + '\n---\n\n' + (e.content or '') + '\n')
            z.writestr('README.txt', f'DouBlog 日记导出 · {date.today().isoformat()} · 共 {len(rows)} 篇\n')
        return Response(
            content=buf.getvalue(),
            media_type='application/zip',
            headers={'Content-Disposition':
                     f"attachment; filename*=UTF-8''{quote('diary-export.zip')}"},
        )
    return await run_db(_impl)


@_authed_router.get('/templates')
async def list_templates():
    return api_response(TEMPLATES)


@_authed_router.get('/prompt')
async def daily_prompt(request: Request):
    """今日（或指定日期）写作引导问题：按日期确定性轮换，同一天所有人看到同一条"""
    d = _parse_date(request.query_params.get('date')) or date.today()
    idx = (d.toordinal() * 7 + 3) % len(PROMPTS)
    return api_response({'date': d.isoformat(), 'prompt': PROMPTS[idx], 'total': len(PROMPTS)})
