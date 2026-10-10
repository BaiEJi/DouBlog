# blog 模块（博客 / 知识库）

> 模块文档，**2026-10-10 生成**，来源：`backend/app/blog/**`、`backend/tests/blog/`、`frontend/src/blog/**`（api.md 第 3/4/5/7/8 节为接口契约正本，本文与其交叉验证、不重复抄示例）。
> 骨架契约（`run_db` / `api_response` / `require_basic` / 模块三契约）见 `docs/fastapi-migration.md` 与 `backend.md` 第 2 节。

---

## 1. 功能概述

单用户博客/知识库，系统的第一个能力包（stone 视觉基准模块）。核心能力：

| 能力 | 说明 |
|---|---|
| 知识库（Workspace）隔离 | 文章按库分组：库间树/列表互不可见；`name` 库内唯一；不支持跨库移动/父子；删除保护（非空库、最后一个库不可删） |
| 3 层树形结构 | 虚拟根 id=0；顶级顺序存 `blog_workspaces.children_order`，子级顺序存父文章 `children_order`；拖拽排序（dnd-kit） |
| 双链 | `[[name]]` / `[[标题]]` / `[[名\|显示文字]]`；**渲染在前端**（`md.js` wiki_link + `applyWikiLinks`），**反链在后端**（同库扫描正文） |
| 图片 | 粘贴/拖拽/按钮上传（uuid 文件名落盘 `data/images/`）+ 目录围栏下载；上传白名单不含 svg、下载白名单含 svg |
| 导出 | 全库 Markdown zip 备份（管理页）+ 单篇 .md 纯前端导出（详情页） |
| 最近浏览 | `last_viewed_at` 倒序跨库横条（首页）；仅真实浏览计入，预取不计 |
| SWR 预取 | 链接 hover/focus → `prefetchPost(?no_view=1)`；详情页命中缓存即渲染、后台重拉覆盖；保存/删除后 `invalidatePost` |
| 其他 | 浏览计数实时写库、操作审计（AuditLog）、keyword 全文搜索（标题/摘要/英文名/正文，跨库）、gzip（全局中间件 ≥1KB） |

模块包契约：`app/blog/__init__.py` 导出 `router`（挂 posts/images/workspaces/export 四个子 router）+ `ensure_migrations(engine)`；无 `start_background`（本模块无后台线程）。

---

## 2. 数据模型（`app/blog/models.py`）

三表均在共享库，表名规则 `模块名_表名`（存量旧表由 `db.py` 启动 RENAME 幂等改名，见 backend.md 3.3）。

### 2.1 `blog_workspaces`（知识库）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | Integer PK | 自增 |
| `name` | String(100) NOT NULL, **unique** | 库名，DB 级全局唯一 |
| `description` | String(500) | 描述 |
| `children_order` | Text | **该库顶级文章顺序** JSON 数组（子级顺序在 Post 上） |
| `created_at` / `updated_at` | DateTime(timezone=True) | `server_default=now()`，updated_at 带 `onupdate` |

`to_dict(post_count=None)`：post_count 由路由层聚合查询传入。

### 2.2 `blog_posts`（文章）

| 列 | 类型/约束 | 说明 |
|---|---|---|
| `id` | Integer PK | 自增；**id=0 保留给虚拟根**（建库时 `db.py` 播种） |
| `title` | String(200) NOT NULL | 标题 |
| `name` | String(100) NOT NULL, **index** | 英文名/URL 路径段；**应用层校验库内唯一**（DB 无唯一约束） |
| `slug` | String(500), index | 完整路径（`/a/b/c`），持久化列，改名/移动时级联维护 |
| `content` / `summary` | Text | Markdown 正文 / 摘要 |
| `workspace_id` | FK→blog_workspaces.id, index | 所属知识库（迁移补列） |
| `parent_id` | FK→blog_posts.id ON DELETE SET NULL, index | 父文章；顶级 = 0（虚拟根） |
| `level` | Integer, default 0 | 0~2（`MAX_LEVEL = 2`，共 3 层） |
| `children_order` | Text | 本节点子文章顺序 JSON，如 `[3,1,5]` |
| `author` | String(50), default 'admin' | 固定单用户 |
| `status` | String(20), index, default 'published' | `published` / `archived` |
| `is_top` | Boolean, default False | 置顶（列表排序优先） |
| `view_count` | Integer, default 0 | 浏览计数（实时 UPDATE） |
| `last_viewed_at` | DateTime | 最近浏览时间（**仅真实浏览**刷新；迁移补列） |
| `tags` / `meta_data` | Text | JSON |
| `created_at` / `updated_at` | DateTime | 同上 |

