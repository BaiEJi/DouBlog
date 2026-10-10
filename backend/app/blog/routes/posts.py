"""
文章API

提供文章的CRUD操作和树形结构查询

URL设计：
- GET /api/posts/id/<int:id> - 通过ID获取文章
- GET /api/posts/slug/<slug> - 通过slug获取文章
- PUT /api/posts/id/<int:id> - 通过ID更新文章
- PUT /api/posts/slug/<slug> - 通过slug更新文章
- DELETE /api/posts/id/<int:id> - 通过ID删除文章
- DELETE /api/posts/slug/<slug> - 通过slug删除文章
- GET /api/posts/path/<path:slug> - 通过完整路径获取文章（兼容旧版）
"""

import json
import re
from fastapi import APIRouter, Depends, Request
from sqlalchemy import or_, func
from sqlalchemy.orm import defer
from app.db import db, run_db
from app.blog.models import Post, Workspace
from app.shared.timestamps import _iso
from app.config import settings
from app.shared.auth import require_basic
from app.shared.response import api_response
from app.blog.services.view_count import increment_view
from app.blog.services.tree_order import ROOT_ID, get_children_order, set_children_order, append_child, remove_child
from app.blog.services.audit import log_action, request_ip

router = APIRouter(prefix='/api/posts', dependencies=[Depends(require_basic)])


MAX_LEVEL = 2


async def _json_body(request: Request) -> dict:
    """读取 JSON 请求体（坏/缺 body 回退空 dict，校验走原有错误文案）"""
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001 - 解析失败按空 body 处理
        return {}
    return data if isinstance(data, dict) else {}


def _query_int(request: Request, name: str, default=None):
    """query 参数取整（对齐 request.args.get(..., type=int)：缺省/非法回退默认值）"""
    raw = request.query_params.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def calculate_level(parent_id, session):
    """
    计算文章层级

    Args:
        parent_id: 父文章ID
        session: 数据库会话

    Returns:
        int: 层级值，-1表示超过最大层级限制
    """
    if parent_id is None or parent_id == ROOT_ID:
        return 0

    parent = session.query(Post).filter(Post.id == parent_id).first()
    if parent:
        new_level = parent.level + 1
        if new_level > MAX_LEVEL:
            return -1
        return new_level
    return 0


def build_full_slug(post_id, session):
    """
    根据文章ID递归构建完整slug路径（单篇文章场景使用）

    Args:
        post_id: 文章ID
        session: 数据库会话

    Returns:
        完整slug路径，如 /java/java8/container
    """
    parts = []
    current_id = post_id

    while current_id and current_id != ROOT_ID:
        post = session.query(Post).filter(Post.id == current_id).first()
        if not post:
            break
        parts.insert(0, post.name)
        current_id = post.parent_id

    if parts:
        return '/' + '/'.join(parts)
    return ''


def build_slug_map(session) -> dict[int, str]:
    """
    一次查询构建全部文章的 id -> slug 映射（内存逐级回溯，零额外查询）

    列表/详情等需要多篇 slug 的场景使用，替代逐篇调用 build_full_slug 的 N+1 查询。

    Args:
        session: 数据库会话

    Returns:
        dict[int, str]: 文章ID到完整slug路径的映射
    """
    rows = session.query(Post.id, Post.name, Post.parent_id).filter(Post.id != ROOT_ID).all()
    by_id = {row.id: row for row in rows}
    slug_cache: dict[int, str] = {}

    def walk(post_id: int) -> str:
        if post_id in slug_cache:
            return slug_cache[post_id]
        row = by_id.get(post_id)
        if not row:
            return ''
        parts = [row.name]
        current_id = row.parent_id
        while current_id and current_id != ROOT_ID:
            parent = by_id.get(current_id)
            if not parent:
                break
            parts.insert(0, parent.name)
            current_id = parent.parent_id
        slug = '/' + '/'.join(parts)
        slug_cache[post_id] = slug
        return slug

    return {post_id: walk(post_id) for post_id in by_id}


