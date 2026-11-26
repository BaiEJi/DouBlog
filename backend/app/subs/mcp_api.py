"""订阅 MCP 输入、工作流和事务。Web API 与这些工具共用订阅服务。"""

from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import HTTPException
from lizysdk.errors import AppError
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.db import db
from app.shared.mcp_catalog import McpProvider, McpTool
from app.shared.mutations import fingerprint
from . import service
from .models import SubsCategory, SubsMcpMutation


def _describe_nullable_fields(schema):
    # Pydantic puts metadata from an annotated type inside its nullable union.
    # The configuration page reads the description and example from the field itself.
    for field in schema.get('properties', {}).values():
        for choice in field.get('anyOf', ()):
            for key in ('description', 'examples'):
                if key in choice:
                    field.setdefault(key, choice[key])


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True, json_schema_extra=_describe_nullable_fields)


DbId = Annotated[int, Field(gt=0, le=2147483647)]
MemberId = Annotated[DbId, Field(description='会员 ID，从会员查询结果中获取。', examples=[7])]
SubscriptionId = Annotated[DbId, Field(description='订阅记录 ID，从会员详情或到期查询中获取。', examples=[21])]
CategoryId = Annotated[DbId, Field(description='分类 ID，从 search_memberships 的分类清单中获取。', examples=[3])]
Revision = Annotated[DbId, Field(description='要修改的记录当前的 revision，从查询结果中获取。', examples=[1])]
Page = Annotated[int, Field(ge=1, le=2147483647, description='页码，从第 1 页开始。', examples=[1])]
PageSize = Annotated[int, Field(ge=1, le=100, description='每页返回的记录数。', examples=[20])]
Status = Annotated[Literal['active', 'expired'],
                   Field(description='按网页的有效或已过期状态筛选。', examples=['active'])]
Order = Annotated[Literal['asc', 'desc'], Field(description='排序方向，asc 升序，desc 降序。', examples=['desc'])]
StartDate = Annotated[date, Field(description='区间开始日期，包含当天。', examples=['2026-11-01'])]
EndDate = Annotated[date, Field(description='区间结束日期，包含当天。', examples=['2026-11-30'])]


class Write(Input):
    mutation_id: str = Field(min_length=8, max_length=128, pattern=r'^[A-Za-z0-9_.:-]+$',
                             description='一次写操作的唯一编号，重试时保持编号与参数一致。',
                             examples=['subs-20261126-001'])


class Search(Input):
    keyword: str | None = Field(default=None, max_length=100, description='按会员名称搜索。', examples=['视频会员'])
    category_id: CategoryId | None = None
    status: Status | None = None
    sort_by: Literal['created_at', 'name'] = Field(default='created_at', description='按创建时间或名称排序。', examples=['name'])
    order: Order = 'desc'
    include_categories: bool = Field(default=False, description='同时返回全部分类，包括空分类。', examples=[True])
    page: Page = 1
    page_size: PageSize = 20


class Detail(Input):
    member_id: MemberId | None = Field(default=None, description='会员 ID，与 subscription_id 至少填一项。', examples=[7])
    subscription_id: SubscriptionId | None = Field(default=None, description='同时返回指定订阅记录的完整内容。', examples=[21])
    status: Status | None = None
    start_date: StartDate | None = None
    end_date: EndDate | None = None
    sort_by: Literal['created_at', 'start_date', 'end_date', 'price'] = Field(
        default='created_at', description='订阅历史按创建时间、起止日期或金额排序。', examples=['start_date'])
    order: Order = 'desc'
    page: Page = 1
    page_size: PageSize = 20

    @model_validator(mode='after')
    def validate_target_and_range(self):
        if self.member_id is None and self.subscription_id is None:
            raise ValueError('请填写会员 ID 或订阅记录 ID')
        if (self.start_date is None) != (self.end_date is None):
            raise ValueError('开始和结束日期须同时填写')
        return self


