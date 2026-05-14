"""
文件服务 API

提供本地文件读取功能（支持相对路径和绝对路径）
"""

import os
from flask import Blueprint, request, send_file
from app.utils.response import api_response
from app.config import settings

bp = Blueprint('images', __name__, url_prefix='/api/images')


@bp.route('/', methods=['GET'], defaults={'filepath': ''})
@bp.route('/<path:filepath>', methods=['GET'])
def get_image(filepath):
    """
    获取文件

    Path Parameters:
        filepath: 文件路径（可选，也可通过 query ?path= 传入）

    Query Parameters:
        path: 文件路径（用于绝对路径，避免 URL 编码问题）
        type: 路径类型
            - 不传: 从 images_dir (data/images/) 查找
            - relative: 从项目根目录查找
            - absolute: 使用绝对文件系统路径

    Returns:
        文件流
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
        return api_response(None, 404, '文件不存在')

    return send_file(full_path)
