"""
数据迁移脚本：迁移到 children_order 方案

步骤：
1. 删除旧数据（blog.db 中的旧表）
2. 重建表结构（含 children_order 字段，无 order 字段）
3. 插入虚拟根节点（id=0）
4. 更新现有根文章的 parent_id 为 0
5. 为所有父节点生成 children_order

用法：
  cd backend && python migrate_children_order.py
"""

import json
import os
import sys

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.main import app
from app.db import db
from app.models.models import Post
from app.utils.tree_order import ROOT_ID, set_children_order


def migrate():
    with app.app_context():
        print("开始迁移...")

        # 1. 检查虚拟根节点是否存在
        root = db.session.query(Post).filter(Post.id == ROOT_ID).first()
        if not root:
            # 插入虚拟根节点
            root = Post(
                id=ROOT_ID,
                title='__root__',
                name='__root__',
                slug='',
                content='',
                parent_id=None,
                level=-1,
                author='system',
                status='published',
                is_top=False,
            )
            db.session.add(root)
            db.session.flush()
            print(f"  插入虚拟根节点 id={ROOT_ID}")

        # 2. 将所有 parent_id IS NULL 的根文章挂到虚拟根下
        root_posts = db.session.query(Post).filter(
            Post.parent_id.is_(None),
            Post.id != ROOT_ID
        ).all()

        if root_posts:
            root_ids = [p.id for p in root_posts]
            set_children_order(root, root_ids)

            for p in root_posts:
                p.parent_id = ROOT_ID

            print(f"  将 {len(root_posts)} 篇根文章挂到虚拟根下: {root_ids}")

        # 3. 为所有有子节点的父节点生成 children_order
        all_posts = db.session.query(Post).filter(Post.id != ROOT_ID).all()

        # 按 parent_id 分组
        children_by_parent = {}
        for p in all_posts:
            pid = p.parent_id
            if pid not in children_by_parent:
                children_by_parent[pid] = []
            children_by_parent[pid].append(p)

        updated_count = 0
        for parent_id, children in children_by_parent.items():
            parent = db.session.query(Post).filter(Post.id == parent_id).first()
            if parent and not parent.children_order:
                # 按 id 排序（与原 order + id 排序一致）
                child_ids = sorted([c.id for c in children])
                set_children_order(parent, child_ids)
                updated_count += 1

        print(f"  为 {updated_count} 个父节点生成了 children_order")

        db.session.commit()
        print("迁移完成！")


if __name__ == '__main__':
    migrate()
