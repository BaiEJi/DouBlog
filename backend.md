# DouBlog 后端架构文档

> **技术栈**: FastAPI 0.143 + uvicorn（单进程）+ SQLAlchemy 2.0 + SQLite(WAL) / PostgreSQL(psycopg2)；日志/异常/并发池统一走 lizysdk
> **端口**: 60100　**入口**: `backend/run.py`（uvicorn，dev 模式 `--reload` 监听 `app/`）
> **本文档描述当前代码的真实架构，与 `backend/app/` 一一对应；修改代码时必须同步更新本文档**（见 `AGENTS.md` 文档同步规则）
> Flask→FastAPI 迁移规范（骨架契约/移植对照/表名映射）见 `docs/fastapi-migration.md`；Flask 原版快照存于 `backend/tools/flask-snapshot/`（只读对照）

---

## 目录

- [1. 概述](#1-概述)
- [2. 目录结构](#2-目录结构)
- [3. 数据库设计（双后端与切换）](#3-数据库设计双后端与切换)
- [4. 树形结构设计](#4-树形结构设计)
- [5. Slug 计算策略](#5-slug-计算策略)
- [6. 浏览计数](#6-浏览计数)
- [7. 应用工厂与中间件](#7-应用工厂与中间件)
- [8. 认证](#8-认证)
- [9. 图片服务与安全围栏](#9-图片服务与安全围栏)
- [10. 配置](#10-配置)
- [11. 测试](#11-测试)
- [12. 已知限制](#12-已知限制)

---

## 1. 概述

单用户博客后端，提供文章树形 CRUD、图片服务、浏览计数与操作审计。核心设计决策：

| 决策 | 说明 |
|---|---|
| PG 默认 + SQLite 可切换 | PostgreSQL（117.72.98.99:50002/app_dev）默认；SQLite(WAL) 经配置页/API 一键切换（只换连接读目标库现有数据），配置持久化于 `data/db_config.json` |
| 知识库（Workspace） | 文章的顶层分组：库间数据隔离、name 库内唯一、顶级排序存在 `workspaces.children_order` |
| 无外部依赖 | 浏览计数实时写库；无限流、无 Redis、无定时任务 |
| 虚拟根节点 | id=0 的特殊行统一管理顶级文章的父子关系与排序 |
| 正文按需传输 | 列表/树接口不含 `content`，只有详情接口返回全文 |
| 单次查询内存计算 | slug 映射、树组装、子孙判定均为"一次取 id/name/parent_id + 内存回溯"，避免 N+1 |

## 2. 目录结构

```
backend/
├── run.py                     # 启动入口：uvicorn.run('app.main:app', 60100, dev 模式 --reload)
├── requirements.txt           # 全部依赖（fastapi/uvicorn/python-multipart + psycopg2-binary）
├── app/
│   ├── main.py                # FastAPI 应用工厂：CORS/GZip/统一异常信封 + 动态模块注册（未迁移模块跳过可启动）
│   ├── config.py              # Settings 类（见第 10 节）
│   ├── db.py                  # 纯 SQLAlchemy 2.0：Base(带 Model.query 描述符) + scoped session + run_db(SDK 线程池)
│   │                          #   + 双后端初始化 + 表名规范(模块名_表名, 存量自动 RENAME) + 模块 ensure_migrations 钩子 + WAL PRAGMA + 虚拟根播种
│   ├── shared/                # 公共层（跨能力共享，骨架的一部分）
│   │   ├── response.py        # api_response 统一信封（FastJSONResponse=orjson 渲染，大响应 ~18×）
│   │   ├── yamlfast.py        # PyYAML libyaml C 实现统一入口（CSafeLoader/Dumper，未编译自动回退）
│   │   ├── auth.py            # require_basic 依赖 + /api/auth/*（能力包统一 Depends(require_basic)）
│   │   ├── pools.py           # lizysdk 并发池注册表：get_pool(module) / DB_POOL / shutdown_pools
│   │   ├── timestamps.py      # _iso / _utcnow（双后端时间序列化）
│   │   └── logging_setup.py   # lizysdk 日志装配（自摄 + 防回环三闸）
│   ├── blog/                  # 博客/知识库能力（含子域：assets 资产库 / diary 日记 / bookmarks 书签）
│   │   ├── models.py          # Workspace / Post / AuditLog（blog_posts/blog_workspaces/blog_audit_logs）
│   │   ├── routes/            # posts / images / workspaces / export
│   │   └── services/          # tree_order（children_order+ROOT_ID）/ view_count / audit / migrations(列级迁移钩子)
│   │   ├── diary/             # 日记子域：models(diary_diaries) + routes + ensure_migrations（2026-10-17 并入）
│   ├── vault/                 # 密码库（零知识）：models + routes
│   ├── pwsvc/                 # 密码服务（轮换密码）：models + routes（derive/限流/日志）+ ensure_migrations
│   ├── sdklogs/               # 日志接收（lizysdk 服务端）：models(sdklogs_*) + routes（写者线程/死信/保留）
│   ├── subs/                  # 订阅管理（CrownFlow 迁移）：models + routes（每日备份/支出摘要线程）
│   ├── apihub/                # API Hub（统一 API 网关）：models/core/pool/http连接池/state/routes
│   ├── todo/                  # 四象限待办（MyTodo 迁入）
│   ├── gamemap/               # 剧情图谱（gamemap 迁入）：13 表 + routers 9 组 + response_cache
│   ├── practice/              # 刷题记录：题目/解法/复习 + 抓题适配器（时区设置复用 todo.services）
│   ├── steamidler/            # Steam 挂机：账号管理 + Manager（gevent 限 worker 线程独立 hub）
│   ├── confcenter/            # 配置中心：独立 namespace + KV + 幂等回填 + Redis 读穿缓存
│   ├── clash/                 # Clash 代理管理：clashctl 全能力 Web 迁移（service 复用 bash 函数 + routes；无表）
│   ├── devtoolbox/            # 开发者工具箱：纯计算端点（哈希/字符集互转/JSON⇄YAML/二维码；无表无后台）
│   └── system/                # 系统管理：routes（数据库后端切换 /api/admin/*）
└── tests/                     # 与能力包镜像：shared/ blog/（含 assets·diary·bookmarks 子域）vault/ pwsvc/ sdklogs/ subs/ system/ confcenter/ clash/ devtoolbox/ todo/ gamemap/ practice/ steamidler/ + test_apihub_*.py
```

**模块包对外契约**（main.py 动态注册表按此发现模块）：`app/<mod>/__init__.py` 导出 `router`（APIRouter）、可选 `start_background(app)`（后台线程，`app.state.testing` 时空转）、可选 `ensure_migrations(engine)`（列级幂等迁移，init_db 在存量表改名后调用）。模块运行态挂 `app.state.<mod>`（禁止模块级单例——测试每例新建 app）。

**请求执行模型**：DB 端点一律 `async def` + `return await run_db(_impl)`——同步 SQLAlchemy 逻辑提交到共享 SDK 线程池 `doublog-db` 执行，任务结束（含异常）在工作线程内 `rollback()+remove()` scoped session（清理必须在工作线程内做，等待方清理清不到工作线程的 session）。

## 3. 数据库设计

### 3.1 Workspace 模型（`app/blog/models.py`）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | Integer PK | 自增 |
| `name` | String(100) | 名称，全局唯一 |
| `description` | String(500) | 描述 |
| `children_order` | Text | **该库顶级文章顺序** JSON（子级顺序仍在 Post 上） |
| `created_at` / `updated_at` | DateTime | 时间戳 |

### 3.2 Post 模型（`app/blog/models.py`）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | Integer PK | 自增；**id=0 保留给虚拟根** |
| `title` / `name` / `slug` | String | name 库内唯一（应用层校验）且建索引；slug 为完整路径 |
| `content` / `summary` | Text | 正文 / 摘要 |
| `workspace_id` | FK→workspaces.id | 所属知识库；存量数据由迁移自动回填 |
| `parent_id` | FK→posts.id, SET NULL | 父文章；顶级文章指向虚拟根 `0` |
| `level` | Integer | 0~2（`MAX_LEVEL = 2`，共 3 层） |
| `children_order` | Text | JSON 数组如 `[3,1,5]`，本节点子文章的自定义顺序 |
| `status` / `is_top` / `author` | | `published|archived` / 置顶 / 固定 admin |
| `view_count` | Integer | 浏览计数（实时写库） |
| `tags` / `meta_data` | Text | JSON |
| `created_at` / `updated_at` | DateTime | `server_default=now()`，updated_at 带 `onupdate` |

序列化方法：

- `to_dict(include_content=True)`：全量；**列表接口传 `False` 剔除正文**
- `to_tree_dict()`：树节点专用，**恒不含 `content`**，附空 `children` 数组

### 3.2b AuditLog 模型

`action`（create/update/delete）、`resource_type`（post/image/workspace）、`resource_id`、`detail`(JSON)、`ip_address`、`created_at`。由 `app/blog/services/audit.py::log_action` 写入，**不单独 commit，跟随主操作事务**。只增不删（无清理策略）。

### 3.3 表名规范与存量迁移（`db.py`，幂等）

**表名规则：`模块名_表名`**（所有模块同库存储）：`blog_posts` / `blog_workspaces` / `blog_audit_logs` / `diary_diaries` / `diary_journals` / `sdklogs_logs` / `sdklogs_alerts`；`vault_*` / `pwsvc_*` / `subs_*` / `apihub_*` 本就合规。

- `init_db` 启动顺序：**存量表 RENAME（必须先于 create_all，否则 create_all 先建空新表导致 RENAME 永不触发）** → `create_all` → 逐模块 `ensure_migrations(engine)` 列级钩子 → 播种虚拟根
- RENAME 条件：旧表存在且新表不存在 → `ALTER TABLE 旧 RENAME TO 新`（SQLite/PG 同语法；旧索引随表改名保留，功能等价）
- 知识库幂等迁移（`app/blog/services/migrations.py::ensure_migrations`）：blog_posts 缺 `workspace_id`/`last_viewed_at` 列补列建索引；无知识库时建"默认知识库"并拷贝虚拟根 `children_order`；NULL 归属全部回填默认库

- 配置中心幂等回填（`app/confcenter/migrations.py::ensure_migrations`）：`create_all` 建立 `confcenter_namespaces` 后，从已有 `confcenter_entries` 登记所有缺失 namespace；不改动原 KV，独立空空间在重启后仍保留。

### 3.4 初始化与双后端（`db.py`）

- 运行时后端由 **`data/db_config.json`** 决定（`{"backend": "sqlite"|"postgres", "postgres": {...}}`），文件缺失时回退 `config.py` 默认值
- `load_db_config()/save_db_config()` 负责读写；`get_database_url()` 生成 URI（PG 走 `postgresql+psycopg2://`，密码 URL 编码）
- `rebuild_engine()`：按当前配置重建引擎 + scoped_session（测试/切换场景复用）
- `init_db(app)`：见 3.3 顺序；引擎参数（SQLite：`check_same_thread=False`；PG：`pool_size=5/max_overflow=10`）；SQLite 专属 PRAGMA（WAL/busy_timeout/NORMAL）在无并发窗口一次设置并校验
- 会话模型：`db.session` 为 scoped_session（线程本地）；请求侧统一 `run_db(fn)`（SDK 线程池执行 + 工作线程内 rollback/remove）；后台线程用完显式 `db.session.remove()`

### 3.5 双后端切换（`app/system/routes.py`，前端 `/config` 总配置页）

`POST /api/admin/database/switch`：**只换连接、不迁移数据**——校验目标可达（PG 库不存在自动创建）→ 写 `data/db_config.json` → 重启生效，直接读取目标库现有数据（空库由 `init_db` 自动建表 + 播种默认知识库/虚拟根）。两侧数据互不影响，随时可切回；允许未重启时连续切换（纯配置写入）。

**开发模式自动重启**：`restart_required = not settings.debug`；dev 下延时 daemon 线程 touch `app/_reload_stamp.py`（uvicorn `--reload` 监听 `app/` 目录，与改源码触发的热重启同一机制）；生产返回 `restart_required: true` 需手动重启。

**跨库一致性**：模型层 `_iso()` 把时间戳统一为无时区偏移的本地时间字符串（SQLite naive 与 PG timestamptz 归一）。

> `migrate_children_order.py` 是旧库迁移脚本；新库自动播种虚拟根，无需手动运行。

## 4. 树形结构设计

### 4.1 虚拟根 + children_order

- **虚拟根**：id=0 的 Post 行，所有查询以 `Post.id != ROOT_ID` 过滤它
- **知识库**：顶级文章顺序存 `workspaces.children_order`（升级迁移时从虚拟根拷贝）；**树接口按知识库返回**（缺省 = id 最小的库）
- **每节点 `children_order`**：父节点记录自己的直接子节点顺序（拖拽排序写入）
- 工具函数（`app/blog/services/tree_order.py`）：`get_children_order` / `set_children_order` / `append_child` / `remove_child` / `insert_child`

### 4.2 树接口组装（`app/blog/routes/posts.py::get_post_tree`）

1. 一次查询取出全部文章（不含虚拟根），浏览计数随行返回
2. 内存构建 `post_map` + 递归 slug 计算（带缓存）
3. 按 `parent_id` 挂接 children，再按各级 `children_order` 排序

### 4.3 层级限制

`MAX_LEVEL = 2`（共 3 层）。创建与移动父文章时校验，超出返回 400。

## 5. Slug 计算策略

slug = 从根到本节点的 `name` 路径，如 `/java/java8`。

| 场景 | 实现 |
|---|---|
| 列表接口 | `_fetch_ancestors`+`_slug_from_rows`：只为页内文章按需补祖先链（≤3 层 IN 小查询，页内全为顶级时零额外查询），内存回溯拼 slug |
| 详情接口（×3） | 同上取本文祖先链；父 slug 同链直取，子文章 slug 按 `本文 slug + '/' + name` 不变式直推 |
| 创建 | 父文章已存 slug 直推前缀（存量空 slug 回退 `build_full_slug` 逐级回溯兜底） |
| name 唯一性 | **知识库内唯一**（create/update 校验加 `workspace_id` 条件）；父文章必须同库；不支持跨库移动 |
| 改名 | `update_slug_for_subtree`：BFS 收集受影响子树 → 内存计算新 slug → 仅更新有变化的行（**级联子孙**） |
| 移动父文章 | 同上；另校验"不能选自己/自己的子孙为父"（`parent_of` 内存父链判定） |

> `build_slug_map`（全表一次查询 + 内存回溯缓存）保留为批量工具；热路径（列表/详情）2026-10 起改用按需祖先链，避免每请求全表加载。

> 历史包袱：`slug` 列持久化在库里（`/path/<slug>` 接口按它查询），因此改名/移动必须级联维护，否则路径查询失效。

## 6. 浏览计数与最近浏览

- 每次计浏览的详情请求 `UPDATE view_count + 1` 并刷新 `last_viewed_at`（`?no_view=1` 前端预取两者都跳过）
- `last_viewed_at` 列由 blog 模块 `ensure_migrations` 幂等补列（SQLite/PG 同语法）
- `GET /api/posts/recent` 按 `last_viewed_at` 倒序取最近浏览（跨库、不含正文）

`app/blog/services/view_count.py`，**直接读写数据库（SQLite/PG 通用），实时生效，无缓存层**：

| 操作 | 实现 |
|---|---|
| 详情接口自增 | `increment_view` → `UPDATE blog_posts SET view_count = view_count + 1` 立即提交，返回新计数（详情组装直接透传，免二次回查） |
| 列表/树读取 | 直接用行上 `view_count`（`defer(content)` 后随行加载；同一事务快照内与单独回查等值） |
| 单篇/批量读取 | `get_view_count` / `get_all_view_counts`（保留 API，`increment_view` 内部使用前者） |
| 删除文章 | 随行删除，无独立清理 |

## 7. 应用工厂与中间件

`main.py::create_app()`：

1. FastAPI 实例（`docs/redoc/openapi` 关闭——单用户内部服务不暴露 schema）；`app.state.testing`（`DOUBLOG_TESTING=1` 时后台线程空转）
2. `CORSMiddleware`：`/api/*` 放开 `*`，方法 GET/POST/PUT/DELETE/OPTIONS，头 Content-Type/Authorization
3. `GZipMiddleware(minimum_size=1024, compresslevel=6)`：≥1KB 响应按 Accept-Encoding 压缩（不再限 JSON/文本）
4. **trace 纯 ASGI 中间件**（微秒级，非 BaseHTTPMiddleware）：每请求绑 lizysdk trace_id，响应头回写 `X-Trace-Id`（请求头已带则透传延续链路）；该请求所有日志行自动携带——经 `shared/logging_setup` 的 **LogRecord 工厂注入**（SDK 队列 handler 会绕过 handler filter，勿改回）
5. 动态模块导入（**先于 init_db**——模型先注册进 Base.metadata 建表才完整）：按 `MODULES` 顺序 `importlib` 导入 `app/<mod>`，导入失败（未迁移/依赖缺失）捕获跳过并 WARNING——中间态可启动
6. `init_db(app)`（读 db_config.json → 存量改名 → 建表 + 模块迁移钩子 + 播种虚拟根 + SQLite PRAGMA）→ 逐模块挂 `router` + 调 `start_background(app)`
7. 统一异常信封：`AppError`（lizysdk）→ `{success:false, code:http_status, message, data:{error_code, details}}`（401 附 `WWW-Authenticate`）；`StarletteHTTPException`（404→"资源不存在"）；`RequestValidationError`→400；未知异常→500 + 日志（`exc_info`）；错误日志按路径标注 `sys_name=doublog.<module>`，`/api/v1/logs` 路径带 `no_remote` 防自摄回环
8. `/` 与 `/health` 免认证

> 请求日志用 uvicorn access log，无自定义中间件重复记录。

## 8. 认证

- **统一登录**：`shared/auth.py` —— `require_basic` 依赖双通道（会话 Cookie `doublog_session` 优先，其次 Basic；失败 lizysdk `AuthError` → 401 信封 + `WWW-Authenticate`）
- 会话令牌 `user.exp.sig`（HMAC-SHA256(secret_key)，30 天，HttpOnly/SameSite=Lax）；`POST /api/auth/login` 接受 JSON {username,password}（签发 Cookie）或 Basic（兼容）；`POST /api/auth/logout` 清除；详见 `docs/modules/system.md`
- 业务路由（router 级或路由级）`dependencies=[Depends(require_basic)]`；免认证例外：sdklogs 摄入（可选 token）、diary share、apihub gw（sk- 令牌）、图片下载
- **无限流**（pwsvc 校验的进程内令牌桶是模块自带的，不是框架级）

## 9. 图片服务与安全围栏

- 上传：`POST /api/images/upload`（multipart `file`），白名单 `.png .jpg .jpeg .gif .webp .bmp .avif`（不含 svg），≤10MB，uuid 主文件名落盘 `data/images/`
- 下载：围栏 + 扩展名白名单校验（见 api.md 图片 API 一节）

`app/blog/routes/images.py`：

- `POST /api/images/upload`：multipart 字段 `file`（需认证）；上传白名单 `.png .jpg .jpeg .gif .webp .bmp .avif`（**不含 svg**，防动态内容回显）、≤10MB（流式读取时校验）；uuid 随机主文件名防碰撞/注入，落盘 `data/images/`
- `GET /api/images/...`（下载）：
  1. `type` 决定解析基准：缺省 → `data/images/`；`relative` → 项目根；`absolute` → 视为绝对路径
  2. `_resolve_within_fence(base_dir, raw_path)`：绝对/相对路径 → `os.path.realpath` 归一化 → **必须落在基准目录内**（`real == fence or startswith(fence + sep)`），否则 None → 404
  3. 扩展名白名单：`.png .jpg .jpeg .gif .webp .svg .ico .bmp .avif`
  4. 通过后 `FileResponse(full_path)`（带 Cache-Control）

## 10. 配置

`app/config.py::Settings`（模块级单例 `settings`）：

| 配置 | 默认值 | 说明 |
|---|---|---|
| `host` / `port` | `0.0.0.0` / `60100` | 监听 |
| `debug` | `True` | **生产必须关**（uvicorn --reload 与调试暴露面） |
| `secret_key` | dev 值 | **会话令牌 HMAC 签名密钥**（生产必改） |
| `cors_origins` | `*` | ⚠️ 死配置（中间件用 allow_origin_regex `:60101` + allow_credentials） |
| `auth_username` / `auth_password` | `admin` / `lizy111A` | 仅首次播种默认——凭据实际存 `system_accounts` 表（PBKDF2 哈希，2026-10-12 迁入；`/config` 页可改，见 docs/modules/system.md 第 0 节） |
| `database_backend` | `postgres` | 默认后端；运行时以 `data/db_config.json` 为准（测试 conftest 强制 sqlite） |
| `postgres_*` | `117.72.98.99/50002/lizy/lizy111pg/app_dev` | PG 连接默认值（host/port/user/password/dbname） |
| `data_dir` / `images_dir` | `<根>/data[/images]` | 数据与图片目录 |
| `max_page_size` / `default_page_size` | `100` / `20` | 分页 |

> 测试通过 monkeypatch `settings.data_dir` 注入独立临时 SQLite。

## 10.4 日记（blog 子域 app/blog/diary/，Memos/Day One 超集；2026-10-17 自独立模块并入，/api/diary 路径不变）

- 模型：DiaryJournal（分册）+ Diary（entry_date/mood/tags/word_count + journal_id/pinned/archived_at/deleted_at/weather/location/share_token/share_expires）
- 视图 timeline/archive/trash/pinned + 过滤（日期范围/全文含标签/标签/心情/本子），置顶优先排序；回收站软删除（restore / hard=1 彻底）
- 分享 token 免登录只读（过期/撤销/进回收站即 404）；快速录入 /quick；热力图 /heatmap；那年今日 /onthisday；趋势 /trends（缺月补零）；年度回顾 /yearend；导出 zip
- 模板与引导问题内置（routes.py 的 TEMPLATES/PROMPTS，按日期确定性轮换）；存量库幂等迁移 `ensure_migrations`
- 测试 tests/blog/diary/ 27 例覆盖全部新能力

## 10.42 模块化日志上报（app/shared/modules.py）

- 每模块一个 sys_name：`doublog.blog（含 assets/diary/bookmarks 子域）/ vault / pwsvc / sdklogs / system / shared / main`（请求路径前缀映射 `module_for_path`；全局异常按请求路径标注来源模块）
- **依赖 basekit(lizysdk) 新能力**：formatter 支持记录级 `extra={'sys_name': ...}` 覆盖（Pipe/JSON 双格式器，非法取值回退默认值）
- `mod_logger(module)` 取带覆盖的 LoggerAdapter（**坑：必须显式持有模块名**，用 logger 名拼前缀会得 doublog.doublog.x 双前缀）
- 上报配置持久化 `data/logs_config.json`（enabled/url/level），管理页 PUT 即时重装配；测试端点 /admin/logging/test 发 sys_name=doublog.system 的 WARNING

- 与文章体系零耦合；表 `diary_journals` + `diary_diaries`（日期 YYYY-MM-DD 字符串，mood 枚举，word_count 保存时按 CJK 逐字+西文按词重算；随记必选本）；迁移由 blog `ensure_migrations` 链式调用
- 模块细节（22 端点/分册/置顶/归档/回收站/分享/统计/ensure_migrations 迁移）见 `docs/modules/blog.md` 日记子域节

## 10.45 Vault（零知识密码库，app/vault/；四表含 vault_attachments，附件 5MB/文件/8MB 总量、purge 级联，详见 docs/modules/vault.md）

- 三表：vault_accounts（KDF 参数/盐/双通道包裹 VEK）、vault_items（密文 blob + 非敏感元数据列）、vault_audit_logs（仅行为+条目 ID）
- 物理表无任何明文敏感列（测试断言）；blob/包裹材料结构校验 {n, ct}；跟随同一数据库会话（db_config.json 切换生效）

## 10.47 Pwsvc（密码服务：轮换密码，app/pwsvc/routes.py）

- 四表：pwsvc_projects（API Key 只存 SHA-256 哈希 + 12 字符前缀 + rate_limit 限流配置）、pwsvc_user_types（密码策略：长度 8-64 / 四类字符集 / 排除易混淆 / rotation_seconds ∈ {30,60,120,300,600}）、pwsvc_users（**每用户独立 每用户独立 256-bit（32 字节）seed**，AES-256-GCM 加密落盘，密钥 `data/pwsvc.key` 自动生成）、pwsvc_validate_logs（校验日志：项目/用户名/结果/IP/时间，**永不含密码内容**，保留 30 天写入时清理）
- **密码不存储**：`derive(seed, window, policy)` 确定性推导（HMAC-SHA256 流 + 确定性拒绝采样 + Fisher-Yates 洗牌）；测试含**黄金向量**（固定 seed+window → 固定密码）防算法漂移
- 校验 `POST /api/pwsvc/validate`（X-Api-Key 认证，不走 Basic）：当前窗口命中 → valid+expires_in；未命中且**进入窗口 30s 内**（`min(30, rotation)`）→ 比对上一窗口（宽限）；`hmac.compare_digest` 常数时间比较；**限流**：进程内令牌桶（每项目 rate_limit 次/分钟，默认 120，0=不限，页面可改），超出 429 且不落日志
- 每次校验落一条 `pwsvc_validate_logs`；`GET /projects/<id>/logs` 倒序分页 + 近 1h/24h 成败统计 + 失败 TOP5（爆破定位）
- 存量库升级：`ensure_migrations`（app/pwsvc/models.py）幂等 ALTER 补 rate_limit 列（create_all 不改已有表）
- 依赖 `cryptography` 包（已加入 requirements.txt）；无后台调度器（无状态时钟轮换，重启/多副本一致）
- 详细设计见 `docs/pwsvc-design.md`

## 10.48 Sdklogs（日志接收，app/sdklogs/routes.py）

- 两表 `sdklogs_logs`/`sdklogs_alerts`（告警规则/事件 + webhook 通知与确认，见 docs/modules/sdklogs.md）。logs 固定列（ts naive UTC / level 数值+level_text / sys_name / file:line / trace_id / message）+ `fields` JSON 列（SDK 全部业务 kv，值统一 str）；索引 ts、(sys_name,ts)、(level,ts)、trace_id
- **摄入端点不挂 Basic Auth**（`/api/v1/logs`、`/api/v1/logs/batch`，SDK send_json 无凭据直发）；可选 `LOGSDB_AUTH_TOKENS` Bearer token
- 写入路径：接收线程校验+规范化+入队（满则丢最旧计 dropped）→ **每 app 一条单写者线程**批量落库（500 条/500ms，重试 2 次→死信 `data/dead_letters/YYYYMMDD.jsonl`）；坏日志进死信仍返 202
- 时间规范化：无时区按 `LOGSDB_INCOMING_TZ`（默认 Asia/Shanghai）转 naive UTC；RFC3339/Z 直接采用
- 检索：时间范围/sys_name 多值/level 精确与 ≥/trace_id/q 全文（LIKE 转义）/limit+offset/**任意 kv 参数**（SQLite `json_extract` / PG `->>`，参数名白名单防注入）
- 保留策略：每日线程清理超期行与死信文件（`LOGSDB_RETENTION_DAYS`，默认 30，0=永久）
- 热路径优化：时间戳 19 字符快路径（`fromisoformat`−缓存时区偏移）、JSONL 整包一次数组解析（失败退回逐行定位坏行）、批量**整批入队**（队列元素可为 list，摊薄锁开销且等效容量大增——5 万行突发零丢弃）、检索 Core 直取列手工装 dict（省 ORM 实例化）
- 前端 `/logs` 查询页（见 frontend.md）；跟随设置页数据库切换
- **性能实测**（`tools/sdklogs_loadtest.py`，隔离临时库、8 并发真实 HTTP；数字为 Flask 时代 Werkzeug dev server 口径的历史基线，FastAPI 迁移后待 `tools/bench/` 重测对照）：单条摄入 **~440-490 rps**；批量端点 **~40-42k 行/s**（5 万行突发全量落库**零丢弃**，写者持续 ~8k 行/s）；50k 行索引查询 ~110-160 rps；任意 kv 过滤为 json_extract 全表扫（O(N)，每行 ~6.4µs）已知边界
- 压测工具：`backend/tools/sdklogs_loadtest.py <tag>`（报告落 `tools/reports/`）、`sdklogs_probe.py`（写入线程打点诊断）

## 10.49 Subs（订阅管理，app/subs/，CrownFlow 全量迁移）

- 三表（`subs_` 前缀隔离）：`subs_categories`（名称唯一 + emoji 图标 + hex 颜色）、
  `subs_members`（会员主表：名称/分类/备注/reminder_days，一对多订阅 delete-orphan 级联）、
  `subs_subscriptions`（订阅记录：level/price Numeric(10,2)/currency 5 种/billing_cycle 4 种/
  custom_days/起止日期字符串/渠道/备注）；日期一律 `YYYY-MM-DD` 字符串（跨 SQLite/PG 一致）
- **会员状态口径**：任意一条订阅 `end_date ≥ 今天` ⇒ active；列表即带聚合字段
  （latest_subscription 最新有效优先 / subscription_count / total_spending 静态汇率折算基准币 / total_duration_days）
- **支出计算**（`subs/currency.py`）：日均 = 价格 ÷ 周期天数（monthly=起始月实际天数、quarterly=90、
  yearly=365/366、custom=custom_days）；实际支出 = 日均 × 与查询范围重叠天数（闭区间 +1）；
  汇率 `settings.subs_exchange_rates`（CNY/USD/EUR/GBP/JPY 静态表）；overview 的月/年支出口径为
  **整月/整年覆盖**（CrownFlow 原口径，非"至今"）
- **备份**（`subs/backup.py`）：当前 SQLite 库经 `sqlite3 backup API` 出 WAL 一致快照到
  `data/backups/subs_YYYYMMDD_HHMMSS.db`（PG 后端返回 skipped）；保留期 `subs_backup_retention_days`（90 天）自动清理
- **每日后台线程**（`routes.py::start_daily_loop`，daemon，随进程，60s 粒度检查+当日去重，启动补跑）：
  02:00 后自动备份（`SUBS_BACKUP_ENABLED=0` 关闭）、10:00 后当日活跃订阅支出摘要写模块日志（info 落盘，
  sys_name=doublog.subs）——与 sdklogs 保留清理线程同款模式，测试直接调 `run_daily_spending_log`/`backup_database`
- 配置（`config.py`）：`subs_base_currency` / `subs_exchange_rates` / `subs_default_reminder_days`(7) /
  `subs_backup_retention_days`(90) / `subs_backup_enabled`(env SUBS_BACKUP_ENABLED)
- 校验：lizysdk ParamError(400)/NotFoundError(404)/ConflictError(409)；币种白名单 5 种、周期白名单 4 种、
  custom 周期必须带 custom_days>0（含 PUT 部分更新的组合校验）、起止日期倒置拒绝、分类删除前查会员关联

## 10.52 Assets（资产库：Prompt 与 Skill，app/blog/assets/ 子包，2026-10-17 并入 blog 模块；五表详见 docs/modules/blog.md 资产库子域节）

- 四表：assets_categories（名称唯一 + emoji/颜色/适用类型/排序）、assets_items（kind=prompt|skill、tags/variables JSON 列、favorite、status=active|archived|trash、usage_count/last_used_at、version）、assets_versions（内容快照，**当前版本在链**）、assets_usage_logs（copy/fill/export 动作）
- 变量 `{{name}}` 服务端保存时提取（`services.extract_variables`，去重保序）；版本策略：title/summary/content 实际变更才快照（`content_changed` 只比对出现的键），恢复历史版本=新版本
- 无后台线程、无 ensure_migrations 实质逻辑（新表由 create_all 建）；无导入导出服务依赖（纯 JSON 附件流）
- 模块细节（36 测试/导入导出语义/边界）见 `docs/modules/blog.md` 资产库子域节

## 10.53 开发者工具箱（devtoolbox，app/devtoolbox/；无表）

- 纯计算模块：仅 router（无 start_background / ensure_migrations，不在 MODULES_WITH_DB）；5 端点全部 require_basic + 同步 def
- 能力：哈希/HMAC（10 算法白名单）、字符集互转（9 字符集白名单，乱码修复语义 encode(from)→decode(to)）、JSON⇄YAML（PyYAML **libyaml C 实现** CSafeLoader/CSafeDumper，date 转字符串；213KB 解析 301ms vs 纯 Python 2.1s，未编译 libyaml 自动回退）、二维码（segno，SVG+PNG data URL）
- 上限：文本 ≤1MB、二维码内容 ≤2000 字符、scale/border/ecc 越界钳制；错误统一 ParamError 中文 message
- 依赖：segno==1.6.6（纯 Python 零依赖，PNG 原生输出无需 Pillow）；PyYAML 与 practice 共用
- 模块细节（31 工具清单/前端结构/42 测试/边界）见 `docs/modules/devtoolbox.md`

## 10.54 全局序列化与 YAML C 加速（2026-10-16，shared 层）

- **全站 JSON 信封改 orjson 渲染**（`shared/response.py` FastJSONResponse，api_response 与 apihub 网关 wrap 共用）：中文不转义、紧凑分隔符与旧输出语义一致，100KB 级响应序列化 ~18×（实测 56KB 信封 1085µs→60µs）；**行为变化：NaN/Infinity 序列化为 null**（旧实现 allow_nan=False 抛 ValueError→500）；datetime 等非 JSON 类型经 default=str 兜底为文本（旧实现 500）。局部热点同步换 orjson：vault 附件三趟序列化（7MB blob 入库 dumps 实测 4.6×）与 export、apihub 网关 wrap/错误归一化、sdklogs 摄入解析/写者序列化/JSON 导出、assets 导出（OPT_INDENT_2）、gamemap 信封缓存、confcenter 读路径与 Redis 缓存
- **PyYAML 统一走 libyaml C 实现**（`shared/yamlfast.py`，CSafeLoader/CSafeDumper，safe 语义不变，ImportError 回退）：clash 控制器/runtime.yaml（此前连接页 2s 轮询每次纯 Python 解析 40-147KB 耗 0.3-1.2s，实测 ~8.4×，GIL 占用同步大降）、practice Obsidian 导入（500 篇 1.33s→0.25s）、devtoolbox JSON⇄YAML
- confcenter json 类型值入库文本改 orjson 紧凑格式（`{"a":1}`，旧 `{"a": 1}`）；语义不变，前端 JsonArea 显示的存储原文会少空格
- 一致性守护测试：`tests/shared/test_response_orjson.py` 16 例（信封 parse 等价/中文不转义/NaN→null/default=str 兜底/C loader 生效断言与语义对拍）

## 10.51 API Hub（统一 API 调用平台，app/apihub/）

聚合异构系统 API 的能力包（**2026-10-17 重构：分类收敛为 system → api 两维，原
upstream（上游）整体改名 system（系统，手动创建，表 apihub_upstreams 由 LEGACY_TABLE_MAP
启动改名）；自注册系统内部 API（tools/apihub_register_self.py 及 doublog 上游/doublog-self
令牌遗留数据）与 OpenAPI 发布（/openapi/** 路由、apihub_apis 的 group1/group2/pub_name/
doc_md 列、X-Apihub-Token 内部令牌旁路）整体移除，存量库由 ensure_migrations 幂等清理，
见 tests/test_apihub_migration.py）：models.py（apihub_* 七表，凭证 AES-256-GCM 密文落库，
主密钥 `data/apihub.key` 自动生成）+ core.py（框架无关核心：加密/模板渲染/鉴权适配
七式/内存限流器（令牌桶+固定窗口，多级 AND 短路）/key 选择器（加权轮询+连续失败
冷却）/探活状态机）+ pool.py（标准库 http.client keepalive 连接池：每目标空闲池
4.5s 过期、并发封顶 128、空闲连接被服务端关闭时换新连接重试一次、超时不重试）+
state.py（每 app 一份运行态挂 `app.state.apihub`（持真实 app 引用；FastAPI 无代理
概念）：配置内存快照（版本化，管理端改动 reload 全量生效）、限流桶、探活调度
daemon 线程、日志批量写线程（队列+单写者，2s/100 条 flush，配额计数随批落库，
写完显式 `db.session.remove()` 复刻请求级会话回收））+ routes.py（APIRouter
`/api/apihub`：网关双入口（invoke `POST /gw/apis/{slug}` + 透明代理
`ANY /gw/systems/{slug}/{path}`）+ 管理 CRUD + 探活/日志/统计；探活并发执行走 lizysdk
池 `get_pool('apihub-probe', workers=10)`）。

- **网关管道**：令牌鉴权（sk- SHA-256 查内存快照）→ 授权（有效期/scope/IP/健康）→
  多级限流 → 配额预占-退还 → 选 key → 请求构建（模板渲染+凭证注入+剥离入站凭证）→
  上游转发 → 响应（透传/信封 + 错误归一化双通道）→ 异步日志
- **线程安全**：限流/选择器/健康状态机自带锁；连接池每目标锁+信号量；配置快照
  读为只读 dict（reload 整体替换）
- **探活调度**：daemon 线程每秒检查到期 API（interval_s>0），TESTING 模式空转；
  手动一键探活走线程池（10 并发）
- **测试**：tests/test_apihub_core.py（核心单元）+ tests/test_apihub_api.py
  （CRUD+网关端到端，内置 http.server 线程 mock 系统；配额并发不超卖用
  ThreadPoolExecutor 多 test_client 实测）+ tests/test_apihub_qq.py（QQ/代理）+
  tests/test_apihub_migration.py（upstream→system 迁移与自注册数据清理）
- 独立原型期的压测报告（FastAPI 版，含 h11 连接复用/端口耗尽等结论，连接池设计
  直接继承）见 `docs/apihub-loadtest-report.md`

## 10.52 Bookmarks（书签与稍后阅读，blog 子域 app/blog/bookmarks/，2026-10-17 并入；4 表 bookmarks_*，docs/modules/blog.md 书签子域节）

单用户书签管理 + 稍后阅读队列：分类树（≤3 层）/条目状态机（unread→reading→read + archived/starred）/标签 M2M/URL 规范化查重（host 小写、去 utm_*、剥 fragment）/离线快照（HTML→Markdown 启发式抽取，列表 defer 大字段）/死链批量检测（模块池并发 HEAD→GET 回退，手动触发无后台线程）/阅读队列下一篇/统计/Netscape HTML + JSON 导入导出（浏览器书签互操作）。网络全在 fetcher.py（FetchError 分类文案收敛），无跨模块依赖。

## 10.5 双链与导出

- 双链语法 `[[name]]` / `[[标题]]` / `[[name|显示文字]]` 的**渲染**在前端（`md.js` 插件 + `applyWikiLinks`）
- 后端 `GET /api/posts/id/<id>/backlinks`：同库内扫描正文 `[[...]]` 目标（先 name 后 title 精确匹配）返回反链列表
- 导出 `GET /api/export/markdown`（`app/blog/routes/export.py`）：全库 Markdown zip（树形嵌套 + frontmatter + images/ + 图片 URL 相对化重写）；**必须排除虚拟根 id=0**——存量库根挂在默认知识库下，否则树递归死循环（有深度 32 保护兜底）

## 10.9 SQLite PRAGMA（WAL 的静默失败坑）

- `journal_mode=WAL` 是**文件级持久属性**，必须在 `init_db` 的**无并发窗口**一次性设置并校验返回值——
  只靠连接事件设置的坑：初始化连接早于监听器注册；并发流量下 `PRAGMA journal_mode=WAL` 切换被活跃事务
  挡住且**静默失败**（返回原模式不抛错），库永远停在 delete 模式 → 写者独占锁阻塞全部读者
  （压测复现：写入期间 stats/count 500 `database is locked` ×18；修复后 0 次）
- 每连接 PRAGMA（connect 事件）：busy_timeout=5000 / synchronous=NORMAL / cache_size=20MB / temp_store=MEMORY

## 11. 测试

```bash
cd backend && python -m pytest tests/ -q -n 8   # 653 用例（todo 53 + gamemap 34 + practice 61 + steamidler 18；confcenter 46；clash 34；devtoolbox 37；bookmarks 50；并行 ≈2 分钟）
```

- **conftest**：每个用例独立临时 SQLite（`tmp_path` 注入 `settings.data_dir`）；`DOUBLOG_TESTING=1` → `app.state.testing`（后台线程空转）；client 为 `TestClient(app, raise_server_exceptions=False)`（对齐 Flask 测试客户端"异常出 500 响应"语义）。**完全自包含，无任何外部依赖**
- **覆盖**：shared 14 例（auth 11（含会话登录 6）+ lizysdk 日志集成 3）；posts 31 例 + kb_features 11 例——创建校验（必填/格式/唯一/层级）、列表与树**无正文**、详情含正文、**浏览计数实时自增**、分页、改名/移动的 **slug 级联**、自父/子孙父拒绝、删除（提升/recursive）、图片围栏（正常 200、扩展名 404、三类穿越 404）、gzip、拖拽排序
- **admin 9 例**：状态/连通性（含不可达 400）/切换校验（同后端拒绝、不可达拒绝）+ **真实 SQLite↔PostgreSQL 往返集成测试**（`pgserver` 内嵌 PG 起真实实例：切换 → 逐字段校验（parent_id 回填/level/浏览计数/虚拟根/知识库归属/序列重置）→ 未重启防护 → 切回 → 数据完整）
- **workspaces 15 例**：CRUD、空库/末库删除保护、**库间树与列表隔离**、同名文章跨库可建/同库拒绝、跨库父子/移动拒绝、默认库自动创建与回填、顶级排序归属知识库
- **sdklogs 23 例 + shared 日志集成 3 例**（含 sysnames 下拉数据源——lizysdk 落盘/自摄回灌/no_remote 防回环，uvicorn 线程伺服本 app 实现真实 HTTP 回灌）：摄入往返（时区换算/级别规范化/kv 剥离与转 str/trace_id 成列）、RFC3339 偏移、批量（数组+JSONL+超限 400）、坏日志进死信、token 鉴权三态、全部过滤维度、分页与 count、stats、保留策略（含 0=永久）、规范化边界
- **pwsvc 21 例**：黄金向量防漂移、30s 宽限（含短周期封顶 min(30, rotation)）、API Key 生命周期（重置即失效/伪造 401）、全链路校验、禁用用户、重置 seed 旧密码全失效、策略变更、删除级联与 409、唯一性/参数校验、**无明文落盘断言**；**校验日志**（写入字段/倒序分页/统计与 fail_top/30 天清理/不含密码）、**限流**（额度内 200 超出 429/0=不限/参数校验/429 不落日志/页面改配置生效）
- **subs 15 例**（CrownFlow 迁移）：分类 CRUD/重名 409/删除保护；会员 CRUD/校验/列表全维度筛选排序
  （keyword/category/status/sort+非法值 400）/首条订阅原子性；订阅 CRUD/十类校验分支（价格/周期/币种/日期/
  custom 天数含 PUT 组合校验）；会员聚合（多币种折算 total_spending/时长/最新订阅）；统计五接口
  （overview 整月口径/by-category 明细/trend 四粒度标签/参数与非法值）；提醒（reminder_days 阈值/all 不含过期）；
  备份（快照文件可读回查/超期清理）；每日支出摘要日志
- **apihub 40 例**（core 22 + api 18）、vault 18 例、diary 27 例、todo 53 例（CRUD/计划物化/容量/通知/鉴权，docs/modules/todo.md）、gamemap 34 例（docs/modules/gamemap.md）、practice 61 例（docs/modules/practice.md）、steamidler 18 例（docs/modules/steamidler.md）
- PG 集成测试可选依赖 venv 内 `pip install pgserver`，未安装自动跳过
- 新增后端行为**必须**附带测试（见 AGENTS.md）

## 12. 已知限制

1. AuditLog 只增不删，长期运行膨胀
2. `debug=True` + `0.0.0.0` 仅为开发配置，公网部署需收敛
3. 移动子树时子孙的 `level` 列不重算（slug 已级联，level 仅展示用途时的既有行为）
4. 数据库切换在生产模式下需手动重启；切换期间的并发写入可能丢失（单用户场景可忽略）
5. PG 切换依赖 `psycopg2-binary`；目标库不存在会自动创建，但 PG 服务本身需自备
6. 路径参数类型差异：非整数路径段（`/api/posts/id/abc`）返回 400「请求参数错误」（Flask 时代 404）
7. gzip 现作用于一切 ≥1KB 响应（Flask 时代仅 JSON/文本；文件下载因 StreamingFileResponse 一般低于阈值不受影响）
