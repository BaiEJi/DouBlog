"""gamemap 能力包:剧情图谱(gamemap 后端迁入,docs/gamemap-migration.md + docs/modules/gamemap.md)。

- 导出 router(9 组路由,/api/gamemap/*)与 ensure_migrations(7 默认关系类型种子 +
  附件目录 ensure,均幂等);无后台线程——不提供 start_background
- 表 gamemap_* 13 张,挂在 Doublog app.db.Base;建表由骨架 init_db 的 create_all 完成
- 舍弃源版的 /api/db 切换、SDK 日志/异常组件、CORS、SPA 托管与 config.py(Doublog 统一提供)
"""
from .routers import gamemap_router

#: 骨架契约:模块对外暴露单一 router
router = gamemap_router


def ensure_migrations(engine):
    """init_db 钩子:种子 7 默认关系类型(幂等)+ 附件目录 <data_dir>/gamemap_attachments ensure。"""
    import os

    from sqlalchemy.orm import Session

    from .attachments import attachment_dir
    from .seed import seed_global_relation_types

    with Session(engine) as session:
        seed_global_relation_types(session)
        session.commit()

    os.makedirs(str(attachment_dir()), exist_ok=True)


__all__ = ["router", "ensure_migrations"]