def _fetch_ancestors(session, rows: dict, max_rounds: int = 4):
    """按需补全 rows（id -> (name, parent_id)）中缺失的祖先行。

    树层级 ≤3，通常 0~2 轮 IN 小查询即收敛；max_rounds 兜底防脏数据成环。
    """
    pending = {pid for _, pid in rows.values() if pid not in (None, ROOT_ID) and pid not in rows}
    for _ in range(max_rounds):
        if not pending:
            break
        fetched = session.query(Post.id, Post.name, Post.parent_id).filter(
            Post.id.in_(pending)).all()
        for r in fetched:
            rows[r.id] = (r.name, r.parent_id)
        pending = {r.parent_id for r in fetched
                   if r.parent_id not in (None, ROOT_ID) and r.parent_id not in rows}


def _slug_from_rows(rows: dict, post_id: int, _depth: int = 0) -> str:
    """rows 内回溯父链拼完整 slug（与 build_slug_map 同语义：父行缺失即止）"""
    if _depth > 6:
        return ''
    entry = rows.get(post_id)
    if not entry:
        return ''
    name, parent_id = entry
    prefix = _slug_from_rows(rows, parent_id, _depth + 1) if parent_id not in (None, ROOT_ID) else ''
    return prefix + '/' + name


def update_slug_for_subtree(post_id, session):
    """
    批量更新文章及其所有子孙的slug（单次查询取全表 id/name/parent_id 后内存计算）

    Args:
        post_id: 文章ID
        session: 数据库会话
    """
    rows = session.query(Post.id, Post.name, Post.parent_id).filter(Post.id != ROOT_ID).all()
    by_id = {row.id: row for row in rows}

    # 收集受影响子树（BFS）
    children_map: dict[int, list] = {}
    for row in rows:
        children_map.setdefault(row.parent_id, []).append(row.id)
    affected = []
    queue = [post_id]
    while queue:
        current = queue.pop()
        affected.append(current)
        queue.extend(children_map.get(current, []))

    # 内存计算新slug并只更新有变化的行
    for pid in affected:
        row = by_id[pid]
        parts = [row.name]
        current_id = row.parent_id
        while current_id and current_id != ROOT_ID:
            parent = by_id.get(current_id)
            if not parent:
                break
            parts.insert(0, parent.name)
            current_id = parent.parent_id
        new_slug = '/' + '/'.join(parts)
        session.query(Post).filter(Post.id == pid).update({'slug': new_slug})


def validate_slug(slug: str) -> bool:
    """
    验证slug格式

    规则：
    - 英文开头
    - 只允许英文、数字、连字符(-)
    - 长度3-100字符

    Args:
        slug: 要验证的slug字符串

    Returns:
        bool: 是否有效
    """
    if not slug or len(slug) < 3 or len(slug) > 100:
        return False
    pattern = r'^[a-zA-Z][a-zA-Z0-9-]*$'
    return bool(re.match(pattern, slug))


@router.get('')
async def get_posts(request: Request):
    """
    获取文章列表（分页）

    Query参数：
    - page: 页码，默认1
    - page_size: 每页数量，默认20，最大100
    - workspace_id: 按知识库筛选（不传 = 全部）
    - parent_id: 按父级文章筛选
    - status: 按状态筛选（published/archived）
    - keyword: 按关键词搜索

    Returns:
        分页后的文章列表
    """
    def _impl():
        session = db.session

        page = _query_int(request, 'page', 1)
        page_size = min(_query_int(request, 'page_size', 20), settings.max_page_size)
        workspace_id = _query_int(request, 'workspace_id')
        parent_id = _query_int(request, 'parent_id')
        status = request.query_params.get('status')
        keyword = request.query_params.get('keyword')

        query = session.query(Post).filter(Post.id != ROOT_ID)

        if workspace_id is not None:
            query = query.filter(Post.workspace_id == workspace_id)

        if parent_id is not None:
            query = query.filter(Post.parent_id == parent_id)

        if status:
            query = query.filter(Post.status == status)

        if keyword:
            query = query.filter(
                or_(
                    Post.title.contains(keyword),
                    Post.summary.contains(keyword),
                    Post.name.contains(keyword),
                    Post.content.contains(keyword),
                )
            )

        query = query.order_by(Post.is_top.desc(), Post.id.asc())

        total = query.count()
        total_pages = (total + page_size - 1) // page_size
        # 列表不返回正文：defer 掉最大的 content 列，避免每页白白搬运 20 段 Markdown
        items = query.options(defer(Post.content)).offset((page - 1) * page_size).limit(page_size).all()

        post_ids = [item.id for item in items]

        children_counts = dict(
            session.query(Post.parent_id, func.count(Post.id))
            .filter(Post.parent_id.in_(post_ids))
            .group_by(Post.parent_id)
            .all()
        )

        # 只为页内文章按需取祖先链（≤3 层，顶级文章零额外查询），
        # 替代 build_slug_map 的全表加载；view_count 行上已有，不再重复回查
        rows = {it.id: (it.name, it.parent_id) for it in items}
        _fetch_ancestors(session, rows)

        result_items = []
        for item in items:
            item_dict = item.to_dict(include_content=False)
            item_dict['slug'] = _slug_from_rows(rows, item.id)
            item_dict['children_count'] = children_counts.get(item.id, 0)
            item_dict['view_count'] = item.view_count
            result_items.append(item_dict)

        return api_response({
            'items': result_items,
            'total': total,
            'page': page,
            'page_size': page_size,
            'total_pages': total_pages
        })
    return await run_db(_impl)


