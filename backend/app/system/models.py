"""system 模块模型：system_accounts（登录账号——2026-10-12 自 config.py 迁入专表）。

单用户系统：恒一行（id=1）。密码只存 PBKDF2-SHA256 哈希（accounts.py 编解码），
明文不落库不落日志；config.py 的 auth_username/auth_password 仅作首次播种默认值。
"""
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.shared.timestamps import _iso


class SystemAccount(Base):
    """登录账号（用户名 + 密码哈希）；会话仍为 HMAC 签名 Cookie（secret_key 在 config）"""
    __tablename__ = 'system_accounts'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)   # pbkdf2$iters$salt$hash
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                         server_default=func.now(), onupdate=func.now())

    def to_dict(self):
        return {'username': self.username, 'updated_at': _iso(self.updated_at)}
