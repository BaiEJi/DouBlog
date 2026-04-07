# DouBlog 后端详细设计文档

> **版本**: v1.0  
> **更新时间**: 2026-04-06  
> **技术栈**: Flask 3.0 + SQLAlchemy 2.0 + SQLite + Python 3.13

---

## 目录

- [1. 项目概述](#1-项目概述)
- [2. 技术栈详情](#2-技术栈详情)
- [3. 目录结构](#3-目录结构)
- [4. 数据库设计](#4-数据库设计)
- [5. API实现](#5-api实现)
- [6. 认证实现](#6-认证实现)
- [7. 文件存储](#7-文件存储)
- [8. 错误处理](#8-错误处理)
- [9. 配置管理](#9-配置管理)
- [10. 测试方案](#10-测试方案)
- [11. 部署方案](#11-部署方案)

---

## 1. 项目概述

### 1.1 项目定位

DouBlog后端是一个基于Flask的RESTful API服务，提供文章管理、图片上传、用户认证等功能。

### 1.2 技术特点

- **轻量级**：Flask + SQLite，无需复杂配置
- **RESTful API**：标准化接口设计
- **Basic Auth认证**：简单安全的密码认证
- **本地存储**：图片直接存储在服务器磁盘

### 1.3 运行环境

- **Python版本**：3.13
- **Conda环境**：blog
- **监听端口**：60000
- **API基础路径**：http://localhost:60000/api

---

## 2. 技术栈详情

### 2.1 核心框架

| 库 | 版本 | 用途 |
|---|---|---|
| Flask | 3.0+ | Web框架 |
| SQLAlchemy | 2.0+ | ORM框架 |
| Flask-CORS | 4.0+ | CORS支持 |
| Flask-HTTPAuth | 4.8+ | HTTP认证 |

### 2.2 数据库

| 组件 | 版本 | 用途 |
|---|---|---|
| SQLite | 3.x | 嵌入式数据库 |

### 2.3 工具库

| 库 | 版本 | 用途 |
|---|---|---|
| python-dotenv | 1.0+ | 环境变量管理 |
| Pillow | 10.0+ | 图片处理 |
| pytest | 7.0+ | 单元测试 |

---

## 3. 目录结构

```
backend/
├── app/
│   ├── __init__.py              # Flask应用工厂
│   ├── main.py                  # 应用入口
│   ├── config.py                # 配置管理
│   ├── database.py              # 数据库连接
│   │
│   ├── models/                  # 数据模型
│   │   ├── __init__.py
│   │   └── models.py            # SQLAlchemy模型定义
│   │
│   ├── api/                     # API路由
│   │   ├── __init__.py
│   │   ├── auth.py              # 认证API
│   │   ├── posts.py             # 文章API
│   │   └── images.py            # 图片API
│   │
│   └── utils/                   # 工具函数
│       ├── __init__.py
│       ├── response.py          # 响应格式化
│       └── validators.py        # 参数验证
│
├── tests/                       # 测试文件
│   ├── __init__.py
│   ├── conftest.py              # pytest配置
│   ├── test_auth.py             # 认证测试
│   ├── test_posts.py            # 文章API测试
│   └── test_images.py           # 图片API测试
│
├── data/                        # 数据目录（运行时创建）
│   ├── blog.db                  # SQLite数据库文件
│   └── images/                  # 图片存储目录
│
├── requirements.txt             # Python依赖
├── run.py                       # 启动脚本
├── .env.example                 # 环境变量示例
└── README.md                    # 项目说明
```

---

## 4. 数据库设计

### 4.1 数据模型定义

**文件**: `app/models/models.py`

```python
"""
数据库模型定义

定义两个核心模型：
- Post: 文章模型（支持树形结构）
- Image: 图片模型
"""

from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship, declarative_base
from sqlalchemy.sql import func
from datetime import datetime

Base = declarative_base()


class Post(Base):
    """
    文章模型
    
    支持无限层级的树形结构，通过parent_id建立父子关系。
    
    Attributes:
        id: 主键
        title: 文章标题
        slug: URL别名（唯一），格式如：/java/java8
        content: Markdown内容
        summary: 摘要
        
        parent_id: 父文章ID（NULL表示根文章）
        level: 层级深度（0=根文章，1=子文章...）
        order: 同级排序
        
        author: 作者
        status: 状态（published/archived）
        is_top: 是否置顶
        
        view_count: 访问次数
        tags: 标签（JSON字符串）
        meta_data: 扩展元数据（JSON字符串）
        
        created_at: 创建时间
        updated_at: 更新时间
    """
    __tablename__ = 'posts'
    
    # 基础字段
    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200), nullable=False, comment='文章标题')
    slug = Column(String(200), unique=True, nullable=False, index=True, comment='URL别名')
    content = Column(Text, nullable=False, comment='Markdown内容')
    summary = Column(Text, nullable=True, comment='摘要')
    
    # 树形结构字段
    parent_id = Column(Integer, ForeignKey('posts.id', ondelete='SET NULL'), nullable=True, index=True, comment='父文章ID')
    level = Column(Integer, default=0, comment='层级深度')
    order = Column(Integer, default=0, comment='同级排序')
    
    # 元数据字段
    author = Column(String(50), default='admin', comment='作者')
    status = Column(String(20), default='published', index=True, comment='状态')
    is_top = Column(Boolean, default=False, comment='是否置顶')
    
    # 统计字段
    view_count = Column(Integer, default=0, comment='访问次数')
    
    # 扩展字段
    tags = Column(Text, nullable=True, comment='标签JSON')
    meta_data = Column(Text, nullable=True, comment='扩展元数据JSON')
    
    # 时间字段
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment='更新时间')
    
    # 关系
    parent = relationship('Post', remote_side=[id], backref='children')
    
    def to_dict(self):
        """转换为字典"""
        return {
            'id': self.id,
            'title': self.title,
            'slug': self.slug,
            'content': self.content,
            'summary': self.summary,
            'parent_id': self.parent_id,
            'level': self.level,
            'order': self.order,
            'author': self.author,
            'status': self.status,
            'is_top': self.is_top,
            'view_count': self.view_count,
            'tags': self.tags,
            'meta_data': self.meta_data,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
    
    def to_tree_dict(self):
        """转换为树节点字典（用于树形结构）"""
        return {
            'id': self.id,
            'title': self.title,
            'slug': self.slug,
            'level': self.level,
            'order': self.order,
            'children': []
        }


class Image(Base):
    """
    图片模型
    
    记录上传的图片信息。
    
    Attributes:
        id: 主键
        post_id: 关联文章ID
        filename: 文件名
        filepath: 存储路径
        filesize: 文件大小（字节）
        created_at: 创建时间
    """
    __tablename__ = 'images'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    post_id = Column(Integer, ForeignKey('posts.id', ondelete='SET NULL'), nullable=True, comment='关联文章ID')
    filename = Column(String(255), nullable=False, comment='文件名')
    filepath = Column(String(500), nullable=False, comment='存储路径')
    filesize = Column(Integer, nullable=True, comment='文件大小')
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    
    def to_dict(self):
        """转换为字典"""
        return {
            'id': self.id,
            'post_id': self.post_id,
            'filename': self.filename,
            'filepath': self.filepath,
            'filesize': self.filesize,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
```

### 4.2 数据库初始化

**文件**: `app/database.py`

```python
"""
数据库连接和会话管理
"""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import settings

# 数据库文件路径
DB_PATH = os.path.join(settings.data_dir, 'blog.db')
DATABASE_URL = f'sqlite:///{DB_PATH}'

# 创建引擎
engine = create_engine(
    DATABASE_URL,
    connect_args={'check_same_thread': False},  # SQLite需要此参数
    echo=settings.debug  # 调试模式下打印SQL
)

# 创建会话工厂
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base类
Base = declarative_base()


def init_db():
    """
    初始化数据库
    
    创建数据目录和所有表
    """
    # 确保数据目录存在
    os.makedirs(settings.data_dir, exist_ok=True)
    os.makedirs(os.path.join(settings.data_dir, 'images'), exist_ok=True)
    
    # 导入所有模型
    from app.models.models import Post, Image
    
    # 创建所有表
    Base.metadata.create_all(bind=engine)


def get_db():
    """
    获取数据库会话
    
    用于依赖注入
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def close_db(exception=None):
    """
    关闭数据库连接
    
    用于Flask teardown
    """
    pass
```

---

## 5. API实现

### 5.1 响应格式化工具

**文件**: `app/utils/response.py`

```python
"""
API响应格式化工具
"""

from flask import jsonify
from typing import Any, Optional


def api_response(data: Any = None, code: int = 200, message: str = '操作成功'):
    """
    统一API响应格式
    
    Args:
        data: 响应数据
        code: 状态码
        message: 消息
    
    Returns:
        Flask Response对象
    """
    return jsonify({
        'success': 200 <= code < 300,
        'code': code,
        'message': message,
        'data': data
    }), code
```

### 5.2 认证API

**文件**: `app/api/auth.py`

```python
"""
认证API

提供登录验证和认证检查功能
"""

from flask import Blueprint, request
from flask_httpauth import HTTPBasicAuth
from app.utils.response import api_response
from app.config import settings

bp = Blueprint('auth', __name__, url_prefix='/api/auth')
auth = HTTPBasicAuth()


@auth.verify_password
def verify_password(username, password):
    """
    验证用户名和密码
    
    Args:
        username: 用户名
        password: 密码
    
    Returns:
        验证通过返回True，否则返回False
    """
    if not settings.auth_enabled:
        return True
    
    return username == settings.auth_username and password == settings.auth_password


@auth.error_handler
def auth_error():
    """
    认证失败处理
    
    Returns:
        401错误响应
    """
    return api_response(None, 401, '认证失败')


@bp.route('/login', methods=['POST'])
@auth.login_required
def login():
    """
    登录API
    
    验证用户名密码，成功返回用户信息。
    
    Request Headers:
        Authorization: Basic {base64(username:password)}
    
    Returns:
        {
            "success": true,
            "code": 200,
            "message": "登录成功",
            "data": {"username": "admin"}
        }
    """
    return api_response({'username': settings.auth_username}, 200, '登录成功')


@bp.route('/check', methods=['GET'])
@auth.login_required
def check_auth():
    """
    检查认证状态API
    
    验证当前请求是否已认证。
    
    Request Headers:
        Authorization: Basic {base64(username:password)}
    
    Returns:
        {
            "success": true,
            "code": 200,
            "message": "已认证",
            "data": {
                "authenticated": true,
                "username": "admin"
            }
        }
    """
    return api_response({
        'authenticated': True,
        'username': settings.auth_username
    }, 200, '已认证')
```

### 5.3 文章API

**文件**: `app/api/posts.py`

```python
"""
文章API

提供文章的CRUD操作和树形结构查询
"""

import json
from flask import Blueprint, request
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.utils.response import api_response
from app.database import get_db
from app.models.models import Post

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


def calculate_level(parent_id, db: Session):
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
    page_size = min(request.args.get('page_size', 20, type=int), 100)
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
```

### 5.4 图片API

**文件**: `app/api/images.py`

```python
"""
图片API

提供图片上传、获取和删除功能
"""

import os
import uuid
from datetime import datetime
from flask import Blueprint, request, send_file, current_app
from werkzeug.utils import secure_filename
from app.utils.response import api_response
from app.config import settings
from app.database import get_db
from app.models.models import Image

bp = Blueprint('images', __name__, url_prefix='/api/images')

# 允许的图片格式
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}

# 最大文件大小（10MB）
MAX_FILE_SIZE = 10 * 1024 * 1024


def allowed_file(filename):
    """
    检查文件格式是否允许
    
    Args:
        filename: 文件名
    
    Returns:
        是否允许
    """
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@bp.route('/upload', methods=['POST'])
def upload_image():
    """
    上传图片
    
    Request:
        Content-Type: multipart/form-data
        file: 图片文件
        post_slug: 文章slug（可选）
    
    Returns:
        {
            "success": true,
            "code": 200,
            "message": "上传成功",
            "data": {
                "filename": "xxx.png",
                "filepath": "/images/xxx/xxx.png",
                "url": "http://localhost:60000/api/images/xxx/xxx.png",
                "filesize": 1024
            }
        }
    """
    # 检查是否有文件
    if 'file' not in request.files:
        return api_response(None, 400, '没有上传文件')
    
    file = request.files['file']
    
    # 检查文件名
    if file.filename == '':
        return api_response(None, 400, '没有选择文件')
    
    # 检查文件格式
    if not allowed_file(file.filename):
        return api_response(None, 400, '不支持的文件格式')
    
    # 检查文件大小
    file.seek(0, os.SEEK_END)
    filesize = file.tell()
    file.seek(0)
    
    if filesize > MAX_FILE_SIZE:
        return api_response(None, 400, '文件大小超出限制（最大10MB）')
    
    # 生成文件名
    ext = file.filename.rsplit('.', 1)[1].lower()
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
    unique_id = uuid.uuid4().hex[:8]
    filename = f"{timestamp}_{unique_id}.{ext}"
    
    # 确定存储目录
    post_slug = request.form.get('post_slug', '').strip('/')
    if post_slug:
        save_dir = os.path.join(settings.images_dir, post_slug)
    else:
        save_dir = settings.images_dir
    
    # 创建目录
    os.makedirs(save_dir, exist_ok=True)
    
    # 保存文件
    filepath = os.path.join(save_dir, filename)
    file.save(filepath)
    
    # 相对路径
    relative_path = os.path.join(post_slug, filename) if post_slug else filename
    
    # 保存到数据库（可选）
    db = next(get_db())
    image = Image(
        filename=filename,
        filepath=relative_path,
        filesize=filesize
    )
    db.add(image)
    db.commit()
    
    return api_response({
        'filename': filename,
        'filepath': f'/images/{relative_path}',
        'url': f'http://localhost:{settings.port}/api/images/{relative_path}',
        'filesize': filesize
    }, 200, '上传成功')


@bp.route('/<path:filepath>', methods=['GET'])
def get_image(filepath):
    """
    获取图片
    
    Path Parameters:
        filepath: 图片路径
    
    Returns:
        图片文件流
    """
    full_path = os.path.join(settings.images_dir, filepath)
    
    if not os.path.exists(full_path):
        return api_response(None, 404, '图片不存在')
    
    return send_file(full_path)


@bp.route('/<path:filepath>', methods=['DELETE'])
def delete_image(filepath):
    """
    删除图片
    
    Path Parameters:
        filepath: 图片路径
    
    Returns:
        删除结果
    """
    full_path = os.path.join(settings.images_dir, filepath)
    
    if not os.path.exists(full_path):
        return api_response(None, 404, '图片不存在')
    
    # 删除文件
    os.remove(full_path)
    
    # 从数据库删除记录
    db = next(get_db())
    db.query(Image).filter(Image.filepath == filepath).delete()
    db.commit()
    
    return api_response(None, 200, '删除成功')
```

---

## 6. 认证实现

### 6.1 Basic Auth原理

使用HTTP Basic Authentication：
1. 前端将`username:password`进行Base64编码
2. 每次请求在Header中携带：`Authorization: Basic {base64_string}`
3. 后端解码并验证用户名密码

### 6.2 认证流程

```
前端                           后端
  |                              |
  |--- POST /api/auth/login ---->| (携带Authorization Header)
  |                              | 1. 解码Base64
  |                              | 2. 验证用户名密码
  |                              | 3. 返回成功/失败
  |<-- 200 OK -------------------|
  |                              |
```

### 6.3 全局认证装饰器

在Flask应用中，使用`@auth.login_required`装饰需要认证的路由：

```python
from flask_httpauth import HTTPBasicAuth
auth = HTTPBasicAuth()

@app.route('/api/posts')
@auth.login_required
def get_posts():
    # 只有认证通过才能访问
    pass
```

### 6.4 参考CrownFlow实现

认证实现完全参考CrownFlow项目：
- 使用`flask-httpauth`
- 配置用户名密码在`config.py`
- 支持`auth_enabled`开关（测试时关闭）

---

## 7. 文件存储

### 7.1 目录结构

```
data/
├── blog.db                  # SQLite数据库
└── images/                  # 图片存储
    ├── java/                # 按文章slug分目录
    │   ├── screenshot_20260406100000.png
    │   └── diagram_20260406100100.jpg
    ├── python/
    │   └── example_20260406100200.png
    └── general/             # 未分类图片
        └── image_20260406100300.jpg
```

### 7.2 文件命名规则

```
{timestamp}_{uuid}.{ext}

示例：
20260406100000_abc12345.png
20260406100100_def67890.jpg
```

### 7.3 路径映射

- **存储路径**: `data/images/{post_slug}/{filename}`
- **URL路径**: `http://localhost:60000/api/images/{post_slug}/{filename}`
- **数据库路径**: `{post_slug}/{filename}`

---

## 8. 错误处理

### 8.1 全局错误处理

**文件**: `app/main.py`

```python
from werkzeug.exceptions import HTTPException

@app.errorhandler(Exception)
def handle_exception(e):
    """处理所有未捕获的异常"""
    logger.error(f"Unhandled exception: {str(e)}", exc_info=True)
    
    if isinstance(e, HTTPException):
        return api_response(None, e.code, e.description)
    
    return api_response(None, 500, '服务器内部错误')


@app.errorhandler(400)
def handle_bad_request(e):
    return api_response(None, 400, str(e.description))


@app.errorhandler(404)
def handle_not_found(e):
    return api_response(None, 404, '资源不存在')


@app.errorhandler(429)
def handle_rate_limit(e):
    return api_response(None, 429, '请求过于频繁，请稍后再试')
```

### 8.2 错误码规范

| 错误码 | 含义 | 示例消息 |
|---|---|---|
| 400 | 请求参数错误 | 标题不能为空 |
| 401 | 认证失败 | 用户名或密码错误 |
| 404 | 资源不存在 | 文章不存在 |
| 409 | 资源冲突 | slug已存在 |
| 413 | 请求体过大 | 文件大小超出限制 |
| 500 | 服务器错误 | 服务器内部错误 |

---

## 9. 配置管理

### 9.1 配置文件

**文件**: `app/config.py`

```python
"""
配置管理

所有配置项集中管理
"""

import os


class Settings:
    """应用配置"""
    
    # 应用信息
    app_name: str = 'DouBlog'
    app_version: str = '1.0.0'
    
    # 服务器配置
    host: str = '0.0.0.0'
    port: int = 60000
    debug: bool = True
    
    # 安全配置
    secret_key: str = 'dev-secret-key-change-in-production'
    
    # CORS配置
    cors_origins: str = '*'
    
    # 认证配置
    auth_enabled: bool = True
    auth_username: str = 'admin'
    auth_password: str = 'lizy111A'
    
    # 数据目录
    data_dir: str = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
    images_dir: str = os.path.join(data_dir, 'images')
    
    # 分页配置
    max_page_size: int = 100
    default_page_size: int = 20


settings = Settings()
```

### 9.2 环境变量

支持通过`.env`文件配置：

```bash
# .env
FLASK_DEBUG=true
AUTH_USERNAME=admin
AUTH_PASSWORD=lizy111A
SECRET_KEY=your-secret-key
```

---

## 10. 测试方案

### 10.1 测试配置

**文件**: `tests/conftest.py`

```python
"""
pytest配置
"""

import pytest
from app.main import create_app
from app.database import Base, engine, get_db


@pytest.fixture
def app():
    """创建测试应用"""
    app = create_app()
    app.config['TESTING'] = True
    
    # 创建测试数据库
    Base.metadata.create_all(bind=engine)
    
    yield app
    
    # 清理测试数据库
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(app):
    """创建测试客户端"""
    return app.test_client()


@pytest.fixture
def db_session():
    """创建数据库会话"""
    from app.database import SessionLocal
    session = SessionLocal()
    yield session
    session.close()
```

### 10.2 认证测试

**文件**: `tests/test_auth.py`

```python
"""
认证API测试
"""

import base64


def test_login_success(client):
    """测试登录成功"""
    auth_str = base64.b64encode(b'admin:lizy111A').decode()
    response = client.post(
        '/api/auth/login',
        headers={'Authorization': f'Basic {auth_str}'}
    )
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True


def test_login_failure(client):
    """测试登录失败"""
    auth_str = base64.b64encode(b'admin:wrong_password').decode()
    response = client.post(
        '/api/auth/login',
        headers={'Authorization': f'Basic {auth_str}'}
    )
    assert response.status_code == 401
```

### 10.3 文章API测试

**文件**: `tests/test_posts.py`

```python
"""
文章API测试
"""

import base64


def auth_header():
    """生成认证Header"""
    auth_str = base64.b64encode(b'admin:lizy111A').decode()
    return {'Authorization': f'Basic {auth_str}'}


def test_create_post(client):
    """测试创建文章"""
    response = client.post(
        '/api/posts',
        json={
            'title': '测试文章',
            'slug': 'test',
            'content': '# 测试内容'
        },
        headers=auth_header()
    )
    assert response.status_code == 201
    data = response.get_json()
    assert data['success'] is True


def test_get_post(client, db_session):
    """测试获取文章"""
    # 先创建文章
    from app.models.models import Post
    post = Post(title='测试', slug='/test', content='内容')
    db_session.add(post)
    db_session.commit()
    
    # 获取文章
    response = client.get('/api/posts/test')
    assert response.status_code == 200
```

---

## 11. 部署方案

### 11.1 开发环境启动

```bash
# 激活conda环境
conda activate blog

# 安装依赖
pip install -r requirements.txt

# 初始化数据库
python -c "from app.database import init_db; init_db()"

# 启动服务
python run.py
```

### 11.2 requirements.txt

```
Flask==3.0.0
Flask-CORS==4.0.0
Flask-HTTPAuth==4.8.0
SQLAlchemy==2.0.0
python-dotenv==1.0.0
Pillow==10.0.0
pytest==7.0.0
```

### 11.3 run.py

```python
"""
启动脚本
"""

from app.main import create_app

app = create_app()

if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=60000,
        debug=True
    )
```

---

## 12. API路由总览

| 方法 | 路径 | 功能 | 认证 |
|---|---|---|---|
| POST | /api/auth/login | 登录验证 | 是 |
| GET | /api/auth/check | 检查认证 | 是 |
| GET | /api/posts | 文章列表 | 否 |
| GET | /api/posts/tree | 文章树 | 否 |
| GET | /api/posts/:slug | 文章详情 | 否 |
| POST | /api/posts | 创建文章 | 是 |
| PUT | /api/posts/:slug | 更新文章 | 是 |
| DELETE | /api/posts/:slug | 删除文章 | 是 |
| POST | /api/images/upload | 上传图片 | 是 |
| GET | /api/images/:filepath | 获取图片 | 否 |
| DELETE | /api/images/:filepath | 删除图片 | 是 |

---

## 13. 开发注意事项

### 13.1 路径处理

- 所有slug必须以`/`开头
- 使用`<path:slug>`捕获多级路径
- 使用`os.path.join`处理文件路径

### 13.2 数据库事务

- 每个请求使用独立的数据库会话
- 修改操作后必须`db.commit()`
- 使用`try-finally`确保会话关闭

### 13.3 错误日志

- 使用Python logging模块
- 记录所有未捕获的异常
- 调试模式下打印SQL语句

### 13.4 性能优化

- 添加必要的数据库索引
- 使用SQLAlchemy的`joinedload`优化关联查询
- 图片返回使用`send_file`支持浏览器缓存

---

**文档结束**