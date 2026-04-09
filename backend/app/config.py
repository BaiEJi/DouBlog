"""
配置管理

所有配置项集中管理
"""

import os


class Settings:
    """应用配置"""
    
    # 应用信息
    app_name: str = 'DouBlog'
    app_version: str = '1.0.0'
    
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
    
    # Redis 配置（与 CrownFlow 共用同一 Redis 实例）
    redis_url: str = 'redis://:lizy111redis@localhost:50001/0'
    
    # 浏览计数刷盘间隔（分钟）
    view_count_flush_interval: int = 10
    
    # 分页配置
    max_page_size: int = 100
    default_page_size: int = 20


settings = Settings()