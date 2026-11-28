"""Small building blocks for curated, read-only module tools."""
from typing import Annotated

from fastapi import HTTPException
from lizysdk.errors import AppError
from pydantic import BaseModel, ConfigDict, Field
from pydantic_core import to_jsonable_python

from app.db import db
from app.shared.mcp_catalog import McpProvider, McpTool


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class Paged(Input):
    page: int = Field(default=1, ge=1, le=2147483647, description='要读取的页码，从 1 开始。', examples=[1])
    page_size: int = Field(default=20, ge=1, le=100, description='每页最多返回的记录数。', examples=[20])


class Search(Paged):
    keyword: str | None = Field(default=None, max_length=200, description='匹配名称或标题的关键词。', examples=['项目'])


Hours = Annotated[int, Field(ge=1, le=168, description='从当前时间向前统计的小时数。', examples=[24])]
IntId = Annotated[int, Field(ge=1, le=2147483647)]
TextId = Annotated[str, Field(min_length=1, max_length=64)]


def read_tool(title, group, inputs, handler):
    return McpTool(title, group, inputs, handler, read_only=True)


def read_provider(title, key, instructions, tools):
    def execute(name, args, token_id):
        try:
            return to_jsonable_python(tools[name].handler(args))
        except AppError as error:
            raise HTTPException(error.http_status, error.message) from error

    return McpProvider(title=title, server_name=key, instructions=instructions, tools=tools, execute=execute)


def page_rows(statement, args):
    offset = (args.page - 1) * args.page_size
    rows = db.session.execute(statement.offset(offset).limit(args.page_size + 1)).mappings().all()
    return {'items': [dict(row) for row in rows[:args.page_size]], 'page': args.page,
            'page_size': args.page_size, 'has_more': len(rows) > args.page_size}


def one_row(statement, message):
    row = db.session.execute(statement).mappings().one_or_none()
    if row is None:
        raise HTTPException(404, message)
    return dict(row)
