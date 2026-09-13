# DouBlog API 协议文档

> **基础路径**: `http://<主机名>:60100/api`
> **认证方式**: HTTP Basic Auth（所有 `/api/*` 接口均需认证）
> **本文档与 `backend/app/api/` 下的代码一一对应，修改接口时必须同步更新本文档**（见 `AGENTS.md` 文档同步规则）

---

## 目录

- [1. 通用规范](#1-通用规范)
- [2. 认证 API](#2-认证-api)
- [3. 知识库 API](#3-知识库-api)
- [4. 文章 API](#4-文章-api)
- [5. 操作日志 API](#5-操作日志-api)
- [6. 管理 API（数据库切换）](#6-管理-api数据库切换)
- [7. 图片 API](#7-图片-api)
- [8. 错误码与数据模型](#8-错误码与数据模型)

---

## 1. 通用规范

### 1.1 认证方式

HTTP Basic Auth，凭据定义在 `backend/app/config.py`（默认 `admin` / `lizy111A`）。

```bash
curl -u admin:lizy111A http://localhost:60100/api/posts
```

未认证或凭据错误返回 401：

```json
{ "success": false, "code": 401, "message": "认证失败", "data": null }
```

### 1.2 统一响应格式

所有接口返回统一 JSON 信封：

```json
{
  "success": true,
  "code": 200,
  "message": "操作成功",
  "data": { }
}
```

错误时 `success` 为 `false`，`code` 为对应 HTTP 状态码，`data` 为 `null`。

### 1.3 分页参数

适用于 `GET /api/posts`、`GET /api/posts/audit-logs`：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `page` | int | 1 | 页码 |
| `page_size` | int | 20 | 每页数量，**上限 100**（`settings.max_page_size`） |

分页响应结构：

```json
{ "items": [], "total": 2, "page": 1, "page_size": 20, "total_pages": 1 }
```

### 1.4 gzip 压缩

响应为 JSON/文本且超过 1KB 时，若请求头携带 `Accept-Encoding: gzip`，服务端自动压缩（`Content-Encoding: gzip`）。

### 1.5 正文传输约定（重要）

- **列表接口**（`GET /api/posts`）与**树接口**（`GET /api/posts/tree`）的条目**不含 `content` 正文字段**，用于概览展示
- **详情接口**（`GET /api/posts/id|slug|path/...`）返回完整 `content`

---

## 2. 认证 API

### 2.1 登录验证

**请求**

```
POST /api/auth/login
```

**成功响应** `200`

```json
{ "success": true, "code": 200, "message": "登录成功", "data": { "username": "admin" } }
```

**失败响应** `401`（凭据错误）

### 2.2 检查认证状态

**请求**

```
GET /api/auth/check
```

**成功响应** `200`

```json
{ "success": true, "code": 200, "message": "已认证", "data": { "authenticated": true, "username": "admin" } }
```

---

## 3. 知识库 API

文章的顶层分组容器。所有接口需认证。

### 3.1 知识库列表

```
GET /api/workspaces
```

按 id 升序返回，含每个库的文章数：

```json
[
  { "id": 1, "name": "默认知识库", "description": "", "post_count": 2,
    "created_at": "...", "updated_at": "..." }
]
```

### 3.2 创建知识库

```
POST /api/workspaces
{ "name": "前端学习", "description": "可选" }
```

名称必填且全局唯一；成功返回 `201` + 库对象。

### 3.3 更新知识库

```
PUT /api/workspaces/<id>
{ "name": "新名称", "description": "新描述" }   // 均可选
```

### 3.4 删除知识库

```
DELETE /api/workspaces/<id>
```

**保护**：库下仍有文章 → 400（`知识库下仍有 N 篇文章…`）；最后一个库不可删除 → 400。

## 4. 文章 API

### 4.1 获取文章列表（无正文）

```
GET /api/posts?page=1&page_size=20&parent_id=&status=&keyword=
```

| Query 参数 | 说明 |
|---|---|
| `workspace_id` | 可选，按知识库筛选（不传 = 全部） |
| `parent_id` | 可选，按父文章过滤（顶级文章传 `0`） |
| `status` | 可选，`published` / `archived` |
| `keyword` | 可选，模糊匹配 title / summary / name / **content（正文全文）**；不带 `workspace_id` 时跨所有知识库 |

排序：置顶优先（`is_top DESC`），其后按 `id ASC`。

**响应 `data.items[]` 字段**（注意：**无 `content`**）：

```json
{
  "id": 1,
  "title": "Hello DouBlog",
  "name": "hello-doublog",
  "slug": "/hello-doublog",
  "summary": "第一篇示例文章",
  "parent_id": 0,
  "level": 0,
  "author": "admin",
  "status": "published",
  "is_top": false,
  "view_count": 3,
  "tags": ["test"],
  "meta_data": null,
  "created_at": "2026-09-12T09:18:05",
  "updated_at": "2026-09-12T09:18:05",
  "children_count": 0
}
```

> `slug` 由服务端单次查询内存计算（非逐条回溯）；`children_count` 为直接子文章数。

### 4.2 获取文章树（无正文）

```
GET /api/posts/tree?workspace_id=1
```

`workspace_id` 可选，缺省 = 默认知识库（id 最小）。**树是按知识库返回的**。

**响应** `data` 为节点数组，每个节点结构与列表条目类似，另有：

| 字段 | 说明 |
|---|---|
| `children` | 子节点数组（递归） |
| `children_order` | 该节点自定义的子节点顺序（id 数组） |

- **不含 `content`**，正文需按节点 id 调详情接口获取
- 树按各节点的 `children_order` 排序；顶级节点按虚拟根（id=0）的 `children_order` 排序

### 4.3 获取文章详情（含正文）

三种寻址方式，响应结构一致：

```
GET /api/posts/id/1                 # 按数字 ID
GET /api/posts/id/1?no_view=1       # 同上，但不自增浏览计数（前端链接 hover 预取专用）
GET /api/posts/slug/hello-doublog   # 按英文名（name，全局唯一）
GET /api/posts/path/a/b             # 按完整路径（如 /a/b；不带前导斜杠，兼容旧版）
```

**副作用**：每次调用实时自增该文章浏览计数（直接 UPDATE 数据库）；仅 `id` 寻址支持 `?no_view=1` 跳过计数。

**响应 `data` 额外字段**：

| 字段 | 说明 |
|---|---|
| `content` | Markdown 正文全文 |
| `parent` | 父文章摘要 `{id, title, name, slug}`；**顶级文章的响应中没有该键** |
| `children` | 直接子文章列表 `[{id, title, name, slug, level}]`，按 `children_order` 排序 |

```json
{
  "id": 1,
  "title": "Hello DouBlog",
  "content": "# 欢迎\n\n这是通过 API 创建的文章...",
  "slug": "/hello-doublog",
  "view_count": 4,
  "children": []
}
```

不存在返回 `404`。

### 4.4 创建文章

```
POST /api/posts
Content-Type: application/json
```

**请求体**

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | ✅ | 标题 |
| `name` | ✅（或从 `slug` 字段解析末段） | URL 路径段，须匹配 `^[a-zA-Z][a-zA-Z0-9-]{3,100}$` 且**全局唯一** |
| `content` | | Markdown 正文 |
| `summary` | | 摘要 |
| `workspace_id` | | 所属知识库 ID，缺省 = 默认知识库 |
| `parent_id` | | 父文章 ID，缺省/0 = 该库顶级（父文章必须属于同一知识库） |
| `status` | | `published`（默认）/ `archived` |
| `is_top` | | 是否置顶 |
| `tags` | | 字符串数组 |

**层级限制**：父子结构最多 3 层（level 0/1/2，`MAX_LEVEL = 2`），超出返回 400。

**成功响应** `201`

```json
{
  "success": true, "code": 201, "message": "创建成功",
  "data": { "id": 3, "title": "新文章", "name": "new-post", "slug": "/new-post", "level": 0, "created_at": "..." }
}
```

**常见 400 错误**：`标题不能为空` / `英文名不能为空` / `英文名格式无效…` / `该英文名已被使用…` / `父文章已达最大层级限制（最多3层）`

### 4.5 更新文章

```
PUT /api/posts/id/1
PUT /api/posts/slug/hello-doublog   # 等价于按 name 找到后走 ID 更新
```

**请求体**（全部可选，只传要改的字段）：`title`、`content`、`summary`、`status`、`is_top`、`tags`、`name`、`parent_id`。

**行为要点**：

- 改 `name`：校验同创建（**知识库内唯一**）；**级联更新所有子孙文章的 slug**
- `workspace_id` 不可修改；`parent_id` 不能指向其他知识库的文章（400 `不能跨知识库移动文章`）
- 改 `parent_id`：校验不能选自己、不能选自己的子孙、层级限制；从旧父 `children_order` 移除并追加到新父；**级联更新子树 slug**
- 每次更新写入一条操作日志（见第 4 节）

**成功响应** `200`：`{id, title, name, slug, level, parent_id, updated_at}`

### 4.6 删除文章

```
DELETE /api/posts/id/1
DELETE /api/posts/slug/hello-doublog
```

| 模式 | 行为 |
|---|---|
| 默认（非级联） | **子文章提升为顶级文章**（parent_id=0, level=0，挂到虚拟根的 children_order） |
| `?recursive=1` | **递归删除所有子孙文章** |

删除同时写一条操作日志。成功返回 `200`。

### 4.7 拖拽排序

```
PUT /api/posts/reorder
```

**请求体**

```json
{ "parent_id": 0, "workspace_id": 1, "children_order": [3, 1, 5] }
```

`parent_id` 为目标父节点（`0` = 知识库顶级，此时顶级顺序写入对应 `workspaces.children_order`，需带 `workspace_id`），`children_order` 为新的直接子节点 ID 顺序。成功返回 `200`。

---

## 5. 操作日志 API

### 5.1 查询操作日志

```
GET /api/posts/audit-logs?page=1&page_size=20
```

每次文章创建/更新/删除自动记录一条，按时间倒序分页返回：

```json
{
  "items": [
    {
      "id": 9,
      "action": "update",
      "resource_type": "post",
      "resource_id": 1,
      "detail": "{\"fields\": [\"title\"]}",
      "ip_address": "127.0.0.1",
      "created_at": "2026-09-12T10:00:00"
    }
  ],
  "total": 9, "page": 1, "page_size": 20
}
```

---

## 6. 管理 API（数据库切换）

后端支持 SQLite / PostgreSQL 双数据库，以下接口完成"测试连接 → 切换"。前端管理页（`/admin`）即本组接口的界面。

> **切换语义**：只更换连接配置（`data/db_config.json`）并重启生效，**不迁移数据**——直接读取目标库的现有数据（空库自动建表并播种默认知识库/虚拟根）；两侧数据互不影响，随时可切回。

### 6.1 当前数据库状态

```
GET /api/admin/database
```

```json
{
  "backend": "sqlite",
  "database_url_masked": "sqlite:///C:/.../data/blog.db",
  "data_dir": "C:/.../DouBlog/data",
  "postgres": { "host": "localhost", "port": 5432, "user": "postgres", "password": "", "dbname": "doublog" },
  "counts": { "posts": 2, "audit_logs": 10 },
  "running_under_reloader": true
}
```

> `counts.posts` 不含虚拟根（id=0）。

### 6.2 测试目标后端连通性

```
POST /api/admin/database/test
{ "target": "postgres", "postgres": { "host": "127.0.0.1", "port": 5432, "user": "postgres", "password": "...", "dbname": "doublog" } }
```

- SQLite 目标恒为 `{ok: true}`
- PG 目标库不存在时会尝试自动创建并重试；均失败返回 400（含驱动错误信息）

### 6.3 切换后端连接

```
POST /api/admin/database/switch
{
  "target": "postgres",   // 或 "sqlite"
  "postgres": { ... }     // 可选,覆盖连接参数
}
```

**流程**：校验目标可达（PG 库不存在自动创建）→ 写 `data/db_config.json` → 重启生效（读取目标库现有数据）。

**生效方式**：
- 开发模式（Werkzeug reloader 下）：touch 戳文件触发**自动重启**（与改代码热重启同一机制），响应 `restart_required: false`
- 生产模式：响应 `restart_required: true`，需手动重启后端

**成功响应**

```json
{ "success": true, "code": 200, "message": "切换成功",
  "data": { "backend": "postgres", "restart_required": false } }
```

**常见 400**：`当前已在使用 xxx` / `无法连接 PostgreSQL：...`

## 7. 图片 API

> 图片文件存放于 `data/images/`；**编辑器粘贴/拖拽/按钮上传走 `POST /api/images/upload`**（随机文件名落盘），历史用法是直接把文件放入目录。Markdown 中的图片路径由前端自动改写为本接口 URL（见 `frontend/src/md.js`）。

### 7.1 获取图片

```
GET /api/images/<filepath>            # 路径参数形式
GET /api/images/?path=<路径>&type=<类型>   # query 形式（前端使用）
```

**`type` 路径解析规则**

| type | 解析基准 |
|---|---|
| 缺省 | `data/images/` 目录 |
| `relative` | 项目根目录 |
| `absolute` | 绝对路径 |

**安全围栏（防路径穿越）**

1. 路径经 `realpath` 归一化后必须落在解析基准目录内，否则 404
2. 扩展名必须在白名单内：`.png .jpg .jpeg .gif .webp .svg .ico .bmp .avif`，否则 404

**示例**

| 请求 | 结果 |
|---|---|
| `/api/images/markdown-demo.png` | 提供 `data/images/markdown-demo.png` |
| `?path=data/images/x.png&type=relative` | 提供项目根下 `data/images/x.png` |
| `?path=C:/Windows/win.ini&type=absolute` | **404**（越出项目根围栏） |
| `/api/images/..%2F..%2Fsecret` | **404**（穿越被拦截） |

成功：`200` + 文件流；失败：`404` 统一 JSON。

### 7.2 上传图片

```
POST /api/images/upload          # multipart/form-data, 字段 file
```

- 需认证；扩展名白名单 `.png .jpg .jpeg .gif .webp .bmp .avif`（**不含 svg**，防动态内容回显）；单文件 ≤ 10MB
- 随机 uuid 主文件名防碰撞/注入，落盘 `data/images/`
- 成功 `data`: `{ "url": "/api/images/<filename>" }`（可直接写入 Markdown）

---

## 8. 最近浏览 / 反链 / 导出 API

### 8.1 最近浏览

```
GET /api/posts/recent?limit=10   # limit 上限 50
```

按 `last_viewed_at` 倒序返回跨知识库的已浏览文章（不含正文）。`last_viewed_at` 仅在**计浏览**的详情请求时刷新（`?no_view=1` 预取不影响），列表项附 `workspace_name`。

### 8.2 反向链接

```
GET /api/posts/id/<id>/backlinks
```

返回**同知识库**内正文中用 `[[双链]]` 指向该文章的所有文章。寻址规则与前端渲染一致：`[[name]]` / `[[标题]]` / `[[name|显示文字]]`，先按英文名精确匹配、再按标题。`data`: `{ items: [{id, title, name, summary}], total }`。

### 8.3 导出 Markdown 备份

```
GET /api/export/markdown         # 需认证，返回 application/zip 附件
```

zip 结构：每个知识库一个目录（文章按树嵌套，有子文章的为 `目录/index.md`），`images/` 含全部上传图片；正文中的图片 URL 重写为相对 `images/` 路径（按文件深度补 `../`），`[[双链]]` 保持源码原样（Obsidian 可识别）。每篇带 YAML frontmatter（title/name/created_at/updated_at/summary/is_top）。文件名取文章 `name`，重名追加 `-2/-3`。

---

## 6. 错误码与数据模型

### 6.1 HTTP 状态码

| 状态码 | 含义 |
|---|---|
| 200 / 201 | 成功 / 创建成功 |
| 400 | 参数校验失败（JSON 解析失败、必填缺失、格式/唯一性/层级校验失败等） |
| 401 | 认证失败 |
| 404 | 资源不存在（文章、图片、父节点） |
| 500 | 服务器内部错误 |

### 6.2 Post 模型字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | int | 主键；**id=0 为虚拟根节点**（`__root__`，不出现在任何接口结果中） |
| `title` | string | 标题 |
| `name` | string | URL 路径段，全局唯一，`^[a-zA-Z][a-zA-Z0-9-]{3,100}$` |
| `slug` | string | 完整路径（如 `/a/b`），改名/移动时级联维护 |
| `content` | text | Markdown 正文（仅详情接口返回） |
| `summary` | text | 摘要 |
| `workspace_id` | int | 所属知识库 ID（建库迁移自动回填；列表/树/详情均返回该字段） |
| `parent_id` | int | 父文章 ID；顶级文章为 `0`（虚拟根） |
| `level` | int | 层级，0~2 |
| `children_order` | text | 子节点排序 JSON 数组，如 `[3,1,5]` |
| `author` | string | 固定 `admin` |
| `status` | string | `published` / `archived` |
| `is_top` | bool | 置顶 |
| `view_count` | int | 浏览计数（实时写库） |
| `tags` | text | 标签 JSON 数组 |
| `meta_data` | text | 扩展元数据 |
| `created_at` / `updated_at` | datetime | 时间戳 |
