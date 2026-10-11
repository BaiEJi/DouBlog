"""
订阅管理 API（CrownFlow 迁移）

- 会员：GET/POST /api/subs/members、GET/PUT/DELETE /api/subs/members/<id>
  （列表支持 ?page= ?page_size= ?keyword= ?category_id= ?status= ?sort_by= ?order=）
- 订阅记录：GET/POST /api/subs/members/<id>/subscriptions、GET/PUT/DELETE /api/subs/subscriptions/<id>
- 分类：GET/POST /api/subs/categories、PUT/DELETE /api/subs/categories/<id>
- 统计：GET /api/subs/stats/overview | spending | by-category | category-summary | trend
- 提醒：GET /api/subs/reminders/upcoming | all
- 备份：POST /api/subs/backup/run（手动）、GET /api/subs/backup（统计+列表）
  另有每日后台线程：02:00 自动备份、10:00 当日支出摘要日志（settings.subs_backup_enabled 关闭备份）

支出计算：日均 = 价格 / 计费周期天数；实际支出 = 日均 × 与查询范围重叠天数（闭区间）；
跨币种按 settings.subs_exchange_rates 静态汇率折算基准币（CNY）。
日期一律 YYYY-MM-DD 字符串比较（跨 SQLite/PG 一致）。
"""

import threading
import time
from collections import defaultdict, namedtuple
from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func as sql_func
from sqlalchemy.orm import joinedload

from app.config import settings
from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.modules import mod_logger
from app.shared.response import api_response
from app.subs import backup as subs_backup
from app.subs.currency import (
    VALID_BILLING_CYCLES,
    VALID_CURRENCIES,
    calculate_daily_rate,
    convert_to_base,
    date_ordinal,
    parse_date,
)
from app.subs.models import SubsCategory, SubsMember, SubsSubscription
from lizysdk.errors import ConflictError, NotFoundError, ParamError

router = APIRouter(prefix='/api/subs', dependencies=[Depends(require_basic)])

DATE_FMT = '%Y-%m-%d'


# ─── 校验工具 ─────────────────────────────────────────────

async def _json_or_empty(request: Request) -> dict:
    """等价 request.get_json(silent=True) or {}（解析失败/空体 → {}）"""
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001 与 silent=True 对齐
        return {}
    return data or {}


async def _json_or_none(request: Request):
    """等价 request.get_json(silent=True)（解析失败/空体 → None，由调用方报错）"""
    try:
        return await request.json()
    except Exception:  # noqa: BLE001 与 silent=True 对齐
        return None


def _query_int(params, name, default=None):
    """等价 request.args.get(name, default, type=int)（转换失败回退默认值）"""
    raw = params.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _valid_date(raw, field):
    """日期格式校验，返回 (date 对象, None) 或 (None, 错误信息)"""
    try:
        return datetime.strptime(raw, DATE_FMT).date(), None
    except (ValueError, TypeError):
        return None, f'{field}格式错误，应为 YYYY-MM-DD'


def _valid_price(raw, field='价格'):
    """价格校验，返回 (规范化字符串, 错误信息)"""
    try:
        v = float(raw)
    except (ValueError, TypeError):
        return None, f'{field}必须为有效数字'
    if v < 0:
        return None, f'{field}不能为负数'
    return str(v), None


def _validate_subscription_payload(data: dict, partial: bool = False):
    """
    校验订阅字段，返回规范化 dict。

    partial=True 时仅校验出现的字段（PUT）；billing_cycle/custom_days 组合
    在 partial 下按「新值 ?? 旧值」由调用方补齐后二次校验（见 update 路由）。
    """
    out = {}
    keys = ('level', 'price', 'currency', 'billing_cycle', 'custom_days',
            'start_date', 'end_date', 'channel', 'notes')
    if partial:
        keys = tuple(k for k in keys if k in data)

    if 'level' in keys:
        level = data.get('level')
        if level is not None and not isinstance(level, str):
            return None, 'level 必须为字符串'
        out['level'] = level

    if 'price' in keys:
        if data.get('price') is None:
            return None, '价格不能为空'
        price_s, err = _valid_price(data['price'])
        if err:
            return None, err
        out['price'] = price_s

    if 'currency' in keys:
        currency = data.get('currency') or 'CNY'
        if currency not in VALID_CURRENCIES:
            return None, f'币种必须是: {", ".join(VALID_CURRENCIES)}'
        out['currency'] = currency

    if 'billing_cycle' in keys:
        cycle = data.get('billing_cycle')
        if not cycle:
            return None, '计费周期不能为空'
        if cycle not in VALID_BILLING_CYCLES:
            return None, f'计费周期必须是: {", ".join(VALID_BILLING_CYCLES)}'
        out['billing_cycle'] = cycle

    if 'custom_days' in keys:
        cd = data.get('custom_days')
        if cd is not None:
            try:
                cd = int(cd)
            except (ValueError, TypeError):
                return None, '自定义天数必须为整数'
            if cd <= 0:
                return None, '自定义天数必须大于0'
            out['custom_days'] = cd
        else:
            out['custom_days'] = None

    if 'start_date' in keys:
        if not data.get('start_date'):
            return None, '开始日期不能为空'
        _, err = _valid_date(data['start_date'], '开始日期')
        if err:
            return None, err
        out['start_date'] = data['start_date']

    if 'end_date' in keys:
        if not data.get('end_date'):
            return None, '结束日期不能为空'
        _, err = _valid_date(data['end_date'], '结束日期')
        if err:
            return None, err
        out['end_date'] = data['end_date']

    if 'channel' in keys:
        channel = data.get('channel')
        if channel is not None and not isinstance(channel, str):
            return None, 'channel 必须为字符串'
        out['channel'] = channel

    if 'notes' in keys:
        notes = data.get('notes')
        if notes is not None and not isinstance(notes, str):
            return None, 'notes 必须为字符串'
        out['notes'] = notes

    # 组合校验（partial 时以提交值为准的成对字段）
    if {'start_date', 'end_date'} <= out.keys() and out['start_date'] > out['end_date']:
        return None, '开始日期不能大于结束日期'
    return out, None


