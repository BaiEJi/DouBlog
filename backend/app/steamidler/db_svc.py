"""steamidler DB 服务层:源 db.py(raw SQLite + RLock)重写为 SQLAlchemy。

- 模型 SteamidlerAccount(表 steamidler_accounts)挂 Doublog app.db.Base,
  存储并入主库(不再有独立 DB 文件)
- 全部方法经 db.session(scoped_session 按线程隔离,天然线程安全——
  路由线程/worker 线程各持各的会话;源版的全局锁因此删除)
- 每次调用自包含:commit(异常 rollback)+ remove,与源版"逐方法 commit"语义
  一致,不在任何线程留下悬挂会话
- 返回值保持源版形状:纯 dict(键=源 accounts 表列名),manager/worker 的
  DB 调用(`manager.db.<方法>`)零改动——本模块即 Manager.db 指向的命名空间
"""
import json
import time

from sqlalchemy import select

from app.db import db

from .models import SteamidlerAccount


def _to_dict(acc: SteamidlerAccount) -> dict:
    return {
        "steamid": acc.steamid,
        "account_name": acc.account_name,
        "avatar_url": acc.avatar_url,
        "refresh_token": acc.refresh_token,
        "shared_secret": acc.shared_secret,
        "idle_appids": acc.idle_appids,
        "auto_resume": acc.auto_resume,
        "farmed_seconds": acc.farmed_seconds,
        "games_cache": acc.games_cache,
        "games_cached_at": acc.games_cached_at,
        "created_at": acc.created_at,
        "updated_at": acc.updated_at,
    }


def _run(fn):
    """同步闭包经 scoped_session 执行;结束 commit(异常 rollback)+ remove。"""
    session = db.session
    try:
        result = fn(session)
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise
    finally:
        db.session.remove()


# ---------- 账号 ----------

def upsert_account(steamid, account_name, refresh_token, avatar_url=""):
    """插入或更新账号(源 ON CONFLICT 语义:avatar_url 仅在非空时覆盖)。"""
    now = time.time()

    def _impl(session):
        acc = session.get(SteamidlerAccount, str(steamid))
        if acc is None:
            session.add(SteamidlerAccount(
                steamid=str(steamid), account_name=account_name,
                refresh_token=refresh_token, avatar_url=avatar_url,
                created_at=now, updated_at=now,
            ))
        else:
            acc.account_name = account_name
            acc.refresh_token = refresh_token
            if avatar_url:
                acc.avatar_url = avatar_url
            acc.updated_at = now

    return _run(_impl)


def list_accounts():
    def _impl(session):
        rows = session.scalars(
            select(SteamidlerAccount).order_by(SteamidlerAccount.created_at)
        ).all()
        return [_to_dict(r) for r in rows]

    return _run(_impl)


def get_account(steamid):
    def _impl(session):
        acc = session.get(SteamidlerAccount, str(steamid))
        return _to_dict(acc) if acc else None

    return _run(_impl)


def delete_account(steamid):
    def _impl(session):
        acc = session.get(SteamidlerAccount, str(steamid))
        if acc:
            session.delete(acc)

    return _run(_impl)


def update_fields(steamid, **fields):
    """按列更新(源版 UPDATE ... WHERE 语义:账号不存在时为无操作)。"""
    if not fields:
        return
    cols = set(SteamidlerAccount.__table__.columns.keys())

    def _impl(session):
        acc = session.get(SteamidlerAccount, str(steamid))
        if not acc:
            return
        for k, v in fields.items():
            if k in cols:
                setattr(acc, k, v)
        acc.updated_at = time.time()

    return _run(_impl)


# ---------- 挂机游戏列表 ----------

def set_idle_appids(steamid, appids):
    update_fields(steamid, idle_appids=json.dumps([int(a) for a in appids]))


def get_idle_appids(steamid):
    acc = get_account(steamid)
    if not acc:
        return []
    try:
        return json.loads(acc.get("idle_appids") or "[]")
    except ValueError:
        return []


def add_farmed(steamid, seconds):
    """累计挂机秒数(worker 每 60s 与退出前调用;账号不存在时为无操作)。"""

    def _impl(session):
        acc = session.get(SteamidlerAccount, str(steamid))
        if acc is not None:
            acc.farmed_seconds = (acc.farmed_seconds or 0) + float(seconds)

    return _run(_impl)
