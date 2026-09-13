# AGENTS.md — DouBlog 代理工作指南

> 本文件供 AI 代理（及人类协作者）在本仓库工作前阅读。**每次会话开始先读本文件与"文档同步规则"。**

---

## 项目是什么

单用户博客/知识库：**Flask 3 后端**（60100，SQLite 默认 / PostgreSQL 可一键切换，**只换连接读新数据不迁移**）+ **React 19 前端**（60101，Vite + Tailwind 4）。文章按**知识库（Workspace）**分组隔离（库间树/列表互不可见，name 库内唯一，不支持跨库移动），支持 3 层树形结构（虚拟根 id=0，顶级顺序存 `workspaces.children_order`）、拖拽排序、Markdown 全功能渲染（markdown-it 12 插件 + KaTeX + Mermaid + highlight.js）。知识库特性：**双链 `[[wiki]]` + 反向链接、图片上传（粘贴/拖拽）、最近浏览、Markdown zip 导出备份、SWR 预取**。**无 Redis、无限流、无定时任务**——浏览计数实时写库。

**必读文档索引**（都在仓库根目录）：

| 文档 | 内容 | 何时更新 |
|---|---|---|
| `README.md` | 面向使用者：快速开始、技术栈、配置、部署 | 改动影响使用方式/配置/部署时 |
| `api.md` | HTTP 接口契约（请求/响应/错误码/示例） | **任何** API 变更 |
| `backend.md` | 后端架构（模型/树设计/双数据库/中间件/测试） | 后端结构或行为变更 |
| `frontend.md` | 前端架构（API 层/渲染管线/页面/构建） | 前端结构或渲染行为变更 |
| `backend-prompt.md` | ⚠️ 历史存档（开发期 AI 提示词，**不更新**） | 永不（已标注历史） |
| `frontend/README.md` | 前端子目录入口，指向根文档 | 仅当命令变化 |

---

## 关键事实（改代码前必须知道）

1. **端口**：后端 `60100`、前端 `60101`
2. **凭据**：Basic Auth `admin` / `lizy111A`；前端唯一持有处在 `frontend/src/api.js`，后端在 `backend/app/config.py`
3. **双数据库**：运行时后端由 `data/db_config.json` 决定（sqlite/postgres）；切换走 `POST /api/admin/database/switch`——**只换连接不迁移数据**（空库自动建表播种，PG 库不存在自动创建；开发模式 touch `_reload_stamp.py` 自动重启，生产需手动重启）；前端管理页 `/admin`
4. **虚拟根节点**：id=0 的 Post 行；所有查询过滤 `id != 0`；建库时自动播种（`db.py`）
5. **知识库**：`workspaces` 表 + `posts.workspace_id`；树接口按库返回（缺省 = id 最小库）；顶级排序在库上、子级排序在父文章上；存量数据由 `_ensure_workspace_migration` 幂等迁移（ALTER + 回填 + 拷贝顶级顺序）
5. **层级上限 3 层**：`posts.py` 的 `MAX_LEVEL = 2`
6. **正文按需传输**：列表/树接口**不含** `content`，详情接口才有——别在列表序列化里把正文加回去
7. **slug 级联**：改名/移动父文章必须级联更新子孙 slug（`update_slug_for_subtree`），否则 `/path/<slug>` 查询失效
8. **图片接口**：GET（realpath 目录围栏 + 扩展名白名单）+ **POST `/api/images/upload`**（multipart `file`，白名单不含 svg，≤10MB，uuid 文件名落盘 `data/images/`）；编辑器粘贴/拖拽/按钮均走它
9. **双链**：渲染在前端（`md.js` 的 `wiki_link` inline 规则 + `applyWikiLinks`，`buildWikiMap` 从树构建映射，name 优先于 title）；后端 `/api/posts/id/<id>/backlinks` 同库扫描正文；改寻址规则时**前后端两处必须一致**
10. **导出**（`app/api/export.py`）：**必须排除虚拟根 id=0**——存量库根挂在默认知识库下，不排除会树递归死循环（另有 depth 32 兜底）；图片 URL 三种引用形式都要重写为相对 `images/` 路径
11. **SWR 预取**：链接 hover/focus → `prefetchPost`（`?no_view=1` **不计浏览量、不进最近浏览**）；详情页命中缓存即渲染、后台重拉覆盖；编辑保存/删除后 `invalidatePost`
12. **响应超 1KB 自动 gzip**（`main.py` after_request）
13. **测试完全自包含**（临时 SQLite，无外部依赖）；PG 切换集成测试可选 `pip install pgserver`（未装自动跳过）

### 本机环境注意（Windows）

- 后端虚拟环境：`backend/venv`（Windows 下 `venv/Scripts/python.exe`）
- shell 脚本兼容 Git Bash（lsof 缺失时自动回退 netstat）
- PG 切换的集成测试依赖 venv 内 `pgserver`（内嵌 PostgreSQL，`pip install pgserver`；注意其默认在宿主 Python 进程退出时停止 PG，长跑场景需常驻进程保活）

---

## 常用命令

### 后端

```bash
cd backend
./venv/Scripts/python.exe run.py            # 启动（60100）—— Windows Git Bash
./venv/Scripts/python.exe -m pytest tests/ -q   # 测试（69 用例，自包含）
./venv/Scripts/pip.exe install -r requirements.txt
```

### 前端

```bash
cd frontend
npm run dev        # 开发（60101）
npm run build      # 生产构建（验收门槛，必须零报错）
npx vite preview --host 0.0.0.0 --port 60101
```