序列化：`to_dict(include_content=True)` 全量，**列表传 `False` 剔除正文**；`to_tree_dict()` 恒不含 `content`、附空 `children` 数组与 `children_order`（解析后的数组）。

### 2.3 `blog_audit_logs`（操作日志）

`action`（create/update/delete）、`resource_type`（**post / workspace**，image 为历史预留）、`resource_id`、`detail`(JSON)、`ip_address`、`created_at`。只增不删，无清理策略。

### 2.4 树与 slug 设计

- **虚拟根**：id=0 的 Post 行，所有查询 `Post.id != ROOT_ID`（`services/tree_order.ROOT_ID`）；树接口组树时 `parent_id in (0, None)` 视为顶级。
- **层级上限**：`MAX_LEVEL = 2`（level 0/1/2 共 3 层）；创建时父文章**单次查询**复用于层级/归属校验与 children_order 追加（父 level+1 超限 → 400），移动时校验新父 `level >= MAX_LEVEL` → 400。
- **slug**：根到本节点 `name` 路径。创建时由父文章已存 slug 直推（空 slug 存量行回退 `build_full_slug` 逐级回溯兜底）；列表/详情用 `_fetch_ancestors`+`_slug_from_rows` **按需祖先链**（≤3 层 IN 小查询，页内全为顶级时零额外查询）；`build_slug_map`（全表一次查询 + 内存回溯缓存）保留为批量工具，热路径不再使用。
- **级联**：改名或移动后 `update_slug_for_subtree`——单次查询全表 → BFS 收集受影响子树 → 内存算新 slug → 仅更新有变化行。`/path/<slug>` 按 slug 列查询，不级联则失效。
- **排序归属**：顶级顺序写 `workspaces.children_order`（`PUT /reorder` 带 `parent_id=0` + `workspace_id`）；子级写父文章 `children_order`。`children_order` 里的悬挂 id（已删文章）不影响树渲染（按 id 过滤缺失项）。
- **name 校验**：`validate_slug` = 英文字母开头 + 仅字母/数字/连字符 + 总长 3-100（`^[a-zA-Z][a-zA-Z0-9-]*$` + len 检查；前端 `NAME_RE = /^[a-zA-Z][a-zA-Z0-9-]{2,99}$/` 与之等价）。

### 2.5 幂等迁移（`services/migrations.py::ensure_migrations`）

由骨架 `init_db` 在存量表 RENAME 之后、create_all 之后调用：① `blog_posts` 缺 `workspace_id` → ALTER 补列 + 建索引 `ix_blog_posts_workspace_id`（sqlite/pg 同语法）；② 缺 `last_viewed_at` → 补列；③ 无任何知识库 → 建"默认知识库"，**并把虚拟根(id=0)的 children_order 拷贝为初始顶级顺序**；④ `workspace_id IS NULL` 的存量文章全部回填默认库。

---

## 3. API 契约（`routes/*.py`）

**鉴权**：posts / workspaces / export 三个 router 级挂 `Depends(require_basic)`，images 的 upload 路由级挂；**图片 GET 两入口免认证**（历史沿用，uuid 文件名为主要防线）。`require_basic` 为统一认证依赖：**会话 Cookie 优先**（`/api/auth/login` 签发 HttpOnly `doublog_session`，HMAC 签名 30 天），其次 `Authorization: Basic`（curl/API 工具/测试）。失败统一 401 信封。响应统一 `api_response` 信封 `{success, code, message, data}`。

### 3.1 文章 `routes/posts.py`（prefix `/api/posts`）

