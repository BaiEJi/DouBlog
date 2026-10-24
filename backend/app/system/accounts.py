"""system 模块账号逻辑：密码哈希（PBKDF2-SHA256）+ 播种 + 校验/更新。

- 哈希格式 `pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>`，标准库实现（无新依赖）
- 首次启动（ensure_migrations）：表空时以 config.py 的 auth_username/auth_password 播种
- verify_account：登录/Basic 校验入口（shared/auth.py 延迟导入本函数，避免模块环）
"""
import hashlib
import hmac
import secrets

PBKDF2_ITERATIONS = 200_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS)
    return f'pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}'


def check_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt, expected = stored.split('$')
        if algo != 'pbkdf2_sha256':
            return False
        digest = hashlib.pbkdf2_hmac('sha256', password.encode(),
                                     bytes.fromhex(salt), int(iters))
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, TypeError):
        return False


def seed_if_empty(engine):
    """init_db 钩子：表空时以 config 凭据播种（幂等——已有账号绝不覆盖）"""
    from sqlalchemy.orm import Session

    from app.config import settings
    from app.system.models import SystemAccount

    with Session(engine) as session:
        if session.query(SystemAccount).count() == 0:
            session.add(SystemAccount(username=settings.auth_username,
                                      password_hash=hash_password(settings.auth_password)))
            session.commit()


def verify_account(username: str, password: str) -> bool:
    """Verify the persisted account; storage failures never enable seed defaults."""
    from sqlalchemy.orm import Session

    from app.config import settings
    from app.db import db
    from app.system.models import SystemAccount

    try:
        with Session(db.engine) as session:
            row = session.query(SystemAccount).order_by(SystemAccount.id).first()
    except Exception as error:
        from fastapi import HTTPException
        raise HTTPException(503, '认证存储暂不可用，请稍后重试') from error
    if row is not None:
        return hmac.compare_digest(row.username, username) and check_password(password, row.password_hash)
    return False
