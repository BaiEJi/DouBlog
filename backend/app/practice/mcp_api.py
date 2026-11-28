from pydantic import Field

from app.db import db
from app.shared.mcp_read import Input, Search, TextId, read_provider, read_tool
from . import services


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
