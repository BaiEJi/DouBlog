"""密码服务：轮换密码项目/类型/用户/校验日志。"""

from datetime import datetime

from sqlalchemy import (Boolean, DateTime, ForeignKey, Index, Integer, String, Text,
                        UniqueConstraint, func, inspect, text)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.shared.timestamps import _iso, _utcnow


class PwsvcProject(Base):
    """密码服务项目：轮换密码的容器，持有一个供第三方校验的 API Key（只存哈希）"""
    __tablename__ = 'pwsvc_projects'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, comment='项目名')
    description: Mapped[str | None] = mapped_column(String(300), nullable=True, comment='描述')
    api_key_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True,
                                              comment='API Key 的 SHA-256')
    api_key_prefix: Mapped[str] = mapped_column(String(16), nullable=False, comment='API Key 前缀（识别用）')
    rate_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=120, server_default='120',
                                            comment='校验接口限流（次/分钟，0=不限流）')

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                 onupdate=func.now())

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description or '',
            'api_key_prefix': self.api_key_prefix,
            'rate_limit': self.rate_limit,
            'created_at': _iso(self.created_at),
        }

class PwsvcType(Base):
    """密码服务用户类型：定义该类用户的密码策略与轮换周期"""
    __tablename__ = 'pwsvc_user_types'
    __table_args__ = (UniqueConstraint('project_id', 'name', name='uq_pwsvc_type_name'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey('pwsvc_projects.id', ondelete='CASCADE'),
                                            nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False, comment='类型名，如 管理员/普通用户')

    length: Mapped[int] = mapped_column(Integer, default=16, comment='密码长度 8-64')
    uppercase: Mapped[bool] = mapped_column(Boolean, default=True)
    lowercase: Mapped[bool] = mapped_column(Boolean, default=True)
    digits: Mapped[bool] = mapped_column(Boolean, default=True)
    symbols: Mapped[bool] = mapped_column(Boolean, default=True)
    exclude_ambiguous: Mapped[bool] = mapped_column(Boolean, default=True, comment='排除易混淆字符 I l 1 O 0 o')
    rotation_seconds: Mapped[int] = mapped_column(Integer, default=60, comment='轮换周期秒')

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def policy(self):
        return {
            'length': self.length, 'uppercase': self.uppercase, 'lowercase': self.lowercase,
            'digits': self.digits, 'symbols': self.symbols,
            'exclude_ambiguous': self.exclude_ambiguous,
        }

    def to_dict(self):
        d = {'id': self.id, 'project_id': self.project_id, 'name': self.name,
             'rotation_seconds': self.rotation_seconds, 'created_at': _iso(self.created_at)}
        d.update(self.policy())
        return d

class PwsvcUser(Base):
    """密码服务用户：独立 seed（加密存储）→ 独立的轮换密码链"""
    __tablename__ = 'pwsvc_users'
    __table_args__ = (UniqueConstraint('project_id', 'username', name='uq_pwsvc_user_name'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey('pwsvc_projects.id', ondelete='CASCADE'),
                                            nullable=False, index=True)
    type_id: Mapped[int] = mapped_column(Integer, ForeignKey('pwsvc_user_types.id', ondelete='CASCADE'),
                                         nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(100), nullable=False, comment='用户名（项目内唯一）')
    display_name: Mapped[str | None] = mapped_column(String(100), nullable=True, comment='显示名')
    status: Mapped[str] = mapped_column(String(20), default='enabled', comment='enabled/disabled')

    seed_encrypted: Mapped[str] = mapped_column(Text, nullable=False, comment='seed 的 AES-256-GCM 密文(base64)')
    last_validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True,
                                                               comment='最近校验成功时间')
    last_viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True,
                                                            comment='最近查看密码时间')

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            'id': self.id,
            'project_id': self.project_id,
            'type_id': self.type_id,
            'username': self.username,
            'display_name': self.display_name or '',
            'status': self.status,
            'last_validated_at': _iso(self.last_validated_at),
            'last_viewed_at': _iso(self.last_viewed_at),
            'created_at': _iso(self.created_at),
        }

class PwsvcValidateLog(Base):
    """密码服务校验日志：只记行为与结果（项目/用户名/成败/IP/时间），永不含密码内容"""
    __tablename__ = 'pwsvc_validate_logs'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey('pwsvc_projects.id', ondelete='CASCADE'),
                                            nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(100), nullable=False, comment='被校验的用户名')
    valid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment='校验结果')
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True, comment='请求来源 IP')
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow, index=True,
                                                 comment='校验时间（naive UTC）')
    __table_args__ = (
        # 每次校验写入时的过期清理 DELETE 与管理端日志窗口统计都按
        # (project_id, created_at) 范围过滤：复合索引让二者从"项目全量行扫描"
        # 降为范围探测（日志量增长后差距拉大）
        Index('ix_pwsvc_logs_pid_created', 'project_id', 'created_at'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'valid': bool(self.valid),
            'ip': self.ip or '',
            'created_at': _iso(self.created_at),
        }


def ensure_migrations(engine):
    """
    密码服务幂等迁移：
    1. 存量库的 pwsvc_projects 表缺 rate_limit 列时补列
       （create_all 不会修改已存在的表；默认 120 次/分钟，与模型 server_default 一致）
    2. 存量库的 pwsvc_validate_logs 补 (project_id, created_at) 复合索引
       （create_all 只对新库生效；过期清理与日志统计的过滤列组合）
    """
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    if 'pwsvc_projects' in tables:
        columns = {c['name'] for c in inspector.get_columns('pwsvc_projects')}
        if 'rate_limit' not in columns:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE pwsvc_projects ADD COLUMN rate_limit INTEGER NOT NULL DEFAULT 120"
                ))
    if 'pwsvc_validate_logs' in tables:
        existing = {ix['name'] for ix in inspector.get_indexes('pwsvc_validate_logs')}
        if 'ix_pwsvc_logs_pid_created' not in existing:
            with engine.begin() as conn:
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_pwsvc_logs_pid_created "
                    "ON pwsvc_validate_logs (project_id, created_at)"
                ))
