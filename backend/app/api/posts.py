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
from flask import Blueprint, request
from sqlalchemy import or_, func
from app.db import db
from app.models.models import Post
from app.config import settings
from app.api.auth import auth
from app.utils.response import api_response
from app.utils.view_count import increment_view, get_view_count, get_all_view_counts, delete_view_count

bp = Blueprint('posts', __name__, url_prefix='/api/posts')


MAX_LEVEL = 2


def calculate_level(parent_id, session):
    """
    计算文章层级
    
    Args:
        parent_id: 父文章ID
        session: 数据库会话
    
    Returns:
        int: 层级值，-1表示超过最大层级限制
    """
    if parent_id is None:
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
    根据文章ID递归构建完整slug路径
    
    用于兼容旧版API和前端展示
    
    Args:
        post_id: 文章ID
        session: 数据库会话
    
    Returns:
        完整slug路径，如 /java/java8/container
    """
    parts = []
    current_id = post_id
    
    while current_id:
        post = session.query(Post).filter(Post.id == current_id).first()
        if not post:
            break
        parts.insert(0, post.name)
        current_id = post.parent_id
    
    if parts:
        return '/' + '/'.join(parts)
    return ''


def update_slug_for_post_and_children(post_id, session):
    """
    更新文章及其所有子孙的slug
    
    Args:
        post_id: 文章ID
        session: 数据库会话
    """
    post = session.query(Post).filter(Post.id == post_id).first()
    if not post:
        return
    
    # 更新当前文章的slug
    post.slug = build_full_slug(post.id, session)
    
    # 递归更新子文章
    children = session.query(Post).filter(Post.parent_id == post.id).all()
    for child in children:
        update_slug_for_post_and_children(child.id, session)


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


def validate_name(name, parent_id, exclude_id=None, session=None):
    """
    验证name在同级是否唯一
    
    Args:
        name: 英文名
        parent_id: 父文章ID
        exclude_id: 排除的文章ID（用于更新时排除自己）
        session: 数据库会话
    
    Returns:
        (bool, str): (是否有效, 错误消息)
    """
    if not name:
        return False, '英文名不能为空'
    
    # 验证name格式：只允许字母、数字、中文和连字符
    if not re.match(r'^[\w\u4e00-\u9fa5-]+$', name):
        return False, '英文名只能包含字母、数字、中文和连字符'
    
    # 查询同级是否有相同name
    query = session.query(Post).filter(Post.name == name, Post.parent_id == parent_id)
    if exclude_id:
        query = query.filter(Post.id != exclude_id)
    
    if query.first():
        return False, '同级已存在相同英文名的文章'
    
    return True, ''


@bp.route('', methods=['GET'])
@auth.login_required
def get_posts():
    """
    获取文章列表（分页）
    
    Query参数：
    - page: 页码，默认1
    - page_size: 每页数量，默认20，最大100
    - parent_id: 按父级文章筛选
    - status: 按状态筛选（published/archived）
    - keyword: 按关键词搜索
    
    Returns:
        分页后的文章列表
    """
    session = db.session
    
    page = request.args.get('page', 1, type=int)
    page_size = min(request.args.get('page_size', 20, type=int), settings.max_page_size)
    parent_id = request.args.get('parent_id', type=int)
    status = request.args.get('status')
    keyword = request.args.get('keyword')
    
    query = session.query(Post)
    
    if parent_id is not None:
        query = query.filter(Post.parent_id == parent_id)
    
    if status:
        query = query.filter(Post.status == status)
    
    if keyword:
        query = query.filter(
            or_(
                Post.title.contains(keyword),
                Post.summary.contains(keyword),
                Post.name.contains(keyword)
            )
        )
    
    query = query.order_by(Post.is_top.desc(), Post.order.asc(), Post.created_at.desc())
    
    total = query.count()
    total_pages = (total + page_size - 1) // page_size
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    
    post_ids = [item.id for item in items]
    view_counts = get_all_view_counts(post_ids)
    
    children_counts = dict(
        session.query(Post.parent_id, func.count(Post.id))
        .filter(Post.parent_id.in_(post_ids))
        .group_by(Post.parent_id)
        .all()
    )
    
    result_items = []
    for item in items:
        item_dict = item.to_dict()
        # 动态计算slug
        item_dict['slug'] = build_full_slug(item.id, session)
        item_dict['children_count'] = children_counts.get(item.id, 0)
        item_dict['view_count'] = view_counts.get(item.id, item.view_count)
        result_items.append(item_dict)
    
    return api_response({
        'items': result_items,
        'total': total,
        'page': page,
        'page_size': page_size,
        'total_pages': total_pages
    })


@bp.route('/tree', methods=['GET'])
@auth.login_required
def get_post_tree():
    """
    获取文章树形结构
    
    Returns:
        树形结构的文章列表
    """
    session = db.session
    
    posts = session.query(Post).order_by(Post.level.asc(), Post.order.asc()).all()
    
    post_ids = [post.id for post in posts]
    view_counts = get_all_view_counts(post_ids)
    
    # 预计算所有slug
    slug_cache = {}
    for post in posts:
        slug_cache[post.id] = build_full_slug(post.id, session)
    
    post_map = {}
    tree = []
    
    for post in posts:
        post_dict = post.to_tree_dict()
        post_dict['slug'] = slug_cache.get(post.id, '')
        post_dict['view_count'] = view_counts.get(post.id, post.view_count)
        post_map[post.id] = post_dict
        
        if post.parent_id is None:
            tree.append(post_dict)
        else:
            parent = post_map.get(post.parent_id)
            if parent:
                parent['children'].append(post_dict)
    
    return api_response(tree)


@bp.route('/id/<int:post_id>', methods=['GET'])
@auth.login_required
def get_post_by_id(post_id):
    """
    通过ID获取文章详情
    
    Args:
        post_id: 文章ID
    
    Returns:
        文章详情，包含父文章和子文章信息
    """
    session = db.session
    
    post = session.query(Post).filter(Post.id == post_id).first()
    
    if not post:
        return api_response(None, 404, '文章不存在')
    
    increment_view(post.id)
    
    post_dict = post.to_dict()
    post_dict['slug'] = build_full_slug(post.id, session)
    post_dict['view_count'] = get_view_count(post.id)
    
    if post.parent_id:
        parent = session.query(Post).filter(Post.id == post.parent_id).first()
        if parent:
            post_dict['parent'] = {
                'id': parent.id,
                'title': parent.title,
                'name': parent.name,
                'slug': build_full_slug(parent.id, session)
            }
    
    children = session.query(Post).filter(Post.parent_id == post.id).order_by(Post.order).all()
    post_dict['children'] = [
        {
            'id': child.id,
            'title': child.title,
            'name': child.name,
            'slug': build_full_slug(child.id, session),
            'level': child.level
        }
        for child in children
    ]
    
    return api_response(post_dict)


@bp.route('/slug/<slug>', methods=['GET'])
@auth.login_required
def get_post_by_slug(slug):
    """
    通过slug获取文章详情
    
    Args:
        slug: 文章slug（简单标识符）
    
    Returns:
        文章详情，包含父文章和子文章信息
    """
    session = db.session
    
    # slug是简单的标识符，直接匹配name字段
    post = session.query(Post).filter(Post.name == slug).first()
    
    if not post:
        return api_response(None, 404, '文章不存在')
    
    increment_view(post.id)
    
    post_dict = post.to_dict()
    post_dict['slug'] = build_full_slug(post.id, session)
    post_dict['view_count'] = get_view_count(post.id)
    
    if post.parent_id:
        parent = session.query(Post).filter(Post.id == post.parent_id).first()
        if parent:
            post_dict['parent'] = {
                'id': parent.id,
                'title': parent.title,
                'name': parent.name,
                'slug': build_full_slug(parent.id, session)
            }
    
    children = session.query(Post).filter(Post.parent_id == post.id).order_by(Post.order).all()
    post_dict['children'] = [
        {
            'id': child.id,
            'title': child.title,
            'name': child.name,
            'slug': build_full_slug(child.id, session),
            'level': child.level
        }
        for child in children
    ]
    
    return api_response(post_dict)


@bp.route('/path/<path:slug>', methods=['GET'])
@auth.login_required
def get_post_by_path(slug):
    """
    通过完整路径获取文章（兼容旧版）
    
    Args:
        slug: 完整路径，如 /java/java8/container
    
    Returns:
        文章详情，包含父文章和子文章信息
    """
    session = db.session
    
    if not slug.startswith('/'):
        slug = '/' + slug
    
    post = session.query(Post).filter(Post.slug == slug).first()
    
    if not post:
        # 尝试按路径解析
        parts = slug.strip('/').split('/')
        if not parts:
            return api_response(None, 404, '文章不存在')
        
        # 从根开始查找
        name = parts[0]
        post = session.query(Post).filter(Post.name == name, Post.parent_id == None).first()
        
        for part in parts[1:]:
            if not post:
                break
            post = session.query(Post).filter(Post.name == part, Post.parent_id == post.id).first()
    
    if not post:
        return api_response(None, 404, '文章不存在')
    
    increment_view(post.id)
    
    post_dict = post.to_dict()
    post_dict['slug'] = build_full_slug(post.id, session)
    post_dict['view_count'] = get_view_count(post.id)
    
    if post.parent_id:
        parent = session.query(Post).filter(Post.id == post.parent_id).first()
        if parent:
            post_dict['parent'] = {
                'id': parent.id,
                'title': parent.title,
                'name': parent.name,
                'slug': build_full_slug(parent.id, session)
            }
    
    children = session.query(Post).filter(Post.parent_id == post.id).order_by(Post.order).all()
    post_dict['children'] = [
        {
            'id': child.id,
            'title': child.title,
            'name': child.name,
            'slug': build_full_slug(child.id, session),
            'level': child.level
        }
        for child in children
    ]
    
    return api_response(post_dict)


@bp.route('', methods=['POST'])
@auth.login_required
def create_post():
    """
    创建文章
    
    请求体：
    - title: 标题（必填）
    - name: 英文名/标识符（可选，如果不提供则从slug解析）
    - slug: 别名（可选，用于兼容旧版）
    - content: 内容
    - summary: 摘要
    - parent_id: 父文章ID
    - order: 排序
    - status: 状态
    - is_top: 是否置顶
    - tags: 标签数组
    
    Returns:
        创建的文章信息
    """
    session = db.session
    data = request.get_json()
    
    if not data.get('title'):
        return api_response(None, 400, '标题不能为空')
    
    # name 字段：优先使用传入的 name，否则从 slug 解析
    name = data.get('name') or (data.get('slug', '').strip('/') or '').split('/')[-1]
    
    if not name:
        return api_response(None, 400, '英文名不能为空')
    
    # 验证slug格式
    if not validate_slug(name):
        return api_response(None, 400, '英文名格式无效：必须以英文字母开头，只允许英文、数字和连字符，长度3-100字符')
    
    parent_id = data.get('parent_id')
    
    # 验证name全局唯一性（不再按父级拼接）
    existing = session.query(Post).filter(Post.name == name).first()
    if existing:
        return api_response(None, 400, '该英文名已被使用，请使用其他名称')
    
    # 计算层级
    level = calculate_level(parent_id, session)
    if level == -1:
        return api_response(None, 400, f'父文章已达最大层级限制（最多{MAX_LEVEL + 1}层）')
    
    # 创建文章
    post = Post(
        title=data['title'],
        name=name,
        slug='',  # 先留空，后面计算
        content=data.get('content', ''),
        summary=data.get('summary'),
        parent_id=parent_id,
        level=level,
        order=data.get('order', 0),
        author='admin',
        status=data.get('status', 'published'),
        is_top=data.get('is_top', False),
        tags=json.dumps(data.get('tags')) if data.get('tags') else None
    )
    
    session.add(post)
    session.flush()  # 获取ID
    
    # 计算完整slug（用于兼容旧版）
    post.slug = build_full_slug(post.id, session)
    
    session.commit()
    session.refresh(post)
    
    return api_response({
        'id': post.id,
        'title': post.title,
        'name': post.name,
        'slug': post.slug,
        'level': post.level,
        'created_at': post.created_at.isoformat()
    }, 201, '创建成功')


@bp.route('/id/<int:post_id>', methods=['PUT'])
@auth.login_required
def update_post_by_id(post_id):
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
    - order: 排序
    - tags: 标签数组
    - name: 英文名
    - parent_id: 父文章ID
    
    Returns:
        更新后的文章信息
    """
    session = db.session
    data = request.get_json()
    
    post = session.query(Post).filter(Post.id == post_id).first()
    
    if not post:
        return api_response(None, 404, '文章不存在')
    
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
    
    if 'order' in data:
        post.order = data['order']
    
    if 'tags' in data:
        post.tags = json.dumps(data['tags']) if data['tags'] else None
    
    # 处理name更新
    if 'name' in data and data['name'] != post.name:
        new_name = data['name']
        
        # 验证slug格式
        if not validate_slug(new_name):
            return api_response(None, 400, '英文名格式无效：必须以英文字母开头，只允许英文、数字和连字符，长度3-100字符')
        
        # 验证name全局唯一性
        existing = session.query(Post).filter(Post.name == new_name, Post.id != post_id).first()
        if existing:
            return api_response(None, 400, '该英文名已被使用，请使用其他名称')
        
        post.name = new_name
        # 更新slug
        post.slug = build_full_slug(post.id, session)
    
    # 处理父文章更新
    if 'parent_id' in data:
        new_parent_id = data['parent_id']
        
        if new_parent_id == post.id:
            return api_response(None, 400, '不能将自己设为父文章')
        
        if new_parent_id is not None:
            new_parent = session.query(Post).filter(Post.id == new_parent_id).first()
            if not new_parent:
                return api_response(None, 400, '父文章不存在')
            
            if new_parent.level >= MAX_LEVEL:
                return api_response(None, 400, f'父文章已达最大层级限制（最多{MAX_LEVEL + 1}层）')
            
            def is_descendant(post_id, potential_parent_id):
                current = session.query(Post).filter(Post.id == potential_parent_id).first()
                while current:
                    if current.id == post_id:
                        return True
                    if current.parent_id is None:
                        return False
                    current = session.query(Post).filter(Post.id == current.parent_id).first()
                return False
            
            if is_descendant(post.id, new_parent_id):
                return api_response(None, 400, '不能选择自己的子孙文章作为父文章')
            
            post.parent_id = new_parent_id
            post.level = new_parent.level + 1
        else:
            post.parent_id = None
            post.level = 0
        
        # 更新slug
        post.slug = build_full_slug(post.id, session)
        
        # 递归更新所有子孙文章的slug
        update_slug_for_post_and_children(post.id, session)
    
    session.commit()
    session.refresh(post)
    
    return api_response({
        'id': post.id,
        'title': post.title,
        'name': post.name,
        'slug': build_full_slug(post.id, session),
        'level': post.level,
        'parent_id': post.parent_id,
        'updated_at': post.updated_at.isoformat()
    }, 200, '更新成功')