@router.get('/tree')
async def get_post_tree(request: Request):
    """
    获取文章树形结构（按知识库）

    Query参数：
    - workspace_id: 知识库ID（不传 = 默认知识库，即 id 最小的库）

    Returns:
        树形结构的文章列表
    """
    def _impl():
        session = db.session

        # 确定知识库
        workspace_id = _query_int(request, 'workspace_id')
        if workspace_id is not None:
            workspace = session.query(Workspace).filter(Workspace.id == workspace_id).first()
            if not workspace:
                return api_response(None, 404, '知识库不存在')
        else:
            workspace = session.query(Workspace).order_by(Workspace.id.asc()).first()
            if not workspace:
                return api_response([])

        # 查询该知识库的全部文章（不含虚拟根；正文不进树响应，defer 掉最大列）
        posts = session.query(Post).options(defer(Post.content)).filter(
            Post.id != ROOT_ID, Post.workspace_id == workspace.id
        ).all()

        # view_count 随行加载（同一事务快照内与单独回查等值），不再批量重查

        # 构建 parent_map 和 slug_map（内存计算，零额外查询）
        post_by_id = {post.id: post for post in posts}
        slug_cache = {}

        def build_slug_in_memory(post_id):
            if post_id in slug_cache:
                return slug_cache[post_id]
            parts = []
            current_id = post_id
            while current_id and current_id != ROOT_ID:
                p = post_by_id.get(current_id)
                if not p:
                    break
                parts.insert(0, p.name)
                current_id = p.parent_id
            slug = '/' + '/'.join(parts) if parts else ''
            slug_cache[post_id] = slug
            return slug

        # 构建 post_map
        post_map = {}
        for post in posts:
            post_dict = post.to_tree_dict()
            post_dict['slug'] = build_slug_in_memory(post.id)
            post_dict['view_count'] = post.view_count
            post_map[post.id] = post_dict

        # 组装树结构
        tree = []
        for post in posts:
            post_dict = post_map[post.id]
            if post.parent_id == ROOT_ID or post.parent_id is None:
                tree.append(post_dict)
            else:
                parent = post_map.get(post.parent_id)
                if parent:
                    parent.setdefault('children', []).append(post_dict)

        # 顶级按知识库的 children_order 排序
        root_order = workspace._parse_children_order()
        if root_order:
            id_to_root = {r['id']: r for r in tree}
            tree = [id_to_root[i] for i in root_order if i in id_to_root]

        def sort_children(node):
            order = node.get('children_order', [])
            if order and node.get('children'):
                id_to_child = {c['id']: c for c in node['children']}
                node['children'] = [id_to_child[i] for i in order if i in id_to_child]
            for child in node.get('children', []):
                sort_children(child)

        for root in tree:
            sort_children(root)

        return api_response(tree)
    return await run_db(_impl)


