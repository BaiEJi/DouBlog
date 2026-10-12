"""seed:7 个全局默认关系类型(幂等;与源 gamemap seed.py 一致)。

由 app/todo/__init__.py 的 ensure_migrations 调用(init_db 钩子),
commit 由调用方负责。
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import RelationType

DEFAULT_TYPES = [
    ("friend", "朋友", "#52C41A", "solid", False, "双方相互信任"),
    ("enemy", "敌对", "#F5222D", "solid", False, "处于对立状态"),
    ("family", "家人", "#FA8C16", "solid", False, "有血缘或抚养关系"),
    ("lover", "恋人", "#EB2F96", "solid", False, "恋爱关系"),
    ("colleague", "同僚", "#5B8FF9", "solid", False, "同一组织共事"),
    ("mentor", "师徒", "#722ED1", "dashed", True, "传授与学习"),
    ("acquaintance", "认识", "#8C8C8C", "dashed", False, "仅有一面之缘"),
]


def seed_global_relation_types(db: Session):
    existing = {key for (key,) in db.execute(select(RelationType.key)).all()}
    for i, (key, name, color, style, directional, desc) in enumerate(DEFAULT_TYPES):
        if key not in existing:
            db.add(RelationType(game_id=None, key=key, name=name, color=color,
                                line_style=style, directional=directional,
                                default_description=desc, order_index=i))
