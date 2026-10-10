"""
配置管理

所有配置项集中管理。
数据库后端在运行时由 data/db_config.json 决定（由 /api/admin/database/switch 维护），
此处仅提供默认值。
"""

import os


class Settings:
    """应用配置"""

    # 应用信息
    app_name: str = 'DouBlog'
    app_version: str = '1.1.0'

    # 服务器配置
    host: str = '0.0.0.0'
    port: int = 60100
    debug: bool = True

    # 安全配置
    secret_key: str = 'dev-secret-key-change-in-production'

    # CORS配置
    cors_origins: str = '*'

    # 认证配置
    auth_enabled: bool = True
    auth_username: str = 'admin'
    auth_password: str = 'lizy111A'

    # 数据目录
    base_dir: str = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    data_dir: str = os.path.join(base_dir, 'data')
    images_dir: str = os.path.join(data_dir, 'images')

    # 数据库后端默认值：'sqlite' | 'postgres'（实际以 data/db_config.json 为准）
    database_backend: str = 'sqlite'

    # PostgreSQL 连接默认值（切换时可在请求体中覆盖）
    postgres_host: str = 'localhost'
    postgres_port: int = 5432
    postgres_user: str = 'postgres'
    postgres_password: str = ''
    postgres_dbname: str = 'doublog'

    # 分页配置
    max_page_size: int = 100
    default_page_size: int = 20

    # ── 订阅管理模块（subs，CrownFlow 迁移）────
    subs_base_currency: str = 'CNY'          # 支出统计折算基准币
    subs_exchange_rates: dict = {            # 静态汇率（相对基准币）
        'CNY': 1.0, 'USD': 7.0, 'EUR': 10.0, 'GBP': 9.0, 'JPY': 0.05,
    }
    subs_default_reminder_days: int = 7      # 新会员默认提前提醒天数
    subs_backup_retention_days: int = 90     # 备份保留期（天）
    subs_backup_enabled: bool = os.environ.get('SUBS_BACKUP_ENABLED', '1') != '0'  # 每日 02:00 自动备份

    # ── 日志接收模块（sdklogs，lizysdk send_json 的服务端）────
    # 环境变量名与 lizylog 设计文档保持一致（LOGSDB_*）
    logs_incoming_tz: str = os.environ.get('LOGSDB_INCOMING_TZ', 'Asia/Shanghai')  # 无时区时间戳的解释时区
    logs_retention_days: int = int(os.environ.get('LOGSDB_RETENTION_DAYS', '30'))  # 0=永久
    logs_auth_token: str = os.environ.get('LOGSDB_AUTH_TOKENS', '')                # 空=摄入端不鉴权
    logs_batch_size: int = int(os.environ.get('LOGSDB_BATCH_SIZE', '500'))
    logs_flush_ms: int = int(os.environ.get('LOGSDB_FLUSH_MS', '500'))
    logs_queue_max: int = int(os.environ.get('LOGSDB_QUEUE_MAX', '10000'))
    # DouBlog 自身日志接入 lizysdk：落盘 data/logs/，WARNING+ 回灌自己的 /api/v1/logs（测试中关闭）
    logs_send_json: bool = os.environ.get('DOUBLOG_LOG_SEND', '1') != '0'
    logs_send_url: str = os.environ.get('DOUBLOG_LOG_SEND_URL', f'http://127.0.0.1:{port}/api/v1/logs')


settings = Settings()
