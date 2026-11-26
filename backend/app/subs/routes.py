"""
订阅管理 API（CrownFlow 迁移）

- 会员：GET/POST /api/subs/members、GET/PUT/DELETE /api/subs/members/<id>
  （列表支持 ?page= ?page_size= ?keyword= ?category_id= ?status= ?sort_by= ?order=）
- 订阅记录：GET/POST /api/subs/members/<id>/subscriptions、GET/PUT/DELETE /api/subs/subscriptions/<id>
- 分类：GET/POST /api/subs/categories、PUT/DELETE /api/subs/categories/<id>
- 统计：GET /api/subs/stats/overview | spending | by-category | category-summary | trend
- 提醒：GET /api/subs/reminders/upcoming | all
  另有每日后台线程：10:00 当日支出摘要日志

支出计算：日均 = 价格 / 计费周期天数；实际支出 = 日均 × 与查询范围重叠天数（闭区间）；
跨币种按 settings.subs_exchange_rates 静态汇率折算基准币（CNY）。
日期一律 YYYY-MM-DD 字符串比较（跨 SQLite/PG 一致）。
"""

import threading
from collections import defaultdict
from decimal import Decimal

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import joinedload

from app.db import db, run_db, database_context
from app.shared.auth import require_basic
from app.shared.modules import mod_logger
from app.shared.response import api_response
from app.subs import service
from app.subs.models import SubsMember, SubsSubscription

router = APIRouter(prefix='/api/subs', dependencies=[Depends(require_basic)])


async def _write(operation, code, message, *args):
    def execute():
        result = operation(*args)
        db.session.commit()
        return api_response(result, code, message)
    return await run_db(execute)


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


# ─── 分类 ─────────────────────────────────────────────────

@router.get('/categories')
async def list_categories():
    return await run_db(lambda: api_response(service.list_categories()))


@router.post('/categories')
async def create_category(request: Request):
    data = await _json_or_empty(request)

    return await _write(service.create_category, 201, '创建成功', data)


@router.put('/categories/{cat_id}')
async def update_category(cat_id: int, request: Request):
    data = await _json_or_empty(request)

    return await _write(service.update_category, 200, '更新成功', cat_id, data)


@router.delete('/categories/{cat_id}')
async def delete_category(cat_id: int):
    return await _write(service.delete_category, 200, '删除成功', cat_id)


# ─── 会员 ─────────────────────────────────────────────────

@router.get('/members')
async def list_members(request: Request):
    return await run_db(lambda: api_response(service.list_members(request.query_params)))


@router.get('/members/{member_id}')
async def get_member(member_id: int):
    return await run_db(lambda: api_response(service.get_member(member_id)))


@router.post('/members')
async def create_member(request: Request):
    data = await _json_or_none(request)

    return await _write(service.create_member, 201, '创建成功', data)


@router.put('/members/{member_id}')
async def update_member(member_id: int, request: Request):
    data = await _json_or_empty(request)

    return await _write(service.update_member, 200, '更新成功', member_id, data)


@router.delete('/members/{member_id}')
async def delete_member(member_id: int):
    return await _write(service.delete_member, 200, '删除成功', member_id)


# ─── 订阅记录 ─────────────────────────────────────────────

@router.get('/members/{member_id}/subscriptions')
async def list_member_subscriptions(member_id: int, request: Request):
    return await run_db(lambda: api_response(service.list_member_subscriptions(member_id, request.query_params)))


@router.post('/members/{member_id}/subscriptions')
async def create_subscription(member_id: int, request: Request):
    data = await _json_or_none(request)

    return await _write(service.create_subscription, 201, '创建成功', member_id, data)


@router.get('/subscriptions/{sub_id}')
async def get_subscription(sub_id: int):
    return await run_db(lambda: api_response(service.get_subscription(sub_id)))


@router.put('/subscriptions/{sub_id}')
async def update_subscription(sub_id: int, request: Request):
    data = await _json_or_empty(request)

    return await _write(service.update_subscription, 200, '更新成功', sub_id, data)


