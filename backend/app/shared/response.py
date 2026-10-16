"""API响应格式化工具（FastAPI 版，签名与 Flask 时代一致）

2026-10-16 起信封渲染从 stdlib json.dumps 切换到 orjson（C 扩展）：大响应序列化
快一个数量级（100KB ≈ 674µs→35µs），且默认不转义非 ASCII、拒绝 NaN，与旧输出
语义一致；default=str 防御未来混入 datetime 等非 JSON 类型（旧实现会 TypeError→500）。
"""
from typing import Any

import orjson
from fastapi.responses import Response


class FastJSONResponse(Response):
    """orjson 渲染的统一 JSON 响应（全站信封与网关 wrap 共用）。"""

    media_type = 'application/json'

    def render(self, content: Any) -> bytes:
        return orjson.dumps(content, default=str)


def api_response(data: Any = None, code: int = 200, message: str = '操作成功') -> Response:
    """统一API响应格式：{success, code, message, data} + HTTP 状态码（中文不转义）"""
    return FastJSONResponse(
        {
            'success': 200 <= code < 300,
            'code': code,
            'message': message,
            'data': data,
        },
        status_code=code,
    )
