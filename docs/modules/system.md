# system + shared 模块文档（系统管理 / 公共骨架 / 统一登录）

> 覆盖范围：`backend/app/system/**`、`backend/app/shared/**`、`backend/app/db.py`、`backend/app/main.py`、`backend/app/config.py`，以及对应前端 `frontend/src/config/**`、`frontend/src/app/**`（App 壳 + LoginPage）、`frontend/src/portal/**`、`frontend/src/shared/client.js`；测试 `backend/tests/system/`、`backend/tests/shared/`。
>
> **生成日期：2026-10-10**（依据当日代码现状；统一登录系统已上线；2026-10-12 凭据迁入 system_accounts 表）。

---

## 0. 登录账号存储（system_accounts 表，2026-10-12）

- **表**：`system_accounts`（单行；username + password_hash + updated_at）——凭据从
  `config.py` 硬编码迁入数据库；`config.py` 的 `auth_username/auth_password` 仅作
  **首次播种默认**（system 模块 `ensure_migrations` 空表时写入，幂等不覆盖）与
  system 模块未注册时的中间态回退
- **哈希**：PBKDF2-SHA256（200k 迭代 + 随机盐，`app/system/accounts.py` 标准库实现，
  格式 `pbkdf2_sha256$iters$salt$hash`）；明文不落库不落日志
- **校验**：`shared/auth.verify_password` → 延迟导入 `system.accounts.verify_account`
  （避免 shared↔system 模块环），登录与 Basic 两路即时读表——**改密后旧密码立即失效**
- **管理**：`GET/PUT /api/admin/account`（PUT 验旧密码；username 3-64 位字母数字_-、
  new_password ≥8 位，二者可只改其一）；前端 `/config` 登录账号卡（三输入框 + 保存）
- **会话不失效**：会话 Cookie 是 HMAC 签名（secret_key 仍在 config.py），改密不影响
  已登录设备；需要踢出时改用户名
- **测试**：`tests/system/test_account.py` 12 例（播种/幂等/两路校验/改密改用户名/弱口令与非法用户名拒绝/旧密码错误 401）

---

## 1. 功能概述

| 能力 | 说明 |
|---|---|
| **统一登录与认证** | `POST /api/auth/login`（JSON 或 Basic 头）→ HttpOnly 会话 Cookie `doublog_session`（HMAC-SHA256 签名，30 天）；`require_basic` 依赖 = **Cookie 优先、Basic 兼容**双通道；`POST /api/auth/logout` 清除会话；前端 `/login` 页 + AuthGate 守卫 + 401 兜底重定向 |
| **数据库后端一键切换** | `GET/POST /api/admin/database(/test|/switch)`：SQLite ↔ PostgreSQL **只换连接不迁移数据**，空库自动建表播种，PG 库不存在自动创建，429 防并发切换，dev 模式戳文件触发 uvicorn 重载 |
| **日志上报配置** | `GET/PUT/POST /api/admin/logging(/test)`：各模块 lizysdk 日志外发开关/地址/级别，PUT 即时重装配日志管道；配置落 `data/logs_config.json` |
| **响应信封** | `shared/response.py::api_response`——全站统一 `{success, code, message, data}` JSONResponse（中文不转义） |
| **SDK 并发池注册表** | `shared/pools.py`：`DB_POOL`（doublog-db，16 worker）+ `get_pool(module)` 模块命名池缓存；全站禁止裸 `ThreadPoolExecutor` |
| **时间戳** | `shared/timestamps.py::_iso/_utcnow`：SQLite（naive）与 PG（timestamptz 带偏移）双后端输出一致的序列化 |
| **模块 sys_name 映射** | `shared/modules.py`：请求路径前缀 → 模块名 → `doublog.<module>` 记录级覆盖；mod_logger / 日志上报配置持久化 |
| **应用工厂** | `main.py::create_app`：CORS（凭据模式）+ GZip + 统一异常信封 + 动态模块注册表 + init_db |
| **前端总配置页** | `/config` ConfigPage（账号 / 数据库 / 日志上报）；`/` 门户 15 卡 + 登出；`/login` 登录页；client.js Cookie 化（**不再持有任何凭据**） |

