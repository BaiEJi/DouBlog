"""steamidler 单表模型:steamidler_accounts(源 db.py 的 accounts 表逐列照搬)。

列名/类型/默认值与源表一致(时间戳为 unix epoch 秒、idle_appids 为 JSON 字符串、
games_cache 为 JSON 字符串);表由骨架 init_db 的 create_all 统一创建,
挂 Doublog app.db.Base(模块名_表名规范)。
"""
from sqlalchemy import Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class SteamidlerAccount(Base):
    """一个已登录的 Steam 账号:refresh_token 换取挂机会话,配置与统计随行。"""

    __tablename__ = "steamidler_accounts"

    steamid: Mapped[str] = mapped_column(String(32), primary_key=True)
    account_name: Mapped[str] = mapped_column(Text, nullable=False)
    avatar_url: Mapped[str] = mapped_column(Text, default="")
    refresh_token: Mapped[str] = mapped_column(Text, nullable=False)
    shared_secret: Mapped[str] = mapped_column(Text, default="")
    idle_appids: Mapped[str] = mapped_column(Text, default="[]")
    auto_resume: Mapped[int] = mapped_column(Integer, default=1)
    farmed_seconds: Mapped[float] = mapped_column(Float, default=0)
    games_cache: Mapped[str] = mapped_column(Text, default="")
    games_cached_at: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[float] = mapped_column(Float, default=0)
    updated_at: Mapped[float] = mapped_column(Float, default=0)
