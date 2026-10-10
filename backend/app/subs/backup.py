"""
订阅模块数据库备份（CrownFlow 迁移，适配 DouBlog 布局）

- 备份当前 SQLite 数据库文件（WAL 模式下用 sqlite3 backup API 保证一致性快照）到
  data/backups/subs_YYYYMMDD_HHMMSS.db；PostgreSQL 后端时跳过（返回 skipped）
- 过期备份自动清理（subs_backup_retention_days，默认 90 天）
- 备份列表/统计供 GET /api/subs/backup 展示
"""

import os
import sqlite3
from datetime import datetime, timedelta

from app.config import settings
from app.db import load_db_config
from app.shared.modules import mod_logger

# lizysdk 记录级 sys_name 覆盖（doublog.subs）：每日备份线程的日志随 SDK 格式器
# 自然携带 trace/上下文；后台线程无请求上下文，sys_name 是模块归属的唯一标注
logger = mod_logger('subs')


def backup_dir() -> str:
    path = os.path.join(settings.data_dir, 'backups')
    os.makedirs(path, exist_ok=True)
    return path


def _current_sqlite_path():
    """当前 SQLite 库文件路径；postgres 后端返回 None"""
    cfg = load_db_config()
    if cfg['backend'] != 'sqlite':
        return None
    return os.path.join(settings.data_dir, 'blog.db')


def backup_database() -> dict:
    """
    备份当前 SQLite 数据库（WAL 一致性快照）。

    Returns:
        {'status': 'ok', 'path': …, 'size': …} 或 {'status': 'skipped', 'reason': …}
    """
    src = _current_sqlite_path()
    if src is None:
        return {'status': 'skipped', 'reason': '当前为 PostgreSQL 后端，跳过文件备份'}
    if not os.path.isfile(src):
        return {'status': 'skipped', 'reason': f'数据库文件不存在: {src}'}

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    dst = os.path.join(backup_dir(), f'subs_{timestamp}.db')
    try:
        # WAL 模式下直接 copy 可能丢 -wal 内容；backup API 产出完整一致快照
        with sqlite3.connect(src) as source:
            with sqlite3.connect(dst) as target:
                source.backup(target)
        size = os.path.getsize(dst)
        logger.info(f'subs 备份成功: {dst} ({size} 字节)')
        cleanup_old_backups()
        return {'status': 'ok', 'path': os.path.basename(dst), 'size': size}
    except Exception as e:  # noqa: BLE001 备份失败不阻断业务
        logger.error(f'subs 备份失败: {e}', exc_info=True)
        try:
            if os.path.isfile(dst):
                os.remove(dst)
        except OSError:
            pass
        return {'status': 'error', 'reason': str(e)}


def cleanup_old_backups() -> int:
    """删除超过保留期的备份文件，返回删除数"""
    cutoff = datetime.now() - timedelta(days=settings.subs_backup_retention_days)
    deleted = 0
    try:
        for name in os.listdir(backup_dir()):
            if not (name.startswith('subs_') and name.endswith('.db')):
                continue
            path = os.path.join(backup_dir(), name)
            try:
                if datetime.fromtimestamp(os.path.getmtime(path)) < cutoff:
                    os.remove(path)
                    deleted += 1
            except OSError:
                continue
    except OSError:
        pass
    return deleted


def list_backups() -> list:
    """备份文件列表（新→旧）"""
    items = []
    try:
        for name in os.listdir(backup_dir()):
            if not (name.startswith('subs_') and name.endswith('.db')):
                continue
            st = os.stat(os.path.join(backup_dir(), name))
            items.append({
                'name': name,
                'size': st.st_size,
                'size_mb': round(st.st_size / (1024 * 1024), 2),
                'created_at': datetime.fromtimestamp(st.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
            })
    except OSError:
        pass
    items.sort(key=lambda x: x['created_at'], reverse=True)
    return items


def backup_stats() -> dict:
    """备份统计：总数/总大小/最新最旧"""
    items = list_backups()
    total_size = sum(i['size'] for i in items)
    return {
        'total_count': len(items),
        'total_size': total_size,
        'total_size_mb': round(total_size / (1024 * 1024), 2),
        'retention_days': settings.subs_backup_retention_days,
        'oldest_backup': items[-1]['created_at'] if items else None,
        'newest_backup': items[0]['created_at'] if items else None,
        'backups': items,
    }
