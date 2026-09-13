# DouBlog 后端架构文档

> **技术栈**: Flask 3.0 + Flask-SQLAlchemy 3.1 + SQLite(WAL) / PostgreSQL(psycopg2)
> **端口**: 60100　**入口**: `backend/run.py`
> **本文档描述当前代码的真实架构，与 `backend/app/` 一一对应；修改代码时必须同步更新本文档**（见 `AGENTS.md` 文档同步规则）

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
| SQLite 默认 + PG 可切换 | SQLite(WAL) 单文件零运维；PostgreSQL 经管理页/API 一键切换（含全量数据迁移），配置持久化于 `data/db_config.json` |
| 知识库（Workspace） | 文章的顶层分组：库间数据隔离、name 库内唯一、顶级排序存在 `workspaces.children_order` |
| 无外部依赖 | 浏览计数实时写库；无限流、无 Redis、无定时任务 |
| 虚拟根节点 | id=0 的特殊行统一管理顶级文章的父子关系与排序 |
| 正文按需传输 | 列表/树接口不含 `content`，只有详情接口返回全文 |
| 单次查询内存计算 | slug 映射、树组装、子孙判定均为"一次取 id/name/parent_id + 内存回溯"，避免 N+1 |

## 2. 目录结构

```
backend/
├── run.py                     # 启动入口：app.run(host, port=60100, debug, threaded)
├── requirements.txt           # 全部依赖（PG 驱动 psycopg2-binary）
├── migrate_children_order.py  # 旧库迁移：播种虚拟根 + 生成 children_order
├── app/
│   ├── main.py                # 应用工厂：CORS/gzip/异常处理/蓝图注册
│   ├── config.py              # Settings 类（见第 11 节）
│   ├── db.py                  # Flask-SQLAlchemy 初始化 + PRAGMA + 虚拟根播种
│   ├── models/
│   │   └── models.py          # Post / AuditLog 模型 + 序列化方法
│   ├── api/
│   │   ├── auth.py            # /api/auth/*（HTTPBasicAuth 实例定义于此）
│   │   ├── posts.py           # /api/posts/*（CRUD/树/排序/审计日志）
│   │   └── images.py          # /api/images/*（带围栏的文件服务）
│   └── utils/
│       ├── response.py        # api_response 统一信封
│       ├── tree_order.py      # children_order 读写工具 + ROOT_ID
│       ├── view_count.py      # 浏览计数（实时写库）
│       └── audit.py           # 操作日志记录（随主事务提交）
└── tests/                     # pytest（69 个用例，见第 12 节）
```

## 3. 数据库设计

### 3.1 Workspace 模型（`models/models.py`）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | Integer PK | 自增 |
| `name` | String(100) | 名称，全局唯一 |
| `description` | String(500) | 描述 |
| `children_order` | Text | **该库顶级文章顺序** JSON（子级顺序仍在 Post 上） |
| `created_at` / `updated_at` | DateTime | 时间戳 |

### 3.2 Post 模型（`models/models.py`）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | Integer PK | 自增；**id=0 保留给虚拟根** |
| `title` / `name` / `slug` | String | name 全局唯一且建索引；slug 为完整路径 |
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

### 3.2 AuditLog 模型

`action`（create/update/delete）、`resource_type`（post/image）、`resource_id`、`detail`(JSON)、`ip_address`、`created_at`。由 `utils/audit.py::log_action` 写入，**不单独 commit，跟随主操作事务**。只增不删（无清理策略）。

### 3.3 知识库迁移（`db.py::_ensure_workspace_migration`，幂等）

1. 存量库 posts 缺 `workspace_id` 列 → `ALTER TABLE` 补列 + 建索引（create_all 不改已有表）
2. 无任何知识库 → 创建"默认知识库"，并把虚拟根(id=0)的 `children_order` 拷给它（保留旧顺序）
3. `workspace_id IS NULL` 的文章全部归入默认知识库

### 3.4 初始化与双后端（`db.py`）

- 运行时后端由 **`data/db_config.json`** 决定（`{"backend": "sqlite"|"postgres", "postgres": {...}}`），文件缺失时回退 `config.py` 默认值
- `load_db_config()/save_db_config()` 负责读写；`get_database_url()` 生成 URI（PG 走 `postgresql+psycopg2://`，密码 URL 编码）
- `init_db(app)`：设 URI → 引擎参数（SQLite：`check_same_thread=False`；PG：`pool_size=5/max_overflow=10`）→ `create_all` → **播种虚拟根（id=0，幂等）** → SQLite 专属 PRAGMA（WAL/busy_timeout/NORMAL）

### 3.5 双后端切换（`api/admin.py`）

`POST /api/admin/database/switch`：**只换连接、不迁移数据**——校验目标可达（PG 库不存在自动创建）→ 写 `data/db_config.json` → 重启生效，直接读取目标库现有数据（空库由 `init_db` 自动建表 + 播种默认知识库/虚拟根）。两侧数据互不影响，随时可切回；允许未重启时连续切换（纯配置写入）。