def _post_detail(session, post, view_value=None):
    """详情公共组装：浏览计数由调用方按需递增后显式传入（免重复回查）。

    slug 经祖先链小查询计算（≤3 层），替代旧版 build_slug_map 全表加载；
    子文章 slug = 本文 slug + '/' + name（按 slug 构造不变式直接推导）。
    """
    post_dict = post.to_dict()
    rows = {post.id: (post.name, post.parent_id)}
    _fetch_ancestors(session, rows)
    slug = _slug_from_rows(rows, post.id)
    post_dict['slug'] = slug
    post_dict['view_count'] = view_value if view_value is not None else post.view_count

    if post.parent_id:
        parent = session.query(Post.id, Post.title, Post.name).filter(
            Post.id == post.parent_id).first()
        if parent:
            post_dict['parent'] = {
                'id': parent.id,
                'title': parent.title,
                'name': parent.name,
                'slug': _slug_from_rows(rows, post.parent_id)
            }

    # 按 children_order 排序子文章（只取概览所需列，不搬正文）
    order = get_children_order(post)
    children = session.query(Post.id, Post.title, Post.name, Post.level).filter(
        Post.parent_id == post.id).all()
    if order:
        id_to_child = {c.id: c for c in children}
        children = [id_to_child[i] for i in order if i in id_to_child]

    post_dict['children'] = [
        {
            'id': child.id,
            'title': child.title,
            'name': child.name,
            'slug': slug + '/' + child.name,
            'level': child.level
        }
        for child in children
    ]
    return post_dict


@router.get('/id/{post_id}')
async def get_post_by_id(post_id: int, request: Request):
    """
    通过ID获取文章详情

    Args:
        post_id: 文章ID
        no_view: 传 1 时不计浏览量（前端链接 hover 预取使用，避免虚增计数）

    Returns:
        文章详情，包含父文章和子文章信息
    """
    def _impl():
        session = db.session

        post = session.query(Post).filter(Post.id == post_id).first()

        if not post:
            return api_response(None, 404, '文章不存在')

        if request.query_params.get('no_view') != '1':
            view_value = increment_view(post.id)
        else:
            view_value = None

        return api_response(_post_detail(session, post, view_value=view_value))
    return await run_db(_impl)


@router.get('/slug/{slug}')
async def get_post_by_slug(slug: str):
    """
    通过slug获取文章详情

    Args:
        slug: 文章slug（简单标识符）

    Returns:
        文章详情，包含父文章和子文章信息
    """
    def _impl():
        session = db.session

        # slug是简单的标识符，直接匹配name字段
        post = session.query(Post).filter(Post.name == slug).first()

        if not post:
            return api_response(None, 404, '文章不存在')

        return api_response(_post_detail(session, post, view_value=increment_view(post.id)))
    return await run_db(_impl)


@router.get('/path/{slug:path}')
async def get_post_by_path(slug: str):
    """
    通过完整路径获取文章（兼容旧版）

    Args:
        slug: 完整路径，如 /java/java8/container

    Returns:
        文章详情，包含父文章和子文章信息
    """
    def _impl():
        session = db.session

        # 注意不能对闭包变量 slug 赋值（会把 slug 变成本地变量 →
        # UnboundLocalError，Flask→FastAPI 迁移时引入的隐性 500）
        path = slug if slug.startswith('/') else '/' + slug

        post = session.query(Post).filter(Post.slug == path).first()

        if not post:
            # 尝试按路径解析
            parts = path.strip('/').split('/')
            if not parts:
                return api_response(None, 404, '文章不存在')

            # 从根开始查找
            name = parts[0]
            post = session.query(Post).filter(Post.name == name, Post.parent_id == None).first()  # noqa: E711

            for part in parts[1:]:
                if not post:
                    break
                post = session.query(Post).filter(Post.name == part, Post.parent_id == post.id).first()

        if not post:
            return api_response(None, 404, '文章不存在')

        return api_response(_post_detail(session, post, view_value=increment_view(post.id)))
    return await run_db(_impl)


