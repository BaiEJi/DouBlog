"""
定时任务模块

使用 Flask-APScheduler 实现浏览计数定期刷盘。
参考 CrownFlow 的 cron 模式。
"""

import logging

from flask_apscheduler import APScheduler

from app.utils.view_count import flush_to_db

logger = logging.getLogger(__name__)

scheduler = APScheduler()


@scheduler.task('cron', id='flush_view_counts', minute='*/10')
def flush_view_counts_to_db():
    """每 10 分钟将 Redis 浏览计数同步到 SQLite"""
    try:
        logger.info("Starting view count flush")
        flush_to_db()
        logger.info("View count flush completed")
    except Exception as e:
        logger.error(f"View count flush failed: {e}", exc_info=True)