**开发模式自动重启**：touch `app/_reload_stamp.py`（被 `main.py` import、进入 Werkzeug StatReloader 监听列表，与改源码触发的热重启同一机制）。⚠️ 不要用 `os._exit` 自杀式退出触发重启——在部分平台上会与请求线程竞争导致重启丢失（已踩坑移除）。

**跨库一致性**：模型层 `_iso()` 把时间戳统一为无时区偏移的本地时间字符串（SQLite naive 与 PG timestamptz 归一）。

> `migrate_children_order.py` 是旧库迁移脚本；新库自动播种虚拟根，无需手动运行。

## 4. 树形结构设计

### 4.1 虚拟根 + children_order

- **虚拟根**：id=0 的 Post 行，所有查询以 `Post.id != ROOT_ID` 过滤它
- **知识库**：顶级文章顺序存 `workspaces.children_order`（升级迁移时从虚拟根拷贝）；**树接口按知识库返回**（缺省 = id 最小的库）
- **每节点 `children_order`**：父节点记录自己的直接子节点顺序（拖拽排序写入）
- 工具函数（`utils/tree_order.py`）：`get_children_order` / `set_children_order` / `append_child` / `remove_child` / `insert_child`

### 4.2 树接口组装（`api/posts.py::get_post_tree`）

1. 一次查询取出全部文章（不含虚拟根），浏览计数随行返回
2. 内存构建 `post_map` + 递归 slug 计算（带缓存）
3. 按 `parent_id` 挂接 children，再按各级 `children_order` 排序

### 4.3 层级限制

`MAX_LEVEL = 2`（共 3 层）。创建与移动父文章时校验，超出返回 400。

## 5. Slug 计算策略

slug = 从根到本节点的 `name` 路径，如 `/java/java8`。

| 场景 | 实现 |
|---|---|
| 列表接口 | `build_slug_map(session)`：**一次查询**全表 `(id, name, parent_id)`，内存逐级回溯（带缓存），一次算出所有文章的 slug |
| 详情接口（×3） | 同上，单次构建映射后取 post/parent/children 的 slug |
| 创建 | `build_full_slug(post_id, session)`：单篇逐级回溯（首建时更便宜） |
| name 唯一性 | **知识库内唯一**（create/update 校验加 `workspace_id` 条件）；父文章必须同库；不支持跨库移动 |
| 改名 | `update_slug_for_subtree`：BFS 收集受影响子树 → 内存计算新 slug → 仅更新有变化的行（**级联子孙**） |
| 移动父文章 | 同上；另校验"不能选自己/自己的子孙为父"（`parent_of` 内存父链判定） |

> 历史包袱：`slug` 列持久化在库里（`/path/<slug>` 接口按它查询），因此改名/移动必须级联维护，否则路径查询失效。

## 6. 浏览计数与最近浏览

- 每次计浏览的详情请求 `UPDATE view_count + 1` 并刷新 `last_viewed_at`（`?no_view=1` 前端预取两者都跳过）
- `last_viewed_at` 列由 `db.py` 的幂等迁移补列（`_ensure_workspace_migration` 内，SQLite/PG 同语法）
- `GET /api/posts/recent` 按 `last_viewed_at` 倒序取最近浏览（跨库、不含正文）

`utils/view_count.py`，**直接读写数据库（SQLite/PG 通用），实时生效，无缓存层**：

| 操作 | 实现 |
|---|---|
| 详情接口自增 | `increment_view` → `UPDATE posts SET view_count = view_count + 1` 立即提交 |
| 单篇/批量读取 | `get_view_count` / `get_all_view_counts`（单条 `IN` 查询） |
| 删除文章 | 随行删除，无独立清理 |

## 7. 应用工厂与中间件

`main.py::create_app()`：

1. `CustomJSONProvider`（`ensure_ascii=False`，中文不转义）
2. `CORS`：`/api/*` 放开 `*`，方法 GET/POST/PUT/DELETE/OPTIONS，头 Content-Type/Authorization
3. `init_db(app)`（读 db_config.json → 建库 + 播种虚拟根 + SQLite PRAGMA）
4. **gzip after_request**：响应为 `application/json` 或 `text/*`、体积 ≥1KB、未编码且客户端接受时压缩（`compresslevel=6`），设 `Content-Encoding: gzip` 与 `Vary: Accept-Encoding`；`direct_passthrough` 的文件流不压缩
5. 全局异常处理：HTTPException 按状态码返回信封；未知异常 500 + 日志（`exc_info`）
6. 404/400 专用 handler
7. 蓝图：`auth_bp` / `posts_bp` / `images_bp` / `admin_bp`；`/` 与 `/health` 免认证

> 请求日志依赖 Werkzeug access log，无自定义 before_request 重复记录。

## 8. 认证

- Flask-HTTPAuth `HTTPBasicAuth`（实例在 `api/auth.py`），用户名/密码读 `settings.auth_username/auth_password`，错误统一 401 信封
- 所有业务蓝图视图（含 admin）挂 `@auth.login_required`
- **无限流**（已整体移除 Flask-Limiter）

