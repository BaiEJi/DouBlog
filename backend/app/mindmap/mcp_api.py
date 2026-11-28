from pydantic import Field
from sqlalchemy import select

from app.shared.mcp_read import IntId, Paged, Search, page_rows, read_provider, read_tool
from .models import MindMap
from .services import require_map


class MapRead(Paged):
    map_id: IntId = Field(description='思维导图 ID，从目录返回。', examples=[1])


def search_maps(args):
    """查找思维导图，返回名称、关联知识库、节点数和更新时间。"""
    query = select(MindMap.id, MindMap.name, MindMap.workspace_id, MindMap.post_id, MindMap.node_count,
                   MindMap.updated_at, MindMap.revision).where(MindMap.deleted.is_(False))
    if args.keyword:
        query = query.where(MindMap.name.icontains(args.keyword, autoescape=True))
    return page_rows(query.order_by(MindMap.updated_at.desc(), MindMap.id.desc()), args)


def read_map_outline(args):
    """分页读取导图节点的文本摘要、父子关系和顺序。"""
    row = require_map(args.map_id)
    offset = (args.page - 1) * args.page_size
    stack = [(row.document['root'], None, 0)]
    items = []
    index = 0
    while stack and len(items) < args.page_size:
        node, parent_id, order = stack.pop()
        data = node['data']
        if index >= offset:
            title = data['text']
            items.append({'id': data['uid'], 'parent_id': parent_id, 'order': order,
                          'text': title[:400], 'text_truncated': len(title) > 400})
        index += 1
        children = node.get('children', [])
        stack.extend((children[i], data['uid'], i) for i in range(len(children) - 1, -1, -1))
    return {'id': row.id, 'name': row.name, 'revision': row.revision, 'total': row.node_count,
            'items': items, 'page': args.page, 'page_size': args.page_size, 'has_more': bool(stack)}


mcp_provider = read_provider('思维导图', 'mindmap', '先找导图，再按需读取提纲节点。', {
    'search_maps': read_tool('查找思维导图', '导图目录', Search, search_maps),
    'read_map_outline': read_tool('读取导图提纲', '导图目录', MapRead, read_map_outline),
})
