"""
文章浏览计数模块

使用 Redis 存储总浏览量，SQLite 作为持久化备份。
Redis 不可用时自动降级到内存计数 + 定时批量写入 SQLite。

Key 格式: DouBlog:view:{post_id}
Value: 整数，文章总浏览量

数据流:
  - 增加浏览: INCR DouBlog:view:{post_id}（原子操作，微秒级）
  - 读取浏览: GET DouBlog:view:{post_id}，未命中时从 SQLite 加载并缓存
  - 定时刷盘: SCAN 所有 key → 批量 UPDATE SQLite（Redis 保持不变，作为 source of truth）
"""

import logging
import threading
from app.redis_client import get_redis
from app.db import db
from app.models.models import Post

logger = logging.getLogger(__name__)

KEY_PREFIX = "DouBlog:view:"

# Redis 不可用时的内存计数器（线程安全）
_memory_counts: dict[int, int] = {}
_memory_lock = threading.Lock()


def _make_key(post_id: int) -> str:
    """
    生成Redis键名

    Args:
        post_id: 文章ID

    Returns:
        str: Redis键名
    """
    return f"{KEY_PREFIX}{post_id}"


def _get_session():
    """获取数据库 session（在 Flask app context 中使用 db.session）"""
    try:
        return db.session
    except Exception:
        from app.database import SessionLocal
        return SessionLocal()


# ─── 写操作 ───────────────────────────────────────────────


def increment_view(post_id: int) -> int:
    """
    原子递增文章浏览计数

    Redis 可用时: INCR（原子操作，无锁竞争）
    Redis 不可用时: 内存计数（不阻塞请求，由 flush_to_db 写入 SQLite）

    Returns:
        递增后的浏览计数
    """
    redis = get_redis()
    if redis:
        return redis.incr(_make_key(post_id))

    # Redis 不可用：内存计数，不写 SQLite（避免并发写锁竞争）
    with _memory_lock:
        _memory_counts[post_id] = _memory_counts.get(post_id, 0) + 1
        return _memory_counts[post_id]



# ─── 读操作 ───────────────────────────────────────────────


def get_view_count(post_id: int) -> int:
    """
    获取文章浏览计数

    优先从Redis读取，未命中时从SQLite加载并缓存到Redis。
    Redis 不可用时合并内存计数 + SQLite 基数。

    Args:
        post_id: 文章ID

    Returns:
        int: 浏览计数
    """
    redis = get_redis()
    if redis:
        key = _make_key(post_id)
        count = redis.get(key)
        if count is not None:
            return int(count)

        sqlite_count = _get_from_sqlite(post_id)
        if sqlite_count > 0:
            redis.set(key, sqlite_count)
        return sqlite_count

    # Redis 不可用：SQLite 基数 + 内存增量
    base = _get_from_sqlite(post_id)
    with _memory_lock:
        return base + _memory_counts.get(post_id, 0)


def _get_from_sqlite(post_id: int) -> int:
    """
    从SQLite获取文章浏览计数
    
    Args:
        post_id: 文章ID
        
    Returns:
        int: 浏览计数，文章不存在返回0
    """
    session = _get_session()
    post = session.query(Post).filter(Post.id == post_id).first()
    return post.view_count if post else 0


def get_all_view_counts(post_ids: list[int]) -> dict[int, int]:
    """
    批量获取多个文章的浏览计数
    
    优先从Redis批量读取，未命中的从SQLite加载。
    
    Args:
        post_ids: 文章ID列表
        
    Returns:
        dict[int, int]: 文章ID到浏览计数的映射
    """
    if not post_ids:
        return {}

    redis = get_redis()
    if not redis:
        return _batch_get_from_sqlite(post_ids)

    keys = [_make_key(pid) for pid in post_ids]
    values = redis.mget(keys)

    result = {}
    missed_ids = []

    for pid, val in zip(post_ids, values):
        if val is not None:
            result[pid] = int(val)
        else:
            missed_ids.append(pid)

    if missed_ids:
        sqlite_counts = _batch_get_from_sqlite(missed_ids)
        result.update(sqlite_counts)
        for pid, count in sqlite_counts.items():
            if count > 0:
                redis.set(_make_key(pid), count)

    return result


