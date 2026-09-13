<p align="center">
  <h1 align="center">DouBlog</h1>
  <p align="center">前后端分离的单用户博客 / 知识库系统，树形文章结构 + 全功能 Markdown 渲染</p>
</p>

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | **AI 代理/协作者工作指南**：命令、验证清单、**文档同步规则**（改代码必读） |
| [api.md](api.md) | HTTP API 契约：认证、文章/日志/图片接口、错误码、实测示例 |
| [backend.md](backend.md) | 后端架构：数据模型、树形设计、双数据库切换、中间件、测试 |
| [frontend.md](frontend.md) | 前端架构：API 层、Markdown 渲染管线、页面组件、构建部署 |
| [backend-prompt.md](backend-prompt.md) | ⚠️ 历史存档（开发期 AI 提示词，不随代码更新） |

> **贡献约定**：修改代码时按 [AGENTS.md](AGENTS.md) 的"文档同步规则"在同一批改动中更新对应文档。

## 项目简介

DouBlog 是一个单用户个人博客系统：

- **后端** Flask 3，提供文章 CRUD、树形结构、图片服务、浏览计数、操作审计；支持 **SQLite / PostgreSQL 双数据库一键切换**（只换连接读新数据，不迁移，随时可切回）
- **前端** React 19 + Vite 8 + Tailwind CSS 4，集成 markdown-it 全家桶渲染、KaTeX 数学公式、Mermaid 图表、代码高亮
- **多知识库**：文章按知识库分组隔离（首页切换器一键新建/切换，`/?ws=<id>` 记忆当前库）
- **全文搜索**：关键词匹配标题/摘要/英文名/正文，跨知识库，`Ctrl+K` 快速聚焦
- **双链 `[[wiki]]` + 反向链接**：`[[英文名]]`/`[[标题]]`/`[[名|显示文字]]` 三种写法，文末自动聚合"谁链接了我"
- **图片上传**：编辑器内粘贴/拖拽/按钮上传（自动插入 Markdown），10MB 上限 + 类型白名单
- **最近浏览**：首页按最近阅读横条快速回访（跨知识库，hover 预取不虚增浏览量）
- **导出备份**：单篇页“导出”按钮下载该文 `.md`（frontmatter + 图片 URL 绝对化）；管理页一键导出全库 Markdown + 图片 zip（树形目录 + frontmatter，Obsidian 可直接导入）
- **编辑器**：快捷键（`Ctrl+S` 保存、`Ctrl+B/I` 加粗斜体、`Ctrl+K` 链接、`Tab` 缩进）、预览同步滚动、表格/图表/代码块模板
- **移动端适配**：知识库切换、阅读、搜索在手机可用（导航自适应换行）
- 文章支持**最多 3 层**父子结构（`MAX_LEVEL = 2`，即 level 0/1/2），侧边栏树形展示、拖拽排序
- 单用户 HTTP Basic Auth 认证，所有 API 需携带凭据

## 技术栈

| 层级 | 技术 |
|---|---|
| 后端框架 | Flask 3.0 |
| ORM / 数据库 | Flask-SQLAlchemy 3.1 / SQLite（WAL 模式） |
| 认证 | Flask-HTTPAuth（Basic Auth） |
| 数据库 | SQLite（WAL，默认）/ PostgreSQL（psycopg2，可切换） |
| 前端框架 | React 19 + React Router 7 |
| 构建 | Vite 8 |
| 样式 | Tailwind CSS 4 |
| Markdown | markdown-it 14 + 12 个插件 |
| 数学公式 | KaTeX（`$...$` / `$$...$$`） |
| 图表 | Mermaid 11 |
| 代码高亮 | highlight.js（common 常用语言子集） |
| 搜索 | Fuse.js（客户端模糊搜索） |
| 拖拽排序 | dnd-kit |

## 项目结构

