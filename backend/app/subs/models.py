"""
订阅管理数据模型（CrownFlow 迁移）

三张表（前缀 subs_ 隔离）：
- SubsCategory      会员分类（名称唯一，emoji 图标 + hex 颜色）
- SubsMember        会员主表（基础信息 + 提醒天数；一对多订阅记录）
- SubsSubscription  订阅记录（每次购买/续费一条：价格、币种、周期、起止、渠道）

会员状态口径：任意一条订阅 end_date >= 今天 ⇒ active，否则 expired。
聚合字段（列表即带）：latest_subscription / subscription_count / total_spending（折算基准币）/ total_duration_days。
日期一律 YYYY-MM-DD 字符串（跨 SQLite/PG 一致）。
"""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.shared.timestamps import _iso
from app.subs.currency import convert_to_base, parse_date


class SubsCategory(Base):
    """会员分类"""
    __tablename__ = 'subs_categories'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True,
                                      comment='分类名称（唯一）')
    icon: Mapped[str | None] = mapped_column(String(10), nullable=True, comment='emoji 图标')
    color: Mapped[str | None] = mapped_column(String(7), nullable=True, comment='hex 颜色')
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                        server_default=func.now())

    members = relationship('SubsMember', back_populates='category')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'icon': self.icon,
            'color': self.color,
            'created_at': _iso(self.created_at),
        }


class SubsMember(Base):
    """会员主表：支持同一会员多次续费（续费产生新订阅记录）"""
    __tablename__ = 'subs_members'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True, comment='会员名称')
    category_id: Mapped[int | None] = mapped_column(Integer, ForeignKey('subs_categories.id'),
                                                    nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True, comment='备注')
    reminder_days: Mapped[int | None] = mapped_column(Integer, default=7,
                                                      comment='提前 N 天提醒续费')
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                        server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                        server_default=func.now(),
                                                        onupdate=func.now())

    category = relationship('SubsCategory', back_populates='members')
    subscriptions = relationship('SubsSubscription', back_populates='member',
                                 cascade='all, delete-orphan')

    def to_dict(self, include_subscriptions: bool = False):
        """含聚合字段；include_subscriptions=True 时附全部订阅记录（详情页）"""
        today = datetime.now().strftime('%Y-%m-%d')
        subs = sorted(self.subscriptions or [], key=lambda s: (s.created_at, s.id), reverse=True)
        active = [s for s in subs if s.end_date >= today]

        latest = None
        if active:
            latest = active[0].to_dict()
        elif subs:
            latest = subs[0].to_dict()

        total_spending = Decimal('0')
        total_duration_days = 0
        for s in subs:
            total_spending += convert_to_base(s.price, s.currency) if s.price is not None else Decimal('0')
            try:
                total_duration_days += parse_date(s.end_date).toordinal() - parse_date(s.start_date).toordinal()
            except (ValueError, TypeError):
                pass

        result = {
            'id': self.id,
            'name': self.name,
            'category_id': self.category_id,
            'category': self.category.to_dict() if self.category else None,
            'notes': self.notes,
            'reminder_days': self.reminder_days,
            'latest_subscription': latest,
            'status': 'active' if active else 'expired',
            'subscription_count': len(subs),
            'total_spending': float(total_spending.quantize(Decimal('0.01'))),
            'total_duration_days': total_duration_days,
            'created_at': _iso(self.created_at),
            'updated_at': _iso(self.updated_at),
        }
        if include_subscriptions:
            result['subscriptions'] = [s.to_dict() for s in subs]
        return result


class SubsSubscription(Base):
    """订阅记录：价格 / 币种 / 计费周期 / 起止日期 / 渠道"""
    __tablename__ = 'subs_subscriptions'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    member_id: Mapped[int] = mapped_column(Integer, ForeignKey('subs_members.id'), nullable=False,
                                           index=True)
    level: Mapped[str | None] = mapped_column(String(50), nullable=True,
                                              comment='会员级别（豪华版/家庭版…）')
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, comment='价格')
    currency: Mapped[str | None] = mapped_column(String(3), default='CNY',
                                                 comment='币种 CNY/USD/EUR/GBP/JPY')
    billing_cycle: Mapped[str] = mapped_column(String(20), nullable=False,
                                               comment='monthly/quarterly/yearly/custom')
    custom_days: Mapped[int | None] = mapped_column(Integer, nullable=True,
                                                    comment='自定义周期天数（custom 时有效）')
    start_date: Mapped[str] = mapped_column(String(10), nullable=False, index=True,
                                            comment='YYYY-MM-DD')
    end_date: Mapped[str] = mapped_column(String(10), nullable=False, index=True,
                                          comment='YYYY-MM-DD')
    channel: Mapped[str | None] = mapped_column(String(50), nullable=True,
                                                comment='订阅渠道（官方/淘宝/代充…）')
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                        server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                        server_default=func.now(),
                                                        onupdate=func.now())

    member = relationship('SubsMember', back_populates='subscriptions')

    def to_dict(self):
        return {
            'id': self.id,
            'member_id': self.member_id,
            'level': self.level,
            'price': float(self.price) if self.price is not None else 0,
            'currency': self.currency,
            'billing_cycle': self.billing_cycle,
            'custom_days': self.custom_days,
            'start_date': self.start_date,
            'end_date': self.end_date,
            'channel': self.channel,
            'notes': self.notes,
            'created_at': _iso(self.created_at),
            'updated_at': _iso(self.updated_at),
        }