模块注册顺序（`main.py::MODULES`）：`blog → diary → vault → pwsvc → sdklogs → subs → apihub → system → todo → confcenter`；auth 路由（`/api/auth/*`，属 shared 层）在所有模块路由之后单独挂载。

---

## 2. 统一登录系统（2026-10 上线）

### 2.1 会话令牌与 Cookie

- **令牌格式**：`{user}.{exp}.{sig}`
  - `user`：用户名；`exp`：Unix 秒级过期时间（签发时刻 + 30 天）；`sig`：`HMAC-SHA256(secret_key, "{user}.{exp}")` 的 hex
  - 签名密钥 = `settings.secret_key`（`config.py`，默认 dev 值，生产必须更换）
  - 校验：三段拆分 → `int(exp)` 未过期 → `hmac.compare_digest` 常数时间比对签名
- **Cookie 属性**：名 `doublog_session`；`HttpOnly`（JS 不可读，防 XSS 窃取）；`SameSite=Lax`（缓解跨站 CSRF）；`Max-Age` 30 天；`path=/`；**未设 Secure**（本机/内网 HTTP 部署场景）
- Cookie 必须设在**最终返回的 Response 对象**上（`login` 直接构造 `api_response` 返回值再 `set_cookie`——FastAPI 不合并注入参数 Response 的 Set-Cookie）

### 2.2 认证端点（`shared/auth.py`，路由前缀 `/api/auth`）

| 端点 | 行为 |
|---|---|
| `POST /api/auth/login` | 双通道取凭据：优先 JSON body `{username, password}`（前端登录页）；无 JSON 再解析 `Authorization: Basic` 头（兼容 API 工具/curl/既有测试）。验证通过 → 信封 `{username}` + `Set-Cookie doublog_session`；失败 401「认证失败」（无 Cookie） |
| `GET /api/auth/check` | 挂 `require_basic`；返回 `{authenticated: true, username}`。前端 AuthGate 用它探测会话（`credentials: 'include'`） |
| `POST /api/auth/logout` | **无需认证、幂等**：`delete_cookie` 清除会话即 200「已登出」 |

`verify_password(u, p)`：`settings.auth_enabled=False` 时放行（本地免认证模式）；默认 `admin / lizy111A`。

### 2.3 require_basic 双通道依赖（历史名保留）

```
auth_enabled=False → 直接放行
  ↓
请求 Cookie 中 doublog_session 校验通过 → 放行（前端登录态）
  ↓
Authorization: Basic 头解析 + verify_password → 放行（API/SDK/测试通道）
  ↓
否则抛 lizysdk AuthError → main.py 全局处理器 → 401 信封 + WWW-Authenticate: Basic
```

- 免认证端点不变：sdklogs 摄入（`/api/v1/logs(/batch)`）、diary 分享（`/diary/s/:token`）、apihub gw（sk- 令牌）、图片下载
- 旧 Flask 的 `@auth.login_required` 不存在；路由用 `dependencies=[Depends(require_basic)]`

### 2.4 CORS 凭据模式（`main.py`）

```python
CORSMiddleware(
    allow_origin_regex=r'^https?://.*:60101$',   # 收敛为前端端口 60101（dev/preview 同端口）
    allow_credentials=True,                       # 会话 Cookie 跨端口（60101→60100）携带必需
    allow_methods=['GET','POST','PUT','DELETE','OPTIONS'],
    allow_headers=['Content-Type','Authorization'],
)
```

- **凭据模式下不能用通配 `*`**——浏览器规范禁止 `Access-Control-Allow-Origin: *` 与 `Allow-Credentials: true` 共存，必须显式来源；故 `config.py` 里的 `cors_origins: '*'` 已是**死配置**（代码不再读取，见第 7 节）
- 中间件未限 `routes`，作用于全应用（`/api/*` 与 `/`、`/health`）

