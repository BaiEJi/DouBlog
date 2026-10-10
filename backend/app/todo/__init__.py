"""todo 能力包:MyTodo 四象限待办迁移(docs/todo-migration.md)+ gamemap 子模块(docs/gamemap-migration.md)。

三契约:router / start_background(启动物化计划)/ ensure_migrations(空库种子类别;
含 gamemap 的附件目录 ensure 与 7 默认关系类型种子)。
"""
from fastapi import APIRouter

from .routes import router as _todo_router

# gamemap 子模块(剧情图谱):9 组路由并入 todo 模块 router(骨架契约是单 router)
from .gamemap import gamemap_router

router = APIRouter()
router.include_router(_todo_router)
router.include_router(gamemap_router)


def start_background(app):
    """启动即补齐规律生活计划的任务实例(幂等)。

    app.state.testing 时跳过(测试空转);/today 路由内另有 30s 节流物化兜底。
    """
    if getattr(app.state, "testing", False):
        return
    from sqlalchemy.orm import Session

    from app.db import db

    from .services import get_settings
    from .services.plans import materialize_plans
    from .timeutil import local_today

    with Session(db.engine) as session:
        tz = get_settings(session)["timezone"]
        materialize_plans(session, local_today(tz), tz)
        session.commit()


def ensure_migrations(engine):
    """init_db 钩子:todo_* 五表与 gamemap_* 13 表由 create_all 直接建(全新表,无列级迁移);
    空库时种子 4 默认类别 + gamemap 附件目录 ensure + 7 默认关系类型(均幂等)。"""
    import os

    from sqlalchemy.orm import Session

    from app.config import settings

    from .gamemap.attachments import attachment_dir
    from .gamemap.seed import seed_global_relation_types
    from .seed import seed_if_empty

    with Session(engine) as session:
        seed_if_empty(session)
        seed_global_relation_types(session)
        session.commit()

    # gamemap 附件目录:<data_dir>/gamemap_attachments(启动 ensure 存在)
    os.makedirs(str(attachment_dir()), exist_ok=True)
