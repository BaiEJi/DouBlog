"""steamidler 子模块:Steam 账号挂机(steam-idler 后端迁入 todo,docs/steamidler-migration.md)。

- 本包导出 steamidler_router(12 端点,/api/todo/steamidler/*),由
  app/todo/__init__.py 组合挂载到 todo 模块 router(骨架契约是单 router)
- 表 steamidler_accounts(单表)挂 Doublog app.db.Base,建表由骨架 init_db
  的 create_all 完成;DB 访问统一 db_svc(SQLAlchemy 重写,源为 raw SQLite)
- auth.py / worker.py 自源逐行照搬(仅包内相对导入,不变);gevent 限在
  worker 线程独立 hub 内(源设计已保证,未引入任何全局补丁)
- 运行态 Manager 挂 app.state.steamidler_manager(get_manager 懒建,禁模块级
  单例);Manager.start() 由 app/todo/__init__.py 的 start_background 调用
  (TESTING 空转),进程退出经 manager.py 的 atexit 钩子尽力 shutdown
- 舍弃源版 main.py(CORS/静态托管由宿主管)与 /health(Doublog 全局提供)
"""
from .routes import router as steamidler_router

__all__ = ["steamidler_router"]