### 2.5 前端守卫与 401 兜底

- **AuthGate**（`app/App.jsx`）：包裹全部路由。免登录路径 = `/login` 与 `/diary/s/*`；其余路径挂载时 `fetch(API_BASE/api/auth/check, {credentials:'include'})`——`r.ok` 放行、非 ok → `<Navigate to="/login?next=<原路径>">`；**后端不可达时放行**（网络错误不挡页面，由 apiFetch 的 401 兜底接管）。路径变化时重查
- **apiFetch 401 兜底**（`shared/client.js`）：任何请求返回 401 且非 login 接口自身、当前不在 `/login` 页 → `window.location.href = '/login?next=<当前路径>'`（防重定向环）
- **client.js 已 Cookie 化**：`credentials: 'include'`；**不再持有任何 btoa/Basic 凭据**——前端 bundle 中不存在明文密码
- **LoginPage**（`/login`）：JSON 载荷登录；`?next=` 回跳（`//` 开头拒绝，防开放重定向）；失败显示后端 message
- **登出**：门户页右上角按钮 → `POST /api/auth/logout`（fire-and-forget）→ 跳 `/login`
- **vault 主密码解锁 ≠ 登录**：vault 是零知识加密——主密码仅在前端派生/解包 VEK（Argon2id + AES-GCM），服务端只存密文。会话登录解决的是「HTTP API 访问权」，vault 解锁解决的是「密文解密权」，二者独立：已登录会话下 vault 仍需主密码解锁；登出不清除 vault 内存外的任何东西（VEK 本就仅内存，锁屏即丢）

---

## 3. 数据库切换 API（`system/routes.py`，前缀 `/api/admin`，挂 require_basic）

**切换语义**：只更换连接配置（写 `data/db_config.json`）并重启生效，**不迁移数据**——直接读目标库现有数据；空库由 `init_db` 的 create_all 自动建表并播种默认知识库/虚拟根；两侧数据互不影响，随时可切回。

| 端点 | 说明 |
|---|---|
| `GET /api/admin/database` | 当前状态：`backend`、`database_url_masked`（PG 只显示 `@` 之后部分）、`data_dir`、`postgres` 连接配置、`counts`（`posts` **不含虚拟根 id=0**、`audit_logs`）、`running_under_reloader`（= settings.debug）。统计 SQL 用新表名 `blog_posts`/`blog_audit_logs` |
| `POST /api/admin/database/test` | `{target: "sqlite"\|"postgres", postgres?: {host,port,user,password,dbname}}`。sqlite 恒 ok；PG 连接（connect_timeout 3s）成功返回版本串；库不存在时**自动建库**（连 `postgres` 系统库 CREATE DATABASE 后重试），成功提示「连接成功（已自动创建数据库）」；失败 400 含驱动错误首行。**不切换**（但可能已在目标 PG 上建出库） |
| `POST /api/admin/database/switch` | 校验：`target` 合法（否则 400）、与当前不同（否则 400「当前已在使用 xxx」）、模块级 `threading.Lock` 非阻塞抢占（并发切换 → **429「已有切换操作进行中」**）。PG 目标先 `_ensure_postgres_database`（连 `postgres` 系统库查 `pg_database`，不存在则 AUTOCOMMIT `CREATE DATABASE`，再重试连接）；通过后 `save_db_config` 落盘 |

**生效方式**：

- `restart_required = not settings.debug`；dev（uvicorn `--reload` 监听 `app/`）为 `false`，并在**延时 daemon 线程**（等 1s 让响应先送达）touch `app/_reload_stamp.py` 戳文件触发自动重启——与编辑源码触发的重启同一机制（比 `os._exit` 自杀式退出可靠）；戳文件由 `main.py` 顶部 `import app._reload_stamp` 保证进入 reload 监听列表
- 生产模式返回 `restart_required: true`，需手动重启后端
- 引擎重建交给重启后的 `init_db`（切换请求内不重建）

