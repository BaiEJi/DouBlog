from pydantic import Field
from sqlalchemy import func, select

from app.shared.mcp_read import Search, one_row, page_rows, read_provider, read_tool
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
