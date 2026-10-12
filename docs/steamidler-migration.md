# steam-idler → DouBlog todo 子模块迁移规范

> 源 C:\Users\Lizy\Desktop\Code\steam-idler（只读）。目标：`app/steamidler/`（同 gamemap 子模块模式）。
> 前缀 `/api/steamidler/*`；表 `steamidler_accounts`；前端 `src/steamidler/`。

## 后端（app/steamidler/）

### 可原样搬运（逻辑不动）
- `auth.py`（333 行自研 Steam IAuthenticationService 认证）、`worker.py`（346 行 CM 挂机线程）——与源**逐字节一致**（diff 验证，连 import 都不必改）

### 需要适配
- **`db.py` → `models.py` + `db_svc.py`**：`SteamidlerAccount` 模型（表 `steamidler_accounts`，挂 Doublog `app.db.Base`，列照搬源 accounts 表）在 models.py；DB 方法重写为 db_svc.py（scoped_session 按线程隔离，删除源版的 raw sqlite3+RLock；逐调用 commit/rollback+remove）——DB 文件不再独立，用 Doublog 主库
- **`config.py`**：删除 `BASE_DIR`/`DATA_DIR` 推导（模块无任何落盘路径）；Steam API URL 等外部常量保留
- **`manager.py`**：DB 调用换 db_svc；其余（worker 管理/token 缓存/TOTP/游戏库 API）逻辑不动（仅源版 `print` 换 SDK 日志）；运行态挂 `app.state.steamidler_manager`（`get_manager` 懒建）+ atexit 尽力 shutdown
- **`api.py` → `routes.py`**：prefix `/api/steamidler`；router 级 `Depends(require_basic)` + Doublog 信封 `api_response`；错误 `HTTPException(code,msg)` → `api_response(None,code,msg)`（显式返回保住原始文案，不被全局 404 处理器覆盖）；`/health` 端点舍弃（Doublog 有全局 /health）；处理器保持源版 sync def
- **`main.py` 舍弃**：CORS/静态托管由宿主管
- **后台线程**：`Manager.start()/shutdown()` 对接 `app/todo/__init__.py` 的 `start_background`（TESTING 空转）
- **SDK 接入**：`shared/modules.py` 前缀映射 `/api/steamidler → todo`（已有 /api/todo 覆盖，无需加）；Manager 日志用 `mod_logger('todo')`

### 端点映射（源 /api/X → Doublog /api/steamidler/X）
login/begin, login/code, login/status, accounts, accounts/{steamid}, accounts/{steamid}/log, accounts/{steamid}/games, accounts/{steamid}/idle, accounts/{steamid}/stop, accounts/{steamid}/shared_secret, accounts/{steamid}/auto_resume, meta

### 依赖
`steam[client]>=1.4.0`（拖入 gevent/protobuf 3.20/pycryptodomex）——**主线安装**，代理不动 requirements.txt。protobuf ~=3.0 与 DouBlog 现有依赖无冲突（已核查）。

### 红线
- **禁止 `gevent.monkey.patch_all()`**（会毁掉 asyncio/requests）；gevent 限在 worker 线程独立 hub 内（源设计已保证）
- 不跨线程直接调 SteamClient 方法（保持命令队列隔离）
- refresh_token/shared_secret 的存储语义不变（明文存 DB——加密属后续优化）

## 前端（frontend/src/steamidler/）

- 搬 4 组件（LoginCard/AccountCard/GamePicker/LogPanel）+ App 改为 `SteamIdlerView`
- `api.js`：改 `apiFetch('/api/steamidler'+path)` + 信封 unwrap `.data`
- **样式**：源 `styles.css` 全局 CSS → 收敛到组件容器作用域（改写 `body`/`#root` 选择器为模块根 class），或换 Tailwind（推荐——遵循 ui-baseline）
- 页面结构：统计栏 + 登录卡 + 账号卡网格 + 弹窗（游戏选择/日志）；3 秒轮询 `/api/steamidler/accounts`
- TodoPage 顶栏 Tab 加"挂机"入口（或作为图谱旁的独立 Tab）

## 测试（backend/tests/steamidler/test_steamidler.py，18 例）

- CRUD 路径：accounts 列表/删除 + upsert 头像语义（真实 db_svc，无 worker 不连 Steam）
- 登录流程：begin → code → status 状态机（Fake LoginAttempt 注入/打桩 LoginAttempt，`code_type` 缺省与显式 null 均走类型推断）；成功落库去重（头像抓取/worker 重启打桩）
- 配置端点：shared_secret/auto_resume/idle 校验写读；games/log 端点（manager 打桩）；快照合并 worker 状态
- Manager 生命周期：app.state 挂载、start 恢复账号（打桩 AccountWorker）、TESTING 空转
- 鉴权 401、信封形状
- **不做真实 Steam 连接测试**（CI 不依赖外网）

## 验收
pytest 全绿 + build 零报错 + 真实服务冒烟（/api/steamidler/meta 200 + accounts 空列表）
