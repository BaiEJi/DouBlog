"""
Prompt 与 Skill 资产库数据模型

四张表（前缀 assets_ 隔离）：
- AssetCategory   自定义分类（名称唯一，emoji 图标 + hex 颜色，可限定 kind）
- AssetItem       资产条目（kind=prompt/skill；内容 + 标签 + 变量；软删状态机）
- AssetVersion    版本快照（内容类字段变更即存档，可恢复——恢复产生新版本）
- AssetUsageLog   使用日志（copy/fill/export 动作，驱动使用统计与趋势）

状态机：active ⇄ archived；active/archived → trash（软删）→ restore 回 active；
hard 删除物理清除（级联版本与使用日志）。
变量提取 `{{name}}` 在服务端保存时计算（前端展示仅供参考，别信任前端）。
"""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.shared.timestamps import _iso

KINDS = ('prompt', 'skill')
STATUSES = ('active', 'archived', 'trash')


class AssetCategory(Base):
    """资产分类"""
    __tablename__ = 'assets_categories'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True,
                                      comment='分类名称（唯一）')
    icon: Mapped[str | None] = mapped_column(String(10), nullable=True, comment='emoji 图标')
    color: Mapped[str | None] = mapped_column(String(7), nullable=True, comment='hex 颜色')
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default='all',
                                      comment='适用类型 all/prompt/skill')
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0,
                                            comment='排序（小在前）')
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                        server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                        server_default=func.now(),
                                                        onupdate=func.now())

    items = relationship('AssetItem', back_populates='category')

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'icon': self.icon,
            'color': self.color,
            'kind': self.kind,
            'sort_order': self.sort_order,
            'created_at': _iso(self.created_at),
            'updated_at': _iso(self.updated_at),
        }


class AssetItem(Base):
    """资产条目：prompt 或 skill"""
    __tablename__ = 'assets_items'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False, index=True,
                                      comment='prompt/skill')
    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True, comment='标题')
    summary: Mapped[str | None] = mapped_column(Text, nullable=True, comment='一句话摘要')
    content: Mapped[str] = mapped_column(Text, nullable=False, comment='正文')
    category_id: Mapped[int | None] = mapped_column(Integer, ForeignKey('assets_categories.id'),
                                                    nullable=True, index=True)
    tags: Mapped[list] = mapped_column(JSON, nullable=False, default=list, comment='标签列表')
    variables: Mapped[list] = mapped_column(JSON, nullable=False, default=list,
                                            comment='正文变量（服务端提取的 {{name}}）')
    favorite: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False,
                                           comment='收藏')
    status: Mapped[str] = mapped_column(String(10), nullable=False, default='active',
                                        index=True, comment='active/archived/trash')
    usage_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0,
                                             comment='使用次数（copy/fill/export）')
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1,
                                         comment='当前版本号')
    archive: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True,
                                                  comment='Skill 包原始 zip（可下载原包）')
    archive_name: Mapped[str | None] = mapped_column(String(200), nullable=True,
                                                     comment='原始压缩包文件名')
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                        server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                        server_default=func.now(),
                                                        onupdate=func.now())

    category = relationship('AssetCategory', back_populates='items')
    versions = relationship('AssetVersion', back_populates='item',
                            cascade='all, delete-orphan',
                            order_by='AssetVersion.version.desc()')
    usage_logs = relationship('AssetUsageLog', back_populates='item',
                              cascade='all, delete-orphan')
    files = relationship('AssetFile', back_populates='item', cascade='all, delete-orphan',
                         order_by='AssetFile.path')

    def to_dict(self, include_content: bool = False) -> dict:
        out = {
            'id': self.id,
            'kind': self.kind,
            'title': self.title,
            'summary': self.summary,
            'category_id': self.category_id,
            'category': self.category.name if self.category else None,
            'tags': self.tags or [],
            'variables': self.variables or [],
            'favorite': bool(self.favorite),
            'status': self.status,
            'usage_count': self.usage_count,
            'last_used_at': _iso(self.last_used_at),
            'version': self.version,
            'versions_count': len(self.versions) if self.versions else None,
            'files_count': len(self.files) if self.files else 0,
            'archive_name': self.archive_name,
            'created_at': _iso(self.created_at),
            'updated_at': _iso(self.updated_at),
        }
        if include_content:
            out['content'] = self.content
        return out


class AssetVersion(Base):
    """版本快照：内容类字段（title/summary/content）每次变更存一版"""
    __tablename__ = 'assets_versions'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey('assets_items.id'),
                                         nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, comment='版本号')
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[str | None] = mapped_column(String(200), nullable=True, comment='版本备注')
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                        server_default=func.now())

    item = relationship('AssetItem', back_populates='versions')

    def to_dict(self, include_content: bool = False) -> dict:
        out = {
            'id': self.id,
            'item_id': self.item_id,
            'version': self.version,
            'title': self.title,
            'note': self.note,
            'created_at': _iso(self.created_at),
        }
        if include_content:
            out['summary'] = self.summary
            out['content'] = self.content
        return out


class AssetUsageLog(Base):
    """使用日志：copy / fill / export 三种动作（详情查看不记录）"""
    __tablename__ = 'assets_usage_logs'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey('assets_items.id'),
                                         nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(10), nullable=False, comment='copy/fill/export')
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                        server_default=func.now(), index=True)

    item = relationship('AssetItem', back_populates='usage_logs')

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'item_id': self.item_id,
            'action': self.action,
            'created_at': _iso(self.created_at),
        }


class AssetFile(Base):
    """Skill 包内文件（导入 zip 时解包；文本文件带内容可预览，二进制只存元数据）"""
    __tablename__ = 'assets_files'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey('assets_items.id'),
                                         nullable=False, index=True)
    path: Mapped[str] = mapped_column(String(500), nullable=False,
                                      comment='包内相对路径（已剥技能根目录前缀）')
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_text: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True,
                                                comment='文本内容（≤512KB 入库，否则 NULL）')
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                        server_default=func.now())

    item = relationship('AssetItem', back_populates='files')

    def to_dict(self, include_content: bool = False) -> dict:
        out = {
            'id': self.id,
            'item_id': self.item_id,
            'path': self.path,
            'size': self.size,
            'is_text': bool(self.is_text),
            'created_at': _iso(self.created_at),
        }
        if include_content:
            out['content'] = self.content if self.is_text else None
        return out
