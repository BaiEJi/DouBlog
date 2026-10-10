"""公共层：跨能力共享的响应信封 / 认证依赖 / 并发池注册表 / 时间戳 / 日志装配。"""
from .auth import router as auth_router, require_basic, verify_password  # noqa: F401
