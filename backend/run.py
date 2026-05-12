from app.main import app
from app.config import settings

if __name__ == '__main__':
    print(f"启动 {settings.app_name} v{settings.app_version}")
    print(f"访问地址: http://localhost:{settings.port}")
    app.run(
        host=settings.host,
        port=settings.port,
        debug=settings.debug,
        threaded=True
    )