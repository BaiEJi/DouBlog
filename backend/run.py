"""启动入口：单进程 uvicorn（dev 模式 --reload 监听 app/ 目录，含 _reload_stamp.py）。"""
import os

import uvicorn

from app.config import settings

if __name__ == '__main__':
    print(f"启动 {settings.app_name} v{settings.app_version} (FastAPI/uvicorn)")
    print(f"访问地址: http://localhost:{settings.port}")
    here = os.path.dirname(os.path.abspath(__file__))
    uvicorn.run(
        'app.main:app',
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        reload_dirs=[os.path.join(here, 'app')] if settings.debug else None,
        log_level='info',
    )
