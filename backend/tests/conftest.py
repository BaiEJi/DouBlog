"""
pytest fixtures for DouBlog backend tests（FastAPI 版）

- 每个测试使用独立的临时 SQLite 数据文件（经 settings.data_dir 注入）
- 测试完全自包含：无限流、无 Redis、无外部依赖
  （PG 切换集成测试可选依赖 venv 内的 pgserver，见 test_admin.py）
- DOUBLOG_TESTING=1 → app.state.testing=True，各模块后台线程空转
"""
import pytest


@pytest.fixture
def app(tmp_path, monkeypatch):
    """Create application with an isolated temp database"""
    from app.config import settings

    monkeypatch.setattr(settings, 'data_dir', str(tmp_path))
    monkeypatch.setattr(settings, 'images_dir', str(tmp_path / 'images'))
    monkeypatch.setattr(settings, 'logs_send_json', False)   # 测试不外发日志
    # 强制 SQLite：生产默认后端（postgres）不进测试，保持自包含
    monkeypatch.setattr(settings, 'database_backend', 'sqlite')
    monkeypatch.setenv('DOUBLOG_TESTING', '1')

    from app.main import create_app
    application = create_app()

    yield application


@pytest.fixture
def client(app):
    """Test client（FastAPI TestClient，requests 风格 API）

    raise_server_exceptions=False：对齐 Flask 测试客户端行为——
    未处理异常出 500 响应而不是在测试进程里抛栈。
    """
    from fastapi.testclient import TestClient
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def auth_headers():
    """Return authentication headers for admin user"""
    import base64
    credentials = base64.b64encode(b"admin:lizy111A").decode('utf-8')
    return {'Authorization': f'Basic {credentials}'}
