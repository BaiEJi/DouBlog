"""practice 模块测试：client fixture 带 Basic 认证头（上层 conftest 的 app 提供隔离临时库）。"""
import pytest


@pytest.fixture
def client(app, auth_headers):
    from fastapi.testclient import TestClient

    c = TestClient(app, raise_server_exceptions=False)
    c.headers.update(auth_headers)
    return c