### 管理脚本（Linux/macOS/Git Bash）

```bash
bash shell/backend/start.sh | stop.sh | restart.sh | status.sh
bash shell/frontend/start.sh          # 生产模式：build + preview
bash shell/frontend/start.sh dev      # 开发模式
```

---

## 修改代码的规则

### 硬性规则

1. **前端发请求只走 `src/api.js`**：新增接口调用就往 `api.js` 加函数。禁止在组件里出现 `btoa(`、裸 `fetch(`、硬编码 `:60100`
2. **后端响应统一走 `api_response`**（`utils/response.py`），新接口必须挂 `@auth.login_required`（auth 蓝图除外）
3. **新后端行为必须带测试**：在 `backend/tests/` 加用例（conftest 提供隔离的临时 SQLite，无外部依赖）
4. **SQLite 连接保持现状**：WAL + busy_timeout 已配好；不要引入需要单独迁移服务的东西
5. **不新增重量级依赖**；确需新增时同步更新 `requirements.txt`/`package.json` 并在本文件"关键事实"里注明坑

### 渲染管线（`src/md.js`）修改注意

- 改 GitHub Alert/图片/fence/`==mark==` 规则后，用仓库演示文章《Markdown 语法完全指南》（post id 以线上为准）在浏览器过一遍全要素
- emoji 只有 light 词典（150 个）；别在文档里宣称支持 `:+1:` `:rocket:` 等

---

## 验证清单（每次改动后执行，全过才算完成）

| 改动范围 | 必做验证 |
|---|---|
| 后端 | `pytest tests/ -q` 全过；重启服务后 `curl http://localhost:60100/health` |
| 后端 API | 用 curl 过一遍改动的接口（含错误分支）；涉及树/slug 的验证级联正确性 |
| 前端 | `npm run build` 零报错；浏览器走查首页/详情/新建/编辑四页 |
| 渲染 | 演示文章页检查：mermaid 出图、KaTeX、代码块高亮/行号、GitHub Alerts 无标记泄漏、图片加载 |
| 图片/路径安全 | 越界路径（`C:/Windows/win.ini`、`../`）→ 404，`data/images/` 内正常文件 → 200；上传：正常 png → 200 且 URL 可取回，svg/空文件 → 400 |
| 双链/导出 | 双链三种写法渲染 + 未找到置灰 + 代码块豁免；反链列表正确；导出 zip 解包含 frontmatter/嵌套目录/images 且图片 URL 已重写 |
| 数据库切换 | 管理页 `/admin` 或 curl：测试连接 → 切到空 PG（应只剩默认库 0 文章）→ 切回 sqlite（原数据原封不动）→ 日志确认两次 `Restarting with stat` |
| 知识库 | 首页选择器新建库 → 在新库发文章 → 默认库不可见 → 详情侧边栏仅同库文章 |

---

## 📌 文档同步规则（联动更新，强制）

> **核心规则：代码与文档在同一批改动里更新。没有"以后补文档"——收尾时文档必须与代码一致，这是验收的一部分，与测试同等重要。**

### 变更 → 文档 映射表

| 你改了什么 | 必须同步更新 |
|---|---|
| 接口新增/删除/参数/响应字段/错误码 | `api.md` 对应小节（含示例）；若影响使用方式，`README.md` 的 API 概览表 |
| 数据库切换/双后端行为/迁移逻辑 | `api.md` 管理端章节 + `backend.md` 第 3.5 节 + 管理页（`frontend.md`） |
| 知识库行为（隔离/唯一性/排序归属） | `api.md` 知识库与文章章节 + `backend.md` 第 3/4 章 + `frontend.md` 对应页面小节 |
| 后端模型/树设计/数据库切换/中间件/安全逻辑 | `backend.md` 对应章节；若属"已知限制"的修复，删除对应条目 |
| 后端配置项、端口、依赖 | `README.md` 配置表；依赖坑写进本文件"关键事实" |
| 前端 api.js、渲染管线、页面结构、构建方式 | `frontend.md` 对应章节 |
| 测试结构/conftest 行为 | `backend.md` 第 12 节 |
| 启动/部署方式、shell 脚本 | `README.md` 快速开始/生产部署两节 |
| 新增已知限制或技术债 | 对应架构文档的"已知限制"节 **和** `README.md` 的"已知限制"节（两处都要） |
| 常用命令/验证流程/关键事实变化 | **本文件（AGENTS.md）** |

### 执行约定

1. **开始改代码前**：先读对应文档小节，确认文档描述与代码现状一致（发现不一致 = 先修文档再动手）
2. **收尾自检**：对照映射表逐项检查，`git diff` 里代码与文档改动应在同一批
3. **写文档的标准**：只写**当前真实行为**（最好有实测依据），不写愿景；过时内容直接删除或移入 `backend-prompt.md` 式的历史标注，不留"两套说法"
4. **示例优先**：API 文档的示例应来自真实响应（curl 实测），不要手编

---

## 已知未修复问题（接手时注意，避免误判为新 bug）

1. AuditLog 无清理策略
3. 移动子树不重算子孙 `level` 列（slug 已级联，level 陈旧仅影响展示）
4. 前端 `/archive` 死链（导航有链接但未注册路由）、无 404 兜底页
5. 生产模式下数据库切换需手动重启；切换期间的并发写入可能丢失（单用户可忽略）

修复以上任一项后：从本列表和 `README.md`/`backend.md`/`frontend.md` 的"已知限制"中**同时移除**对应条目。
