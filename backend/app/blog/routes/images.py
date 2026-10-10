"""
文件服务 API

提供本地文件读取功能（支持相对路径和绝对路径）。
所有路径统一收敛到项目根目录围栏内，防止路径穿越读取任意文件。
上传接口供编辑器粘贴/拖拽图片使用：随机文件名落盘 data/images/。
"""

import os
import uuid

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from starlette.datastructures import UploadFile

from app.shared.auth import require_basic
from app.shared.response import api_response
from app.config import settings

router = APIRouter(prefix='/api/images')

# 允许提供的文件扩展名白名单
ALLOWED_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif'}

# 上传白名单（去掉 svg：动态内容直接回显有 XSS 风险）
UPLOAD_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif'}
UPLOAD_MAX_BYTES = 10 * 1024 * 1024  # 10MB


@router.post('/upload', dependencies=[Depends(require_basic)])
async def upload_image(request: Request):
    """
    上传图片（multipart 表单字段 file）

    Returns:
        data: { url: '/api/images/<filename>' }  url 可直接写入 Markdown
    """
    form = await request.form()
    file = form.get('file')
    if not isinstance(file, UploadFile) or not file.filename:
        return api_response(None, 400, '缺少文件字段 file')

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in UPLOAD_EXTENSIONS:
        return api_response(None, 400, f'不支持的图片类型 {ext or "(无扩展名)"}，允许：' + ' '.join(sorted(UPLOAD_EXTENSIONS)))

    # Content-Length 可伪造，流式读取时再截断
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > UPLOAD_MAX_BYTES:
        return api_response(None, 400, f'图片超过大小限制 {UPLOAD_MAX_BYTES // 1024 // 1024}MB')
    if size == 0:
        return api_response(None, 400, '空文件')

    os.makedirs(settings.images_dir, exist_ok=True)
    # 扩展名已过白名单校验（固定集合，无注入面）；主名随机 uuid 防碰撞
    filename = f"{uuid.uuid4().hex}{ext}"
    content = await file.read()

    with open(os.path.join(settings.images_dir, filename), 'wb') as f:
        f.write(content)

    return api_response({'url': f'/api/images/{filename}'})


def _resolve_within_fence(base_dir: str, raw_path: str) -> str | None:
    """
    将 raw_path 解析到 base_dir 围栏内的真实路径

    Args:
        base_dir: 允许访问的根目录（realpath 后）
        raw_path: 用户提供的路径，可为绝对路径或相对路径

    Returns:
        str: 围栏内的绝对真实路径；越界或不存在时返回 None
    """
    if os.path.isabs(raw_path):
        candidate = raw_path
    else:
        candidate = os.path.join(base_dir, raw_path)

    real = os.path.realpath(candidate)
    fence = os.path.realpath(base_dir)
    if not (real == fence or real.startswith(fence + os.sep)):
        return None
    return real


async def _serve_image(request: Request, filepath: str):
    """GET 公共逻辑（带路径段与纯 ?path= 两个入口共用）"""
    path_type = request.query_params.get('type', '')
    raw_path = request.query_params.get('path', '') or filepath

    if not raw_path:
        return api_response(None, 404, '文件不存在')

    if path_type == 'absolute':
        base_dir = settings.base_dir
    elif path_type == 'relative':
        base_dir = settings.base_dir
    else:
        base_dir = settings.images_dir

    full_path = _resolve_within_fence(base_dir, raw_path)
    if not full_path or not os.path.isfile(full_path):
        return api_response(None, 404, '文件不存在')

    if os.path.splitext(full_path)[1].lower() not in ALLOWED_EXTENSIONS:
        return api_response(None, 404, '文件不存在')

    # 浏览器缓存 1 小时（图片按文件名寻址；此处避免重复回源校验）
    return FileResponse(full_path, headers={'Cache-Control': 'public, max-age=3600'})


@router.get('/')
async def get_image_at_root(request: Request):
    """
    获取文件（入口 /api/images/，路径经 ?path= 传入）

    Query Parameters:
        path: 文件路径（用于绝对路径，避免 URL 编码问题）
        type: 路径类型
            - 不传: 从 images_dir (data/images/) 查找
            - relative: 从项目根目录查找
            - absolute: 绝对路径（仅允许项目根目录内的路径）

    Returns:
        文件流
    """
    return await _serve_image(request, '')


@router.get('/{filepath:path}')
async def get_image(filepath: str, request: Request):
    """
    获取文件

    Path Parameters:
        filepath: 文件路径（可选，也可通过 query ?path= 传入）

    Query Parameters:
        path: 文件路径（用于绝对路径，避免 URL 编码问题）
        type: 路径类型
            - 不传: 从 images_dir (data/images/) 查找
            - relative: 从项目根目录查找
            - absolute: 绝对路径（仅允许项目根目录内的路径）

    Returns:
        文件流
    """
    return await _serve_image(request, filepath)