class Expiring(Input):
    days_ahead: int | None = Field(default=None, ge=0, le=3660,
                                  description='未来几天内到期，包含今天。省略时按各会员的提醒天数筛选。', examples=[7])
    page: Page = 1
    page_size: PageSize = 20


ReportSection = Literal['overview', 'summary', 'category_summary', 'trend', 'ranking', 'details']


class Spending(Input):
    sections: list[ReportSection] = Field(
        default_factory=lambda: ['overview', 'summary'], min_length=1, max_length=6,
        description='选择会员概览、区间汇总、分类月年汇总、趋势、全历史排行榜或区间明细。', examples=[['summary', 'trend']])
    start_date: StartDate | None = None
    end_date: EndDate | None = None
    granularity: Literal['day', 'week', 'month', 'quarter'] = Field(
        default='month', description='趋势按天、周、月或季度汇总。', examples=['month'])
    ranking_metric: Literal['total_spending', 'avg_per_sub', 'subscription_count', 'total_duration_days'] = Field(
        default='total_spending', description='排行榜按累计支出、平均单价、订阅次数或累计天数排列。',
        examples=['total_spending'])
    ranking_limit: Annotated[int, Field(ge=1, le=100, description='排行榜条数。', examples=[10])] = 10
    category_id: int | None = Field(default=None, ge=0, le=2147483647,
                                    description='筛选区间明细的分类，0 表示未分类。', examples=[3])
    page: Page = 1
    page_size: PageSize = 20

    @model_validator(mode='after')
    def validate_range(self):
        if (self.start_date is None) != (self.end_date is None):
            raise ValueError('开始和结束日期须同时填写')
        if self.start_date is not None and self.start_date > self.end_date:
            raise ValueError('开始日期不能大于结束日期')
        return self


Name = Annotated[str, Field(min_length=1, max_length=100, description='会员服务名称。', examples=['云盘会员'])]
Notes = Annotated[str, Field(description='备注。编辑时传 null 清空。', examples=['个人账号'])]
Reminder = Annotated[int, Field(ge=0, le=2147483647, description='提前提醒天数，0 表示只在到期当天提醒。', examples=[7])]
Level = Annotated[str, Field(max_length=50, description='订阅级别。', examples=['家庭版'])]
Price = Annotated[Decimal, Field(ge=0, le=Decimal('99999999.99'), description='本期实际登记金额。', examples=[29.99])]
Currency = Annotated[Literal['CNY', 'USD', 'EUR', 'GBP', 'JPY'], Field(description='登记金额的币种。', examples=['CNY'])]
Cycle = Annotated[Literal['monthly', 'quarterly', 'yearly', 'custom'],
                  Field(description='计费周期，custom 时须填写 custom_days。', examples=['monthly'])]
CustomDays = Annotated[DbId, Field(description='自定义周期的天数。', examples=[45])]
Channel = Annotated[str, Field(max_length=50, description='购买或续订渠道。', examples=['官网'])]


class SubscriptionTerm(Input):
    level: Level | None = None
    price: Price
    currency: Currency = 'CNY'
    billing_cycle: Cycle
    custom_days: CustomDays | None = None
    start_date: StartDate
    end_date: EndDate
    channel: Channel | None = None
    notes: Notes | None = None

    @model_validator(mode='after')
    def validate_term(self):
        if self.billing_cycle == 'custom' and self.custom_days is None:
            raise ValueError('自定义周期必须提供 custom_days')
        if self.start_date > self.end_date:
            raise ValueError('开始日期不能大于结束日期')
        return self


class CreateMembership(Write):
    name: Name
    category_id: CategoryId | None = None
    notes: Notes | None = None
    reminder_days: Reminder | None = None
    subscription: SubscriptionTerm | None = Field(
        default=None, description='首期订阅，随会员一起保存。',
        examples=[{'price': 29.99, 'billing_cycle': 'monthly', 'start_date': '2026-11-01', 'end_date': '2026-11-30'}])


