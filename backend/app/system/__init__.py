"""系统能力包：数据库后端切换（/api/admin/*）+ 登录账号（system_accounts 表）
+ 门户工作台布局（/api/home/layout，system_home_groups/system_home_cards 表）。

三契约：router / 无 start_background / ensure_migrations（空表时以 config 凭据播种账号，
幂等不覆盖——config.py 的 auth_username/auth_password 从此仅为首次默认值）。
"""
from fastapi import APIRouter

from . import models  # noqa: F401  注册 system_accounts 等到 Base.metadata（create_all 前必须导入）
from .home import router as home_router
from .routes import router as admin_router

router = APIRouter()
router.include_router(admin_router)
router.include_router(home_router)

__all__ = ['router']


def ensure_migrations(engine):
    """init_db 钩子：播种登录账号（system_accounts 表由 create_all 建，此处只补数据）"""
    from .accounts import seed_if_empty
    seed_if_empty(engine)
