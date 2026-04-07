# DouBlog 后端开发 Prompt

> **目标**: 使用此文档指导AI大模型完成DouBlog后端开发  
> **技术栈**: Flask 3.0 + SQLAlchemy 2.0 + SQLite + Python 3.13  
> **端口**: 60000  
> **API基础路径**: http://localhost:60000/api

---

## 📋 环境准备

### 步骤1: 创建Conda环境

```bash
# 创建Python 3.13的conda环境
conda create -n blog python=3.13 -y

# 激活环境
conda activate blog
```

### 步骤2: 创建项目目录

```bash
# 在 /home/lizy/projects/DouBlog 目录下创建 backend 文件夹
cd /home/lizy/projects/DouBlog
mkdir -p backend
cd backend
```

### 步骤3: 创建目录结构

```bash
mkdir -p app/models
mkdir -p app/api
mkdir -p app/utils
mkdir -p tests
mkdir -p data/images
```

---

## 🗂️ 目录结构

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # Flask应用入口
│   ├── config.py            # 配置管理
│   ├── database.py          # 数据库连接
│   ├── models/
│   │   ├── __init__.py
│   │   └── models.py        # 数据模型
│   ├── api/
│   │   ├── __init__.py
│   │   ├── auth.py          # 认证API
│   │   ├── posts.py         # 文章API
│   │   └── images.py        # 图片API
│   └── utils/
│       ├── __init__.py
│       └── response.py      # 响应工具
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── test_auth.py
│   └── test_posts.py
├── data/                    # 运行时创建
│   ├── blog.db
│   └── images/
├── requirements.txt
├── run.py
└── README.md
```

---

## 📝 代码实现清单

按照以下顺序创建文件：

### 第1批: 基础配置

1. **requirements.txt** - Python依赖
2. **app/__init__.py** - 包初始化
3. **app/config.py** - 配置管理
4. **app/database.py** - 数据库连接
5. **app/utils/__init__.py** - 工具包初始化
6. **app/utils/response.py** - 响应工具

### 第2批: 数据模型

7. **app/models/__init__.py** - 模型包初始化
8. **app/models/models.py** - 数据模型定义

### 第3批: API实现

9. **app/api/__init__.py** - API包初始化
10. **app/api/auth.py** - 认证API
11. **app/api/posts.py** - 文章API
12. **app/api/images.py** - 图片API

### 第4批: 应用入口

13. **app/main.py** - Flask应用
14. **run.py** - 启动脚本

### 第5批: 测试文件

15. **tests/__init__.py**
16. **tests/conftest.py**
17. **tests/test_auth.py**
18. **tests/test_posts.py**

---

## 📄 详细代码实现

### 文件1: requirements.txt

```
Flask==3.0.0
Flask-CORS==4.0.0
Flask-HTTPAuth==4.8.0
SQLAlchemy==2.0.25
python-dotenv==1.0.0
Pillow==10.2.0
pytest==8.0.0
```

### 文件2: app/__init__.py

```python
"""
DouBlog Backend Application
"""
```

### 文件3: app/config.py

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
    base_dir: str = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    data_dir: str = os.path.join(base_dir, 'data')
    images_dir: str = os.path.join(data_dir, 'images')
    
    # 分页配置
    max_page_size: int = 100
    default_page_size: int = 20


settings = Settings()
```

### 文件4: app/database.py

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
    os.makedirs(settings.images_dir, exist_ok=True)
    
    # 导入所有模型
    from app.models.models import Post, Image
    
    # 创建所有表
    Base.metadata.create_all(bind=engine)
    
    print(f"数据库初始化完成: {DB_PATH}")


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

### 文件5: app/utils/__init__.py

```python
"""
Utils Package
"""
```

### 文件6: app/utils/response.py

```python
"""
API响应格式化工具
"""

from flask import jsonify
from typing import Any


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

### 文件7: app/models/__init__.py

```python
"""
Models Package
"""
from app.models.models import Post, Image, Base

__all__ = ['Post', 'Image', 'Base']
```

### 文件8: app/models/models.py

```python
"""
数据库模型定义

定义两个核心模型：
- Post: 文章模型（支持树形结构）
- Image: 图片模型
"""

from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func


class Base:
    """Base类将由SQLAlchemy的declarative_base替换"""
    pass


from app.database import Base


class Post(Base):
    """
    文章模型
    
    支持无限层级的树形结构，通过parent_id建立父子关系。
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

### 文件9: app/api/__init__.py

```python
"""
API Package
"""
from app.api.auth import bp as auth_bp
from app.api.posts import bp as posts_bp
from app.api.images import bp as images_bp

__all__ = ['auth_bp', 'posts_bp', 'images_bp']
```

### 文件10: app/api/auth.py

```python
"""
认证API

提供登录验证和认证检查功能
"""

from flask import Blueprint
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

### 文件11: app/api/posts.py

```python
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

### 文件12: app/api/images.py

```python
"""
图片API

