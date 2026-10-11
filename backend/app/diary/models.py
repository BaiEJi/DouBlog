"""私人日记（Memos/Day One 超集）：多日记本、置顶、归档、回收站、天气位置、分享。"""

from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func, inspect as sa_inspect, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.shared.timestamps import _iso

#: 预置日记本（迁移时确保存在；随记必须归属其一或自建本）
PRESET_JOURNALS = [('日常', '🏡', 0), ('工作', '💼', 1), ('感悟', '🌱', 2)]


class DiaryJournal(Base):
    """日记本（分册）：工作 / 生活等，条目归属其一"""
    __tablename__ = 'diary_journals'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, comment='本子名')
    emoji: Mapped[str | None] = mapped_column(String(8), nullable=True, default='📖', comment='图标 emoji')
    sort: Mapped[int] = mapped_column(Integer, default=0, comment='排序')
    created_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())

    def to_dict(self, entry_count=None):
        d = {'id': self.id, 'name': self.name, 'emoji': self.emoji or '📖', 'sort': self.sort}
        if entry_count is not None:
            d['entry_count'] = entry_count
        return d


class Diary(Base):
    """日记条目：按日期记录；软删除进回收站；可置顶/归档/分享；带天气与位置元数据"""
    __tablename__ = 'diary_diaries'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    content: Mapped[str] = mapped_column(Text, nullable=False, default='', comment='Markdown 内容')
    entry_date: Mapped[str] = mapped_column(String(10), nullable=False, index=True,
                                            comment='日记日期 YYYY-MM-DD（同一天可多篇）')
    mood: Mapped[str | None] = mapped_column(String(20), nullable=True, comment='心情: great/good/ok/low/bad')
    tags: Mapped[str | None] = mapped_column(Text, nullable=True, comment='标签JSON数组')
    word_count: Mapped[int] = mapped_column(Integer, default=0, comment='正文字数（保存时统计，CJK 逐字+西文按词）')

    journal_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey('diary_journals.id'), nullable=True, index=True,
        comment='所属日记本（随记必填由 API 保证；每日总结无本=NULL）')
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default='note', index=True,
                                      comment='note=随记 / summary=每日总结（每天一篇）')
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, index=True, comment='置顶')
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True,
                                                         comment='归档时间（NULL=未归档）')
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True,
                                                        comment='软删除时间（回收站；NULL=正常）')
    weather: Mapped[str | None] = mapped_column(Text, nullable=True,
                                                comment='天气 JSON：{temp,code,text,wind,humidity}')
    location: Mapped[str | None] = mapped_column(Text, nullable=True, comment='位置 JSON：{lat,lon,place}')

    share_token: Mapped[str | None] = mapped_column(String(40), nullable=True, unique=True, index=True,
                                                    comment='分享 token')
    share_expires: Mapped[datetime | None] = mapped_column(DateTime, nullable=True,
                                                           comment='分享过期时间（naive UTC）')

    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                        comment='创建时间')
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                        onupdate=func.now(), comment='更新时间')

    def to_dict(self, include_content: bool = True):
        result = {
            'id': self.id,
            'entry_date': self.entry_date,
            'kind': self.kind or 'note',
            'mood': self.mood,
            'word_count': self.word_count,
            'journal_id': self.journal_id,
            'pinned': bool(self.pinned),
            'archived': self.archived_at is not None,
            'deleted': self.deleted_at is not None,
            'weather': self._parse_json(self.weather),
            'location': self._parse_json(self.location),
            'share': (self.share_token is not None),
            'created_at': _iso(self.created_at),
            'updated_at': _iso(self.updated_at),
        }
        if include_content:
            result['content'] = self.content
        return result

    def to_public_dict(self):
        """分享页（免登录）只读视图：内容 + 日期 + 心情 + 字数，不含任何管理字段"""
        return {
            'entry_date': self.entry_date,
            'mood': self.mood,
            'word_count': self.word_count,
            'content': self.content,
            'created_at': _iso(self.created_at),
        }

    def _parse_json(self, raw):
        if not raw:
            return None
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return None

    def _parse_tags(self):
        if not self.tags:
            return []
        try:
            return json.loads(self.tags)
        except (json.JSONDecodeError, TypeError):
            return []


def ensure_migrations(engine):
    """
    日记超集升级幂等迁移：存量 diary_diaries 表补列（create_all 不改已有表）。
    新列均有默认值，旧行语义不变（未置顶/未归档/未删除/默认本）。
    """
    inspector = sa_inspect(engine)
    if 'diary_diaries' not in inspector.get_table_names():
        return
    cols = {c['name'] for c in inspector.get_columns('diary_diaries')}
    adds = [
        ('journal_id', 'INTEGER'),
        ('kind', "VARCHAR(10) NOT NULL DEFAULT 'note'"),
        ('pinned', 'BOOLEAN DEFAULT 0'),
        ('archived_at', 'DATETIME'),
        ('deleted_at', 'DATETIME'),
        ('weather', 'TEXT'),
        ('location', 'TEXT'),
        ('share_token', 'VARCHAR(40)'),
        ('share_expires', 'DATETIME'),
    ]
    for name, ddl in adds:
        if name not in cols:
            with engine.begin() as conn:
                conn.execute(text(f'ALTER TABLE diary_diaries ADD COLUMN {name} {ddl}'))
    # 预置日记本（日常/工作/感悟）确保存在；存量无本随记归入"日常"
    with engine.begin() as conn:
        daily_id = None
        for name, emoji, sort in PRESET_JOURNALS:
            row = conn.execute(text('SELECT id FROM diary_journals WHERE name = :n'), {'n': name}).scalar()
            if not row:
                conn.execute(text('INSERT INTO diary_journals (name, emoji, sort) VALUES (:n, :e, :s)'),
                             {'n': name, 'e': emoji, 's': sort})
                if name == '日常':
                    daily_id = conn.execute(text('SELECT id FROM diary_journals WHERE name = :n'),
                                            {'n': name}).scalar()
            elif name == '日常':
                daily_id = row
        if daily_id:
            conn.execute(text('UPDATE diary_diaries SET journal_id = :d WHERE journal_id IS NULL AND kind = :k'),
                         {'d': daily_id, 'k': 'note'})
    idx_existing = {ix['name'] for ix in inspector.get_indexes('diary_diaries')}
    for name, col in [('ix_diaries_deleted', 'deleted_at'),
                      ('ix_diaries_share_token', 'share_token'),
                      ('ix_diaries_journal', 'journal_id')]:
        if name not in idx_existing:
            with engine.begin() as conn:
                conn.execute(text(f'CREATE INDEX {name} ON diary_diaries ({col})'))