def _require_member(member_id) -> SubsMember:
    member = db.session.get(SubsMember, member_id)
    if not member:
        raise NotFoundError(message='会员不存在')
    return member


# ─── 分类 ─────────────────────────────────────────────────

@router.get('/categories')
async def list_categories():
    def _impl():
        cats = SubsCategory.query.order_by(SubsCategory.created_at, SubsCategory.id).all()
        return api_response([c.to_dict() for c in cats])
    return await run_db(_impl)


@router.post('/categories')
async def create_category(request: Request):
    data = await _json_or_empty(request)

    def _impl():
        name = (data.get('name') or '').strip()
        if not name:
            raise ParamError(message='分类名称不能为空')
        if len(name) > 50:
            raise ParamError(message='分类名称长度不能超过50个字符')
        if SubsCategory.query.filter(SubsCategory.name == name).first():
            raise ConflictError(message='分类名称已存在')
        cat = SubsCategory(name=name, icon=data.get('icon'), color=data.get('color'))
        db.session.add(cat)
        db.session.commit()
        return api_response(cat.to_dict(), 201, '创建成功')
    return await run_db(_impl)


@router.put('/categories/{cat_id}')
async def update_category(cat_id: int, request: Request):
    data = await _json_or_empty(request)

    def _impl():
        cat = db.session.get(SubsCategory, cat_id)
        if not cat:
            raise NotFoundError(message='分类不存在')
        if 'name' in data:
            name = (data['name'] or '').strip()
            if not name:
                raise ParamError(message='分类名称不能为空')
            if len(name) > 50:
                raise ParamError(message='分类名称长度不能超过50个字符')
            dup = SubsCategory.query.filter(SubsCategory.name == name, SubsCategory.id != cat_id).first()
            if dup:
                raise ConflictError(message='分类名称已存在')
            cat.name = name
        if 'icon' in data:
            cat.icon = data['icon']
        if 'color' in data:
            cat.color = data['color']
        db.session.commit()
        return api_response(cat.to_dict(), 200, '更新成功')
    return await run_db(_impl)


@router.delete('/categories/{cat_id}')
async def delete_category(cat_id: int):
    def _impl():
        cat = db.session.get(SubsCategory, cat_id)
        if not cat:
            raise NotFoundError(message='分类不存在')
        if SubsMember.query.filter(SubsMember.category_id == cat_id).count() > 0:
            raise ParamError(message='该分类下存在会员，无法删除')
        db.session.delete(cat)
        db.session.commit()
        return api_response({'deleted': True}, 200, '删除成功')
    return await run_db(_impl)


# ─── 会员 ─────────────────────────────────────────────────

