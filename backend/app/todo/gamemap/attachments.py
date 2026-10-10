"""附件存储:<data_dir>/gamemap_attachments(源版相对 CWD 路径改为 Doublog data_dir)。

目录存在性由 app/todo/__init__.py 的 ensure_migrations 启动时 ensure;
此处 attachment_dir() 每次调用也会幂等 mkdir(测试里 data_dir 随用例切换)。
"""
from pathlib import Path

from app.config import settings


def attachment_dir() -> Path:
    p = Path(settings.data_dir) / "gamemap_attachments"
    p.mkdir(parents=True, exist_ok=True)
    return p
