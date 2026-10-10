"""时间与 ID 工具:UUIDv7、UTC/本地时区换算。全库时间一律存 UTC(timestamptz)。"""
from __future__ import annotations

import secrets
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def uuid7() -> str:
    """时间有序 UUID(RFC 9562),字符串形式。避免 v4 随机主键打碎 B-tree。"""
    ts_ms = time.time_ns() // 1_000_000
    buf = bytearray(secrets.token_bytes(16))
    buf[0:6] = ts_ms.to_bytes(6, "big")
    buf[6] = (buf[6] & 0x0F) | 0x70  # version 7
    buf[8] = (buf[8] & 0x3F) | 0x80  # variant 10xx
    return str(uuid.UUID(bytes=bytes(buf)))


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def ensure_aware(d: datetime | None) -> datetime | None:
    """naive 视为 UTC,统一为 aware。"""
    if d is None:
        return None
    if d.tzinfo is None:
        return d.replace(tzinfo=timezone.utc)
    return d


def get_zone(tz_name: str) -> ZoneInfo:
    return ZoneInfo(tz_name)


def to_local(d: datetime, tz_name: str) -> datetime:
    d = ensure_aware(d)
    assert d is not None
    return d.astimezone(get_zone(tz_name))


def local_today(tz_name: str) -> date:
    return to_local(now_utc(), tz_name).date()


def local_day_bounds_utc(d: date, tz_name: str) -> tuple[datetime, datetime]:
    """某本地日历日对应的 UTC 区间 [start, end)。"""
    zone = get_zone(tz_name)
    start_local = datetime(d.year, d.month, d.day, tzinfo=zone)
    return start_local.astimezone(timezone.utc), (start_local + timedelta(days=1)).astimezone(timezone.utc)


def parse_date(s: str | None) -> date | None:
    if s is None or s == "" or s == "today":
        return None if s is None or s == "" else None  # "today" 由调用方处理
    return date.fromisoformat(s)


def iso(d: date | datetime | None) -> str | None:
    if d is None:
        return None
    if isinstance(d, datetime):
        return d.isoformat()
    return d.isoformat()
