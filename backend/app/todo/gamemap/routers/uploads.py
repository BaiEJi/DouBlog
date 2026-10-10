"""上传与静态文件路由。

- POST /api/todo/gamemap/uploads:图片上传(白名单 png/jpg/jpeg/webp/gif——按迁移规范,
  源版的 avif/bmp 不再接受;UUID 文件名;≤10MB),返回 /api/todo/gamemap/files/ URL
- GET  /api/todo/gamemap/files/{name}:附件静态服务(FileResponse + realpath 目录围栏,
  替代源版 StaticFiles 挂载;免认证——同 Doublog 图片下载豁免,源版静态目录亦无鉴权)
"""
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.response import api_response

from .. import cache as response_cache
from ..attachments import attachment_dir
from ..models import Attachment
from ._base import _guard

router = APIRouter(prefix="/api/todo/gamemap", tags=["gamemap-uploads"])

ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
MAX_SIZE = 10 * 1024 * 1024  # 10MB

_FILES_URL = "/api/todo/gamemap/files/"


@router.post("/uploads", dependencies=[Depends(require_basic)])
async def upload_image(file: UploadFile):
    """上传图片（头像等），返回可直接访问的 URL。"""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"仅支持图片格式: {', '.join(sorted(ALLOWED_EXT))}")
    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(400, "图片不能超过 10MB")

    name = f"{uuid.uuid4().hex}{ext}"
    dest = attachment_dir() / name
    dest.write_bytes(content)

    def _impl():
        session = db.session
        att = Attachment(file_path=str(dest), file_name=file.filename or name,
                         content_type=file.content_type or "")
        session.add(att)
        session.commit()
        session.refresh(att)
        response_cache.invalidate_all()
        return api_response({"url": f"{_FILES_URL}{name}", "attachment_id": att.id})
    return await run_db(_guard(_impl))


@router.get("/files/{name}")
async def get_file(name: str):
    """附件静态服务：目录围栏 + 扩展名白名单，未命中一律 404 信封。"""
    base = attachment_dir()
    candidate = os.path.join(str(base), name)
    real = os.path.realpath(candidate)
    fence = os.path.realpath(str(base))
    if not real.startswith(fence + os.sep) or not os.path.isfile(real):
        return api_response(None, 404, "文件不存在")
    if os.path.splitext(real)[1].lower() not in ALLOWED_EXT:
        return api_response(None, 404, "文件不存在")
    # 文件名含 UUID 内容不可变,长缓存(源版中间件同款头)
    return FileResponse(real, headers={"Cache-Control": "public, max-age=86400, immutable"})
