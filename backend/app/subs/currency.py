"""
订阅模块货币与计费周期工具（CrownFlow 迁移）

- 计费周期天数：monthly=按起始月实际天数，quarterly=90，yearly=365/366（闰年），custom=自定义
- 日均价格 = 价格 / 周期天数
- 币种换算：按 settings.subs_exchange_rates 静态汇率折算为基准币（CNY）
"""

from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal

from app.config import settings

DATE_FMT = '%Y-%m-%d'


def parse_date(raw: str) -> date:
    """YYYY-MM-DD → date（统计/聚合热路径共用）。

    fromisoformat 走 C 快路径（比 strptime 快约一个数量级，strptime 每次调用
    还要过 locale 归一化）；仅对历史遗留的非补零格式（如 2026-1-1，写入校验
    的 strptime 宽容接受过）回退 strptime，行为与旧实现一致。
    """
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return datetime.strptime(raw, DATE_FMT).date()


def date_ordinal(raw: str) -> int:
    """YYYY-MM-DD → proleptic 序数（整数比较/差值即重叠天数，热路径预计算用）"""
    return parse_date(raw).toordinal()


def get_billing_cycle_days(billing_cycle: str, custom_days, start_date: str) -> int:
    """计费周期覆盖的天数（start_date 为 YYYY-MM-DD，决定月付按哪个月算）"""
    if billing_cycle == 'monthly':
        year, month = map(int, start_date.split('-')[:2])
        return monthrange(year, month)[1]
    if billing_cycle == 'quarterly':
        return 90
    if billing_cycle == 'yearly':
        year = int(start_date[:4])
        return 366 if (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0) else 365
    if billing_cycle == 'custom':
        return int(custom_days or 30)
    return 30


def calculate_daily_rate(price, billing_cycle: str, custom_days, start_date: str) -> Decimal:
    """日均价格（原币种，Decimal）"""
    days = get_billing_cycle_days(billing_cycle, custom_days, start_date)
    return Decimal(str(price)) / Decimal(days)


def get_base_currency() -> str:
    return settings.subs_base_currency


def get_exchange_rates() -> dict:
    return dict(settings.subs_exchange_rates)


def convert_to_base(amount, from_currency: str) -> Decimal:
    """换算为基准币；未知币种按原值返回"""
    if from_currency == settings.subs_base_currency:
        return Decimal(str(amount))
    rate = settings.subs_exchange_rates.get(from_currency)
    if rate is None:
        return Decimal(str(amount))
    return Decimal(str(amount)) * Decimal(str(rate))


CURRENCY_SYMBOLS = {'CNY': '¥', 'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥'}

VALID_CURRENCIES = ('CNY', 'USD', 'EUR', 'GBP', 'JPY')

VALID_BILLING_CYCLES = ('monthly', 'quarterly', 'yearly', 'custom')