### 日志上报配置三端点

| 端点 | 说明 |
|---|---|
| `GET /api/admin/logging` | `{enabled, url, level, modules: [{module, sys_name}]}`（modules 来自 `ALL_MODULES`） |
| `PUT /api/admin/logging` | 部分更新 `enabled`（必须 bool）/`url`（http(s):// 开头）/`level`（仅 INFO/WARNING）；非法 400。保存落 `data/logs_config.json` 后**立即调 `setup_logging_for_app()` 重装配 lizysdk 管道**（幂等），即时生效 |
| `POST /api/admin/logging/test` | 发一条 WARNING 测试日志（`mod_logger('system')`，sys_name=doublog.system），返回 `{marker}`，到 `/logs` 页搜索 marker 验证链路 |

---

## 4. shared 层逐文件 + db.py + main.py

### shared/__init__.py
导出 `auth_router`（main.py 挂载）、`require_basic`、`verify_password`。

### shared/response.py
`api_response(data=None, code=200, message='操作成功') -> JSONResponse`：`{success: 200<=code<300, code, message, data}` + 同步 HTTP 状态码；中文不转义。全站唯一响应出口。

### shared/auth.py
统一登录系统实现（第 2 节）：`SESSION_COOKIE`/`SESSION_TTL_S`、`verify_password`、`_parse_basic`、`_sign`/`issue_session`/`verify_session`（纯标准库 hmac）、`_session_user`、`_set_session_cookie`/`_clear_session_cookie`、`require_basic` 依赖、`/api/auth/login|check|logout` 三端点。

### shared/pools.py
lizysdk 池注册表：`DB_POOL = create_pool('thread', name='doublog-db', workers=16)`（run_db 专用）；`get_pool(module, workers=None)` 首建缓存（`doublog-<module>` 命名）；`shutdown_pools()` 幂等回收。结构性单写者/调度线程保留 threading，执行体经池。

### shared/modules.py
- `MODULE_BY_PREFIX`：路径前缀 → 模块（`/api/subs` subs、`/api/diary` diary、`/api/vault` vault、`/api/pwsvc` pwsvc、`/api/v1` sdklogs、`/api/admin` system、`/api/apihub` apihub、`/api/todo` todo、`/api/confcenter` confcenter、`/api/auth` **shared**、`/api/workspaces|posts|images|export` blog）；未命中 → main
- `ALL_MODULES`（含 shared/main 共 12 个，管理页下拉数据源）、`MODULES_WITH_DB`（9 个，init_db 调其 `ensure_migrations`）
- `sys_name_for(m)` = `doublog.<m>`；`mod_logger(module)` 返回 `_SysNameAdapter`——**显式持有模块名**注入 `extra.sys_name`（用 logger 名拼前缀会得 `doublog.doublog.x` 双前缀，禁止）
- 日志上报配置：`load_logs_config/save_logs_config`（文件 > 环境默认，`data/logs_config.json`，线程锁保护写）

### shared/timestamps.py
`_iso(dt)`：带时区的 datetime 去掉 tzinfo 输出「本地墙上时间」字符串——SQLite（naive）与 PG（timestamptz）双后端 JSON 输出一致；`_utcnow()`：naive UTC（SQLite 比较用，PG timestamptz 兼容 naive 绑定）。

### shared/logging_setup.py
`setup_logging_for_app()`：lizysdk `setup_logging` 落盘 `data/logs/doublog.log`（INFO+，size 轮转 10MB×5，console），`sys_name='doublog'`，外发按上报配置（send_json/send_url，timeout 1.5s）。**防回环闸门 `_SendGate`**：只放行 WARNING+（级别随配置 INFO/WARNING）且未标记 `no_remote` 的记录；必须在 Filter 里判级别——发送 handler 在 SDK QueueListener 消费端，标准库默认 `respect_handler_level=False` 会无视 `handler.setLevel`。`_SendHandler` 位置兼容两种形态（`_BACKEND.listener.handlers` 或 root.handlers）。