def _batch_get_from_sqlite(post_ids: list[int]) -> dict[int, int]:
    """
    从SQLite批量获取文章浏览计数
    
    Args:
        post_ids: 文章ID列表
        
    Returns:
        dict[int, int]: 文章ID到浏览计数的映射
    """
    if not post_ids:
        return {}
    session = _get_session()
    posts = session.query(Post).filter(Post.id.in_(post_ids)).all()
    return {p.id: p.view_count for p in posts}


# ─── 删除操作 ─────────────────────────────────────────────


def delete_view_count(post_id: int):
    """
    删除文章对应的Redis浏览计数
    
    Args:
        post_id: 文章ID
    """
    redis = get_redis()
    if redis:
        redis.delete(_make_key(post_id))


# ─── 刷盘操作（定时任务调用）──────────────────────────────


def flush_to_db():
    """
    将浏览计数批量写入 SQLite

    Redis 可用时：从 Redis SCAN 所有 key → 批量 UPDATE SQLite
    Redis 不可用时：从内存计数器批量 UPDATE SQLite
    """
    redis = get_redis()
    if not redis:
        _flush_memory_to_db()
        return

    cursor = 0
    total_updated = 0

    while True:
        cursor, keys = redis.scan(cursor, match=f"{KEY_PREFIX}*", count=100)

        if keys:
            values = redis.mget(keys)
            updates = {}

            for key, val in zip(keys, values):
                if val is None:
                    continue
                key_str = key.decode() if isinstance(key, bytes) else key
                post_id = int(key_str.replace(KEY_PREFIX, ""))
                updates[post_id] = int(val)

            if updates:
                updated = _batch_update_sqlite(updates)
                total_updated += updated

        if cursor == 0:
            break

    if total_updated > 0:
        logger.info(f"Flushed view counts: {total_updated} posts updated")


def _flush_memory_to_db():
    """将内存计数器中的增量批量写入 SQLite，并重置计数器"""
    with _memory_lock:
        if not _memory_counts:
            return
        # 取出当前计数并重置
        snapshot = dict(_memory_counts)
        _memory_counts.clear()

    if not snapshot:
        return

    # snapshot 是增量，需要累加到 SQLite 已有值
    from flask import has_app_context
    if has_app_context():
        session = db.session
        try:
            for post_id, delta in snapshot.items():
                session.query(Post).filter(Post.id == post_id).update(
                    {"view_count": Post.view_count + delta}
                )
            session.commit()
            logger.info(f"Flushed memory view counts: {len(snapshot)} posts, +{sum(snapshot.values())} views")
        except Exception as e:
            session.rollback()
            # 写入失败，把增量放回计数器
            with _memory_lock:
                for pid, delta in snapshot.items():
                    _memory_counts[pid] = _memory_counts.get(pid, 0) + delta
            logger.error(f"Memory flush failed: {e}")


def _batch_update_sqlite(updates: dict[int, int]) -> int:
    """
    批量更新SQLite中的浏览计数
    
    Args:
        updates: 文章ID到浏览计数的映射
        
    Returns:
        int: 实际更新的文章数量
        
    Raises:
        Exception: 数据库操作失败时抛出异常
    """
    if not updates:
        return 0

    from flask import has_app_context
    if has_app_context():
        session = db.session
        try:
            existing_ids = {
                row[0]
                for row in session.query(Post.id).filter(Post.id.in_(updates.keys())).all()
            }

            updated = 0
            for post_id, count in updates.items():
                if post_id in existing_ids:
                    session.query(Post).filter(Post.id == post_id).update(
                        {"view_count": count}
                    )
                    updated += 1
                else:
                    delete_view_count(post_id)

            session.commit()
            return updated
        except Exception as e:
            session.rollback()
            logger.error(f"Batch update failed: {e}")
            raise
    else:
        from app.database import SessionLocal
        session = SessionLocal()
        try:
            existing_ids = {
                row[0]
                for row in session.query(Post.id).filter(Post.id.in_(updates.keys())).all()
            }

            updated = 0
            for post_id, count in updates.items():
                if post_id in existing_ids:
                    session.query(Post).filter(Post.id == post_id).update(
                        {"view_count": count}
                    )
                    updated += 1
                else:
                    delete_view_count(post_id)

            session.commit()
            return updated
        except Exception as e:
            session.rollback()
            logger.error(f"Batch update failed: {e}")
            raise
        finally:
            session.close()