@bp.route('/slug/<slug>', methods=['PUT'])
@auth.login_required
def update_post_by_slug(slug):
    """
    通过slug更新文章
    
    Args:
        slug: 文章slug（简单标识符）
    
    请求体：同 update_post_by_id
    
    Returns:
        更新后的文章信息
    """
    session = db.session
    
    post = session.query(Post).filter(Post.name == slug).first()
    
    if not post:
        return api_response(None, 404, '文章不存在')
    
    # 复用ID更新的逻辑
    return update_post_by_id(post.id)


@bp.route('/id/<int:post_id>', methods=['DELETE'])
@auth.login_required
def delete_post_by_id(post_id):
    """
    通过ID删除文章
    
    Args:
        post_id: 文章ID
    
    Returns:
        成功消息
    """
    session = db.session
    
    post = session.query(Post).filter(Post.id == post_id).first()
    
    if not post:
        return api_response(None, 404, '文章不存在')
    
    # 子文章变为根文章
    session.query(Post).filter(Post.parent_id == post.id).update({'parent_id': None, 'level': 0})
    
    session.delete(post)
    session.commit()
    
    delete_view_count(post_id)
    
    return api_response(None, 200, '删除成功')


@bp.route('/slug/<slug>', methods=['DELETE'])
@auth.login_required
def delete_post_by_slug(slug):
    """
    通过slug删除文章
    
    Args:
        slug: 文章slug（简单标识符）
    
    Returns:
        成功消息
    """
    session = db.session
    
    post = session.query(Post).filter(Post.name == slug).first()
    
    if not post:
        return api_response(None, 404, '文章不存在')
    
    return delete_post_by_id(post.id)