### db.py
- **配置**：`data/db_config.json`（`{backend, postgres:{...}}`）；`load_db_config`（缺失/损坏回退默认）/`save_db_config`/`get_database_url`（sqlite → `<data_dir>/blog.db`；pg → `postgresql+psycopg2://` URL 编码密码）/`SUPPORTED_BACKENDS = ('sqlite','postgres')`
- **Base + query 描述符**：`class Base(DeclarativeBase)` 自带 `_QueryProperty`——`Model.query` ≡ 当前线程 scoped session 的 `query(Model)`（Flask-SQLAlchemy 写法兼容层）
- **db 门面**：`db.engine` / `db.session`（scoped_session 本体：query/add/commit/rollback/get/remove）；`rebuild_engine()` 按 db_config 重建（sqlite：`check_same_thread=False` + `pool_pre_ping`；pg：`pool_size=5, max_overflow=10`）
- **run_db(fn)**：async——同步 fn 提交 `DB_POOL` 执行；**rollback + remove 必须在池工作线程内做**（scoped_session 按线程隔离，事件循环线程清不到工作线程的 session，读事务不 commit 会滞留连接耗尽池）
- **LEGACY_TABLE_MAP**：posts→blog_posts、workspaces→blog_workspaces、audit_logs→blog_audit_logs、diaries→diary_diaries、sdk_logs→sdklogs_logs、sdk_alerts→sdklogs_alerts（旧存在且新不存在才 RENAME，幂等）
- **init_db(app) 顺序**：`rebuild_engine` → **存量 RENAME（必须先于 create_all**——否则 create_all 先建全新空新名表，RENAME 因目标已存在被跳过，存量数据滞留旧表）→ `create_all` → 逐 `MODULES_WITH_DB` 调 `ensure_migrations(engine)` 钩子 → `seed_virtual_root`（id=0 的 Post 行，blog 未注册时容错跳过）→ SQLite 专属：`journal_mode=WAL` **无并发窗口一次设置并校验返回值**（失败抛 RuntimeError）+ 每连接 PRAGMA（busy_timeout=5000 / synchronous=NORMAL / cache_size=-20000 / temp_store=MEMORY）→ 挂 `app.state.engine`

### main.py
- 顶部保证 `app/_reload_stamp.py` 存在并 import（进入 uvicorn reload 监听列表）
- `setup_logging_for_app()` 模块导入期装配日志；`create_app()`：
  1. FastAPI（docs/redoc/openapi 全关）；`app.state.testing`（`DOUBLOG_TESTING=1`）
  2. CORS 凭据模式（第 2.4 节）+ `GZipMiddleware(minimum_size=1024, compresslevel=6)` + 请求级 trace 纯 ASGI 中间件（每请求绑 lizysdk trace_id，日志自动携带；上游带 `X-Trace-Id` 则透传，否则生成并回写响应头）
  3. 四类异常处理器统一信封：`AppError`（lizysdk）→ `{success:False, code:http_status, message, data:{error_code, details}}`，**401 附 `WWW-Authenticate: Basic realm=...`**；`StarletteHTTPException`（404→「资源不存在」、405→「方法不被允许」）；`RequestValidationError`→400「请求参数错误」；未知异常→500「服务器内部错误」+ `exc_info` 日志。错误日志经 `_log_extra` 按路径标注 `sys_name=doublog.<module>`；`/api/v1/logs` 路径额外 `no_remote=True` 防摄入错误自摄回环
  4. 动态模块注册：按 `MODULES` 顺序 importlib 导入（**先注册模型后建表**）；导入失败捕获 WARNING 跳过（中间态可启动）
  5. `init_db(app)` → 逐模块 `include_router(router)` + `start_background(app)`（存在才调）→ `include_router(auth_router)` → `/`（欢迎语）与 `/health`（免认证）

