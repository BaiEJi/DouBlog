"""系统能力包：数据库后端切换（/api/admin/*）+ 登录账号（system_accounts 表）。

三契约：router / 无 start_background / ensure_migrations（空表时以 config 凭据播种账号，
幂等不覆盖——config.py 的 auth_username/auth_password 从此仅为首次默认值）。
"""
from . import models  # noqa: F401  注册 system_accounts 到 Base.metadata（create_all 前必须导入）
from .routes import router

__all__ = ['router']


def ensure_migrations(engine):
    """init_db 钩子：播种登录账号（system_accounts 表由 create_all 建，此处只补数据）"""
    from .accounts import seed_if_empty
    seed_if_empty(engine)
