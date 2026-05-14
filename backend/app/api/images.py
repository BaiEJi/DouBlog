"""
图片API

提供图片上传、获取和删除功能
"""

import os
import uuid
from datetime import datetime
from flask import Blueprint, request, send_file
from werkzeug.utils import secure_filename
from app.db import db
from app.models.models import Image
from app.api.auth import auth
from app.utils.response import api_response
from app.utils.audit import log_action
from app.config import settings

bp = Blueprint('images', __name__, url_prefix='/api/images')

# 允许的图片格式
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}

# 最大文件大小（10MB）
MAX_FILE_SIZE = 10 * 1024 * 1024


def allowed_file(filename):
    """
    检查文件格式是否允许
    
    Args:
        filename: 文件名
    
    Returns:
        是否允许
    """
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@bp.route('/upload', methods=['POST'])
@auth.login_required
def upload_image():
    """
    上传图片
    
    Request:
        Content-Type: multipart/form-data
        file: 图片文件
        post_slug: 文章slug（可选）
    
    Returns:
        上传结果
    """
    # 检查是否有文件
    if 'file' not in request.files:
        return api_response(None, 400, '没有上传文件')
    
    file = request.files['file']
    
    # 检查文件名
    if file.filename == '':
        return api_response(None, 400, '没有选择文件')
    
    # 检查文件格式
    if not allowed_file(file.filename):
        return api_response(None, 400, '不支持的文件格式')
    
    # 检查文件大小
    file.seek(0, os.SEEK_END)
    filesize = file.tell()
    file.seek(0)
    
    if filesize > MAX_FILE_SIZE:
        return api_response(None, 400, '文件大小超出限制（最大10MB）')
    
    # 生成文件名
    ext = file.filename.rsplit('.', 1)[1].lower()
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
    unique_id = uuid.uuid4().hex[:8]
    filename = f"{timestamp}_{unique_id}.{ext}"
    
    # 确定存储目录
    post_slug = request.form.get('post_slug', '').strip('/')
    if post_slug:
        save_dir = os.path.join(settings.images_dir, post_slug)
    else:
        save_dir = settings.images_dir
    
    # 创建目录
    os.makedirs(save_dir, exist_ok=True)
    
    # 保存文件
    filepath = os.path.join(save_dir, filename)
    file.save(filepath)
    
    # 相对路径
    relative_path = os.path.join(post_slug, filename) if post_slug else filename
    
    # 保存到数据库（可选）
    session = db.session
    image = Image(
        filename=filename,
        filepath=relative_path,
        filesize=filesize
    )
    session.add(image)
    log_action('create', 'image', image.id, {'filename': filename, 'filepath': relative_path})
    session.commit()
    
    return api_response({
        'filename': filename,
        'filepath': f'/images/{relative_path}',
        'url': f'http://localhost:{settings.port}/api/images/{relative_path}',
        'filesize': filesize
    }, 200, '上传成功')


@bp.route('/', methods=['GET'], defaults={'filepath': ''})
@bp.route('/<path:filepath>', methods=['GET'])
def get_image(filepath):
    """
    获取图片

    Path Parameters:
        filepath: 图片路径（可选，也可通过 query ?path= 传入）

    Query Parameters:
        path: 文件路径（用于绝对路径，避免 URL 编码问题）
        type: 路径类型
            - 不传: 从 images_dir (data/images/) 查找（默认，上传图片）
            - relative: 从项目根目录查找
            - absolute: 使用绝对文件系统路径

    Returns:
        图片文件流
    """
    path_type = request.args.get('type', '')
    raw_path = request.args.get('path', '') or filepath

    if path_type == 'absolute':
        full_path = raw_path
    elif path_type == 'relative':
        full_path = os.path.join(settings.base_dir, raw_path)
    else:
        full_path = os.path.join(settings.images_dir, raw_path)

    if not os.path.isfile(full_path):
        return api_response(None, 404, '图片不存在')

    return send_file(full_path)


@bp.route('/<path:filepath>', methods=['DELETE'])
@auth.login_required
def delete_image(filepath):
    """
    删除图片
    
    Path Parameters:
        filepath: 图片路径
    
    Returns:
        删除结果
    """
    full_path = os.path.join(settings.images_dir, filepath)
    
    if not os.path.exists(full_path):
        return api_response(None, 404, '图片不存在')
    
    # 删除文件
    os.remove(full_path)
    
    session = db.session
    session.query(Image).filter(Image.filepath == filepath).delete()
    log_action('delete', 'image', None, {'filepath': filepath})
    session.commit()

    return api_response(None, 200, '删除成功')