class RecordSubscription(Write, SubscriptionTerm):
    member_id: MemberId


class UpdateMembership(Write):
    member_id: MemberId
    revision: Revision
    name: Name | None = None
    category_id: CategoryId | None = Field(default=None, description='更新分类，传 null 取消归类。', examples=[3])
    notes: Notes | None = None
    reminder_days: Reminder | None = None


class SubscriptionWrite(Write):
    subscription_id: SubscriptionId
    revision: Revision


class UpdateSubscription(SubscriptionWrite):
    level: Level | None = None
    price: Price | None = None
    currency: Currency | None = None
    billing_cycle: Cycle | None = None
    custom_days: CustomDays | None = None
    start_date: StartDate | None = None
    end_date: EndDate | None = None
    channel: Channel | None = None
    notes: Notes | None = None


class SaveCategory(Write):
    category_id: CategoryId | None = Field(default=None, description='编辑时指定已有分类 ID，省略则新建。', examples=[3])
    name: str | None = Field(default=None, min_length=1, max_length=50, description='分类名称，新建时必填。', examples=['数字服务'])
    icon: str | None = Field(default=None, max_length=10, description='分类图标，传 null 清空。', examples=['📦'])
    color: str | None = Field(default=None, pattern=r'^#[0-9A-Fa-f]{6}$', description='分类颜色，传 null 清空。', examples=['#0E7490'])


def search_memberships(args):
    """按名称、分类或状态查会员，返回最新订阅和到期日期，可一并查询分类清单。"""
    result = service.list_members(args.model_dump(exclude_none=True))
    result.update(page=args.page, page_size=args.page_size)
    if args.include_categories:
        result['categories'] = service.list_categories()
    return result


def get_membership(args):
    """按会员或订阅记录 ID 查看服务详情、记录版本号和分页订阅历史。"""
    subscription = service.get_subscription(args.subscription_id) if args.subscription_id is not None else None
    member_id = args.member_id if args.member_id is not None else subscription['member_id']
    if subscription and subscription['member_id'] != member_id:
        raise HTTPException(400, '该订阅记录不属于指定会员')
    member = service.get_member(member_id, include_subscriptions=False)
    filters = args.model_dump(mode='json', include={'status', 'start_date', 'end_date', 'sort_by', 'order'}, exclude_none=True)
    history = service.list_member_subscriptions(member_id, filters, page=args.page, page_size=args.page_size,
                                                check_member=False)
    result = {'member': member, 'history': history}
    if subscription is not None:
        result['subscription'] = subscription
    return result


def get_expiring_subscriptions(args):
    """按指定天数或各会员的提醒设置查询到期订阅，按到期日升序分页。"""
    reminders = service.list_reminders(member_window=args.days_ahead is None, days_ahead=args.days_ahead)
    offset = (args.page - 1) * args.page_size
    return {'items': reminders[offset:offset + args.page_size], 'total': len(reminders),
            'page': args.page, 'page_size': args.page_size}


def get_spending_report(args):
    """一次获取所选支出统计。未指定区间时，汇总、趋势和明细使用业务时区的整月。"""
    result = {'base_currency': settings.subs_base_currency}
    sections = set(args.sections)
    if 'overview' in sections:
        result['overview'] = service.stats_overview()
    if 'category_summary' in sections:
        result['category_summary'] = service.stats_category_summary()
    if 'ranking' in sections:
        result['ranking'] = service.stats_ranking(args.ranking_metric, args.ranking_limit)
    if sections & {'summary', 'trend', 'details'}:
        start, end = (args.start_date.isoformat(), args.end_date.isoformat()) if args.start_date else service.month_year_bounds()[:2]
        params = {'start_date': start, 'end_date': end}
        result['range'] = params
        if 'summary' in sections:
            result['summary'] = service.stats_spending(params)
        if 'trend' in sections:
            result['trend'] = service.stats_trend({**params, 'granularity': args.granularity})['trend']
        if 'details' in sections:
            result['details'] = service.stats_details(params, args.page, args.page_size, args.category_id)
    return result


