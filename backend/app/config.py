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


settings = Settings()