## 9. 图片服务与安全围栏

- 上传：`POST /api/images/upload`（multipart `file`），白名单 `.png .jpg .jpeg .gif .webp .bmp .avif`（不含 svg），≤10MB，uuid 主文件名落盘 `data/images/`
- 下载：围栏 + 扩展名白名单校验（见 api.md 图片 API 一节）

`api/images.py`：

- `POST /api/images/upload`：multipart 字段 `file`（需认证）；上传白名单 `.png .jpg .jpeg .gif .webp .bmp .avif`（**不含 svg**，防动态内容回显）、≤10MB（流式读取时校验）；uuid 随机主文件名防碰撞/注入，落盘 `data/images/`
- `GET /api/images/...`（下载）：
  1. `type` 决定解析基准：缺省 → `data/images/`；`relative` → 项目根；`absolute` → 视为绝对路径
  2. `_resolve_within_fence(base_dir, raw_path)`：绝对/相对路径 → `os.path.realpath` 归一化 → **必须落在基准目录内**（`real == fence or startswith(fence + sep)`），否则 None → 404
  3. 扩展名白名单：`.png .jpg .jpeg .gif .webp .svg .ico .bmp .avif`
  4. 通过后 `send_file(full_path)`（文件流，不走 gzip）

## 10. 配置

`app/config.py::Settings`（模块级单例 `settings`）：

| 配置 | 默认值 | 说明 |
|---|---|---|
| `host` / `port` | `0.0.0.0` / `60100` | 监听 |
| `debug` | `True` | **生产必须关**（Werkzeug 调试器风险） |
| `secret_key` | dev 值 | Flask 密钥 |
| `cors_origins` | `*` | CORS |
| `auth_username` / `auth_password` | `admin` / `lizy111A` | Basic Auth 凭据 |
| `database_backend` | `sqlite` | 默认后端；运行时以 `data/db_config.json` 为准 |
| `postgres_*` | `localhost/5432/postgres//doublog` | PG 连接默认值（host/port/user/password/dbname） |
| `data_dir` / `images_dir` | `<根>/data[/images]` | 数据与图片目录 |
| `max_page_size` / `default_page_size` | `100` / `20` | 分页 |

> 测试通过 monkeypatch `settings.data_dir` 注入独立临时 SQLite。

## 10.5 双链与导出

- 双链语法 `[[name]]` / `[[标题]]` / `[[name|显示文字]]` 的**渲染**在前端（`md.js` 插件 + `applyWikiLinks`）
- 后端 `GET /api/posts/id/<id>/backlinks`：同库内扫描正文 `[[...]]` 目标（先 name 后 title 精确匹配）返回反链列表
- 导出 `GET /api/export/markdown`（`app/api/export.py`）：全库 Markdown zip（树形嵌套 + frontmatter + images/ + 图片 URL 相对化重写）；**必须排除虚拟根 id=0**——存量库根挂在默认知识库下，否则树递归死循环（有深度 32 保护兜底）

## 11. 测试

```bash
cd backend && python -m pytest tests/ -q   # 69 个用例
```

- **conftest**：每个用例独立临时 SQLite（`tmp_path` 注入 `settings.data_dir`）。**完全自包含，无任何外部依赖**
- **覆盖**：auth 5 例；posts 27 例——创建校验（必填/格式/唯一/层级）、列表与树**无正文**、详情含正文、**浏览计数实时自增**、分页、改名/移动的 **slug 级联**、自父/子孙父拒绝、删除（提升/recursive）、图片围栏（正常 200、扩展名 404、三类穿越 404）、gzip、拖拽排序
- **admin 8 例**：状态/连通性（含不可达 400）/切换校验（同后端拒绝、不可达拒绝）+ **真实 SQLite↔PostgreSQL 往返集成测试**（`pgserver` 内嵌 PG 起真实实例：切换 → 逐字段校验（parent_id 回填/level/浏览计数/虚拟根/知识库归属/序列重置）→ 未重启防护 → 切回 → 数据完整）
- **workspaces 15 例**：CRUD、空库/末库删除保护、**库间树与列表隔离**、同名文章跨库可建/同库拒绝、跨库父子/移动拒绝、默认库自动创建与回填、顶级排序归属知识库
- PG 集成测试可选依赖 venv 内 `pip install pgserver`，未安装自动跳过
- 新增后端行为**必须**附带测试（见 AGENTS.md）

## 12. 已知限制

1. AuditLog 只增不删，长期运行膨胀
2. `debug=True` + `0.0.0.0` 仅为开发配置，公网部署需收敛
3. 移动子树时子孙的 `level` 列不重算（slug 已级联，level 仅展示用途时的既有行为）
4. 数据库切换在生产模式下需手动重启；切换期间的并发写入可能丢失（单用户场景可忽略）
5. PG 切换依赖 `psycopg2-binary`；目标库不存在会自动创建，但 PG 服务本身需自备
