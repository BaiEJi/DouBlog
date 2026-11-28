from pydantic import Field
from typing import Literal

from app.db import db
from app.shared.mcp_read import Input, Search, TextId, read_provider, read_tool
from app.shared.mcp_write import ContentText, Write, add_writes, write_tool
from . import services
from .schemas import ProblemCreate, ProblemUpdate

ProblemStatus = Literal['todo', 'solved', 'reviewing', 'mastered']


class ProblemRead(Input):
    problem_id: TextId = Field(description='题目 ID，从搜索或复习队列获取。', examples=['problem-id'])


class ProblemSearch(Search):
    only_due_review: bool = Field(default=False, description='只返回今天应复习或已经逾期的题目。', examples=[True])


def search_problems(args):
    """分页查找题目和复习摘要，可筛选已到期的复习任务。"""
    return services.list_problems(db.session, q=args.keyword or '', only_due_review=args.only_due_review,
                                  page=args.page, page_size=args.page_size)


def read_problem(args):
    """查看题面、题解、实现代码、标签和下一次复习信息。"""
    return services.get_problem_detail(db.session, args.problem_id)


mcp_provider = read_provider('刷题', 'practice', '从题库查题，读取题解或查看到期复习任务。', {
    'search_problems': read_tool('搜索题目与复习队列', '题库与复习', ProblemSearch, search_problems),
    'read_problem': read_tool('查看题解详情', '题库与复习', ProblemRead, read_problem),
})


class NewProblem(Write):
    title: str = Field(min_length=1, max_length=255, description='题目名称。', examples=['两数之和'])
    difficulty: int = Field(default=1, ge=1, le=3, description='难度，1 简单、2 中等、3 困难。', examples=[1])
    status: ProblemStatus = Field(default='todo', description='初始状态，reviewing 会加入复习队列。', examples=['reviewing'])
    description_md: ContentText | None = Field(default=None, max_length=100000, description='题面 Markdown。', examples=['给定整数数组…'])
    tag_names: list[str] = Field(default_factory=list, max_length=20, description='题目标签名称。', examples=[['数组']])


class EditProblem(Write):
    problem_id: TextId = Field(description='题目 ID。', examples=['problem-id'])
    revision: int = Field(ge=1, description='题目的当前版本号。', examples=[1])
    title: str | None = Field(default=None, min_length=1, max_length=255, description='新的题目名称。', examples=['两数之和'])
    description_md: ContentText | None = Field(default=None, max_length=100000, description='新的题面 Markdown。', examples=['给定整数数组…'])
    pitfall_md: ContentText | None = Field(default=None, max_length=100000, description='记录踩坑点。', examples=['处理重复元素'])
    status: ProblemStatus | None = Field(default=None, description='新的题目状态，reviewing 会加入复习队列。', examples=['reviewing'])


class ReviewProblem(Write):
    problem_id: TextId = Field(description='已复习的题目 ID。', examples=['problem-id'])
    result: Literal['remembered', 'fuzzy', 'forgot'] = Field(description='复习结果，分别表示记得、模糊、忘记。', examples=['remembered'])


def create_problem(args):
    """录入题目及标签，沿用题库的校验和保存规则。"""
    return services.create_problem(db.session, ProblemCreate(**args.model_dump(exclude={'mutation_id'})))


def update_problem(args):
    """按当前版本号更新题目、题面或踩坑笔记。"""
    changes = args.model_dump(exclude={'mutation_id', 'problem_id'}, exclude_unset=True)
    return services.update_problem(db.session, args.problem_id, ProblemUpdate(**changes))


def record_review(args):
    """登记复习结果，按现有复习算法计算下一次复习日期。"""
    return services.do_review(db.session, args.problem_id, args.result)


mcp_provider = add_writes(mcp_provider, {
    'create_problem': write_tool('录入题目', '题库编辑', NewProblem, create_problem),
    'update_problem': write_tool('编辑题目', '题库编辑', EditProblem, update_problem),
    'record_review': write_tool('登记复习结果', '题库编辑', ReviewProblem, record_review),
})