@router.post('')
async def create_post(request: Request):
    """
    创建文章

    请求体：
    - title: 标题（必填）
    - name: 英文名/标识符（必填，知识库内唯一）
    - content: 内容
    - summary: 摘要
    - workspace_id: 所属知识库ID（缺省 = 默认知识库）
    - parent_id: 父文章ID（None 则挂在该知识库顶级）
    - status: 状态
    - is_top: 是否置顶
    - tags: 标签数组

    Returns:
        创建的文章信息
    """
    data = await _json_body(request)
    ip = request_ip(request)

    def _impl():
        session = db.session

        if not data.get('title'):
            return api_response(None, 400, '标题不能为空')

        # 确定知识库
        workspace_id = data.get('workspace_id')
        if workspace_id:
            workspace = session.query(Workspace).filter(Workspace.id == workspace_id).first()
            if not workspace:
                return api_response(None, 400, '知识库不存在')
        else:
            workspace = session.query(Workspace).order_by(Workspace.id.asc()).first()
            if not workspace:
                return api_response(None, 400, '知识库不存在')

        # name 字段：优先使用传入的 name，否则从 slug 解析
        name = data.get('name') or (data.get('slug', '').strip('/') or '').split('/')[-1]

        if not name:
            return api_response(None, 400, '英文名不能为空')

        # 验证slug格式
        if not validate_slug(name):
            return api_response(None, 400, '英文名格式无效：必须以英文字母开头，只允许英文、数字和连字符，长度3-100字符')

        parent_id = data.get('parent_id') or ROOT_ID

        # 验证name在知识库内唯一
        existing = session.query(Post).filter(
            Post.name == name, Post.workspace_id == workspace.id
        ).first()
        if existing:
            return api_response(None, 400, '该英文名已被使用，请使用其他名称')

        # 父文章单次查询，复用于层级/归属校验、slug 前缀与 children_order 追加
        # （替代原 calculate_level + parent_ws + append_child 三处重复回查）
        parent = None
        if parent_id != ROOT_ID:
            parent = session.query(Post).filter(Post.id == parent_id).first()

        level = 0
        if parent is not None:
            if parent.level + 1 > MAX_LEVEL:
                return api_response(None, 400, f'父文章已达最大层级限制（最多{MAX_LEVEL + 1}层）')
            if parent.workspace_id != workspace.id:
                return api_response(None, 400, '父文章不属于该知识库')
            level = parent.level + 1

        # 完整slug：父级 slug 前缀直推（存量空 slug 回退逐级回溯），
        # 免去对刚插入行再做整链查询
        if parent is not None and parent.slug:
            full_slug = parent.slug + '/' + name
        elif parent is not None:
            full_slug = build_full_slug(parent.id, session) + '/' + name
        else:
            full_slug = '/' + name

        # 创建文章
        post = Post(
            title=data['title'],
            name=name,
            slug=full_slug,
            content=data.get('content', ''),
            summary=data.get('summary'),
            workspace_id=workspace.id,
            parent_id=parent_id,
            level=level,
            author='admin',
            status=data.get('status', 'published'),
            is_top=data.get('is_top', False),
            tags=json.dumps(data.get('tags')) if data.get('tags') else None
        )

        session.add(post)
        session.flush()  # 获取ID（created_at/updated_at 经 INSERT RETURNING 一并带回）

        # 追加到父节点（或知识库顶级）的 children_order
        if parent_id == ROOT_ID:
            order = workspace._parse_children_order()
            if post.id not in order:
                order.append(post.id)
                workspace.children_order = json.dumps(order)
        elif parent is not None:
            append_child(parent, post.id)

        log_action('create', 'post', post.id, {'title': post.title, 'workspace_id': workspace.id},
                   ip_address=ip)
        session.commit()  # expire_on_commit=False，flush 时取回的属性仍有效（免 refresh 回查）

        return api_response({
            'id': post.id,
            'title': post.title,
            'name': post.name,
            'slug': post.slug,
            'workspace_id': post.workspace_id,
            'level': post.level,
            'created_at': _iso(post.created_at)
        }, 201, '创建成功')
    return await run_db(_impl)


