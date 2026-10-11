"""博客/知识库：知识库分组、树形文章、操作审计。"""

import json

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import mapped_column, relationship

from app.db import Base
from app.shared.timestamps import _iso, _utcnow  # noqa: F401  (_utcnow 兼容导入)


class Workspace(Base):
    """知识库模型：文章的顶层分组，顶级文章顺序存在本行的 children_order"""
    __tablename__ = 'blog_workspaces'

    id = mapped_column(Integer, primary_key=True, autoincrement=True)
    name = mapped_column(String(100), nullable=False, unique=True, comment='知识库名称')
    description = mapped_column(String(500), nullable=True, comment='描述')
    children_order = mapped_column(Text, nullable=True, comment='顶级文章排序JSON数组')

    created_at = mapped_column(DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    updated_at = mapped_column(DateTime(timezone=True), server_default=func.now(),
                               onupdate=func.now(), comment='更新时间')

    def to_dict(self, post_count: int = None):
        result = {
            'id': self.id,
            'name': self.name,
            'description': self.description or '',
            'created_at': _iso(self.created_at),
            'updated_at': _iso(self.updated_at),
        }
        if post_count is not None:
            result['post_count'] = post_count
        return result

    def _parse_children_order(self) -> list:
        if not self.children_order:
            return []
        try:
            return json.loads(self.children_order)
        except (json.JSONDecodeError, TypeError):
            return []

class Post(Base):
    """文章模型，支持树形结构，隶属于某个知识库"""
    __tablename__ = 'blog_posts'

    id = mapped_column(Integer, primary_key=True, autoincrement=True)
    title = mapped_column(String(200), nullable=False, comment='文章标题')
    name = mapped_column(String(100), nullable=False, index=True, comment='英文名(URL路径段)')
    slug = mapped_column(String(500), nullable=True, index=True, comment='完整URL路径(动态计算，可为空)')
    content = mapped_column(Text, nullable=False, comment='Markdown内容')
    summary = mapped_column(Text, nullable=True, comment='摘要')

    workspace_id = mapped_column(Integer, ForeignKey('blog_workspaces.id'),
                                 nullable=True, index=True, comment='所属知识库ID')

    parent_id = mapped_column(Integer, ForeignKey('blog_posts.id', ondelete='SET NULL'),
                              nullable=True, index=True, comment='父文章ID')
    level = mapped_column(Integer, default=0, comment='层级深度')
    children_order = mapped_column(Text, nullable=True, comment='子节点排序JSON数组，如[3,1,5]')

    author = mapped_column(String(50), default='admin', comment='作者')
    status = mapped_column(String(20), default='published', index=True, comment='状态')
    is_top = mapped_column(Boolean, default=False, comment='是否置顶')

    view_count = mapped_column(Integer, default=0, comment='访问次数')
    last_viewed_at = mapped_column(DateTime(timezone=True), nullable=True,
                                   comment='最近浏览时间(仅计入真实浏览)')

    tags = mapped_column(Text, nullable=True, comment='标签JSON')
    meta_data = mapped_column(Text, nullable=True, comment='扩展元数据JSON')

    created_at = mapped_column(DateTime(timezone=True), server_default=func.now(), comment='创建时间')
    updated_at = mapped_column(DateTime(timezone=True), server_default=func.now(),
                               onupdate=func.now(), comment='更新时间')

    parent = relationship('Post', remote_side=[id], backref='children')

    def to_dict(self, include_content: bool = True):
        """
        将文章模型转换为字典格式

        Args:
            include_content: 是否包含正文（列表等概览场景传 False 以减小响应体积）

        Returns:
            dict: 包含文章属性的字典
        """
        result = {
            'id': self.id,
            'title': self.title,
            'name': self.name,
            'slug': self.slug,
            'summary': self.summary or '',
            'workspace_id': self.workspace_id,
            'parent_id': self.parent_id,
            'level': self.level,
            'author': self.author,
            'status': self.status,
            'is_top': self.is_top,
            'view_count': self.view_count,
            'tags': self._parse_tags(),
            'meta_data': self.meta_data,
            'last_viewed_at': _iso(self.last_viewed_at),
            'created_at': _iso(self.created_at),
            'updated_at': _iso(self.updated_at),
        }
        if include_content:
            result['content'] = self.content
        return result

    def to_tree_dict(self):
        """
        将文章模型转换为树形结构字典格式（不含正文，正文由详情接口按需返回）

        Returns:
            dict: 包含文章属性和空children列表的字典
        """
        return {
            'id': self.id,
            'title': self.title,
            'name': self.name,
            'slug': self.slug,
            'workspace_id': self.workspace_id,
            'level': self.level,
            'children_order': self._parse_children_order(),
            'is_top': self.is_top,
            'view_count': self.view_count,
            'tags': self._parse_tags(),
            'author': self.author,
            'status': self.status,
            'summary': self.summary or '',
            'created_at': _iso(self.created_at),
            'updated_at': _iso(self.updated_at),
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

class AuditLog(Base):
    """操作日志模型"""
    __tablename__ = 'blog_audit_logs'

    id = mapped_column(Integer, primary_key=True, autoincrement=True)
    action = mapped_column(String(20), nullable=False, comment='操作: create/update/delete')
    resource_type = mapped_column(String(20), nullable=False, comment='资源: post/workspace（image 为历史预留）')
    resource_id = mapped_column(Integer, nullable=True, comment='资源ID')
    detail = mapped_column(Text, nullable=True, comment='操作详情JSON')
    ip_address = mapped_column(String(50), nullable=True, comment='请求IP')
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            'id': self.id,
            'action': self.action,
            'resource_type': self.resource_type,
            'resource_id': self.resource_id,
            'detail': self.detail,
            'ip_address': self.ip_address,
            'created_at': _iso(self.created_at),
        }
