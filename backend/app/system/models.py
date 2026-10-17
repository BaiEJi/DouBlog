"""system 模块模型：

- system_accounts（登录账号——2026-10-12 自 config.py 迁入专表）：单用户系统，
  恒一行（id=1）。密码只存 PBKDF2-SHA256 哈希（accounts.py 编解码），明文不落库
  不落日志；config.py 的 auth_username/auth_password 仅作首次播种默认值。
- system_home_groups / system_home_cards（门户工作台布局，2026-10-17）：主页
  卡片分组 + 卡片顺序 + 标题/描述自定义覆盖，全量持久化（此前在 localStorage）。
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


class SystemHomeGroup(Base):
    """门户分组：name + position（组间顺序）。卡片经 system_home_cards.group_id 归组。"""
    __tablename__ = 'system_home_groups'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                         server_default=func.now(), onupdate=func.now())


class SystemHomeCard(Base):
    """门户卡片：key=模块标识（如 blog/diary，前端 systems.js 单源）。

    title/desc 为**自定义覆盖**，null 表示沿用前端内置默认文案（内置文案升级
    可向前传播）；分组归属 + 组内顺序由 group_id/position 决定。key 在整个
    布局内唯一（一张卡只出现一次）。
    """
    __tablename__ = 'system_home_cards'

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    group_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    title: Mapped[str | None] = mapped_column(String(120))
    desc: Mapped[str | None] = mapped_column(String(300))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                         server_default=func.now(), onupdate=func.now())

    def to_dict(self):
        return {'key': self.key, 'title': self.title, 'desc': self.desc}