def _update_post(session, post, data, ip):
    """更新文章公共逻辑（ID 与 slug 两个入口共用）"""
    if 'title' in data:
        post.title = data['title']

    if 'content' in data:
        post.content = data['content']

    if 'summary' in data:
        post.summary = data['summary']

    if 'status' in data:
        post.status = data['status']

    if 'is_top' in data:
        post.is_top = data['is_top']

    if 'tags' in data:
        post.tags = json.dumps(data['tags']) if data['tags'] else None

    # 处理name更新
    if 'name' in data and data['name'] != post.name:
        new_name = data['name']

        # 验证slug格式
        if not validate_slug(new_name):
            return api_response(None, 400, '英文名格式无效：必须以英文字母开头，只允许英文、数字和连字符，长度3-100字符')

        # 验证name在知识库内唯一
        existing = session.query(Post).filter(
            Post.name == new_name, Post.id != post.id,
            Post.workspace_id == post.workspace_id
        ).first()
        if existing:
            return api_response(None, 400, '该英文名已被使用，请使用其他名称')

        post.name = new_name
        # 更新slug（级联更新子孙文章）
        update_slug_for_subtree(post.id, session)

    # 处理父文章更新（不支持跨知识库移动）
    if 'parent_id' in data:
        new_parent_id = data['parent_id'] or ROOT_ID

        if new_parent_id == post.id:
            return api_response(None, 400, '不能将自己设为父文章')

        if new_parent_id != ROOT_ID:
            new_parent_ws = session.query(Post.workspace_id).filter(Post.id == new_parent_id).first()
            if new_parent_ws and new_parent_ws[0] != post.workspace_id:
                return api_response(None, 400, '不能跨知识库移动文章')

        old_parent_id = post.parent_id

        if new_parent_id != old_parent_id:
            # 从旧父节点（或知识库顶级）的 children_order 中移除
            if old_parent_id == ROOT_ID or old_parent_id is None:
                ws = session.query(Workspace).filter(Workspace.id == post.workspace_id).first()
                if ws:
                    order = [x for x in ws._parse_children_order() if x != post.id]
                    ws.children_order = json.dumps(order)
            if old_parent_id:
                old_parent = session.query(Post).filter(Post.id == old_parent_id).first()
                if old_parent:
                    remove_child(old_parent, post.id)

            if new_parent_id != ROOT_ID:
                new_parent = session.query(Post).filter(Post.id == new_parent_id).first()
                if not new_parent:
                    return api_response(None, 400, '父文章不存在')

                if new_parent.level >= MAX_LEVEL:
                    return api_response(None, 400, f'父文章已达最大层级限制（最多{MAX_LEVEL + 1}层）')

                def is_descendant(post_id, potential_parent_id):
                    # 内存父链回溯（一次查询构建映射，替代逐级查库）
                    rows = session.query(Post.id, Post.parent_id).filter(Post.id != ROOT_ID).all()
                    parent_of = {row.id: row.parent_id for row in rows}
                    current_id = potential_parent_id
                    while current_id and current_id != ROOT_ID:
                        if current_id == post_id:
                            return True
                        current_id = parent_of.get(current_id)
                    return False

                if is_descendant(post.id, new_parent_id):
                    return api_response(None, 400, '不能选择自己的子孙文章作为父文章')

                post.parent_id = new_parent_id
                post.level = new_parent.level + 1
                # 追加到新父节点
                append_child(new_parent, post.id)
            else:
                post.parent_id = ROOT_ID
                post.level = 0
                # 追加到知识库顶级
                ws = session.query(Workspace).filter(Workspace.id == post.workspace_id).first()
                if ws:
                    order = ws._parse_children_order()
                    if post.id not in order:
                        order.append(post.id)
                        ws.children_order = json.dumps(order)

            # 批量更新本文章及所有子孙的slug
            update_slug_for_subtree(post.id, session)

    log_action('update', 'post', post.id, {'fields': list(data.keys())}, ip_address=ip)
    session.commit()
    session.refresh(post)

    return api_response({
        'id': post.id,
        'title': post.title,
        'name': post.name,
        'slug': post.slug,
        'level': post.level,
        'parent_id': post.parent_id,
        'updated_at': _iso(post.updated_at)
    }, 200, '更新成功')


