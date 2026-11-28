from pydantic import Field
from sqlalchemy import select

from app.shared.mcp_read import IntId, Paged, Search, TextId, page_rows, read_provider, read_tool
from app.shared.mcp_write import Write, add_writes, existing_write_tool, scoped_mutation
from . import services
from .models import MindMap


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
    row = services.require_map(args.map_id)
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


class MapCreate(Write):
    name: str = Field(min_length=1, max_length=200, description='新建导图的名称。', examples=['项目规划'])
    workspace_id: IntId | None = Field(default=None, description='可选的关联知识库。', examples=[1])
    post_id: IntId | None = Field(default=None, description='可选的关联文章。', examples=[1])


class MapEdit(Write):
    map_id: IntId = Field(description='要修改的导图 ID。', examples=[1])
    revision: IntId = Field(description='读取导图得到的当前版本号。', examples=[1])


class MapRename(MapEdit):
    name: str = Field(min_length=1, max_length=200, description='导图的新名称。', examples=['更新项目规划'])


class AddNode(MapEdit):
    parent_id: TextId = Field(max_length=128, description='父节点 ID，从导图提纲读取。', examples=['root-node-id'])
    text: str = Field(min_length=1, max_length=10000, description='新节点的文字。', examples=['确认交付日期'])


def create_map(args, token_id):
    """创建导图和根节点，可关联知识库与文章。"""
    body = args.model_dump(exclude_none=True, exclude={'mutation_id'})
    body['mutation_id'] = scoped_mutation(token_id, args.mutation_id)
    _, result = services.mutation('mcp:create', body, lambda: services.create_map(body, 'MCP', None))
    return {key: result[key] for key in ('id', 'name', 'revision', 'node_count')}


def rename_map(args, token_id):
    """按版本号修改导图名称并记录版本历史。"""
    body = {'name': args.name, 'revision': args.revision, 'mutation_id': scoped_mutation(token_id, args.mutation_id)}
    _, result = services.mutation(f'mcp:rename:{args.map_id}', body,
                                  lambda: services.patch_map(args.map_id, body, 'MCP', None))
    return {key: result[key] for key in ('id', 'name', 'revision')}


def add_map_node(args, token_id):
    """在指定父节点末尾新增一个文本节点。"""
    mid = scoped_mutation(token_id, args.mutation_id)
    # Use the same node ID on retry, so the native receipt fingerprint stays stable.
    uid = mid[:32]
    body = {'revision': args.revision, 'mutation_id': mid, 'operations': [{
        'op': 'add', 'parent_id': args.parent_id, 'node': {'data': {'uid': uid, 'text': args.text}, 'children': []},
    }]}
    _, result = services.mutation(f'mcp:add-node:{args.map_id}', body,
                                  lambda: services.batch_nodes(args.map_id, body, 'MCP', None))
    return {'id': result['id'], 'revision': result['revision'], 'node_id': uid, 'node_count': result['node_count']}


mcp_provider = add_writes(mcp_provider, {
    'create_map': existing_write_tool('新建导图', '导图编辑', MapCreate, create_map),
    'rename_map': existing_write_tool('重命名导图', '导图编辑', MapRename, rename_map),
    'add_map_node': existing_write_tool('追加导图节点', '导图编辑', AddNode, add_map_node),
})
