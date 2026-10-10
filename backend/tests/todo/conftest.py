"""todo 模块测试(移植 MyTodo backend/tests 核心用例,适配 Doublog 骨架)。

与 MyTodo 原版的适配点(均为规范 docs/todo-migration.md 允许的骨架差异):
- 响应为 {success,code,message,data} 信封:统一 .json()['data'] unwrap
- 前缀 /api/v1 → /api/todo;鉴权走 Basic(上层 conftest 的 auth_headers)
- 每用例独立临时库 → 原依赖跨用例累积状态的断言改为用例内自备数据
- pydantic body 校验失败出 400(Doublog 全局处理器);服务层校验仍 422
- 丢弃 auth(?token=)/crypto/switch/observability/system 用例(规范舍弃)
"""
import pytest


@pytest.fixture
def client(app, auth_headers):
    """带 Basic 认证头的 client(覆盖上层 conftest 的匿名版,减少逐调用传 headers)。"""
    from fastapi.testclient import TestClient

    c = TestClient(app, raise_server_exceptions=False)
    c.headers.update(auth_headers)
    return c


@pytest.fixture
def cat_id(client):
    """规律生活计划用例的类别(plan 创建必选类型)。"""
    r = client.post('/api/todo/categories', json={'name': '健康', 'color': '#22c55e', 'icon': '🏃'})
    assert r.status_code == 201, r.text
    return r.json()['data']['id']