---

## 5. 前端

### ConfigPage（`/config`，`config/ConfigPage.jsx` + `config/api.js`）
全站总配置页；数据库和日志上报统一从此页操作：

- **数据库卡**：状态区（当前后端徽章 SQLite/PostgreSQL、文章数/审计日志计数、掩码连接串 font-mono）；PG 连接参数表单（host/port/dbname/user/密码——密码留空则沿用已存值）；「测试连接」「一键切换到 PostgreSQL」「一键切换回 SQLite」（当前后端按钮禁用置灰）；切换带 confirm（说明只换连接不迁移）；dev 切换后提示自动重启并 3.5s 后重拉状态
- **日志上报卡**：外发启用 checkbox、服务地址、外发最低级别（WARNING/INFO select）、各模块 sys_name chips（font-mono）；「保存」（即时生效）/「发送测试日志」（返回 marker 提示到 /logs 验证）
- `config/api.js` 六函数全走 `shared/client.js::apiFetch`（fetchDbStatus/testDbConnection/switchDatabase/fetchLoggingConfig/saveLoggingConfig/testLoggingSend）；旧独立管理页已移除，`/admin` 地址跳回 `/blog`

### LoginPage（`/login`，`app/LoginPage.jsx`）
全站唯一登录入口：用户名/密码表单 → `POST /api/auth/login`（JSON + `credentials:'include'`）；成功 `navigate(safeNext)`（`?next=` 回跳，`//` 开头拒绝）；401 显示后端 message；网络失败提示后端未启动；主题切换按钮；卡片下方微注（会话 30 天）。

### AuthGate + 应用壳（`app/App.jsx`）
- AuthGate 守卫逻辑见 2.5 节；`PageFallback`（居中细进度条）
- 主题状态：`localStorage['doublog_dark']` > `prefers-color-scheme`；`documentElement.classList.toggle('dark')` + 350ms transitioning 类防闪烁
- 路由表（路由级 lazy）：`/login`、`/`（门户）、`/blog /post/:id(/edit) /create`（blog）、`/diary`、`/diary/s/:token`（免登录分享）、`/vault`、`/logs`、`/apihub`、`/subs/*`、`/config`、`/confcenter`、`/todo/*`
- 全局行为：ScrollToTop（锚点除外）、代码块复制按钮事件委托（clipboard API + execCommand 降级）

### PortalPage（`/`，`portal/PortalPage.jsx`）
15 张系统卡（博客/日记/剧情图谱/待办四象限/刷题/书签/Steam 挂机/订阅管理/密码库/API Hub/系统配置/配置中心/日志查询/Clash 代理/开发者工具箱），桌面 `grid-cols-6`；“管理”卡片已删除，历史 localStorage 分组会过滤旧卡片，同时保留分组名称及其他卡片顺序。卡片分组布局可自定义（默认单组全卡）；头部“工作台”标题 + 主题切换 + 登出按钮（logout 后跳 `/login`）。

### client.js（Cookie 化）
`API_BASE = http://{hostname}:60100`（后端地址全项目唯一持有处）；`apiFetch`：自动 Content-Type（FormData 除外）、`credentials:'include'`、401 统一重定向 `/login?next=`（登录接口与 /login 页排除，防环）。**不含任何凭据/btoa**。

---

## 6. 测试

### tests/system/test_admin.py（9 例）
- 状态 2：GET /api/admin/database 信封与计数；未认证 401
- 连通性 3：sqlite 恒 ok；PG 不可达 400「连接失败」；非法 target 400
- 切换校验 2：同后端 400「当前已在」；不可达 PG 400「无法连接」
- 真实往返 1：`pgserver`（`importorskip` 在 `pg` fixture 内——未装时**只跳过本例**，上方 8 个无 PG 依赖用例照常运行）内嵌 PG——sqlite 造数 → 切 PG（断言响应**无 migrated 字段**、db_config.json 落盘）→ 新 app 绑 PG（空库自动播种默认知识库/0 文章，PG 写一篇）→ 未重启连续切回 → sqlite 原数据原封不动
- 日志上报 1：GET 默认 → PUT 改三项（落盘 + 重读）→ 非法值 400 ×3 → test 发送返回 marker
- 辅助：`_prod_semantics`（debug=False 对齐非 reloader 语义）、`_ensure_count_tables`（blog 未迁移中间态护栏）、`_has_blog_routes`（FastAPI 惰性 _IncludedRouter 展开探针）

