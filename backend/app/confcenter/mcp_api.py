from typing import Literal

from fastapi import HTTPException
from pydantic import ConfigDict, Field, JsonValue
from sqlalchemy import func, select

from app.db import db
from app.shared.mcp_read import Input, Search, one_row, page_rows, read_provider, read_tool
from app.shared.mcp_write import Write, add_writes, existing_write_tool, mcp_application, response_data, write_tool
from . import ratelimit, routes
from .models import ConfEntry, ConfNamespace


class ConfigSearch(Search):
    namespace: str | None = Field(default=None, max_length=100,
                                  description='指定名称时查该命名空间的键，省略时查命名空间目录。', examples=['app'])


def search_config_catalog(args):
    """查命名空间及键数，或查看指定空间的键名、值类型和更新时间。"""
    if args.namespace is None:
        query = (select(ConfNamespace.namespace, ConfNamespace.created_at, func.count(ConfEntry.key).label('key_count'))
                 .outerjoin(ConfEntry, ConfEntry.namespace == ConfNamespace.namespace)
                 .group_by(ConfNamespace.namespace, ConfNamespace.created_at))
        if args.keyword:
            query = query.where(ConfNamespace.namespace.icontains(args.keyword, autoescape=True))
        return {'kind': 'namespaces', **page_rows(query.order_by(ConfNamespace.namespace), args)}
    one_row(select(ConfNamespace.namespace).where(ConfNamespace.namespace == args.namespace), '命名空间不存在')
    query = select(ConfEntry.key, ConfEntry.type, ConfEntry.updated_at).where(ConfEntry.namespace == args.namespace)
    if args.keyword:
        query = query.where(ConfEntry.key.icontains(args.keyword, autoescape=True))
    return {'kind': 'keys', 'namespace': args.namespace, **page_rows(query.order_by(ConfEntry.key), args)}


mcp_provider = read_provider('配置中心', 'confcenter', '查命名空间和配置键的元数据。', {
    'search_config_catalog': read_tool('查询配置目录', '配置目录', ConfigSearch, search_config_catalog),
})


class NamespaceCreate(Write):
    namespace: str = Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_.:-]+$',
                           description='新命名空间的名称。', examples=['app.feature'])


class EntryKey(Input):
    namespace: str = Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_.:-]+$',
                           description='配置所在命名空间。', examples=['app'])
    key: str = Field(min_length=1, max_length=200, pattern=r'^[A-Za-z0-9_.:-]+$',
                     description='配置键名。', examples=['display_mode'])
    if_updated_at: str | None = Field(default=None, max_length=40,
                                     description='目录返回的更新时间，填写时只修改同一版本。', examples=['2026-11-28T08:00:00'])


class EntrySave(EntryKey):
    model_config = ConfigDict(str_strip_whitespace=False)

    type: Literal['str', 'json'] = Field(description='保存为字符串或 JSON。', examples=['str'])
    data: JsonValue = Field(description='要保存的配置值。', examples=['compact'])
    if_absent: bool = Field(default=False, description='仅在该配置键还不存在时写入。', examples=[True])


def create_namespace(args):
    """登记空命名空间，重名时返回冲突。"""
    if not db.session.execute(routes._REGISTER_NS, {'new_ns': args.namespace}).rowcount:
        raise HTTPException(409, 'namespace 已存在')
    return {'namespace': args.namespace, 'count': 0}


def save_config_entry(args, token_id):
    """写入配置，可按版本更新或仅在不存在时创建。"""
    app = mcp_application.get()
    ratelimit.check(app, args.namespace)
    body = args.model_dump(exclude={'namespace', 'key'})
    if args.if_updated_at is None:
        body.pop('if_updated_at')
    result = response_data(routes.save_entry(app, args.namespace, args.key, body))
    return {key: result[key] for key in ('namespace', 'key', 'type', 'updated_at')}


def delete_config_entry(args, token_id):
    """删除单条配置，可指定目录中的版本时间。"""
    app = mcp_application.get()
    ratelimit.check(app, args.namespace)
    return response_data(routes.remove_entry(app, args.namespace, args.key, args.if_updated_at))


mcp_provider = add_writes(mcp_provider, {
    'create_namespace': write_tool('创建命名空间', '配置写入', NamespaceCreate, create_namespace),
    'save_config_entry': existing_write_tool('保存配置项', '配置写入', EntrySave, save_config_entry),
    'delete_config_entry': existing_write_tool('删除配置项', '配置写入', EntryKey, delete_config_entry),
})