提供图片上传、获取和删除功能
"""

import os
import uuid
from datetime import datetime
from flask import Blueprint, request, send_file
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
        上传结果
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

### 文件13: app/main.py

```python
"""
Flask 应用入口

初始化 Flask 应用，配置 CORS 和注册蓝图。
"""

import logging
from flask import Flask, jsonify, request
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS
from flask_httpauth import HTTPBasicAuth
from werkzeug.exceptions import HTTPException
from app.config import settings
from app.database import init_db, close_db
from app.api import auth_bp, posts_bp, images_bp
from app.api.auth import auth
from app.utils.response import api_response


class CustomJSONProvider(DefaultJSONProvider):
    def __init__(self, app):
        super().__init__(app)
        self.ensure_ascii = False


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@auth.error_handler
def auth_error(status=401):
    return api_response(None, status, "认证失败")


def create_app():
    """
    创建 Flask 应用实例
    
    Returns:
        Flask 应用实例
    """
    app = Flask(__name__)
    app.config['SECRET_KEY'] = settings.secret_key
    app.json = CustomJSONProvider(app)

    CORS(app, resources={
        r"/api/*": {
            "origins": settings.cors_origins,
            "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            "allow_headers": ["Content-Type", "Authorization"]
        }
    })

    init_db()

    app.teardown_appcontext(close_db)

    @app.errorhandler(Exception)
    def handle_exception(e):
        logger.error(f"Unhandled exception: {str(e)}", exc_info=True)
        if isinstance(e, HTTPException):
            return api_response(None, e.code, e.description)
        return api_response(None, 500, "服务器内部错误")

    @app.errorhandler(400)
    def handle_bad_request(e):
        return api_response(None, 400, str(e.description))

    @app.errorhandler(404)
    def handle_not_found(e):
        return api_response(None, 404, "资源不存在")

    @app.errorhandler(429)
    def handle_rate_limit(e):
        return api_response(None, 429, "请求过于频繁，请稍后再试")

    @app.before_request
    def log_request():
        logger.info(f"{request.method} {request.path}")

    # 注册蓝图（排除不需要认证的路由）
    app.register_blueprint(auth_bp)
    app.register_blueprint(posts_bp)
    app.register_blueprint(images_bp)

    @app.route("/")
    def root():
        """根路径，返回欢迎信息"""
        return jsonify({
            "message": f"Welcome to {settings.app_name}",
            "version": settings.app_version
        })

    @app.route("/health")
    def health_check():
        """健康检查接口"""
        return jsonify({"status": "healthy"})

    logger.info(f"{settings.app_name} v{settings.app_version} initialized")
    return app


app = create_app()


if __name__ == "__main__":
    app.run(
        host=settings.host,
        port=settings.port,
        debug=settings.debug
    )
```

### 文件14: run.py

```python
"""
启动脚本
"""

from app.main import app
from app.config import settings

if __name__ == '__main__':
    print(f"启动 {settings.app_name} v{settings.app_version}")
    print(f"访问地址: http://localhost:{settings.port}")
    app.run(
        host=settings.host,
        port=settings.port,
        debug=settings.debug
    )
```

---

## ✅ 安装和启动

### 安装依赖

```bash
# 确保在conda blog环境中
conda activate blog

# 安装依赖
pip install -r requirements.txt
```

### 初始化数据库

```bash
# 进入backend目录
cd /home/lizy/projects/DouBlog/backend

# 初始化数据库
python -c "from app.database import init_db; init_db()"
```

### 启动服务

```bash
# 启动Flask服务
python run.py
```

访问：http://localhost:60000

---

## 📝 API测试

### 测试登录

```bash
curl -X POST http://localhost:60000/api/auth/login \
  -H "Authorization: Basic YWRtaW46bGl6eTExMUE="
```

### 测试创建文章

```bash
curl -X POST http://localhost:60000/api/posts \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic YWRtaW46bGl6eTExMUE=" \
  -d '{
    "title": "测试文章",
    "slug": "test",
    "content": "# 测试\n\n这是测试内容"
  }'
```

### 测试获取文章树

```bash
curl http://localhost:60000/api/posts/tree
```

---

## 🧪 运行测试

```bash
# 安装测试依赖
pip install pytest

# 运行测试
pytest tests/ -v
```

---

## 📝 注意事项

1. **确保conda环境激活**：每次开发前运行`conda activate blog`
2. **数据库文件位置**：`/home/lizy/projects/DouBlog/backend/data/blog.db`
3. **图片存储位置**：`/home/lizy/projects/DouBlog/backend/data/images/`
4. **默认账号**：用户名`admin`，密码`lizy111A`
5. **端口配置**：60000（可在config.py修改）

---

## ✅ 完成检查清单

完成后检查以下项目：

- [ ] conda环境创建成功
- [ ] 依赖安装成功
- [ ] 数据库初始化成功
- [ ] Flask服务启动成功
- [ ] 访问 http://localhost:60000 显示欢迎信息
- [ ] API测试通过
- [ ] 测试用例通过

---

**Prompt文档结束**