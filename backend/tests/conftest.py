"""
pytest fixtures for DouBlog backend tests

- 每个测试使用独立的临时 SQLite 数据文件（经 settings.data_dir 注入）
- 测试完全自包含：无限流、无 Redis、无外部依赖
  （PG 切换集成测试可选依赖 venv 内的 pgserver，见 test_admin.py）
"""
import pytest


@pytest.fixture
def app(tmp_path, monkeypatch):
    """Create application with an isolated temp database"""
    from app.config import settings

    monkeypatch.setattr(settings, 'data_dir', str(tmp_path))
    monkeypatch.setattr(settings, 'images_dir', str(tmp_path / 'images'))

    from app.main import create_app
    app = create_app()
    app.config['TESTING'] = True

    yield app


@pytest.fixture
def client(app):
    """Test client"""
    return app.test_client()


@pytest.fixture
def auth_headers():
    """Return authentication headers for admin user"""
    import base64
    credentials = base64.b64encode(b"admin:lizy111A").decode('utf-8')
    return {'Authorization': f'Basic {credentials}'}
