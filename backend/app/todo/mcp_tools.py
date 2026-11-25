"""MCP 工具白名单。输入模型同时生成客户端可见的 JSON Schema。"""
from datetime import date as Date
from typing import Annotated, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from pydantic_core import to_jsonable_python
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.db import db
from app.shared.mcp_catalog import McpProvider, McpTool
from app.shared.mutations import fingerprint
from app.shared.timeutil import local_today, now_utc
from . import readcache
from .models import Category, TaskEvent, TaskMutation
from .schemas import CategoryCreate, CategoryUpdate, EventOut, TaskCreate, TaskMoveIn, TaskReorderIn, TaskUpdate
from .services import categories, day, get_settings, migrations, stats, tasks


class Inputs(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Write(Inputs):
    mutation_id: str = Field(min_length=8, max_length=64, pattern=r'^[A-Za-z0-9_.:-]+$',
                             description='每次新操作生成一个唯一 ID，重试同一次操作时沿用。',
                             examples=['28ee7338-2060-42ed-bf21-b3ece66f48a7'])


_EXAMPLE_CATEGORY_ID = '019a3e7b-2ab0-7002-8000-000000000002'
RecordId = Annotated[str, Field(min_length=1, max_length=36)]
TaskId = Annotated[RecordId, Field(description='目标任务的 ID，取自任务列表中的 id。',
                                   examples=['019a3e7b-2ab0-7001-8000-000000000001'])]
Quadrant = Annotated[int, Field(ge=1, le=4)]
Revision = Annotated[int, Field(ge=1, description='最近一次读取该任务时返回的版本号 revision。', examples=[3])]


class Board(Inputs):
    date: Date | None = Field(default=None, description='查看哪一天的看板，省略时取 MyTodo 时区的今天。',
                              examples=['2026-11-26'])


class Search(Inputs):
    q: str | None = Field(default=None, description='匹配任务标题或描述的关键词。', examples=['周报'])
    date: Date | Literal['today'] | None = Field(default=None, description='只查排在指定日期的任务，today 表示今天。',
                                                 examples=['today'])
    start: Date | None = Field(default=None, description='排期筛选的起始日，含当天。', examples=['2026-11-23'])
    end: Date | None = Field(default=None, description='排期筛选的结束日，含当天。', examples=['2026-11-29'])
    inbox: bool = Field(default=False, description='设为 true 只查尚未排期的任务。', examples=[True])
    overdue: bool = Field(default=False, description='设为 true 只查排期早于今天且仍为待办的任务。', examples=[False])
    status: Literal['active', 'pending', 'done', 'cancelled', 'all'] = Field(
        default='active', description='按状态筛选。active 包含待办和进行中，all 包含所有未删除任务。', examples=['pending'])
    quadrant: Quadrant | None = Field(default=None, description='要筛选的象限。1 立即做、2 计划做、3 委派、4 考虑删除。',
                                      examples=[2])
    category_id: RecordId | None = Field(default=None, description='只查这个类别的任务，可用 list_categories 查询类别 ID。',
                                         examples=[_EXAMPLE_CATEGORY_ID])
    sort: Literal['position', 'due_at', 'created_at', 'migrated_count'] = Field(
        default='position', description='按手动顺序、截止时间、创建时间或迁移次数升序排列。', examples=['due_at'])
    page: int = Field(default=1, ge=1, description='要读取的页码，从 1 开始。', examples=[1])
    page_size: int = Field(default=30, ge=1, le=100, description='每页最多返回的任务数，可填 1 到 100。', examples=[20])


class Detail(Inputs):
    task_id: TaskId


class Queue(Inputs):
    queue: Literal['pending', 'shelved'] = Field(default='pending', description='选择待迁移队列 pending 或已搁置队列 shelved。',
                                                 examples=['shelved'])


class Edit(Write):
    task_id: TaskId


class Migrate(Edit):
    to_date: Date | Literal['today'] = Field(description='迁移后的排期，须为今天或未来的日期。', examples=['today'])
    reason: str | None = Field(default=None, description='写入任务迁移记录的原因。', examples=['等待评审反馈'])


class Shelve(Edit):
    shelved: bool = Field(description='true 搁置任务，false 取消搁置。', examples=[True])


# 创建与编辑复用 REST 输入模型，仅为两者共有的字段补充 MCP 文档。
_TASK_FIELD_DOCS = {
    'title': ('显示在看板和列表中的任务名称。', '撰写项目周报'),
    'description': ('任务的详细内容或执行要求。', '整理本周进展和下周计划'),
    'category_id': ('已有类别 ID，可用 list_categories 查询。传 null 可设为未分类。', _EXAMPLE_CATEGORY_ID),
    'is_important': ('任务是否重要，与紧急标记一起决定象限。', True),
    'is_urgent': ('任务是否紧急，与重要标记一起决定象限。', False),
    'task_date': ('排期可填 YYYY-MM-DD 或 today。传 null 放入待排期。', 'today'),
    'due_at': ('任务的截止日期和时间，可带时区偏移。', '2026-11-27T17:30:00+08:00'),
    'due_is_full_day': ('截止时间是否按全天显示。false 表示精确到时间。', False),
    'estimate_minutes': ('预计需要的分钟数，可填 1 到 1440。', 45),
    'notify_enabled': ('是否开启任务提醒。开启时需设置提醒时间和渠道。', True),
    'notify_time': ('排期当天的提醒时刻，使用 24 小时制 HH:MM。', '09:30'),
    'notify_channels': ('接收提醒的渠道列表，email 表示邮件。', ['email']),
}


def _document_task_fields(schema):
    for name, field in schema['properties'].items():
        if name in _TASK_FIELD_DOCS:
            description, example = _TASK_FIELD_DOCS[name]
            field.update(description=description, examples=[example])


class Create(TaskCreate, Write):
    model_config = ConfigDict(json_schema_extra=_document_task_fields)


class Update(TaskUpdate, Edit):
    model_config = ConfigDict(json_schema_extra=_document_task_fields)
    revision: Revision


class Complete(Edit):
    note: str | None = Field(default=None, description='完成任务时保存的备注。', examples=['周报已发给团队'])


class Arrange(Edit):
    revision: Revision
    quadrant: Quadrant | None = Field(default=None, description='目标象限。1 立即做、2 计划做、3 委派、4 考虑删除。省略则在原象限排序。',
                                      examples=[2])
    before_task_id: RecordId | None = Field(default=None, description='目标象限内的参照任务 ID，排在它前面。省略则排到末尾。',
                                            examples=['019a3e7b-2ab0-7003-8000-000000000003'])


class Calendar(Inputs):
    start: Date = Field(description='日历区间的第一天，包含当天。', examples=['2026-11-23'])
    end: Date = Field(description='日历区间的最后一天，包含当天。', examples=['2026-11-29'])
    plan_only: bool = Field(default=False, description='设为 true 只统计规律生活计划生成的任务。', examples=[True])


class Report(Inputs):
    mode: Literal['daily', 'range', 'heatmap', 'streak'] = Field(
        default='daily', description='选择单日回顾、区间回顾、年度热力图或连续活跃统计。', examples=['range'])
    date: Date | None = Field(default=None, description='daily 模式要回顾的日期，省略时查看今天。', examples=['2026-11-26'])
    start: Date | None = Field(default=None, description='range 模式必填，回顾区间的第一天。', examples=['2026-11-23'])
    end: Date | None = Field(default=None, description='range 模式必填，回顾区间的最后一天。', examples=['2026-11-29'])
    year: int | None = Field(default=None, ge=2, le=9998, description='heatmap 模式要统计的年份，省略时使用当前年份。',
                             examples=[2026])


class ListCategories(Inputs):
    include_archived: bool = Field(default=False, description='设为 true 时也返回已归档的类别。', examples=[True])


class CreateCategory(CategoryCreate, Write):
    pass


class CategoryTarget(Write):
    category_id: RecordId = Field(description='要管理的类别 ID，取自 list_categories 返回的 id。',
                                  examples=[_EXAMPLE_CATEGORY_ID])


class UpdateCategory(CategoryUpdate, CategoryTarget):
    pass


TOOLS = {}


def tool(model, title, group):
    def register(fn):
        TOOLS[fn.__name__] = McpTool(title, group, model, fn, read_only=not issubclass(model, Write))
        return fn
    return register


def _today(session):
    return local_today(get_settings(session)['timezone'])


def _task(session, task):
    cats = tasks._category_map(session) if task.category_id else None
    return tasks.serialize_task_dict(task, _today(session), cats)


@tool(Board, '查看四象限看板', '今日看板与查询')
def get_today(session, args):
    """读取今日或指定日期的四象限看板、待迁移任务和昨日概况。"""
    return day.get_today(session, args.date.isoformat() if args.date else None)


@tool(Search, '搜索任务', '今日看板与查询')
def list_tasks(session, args):
    """分页搜索任务，可按关键词、日期区间、状态、类别或象限过滤。inbox=true 查询待排期。"""
    filters = args.model_dump(mode='json', exclude={'date', 'start', 'end'})
    dates = args.model_dump(mode='json', include={'date', 'start', 'end'})
    today = _today(session)
    rows = tasks.list_tasks(session, date_str=dates['date'], from_str=dates['start'],
                            to_str=dates['end'], today=today, **filters)
    cats = tasks._category_map(session) if any(t.category_id for t in rows['items']) else None
    return {**rows, 'items': [tasks.serialize_task_dict(t, today, cats) for t in rows['items']]}


@tool(Detail, '查看任务详情', '今日看板与查询')
def get_task(session, args):
    """读取单个任务的详情、最新 revision 和最近 50 条事件。"""
    task = tasks._get_or_404(session, args.task_id)
    events = session.scalars(select(TaskEvent).where(TaskEvent.task_id == task.id)
                             .order_by(TaskEvent.created_at.desc()).limit(50))
    return {**_task(session, task), 'events': [EventOut.model_validate(e).model_dump(mode='json') for e in events]}


@tool(Queue, '查看迁移池与搁置任务', '待办池与迁移')
def list_migration_queue(session, args):
    """查看待迁移（pending）或已搁置（shelved）的任务。"""
    items = migrations.pending_migrations(session) if args.queue == 'pending' else migrations.shelved_tasks(session)
    return {'items': items}


@tool(Migrate, '迁移任务', '待办池与迁移')
def migrate_task(session, args):
    """把已排期的待办迁移到今天或未来，可附原因。待排期任务首次排期请用 update_task。"""
    return _task(session, migrations.migrate_task(session, args.task_id, str(args.to_date), args.reason))


@tool(Shelve, '搁置或取消搁置', '待办池与迁移')
def set_task_shelved(session, args):
    """搁置任务或取消搁置，保留原排期。"""
    task = tasks._get_or_404(session, args.task_id)
    if (task.shelved_at is not None) != args.shelved:
        migrations.decide(session, task.id, 'keep' if args.shelved else 'unshelve')
    return _task(session, task)


def _check_fields(session, args):
    if 'title' in args.model_fields_set and not (args.title or '').strip():
        raise HTTPException(422, '任务标题不能为空')
    if args.category_id and session.get(Category, args.category_id) is None:
        raise HTTPException(422, '类别不存在')


@tool(Create, '新建任务', '任务办理与排列')
def create_task(session, args):
    """新建任务。task_date 留空进入待排期，today 排到今天。"""
    _check_fields(session, args)
    return _task(session, tasks.create_task(session, args))


@tool(Update, '编辑与排期', '任务办理与排列')
def update_task(session, args):
    """修改任务或设置首次排期。只传要改的字段及最新 revision。"""
    _check_fields(session, args)
    update = TaskUpdate.model_validate(args.model_dump(exclude={'task_id', 'mutation_id'}, exclude_unset=True))
    return _task(session, tasks.update_task(session, args.task_id, update))


@tool(Complete, '完成任务', '任务办理与排列')
def complete_task(session, args):
    """完成任务，可附完成备注。"""
    return _task(session, tasks.complete_task(session, args.task_id, note=args.note))


@tool(Edit, '重新打开任务', '任务办理与排列')
def reopen_task(session, args):
    """将已完成的任务重新打开。"""
    return _task(session, tasks.reopen_task(session, args.task_id))


@tool(Arrange, '调整象限与顺序', '任务办理与排列')
def arrange_task(session, args):
    """在原象限排序或移动至指定象限，可排在目标任务之前。"""
    position = dict(before_task_id=args.before_task_id, revision=args.revision)
    if args.quadrant is None:
        task = tasks.reorder_task(session, args.task_id, TaskReorderIn(**position))
    else:
        important, urgent = tasks.flags_of(args.quadrant)
        move = TaskMoveIn(is_important=important, is_urgent=urgent, **position)
        task = tasks.move_task(session, args.task_id, move)
    return _task(session, task)


@tool(Calendar, '查看日历', '日历与回顾')
def get_calendar(session, args):
    """按起止日期读取日历摘要，每天含总数、完成数及前四项任务。"""
    return tasks.calendar_summary(session, args.start.isoformat(), args.end.isoformat(), args.plan_only)


@tool(Report, '读取回顾与统计', '日历与回顾')
def get_report(session, args):
    """日回顾 daily（date 可省）、区间回顾 range（start、end）、年度热力图 heatmap（year 可省）、连续活跃 streak。"""
    if args.mode == 'range':
        if not (args.start and args.end):
            raise HTTPException(422, '区间回顾需要 start 和 end')
        return stats.range_stats(session, args.start.isoformat(), args.end.isoformat())
    if args.mode == 'heatmap':
        return stats.heatmap(session, args.year or _today(session).year)
    if args.mode == 'streak':
        return stats.compute_streak(session, get_settings(session)['timezone'])
    return stats.daily_stats(session, args.date.isoformat() if args.date else None)


@tool(ListCategories, '查看类别', '类别管理')
def list_categories(session, args):
    """按顺序列出类别及其 ID、颜色、图标、归档状态和活跃任务数。"""
    return {'items': categories.list_categories(session, args.include_archived)}


@tool(CreateCategory, '新建类别', '类别管理')
def create_category(session, args):
    """创建任务类别，返回可用于任务归类的类别 ID。"""
    return categories.create_category(session, args)


@tool(UpdateCategory, '编辑与归档类别', '类别管理')
def update_category(session, args):
    """修改名称、颜色、图标或顺序，也可归档和恢复类别。只传需要修改的字段。"""
    return categories.update_category(session, args.category_id, args)


@tool(CategoryTarget, '删除类别', '类别管理')
def delete_category(session, args):
    """永久删除指定类别。关联任务和规律生活计划保留并转为未分类，返回转入未分类的未删除任务数。"""
    return categories.delete_category(session, args.category_id)


def execute(name, args, token_id):
    session = db.session
    operate = TOOLS[name].handler
    if not isinstance(args, Write):
        return to_jsonable_python(operate(session, args))

    # 先在同一事务中占用唯一键。并发重试会等待首个事务，然后读回原结果。
    key = 'mcp:' + fingerprint([token_id, args.mutation_id])[:60]
    signature = fingerprint([name, args.model_dump(mode='json', exclude_unset=True)])
    insert = pg_insert if session.bind.dialect.name == 'postgresql' else sqlite_insert
    claim = insert(TaskMutation).values(mutation_id=key, fingerprint=signature, result={},
                                        created_at=now_utc()).on_conflict_do_nothing(index_elements=['mutation_id'])
    claimed = session.execute(claim).rowcount
    receipt = session.get(TaskMutation, key)
    if not claimed:
        if receipt.fingerprint != signature:
            raise HTTPException(409, 'mutation_id 已用于其他操作，请给新操作换一个 ID')
        return receipt.result
    receipt.result = result = to_jsonable_python(operate(session, args))
    session.commit()
    readcache.bump()
    return result


mcp_provider = McpProvider(
    title='MyTodo', server_name='mytodo', tools=TOOLS, execute=execute,
    instructions='MyTodo 四象限待办。写操作重试时请传原 mutation_id。',
    # 升级时保留首版已开放的工具。后来注册的工具由管理员在配置中心开启。
    initially_enabled=frozenset({
        'get_today', 'list_tasks', 'get_task', 'list_migration_queue', 'migrate_task', 'set_task_shelved',
        'create_task', 'update_task', 'complete_task', 'reopen_task', 'arrange_task', 'get_calendar', 'get_report',
    }),
)