```
DouBlog/
├── README.md
├── api.md                    # API 协议文档
├── backend.md                # 后端设计文档
├── backend-prompt.md         # 后端 AI 开发提示词
├── backend/                  # 后端 (Flask)
│   ├── run.py                # 启动入口 (端口 60100)
│   ├── requirements.txt
│   ├── migrate_children_order.py  # 旧数据迁移脚本（虚拟根节点）
│   ├── app/
│   │   ├── main.py           # 应用工厂 + gzip 压缩 + 全局异常
│   │   ├── config.py         # 配置
│   │   ├── db.py             # 双后端初始化(SQLite/PG) + db_config.json + 虚拟根播种
│   │   ├── models/models.py  # Post / AuditLog 模型
│   │   ├── api/              # auth / posts / images / admin / workspaces / export 蓝图
│   │   └── utils/            # response / tree_order / view_count / audit
│   └── tests/                # pytest（自包含,PG 集成测试可选依赖 pgserver）
├── frontend/                 # 前端 (React)
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js        # 端口 60101
│   └── src/
│       ├── main.jsx          # 入口
│       ├── App.jsx           # 首页 / 归档 / 布局 / 搜索
│       ├── PostDetail.jsx    # 详情页（目录 / 树 / 拖拽 / lightbox）
│       ├── CreatePost.jsx    # 新建（实时预览）
│       ├── EditPost.jsx      # 编辑
│       ├── api.js            # 统一 API 客户端（认证 / 分页拉取）
│       ├── md.js             # markdown-it 配置与定制渲染 + 双链 + mermaid 统一入口
│       ├── useEditorShortcuts.js    # 编辑器快捷键
│       ├── useEditorEnhancements.js # 图片上传/同步滚动/块模板
│       └── index.css
├── data/                     # 运行时数据（gitignore）
│   ├── blog.db               # SQLite 数据库
│   └── images/               # 图片文件
└── shell/                    # 管理脚本（Linux/macOS/Git Bash）
```

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 18+
- PostgreSQL（可选）：默认使用 SQLite 零配置；需要 PG 时在管理页一键切换

### 1. 启动后端（端口 60100）

```bash
cd backend
python -m venv venv
venv/Scripts/activate        # Windows
# source venv/bin/activate   # Linux/macOS
pip install -r requirements.txt
python run.py
```

首次启动自动建表、播种虚拟根节点（id=0）、创建"默认知识库"并把存量文章归入其中（幂等迁移）。

### 2. 启动前端（端口 60101）

```bash
cd frontend
npm install
npm run dev
```

### 3. 访问

打开 **http://localhost:60101**

默认凭据（Basic Auth）：`admin` / `lizy111A`

> 前端不经过代理，直接请求 `http://{当前主机名}:60100`（CORS 已放开）。
> 凭据集中定义在 `frontend/src/api.js`，修改一处即可全局生效。

## 生产部署

开发脚本只适合本机调试；对外提供服务请使用构建产物：

```bash
cd frontend
npm run build               # 产物在 frontend/dist/
npx vite preview --host 0.0.0.0 --port 60101   # 或交给 nginx 等静态服务器
```

或使用管理脚本（自动定位项目目录）：

```bash
bash shell/backend/start.sh          # 启动后端
bash shell/frontend/start.sh         # 构建 + preview 启动前端（生产模式）
bash shell/frontend/start.sh dev     # 前端开发模式（Vite dev server）
bash shell/backend/status.sh         # 查看状态
bash shell/backend/stop.sh           # 停止
```

> 注意：`backend/app/config.py` 中 `debug=True` 与 `host='0.0.0.0'` 仅供开发使用，公网部署务必关闭 debug 并收敛监听地址与 CORS。

## 配置说明

### 后端（`backend/app/config.py`）

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `host` / `port` | `0.0.0.0` / `60100` | 监听地址 |
| `debug` | `True` | 调试模式（生产必须关闭） |
| `cors_origins` | `*` | CORS 允许来源 |
| `auth_enabled` | `True` | 是否启用认证 |
| `auth_username` / `auth_password` | `admin` / `lizy111A` | 登录凭据 |
| `database_backend` | `sqlite` | 默认后端（运行时以 `data/db_config.json` 为准） |
| `postgres_host/port/user/password/dbname` | `localhost/5432/postgres//doublog` | PG 连接默认值 |
| `data_dir` / `images_dir` | `<根目录>/data[/images]` | 数据与图片目录 |
| `max_page_size` | `100` | 分页上限 |

### 前端

- 端口：`vite.config.js` 中 `server.port = 60101`
- 后端地址与凭据：`src/api.js`

## API 概览

