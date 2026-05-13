"""
树状结构排序工具

虚拟根节点 + children_order 数组统一管理所有层级的排序。
"""

import json

ROOT_ID = 0  # 虚拟根节点 ID


def get_children_order(post) -> list[int]:
    """从 Post 对象读取 children_order 数组"""
    if not post.children_order:
        return []
    try:
        return json.loads(post.children_order)
    except (json.JSONDecodeError, TypeError):
        return []


def set_children_order(post, order_list: list[int]):
    """设置 Post 对象的 children_order"""
    post.children_order = json.dumps(order_list)


def append_child(post, child_id: int):
    """将子节点追加到末尾"""
    order = get_children_order(post)
    if child_id not in order:
        order.append(child_id)
        set_children_order(post, order)


def remove_child(post, child_id: int):
    """从子节点列表中移除"""
    order = get_children_order(post)
    order = [x for x in order if x != child_id]
    set_children_order(post, order)


def insert_child(post, child_id: int, after_id: int = None):
    """在指定位置插入子节点"""
    order = get_children_order(post)
    if child_id in order:
        order.remove(child_id)
    if after_id and after_id in order:
        idx = order.index(after_id)
        order.insert(idx + 1, child_id)
    else:
        order.append(child_id)
    set_children_order(post, order)