@router.delete('/subscriptions/{sub_id}')
async def delete_subscription(sub_id: int):
    return await _write(service.delete_subscription, 200, '删除成功', sub_id)


# ─── 统计分析 ─────────────────────────────────────────────


@router.get('/stats/overview')
async def stats_overview():
    return await run_db(lambda: api_response(service.stats_overview()))


@router.get('/stats/ranking')
async def stats_ranking(metric: str = 'total_spending', limit: int = 10):
    return await run_db(lambda: api_response(service.stats_ranking(metric, limit)))


@router.get('/stats/details')
async def stats_details(request: Request, page: int = 1, page_size: int = 20, category_id: int | None = None):
    return await run_db(lambda: api_response(service.stats_details(request.query_params, page, page_size, category_id)))


@router.get('/stats/spending')
async def stats_spending(request: Request):
    return await run_db(lambda: api_response(service.stats_spending(request.query_params)))


@router.get('/stats/by-category')
async def stats_by_category(request: Request):
    return await run_db(lambda: api_response(service.stats_by_category(request.query_params)))


@router.get('/stats/category-summary')
async def stats_category_summary():
    return await run_db(lambda: api_response(service.stats_category_summary()))


@router.get('/stats/trend')
async def stats_trend(request: Request):
    return await run_db(lambda: api_response(service.stats_trend(request.query_params)))


# ─── 到期提醒 ─────────────────────────────────────────────


@router.get('/reminders/upcoming')
async def reminders_upcoming():
    return await run_db(lambda: api_response({'reminders': service.list_reminders(member_window=True)}))


@router.get('/reminders/all')
async def reminders_all():
    return await run_db(lambda: api_response({'reminders': service.list_reminders()}))


# ─── 每日后台任务（10:00 支出摘要日志）────────────────────

_DAILY_LOCK = threading.Lock()
_DAILY_DONE = {'spending': None}   # 已执行日期 'YYYY-MM-DD'


def run_daily_spending_log(app) -> str:
    with database_context(app):
        return _run_daily_spending_log(app)


def _run_daily_spending_log(app) -> str:
    """当日活跃订阅支出摘要（按分类），写模块日志（info 级落盘）。

    app 参数保留（测试与调度线程传真实 app 对象；无 app_context，会话用后即还）。
    """
    log = mod_logger('subs')
    try:
        today = service._today().isoformat()
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
        for row in service._spend_rows(subs):
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
    """每 app 可停止调度器；数据库上下文与去重日期均不跨 app 共享。"""
    if getattr(app.state, 'testing', False):
        return
    previous = getattr(app.state, 'subs_daily', None)
    if previous and previous.thread.is_alive():
        return
    from types import SimpleNamespace
    from app.shared.pools import get_pool
    runtime = SimpleNamespace(stop=threading.Event(), thread=None, done=None)
    def loop():
        if runtime.stop.wait(10):
            return
        while not runtime.stop.is_set():
            try:
                with database_context(app):
                    now = service._business_now()
                today = now.strftime(service.DATE_FMT)
                if now.hour >= 10 and runtime.done != today:
                    # 调度线程仅调度；执行体复用 SDK 命名池，完成后才记当日成功。
                    get_pool('subs', workers=2).submit(run_daily_spending_log, app).result()
                    runtime.done = today
            except Exception:
                mod_logger('subs').exception('每日支出摘要失败，下轮重试')
            runtime.stop.wait(60)
    runtime.thread = threading.Thread(target=loop, name='subs-daily', daemon=True)
    app.state.subs_daily = runtime
    runtime.thread.start()


def stop_daily_loop(app, timeout=5):
    runtime = getattr(app.state, 'subs_daily', None)
    if runtime is None:
        return True
    runtime.stop.set()
    if runtime.thread is not threading.current_thread():
        runtime.thread.join(timeout=max(0, timeout))
    return not runtime.thread.is_alive()
