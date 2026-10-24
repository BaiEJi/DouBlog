# Steamidler 模块（Steam 挂机，2026-10-11 迁入；2026-10-12 自 todo 拆为顶级模块）

> 数据表：steamidler_accounts 单表　路由前缀：/api/steamidler　前端：/steamidler（门户"Steam 挂机"卡直达）　sys_name：doublog.steamidler
> 源 Code/steam-idler（只读）；迁移规范 docs/steamidler-migration.md；后端 `app/steamidler/`；前端 `src/steamidler/`

## 1. 模块契约（app/steamidler/__init__.py）

- 导出 `router`（12 端点，/api/steamidler/*，router 级 require_basic + 信封）+ `start_background(app)`（启动即恢复已保存账号的挂机 worker，TESTING 空转）；同步业务经异步包装提交 `steamidler-api` SDK 池（8 workers），完整网络与 DB 操作保守计入 runtime write admission。无 ensure_migrations（表由 create_all 直接建）。

## 2. 实现要点

- 自研 Steam IAuthenticationService 认证（protobuf 请求体）+ 每账号一个 CM 挂机线程；gevent 限在 worker 线程独立 hub，**禁 monkey.patch_all**——auth.py/worker.py 与源**逐字节一致**（保持可 diff）
- steamidler_accounts：refresh_token/shared_secret 明文存储（源语义）；DB 访问统一 db_svc（scoped_session 逐调用 commit+remove）
- 登录成功经 login/status 在每 Manager 内按 attempt 加锁，落库/worker 成功后才记录完成；失败可重新查询重试
- Manager 挂 app.state.steamidler_manager（get_manager 懒建，禁模块级单例）+ atexit 尽力 shutdown；日志 mod_logger('steamidler')
- 依赖 steam[client] 1.4.4（gevent 26.x / protobuf 3.20.3 / pycryptodomex）——**protobuf 被 steam[client] 锁 3.20.3，不得引入 protobuf 4+/grpcio**

## 3. 前端（src/steamidler/，6 文件）

SteamIdlerView（统计栏+登录卡+账号网格+弹窗调度，3s 轮询（防重入、后台暂停、游戏名称缓存 60s））+ LoginCard/AccountCard/GamePicker/LogPanel + api.js（apiFetch 信封 unwrap .data）；独立页 SteamIdlerPage（公共 ModuleShell 侧栏，个性色 slate）；kit 组件来自 `src/shared/ui/kit`；Tailwind 化。

## 4. 测试

tests/steamidler/test_steamidler.py 18 例（登录/worker 全打桩，无真实 Steam 连接）。

## 公共 UI 外壳（2026-10-13）

前端由 `shared/ModuleShell.jsx` 提供统一侧栏（默认 220px，可拖动/键盘调整 180–420px，可折叠为 56px 图标窄轨；见 docs/modules/frontend.md）、多级菜单与内容画布；导航状态经 `useModuleNavigation` 注册。前端仅适配桌面浏览器，无移动端布局。页面内部的业务工具栏、表格、编辑器与弹层仍由模块管理。布局与性能契约见 `frontend.md` 的页面布局约定。


## 2026-10-21 生命周期与轻量查询

- 认证协议 `auth.py` 和 gevent worker `worker.py` 保持原算法/协议代码；Manager 每 app 隔离，DB 服务包装器每次绑定该 app 的 runtime，worker 不会随创建其他 app 或切库漂移。
- 完成态与完成锁都归属 Manager，重复/并发状态查询只执行一次持久化，存库失败返回 polling/retryable 并保留会话，前端继续轮询并显示重试提示；同 attempt 再次查询可以重试。超过 600s 的会话在新登录、状态查询和账号轮询时批量清理，至多 128 个登录会话。
- worker 按账号串行启动/重启；旧实例在期限内未停就拒绝替换，避免同账号双 worker。线程 start 成功后才发布实例，创建失败可以重试，停止不会 join 未启动线程。shutdown 是全部账号共享一个总期限，不是每账号重复等待；停止失败返回 False 给切库生命周期。
- access token 及游戏库刷新分别按账号单次在途，等待中的同批刷新复用完成结果；游戏库仍保持 1h 服务端缓存。账号轮询只查询公共投影与 shared_secret 是否存在，不读取 refresh_token、共享密钥值或完整 games_cache。
- 退出管理使用弱引用注册表，模块 start/stop 可重入。模块日志归 steamidler。
- 前端账号、登录状态、日志复用单次在途/隐藏暂停/AbortSignal 轮询；账号游戏名称补全每轮最多两个账号，避免只补首个账号或瞬时全量网络请求；通用 UI 直接来自 shared/ui/kit。
- 新 `tests/steamidler/test_steamidler_reliability.py` 7 项验证持久化失败后重试、并发完成一次、重复启动唯一、启动/重启失败后可重试、旧会话批量清理及公共投影不取大字段/密钥。隔离浏览器对 100 个假账号注入 4s 慢响应，确认 3s 轮询不重叠并验收两种主题；假游戏库缓存有效，无真实 Steam 操作。
- 真实 Steam 登录仍需用户账号烟测；本任务仅使用隔离 DB、FakeAttempt/FakeWorker，不声称已连接真实账号。