def _payload(args, *exclude):
    return args.model_dump(mode='json', exclude={'mutation_id', *exclude}, exclude_unset=True)


def create_membership(args):
    """创建一个会员，可同时登记首期订阅，任一步失败则一起回滚。"""
    data = _payload(args)
    if data.get('reminder_days') is None:
        data.pop('reminder_days', None)
    return service.create_member(data)


def record_subscription(args):
    """为已有会员新增一条订阅或续订记录，保留往期记录。"""
    return service.create_subscription(args.member_id, _payload(args, 'member_id'))


def update_membership(args):
    """按当前版本号更新会员名称、类别、备注或提醒天数。"""
    return service.update_member(args.member_id, _payload(args, 'member_id'))


def update_subscription(args):
    """按当前版本号更正一条历史订阅。已存在的续订记录保持独立。"""
    return service.update_subscription(args.subscription_id, _payload(args, 'subscription_id'))


def save_category(args):
    """新建或更新分类，返回可用于筛选及归类的分类 ID。"""
    body = _payload(args, 'category_id')
    try:
        if args.category_id is None:
            return service.create_category(body)
        return service.update_category(args.category_id, body)
    except IntegrityError:
        # 分类名字唯一。MCP 校验其他列长度，数据库仍负责并发重名。
        raise HTTPException(409, '分类名称已存在') from None


def delete_subscription(args):
    """按 ID 和版本号删除一条订阅记录，保留会员和其他期数。"""
    return service.delete_subscription(args.subscription_id, revision=args.revision)


def _tool(title, group, inputs, handler):
    return McpTool(title, group, inputs, handler, read_only=not issubclass(inputs, Write))


TOOLS = {
    'search_memberships': _tool('搜索会员', '查询与统计', Search, search_memberships),
    'get_membership': _tool('查看会员与订阅历史', '查询与统计', Detail, get_membership),
    'get_expiring_subscriptions': _tool('查询到期订阅', '查询与统计', Expiring, get_expiring_subscriptions),
    'get_spending_report': _tool('查询订阅支出', '查询与统计', Spending, get_spending_report),
    'create_membership': _tool('新建会员', '会员与订阅', CreateMembership, create_membership),
    'record_subscription': _tool('登记订阅或续订', '会员与订阅', RecordSubscription, record_subscription),
    'update_membership': _tool('编辑会员', '会员与订阅', UpdateMembership, update_membership),
    'update_subscription': _tool('更正订阅记录', '会员与订阅', UpdateSubscription, update_subscription),
    'delete_subscription': _tool('删除单条订阅', '会员与订阅', SubscriptionWrite, delete_subscription),
    'save_category': _tool('新建或编辑分类', '分类', SaveCategory, save_category),
}


def execute(name, args, token_id):
    handler = TOOLS[name].handler
    try:
        if not isinstance(args, Write):
            return handler(args)

        key = fingerprint([token_id, args.mutation_id])
        signature = fingerprint([name, args.model_dump(mode='json', exclude_unset=True)])
        session = db.session
        insert = pg_insert if session.bind.dialect.name == 'postgresql' else sqlite_insert
        claim = insert(SubsMcpMutation).values(key=key, fingerprint=signature, result={})
        claimed = session.execute(claim.on_conflict_do_nothing(index_elements=['key'])).rowcount
        receipt = session.get(SubsMcpMutation, key)
        if not claimed:
            if receipt.fingerprint != signature:
                raise HTTPException(409, '该 mutation_id 已用于其他请求')
            return receipt.result
        receipt.result = result = handler(args)
        session.commit()
        return result
    except AppError as error:
        raise HTTPException(error.http_status, error.message) from error


mcp_provider = McpProvider(
    title='订阅管理', server_name='subs', tools=TOOLS, execute=execute,
    instructions='管理会员和订阅记账。写操作重试时须沿用相同的 mutation_id 和参数。',
)