@router.get('/members')
async def list_members(request: Request):
    def _impl():
        page = max(1, _query_int(request.query_params, 'page', 1))
        page_size = min(max(1, _query_int(request.query_params, 'page_size', 10)),
                        settings.max_page_size)

        q = SubsMember.query.options(
            joinedload(SubsMember.category), joinedload(SubsMember.subscriptions))

        keyword = (request.query_params.get('keyword') or '').strip()
        if keyword:
            q = q.filter(SubsMember.name.ilike(f'%{keyword}%'))

        category_id = _query_int(request.query_params, 'category_id')
        if category_id is not None:
            q = q.filter(SubsMember.category_id == category_id)

        status = request.query_params.get('status')
        if status:
            today = datetime.now().strftime(DATE_FMT)
            if status not in ('active', 'expired'):
                raise ParamError(message='status 必须是 active 或 expired')
            active_ids = (db.session.query(SubsSubscription.member_id)
                          .filter(SubsSubscription.end_date >= today).distinct()
                          .subquery().select())
            if status == 'active':
                q = q.filter(SubsMember.id.in_(active_ids))
            else:
                q = q.filter(SubsMember.id.notin_(active_ids))

        sort_by = request.query_params.get('sort_by', 'created_at')
        order = request.query_params.get('order', 'desc')
        if sort_by not in ('created_at', 'name'):
            raise ParamError(message='无效的排序字段，可选: created_at, name')
        col = getattr(SubsMember, sort_by)
        q = q.order_by(col.asc() if order == 'asc' else col.desc(), SubsMember.id.desc())

        total = q.count()
        items = q.offset((page - 1) * page_size).limit(page_size).all()
        return api_response({'items': [m.to_dict() for m in items], 'total': total})
    return await run_db(_impl)


@router.get('/members/{member_id}')
async def get_member(member_id: int):
    def _impl():
        member = (SubsMember.query.options(
            joinedload(SubsMember.category), joinedload(SubsMember.subscriptions))
            .filter(SubsMember.id == member_id).first())
        if not member:
            raise NotFoundError(message='会员不存在')
        return api_response(member.to_dict(include_subscriptions=True))
    return await run_db(_impl)


@router.post('/members')
async def create_member(request: Request):
    data = await _json_or_none(request)

    def _impl():
        if not data:
            raise ParamError(message='请求体不能为空')

        name = (data.get('name') or '').strip()
        if not name:
            raise ParamError(message='会员名称不能为空')
        if len(name) > 100:
            raise ParamError(message='会员名称长度不能超过100个字符')

        if data.get('category_id') is not None:
            if not db.session.get(SubsCategory, data['category_id']):
                raise ParamError(message='分类不存在')

        sub_payload = None
        if data.get('subscription'):
            sub_payload, err = _validate_subscription_payload(data['subscription'])
            if err:
                raise ParamError(message=err)

        member = SubsMember(
            name=name,
            category_id=data.get('category_id'),
            notes=data.get('notes'),
            reminder_days=data.get('reminder_days', settings.subs_default_reminder_days))
        db.session.add(member)
        db.session.flush()
        if sub_payload:
            db.session.add(SubsSubscription(member_id=member.id, **sub_payload))
        db.session.commit()
        return api_response(member.to_dict(include_subscriptions=True), 201, '创建成功')
    return await run_db(_impl)


@router.put('/members/{member_id}')
async def update_member(member_id: int, request: Request):
    data = await _json_or_empty(request)

    def _impl():
        member = _require_member(member_id)

        if 'name' in data:
            name = (data['name'] or '').strip()
            if not name:
                raise ParamError(message='会员名称不能为空')
            if len(name) > 100:
                raise ParamError(message='会员名称长度不能超过100个字符')
            member.name = name

        if 'category_id' in data and data['category_id'] is not None:
            if not db.session.get(SubsCategory, data['category_id']):
                raise ParamError(message='分类不存在')

        for field in ('category_id', 'notes', 'reminder_days'):
            if field in data:
                setattr(member, field, data[field])

        db.session.commit()
        return api_response(member.to_dict(include_subscriptions=True), 200, '更新成功')
    return await run_db(_impl)


@router.delete('/members/{member_id}')
async def delete_member(member_id: int):
    def _impl():
        member = _require_member(member_id)
        db.session.delete(member)   # 订阅记录级联删除（delete-orphan）
        db.session.commit()
        return api_response({'deleted': True}, 200, '删除成功')
    return await run_db(_impl)


# ─── 订阅记录 ─────────────────────────────────────────────

@router.get('/members/{member_id}/subscriptions')
async def list_member_subscriptions(member_id: int, request: Request):
    def _impl():
        _require_member(member_id)
        q = SubsSubscription.query.filter(SubsSubscription.member_id == member_id)

        status = request.query_params.get('status')
        if status:
            today = datetime.now().strftime(DATE_FMT)
            if status == 'active':
                q = q.filter(SubsSubscription.end_date >= today)
            elif status == 'expired':
                q = q.filter(SubsSubscription.end_date < today)
            else:
                raise ParamError(message='status 必须是 active 或 expired')

        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        if start_date and end_date:
            if start_date > end_date:
                raise ParamError(message='开始日期不能大于结束日期')
            q = q.filter(SubsSubscription.start_date <= end_date,
                         SubsSubscription.end_date >= start_date)

        sort_by = request.query_params.get('sort_by', 'created_at')
        order = request.query_params.get('order', 'desc')
        if sort_by not in ('created_at', 'start_date', 'end_date', 'price'):
            raise ParamError(message='无效的排序字段，可选: created_at, start_date, end_date, price')
        col = getattr(SubsSubscription, sort_by)
        q = q.order_by(col.asc() if order == 'asc' else col.desc(), SubsSubscription.id.desc())

        items = q.all()
        return api_response({'items': [s.to_dict() for s in items], 'total': len(items)})
    return await run_db(_impl)


