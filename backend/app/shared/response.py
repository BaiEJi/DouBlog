"""API响应格式化工具（FastAPI 版，签名与 Flask 时代一致）"""

from typing import Any

from fastapi.responses import JSONResponse


def api_response(data: Any = None, code: int = 200, message: str = '操作成功') -> JSONResponse:
    """统一API响应格式：{success, code, message, data} + HTTP 状态码（中文不转义）"""
    return JSONResponse(
        {
            'success': 200 <= code < 300,
            'code': code,
            'message': message,
            'data': data,
        },
        status_code=code,
    )
