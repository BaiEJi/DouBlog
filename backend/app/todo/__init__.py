"""todo 能力包:MyTodo 四象限待办迁移(docs/todo-migration.md + docs/modules/todo.md)。

三契约:router / start_background(启动物化计划)/ ensure_migrations(空库种子类别)。
(gamemap/practice/steamidler 已拆为独立顶级模块,本包只含待办本体)
"""
from fastapi import APIRouter

from .routes import router as _todo_router

router = APIRouter()
router.include_router(_todo_router)


def start_background(app):
    """启动即补齐规律生活计划的任务实例(幂等)。

    app.state.testing 时跳过(测试空转);/today 路由内另有 30s 节流物化兜底。
    """
    if getattr(app.state, "testing", False):
        return
    from sqlalchemy.orm import Session

    from app.db import db
    from app.shared.timeutil import local_today

    from .services import get_settings
    from .services.plans import materialize_plans

    with Session(db.engine) as session:
        tz = get_settings(session)["timezone"]
        materialize_plans(session, local_today(tz), tz)
        session.commit()


def ensure_migrations(engine):
    """init_db 钩子:todo_* 五表由 create_all 直接建(全新表,无列级迁移);空库种子 4 默认类别(幂等)。"""
    from sqlalchemy.orm import Session

    from .seed import seed_if_empty

    with Session(engine) as session:
        seed_if_empty(session)
        session.commit()
