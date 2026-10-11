"""
导出 API

GET /api/export/markdown
    把全部知识库导出为 Markdown 文件 zip（备份/迁移用）：

    <知识库>/                 每个知识库一个目录（按树形嵌套）
      ├─ 文章.md             无子文章的文章 → 单文件（YAML frontmatter 保留元数据）
      ├─ 有子文章的文章/     有子文章的文章 → 目录 + index.md + 子文章
      └─ ...
    images/                   全部上传图片
                              正文中的图片 URL 重写为相对 zip 根的 images/ 路径

文件名取文章英文名(name)，非法字符清洗；重名追加 -2/-3。双链 [[...]]
保持源码原样（Obsidian 等工具可直接识别）。
"""

import io
import json
import os
import re
import zipfile
from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from app.db import db, run_db
from app.shared.auth import require_basic
from app.shared.modules import mod_logger
from app.config import settings
from app.blog.models import Post, Workspace
from app.shared.response import api_response

router = APIRouter(prefix='/api/export', dependencies=[Depends(require_basic)])

# 模块日志走 mod_logger：记录级 sys_name=doublog.blog（AGENTS 全局要求）
logger = mod_logger('blog')

# 虚拟根文章的 id（树形结构的顶级占位节点，不属于任何真实内容）
ROOT_POST_ID = 0

# Windows/Linux 文件名非法字符
_ILLEGAL_FN = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
# 正文里指向后端图片接口的引用（绝对 URL 或相对路径），捕获文件名
_IMG_URL_RE = re.compile(r'(?:http://[^/\s]+)?/api/images/([A-Za-z0-9._-]+)')
# Markdown 图片引用（捕获 src 便于重写裸文件名形式）：![alt](src "title"?)
_BARE_IMG_RE = re.compile(r'(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))')


def _safe_name(raw: str) -> str:
    """清洗为安全文件名（去非法字符、控制空白、保留中文）"""
    cleaned = _ILLEGAL_FN.sub('_', (raw or '').strip())
    cleaned = re.sub(r'\s+', ' ', cleaned).strip(' .')
    return cleaned[:80] or 'untitled'


def _rewrite_image_urls(content: str, depth: int, image_files=None) -> str:
    """
    把正文里的图片引用重写为指向 zip 根 images/ 的相对路径。覆盖三种形式：
      1. /api/images/x.png 及绝对后端 URL（编辑器上传插入的规范形式）
      2. 裸文件名 markdown-demo.png（早期文章的相对写法，仅当 images 目录确实有该文件时重写）
    """
    prefix = '../' * depth if depth > 0 else ''
    content = _IMG_URL_RE.sub(lambda m: f'{prefix}images/{m.group(1)}', content)
    if image_files:
        def bare_repl(m):
            src = m.group(2)
            if '/' in src or src.startswith(('images/', 'http', 'data:')):
                return m.group(0)
            if src in image_files:
                return f'{m.group(1)}{prefix}images/{src}{m.group(3)}'
            return m.group(0)
        content = _BARE_IMG_RE.sub(bare_repl, content)
    return content


def _frontmatter(post: Post) -> str:
    """YAML frontmatter，保留系统元数据"""
    lines = ['---',
             'title: "%s"' % post.title.replace('"', "'"),
             'name: %s' % post.name,
             'created_at: %s' % (post.created_at.isoformat() if post.created_at else ''),
             'updated_at: %s' % (post.updated_at.isoformat() if post.updated_at else '')]
    if post.summary:
        summary = post.summary.replace('"', "'").replace('\n', ' ')
        lines.append('summary: "%s"' % summary[:200])
    if post.is_top:
        lines.append('is_top: true')
    lines.append('---')
    return '\n'.join(lines) + '\n\n'


@router.get('/markdown')
async def export_markdown():
    """导出全部知识库为 Markdown zip"""
    def _impl():
        workspaces = db.session.query(Workspace).order_by(Workspace.id).all()
        if not workspaces:
            return api_response(None, 404, '暂无知识库可导出')

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            used_names = set()

            def unique_path(path: str) -> str:
                """同路径重名时追加 -2/-3"""
                if path not in used_names:
                    used_names.add(path)
                    return path
                base, ext = os.path.splitext(path)
                n = 2
                while '%s-%d%s' % (base, n, ext) in used_names:
                    n += 1
                final = '%s-%d%s' % (base, n, ext)
                used_names.add(final)
                return final

            def parse_order(raw):
                try:
                    value = json.loads(raw or '[]')
                    return value if isinstance(value, list) else []
                except (ValueError, TypeError):
                    return []
            # 图片文件清单（裸文件名引用的重写依据 + 打包列表）
            image_files = set()
            if os.path.isdir(settings.images_dir):
                image_files = {f for f in os.listdir(settings.images_dir)
                               if os.path.isfile(os.path.join(settings.images_dir, f))}

            for ws in workspaces:
                ws_dir = unique_path(_safe_name(ws.name))
                # 排除虚拟根(id=0)：存量库里根可能被归入默认知识库，会形成"自己是自己的子节点"导致无限递归
                posts = db.session.query(Post).filter(
                    Post.workspace_id == ws.id, Post.id != ROOT_POST_ID
                ).all()
                by_parent = {}
                for p in posts:
                    by_parent.setdefault(p.parent_id or 0, []).append(p)

                def write_tree(parent_id, dir_path: str, depth: int):
                    if depth > 32:
                        logger.warning('export: parent_id=%s 层级超过 32（数据成环？），跳过', parent_id)
                        return
                    children = by_parent.get(parent_id, [])
                    parent_post = next((p for p in posts if p.id == parent_id), None)
                    order = parse_order(parent_post.children_order) if parent_post is not None else []
                    if not order and parent_id == 0:
                        order = parse_order(ws.children_order)
                    ordered = sorted(
                        children,
                        key=lambda p: (order.index(p.id) if p.id in order else len(order), p.id),
                    )
                    for p in ordered:
                        has_kids = bool(by_parent.get(p.id))
                        base = _safe_name(p.name or p.title)
                        if has_kids:
                            sub_dir = unique_path('%s/%s' % (dir_path, base))
                            file_path = unique_path('%s/index.md' % sub_dir)
                            zf.writestr(file_path,
                                        _frontmatter(p) + _rewrite_image_urls(p.content or '', depth + 1, image_files))
                            write_tree(p.id, sub_dir, depth + 1)
                        else:
                            file_path = unique_path('%s/%s.md' % (dir_path, base))
                            zf.writestr(file_path,
                                        _frontmatter(p) + _rewrite_image_urls(p.content or '', depth, image_files))

                write_tree(0, ws_dir, 0)

            # 图片目录（上传的图片随包带走）
            for fname in sorted(image_files):
                zf.write(os.path.join(settings.images_dir, fname), 'images/%s' % fname)

        buf.seek(0)
        filename = 'doublog-export-%s.zip' % datetime.now().strftime('%Y%m%d-%H%M%S')
        return Response(content=buf.getvalue(), media_type='application/zip',
                        headers={'Content-Disposition': f'attachment; filename={filename}'})
    return await run_db(_impl)
