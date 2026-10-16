"""零知识密码库（账号材料/条目密文/审计）。"""

import json
import orjson
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.shared.timestamps import _iso


class VaultAccount(Base):
    """Vault 账号（单行）：仅存零知识加密材料——KDF 参数/盐 + 被包裹的 VEK。

    服务端永远不接触：主密码、Recovery Key、VEK 明文、任何条目明文。
    """
    __tablename__ = 'vault_accounts'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kdf_algo: Mapped[str] = mapped_column(String(20), nullable=False, default='argon2id', comment='KDF 算法')
    kdf_params: Mapped[str] = mapped_column(Text, nullable=False, comment='KDF 参数 JSON {t,m,p}')
    kdf_salt: Mapped[str] = mapped_column(String(64), nullable=False, comment='主密码盐 base64')
    recovery_salt: Mapped[str] = mapped_column(String(64), nullable=False, comment='Recovery Key 盐 base64')
    wrapped_vault_key: Mapped[str] = mapped_column(Text, nullable=False, comment='KEK₁(主密码) 包裹的 VEK {n,ct}')
    recovery_wrapped_vault_key: Mapped[str] = mapped_column(Text, nullable=False, comment='KEK₂(恢复密钥) 包裹的 VEK {n,ct}')

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def to_dict(self):
        return {
            'id': self.id,
            'kdf_algo': self.kdf_algo,
            'kdf_params': json.loads(self.kdf_params or '{}'),
            'kdf_salt': self.kdf_salt,
            'recovery_salt': self.recovery_salt,
            'wrapped_vault_key': json.loads(self.wrapped_vault_key or '{}'),
            'recovery_wrapped_vault_key': json.loads(self.recovery_wrapped_vault_key or '{}'),
            'created_at': _iso(self.created_at),
        }


class VaultItem(Base):
    """Vault 条目：敏感内容全部在加密 blob 内；明文列仅非敏感元数据。"""
    __tablename__ = 'vault_items'
    # 列表接口 WHERE deleted_at IS NULL ORDER BY updated_at DESC 的覆盖索引
    # （trash / live 两态均命中，免全表扫 + 排序）
    __table_args__ = (
        Index('ix_vault_items_trash_order', 'deleted_at', 'updated_at'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    blob: Mapped[str] = mapped_column(Text, nullable=False, comment='条目密文 JSON {n,ct}（AES-256-GCM）')
    favorite: Mapped[bool] = mapped_column(Boolean, default=False, index=True, comment='收藏')
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, comment='最近使用（仅时间，无内容）')
    password_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, comment='最近改密时间（客户端上报）')
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True, comment='回收站软删时间')

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def to_dict(self):
        return {
            'id': self.id,
            'blob': orjson.loads(self.blob or '{}'),
            'favorite': bool(self.favorite),
            'last_used_at': _iso(self.last_used_at),
            'password_updated_at': _iso(self.password_updated_at),
            'deleted_at': _iso(self.deleted_at),
            'created_at': _iso(self.created_at),
            'updated_at': _iso(self.updated_at),
        }

class VaultAttachment(Base):
    """条目安全附件：前端用 VEK 加密后的密文 blob（{n, ct}），服务端不理解内容。

    文件名/mime/内容全部在密文内；size 仅记明文大小（客户端上报，用于展示与限额）。
    生命周期跟随条目：软删保留（恢复语义），purge 时级联删除。
    """

    __tablename__ = 'vault_attachments'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey('vault_items.id'), nullable=False, index=True)
    blob: Mapped[str] = mapped_column(Text, nullable=False, comment='附件密文 JSON {n,ct}（AES-256-GCM，含文件名/类型/数据）')
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment='明文大小（字节，客户端上报）')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            'id': self.id,
            'item_id': self.item_id,
            'blob': json.loads(self.blob or '{}'),
            'size': self.size,
            'created_at': _iso(self.created_at),
        }


class VaultAuditLog(Base):
    """Vault 审计日志：只记行为与条目 ID，禁止任何 secret/旧密码/剪贴板内容。"""
    __tablename__ = 'vault_audit_logs'
    # 分页列表恒按 created_at DESC；审计无清理策略只增不减，索引保证翻页不随规模退化
    __table_args__ = (
        Index('ix_vault_audit_logs_created_at', 'created_at'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    action: Mapped[str] = mapped_column(String(40), nullable=False, index=True, comment='行为: created/updated/used/...')
    item_id: Mapped[int | None] = mapped_column(Integer, nullable=True, comment='相关条目 ID（可为空）')

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            'id': self.id,
            'action': self.action,
            'item_id': self.item_id,
            'created_at': _iso(self.created_at),
        }
