"""
文章API

提供文章的CRUD操作和树形结构查询
"""

import json
from flask import Blueprint, request
from sqlalchemy import or_
from app.utils.response import api_response
from app.database import get_db
from app.models.models import Post
from app.config import settings
from app.api.auth import auth

bp = Blueprint('posts', __name__, url_prefix='/api/posts')


def build_slug(parent_slug, child_slug):
    """
    构建完整slug
    
    Args:
        parent_slug: 父文章slug（如 /java）
        child_slug: 子文章slug（如 java8）
    
    Returns:
        完整slug（如 /java/java8）
    """
    if parent_slug:
        return f"{parent_slug}/{child_slug}"
    else:
        return f"/{child_slug}"


def calculate_level(parent_id, db):
    """
    计算文章层级
    
    Args:
        parent_id: 父文章ID
        db: 数据库会话
    
    Returns:
        层级深度
    """
    if parent_id is None:
        return 0
    
    parent = db.query(Post).filter(Post.id == parent_id).first()
    if parent:
        return parent.level + 1
    return 0


@bp.route('', methods=['GET'])
@auth.login_required
def get_posts():
    """
    获取文章列表
    
    Query Parameters:
        page: 页码（默认1）
        page_size: 每页数量（默认20，最大100）
        parent_id: 父文章ID筛选
        status: 状态筛选
        keyword: 关键词搜索
    
    Returns:
        分页文章列表
    """
    db = next(get_db())
    
    # 获取查询参数
    page = request.args.get('page', 1, type=int)
    page_size = min(request.args.get('page_size', 20, type=int), settings.max_page_size)
    parent_id = request.args.get('parent_id', type=int)
    status = request.args.get('status')
    keyword = request.args.get('keyword')
    
    # 构建查询
    query = db.query(Post)
    
    if parent_id is not None:
        query = query.filter(Post.parent_id == parent_id)
    
    if status:
        query = query.filter(Post.status == status)
    
    if keyword:
        query = query.filter(
            or_(
                Post.title.contains(keyword),
                Post.summary.contains(keyword)
            )
        )
    
    # 排序
    query = query.order_by(Post.is_top.desc(), Post.order.asc(), Post.created_at.desc())
    
    # 分页
    total = query.count()
    total_pages = (total + page_size - 1) // page_size
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    
    # 统计子文章数量
    result_items = []
    for item in items:
        item_dict = item.to_dict()
        item_dict['children_count'] = db.query(Post).filter(Post.parent_id == item.id).count()
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
    获取文章树结构
    
    Returns:
        完整的树形结构数据
    """
    db = next(get_db())
    
    # 获取所有文章，按层级和排序
    posts = db.query(Post).order_by(Post.level.asc(), Post.order.asc()).all()
    
    # 构建树形结构
    post_map = {}
    tree = []
    
    for post in posts:
        post_dict = post.to_tree_dict()
        post_map[post.id] = post_dict
        
        if post.parent_id is None:
            tree.append(post_dict)
        else:
            parent = post_map.get(post.parent_id)
            if parent:
                parent['children'].append(post_dict)
    
    return api_response(tree)


@bp.route('/<path:slug>', methods=['GET'])
@auth.login_required
def get_post(slug):
    """
    获取文章详情
    
    Path Parameters:
        slug: 文章URL别名
    
    Returns:
        文章详情（包含父文章和子文章信息）
    """
    db = next(get_db())
    
    # 标准化slug
    if not slug.startswith('/'):
        slug = '/' + slug
    
    post = db.query(Post).filter(Post.slug == slug).first()
    
    if not post:
        return api_response(None, 404, '文章不存在')
    
    # 增加访问计数
    post.view_count += 1
    db.commit()
    
    # 转换为字典
    post_dict = post.to_dict()
    
    # 添加父文章信息
    if post.parent_id:
        parent = db.query(Post).filter(Post.id == post.parent_id).first()
        if parent:
            post_dict['parent'] = {
                'id': parent.id,
                'title': parent.title,
                'slug': parent.slug
            }
    
    # 添加子文章列表
    children = db.query(Post).filter(Post.parent_id == post.id).order_by(Post.order).all()
    post_dict['children'] = [
        {
            'id': child.id,
            'title': child.title,
            'slug': child.slug,
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
    
    Request Body:
        {
            "title": "文章标题",
            "slug": "url-alias",
            "content": "Markdown内容",
            "summary": "摘要",
            "parent_id": null,
            "order": 0,
            "status": "published",
            "is_top": false,
            "tags": ["标签1", "标签2"]
        }
    
    Returns:
        创建的文章信息
    """
    db = next(get_db())
    data = request.get_json()
    
    # 验证必填字段
    if not data.get('title'):
        return api_response(None, 400, '标题不能为空')
    
    if not data.get('slug'):
        return api_response(None, 400, 'slug不能为空')
    
    # 处理slug
    raw_slug = data['slug'].strip('/')
    
    # 获取父文章
    parent_id = data.get('parent_id')
    parent_slug = None
    
    if parent_id:
        parent = db.query(Post).filter(Post.id == parent_id).first()
        if not parent:
            return api_response(None, 400, '父文章不存在')
        parent_slug = parent.slug
    
    # 构建完整slug
    full_slug = build_slug(parent_slug, raw_slug)
    
    # 检查slug是否已存在
    existing = db.query(Post).filter(Post.slug == full_slug).first()
    if existing:
        return api_response(None, 409, 'slug已存在')
    
    # 计算层级
    level = calculate_level(parent_id, db)
    
    # 创建文章
    post = Post(
        title=data['title'],
        slug=full_slug,
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
    
    db.add(post)
    db.commit()
    db.refresh(post)
    
    return api_response({
        'id': post.id,
        'title': post.title,
        'slug': post.slug,
        'level': post.level,
        'created_at': post.created_at.isoformat()
    }, 201, '创建成功')


@bp.route('/<path:slug>', methods=['PUT'])
@auth.login_required
def update_post(slug):
    """
    更新文章
    
    Path Parameters:
        slug: 文章URL别名
    
    Request Body:
        {
            "title": "新标题",
            "content": "新内容",
            "summary": "新摘要",
            "status": "published",
            "is_top": true,
            "order": 1,
            "tags": ["标签"]
        }
    
    Returns:
        更新后的文章信息
    """
    db = next(get_db())
    data = request.get_json()
    
    # 标准化slug
    if not slug.startswith('/'):
        slug = '/' + slug
    
    post = db.query(Post).filter(Post.slug == slug).first()
    
    if not post:
        return api_response(None, 404, '文章不存在')
    
    # 更新字段
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
    
    db.commit()
    db.refresh(post)
    
    return api_response({
        'id': post.id,
        'title': post.title,
        'slug': post.slug,
        'updated_at': post.updated_at.isoformat()
    }, 200, '更新成功')


@bp.route('/<path:slug>', methods=['DELETE'])
@auth.login_required
def delete_post(slug):
    """
    删除文章
    
    Path Parameters:
        slug: 文章URL别名
    
    Returns:
        删除结果
    """
    db = next(get_db())
    
    # 标准化slug
    if not slug.startswith('/'):
        slug = '/' + slug
    
    post = db.query(Post).filter(Post.slug == slug).first()
    
    if not post:
        return api_response(None, 404, '文章不存在')
    
    # 将子文章的parent_id设为NULL
    db.query(Post).filter(Post.parent_id == post.id).update({'parent_id': None})
    
    # 删除文章
    db.delete(post)
    db.commit()
    
    return api_response(None, 200, '删除成功')