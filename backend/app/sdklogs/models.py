"""lizysdk 日志接收落库行。"""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Index, Integer, SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.shared.timestamps import _iso, _utcnow


class SdkLog(Base):
    """
    lizysdk 日志接收模块的落库行（见 docs/lizylog 设计与 api.md 第 12 节）。

    - ts / received_at 一律 naive UTC（跨 SQLite/PG 比较语义一致；
      SDK 无时区时间戳按 settings.logs_incoming_tz 解释后转 UTC）
    - level 数值列对齐标准库（10/20/30/40/50），level_text 供展示
    - trace_id 是第一查询模式，提升物理列 + 索引，不埋 JSON
    - fields 保留 SDK 全部业务 kv（值统一 str）；JSON 在 SQLite 为 TEXT、PG 为 Json
    - sys_name 只建复合 (sys_name, ts)（单列索引被其前缀覆盖，白付一次行插入维护；
      存量库的冗余单列索引由 ensure_migrations 幂等删除）
    """
    __tablename__ = 'sdklogs_logs'
    __table_args__ = (
        Index('ix_sdklogs_sys_ts', 'sys_name', 'ts'),
        Index('ix_sdklogs_level_ts', 'level', 'ts'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True, comment='日志时间（naive UTC）')
    level: Mapped[int] = mapped_column(SmallInteger, nullable=False, comment='10/20/30/40/50')
    level_text: Mapped[str] = mapped_column(String(10), nullable=False, comment='DEBUG/INFO/WARNING/ERROR/CRITICAL')
    sys_name: Mapped[str] = mapped_column(String(64), nullable=False, comment='系统标识（复合索引 ix_sdklogs_sys_ts 前缀）')
    file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    line: Mapped[int | None] = mapped_column(Integer, nullable=True)
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    fields: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, comment='业务 kv（值统一 str）')
    received_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow, comment='入库时间（naive UTC）')

    def to_dict(self):
        return {
            'id': self.id,
            'ts': _iso(self.ts),
            'level': self.level,
            'level_text': self.level_text,
            'sys_name': self.sys_name,
            'file': self.file,
            'line': self.line,
            'trace_id': self.trace_id,
            'message': self.message,
            'fields': self.fields or {},
            'received_at': _iso(self.received_at),
        }


class SdkAlert(Base):
    """日志告警事件（阈值规则触发；配置见 data/logs_alerts.json，本表只存触发记录）。"""

    __tablename__ = 'sdklogs_alerts'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_utcnow, index=True, comment='触发时间（naive UTC）')
    level_text: Mapped[str] = mapped_column(String(10), nullable=False, comment='规则级别（>= 该级别计数）')
    sys_name: Mapped[str | None] = mapped_column(String(64), nullable=True, comment='限定系统（空=全部）')
    count: Mapped[int] = mapped_column(Integer, nullable=False, comment='窗口内命中条数')
    window_minutes: Mapped[int] = mapped_column(Integer, nullable=False, comment='统计窗口（分钟）')
    sample: Mapped[str] = mapped_column(Text, nullable=False, comment='最近一条命中消息样例')
    notified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment='webhook 是否已通知')
    acked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True, comment='是否已确认')

    def to_dict(self):
        return {
            'id': self.id,
            'created_at': _iso(self.created_at),
            'level_text': self.level_text,
            'sys_name': self.sys_name or '*',
            'count': self.count,
            'window_minutes': self.window_minutes,
            'sample': self.sample,
            'notified': self.notified,
            'acked': self.acked,
        }
