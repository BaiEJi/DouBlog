"""
数据库模型定义

使用 Flask-SQLAlchemy 的 db.Model 基类，避免循环引用。
- Post: 文章模型（支持树形结构）
"""

import json
from app.db import db


class Post(db.Model):
    """文章模型，支持无限层级的树形结构"""
    __tablename__ = 'posts'
    
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    title = db.Column(db.String(200), nullable=False, comment='文章标题')
    name = db.Column(db.String(100), nullable=False, index=True, comment='英文名(URL路径段)')
    slug = db.Column(db.String(500), nullable=True, index=True, comment='完整URL路径(动态计算，可为空)')
    content = db.Column(db.Text, nullable=False, comment='Markdown内容')
    summary = db.Column(db.Text, nullable=True, comment='摘要')
    
    parent_id = db.Column(db.Integer, db.ForeignKey('posts.id', ondelete='SET NULL'), 
                          nullable=True, index=True, comment='父文章ID')
    level = db.Column(db.Integer, default=0, comment='层级深度')
    children_order = db.Column(db.Text, nullable=True, comment='子节点排序JSON数组，如[3,1,5]')
    
    author = db.Column(db.String(50), default='admin', comment='作者')
    status = db.Column(db.String(20), default='published', index=True, comment='状态')
    is_top = db.Column(db.Boolean, default=False, comment='是否置顶')
    
    view_count = db.Column(db.Integer, default=0, comment='访问次数')
    
    tags = db.Column(db.Text, nullable=True, comment='标签JSON')
    meta_data = db.Column(db.Text, nullable=True, comment='扩展元数据JSON')
    
    created_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), comment='创建时间')
    updated_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), 
                           onupdate=db.func.now(), comment='更新时间')
    
    parent = db.relationship('Post', remote_side=[id], backref='children')
    
    def to_dict(self):
        """
        将文章模型转换为字典格式
        
        Returns:
            dict: 包含文章所有属性的字典
        """
        return {
            'id': self.id,
            'title': self.title,
            'name': self.name,
            'slug': self.slug,
            'content': self.content,
            'summary': self.summary or '',
            'parent_id': self.parent_id,
            'level': self.level,
            'author': self.author,
            'status': self.status,
            'is_top': self.is_top,
            'view_count': self.view_count,
            'tags': self._parse_tags(),
            'meta_data': self.meta_data,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
    
    def to_tree_dict(self):
        """
        将文章模型转换为树形结构字典格式
        
        Returns:
            dict: 包含文章属性和空children列表的字典
        """
        return {
            'id': self.id,
            'title': self.title,
            'name': self.name,
            'slug': self.slug,
            'level': self.level,
            'children_order': self._parse_children_order(),
            'is_top': self.is_top,
            'view_count': self.view_count,
            'tags': self._parse_tags(),
            'author': self.author,
            'status': self.status,
            'summary': self.summary or '',
            'content': self.content,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'children': []
        }
    
    def _parse_tags(self):
        """
        解析JSON格式的标签字符串

        Returns:
            list: 标签列表，解析失败返回空列表
        """
        if not self.tags:
            return []
        try:
            return json.loads(self.tags)
        except (json.JSONDecodeError, TypeError):
            return []

    def _parse_children_order(self):
        if not self.children_order:
            return []
        try:
            return json.loads(self.children_order)
        except (json.JSONDecodeError, TypeError):
            return []


class AuditLog(db.Model):
    """操作日志模型"""
    __tablename__ = 'audit_logs'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    action = db.Column(db.String(20), nullable=False, comment='操作: create/update/delete')
    resource_type = db.Column(db.String(20), nullable=False, comment='资源: post/image')
    resource_id = db.Column(db.Integer, nullable=True, comment='资源ID')
    detail = db.Column(db.Text, nullable=True, comment='操作详情JSON')
    ip_address = db.Column(db.String(50), nullable=True, comment='请求IP')
    created_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now())

    def to_dict(self):
        return {
            'id': self.id,
            'action': self.action,
            'resource_type': self.resource_type,
            'resource_id': self.resource_id,
            'detail': self.detail,
            'ip_address': self.ip_address,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