@router.post('/members/{member_id}/subscriptions')
async def create_subscription(member_id: int, request: Request):
    data = await _json_or_none(request)

    def _impl():
        _require_member(member_id)
        if not data:
            raise ParamError(message='请求体不能为空')
        payload, err = _validate_subscription_payload(data)
        if err:
            raise ParamError(message=err)
        if payload['billing_cycle'] == 'custom' and not payload.get('custom_days'):
            raise ParamError(message='自定义周期必须提供 custom_days')
        sub = SubsSubscription(member_id=member_id, **payload)
        db.session.add(sub)
        db.session.commit()
        return api_response(sub.to_dict(), 201, '创建成功')
    return await run_db(_impl)


@router.get('/subscriptions/{sub_id}')
async def get_subscription(sub_id: int):
    def _impl():
        sub = (SubsSubscription.query.options(joinedload(SubsSubscription.member))
               .filter(SubsSubscription.id == sub_id).first())
        if not sub:
            raise NotFoundError(message='订阅记录不存在')
        result = sub.to_dict()
        if sub.member:
            result['member_name'] = sub.member.name
        return api_response(result)
    return await run_db(_impl)


@router.put('/subscriptions/{sub_id}')
async def update_subscription(sub_id: int, request: Request):
    data = await _json_or_empty(request)

    def _impl():
        sub = db.session.get(SubsSubscription, sub_id)
        if not sub:
            raise NotFoundError(message='订阅记录不存在')
        payload, err = _validate_subscription_payload(data, partial=True)
        if err:
            raise ParamError(message=err)

        start = payload.get('start_date', sub.start_date)
        end = payload.get('end_date', sub.end_date)
        if start > end:
            raise ParamError(message='开始日期不能大于结束日期')
        cycle = payload.get('billing_cycle', sub.billing_cycle)
        custom_days = payload['custom_days'] if 'custom_days' in payload else sub.custom_days
        if cycle == 'custom' and not custom_days:
            raise ParamError(message='自定义周期必须提供 custom_days')

        for field, value in payload.items():
            setattr(sub, field, value)
        db.session.commit()
        return api_response(sub.to_dict(), 200, '更新成功')
    return await run_db(_impl)


@router.delete('/subscriptions/{sub_id}')
async def delete_subscription(sub_id: int):
    def _impl():
        sub = db.session.get(SubsSubscription, sub_id)
        if not sub:
            raise NotFoundError(message='订阅记录不存在')
        db.session.delete(sub)
        db.session.commit()
        return api_response({'deleted': True}, 200, '删除成功')
    return await run_db(_impl)


# ─── 统计分析 ─────────────────────────────────────────────

def _overlap_ord(s_ord: int, e_ord: int, q_ord: int, qe_ord: int) -> int:
    """闭区间重叠天数（序数版：配合 _SpendRow 预计算，热路径零解析零 ORM 访问；≤0 即无重叠）"""
    return min(e_ord, qe_ord) - max(s_ord, q_ord) + 1


#: 统计行预计算：一次日期解析 + 一次日均计算（原币/基准币），避免逐期 × 逐订阅重复
#: strptime/Decimal/ORM 属性访问（trend 月粒度 12 期 × N 订阅下原先重复算 12 遍）
_SpendRow = namedtuple('_SpendRow', (
    'sub_id',        # 订阅 id（明细引用）
    'member_name',   # 会员名（明细展示；无会员 → '未知'）
    'level',         # 会员级别
    'cat',           # 会员分类对象（或 None）
    'cat_id',        # 分类 id（无会员 → 0；无分类 → None，与旧实现的真值判断一致）
    'start_ord',     # start_date 序数
    'end_ord',       # end_date 序数
    'daily',         # 日均价格（原币种 Decimal）
    'daily_base',    # 日均价格（折算基准币 Decimal）
    'currency',      # 币种
))


