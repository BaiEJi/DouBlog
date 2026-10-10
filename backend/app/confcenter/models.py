"""配置中心数据模型：一张扁平 KV 映射表（无中间实体）。

value = {type, data} 包装：namespace+key 唯一定位一个 value；
显式 type 的理由：裸存时 "123"/"[1,2]" 会被误判 JSON，读时无法还原
"本来就是字符串"——显式声明消除歧义。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.shared.timestamps import _iso


class ConfEntry(Base):
    """配置项（namespace+key 复合主键）。"""
    __tablename__ = 'confcenter_entries'

    namespace: Mapped[str] = mapped_column(String(100), primary_key=True,
                                           comment='命名空间（复合主键左）')
    key: Mapped[str] = mapped_column(String(200), primary_key=True,
                                     comment='配置键（复合主键右）')
    type: Mapped[str] = mapped_column(String(8), nullable=False, default='str',
                                      comment='值类型: str | json')
    data: Mapped[str] = mapped_column(Text, nullable=False, default='',
                                      comment='str=原样字符串；json=合法 JSON 文本（对象/数组/数字均可）')
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), comment='更新时间')

    __table_args__ = (
        # 按 ns 浏览的单列索引（复合主键虽可作前缀，显式建索引与规范一致）
        Index('ix_confcenter_entries_namespace', 'namespace'),
    )

    def payload(self) -> dict:
        """缓存/响应共用的 {type, data(原始存储文本), updated_at} 载荷。"""
        return {'type': self.type, 'data': self.data, 'updated_at': _iso(self.updated_at)}