@router.put('/id/{post_id}')
async def update_post_by_id(post_id: int, request: Request):
    """
    通过ID更新文章

    Args:
        post_id: 文章ID

    请求体：
    - title: 标题
    - content: 内容
    - summary: 摘要
    - status: 状态
    - is_top: 是否置顶
    - tags: 标签数组
    - name: 英文名
    - parent_id: 父文章ID

    Returns:
        更新后的文章信息
    """
    data = await _json_body(request)
    ip = request_ip(request)

    def _impl():
        session = db.session

        post = session.query(Post).filter(Post.id == post_id).first()

        if not post:
            return api_response(None, 404, '文章不存在')

        return _update_post(session, post, data, ip)
    return await run_db(_impl)


@router.put('/slug/{slug}')
async def update_post_by_slug(slug: str, request: Request):
    """
    通过slug更新文章

    Args:
        slug: 文章slug（简单标识符）

    请求体：同 update_post_by_id

    Returns:
        更新后的文章信息
    """
    data = await _json_body(request)
    ip = request_ip(request)

    def _impl():
        session = db.session

        post = session.query(Post).filter(Post.name == slug).first()

        if not post:
            return api_response(None, 404, '文章不存在')

        # 复用ID更新的逻辑
        return _update_post(session, post, data, ip)
    return await run_db(_impl)


def _delete_post(session, post, recursive, ip):
    """删除文章公共逻辑（ID 与 slug 两个入口共用）"""
    # 从父节点（或知识库顶级）的 children_order 中移除
    parent_id = post.parent_id if post.parent_id is not None else ROOT_ID
    if parent_id == ROOT_ID:
        ws = session.query(Workspace).filter(Workspace.id == post.workspace_id).first()
        if ws:
            order = [x for x in ws._parse_children_order() if x != post.id]
            ws.children_order = json.dumps(order)
    else:
        parent = session.query(Post).filter(Post.id == parent_id).first()
        if parent:
            remove_child(parent, post.id)

    if recursive:
        # 递归删除所有子孙文章
        def delete_descendants(pid):
            children = session.query(Post).filter(Post.parent_id == pid).all()
            for child in children:
                delete_descendants(child.id)
                session.delete(child)
        delete_descendants(post.id)
    else:
        # 子文章提升到知识库顶级
        children = session.query(Post).filter(Post.parent_id == post.id).all()
        ws = session.query(Workspace).filter(Workspace.id == post.workspace_id).first()
        for child in children:
            child.parent_id = ROOT_ID
            child.level = 0
            if ws:
                order = ws._parse_children_order()
                if child.id not in order:
                    order.append(child.id)
                    ws.children_order = json.dumps(order)

    session.delete(post)
    log_action('delete', 'post', post.id, {'title': post.title, 'recursive': recursive},
               ip_address=ip)
    session.commit()

    return api_response(None, 200, '删除成功')


@router.delete('/id/{post_id}')
async def delete_post_by_id(post_id: int, request: Request):
    """
    通过ID删除文章

    Args:
        post_id: 文章ID

    Returns:
        成功消息
    """
    recursive = request.query_params.get('recursive') == '1'
    ip = request_ip(request)

    def _impl():
        session = db.session

        post = session.query(Post).filter(Post.id == post_id).first()

        if not post:
            return api_response(None, 404, '文章不存在')

        return _delete_post(session, post, recursive, ip)
    return await run_db(_impl)


@router.delete('/slug/{slug}')
async def delete_post_by_slug(slug: str, request: Request):
    """
    通过slug删除文章

    Args:
        slug: 文章slug（简单标识符）

    Returns:
        成功消息
    """
    recursive = request.query_params.get('recursive') == '1'
    ip = request_ip(request)

    def _impl():
        session = db.session

        post = session.query(Post).filter(Post.name == slug).first()

        if not post:
            return api_response(None, 404, '文章不存在')

        return _delete_post(session, post, recursive, ip)
    return await run_db(_impl)


