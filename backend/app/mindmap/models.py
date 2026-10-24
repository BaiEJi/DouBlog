"""Validated complete documents, immutable versions, and durable mutation receipts."""
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import mapped_column

from app.db import Base
from app.shared.timestamps import _iso, _utcnow


class MindMap(Base):
    __tablename__ = 'mindmap_maps'

    id = mapped_column(Integer, primary_key=True, autoincrement=True)
    name = mapped_column(String(200), nullable=False, index=True)
    workspace_id = mapped_column(Integer, ForeignKey('blog_workspaces.id'), nullable=True, index=True)
    post_id = mapped_column(Integer, ForeignKey('blog_posts.id', ondelete='SET NULL'), nullable=True, index=True)
    document = mapped_column(JSON, nullable=False)
    schema_version = mapped_column(Integer, nullable=False, default=1)
    revision = mapped_column(Integer, nullable=False, default=1)
    node_count = mapped_column(Integer, nullable=False)
    created_by = mapped_column(String(100), nullable=False)
    updated_by = mapped_column(String(100), nullable=False)
    created_at = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, index=True)
    deleted = mapped_column(Boolean, nullable=False, default=False, index=True)

    def to_dict(self, include_document=True):
        out = {key: getattr(self, key) for key in (
            'id', 'name', 'workspace_id', 'post_id', 'revision', 'schema_version',
            'node_count', 'created_by', 'updated_by')}
        out.update(created_at=_iso(self.created_at), updated_at=_iso(self.updated_at))
        if include_document:
            out['document'] = self.document
        return out


class MindMapVersion(Base):
    __tablename__ = 'mindmap_versions'
    __table_args__ = (UniqueConstraint('map_id', 'revision', name='uq_mindmap_version'),)

    id = mapped_column(Integer, primary_key=True, autoincrement=True)
    map_id = mapped_column(Integer, ForeignKey('mindmap_maps.id'), nullable=False, index=True)
    revision = mapped_column(Integer, nullable=False)
    snapshot = mapped_column(JSON, nullable=False)
    action = mapped_column(String(40), nullable=False)
    actor = mapped_column(String(100), nullable=False)
    ip_address = mapped_column(String(64), nullable=True)
    created_at = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    def to_dict(self, include_document=False):
        out = {key: self.snapshot.get(key) for key in (
            'name', 'workspace_id', 'post_id', 'node_count')}
        out.update(revision=self.revision, action=self.action, actor=self.actor,
                   ip_address=self.ip_address, created_at=_iso(self.created_at))
        if include_document:
            out.update(self.snapshot)
        return out


class MindMapMutation(Base):
    __tablename__ = 'mindmap_mutations'

    id = mapped_column(Integer, primary_key=True, autoincrement=True)
    mutation_id = mapped_column(String(128), nullable=False, unique=True)
    fingerprint = mapped_column(String(64), nullable=False)
    response = mapped_column(JSON, nullable=False)
    result_map_id = mapped_column(Integer, nullable=True, index=True)
    result_revision = mapped_column(Integer, nullable=True)
    includes_document = mapped_column(Boolean, nullable=False, default=False)
    status_code = mapped_column(Integer, nullable=False)
    created_at = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
