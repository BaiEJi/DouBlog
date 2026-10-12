"""steamidler 能力包:Steam 账号挂机(steam-idler 后端迁入,docs/steamidler-migration.md + docs/modules/steamidler.md)。

- 导出 router(12 端点,/api/steamidler/*)与 start_background(恢复已保存账号的
  挂机 worker);steamidler_accounts 单表由 create_all 直接建——不提供 ensure_migrations
- DB 访问统一 db_svc(SQLAlchemy 重写,源为 raw SQLite);auth.py / worker.py
  自源逐行照搬(仅包内相对导入,不变);gevent 限在 worker 线程独立 hub 内
  (源设计已保证,未引入任何全局补丁)
- 运行态 Manager 挂 app.state.steamidler_manager(get_manager 懒建,禁模块级
  单例);进程退出经 manager.py 的 atexit 钩子尽力 shutdown
- 舍弃源版 main.py(CORS/静态托管由宿主管)与 /health(Doublog 全局提供)
"""
from .routes import router


def start_background(app):
    """恢复所有已保存账号的挂机 worker(app.state.testing 空转;账号为空时无操作)。"""
    if getattr(app.state, "testing", False):
        return
    from .manager import get_manager
    get_manager(app).start()


__all__ = ["router", "start_background"]