@router.put('/reorder')
async def reorder_children(request: Request):
    """
    拖拽排序：更新指定父节点下的子节点顺序

    请求体：
    - parent_id: 父节点ID（0 表示知识库顶级）
    - workspace_id: 知识库ID（parent_id 为 0 时必传）
    - children_order: 新的子节点 ID 数组，如 [3, 1, 5]

    Returns:
        成功消息
    """
    data = await _json_body(request)

    def _impl():
        session = db.session

        parent_id = data.get('parent_id', ROOT_ID)
        new_order = data.get('children_order', [])

        if parent_id == ROOT_ID:
            workspace_id = data.get('workspace_id')
            ws = session.query(Workspace).filter(Workspace.id == workspace_id).first() if workspace_id \
                else session.query(Workspace).order_by(Workspace.id.asc()).first()
            if not ws:
                return api_response(None, 404, '知识库不存在')
            ws.children_order = json.dumps(new_order)
        else:
            parent = session.query(Post).filter(Post.id == parent_id).first()
            if not parent:
                return api_response(None, 404, '父节点不存在')
            set_children_order(parent, new_order)

        session.commit()

        return api_response(None, 200, '排序更新成功')
    return await run_db(_impl)


@router.get('/audit-logs')
async def get_audit_logs(request: Request):
    """
    查询操作日志

    Query参数：
    - page: 页码，默认1
    - page_size: 每页数量，默认20

    Returns:
        分页后的操作日志列表
    """
    from app.blog.models import AuditLog

    def _impl():
        page = _query_int(request, 'page', 1)
        page_size = min(_query_int(request, 'page_size', 20), settings.max_page_size)

        query = AuditLog.query.order_by(AuditLog.created_at.desc())
        total = query.count()
        items = query.offset((page - 1) * page_size).limit(page_size).all()

        return api_response({
            'items': [i.to_dict() for i in items],
            'total': total,
            'page': page,
            'page_size': page_size
        })
    return await run_db(_impl)


# ─── 最近浏览 / 双链反链 ──────────────────────────────────

WIKI_LINK_RE = re.compile(r'\[\[([^\[\]]+)\]\]')


@router.get('/recent')
async def get_recent_posts(request: Request):
    """
    最近浏览的文章（按 last_viewed_at 倒序，跨所有知识库）

    Query Parameters:
        limit: 返回数量，默认 10，上限 50

    Returns:
        items: 文章概览列表（不含正文），附 workspace_name
    """
    def _impl():
        limit = min(_query_int(request, 'limit', 10), 50)
        posts = (Post.query
                 .options(defer(Post.content))
                 .filter(Post.last_viewed_at.isnot(None), Post.status == 'published')
                 .order_by(Post.last_viewed_at.desc())
                 .limit(limit)
                 .all())
        ws_names = dict(db.session.query(Workspace.id, Workspace.name).all())
        return api_response([{
            'id': p.id,
            'title': p.title,
            'name': p.name,
            'summary': p.summary or '',
            'workspace_id': p.workspace_id,
            'workspace_name': ws_names.get(p.workspace_id, ''),
            'view_count': p.view_count,
            'last_viewed_at': _iso(p.last_viewed_at),
        } for p in posts])
    return await run_db(_impl)


@router.get('/id/{post_id}/backlinks')
async def get_post_backlinks(post_id: int):
    """
    反向链接：同知识库内正文中用 [[双链]] 指向该文章的所有文章

    双链寻址规则与前端渲染一致：
        [[name]] 或 [[标题]] 或 [[name|显示文字]] / [[标题|显示文字]]
        先按英文名(name)精确匹配，再按标题(title)精确匹配
    """
    def _impl():
        target = db.session.query(Post).filter(Post.id == post_id).first()
        if not target:
            return api_response(None, 404, '文章不存在')

        candidates = (db.session.query(Post)
                      .filter(Post.workspace_id == target.workspace_id,
                              Post.id != target.id,
                              Post.content.like('%[[%'))
                      .all())

        items = []
        for cand in candidates:
            targets = [m.group(1) for m in WIKI_LINK_RE.finditer(cand.content or '')]
            linked = any(t.split('|')[0].strip() in (target.name, target.title) for t in targets)
            if linked:
                items.append({
                    'id': cand.id,
                    'title': cand.title,
                    'name': cand.name,
                    'summary': cand.summary or '',
                })
        return api_response({'items': items, 'total': len(items)})
    return await run_db(_impl)
