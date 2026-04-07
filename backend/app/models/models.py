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