def _spend_rows(subs) -> list:
    """把 ORM 订阅列表预计算成 _SpendRow（统计五接口共用的热点前置步骤）"""
    rows = []
    for sub in subs:
        member = sub.member
        cat = member.category if member is not None else None
        daily = calculate_daily_rate(sub.price, sub.billing_cycle, sub.custom_days, sub.start_date)
        rows.append(_SpendRow(
            sub_id=sub.id,
            member_name=member.name if member is not None else '未知',
            level=sub.level,
            cat=cat,
            cat_id=(member.category_id if member is not None else 0),
            start_ord=date_ordinal(sub.start_date),
            end_ord=date_ordinal(sub.end_date),
            daily=daily,
            daily_base=convert_to_base(daily, sub.currency),
            currency=sub.currency,
        ))
    return rows


def _month_year_bounds():
    now = datetime.now()
    month_start = now.replace(day=1).strftime(DATE_FMT)
    month_end = ((now.replace(day=1) + timedelta(days=32)).replace(day=1)
                 - timedelta(days=1)).strftime(DATE_FMT)
    year_start = now.replace(month=1, day=1).strftime(DATE_FMT)
    year_end = now.replace(month=12, day=31).strftime(DATE_FMT)
    return month_start, month_end, year_start, year_end


def _require_range_args(request: Request):
    start_date = request.query_params.get('start_date')
    end_date = request.query_params.get('end_date')
    if not start_date or not end_date:
        raise ParamError(message='开始日期和结束日期不能为空')
    _, err = _valid_date(start_date, '开始日期')
    if err:
        raise ParamError(message=err)
    _, err = _valid_date(end_date, '结束日期')
    if err:
        raise ParamError(message=err)
    if start_date > end_date:
        raise ParamError(message='开始日期不能大于结束日期')
    return start_date, end_date


def _range_subscriptions(start_date, end_date):
    return (SubsSubscription.query.options(
        joinedload(SubsSubscription.member).joinedload(SubsMember.category))
        .filter(SubsSubscription.end_date >= start_date,
                SubsSubscription.start_date <= end_date).all())


@router.get('/stats/overview')
async def stats_overview():
    def _impl():
        """会员总数 / 活跃会员 / 本月支出 / 年度支出（折算基准币）"""
        today = datetime.now().strftime(DATE_FMT)
        month_start, month_end, year_start, year_end = _month_year_bounds()
        m_s, m_e = date_ordinal(month_start), date_ordinal(month_end)
        y_s, y_e = date_ordinal(year_start), date_ordinal(year_end)

        total_members = SubsMember.query.count()
        active_members = (db.session.query(sql_func.distinct(SubsSubscription.member_id))
                          .filter(SubsSubscription.end_date >= today).count())

        # 一次预计算（解析/日均只算一遍），月与年两口径走整数重叠
        monthly = Decimal('0')
        yearly = Decimal('0')
        for row in _spend_rows(_range_subscriptions(year_start, year_end)):
            ov = _overlap_ord(row.start_ord, row.end_ord, m_s, m_e)
            if ov > 0:
                monthly += row.daily_base * ov
            ov = _overlap_ord(row.start_ord, row.end_ord, y_s, y_e)
            if ov > 0:
                yearly += row.daily_base * ov

        return api_response({
            'total_members': total_members,
            'active_members': active_members,
            'monthly_spending': float(monthly.quantize(Decimal('0.01'))),
            'yearly_spending': float(yearly.quantize(Decimal('0.01'))),
        })
    return await run_db(_impl)


@router.get('/stats/spending')
async def stats_spending(request: Request):
    def _impl():
        """按日期范围：总额 / 日均 / 按币种 / 按分类（含占比）"""
        start_date, end_date = _require_range_args(request)
        q_s, q_e = date_ordinal(start_date), date_ordinal(end_date)
        total = Decimal('0')
        by_currency = defaultdict(Decimal)
        cat_stats = defaultdict(lambda: {'total': Decimal('0'), 'count': 0})
        cat_meta = {}

        for row in _spend_rows(_range_subscriptions(start_date, end_date)):
            ov = _overlap_ord(row.start_ord, row.end_ord, q_s, q_e)
            if ov <= 0:
                continue
            spend = row.daily_base * ov
            total += spend
            by_currency[row.currency] += row.daily * ov
            if row.cat_id:
                cat_stats[row.cat_id]['total'] += spend
                cat_stats[row.cat_id]['count'] += 1
                cat_meta.setdefault(row.cat_id, row.cat)

        days = ((parse_date(end_date).toordinal()) - (parse_date(start_date).toordinal())) + 1
        daily_average = total / Decimal(days) if days > 0 else Decimal('0')

        categories = []
        for cat_id, st in cat_stats.items():
            cat = cat_meta.get(cat_id)
            pct = float(st['total'] / total * 100) if total > 0 else 0
            categories.append({
                'category_id': cat_id,
                'category_name': cat.name if cat else '未分类',
                'category_icon': cat.icon if cat else None,
                'category_color': cat.color if cat else None,
                'total': float(st['total'].quantize(Decimal('0.01'))),
                'count': st['count'],
                'percentage': round(pct, 2),
            })
        categories.sort(key=lambda x: x['total'], reverse=True)

        return api_response({
            'total': float(total.quantize(Decimal('0.01'))),
            'daily_average': float(daily_average.quantize(Decimal('0.01'))),
            'by_currency': {k: float(v.quantize(Decimal('0.01'))) for k, v in by_currency.items()},
            'categories': categories,
        })
    return await run_db(_impl)


