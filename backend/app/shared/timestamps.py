"""统一时间戳序列化（原 app/models/models.py 的 _iso/_utcnow）。"""

from datetime import datetime, timezone


def _iso(dt):
    """
    统一时间戳序列化：去掉时区偏移，输出"本地墙上时间"字符串。
    SQLite 返回 naive datetime，PG(timestamptz) 返回带偏移的 datetime，
    归一化后两个后端的 JSON 输出完全一致。
    """
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt.isoformat()


def _utcnow():
    """naive UTC 当前时间（SQLite 比较用；PG timestamptz 兼容 naive 绑定）"""
    return datetime.now(timezone.utc).replace(tzinfo=None)
