"""Transactional writes and adapters for existing module-owned transactions."""
from contextvars import ContextVar
from dataclasses import replace
from functools import wraps
import json
from typing import Annotated

from fastapi import HTTPException
from lizysdk.errors import AppError
from pydantic import Field, StringConstraints
from pydantic_core import to_jsonable_python
from sqlalchemy import JSON, String
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, db
from app.shared.mcp_catalog import McpTool
from app.shared.mcp_read import Input
from app.shared.mutations import fingerprint

mcp_application = ContextVar('mcp_application')
ContentText = Annotated[str, StringConstraints(strip_whitespace=False)]


class McpWriteReceipt(Base):
    __tablename__ = 'confcenter_mcp_write_receipts'

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    signature: Mapped[str] = mapped_column(String(64), nullable=False)
    response: Mapped[dict] = mapped_column(JSON, nullable=False)


class Write(Input):
    mutation_id: str = Field(min_length=8, max_length=128, pattern=r'^[A-Za-z0-9_.:-]+$',
                             description='新操作使用唯一编号，重试同一操作时沿用。', examples=['op-20261128-001'])


def response_data(response):
    data = json.loads(response.body)
    if response.status_code >= 400:
        raise HTTPException(response.status_code, data.get('message', '操作失败'))
    return data['data']


def _write(title, group, inputs, handler, *, transactional, after_commit=None):
    @wraps(handler)
    def execute(args, token_id, name):
        try:
            if not transactional:
                return to_jsonable_python(handler(args, token_id))
            signature = fingerprint([name, args.model_dump(mode='json', exclude_unset=True)])
            key = fingerprint([token_id, args.mutation_id])
            session = db.session
            insert = pg_insert if session.bind.dialect.name == 'postgresql' else sqlite_insert
            claim = insert(McpWriteReceipt).values(key=key, signature=signature, response={})
            created = session.execute(claim.on_conflict_do_nothing(index_elements=['key'])).rowcount
            receipt = session.get(McpWriteReceipt, key)
            if not created:
                if receipt.signature != signature:
                    raise HTTPException(409, '该 mutation_id 已用于其他写入')
                return receipt.response
            result = to_jsonable_python(handler(args))
            receipt.response = result
            session.commit()
            if after_commit is not None:
                after_commit(result)
            return result
        except AppError as error:
            raise HTTPException(error.http_status, error.message) from error

    return McpTool(title, group, inputs, execute, read_only=False)


def write_tool(title, group, inputs, handler, *, after_commit=None):
    """Run a DB write and save its retry receipt in the same transaction."""
    return _write(title, group, inputs, handler, transactional=True, after_commit=after_commit)


def existing_write_tool(title, group, inputs, handler):
    """Delegate commit/retry semantics to an existing domain operation."""
    return _write(title, group, inputs, handler, transactional=False)


def add_writes(provider, tools):
    def execute(name, args, token_id):
        if name in tools:
            return tools[name].handler(args, token_id, name)
        return provider.execute(name, args, token_id)

    return replace(provider, tools={**provider.tools, **tools}, execute=execute)


def scoped_mutation(token_id, mutation_id):
    return fingerprint([token_id, mutation_id])
