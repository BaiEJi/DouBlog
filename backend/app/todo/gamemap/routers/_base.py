"""路由公共小工具(信封化适配层,同 app/todo/routes.py 的模式)。

- _dump:pydantic Out 模型(含嵌套)→ 原生 JSON 结构(信封序列化不再走 FastAPI 管线)
- _guard:同步闭包包装,服务层 HTTPException(code, msg) → 显式错误信封(保留原始文案;
  Doublog 全局 404 处理器会把 detail 覆盖为"资源不存在",必须显式返回保住原文案)
- envelope_body:与 api_response 输出同构的 200 信封字节(响应缓存存取用)
"""
import json

from fastapi import HTTPException
from pydantic import BaseModel

from app.shared.response import api_response


def _dump(x):
    if isinstance(x, BaseModel):
        return x.model_dump(mode="json")
    if isinstance(x, list):
        return [_dump(i) for i in x]
    if isinstance(x, dict):
        return {k: _dump(v) for k, v in x.items()}
    return x


def _guard(fn):
    def inner():
        try:
            return fn()
        except HTTPException as e:
            return api_response(None, e.status_code, str(e.detail))
    return inner


def envelope_body(data) -> bytes:
    """200 成功信封序列化(与 api_response 默认输出一致,供响应缓存)。"""
    return json.dumps(
        {"success": True, "code": 200, "message": "操作成功", "data": data},
        ensure_ascii=False, separators=(",", ":"),
    ).encode("utf-8")
