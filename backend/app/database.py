"""
数据库连接和会话管理
"""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import settings

# 数据库文件路径
DB_PATH = os.path.join(settings.data_dir, 'blog.db')
DATABASE_URL = f'sqlite:///{DB_PATH}'

# 创建引擎
engine = create_engine(
    DATABASE_URL,
    connect_args={'check_same_thread': False},  # SQLite需要此参数
    echo=settings.debug  # 调试模式下打印SQL
)

# 创建会话工厂
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base类
Base = declarative_base()


def init_db():
    """
    初始化数据库
    
    创建数据目录和所有表
    """
    # 确保数据目录存在
    os.makedirs(settings.data_dir, exist_ok=True)
    os.makedirs(settings.images_dir, exist_ok=True)
    
    # 导入所有模型
    from app.models.models import Post, Image
    
    # 创建所有表
    Base.metadata.create_all(bind=engine)
    
    print(f"数据库初始化完成: {DB_PATH}")


def get_db():
    """
    获取数据库会话
    
    用于依赖注入
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def close_db(exception=None):
    """
    关闭数据库连接
    
    用于Flask teardown
    """
    pass