@router.get('/stats/by-category')
async def stats_by_category(request: Request):
    def _impl():
        """按分类统计（含每分类下的订阅明细，按金额降序）"""
        start_date, end_date = _require_range_args(request)
        q_s, q_e = date_ordinal(start_date), date_ordinal(end_date)
        cat_totals = defaultdict(Decimal)
        cat_details = defaultdict(list)
        cat_meta = {}
        total = Decimal('0')

        for row in _spend_rows(_range_subscriptions(start_date, end_date)):
            ov = _overlap_ord(row.start_ord, row.end_ord, q_s, q_e)
            if ov <= 0:
                continue
            spend = row.daily_base * ov
            total += spend
            if row.cat_id:
                cat_totals[row.cat_id] += spend
                cat_details[row.cat_id].append({
                    'subscription_id': row.sub_id,
                    'member_name': row.member_name,
                    'level': row.level,
                    'amount': float(spend.quantize(Decimal('0.01'))),
                })
                cat_meta.setdefault(row.cat_id, row.cat)

        result = []
        for cat_id, cat_total in cat_totals.items():
            cat = cat_meta.get(cat_id)
            if not cat:
                continue
            pct = float(cat_total / total * 100) if total > 0 else 0
            result.append({
                'category_id': cat_id,
                'category_name': cat.name,
                'category_icon': cat.icon,
                'category_color': cat.color,
                'total': float(cat_total.quantize(Decimal('0.01'))),
                'percentage': round(pct, 2),
                'details': sorted(cat_details[cat_id], key=lambda x: x['amount'], reverse=True),
            })
        result.sort(key=lambda x: x['total'], reverse=True)
        return api_response({'categories': result, 'total': float(total.quantize(Decimal('0.01')))})
    return await run_db(_impl)


@router.get('/stats/category-summary')
async def stats_category_summary():
    def _impl():
        """各分类本月 + 年度支出汇总（Dashboard 表格）"""
        month_start, month_end, year_start, year_end = _month_year_bounds()
        m_s, m_e = date_ordinal(month_start), date_ordinal(month_end)
        y_s, y_e = date_ordinal(year_start), date_ordinal(year_end)
        cat_monthly = defaultdict(Decimal)
        cat_yearly = defaultdict(Decimal)
        cat_meta = {}

        for row in _spend_rows(_range_subscriptions(year_start, year_end)):
            if not row.cat_id:
                continue
            ov = _overlap_ord(row.start_ord, row.end_ord, m_s, m_e)
            if ov > 0:
                cat_monthly[row.cat_id] += row.daily_base * ov
            ov = _overlap_ord(row.start_ord, row.end_ord, y_s, y_e)
            if ov > 0:
                cat_yearly[row.cat_id] += row.daily_base * ov
            cat_meta.setdefault(row.cat_id, row.cat)

        categories = [{
            'category_id': cat_id,
            'category_name': cat.name,
            'category_icon': cat.icon,
            'category_color': cat.color,
            'monthly_spending': float(cat_monthly[cat_id].quantize(Decimal('0.01'))),
            'yearly_spending': float(cat_yearly[cat_id].quantize(Decimal('0.01'))),
        } for cat_id, cat in cat_meta.items()]
        categories.sort(key=lambda x: x['yearly_spending'], reverse=True)

        return api_response({
            'categories': categories,
            'total_monthly': float(sum(cat_monthly.values(), Decimal('0')).quantize(Decimal('0.01'))),
            'total_yearly': float(sum(cat_yearly.values(), Decimal('0')).quantize(Decimal('0.01'))),
        })
    return await run_db(_impl)