### tests/shared/（14 例）
- **test_auth.py（11 例）**：Basic 通道 5（登录成功/无凭据 401/错误凭据 401/check 成功/check 401）+ 会话 6（JSON 登录签发 HttpOnly Cookie；Cookie 登录一次后受保护端点免 Basic；JSON 错误凭据 401 且无 Set-Cookie；logout 清除后 check 401；**篡改令牌 401 且 Basic 通道不受影响**；Basic 兼容通道与既有测试共存）
- **test_logging_integration.py（3 例）**：AppError 异常信封（sdklogs 摄入非法 JSON→400 PARAM_INVALID；token 错→401 CREDENTIALS_ERROR）；自摄回灌（uvicorn 线程伺服本 app 真实 HTTP，WARNING 10s 内可查且 sys_name=doublog、本地文件同步落盘）；no_remote 闸门（摄入路径错误落盘但 /logs 搜不到）

> 本模块域合计 23 例；后端全量当前 429 例（collect-only 实测；AGENTS.md 常用命令注释写 367 已过时，属跨模块文档同步问题）。

---

## 7. 已知边界

1. **Cookie 未设 Secure**：HTTP 内网/本机部署场景刻意为之；公网 HTTPS 部署应补 `secure=True`
2. **secret_key 默认 dev 值**：会话令牌签名密钥，生产不换 = 任何知道默认值者可伪造会话；`config.py` 亦无环境变量注入
3. **无服务端会话撤销**：令牌自包含（user.exp.sig），logout 只清客户端 Cookie——已签发令牌在 30 天内天然有效；改密码/换 secret_key 才能整体失效；无滑动续期
4. **无 CSRF token**：依赖 SameSite=Lax + CORS 来源收敛（:60101）缓解；Lax 不挡顶级导航 GET 与同站请求
5. **`cors_origins` 死配置**：`config.py` 仍保留 `'*'` 但 main.py 改用 `allow_origin_regex` + `allow_credentials`，不再读取该项（易误导，根文档仍列在配置表中）
6. **数据库切换窗口**：切换期间并发写入可能丢失（单用户可忽略）；生产模式需手动重启；测试环境 monkeypatch `debug=False` 模拟非 reloader 语义
7. **require_basic 命名是历史包袱**：实际是「Cookie 优先 + Basic 兼容」统一认证依赖，阅读代码勿望文生义
8. **登录 ≠ vault 解锁**：见 2.5 节；已登录会话对 vault 密文无能为力（零知识设计，服务端无法也不应提供「登录即解锁」）
9. AuthGate 对后端不可达放行（网络错误不挡页面），认证真正裁决在后端 401 + apiFetch 重定向——前端守卫只是体验层
10. `GET /api/admin/database` 返回的 `postgres` 配置**含明文 password**（前端表单不回显、以空占位「留空使用已存密码」，但响应体中可见）；如需收敛应在后端掩码并让 `_merged_cfg` 识别掩码占位，暂列观察项

## 公共 UI 外壳（2026-10-13）

前端由 `shared/ModuleShell.jsx` 提供统一 220px 侧栏、多级菜单与内容画布；导航状态经 `useModuleNavigation` 注册。前端仅适配桌面浏览器，无移动端布局。页面内部的业务工具栏、表格、编辑器与弹层仍由模块管理。布局与性能契约见 `frontend.md` 的页面布局约定。