统一响应格式：`{ "success": bool, "code": int, "message": str, "data": any }`；全部 `/api/*` 接口需 Basic Auth；JSON 响应超过 1KB 自动 gzip。

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/auth/login` | 登录校验 |
| `GET` | `/api/auth/check` | 检查认证状态 |
| `GET` | `/api/posts` | 文章列表（分页；**不含正文**；`?workspace_id=` 按库筛选） |
| `GET` | `/api/posts/tree` | 文章树（**不含正文**，按知识库返回，缺省 = 默认库） |
| `GET` | `/api/posts/id/<id>` | 详情（含正文，自增浏览量；`?no_view=1` 预取不计） |
| `GET` | `/api/posts/recent?limit=` | 最近浏览（跨库，按时间倒序） |
| `GET` | `/api/posts/id/<id>/backlinks` | 反向链接（同库内 `[[双链]]` 指向该文章的列表） |
| `GET` | `/api/posts/slug/<name>` | 按英文名查详情 |
| `GET` | `/api/posts/path/<slug>` | 按路径查详情（兼容旧版） |
| `POST` | `/api/posts` | 创建 |
| `PUT` | `/api/posts/id/<id>` | 更新（改名/移动会级联更新子孙 slug） |
| `DELETE` | `/api/posts/id/<id>[?recursive=1]` | 删除（默认子文章提升为顶级；recursive 级联删除） |
| `PUT` | `/api/posts/reorder` | 拖拽排序 |
| `GET` | `/api/posts/audit-logs` | 操作日志（分页） |
| `GET` | `/api/images[...]?type=` | 图片服务（见下） |
| `POST` | `/api/images/upload` | 上传图片（multipart `file`，返回可写入 Markdown 的 url） |
| `GET` | `/api/export/markdown` | 导出全库 Markdown + 图片 zip 备份 |
| `GET` | `/api/admin/database` | 数据库状态（当前后端/数据量） |
| `POST` | `/api/admin/database/test` | 测试目标数据库连通性 |
| `POST` | `/api/admin/database/switch` | **迁移数据并切换后端**（SQLite ↔ PostgreSQL） |

### 图片服务规则

- **上传**：`POST /api/images/upload`（multipart 字段 `file`），白名单 png/jpg/jpeg/gif/webp/bmp/avif（不含 svg），单文件 ≤10MB，随机文件名落盘 `data/images/`，返回 `{url}`
- `type` 缺省：从 `data/images/` 目录解析
- `type=relative`：相对项目根目录
- `type=absolute`：绝对路径
- **安全约束**：所有路径经 realpath 归一化后必须落在项目根目录（或 images 目录）围栏内，且扩展名必须在白名单（png/jpg/jpeg/gif/webp/svg/ico/bmp/avif）内，否则 404

## Markdown 渲染能力

文章正文由 `frontend/src/md.js` 渲染，支持（共 40+ 项，均经实测）：

- **基础**：6 级标题（ATX/Setext）、粗体、斜体、删除线、行内代码、两种硬换行、转义、有序/无序/嵌套/任务列表、引用（嵌套）、GFM 表格（三种对齐）、三种分隔线
- **链接图片**：行内/引用式链接、自动链接、裸 URL 与邮箱自动识别、图片标题自动生成 figure 图注、行内 HTML 直通、HTML 实体
- **代码块**：190+ 语言高亮 + 语言标签 + 复制按钮、`~~~` 围栏、`{.line-numbers}` 行号、`{data-highlight="2,4-6"}` 行高亮
- **扩展**：`==高亮==`、上下标 `H~2~O` / `X^2^`、脚注（含行内脚注）、定义列表、缩写、`::: tip/info/warning/danger` 容器、GitHub Alerts（5 种）、`{#id .class}` 属性
- **图表公式**：Mermaid（流程图/时序图等）、KaTeX 行内与块级公式（含矩阵）
- **双链**：`[[文章英文名]]` / `[[文章标题]]` / `[[名|显示文字]]`（同库解析，未找到显示灰色虚线；代码块内不生效）
- **智能排版**：`(c)`→©、`--`→–、`...`→…、智能引号等
- **Emoji**：`:name:` 代码（内置 light 词典 150 个，注意 `:+1:` `:rocket:` 等**不在**词典内）+ `:)` `<3` 等颜文字快捷转换

## 测试

```bash
cd backend
python -m pytest tests/ -q
```

测试完全自包含（每用例独立临时 SQLite，无外部依赖）；其中 SQLite ↔ PostgreSQL 切换往返的集成测试需要 venv 内安装 `pgserver`（内嵌 PG，`pip install pgserver`），未安装时自动跳过。

## 已知限制

- 单用户 Basic Auth：凭据在前端 bundle 中可见（`src/api.js`），仅适合个人/内网使用
- 文章层级上限 3 层（`MAX_LEVEL = 2`）
- 导航"归档"链接 `/archive` 未注册路由（死链），且无 404 兜底页