@router.get('/stats/trend')
async def stats_trend(request: Request):
    def _impl():
        """支出趋势（day/week/month/quarter 粒度，含分类明细）"""
        start_date, end_date = _require_range_args(request)
        granularity = request.query_params.get('granularity', 'month')
        if granularity not in ('day', 'week', 'month', 'quarter'):
            raise ParamError(message='granularity 必须是 day/week/month/quarter')

        start_dt = datetime.strptime(start_date, DATE_FMT)
        end_dt = datetime.strptime(end_date, DATE_FMT)

        periods = []  # (period_start, period_end, label)
        if granularity == 'day':
            cur = start_dt
            while cur <= end_dt:
                key = cur.strftime(DATE_FMT)
                periods.append((key, key, key))
                cur += timedelta(days=1)
        elif granularity == 'month':
            cur = start_dt.replace(day=1)
            while cur <= end_dt.replace(day=1):
                next_month = (cur.replace(day=28) + timedelta(days=4)).replace(day=1)
                periods.append((cur.strftime(DATE_FMT),
                                (next_month - timedelta(days=1)).strftime(DATE_FMT),
                                cur.strftime('%Y-%m')))
                cur = next_month
        elif granularity == 'week':
            first_mon = start_dt + timedelta(days=(7 - start_dt.weekday()) % 7)
            last_mon = end_dt - timedelta(days=end_dt.weekday())
            cur = first_mon
            while cur <= last_mon:
                p_start, p_end = cur, cur + timedelta(days=6)
                periods.append((p_start.strftime(DATE_FMT), p_end.strftime(DATE_FMT),
                                f"{p_start.strftime('%m/%d')}-{p_end.strftime('%m/%d')}"))
                cur += timedelta(days=7)
        else:  # quarter
            def quarter_start(dt):
                return dt.replace(month=(dt.month - 1) // 3 * 3 + 1, day=1)

            cur = quarter_start(start_dt)
            while cur <= quarter_start(end_dt):
                q_end_month = cur.month + 2
                p_end = (cur.replace(year=cur.year + 1, month=1, day=1) if q_end_month == 12
                         else cur.replace(month=q_end_month + 1, day=1)) - timedelta(days=1)
                periods.append((cur.strftime(DATE_FMT), p_end.strftime(DATE_FMT),
                                f"{cur.year}-Q{(cur.month - 1) // 3 + 1}"))
                cur = (cur.replace(year=cur.year + 1, month=1, day=1) if q_end_month == 12
                       else cur.replace(month=q_end_month + 1, day=1))

        # 热点预计算：日均/日期解析/关联访问只做一遍（原先在 期×订阅 双层循环里逐格重算，
        # 月粒度 12 期 × N 订阅 = 12N 次 strptime+Decimal；现在 N 次预计算 + 12N 次整数运算）
        rows = _spend_rows(_range_subscriptions(start_date, end_date))

        trend = []
        for p_start, p_end, label in periods:
            p_s, p_e = date_ordinal(p_start), date_ordinal(p_end)
            cat_details = {}
            for row in rows:
                overlap = _overlap_ord(row.start_ord, row.end_ord, p_s, p_e)
                if overlap <= 0:
                    continue
                spend = row.daily_base * overlap
                bucket = cat_details.get(row.cat_id)
                if bucket is None:
                    cat = row.cat
                    bucket = cat_details[row.cat_id] = {
                        'category_name': cat.name if cat else '未分类',
                        'category_color': (cat.color if cat and cat.color else '#a8a29e'),
                        'total': Decimal('0'),
                        'subscriptions': [],
                    }
                bucket['total'] += spend
                bucket['subscriptions'].append({
                    'subscription_id': row.sub_id,
                    'member_name': row.member_name,
                    'level': row.level,
                    'amount': float(spend.quantize(Decimal('0.01'))),
                })

            details = []
            period_total = Decimal('0')
            for cat_id in sorted(cat_details, key=lambda k: cat_details[k]['total'], reverse=True):
                bucket = cat_details[cat_id]
                if bucket['total'] <= 0:
                    continue
                details.append({
                    'category_id': cat_id,
                    'category_name': bucket['category_name'],
                    'category_color': bucket['category_color'],
                    'total': float(bucket['total'].quantize(Decimal('0.01'))),
                    'subscriptions': sorted(bucket['subscriptions'],
                                            key=lambda x: x['amount'], reverse=True),
                })
                period_total += bucket['total']

            trend.append({
                'date': label,
                'amount': float(period_total.quantize(Decimal('0.01'))),
                'details': details,
            })

        return api_response({'trend': trend})
    return await run_db(_impl)


# ─── 到期提醒 ─────────────────────────────────────────────

def _reminder_item(sub, today):
    end = parse_date(sub.end_date)
    member = sub.member
    cat = member.category if member else None
    return {
        'subscription_id': sub.id,
        'member_id': member.id,
        'member_name': member.name,
        'level': sub.level,
        'category_name': cat.name if cat else None,
        'category_icon': cat.icon if cat else None,
        'category_color': cat.color if cat else None,
        'end_date': sub.end_date,
        'days_remaining': (end - today).days,
        'price': float(sub.price) if sub.price is not None else 0,
        'currency': sub.currency,
    }


@router.get('/reminders/upcoming')
async def reminders_upcoming():
    def _impl():
        """即将到期：end_date >= 今天 且 剩余天数 <= 会员 reminder_days"""
        today = datetime.now().date()
        subs = (SubsSubscription.query.options(
            joinedload(SubsSubscription.member).joinedload(SubsMember.category))
            .filter(SubsSubscription.end_date >= today.strftime(DATE_FMT))
            .order_by(SubsSubscription.end_date).all())

        reminders = []
        for sub in subs:
            if not sub.member:
                continue
            item = _reminder_item(sub, today)
            if item['days_remaining'] <= (sub.member.reminder_days or 0):
                reminders.append(item)
        reminders.sort(key=lambda x: x['days_remaining'])
        return api_response({'reminders': reminders})
    return await run_db(_impl)


@router.get('/reminders/all')
async def reminders_all():
    def _impl():
        """全部未到期订阅（到期日历数据源），按剩余天数升序"""
        today = datetime.now().date()
        subs = (SubsSubscription.query.options(
            joinedload(SubsSubscription.member).joinedload(SubsMember.category))
            .filter(SubsSubscription.end_date >= today.strftime(DATE_FMT))
            .order_by(SubsSubscription.end_date).all())

        reminders = [_reminder_item(sub, today) for sub in subs if sub.member]
        reminders.sort(key=lambda x: x['days_remaining'])
        return api_response({'reminders': reminders})
    return await run_db(_impl)


# ─── 备份 ─────────────────────────────────────────────────

@router.post('/backup/run')
async def backup_run():
    def _impl():
        """手动触发一次数据库备份（当前 SQLite 库；PG 后端返回 skipped）"""
        result = subs_backup.backup_database()
        code = 409 if result['status'] == 'error' else 200   # ok / skipped 均 200
        return api_response(result, code,
                            '备份完成' if result['status'] == 'ok' else result.get('reason', ''))
    return await run_db(_impl)


@router.get('/backup')
async def backup_list():
    """备份统计 + 文件列表"""
    return api_response(subs_backup.backup_stats())


# ─── 每日后台任务（02:00 备份 / 10:00 支出摘要日志）──────

_DAILY_LOCK = threading.Lock()
_DAILY_DONE = {'backup': None, 'spending': None}   # 已执行日期 'YYYY-MM-DD'


def run_daily_spending_log(app) -> str:
    """当日活跃订阅支出摘要（按分类），写模块日志（info 级落盘）。

    app 参数保留（测试与调度线程传真实 app 对象；无 app_context，会话用后即还）。
    """
    log = mod_logger('subs')
    try:
        today = datetime.now().strftime(DATE_FMT)
        subs = (SubsSubscription.query.options(
            joinedload(SubsSubscription.member).joinedload(SubsMember.category))
            .filter(SubsSubscription.start_date <= today,
                    SubsSubscription.end_date >= today).all())
        if not subs:
            msg = f'[{today}] 今日无活跃订阅'
            log.info(msg)
            return msg
        total = Decimal('0')
        by_cat = defaultdict(Decimal)
        for row in _spend_rows(subs):
            total += row.daily_base
            by_cat[row.cat.name if row.cat else '未分类'] += row.daily_base
        lines = [f"[{today}] 今日订阅花费统计：活跃订阅 {len(subs)} 个"]
        for name, amount in sorted(by_cat.items(), key=lambda x: x[1], reverse=True):
            lines.append(f"  {name}: ¥{float(amount.quantize(Decimal('0.01'))):.2f}")
        lines.append(f"  今日总支出: ¥{float(total.quantize(Decimal('0.01'))):.2f}")
        msg = '\n'.join(lines)
        log.info(msg)
        return msg
    finally:
        db.session.remove()   # 等价 app_context 退出时的会话回收


def start_daily_loop(app):
    """
    每日任务线程（daemon，随进程）：02:00 后自动备份、10:00 后写支出摘要。
    启动即补跑当天未执行的任务；测试直接调 run_daily_spending_log / backup_database。
    """
    if getattr(app.state, 'testing', False):
        return   # 测试模式空转（不启动线程）

    def _mark_once(key, today):
        with _DAILY_LOCK:
            if _DAILY_DONE[key] == today:
                return False
            _DAILY_DONE[key] = today
            return True

    def _loop():
        time.sleep(10)
        while True:
            try:
                now = datetime.now()
                today = now.strftime(DATE_FMT)
                if settings.subs_backup_enabled and now.hour >= 2 and _mark_once('backup', today):
                    subs_backup.backup_database()
                if now.hour >= 10 and _mark_once('spending', today):
                    run_daily_spending_log(app)
            except Exception:  # noqa: BLE001 后台任务永不中断
                pass
            time.sleep(60)

    threading.Thread(target=_loop, name='subs-daily', daemon=True).start()