| 方法/路径 | 参数 | 响应要点 | 错误 |
|---|---|---|---|
| `GET /api/posts` | query: `page`(1)/`page_size`(20, 上限 `settings.max_page_size`=100)/`workspace_id`/`parent_id`/`status`/`keyword`（LIKE 匹配 title/summary/name/**content**；不带 workspace_id 跨库） | `items`（**无 content**，含 `slug`、`children_count`、实时 `view_count`）+ `total/page/page_size/total_pages`；排序 `is_top DESC, id ASC` | — |
| `GET /api/posts/tree` | query: `workspace_id`（缺省 = id 最小库） | 该库整树（**无 content**；节点含 `children_order`、`children` 递归）；顶级按库 children_order、子级按父 children_order 排序；库空返回 `[]` | 404 知识库不存在 |
| `GET /api/posts/id/{id}` | query: `no_view=1`（不计浏览、不进最近浏览；前端预取专用） | 详情（含 `content`）+ `parent`（顶级无此键）+ `children`（按 children_order 排序，`{id,title,name,slug,level}`）+ `slug`/`view_count` | 404 文章不存在 |
| `GET /api/posts/slug/{name}` | path: name（**按 name 匹配，无库过滤**） | 同详情（计浏览；不支持 no_view） | 404 |
| `GET /api/posts/path/{slug}` | path: 完整路径（兼容旧版；先按 slug 列查，miss 后逐级按 name+parent 解析） | 同详情（计浏览） | 404 |
| `POST /api/posts` | body: `title`✅、`name`✅（或从 `slug` 末段解析）、`content`/`summary`/`workspace_id`（缺省默认库）/`parent_id`（缺省/0=顶级）/`status`/`is_top`/`tags`；坏/非 dict body 按空处理 | 201 + `{id,title,name,slug,workspace_id,level,created_at}`；创建即算 slug 并追加到父（或库）children_order | 400 标题不能为空 / 知识库不存在 / 英文名不能为空 / 英文名格式无效 / 该英文名已被使用（库内）/ 父文章已达最大层级限制（最多3层）/ 父文章不属于该知识库 |
| `PUT /api/posts/id/{id}`、`PUT /api/posts/slug/{name}` | body 部分更新：`title/content/summary/status/is_top/tags/name/parent_id`（共用 `_update_post`） | 200 + `{id,title,name,slug,level,parent_id,updated_at}`；改 name 级联子孙 slug；改 parent_id 从旧父（或库）order 移除、追加新父、级联子树 slug | 404；400 格式无效 / 已被使用 / 不能将自己设为父文章 / 父文章不存在 / 父文章已达最大层级限制 / 不能跨知识库移动文章 / 不能选择自己的子孙文章作为父文章 |
| `DELETE /api/posts/id/{id}?recursive=1`、`DELETE /api/posts/slug/{name}?recursive=1` | recursive 缺省 = 子文章提升为顶级（parent_id=0、level=0、追加库 order）；`=1` 递归删子孙 | 200 删除成功；同时从父（或库）children_order 移除 | 404 |
| `PUT /api/posts/reorder` | body: `parent_id`（0=库顶级）、`workspace_id`（parent_id=0 时用，缺省 id 最小库）、`children_order`（id 数组） | 200 排序更新成功（乐观写整组，悬挂 id 不校验） | 404 知识库不存在 / 父节点不存在 |
| `GET /api/posts/audit-logs` | query: `page`/`page_size` | `items`（action/resource_type/resource_id/detail/ip_address/created_at）倒序分页 | — |
| `GET /api/posts/recent?limit=` | limit 默认 10、上限 50 | `last_viewed_at` 倒序、跨库、仅 published、**无 content**，附 `workspace_name` | — |
| `GET /api/posts/id/{id}/backlinks` | — | 同库内正文 `[[...]]` 指向该文章的列表 `{items:[{id,title,name,summary}], total}`；寻址 = `[[name]]`/`[[标题]]`/`[[x\|alias]]`，先 name 后 title 精确匹配（与前端渲染规则一致） | 404 |

### 3.2 知识库 `routes/workspaces.py`（prefix `/api/workspaces`）

| 方法/路径 | 说明 |
|---|---|
| `GET /api/workspaces` | id 升序 + 每库 `post_count`（排除虚拟根） |
| `POST /api/workspaces` | `{name}` 必填（strip 后非空）、全局唯一；`description` 可选；201 + 库对象（post_count=0）；写审计 |
| `PUT /api/workspaces/{id}` | 改名（唯一性/非空校验）/描述；200；写审计 |
| `DELETE /api/workspaces/{id}` | 保护：库下有文章 → 400（`知识库下仍有 N 篇文章…`）；最后一个库 → 400（`至少保留一个知识库`）；200 删除成功 |

### 3.3 图片 `routes/images.py`（prefix `/api/images`）

| 方法/路径 | 鉴权 | 说明 |
|---|---|---|
| `POST /api/images/upload` | ✅ | multipart 字段 `file`；**上传白名单 `.png .jpg .jpeg .gif .webp .bmp .avif`（不含 svg——动态内容回显 XSS 风险；也不含 .ico）**；≤10MB（seek 流式实测，不信任 Content-Length）；空文件 400；uuid hex 主名落盘 `settings.images_dir`；返回 `{url: '/api/images/<file>'}` 可直接写 Markdown。400：缺少文件字段 file / 不支持的图片类型 / 超大小限制 / 空文件 |
| `GET /api/images/{filepath}`、`GET /api/images/?path=&type=` | ❌ 免认证 | `_serve_image` 公共逻辑：`type` 决定基准（缺省=`data/images/`；`relative`=项目根；`absolute`=项目根围栏内的绝对路径）→ `_resolve_within_fence`（realpath 归一化，必须 `real == fence or startswith(fence + sep)`，越界 → 404）→ **下载白名单 `.png .jpg .jpeg .gif .webp .svg .ico .bmp .avif`（含 svg：允许取回历史上传/手工放置的 svg 文件）** → FileResponse + `Cache-Control: public, max-age=3600`；失败统一 404「文件不存在」 |

**下载/上传白名单差异要点**：下载宽（历史文件兼容，含 svg/ico），上传严（svg 禁入——上传的文件经 `<img>` 直接回显）；两集合独立维护，改其一别动另一个。

### 3.4 导出 `routes/export.py`（prefix `/api/export`）

`GET /api/export/markdown`（✅ 鉴权）→ `application/zip` 附件 `doublog-export-YYYYMMDD-HHMMSS.zip`。结构：每库一目录（`_safe_name` 清洗非法字符、截 80 字符）→ 无子文章 = `<name>.md`，有子文章 = 目录 + `index.md` + 子文章递归；`images/` 打包全部上传图片。要点：

- **排除虚拟根 id=0**：存量库根被归入默认知识库，不排除会"自己是自己的子节点"无限递归（另有 **depth 32 兜底**，超限 warning 跳过）
- 排序：父节点的 children_order（顶级用库的）；order 里没有的按 id 追加在后
- **图片 URL 三形式重写**为相对 zip 根 `images/`（按深度补 `../` 前缀）：① `/api/images/x.png`；② 绝对后端 URL `http://host/api/images/x.png`；③ 裸文件名 `demo.png`（仅当 images 目录确有该文件才重写）
- YAML frontmatter（title/name/created_at/updated_at/summary/is_top）；`[[双链]]` 源码原样（Obsidian 可识别）；同路径重名追加 `-2/-3`

---

## 4. 后端实现要点

- **执行模型**：端点一律 `async def` + `return await run_db(_impl)`——同步 SQLAlchemy 逻辑提交共享 SDK 线程池，任务结束（含异常）在工作线程内 rollback/remove（骨架契约，非本模块特有）。JSON body 由 `_json_body` 读取（坏/缺 body 回退空 dict，走原错误文案）；query 整数由 `_query_int` 解析（缺省/非法回退默认值）。
- **services/ 四文件**：
  - `tree_order.py`：`ROOT_ID=0` + children_order 数组的 get/set/append/remove/insert（纯 JSON 读写，不查库）
  - `view_count.py`：`increment_view`（`UPDATE view_count+1, last_viewed_at=now` **立即 commit**，无缓存层，返回新计数）、`get_view_count`（`increment_view` 内部用）、`get_all_view_counts`（批量 IN 查询，保留 API）；列表/树/详情读取方直接用行上 `view_count`（同一事务快照内与回查等值），不再单独回查
  - `audit.py`：`log_action`（不单独 commit，跟随主操作事务）；`request_ip` 在事件循环线程读 `request.client.host` 后显式传入 DB 线程（工作线程无请求代理）
  - `migrations.py`：见 2.5（列级幂等钩子）
- **列表/树不含正文**：`to_dict(include_content=False)` / `to_tree_dict()`，且列表/树/recent 查询 `defer(Post.content)`——**DB 段就不搬正文**（响应体积与查询负载双省），路由层不再补 content，勿回退。
- **N+1 防护**：列表/详情 slug 用 `_fetch_ancestors`+`_slug_from_rows` 按需祖先链（≤3 层 IN 小查询）；树接口同库一次查询内存组树 + slug 缓存；详情子文章 slug 按 `本文 slug + '/' + name` 不变式直推；移动校验 `is_descendant` 一次查询建 `parent_of` 映射内存回溯。
- **删除语义**：非 recursive 时子文章提升为该库顶级（追加库 order）；recursive 递归删全部子孙；均写审计。
- **gzip**：全局 `GZipMiddleware(minimum_size=1024)`（main.py），blog 大响应（长列表/详情）自动压缩，测试断言列表 gzip、`/health` 不压。

---

## 5. 前端（`frontend/src/blog/`）

全部请求走 `blog/api.js`（引 `shared/client.js` 的 `apiFetch`，会话 Cookie 认证，401 统一跳 `/login`）。5 页 + 2 hooks：

### 5.1 HomePage（`/blog`，pages/HomePage.jsx）

- **数据**：挂载 `fetchAllPosts()`（分页循环拉全量，上限 2000）+ `fetchWorkspaces()` + `fetchRecentPosts(8)`；当前库 `?ws=` URL 记忆（`history.replaceState`，不刷新），未匹配回退第一个库；卡片网格按当前库过滤。
- **WorkspaceSwitcher**（本文件内组件）：触发按钮 + 下拉面板（库名/文章数/选中态蓝点、新建库内嵌表单 Enter/Esc、点外关闭）；创建成功自动切到新库。
- **搜索**：300ms 防抖走后端 `searchPosts`（**服务端全文、跨库**，命中显示所属库徽章）；`Ctrl/Cmd+K` 聚焦。非搜索态显示最近浏览横条（hover 预取）。
- 卡片 hover/focus `prefetchPost`；骨架屏 stagger、空态引导新建。

### 5.2 PostDetail（`/post/:id`，pages/PostDetail.jsx，最重页面）

- **三栏**：左文档树（dnd-kit 拖拽排序乐观更新 + 失败重拉、展开状态 localStorage 记忆、右键菜单建子/同级/删除）+ 中正文 + 右 TOC（IntersectionObserver 高亮）；左右栏宽可拖（localStorage）。切库隔离：先取文章得知 workspace_id，再按库取树。
- **SWR**：挂载先 `takeCachedPost` 命中即渲染，后台重拉覆盖并 `setCachedPost`；同路由切文章只重建内容区（`key={post.id}`），外壳不动、`articleRef.scrollTo(0)` 复位。
- **渲染**：`renderPostContent` 模块级 LRU 16 按正文缓存 `md.render` + 抽 h1-h6 生成 TOC；`buildWikiMap(tree)` → `applyWikiLinks` 解析双链（树后到自动补 href，未命中置灰不可点）；`MermaidRunner`（key 绑定 html）延迟 100ms 渲染图表；`dangerouslySetInnerHTML` 传 useMemo 稳定引用（防无关重渲染抹掉 mermaid SVG）。
- **lightbox**（自研）：事件委托捕获 `.prose-content img` 点击；`+/-/=` 缩放、滚轮缩放、Esc 关闭。
- **反链区**：文末 `fetchBacklinks`，hover 预取；**子文章卡**列表（含 children 时）。
- **单篇导出**（纯前端）：frontmatter + 图片 URL 绝对化（`/api/images/x` → `API_BASE + path`）→ Blob 下载 `<name>.md`。
- 删除走确认弹窗 → `DELETE ?recursive=1` → 失效缓存、重拉树、当前文被删则回首页。

### 5.3 AdminPage（`/admin`，pages/AdminPage.jsx）

- **状态卡**：后端徽章（SQLite/PostgreSQL）、文章数/操作日志数/数据目录（`fetchDbStatus`，PG 参数自动预填）+ `导出 Markdown 备份 (.zip)`（拉 blob 下载）。
- **数据库切换**（SQLite 模式显示 PG 表单：host/port/user/password/dbname + 测试连接 + 切换并连接；PG 模式一键切回）；`restart_required=false`（dev 自动重启）提示后 3 秒自动刷新，`true`（生产）提示手动重启。
- **LoggingCard**：日志上报配置（`/api/admin/logging` 三端点：开关/级别/服务地址 + 发送测试 + sys_name 徽章墙）——跨模块共享端点，配置页 `/config` 的同款卡。

### 5.4 CreatePost / EditPost（`/create`、`/post/:id/edit`）

- **表单**：标题/slug（`NAME_RE` 前端校验）/所属知识库下拉（`?ws=` 预选，切库清空父文章）/父文章（同库树扁平化下拉，`└ ` 缩进）/状态/摘要；EditPost 的 slug/父文章/状态为只读展示（编辑入口不改 name 与挂载）。
- **编辑器**（两页同构）：工具栏 9 个语法按钮（insertAtCursor 包选区）+ 图片/表格/mermaid/代码块模板；分栏 `h-[70vh]` 双栏内部滚动；实时预览（同渲染管线 + 双链解析 + mermaid）。
- **提交流程**：Create `POST /api/posts` → 跳 `/post/:id`；Edit `PUT /api/posts/id/:id`（title/content/summary）→ `invalidatePost` → 跳回详情。
- EditPost 先拉详情再按库拉树；loading/loadError 两个独立整页分支。

### 5.5 editor hooks（共用）

- `useEditorShortcuts`：`Ctrl/Cmd+S` 保存、`Ctrl/Cmd+B` 加粗、`Ctrl/Cmd+I` 斜体、`Ctrl/Cmd+K` 链接、正文内 `Tab` 两格缩进；B/I/K 仅在正文区/页面空白处生效。
- `useEditorEnhancements`：图片**粘贴/拖拽/按钮**三通道上传（`uploadImage` → 光标处插 `![alt](url)`，uploading 计数显示"图片上传中…"）；**预览同步滚动**（编辑区滚 → 预览按比例跟随；用户滚预览暂停 400ms）；块模板 `BLOCK_TEMPLATES`（表格/mermaid/代码块）。EditPost 传 `active: !loading`（编辑器在 loading 放行后才渲染，挂监听需双信号）。

---

## 6. 测试（`backend/tests/blog/`，56 用例，全部自包含临时 SQLite）

| 文件 | 数量 | 覆盖点 |
|---|---|---|
| `test_posts.py` | 30 | 创建（201/401/缺 name/非法格式/库内重名/3 层上限）；列表与树**不含 content**（含 5000 字正文条目断言）+ 树嵌套 slug；分页 total/total_pages；keyword 命中正文 + 跨库/带库过滤；详情（id 含正文/slug/children 排序 slug/404）；浏览计数实时自增（1→2→3，列表读到同值）+ `no_view=1` 不计；改名/移动 **slug 级联**（子孙路径更新、level 更新）；自父/子孙父 400；内容更新；删除（默认提升子级为顶级/recursive 级联 404）；图片围栏（正常 200/白名单外 404/绝对越界+URL 编码穿越+相对穿越三类 404）；gzip（大列表 Content-Encoding=gzip/`/health` 不压）；拖拽 reorder 生效 |
| `test_workspaces.py` | 15 | 默认库自动创建（名/计数）+ 树缺省库；CRUD/重命名/重名 400/空名 400；删空库 200/非空 400（含篇数文案）/末库 400/未认证 401；库间隔离（树/列表/post_count 三视角）；同名文章跨库可建、同库拒；跨库父子 400/跨库移动 400；顶级排序写库（reorder parent_id=0 + 悬挂 id 不影响渲染） |
| `test_kb_features.py` | 11 | 上传（1px PNG 成功且 URL 可取回/svg 400/未认证 401/空文件 400）；recent（浏览顺序倒序 + no_view 不进列表/limit）；backlinks（name 与 title 双寻址 + alias/同库隔离跨库不互链/404）；导出 zip（结构 index.md+子文件+独立文章+images/、frontmatter、`../images/` 深度重写、双链原样、图片字节一致）；导出未认证 401 |

---

## 7. 已知边界（对照 AGENTS.md"已知未修复问题"）

1. **移动子树不重算子孙 `level` 列**：slug 已级联、level 陈旧仅影响展示（AGENTS #3）
2. **AuditLog 只增不删**，无清理策略，长期膨胀（AGENTS #1）
3. 前端 `/archive` 死链、无 404 兜底页（应用壳层问题，导航里 blog 相关，AGENTS #4）
4. 生产模式数据库切换需手动重启；切换期间并发写入可能丢失（AGENTS #5，AdminPage 仅提示）
5. `/api/posts/slug/{name}` 与 `/path/{slug}` **无库过滤**：跨库同名文章时命中 id 最小的那条（前端一律 `/id` 寻址不受影响，API 直用需注意）
6. `name` 库内唯一是**应用层**校验（DB 无唯一约束），并发极端下可能突破（单用户可忽略）
7. `keyword` 搜索走 `content LIKE` 全表扫，数据量大时 O(N)
8. 上传只校验扩展名 + 大小，不嗅探文件内容是否真为图片；下载白名单含 svg（历史文件可取回），上传侧已封死
9. 图片 GET 免认证——uuid 随机文件名是主要防线（公开 URL 可被知道文件名者获取）
10. 导出 depth 32 兜底：数据成环时静默跳过该子树（仅 WARNING 日志）
