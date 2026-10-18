"""API Hub 模块模型：系统/API/平台令牌/限流规则/调用日志/探活日志。

分类只有 system → api 两个维度：系统（手动创建，类比 confcenter 的 namespace）
下挂多个 API，API 的路径模板映射到系统的 base_url 上。
鉴权（providers + 凭证值）全部内联在 API 的 auth_config 明文 JSON 里——
单用户自用场景不做密钥池/加密/脱敏，2026-10-17 重构迁移见 __init__.py。
"""

from datetime import datetime

from sqlalchemy import (JSON, BigInteger, Boolean, DateTime, Float, ForeignKey,
                        Integer, String, Text, func)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.shared.timestamps import _iso, _utcnow


class ApihubSystem(Base):
    """系统：一组同源 API 的公共连接配置（base_url/超时/重试/传输）。

    2026-10-17 重构前名为 ApihubUpstream（上游），表 apihub_upstreams 由
    db.LEGACY_TABLE_MAP 启动幂等改名；auth_config_enc（系统级鉴权+密钥池）已
    迁移为 API 级 auth_config，本表只留连接参数。"""
    __tablename__ = 'apihub_systems'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    base_url: Mapped[str] = mapped_column(String(512), nullable=False)
    timeout_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=30000, server_default='30000')
    max_retry: Mapped[int] = mapped_column(Integer, nullable=False, default=2, server_default='2')
    transport: Mapped[dict | None] = mapped_column(JSON, nullable=True)   # 传输参数（verify 等）
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default='1')  # 1启用 2手动禁用 3自动禁用
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def to_dict(self):
        return {
            'id': self.id, 'name': self.name, 'slug': self.slug, 'base_url': self.base_url,
            'timeout_ms': self.timeout_ms, 'max_retry': self.max_retry, 'status': self.status,
            'disabled_reason': self.disabled_reason, 'transport': self.transport or {},
            'created_at': _iso(self.created_at),
        }


class ApihubApi(Base):
    """API：平台对外一个可调用单元（invoke 统一信封 / 透明代理）。

    system_id 归属系统，path_tpl 相对系统 base_url（支持 {path.x}/{cred.x} 模板）；
    auth_config 明文 JSON 内联鉴权：{providers, credential_fields, credential, transport}——
    {cred.x} 模板引用 credential 里的值（如 {"providers":[{"type":"bearer",
    "value":"{cred.token}"}], "credential":{"token":"xxx"}}）。"""

    __tablename__ = 'apihub_apis'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    system_id: Mapped[int] = mapped_column(Integer, ForeignKey('apihub_systems.id', ondelete='CASCADE'),
                                           nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    description: Mapped[str] = mapped_column(String(256), nullable=False, default='')
    method: Mapped[str] = mapped_column(String(8), nullable=False, default='GET', server_default='GET')
    path_tpl: Mapped[str] = mapped_column(String(512), nullable=False, default='/')
    auth_config: Mapped[dict | None] = mapped_column(JSON, nullable=True)   # providers/credential_fields/credential/transport（明文）
    request_cfg: Mapped[dict | None] = mapped_column(JSON, nullable=True)    # body 类型 json/form/raw、header 模板
    response_cfg: Mapped[dict | None] = mapped_column(JSON, nullable=True)   # envelope/charset/error_mapping 双通道
    timeout_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    probe: Mapped[dict | None] = mapped_column(JSON, nullable=True)          # 探活配置（path/expect_status/阈值/interval_s）
    health_status: Mapped[str] = mapped_column(String(16), nullable=False, default='unknown', server_default='unknown')
    last_probe_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default='1')
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ApihubToken(Base):
    """平台令牌：sk- 前缀，SHA-256 落库（明文仅签发时返回一次）"""
    __tablename__ = 'apihub_tokens'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    key_hint: Mapped[str] = mapped_column(String(24), nullable=False, default='')
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    allowed_api_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)   # null=全部
    allowed_ips: Mapped[list | None] = mapped_column(JSON, nullable=True)
    quota_total: Mapped[int | None] = mapped_column(Integer, nullable=True)    # 计次配额
    quota_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default='0')
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default='1')
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def to_dict(self):
        return {
            'id': self.id, 'name': self.name, 'key_hint': self.key_hint,
            'expires_at': _iso(self.expires_at), 'allowed_api_ids': self.allowed_api_ids,
            'allowed_ips': self.allowed_ips, 'quota_total': self.quota_total,
            'quota_used': self.quota_used, 'status': self.status,
            'last_used_at': _iso(self.last_used_at), 'created_at': _iso(self.created_at),
        }


class ApihubRule(Base):
    """限流规则：scope 定层级（token_api|api|token|global），同层多条取最严格"""
    __tablename__ = 'apihub_rules'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scope: Mapped[str] = mapped_column(String(16), nullable=False)
    api_id: Mapped[int | None] = mapped_column(Integer, ForeignKey('apihub_apis.id', ondelete='CASCADE'), nullable=True, index=True)
    token_id: Mapped[int | None] = mapped_column(Integer, ForeignKey('apihub_tokens.id', ondelete='CASCADE'), nullable=True, index=True)
    algorithm: Mapped[str] = mapped_column(String(16), nullable=False, default='token_bucket', server_default='token_bucket')
    rate_per_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    burst: Mapped[int | None] = mapped_column(Integer, nullable=True)
    window_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default='1')
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            'id': self.id, 'scope': self.scope, 'api_id': self.api_id, 'token_id': self.token_id,
            'algorithm': self.algorithm, 'rate_per_sec': self.rate_per_sec, 'burst': self.burst,
            'window_s': self.window_s, 'max_count': self.max_count, 'enabled': self.enabled,
        }


class ApihubCallLog(Base):
    """调用日志（异步批量写入，writer 线程）"""
    __tablename__ = 'apihub_call_logs'

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, 'sqlite'),
                                    primary_key=True, autoincrement=True)
    token_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    api_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    system_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default='invoke')
    method: Mapped[str] = mapped_column(String(8), nullable=False, default='')
    path_digest: Mapped[str] = mapped_column(String(256), nullable=False, default='')
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    error_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rl_scope: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)


class ApihubHealthLog(Base):
    """探活日志（manual/scheduled）"""
    __tablename__ = 'apihub_health_logs'

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, 'sqlite'),
                                    primary_key=True, autoincrement=True)
    api_id: Mapped[int] = mapped_column(Integer, ForeignKey('apihub_apis.id', ondelete='CASCADE'), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=_utcnow)
