# Steamidler 模块（Steam 挂机，2026-10-11 迁入；2026-10-12 自 todo 拆为顶级模块）

> 数据表：steamidler_accounts 单表　路由前缀：/api/steamidler　前端：/steamidler（门户"Steam 挂机"卡直达）　sys_name：doublog.steamidler
> 源 Code/steam-idler（只读）；迁移规范 docs/steamidler-migration.md；后端 `app/steamidler/`；前端 `src/steamidler/`

## 1. 模块契约（app/steamidler/__init__.py）

- 导出 `router`（12 端点，/api/steamidler/*，router 级 require_basic + 信封，处理器保持 sync def）+ `start_background(app)`（启动即恢复已保存账号的挂机 worker，TESTING 空转）；无 ensure_migrations（表由 create_all 直接建）

## 2. 实现要点

- 自研 Steam IAuthenticationService 认证（protobuf 请求体）+ 每账号一个 CM 挂机线程；gevent 限在 worker 线程独立 hub，**禁 monkey.patch_all**——auth.py/worker.py 与源**逐字节一致**（保持可 diff）
- steamidler_accounts：refresh_token/shared_secret 明文存储（源语义）；DB 访问统一 db_svc（scoped_session 逐调用 commit+remove）
- 登录成功经 login/status 去重落库（模块级 `_completed_attempts`）
- Manager 挂 app.state.steamidler_manager（get_manager 懒建，禁模块级单例）+ atexit 尽力 shutdown；日志 mod_logger('steamidler')
- 依赖 steam[client] 1.4.4（gevent 26.x / protobuf 3.20.3 / pycryptodomex）——**protobuf 被 steam[client] 锁 3.20.3，不得引入 protobuf 4+/grpcio**

## 3. 前端（src/steamidler/，6 文件）

SteamIdlerView（统计栏+登录卡+账号网格+弹窗调度，3s 轮询（防重入、后台暂停、游戏名称缓存 60s））+ LoginCard/AccountCard/GamePicker/LogPanel + api.js（apiFetch 信封 unwrap .data）；独立页 SteamIdlerPage（公共 ModuleShell 侧栏，个性色 slate）；kit 组件跨模块引自 `src/todo/kit`；Tailwind 化。

## 4. 测试

tests/steamidler/test_steamidler.py 18 例（登录/worker 全打桩，无真实 Steam 连接）。

## 公共 UI 外壳（2026-10-13）

前端由 `shared/ModuleShell.jsx` 提供统一紧凑可折叠侧栏、多级菜单与内容画布；导航状态经 `useModuleNavigation` 注册。前端仅适配桌面浏览器，无移动端布局。页面内部的业务工具栏、表格、编辑器与弹层仍由模块管理。布局与性能契约见 `frontend.md` 的页面布局约定。
