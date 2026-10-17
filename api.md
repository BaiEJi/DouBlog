# DouBlog API 协议文档

> **基础路径**: `http://<主机名>:60100/api`
> **认证方式**: 统一登录（会话 Cookie 优先，Basic Auth 兼容）；免认证例外：图片 GET、sdklogs 摄入、日记分享、apihub 网关（sk-）
> **本文档与 `backend/app/` 各能力包（`app/<模块>/`）下的路由代码一一对应，修改接口时必须同步更新本文档**（见 `AGENTS.md` 文档同步规则）

---

## 目录

- [1. 通用规范](#1-通用规范)
- [2. 认证 API（统一登录）](#2-认证-api)
- [3. 知识库 API](#3-知识库-api)
- [4. 文章 API](#4-文章-api)
- [5. 操作日志 API](#5-操作日志-api)
- [6. 管理 API（数据库切换）](#6-管理-api数据库切换)
- [7. 图片 API](#7-图片-api)
- [8. 最近浏览 / 反链 / 导出 API](#8-最近浏览--反链--导出-api)
- [9. 日记 API](#9-日记-api独立模块memos--day-one-超集)
- [10. Vault API](#10-vault-api零知识密码库)
- [11. Pwsvc API](#11-pwsvc-api密码服务轮换密码非零知识)
- [12. Sdklogs API](#12-sdklogs-api日志接收lizysdk-send_json-服务端)
- [13. Subs API](#13-subs-api订阅管理crownflow-迁移)
- [14. API Hub API](#14-api-hub-api统一-api-调用平台)
- [15. Todo API](#15-todo-api四象限待办mytodo-迁入)
- [16. Gamemap API](#16-gamemap-api剧情图谱独立顶级模块13-表-gamemap_)
- [17. Practice API](#17-practice-api刷题独立顶级模块22-端点6-表-practice_规范-docspractice-specmd)
- [18. Steamidler API](#18-steamidler-apisteam-挂机独立顶级模块)
- [19. 配置中心 API](#19-配置中心-api)
- [20. Clash API](#20-clash-api代理管理clashctl-全能力的-web-迁移)
- [21. Assets API](#21-assets-api资产库prompt-与-skill)
- [22. Bookmarks API](#22-bookmarks-api书签与稍后阅读独立顶级模块23-端点4-表-bookmarks_)
- [23. 错误码与数据模型](#23-错误码与数据模型)
- [24. 开发者工具箱 API](#24-开发者工具箱devtoolboxapidevtoolbox)

---

## 1. 通用规范

### 1.1 认证方式（统一登录 + Basic 兼容）

**前端统一登录**：`/login` 页 `POST /api/auth/login`（JSON 载荷）→ 签发 HttpOnly 会话 Cookie `doublog_session`（HMAC 签名，30 天），之后所有模块免再登录。**API/脚本/测试**兼容 Basic Auth（凭据定义在 `backend/app/config.py`，默认 `admin` / `lizy111A`）：

```bash
curl -u admin:lizy111A http://localhost:60100/api/posts
```

未认证或凭据错误返回 401（附 `WWW-Authenticate`）：

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

响应超过 1KB 且请求头携带 `Accept-Encoding: gzip` 时自动压缩（`Content-Encoding: gzip`；不限 JSON/文本）。

### 1.5 正文传输约定（重要）

- **列表接口**（`GET /api/posts`）与**树接口**（`GET /api/posts/tree`）的条目**不含 `content` 正文字段**，用于概览展示
- **详情接口**（`GET /api/posts/id|slug|path/...`）返回完整 `content`

### 1.6 请求级 trace（X-Trace-Id）

后端为每个请求绑定 lizysdk trace_id 并在响应头回写 `X-Trace-Id`；请求头自带 `X-Trace-Id`（网关/SDK 调用方）则透传延续链路。该请求产生的所有日志行自动携带同一 `trace_id`，可在 `/logs` 页用 `GET /api/v1/logs/trace?trace_id=` 查看时间线。

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

**请求体（登录页方式，签发会话 Cookie）**

```json
{ "username": "admin", "password": "lizy111A" }
```

成功时响应头附 `Set-Cookie: doublog_session=<token>; HttpOnly; SameSite=Lax; Max-Age=2592000`（30 天），之后请求自动携带（`credentials: include`）。也接受 `Authorization: Basic` 头（兼容 API 工具，同样签发 Cookie）。

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

### 2.3 登出

```
POST /api/auth/logout
```

清除会话 Cookie（幂等，无需认证）。前端门户右上角"登出"按钮调用后跳 `/login`。

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
- 树按各节点的 `children_order` 排序；**顶级节点按所属知识库 `workspaces.children_order` 排序**（虚拟根仅存量迁移时拷贝一次）

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
| 默认（非级联） | **子文章提升为顶级文章**（parent_id=0, level=0，挂到所属知识库 workspaces.children_order） |
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

后端支持 SQLite / PostgreSQL 双数据库，以下接口完成"测试连接 → 切换"。前端总配置页（`/config`）是本组接口的统一操作界面。

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
- 开发模式（uvicorn `--reload`）：touch `app/_reload_stamp.py` 戳文件触发**自动重启**（与改代码热重启同一机制），响应 `restart_required: false`
- 生产模式：响应 `restart_required: true`，需手动重启后端

**成功响应**

```json
{ "success": true, "code": 200, "message": "切换成功",
  "data": { "backend": "postgres", "restart_required": false } }
```

**常见 400**：`当前已在使用 xxx` / `无法连接 PostgreSQL：...`

### 6.4 登录账号（system_accounts 表，2026-10-12）

> 凭据存数据库（单行表），密码只存 PBKDF2-SHA256 哈希；`config.py` 的
> `auth_username/auth_password` 仅作首次播种默认（空表时写入）与中间态回退。
> 登录/Basic 校验即时读表——改密后旧密码立即失效（新密码即刻生效）。

```
GET /api/admin/account
→ { "username": "admin", "updated_at": "2026-10-12T23:57:06" }   # 不含哈希

PUT /api/admin/account
{ "old_password": "lizy111A",          // 必填（验证当前密码）
  "username": "新用户名",               // 可选：3-64 位字母数字_-
  "new_password": "新密码" }            // 可选：≥8 位；二者至少其一
→ 200 { "username": ... }              # 401 旧密码错误 / 400 参数非法
```

注意：已签发的会话 Cookie（HMAC，30 天）不因改密失效——需要踢出已登录设备时改用户名。

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

## 9. 日记 API（独立模块，Memos/Day One 超集）

> 日期一律 `YYYY-MM-DD`；同一天可多篇；删除为软删除（回收站）。存储跟随设置页数据库切换。

```
# 条目
GET    /api/diary/entries                  视图+过滤：?view=timeline(默认)|archive|trash|pinned
                                          ?date= ?start=&end= ?search=(仅正文 LIKE) ?mood= ?journal_id= ?limit&offset
POST   /api/diary/entries                 创建（含 mood/journal_id(随记必填)/weather/location）
PUT    /api/diary/entries/<id>            整包更新（自动保存）
PUT    /api/diary/entries/<id>?action=…   动作：pin|unpin|archive|unarchive|restore
DELETE /api/diary/entries/<id>            移入回收站；?hard=1 彻底删除（回收站内才允许）
POST   /api/diary/quick                   一句话快速录入 {content, journal_id(必填), mood?}（外部脚本）

# 日记本（分册）
GET/POST /api/diary/journals · PUT/DELETE /api/diary/journals/<id>（有日记 409 拒删；列表含预置 日常/工作/感悟 三本与计数）
POST   /api/diary/summary                 当日总结 upsert（每天一篇，见 docs/modules/diary.md）

# 日历 / 热力图 / 回忆
GET    /api/diary/dates?year=&month=      每月每天 {count, mood(当天最好)}
GET    /api/diary/heatmap?year=           年度每天 {count, mood} + max（色阶归一）
GET    /api/diary/onthisday               往年同月同日 + 随机旧记忆

# 统计
GET    /api/diary/stats                   连续/最长连续/本月/总篇/总字/本数
GET    /api/diary/trends?months=12        每月 {entries, words, mood_avg}（缺月补零）
GET    /api/diary/yearend?year=           年度回顾（篇/字/心情分布/最长连续/最活跃月）

# 分享（单篇免登录只读）
POST   /api/diary/entries/<id>/share      {expires_hours:1-8760} → {token}；过期/撤销/进回收站一律 404
DELETE /api/diary/entries/<id>/share      撤销
GET    /api/diary/share/<token>           **免登录**只读（无 id 等管理字段）

# 导出 / 模板 / 引导
GET    /api/diary/export                  全量 Markdown zip（frontmatter: date/mood/tags/weather/location）
GET    /api/diary/templates               内置模板（晨间/晚间/周回顾/感恩/自由）
GET    /api/diary/prompt?date=            每日写作引导问题（按日期确定性轮换，21 条）
```

天气/位置由前端采集（open-meteo + 浏览器定位，用户点按钮触发），后端只存白名单字段。

### 9.1 日志上报配置（管理端）

```
GET  /api/admin/logging            → {enabled, url, level, modules:[{module, sys_name:doublog.<m>}]}
PUT  /api/admin/logging            {enabled?, url?, level:'WARNING'|'INFO'}（即时生效，落 data/logs_config.json）
POST /api/admin/logging/test       发一条 WARNING（sys_name=doublog.system）→ {marker}，到 /logs 搜索验证
```


## 10. Vault API（零知识密码库）

> 服务端只存密文：`blob = {n, ct}`（AES-256-GCM，base64）与包裹后的 VEK 材料；**不存在任何明文敏感字段参数**；无服务端搜索（客户端解密后搜）。单账号（首行）。

```
GET    /api/vault/account                KDF 参数 + 双通道包裹的 VEK（404=未初始化）
POST   /api/vault/account                初始化 {kdf_algo:'argon2id', kdf_params, kdf_salt, recovery_salt, wrapped_vault_key, recovery_wrapped_vault_key}
PUT    /api/vault/account/keys           主密码修改/恢复密钥轮换（仅替换包裹材料）
GET    /api/vault/items?trash=0|1        条目列表（密文+非敏感元数据：favorite/last_used_at/password_updated_at/deleted_at）
POST   /api/vault/items                  创建 {blob, favorite?, password_updated_at?}
PUT    /api/vault/items/<id>             更新（整包密文覆盖；password_updated_at 变化会记审计 password_changed）
DELETE /api/vault/items/<id>             移入回收站（软删）
POST   /api/vault/items/<id>/restore     恢复
DELETE /api/vault/items/<id>/purge       永久删除
POST   /api/vault/items/<id>/use         记录最近使用（仅 ID+时间）
GET    /api/vault/audit?page=&page_size= 审计（action + item_id + 时间，无任何内容；page_size ≤200）
GET    /api/vault/items/<id>/attachments 附件元数据列表
POST   /api/vault/items/<id>/attachments 上传加密附件（JSON {blob, size}；5MB/文件，总量 8MB，超限 413）
GET    /api/vault/attachments/<aid>      下载密文附件
DELETE /api/vault/attachments/<aid>      删除附件（purge 级联清理）
GET    /api/vault/export                 加密备份（账号材料+全部条目密文；格式串 doublog-vault-backup）
POST   /api/vault/import                 导入（替换式；兼容历史笔误串 doublog-vault-backdown）
```

---

## 11. Pwsvc API（密码服务：轮换密码，非零知识）

> 密码库内子模块：项目 → 用户类型（密码策略+轮换周期）→ 用户（独立密码链）。
> 密码**不存储**，由 `derive(seed, 时间窗口, 策略)` 确定性推导（HMAC-SHA256 + 拒绝采样 + 洗牌，黄金向量防漂移）；
> 每用户独立 32 字节（256-bit）seed（AES-256-GCM 加密落盘，密钥 `data/pwsvc.key`）。
> 校验：当前窗口命中→valid+剩余秒数；否则**进入窗口 30s 内**（`min(30, rotation)`）比对上一窗口（宽限）；常数时间比较。
> 本模块为服务端校验服务，**非零知识**（UI 已标注）。

```
# 管理（Basic Auth）
POST   /api/pwsvc/projects                  创建（响应含 api_key 明文，仅此一次；pws_ 前缀；可选 rate_limit）
GET    /api/pwsvc/projects                  列表（含类型数/用户数/rate_limit）
PUT    /api/pwsvc/projects/<id>             改名/描述/rate_limit（0-10000，改后立即生效）
DELETE /api/pwsvc/projects/<id>             删除（级联，含日志）
POST   /api/pwsvc/projects/<id>/api-key     重置 API Key（旧 key 立即失效）

POST   /api/pwsvc/projects/<id>/types       创建类型 {name, length, uppercase, lowercase, digits, symbols, exclude_ambiguous, rotation_seconds}
GET    /api/pwsvc/projects/<id>/types       类型列表（含用户数）
PUT    /api/pwsvc/types/<id>                改策略（立即生效：当前窗口即按新策略重推导）
DELETE /api/pwsvc/types/<id>                有关联用户时 409

POST   /api/pwsvc/projects/<id>/users       创建用户 {username, type_id, display_name?}
GET    /api/pwsvc/projects/<id>/users       用户列表（不含密码/seed）
PUT    /api/pwsvc/users/<id>                改 display_name / status / reset_seed（旧密码全失效）
DELETE /api/pwsvc/users/<id>
GET    /api/pwsvc/users/<id>/current        当前密码 + expires_in（仅管理 UI）
GET    /api/pwsvc/projects/<id>/logs?page=&per_page=   校验日志（倒序分页）+ 失败统计

# 校验（第三方服务，X-Api-Key 认证）
POST   /api/pwsvc/validate
Headers: X-Api-Key: pws_xxx…
Body:    {"username": "user001", "password": "..."}
→ 200 {"data": {"valid": true, "expires_in": 23}} / {"data": {"valid": false}}；Key 错误 401；超限 429
```

**限流**（rate_limit，默认 120 次/分钟，0 = 不限）：进程内令牌桶（容量 = 每分钟额度，匀速回填），
超出返回 `429 请求过于频繁`；被限流的请求**不写日志**（防刷爆日志表）。改配置立即生效（清桶）。

**校验日志**（`pwsvc_validate_logs`）：每次校验（成功/失败/用户不存在）各记一行
（项目/用户名/结果/IP/时间，**永不含密码内容**），保留 30 天（写入时顺手清理过期行）。
`/logs` 响应附统计：

```json
{"data": {"items": [...], "total": 6, "page": 1, "per_page": 50,
  "stats": {"h1": {"ok": 2, "fail": 4}, "h24": {"ok": 2, "fail": 4},
             "fail_top": [{"username": "demo_user", "count": 3}]}}}
```

约束：rotation_seconds ∈ {30,60,120,300,600}；length 8-64 且至少启用一个字符集；
日志/审计**永不含密码内容**。详见 `docs/pwsvc-design.md`。

---

## 12. Sdklogs API（日志接收：lizysdk send_json 服务端）

> 接收 lizysdk `send_json=True` 逐条 POST 的 JSON 日志，批量落库、可检索。
> 存储跟随设置页数据库（`data/db_config.json` 切换即生效）；`ts` 统一 naive UTC
> （SDK 无时区时间戳按 `LOGSDB_INCOMING_TZ`（默认 Asia/Shanghai）解释，RFC3339 带时区直接采用）。
> 摄入端点**免认证**（SDK 无凭据直发；可选 `LOGSDB_AUTH_TOKENS` Bearer token，空=开放）；
> 检索/统计走统一登录（会话 Cookie 或 Basic）。

```
# 摄入（返回 202，落库异步）
POST /api/v1/logs            单条（body = SDK JSON 对象）
POST /api/v1/logs/batch      批量（JSON 数组 或 JSONL 文本，单批 ≤1000 条）
  → {"data": {"accepted": 5, "dead_lettered": 1}}
  坏日志（级别/时间戳/缺 sys_name）不报 4xx：进死信 data/dead_letters/YYYYMMDD.jsonl（可整文件重放回 batch）

# 检索（会话 Cookie/Basic；任意保留字之外的查询参数 = fields kv 过滤，如 ?user_id=123）
GET /api/v1/logs?start=&end=&sys_name=a,b&level=ERROR&level_gte=WARNING&trace_id=&q=全文&limit=100&offset=0
  → {"data": {"total": n, "items": [{id, ts, level, level_text, sys_name, file, line, trace_id, message, fields, received_at}]}}
GET /api/v1/logs/count       同过滤仅返回 total（无过滤走静态 count 快路径）
GET /api/v1/logs/sysnames    库内 distinct sys_name + 条数（查询页下拉数据源，按条数倒序；结果 5s TTL 缓存）
GET /api/v1/logs/histogram?buckets=60     时间直方图（10-240 桶，按级别分色；按查询串 5s TTL 缓存）
GET /api/v1/logs/context?id=&before=&after= 上下文（锚点高亮，前后各 N 条）
GET /api/v1/logs/patterns?limit=          模式分组（相似消息模板归并）
GET /api/v1/logs/export?format=json|csv   导出（≤1 万行）
GET /api/v1/logs/trace?trace_id=          同 trace_id 时间线
GET /api/v1/stats            近 24h 按 sys/level 计数 + accepted/dropped/failed/dead_letter + total_rows（DB 聚合 5s TTL 缓存，队列/计数器实时）
GET /api/v1/alerts · PUT /api/v1/alerts/config · POST /api/v1/alerts/check|ack   告警规则/事件/巡检/确认（详见 docs/modules/sdklogs.md）
```

- SDK 对接：`setup_logging(..., send_json=True, send_url="http://host:60100/api/v1/logs")`
- 写入路径：接收线程只入队（队满丢最旧并计数 dropped）→ 单写者线程批量落库（500 条/500ms），
  失败重试 2 次后进死信；停机排空队列
- 保留策略：`LOGSDB_RETENTION_DAYS`（默认 30，0=永久）每日清理超期行与死信文件
- kv 过滤参数名限 `[A-Za-z0-9_.-]`（防 JSON 路径注入）；message 全文 `LIKE` 转义 `%_`

---

---

## 13. Subs API（订阅管理，CrownFlow 迁移）

> 会员订阅管理（源自 CrownFlow 项目全量迁移）：**会员主表**（基础信息 + 提醒天数）一对多
> **订阅记录**（每次购买/续费一条：价格/币种/计费周期/起止日期/渠道），按**分类**组织；
> 支出统计按「日均 = 价格 ÷ 周期天数，实际支出 = 日均 × 与查询范围重叠天数（闭区间）」计算，
> 跨币种按 `settings.subs_exchange_rates` 静态汇率折算基准币（CNY）。
> 日期一律 `YYYY-MM-DD` 字符串；全部接口走统一登录（会话 Cookie 或 Basic）。

```
# 分类
GET    /api/subs/categories                        全部分类（按创建时间）
POST   /api/subs/categories                        {name(必填,唯一,≤50), icon?, color?} → 201
PUT    /api/subs/categories/<id>                   {name?, icon?, color?}
DELETE /api/subs/categories/<id>                   分类下有会员 → 400

# 会员（列表即带聚合字段：latest_subscription / status / subscription_count /
#       total_spending(折算基准币) / total_duration_days）
GET    /api/subs/members?page=&page_size=&keyword=&category_id=&status=active|expired&sort_by=created_at|name&order=asc|desc
       → {"data": {"items": [...], "total": n}}
GET    /api/subs/members/<id>                      详情（含全部订阅记录）
POST   /api/subs/members                           {name(必填,≤100), category_id?, notes?, reminder_days?, subscription?:{首条订阅}}
PUT    /api/subs/members/<id>                      {name?, category_id?, notes?, reminder_days?}
DELETE /api/subs/members/<id>                      级联删除其订阅记录

# 订阅记录
GET    /api/subs/members/<id>/subscriptions?status=active|expired&start_date=&end_date=&sort_by=created_at|start_date|end_date|price&order=
       （start_date+end_date 成对给出时筛选与区间有重叠的订阅）
POST   /api/subs/members/<id>/subscriptions        {price(必填,≥0), billing_cycle(必填: monthly|quarterly|yearly|custom),
                                                     start_date, end_date(必填), currency?(CNY|USD|EUR|GBP|JPY,默认CNY),
                                                     custom_days?(custom 必填,>0), level?, channel?, notes?} → 201
GET    /api/subs/subscriptions/<id>                详情（附 member_name）
PUT    /api/subs/subscriptions/<id>                部分更新（组合校验：起止顺序 / custom 需天数）
DELETE /api/subs/subscriptions/<id>

# 统计（spending/by-category/trend 需 start_date+end_date；trend granularity: day|week|month|quarter）
GET    /api/subs/stats/overview                    {total_members, active_members, monthly_spending, yearly_spending}
GET    /api/subs/stats/category-summary            各分类本月/年度支出 + 合计（Dashboard 表格）
GET    /api/subs/stats/spending?start_date=&end_date=        {total, daily_average, by_currency, categories[{...,percentage}]}
GET    /api/subs/stats/by-category?start_date=&end_date=     {categories[{...,details[{subscription_id,member_name,level,amount}]}], total}
GET    /api/subs/stats/trend?start_date=&end_date=&granularity=month
       → {"trend": [{date: 标签, amount, details: 按分类明细（day/week 标签为日期/mm/dd 区间，month=YYYY-MM，quarter=YYYY-Qn）}]}

# 提醒
GET    /api/subs/reminders/upcoming                end_date≥今天 且 剩余天数 ≤ 会员 reminder_days（按剩余天数升序）
GET    /api/subs/reminders/all                     全部未到期订阅（到期日历数据源）

# 备份（当前 SQLite 库快照 → data/backups/subs_YYYYMMDD_HHMMSS.db，自动清理超期；PG 后端返回 skipped）
POST   /api/subs/backup/run                        {status: ok|skipped|error, path?, size?}（status=error 时 HTTP 409）
GET    /api/subs/backup                            {total_count, total_size_mb, retention_days, newest/oldest_backup, backups[]}
```

**实测示例**（种子数据：Netflix 月付 ¥89/¥199、Disney+ 年付 $58 等 9 会员）：

```json
GET /api/subs/stats/overview
→ {"success": true, "code": 200, "data": {"total_members": 9, "active_members": 8,
   "monthly_spending": 416.32, "yearly_spending": 1747.07}}

GET /api/subs/reminders/upcoming
→ {"data": {"reminders": [{"member_name": "YouTube Premium", "days_remaining": 1, ...},
                           {"member_name": "Netflix", "days_remaining": 10, ...}]}}

GET /api/subs/members?keyword=netflix
→ {"data": {"items": [{"name": "Netflix", "status": "active", "subscription_count": 2,
   "total_spending": 294.0, "total_duration_days": 61, "latest_subscription": {...}}], "total": 1}}
```

**错误码**：401 认证失败；400 参数缺失/格式非法/日期倒置/币种或周期非法/分类或会员不存在/有关联分类不可删；404 资源不存在；409 分类重名。
**会员状态口径**：任意一条订阅 `end_date ≥ 今天` ⇒ `active`，否则 `expired`。
**月/年支出口径**（CrownFlow 原口径）：按日均 × **整月/整年** 覆盖天数计算（非"至今"）。
**后台任务**：每日 02:00 自动备份（`SUBS_BACKUP_ENABLED=0` 关闭）、10:00 当日活跃订阅支出摘要写模块日志（sys_name=doublog.subs）。

---


---

## 14. API Hub API（统一 API 调用平台）

> 聚合异构上游 API，统一以平台令牌调用；四级限流 / 计次配额 / 密钥池 / 一键与定时探活。
> 模块代码 `app/apihub/`，前端页面 `/apihub`。管理端走 Basic Auth；**网关入口走平台令牌（sk-，不挂 Basic Auth）**。

### 14.1 网关调用（外部调用方，Authorization: Bearer sk-…）

```
# 统一信封：path/query/header 四个桶 + body
POST   /api/apihub/gw/apis/{slug}
       body: {"path": {...}, "query": {...}, "header": {...}, "body": {...}}

# 透明代理：原路径/query/body 透传（存量客户端只换 base_url 与鉴权头）
ANY    /api/apihub/gw/upstreams/{upstream_slug}/{path}
```

- 响应默认透传（含上游状态码与 `X-Hub-Latency-Ms`）；API 配置 `response_cfg.envelope=wrap` 时返回统一信封 `{code,message,data,meta}`
- 错误归一化双通道：HTTP 状态 + `response_cfg.error_mapping`（`body_code_path/success_codes/body_message_path`，适配"HTTP 200 + body code 表错"的国内 API）
- 429 响应头：`Retry-After` / `X-RateLimit-Scope`（token_api|api|token|global）/ `X-RateLimit-Limit` / `X-RateLimit-Remaining`
- 上游 401/403 → 自动禁用该把 key 并换 key 重试；连接错误仅在有备选 key 时计失败（连续 3 次冷却 10s）；超时 → 504；全部失败 → 503
- API 健康状态 down 时拒绝调用（503 unhealthy）；探活恢复后自动放行

**实测示例**（上游指向本服务 /health，api_key_header 鉴权注入）：

```json
POST /api/apihub/gw/apis/healthz   (Authorization: Bearer sk-…)
→ {"status": "healthy"}            # 上游响应原样透传，X-Hub-Latency-Ms: 0

第 3 次调用（API 总量规则 2 次/60s）→ 429
  Retry-After: 22, X-RateLimit-Scope: api, X-RateLimit-Limit: 2, X-RateLimit-Remaining: 0
```

### 14.2 管理端（Basic Auth，统一 {success,code,message,data} 包装）

```
上游      GET/POST /api/apihub/admin/upstreams   PUT/DELETE /api/apihub/admin/upstreams/{id}
密钥池    GET/POST /api/apihub/admin/upstreams/{id}/keys   PUT/DELETE /api/apihub/admin/upstreams/keys/{kid}
API       GET/POST /api/apihub/admin/apis        PUT/DELETE /api/apihub/admin/apis/{id}
一键启停  PUT /api/apihub/admin/apis/{id}/enabled   {"enabled": bool}（关闭后 gw/openapi 立即 503「已关闭，不可用」；/doc 不受影响）
平台令牌  GET/POST /api/apihub/admin/tokens      PUT/DELETE /api/apihub/admin/tokens/{id}
限流规则  GET/POST /api/apihub/admin/rules       PUT/DELETE /api/apihub/admin/rules/{id}
出站代理  GET /api/apihub/admin/proxy            PUT /api/apihub/admin/proxy   {"enabled","host","port"}
连通测试  POST /api/apihub/admin/proxy/test      # 经当前配置探测 https://bots.qq.com/，任意 HTTP 状态即隧道通
调试调用  POST /api/apihub/admin/apis/{id}/invoke  # 页面「调用」弹窗：{"path":{},"query":{},"body":…}
                                                   # 不走平台令牌/限流/配额；返回 {status_code,latency_ms,ok,body}（上游原文）；日志 mode=test
探活      POST /api/apihub/probes/run            {"api_ids": [id,…]}  # 空=全部
日志/统计 GET /api/apihub/logs?api_id=&token_id=&limit=   GET /api/apihub/stats/overview
```

要点：
- **上游 auth_config**（JSON）：`{providers: [...], credential_fields: [...], transport: {...}}`；
  providers 类型 = 七种静态 `bearer / api_key_header / query_key / basic / static_cookie / path_token / template`
  + **动态令牌 `qq_bot`**（2026-10-17，QQ 开放平台专用：appId+secret 换 access_token 约 7200s，
  进程内缓存、过期前 5 分钟自动刷新，注入 `Authorization: QQBot <token>`；凭证字段
  `app_id`/`app_secret`；provider 可选 `token_url` 覆盖端点，默认
  `https://bots.qq.com/app/getAppAccessToken`）；
  凭证模板 `{cred.字段}` 可用于 header/query/cookie 与 base_url/路径模板；多 provider 组合支持（数组）
- **出站代理**（全局可选，`data/apihub_proxy.json`，/config 页读写）：仅 https 上游且非 localhost
  走正向代理 CONNECT 隧道（本机 Clash 等）；http 上游与本机回环始终直连；保存即生效
  （旧空闲连接自然淘汰）
- **API 参数默认值**（request_cfg 内，2026-10-17）：`param_defaults`（dict）为**路径模板变量**
  提供缺省、`body.defaults`（dict）为 **JSON body 顶层字段**提供缺省——调用方未传时填充、
  显式传值优先；gw invoke 与 OpenAPI 入口行为一致。QQ 场景示例：
  `{"param_defaults": {"openid": "B93C…"}, "body": {"type": "json", "defaults": {"msg_type": 0}}}`
  → 调用方只需 `{"content": "告警内容"}`
- **密钥池**：credential 按 credential_fields 填字典；列表只回脱敏指纹（`abc***23`），明文不落日志
- **平台令牌**：`sk-` 前缀 SHA-256 落库，**明文仅创建响应返回一次**；属性：expires_at / allowed_api_ids / allowed_ips / quota_total（计次，预占-退还语义）
- **限流规则**：scope = token_api|api|token|global（同层多条取最严格）；algorithm = token_bucket(rate_per_sec+burst) | fixed_window(window_s+max_count)；列表附当前用量 usage
- **探活 probe**（JSON）：path（默认=API 自身路径）/expect_status/expect_body_regex/interval_s（>0 定时探，down 态间隔×5）/failure_threshold/success_threshold
- **OpenAPI 发布字段**（2026-10-12，API 增删改均支持）：`group1`（一级分组，空=不发布）、`group2`（二级，需先有一级，**最多二级**）、
  `pub_name`（对外 api 名称，空=slug，分组内唯一，`doc` 为保留字）、`doc_md`（Markdown 文档补充段落）

### 14.3 OpenAPI 发布入口（2026-10-12；顶级路径，鉴权 = apihub 平台令牌 sk-）

```
# 对外调用（method/query/body 原样转发；路径模板变量以 query 参数注入）
ANY  /openapi/{一级分组}/{二级分组}/{api名称}        # 二级可空：/openapi/{一级}/{api名称}
GET  /openapi/{一级分组}/{二级分组}/{api名称}/doc    # 完整 Markdown 文档（公开无鉴权）
```

- api 名称 = `pub_name`（管理端可自设），缺省 slug；服务内 API 由 `tools/apihub_register_self.py`
  统一发布为 `self/<模块名>/...`（一级=自我服务，二级=模块）
- **服务内 API 不走用户身份验证**：上游回源经内部服务令牌 `X-Apihub-Token`（密钥文件
  `data/internal_token` 自动生成，`require_basic` 见此头即信任）；调用方鉴权完全由 apihub
  平台令牌（sk-）承担，不接触内部凭据
- 路径变量：内部路径模板 `/api/todo/tasks/{path.task_id}` 的变量以**同名 query 参数**注入
  （`?task_id=123`），该参数不再转发；缺变量 400 `template_error`
- 四级限流/计次配额/健康阻断/密钥池与 gw invoke 完全一致（共用 api 级规则）；调用日志 `mode='openapi'`
- 方法不符 405（带 `Allow`）；`/doc` 返回 `text/markdown`：元信息（分组/上游/方法/模板/地址）+
  认证说明 + 路径变量表 + 限流 + curl 示例 + `doc_md` 自定义段落

**实测示例**（self 注册后）：

```
GET /openapi/self/todo/todo-get-todo-tasks        (Authorization: Bearer sk-…)
→ {"success":true,"code":200,...}                  # 与直连响应逐字节一致

DELETE /openapi/self/todo/todo-delete-todo-tasks-task_id?task_id=<uuid>
→ 200 {"success":true,...,"data":{"ok":true}}      # 路径变量经 query 注入

GET  /openapi/self/blog/blog-get-posts/doc         # 公开，text/markdown
```

**QQ 机器人接入实测**（2026-10-17，上游 `qq` + `qq_bot` provider + 出站代理）：

```
# 管理端一次性注册（auth_config.providers=[{"type":"qq_bot"}]、凭证 {app_id, app_secret}；
# request_cfg={"param_defaults":{"openid":"B93C…"},"body":{"type":"json","defaults":{"msg_type":0}}}）

POST /api/apihub/gw/apis/qq-send-c2c       (Authorization: Bearer sk-…)
{"body": {"content": "告警内容"}}           # openid/msg_type 走默认值

→ 200 {"id":"ROBOT1.0_3sPbBo68VNkUDW.Cu1ggNj-…","timestamp":"2026-10-17T10:09:59+08:00",…}
```

## 15. Todo API（四象限待办，MyTodo 迁入）

> 模块代码 `app/todo/`，前端页面 `/todo`。**全部接口挂统一登录**（会话 Cookie 或 Basic）。
> 数据表 `todo_*` 五表；象限 = is_important × is_urgent 派生；revision 乐观锁。详见 `docs/modules/todo.md`。

```
# 任务
GET    /api/todo/tasks                   过滤 ?date= ?from=&to= ?inbox=1 ?overdue=1 ?status=active|all|done
                                            ?category_id= ?quadrant=1-4 ?q= ?sort= ?plan_only= ?exclude_plans=
POST   /api/todo/tasks                   新建 201 {title, is_important?, is_urgent?, task_date?, category_id?, description?, due_at?…}
GET    /api/todo/tasks/{id}              详情（含最近 50 条事件）
PATCH  /api/todo/tasks/{id}              更新（body 带 revision，冲突 409）
DELETE /api/todo/tasks/{id}              软删
POST   /api/todo/tasks/{id}/restore      恢复
POST   /api/todo/tasks/{id}/complete     完成 {completed_at?, note?}
POST   /api/todo/tasks/{id}/reopen       重开
POST   /api/todo/tasks/{id}/move         改象限 {is_important, is_urgent, before_task_id?}
POST   /api/todo/tasks/{id}/reorder      象限内排序 {before_task_id?}（浮点中点）

# 类别
GET/POST /api/todo/categories - PATCH/DELETE /api/todo/categories/{id}（删除时任务归未分类）

# 今日 / 迁移
GET    /api/todo/today                   ?date=（四象限分组+待迁移+昨日概况+streak+软上限）
GET    /api/todo/migrations/pending      待迁移（含干预标记）
GET    /api/todo/migrations/shelved      已搁置
POST   /api/todo/tasks/{id}/migrate      {to_date, reason}
POST   /api/todo/migrations/bulk         {task_ids, to_date, reason}
POST   /api/todo/migrations/decide       {task_id, decision: keep|delete|unshelve}
POST   /api/todo/migrations/auto         自动迁移 {migrated: n}

# 统计
GET    /api/todo/stats/daily             ?date=
GET    /api/todo/stats/range             ?from=&to=
GET    /api/todo/stats/heatmap           ?year=
GET    /api/todo/stats/streak            {current, best, total_active, last_active_date}

# 设置 / 通知 / 规律生活
GET/PUT /api/todo/settings               字段级增量（timezone/象限文案/阈值/通知渠道）
POST   /api/todo/notifications/test      {channel} 实测发送（email）
GET/POST /api/todo/plans - GET /plans/today - GET /plans/report?days= - PATCH/DELETE /plans/{id}

## 16. Gamemap API（剧情图谱，独立顶级模块；13 表 gamemap_*）
GET/POST /api/gamemap/games · GET /games/{id}/export · POST /games/import · GET /games/{id}/stats
GET/POST /api/gamemap/games/{gid}/chapters|characters · characters 批量 POST /batch
GET    /api/gamemap/games/{gid}/boards/chapters/{cid}   # 单章看板
GET    /api/gamemap/games/{gid}/boards/merged?chapter_ids=   # 跨章聚合看板
PATCH  /api/gamemap/games/{gid}/boards/chapters/{cid}/nodes/{cid2}  # 拖动保存
PUT    /api/gamemap/games/{gid}/boards/chapters/{cid}   # 整板保存（乐观锁 409）
GET/POST/PATCH/DELETE /api/gamemap/chapters/{cid}/events · /games/{gid}/characters/{cid}/photos
GET/POST /api/gamemap/relation-types · GET /games/{gid}/relation-types ·
       PUT /games/{gid}/relation-types/{type_id}/override（游戏级 override；全局类型无 PATCH/DELETE）
GET    /api/gamemap/search?q= · POST /api/gamemap/uploads
GET    /api/gamemap/files/{name}                        # 附件下载（免认证，目录围栏）

## 17. Practice API（刷题，独立顶级模块；22 端点，6 表 practice_*，规范 docs/practice-spec.md）
# 题目（revision 乐观锁 409；列表/队列摘要 defer 不回传 description_md/pitfall_md 大字段，恒 null）
GET    /api/practice/problems            多维筛选 ?q=（标题/题号 icontains，超 200 截断）
                                               ?tags=id1,id2&tags_op=and|or ?difficulty=1,3 ?status= ?source=
                                               ?language= ?from=&to=（创建日期区间 YYYY-MM-DD）?only_due_review=true
                                               ?sort=created_desc|solved_desc|difficulty_asc|review_asc
                                               ?page=（钳 1-1000）?page_size=（钳 1-100）→ {items[每题摘要：tags/
                                               solution_count/code_languages/next_review], total, page, page_size}
POST   /api/practice/problems            201 {title*, source=leetcode|luogu|nowcoder|sword|other,
                                               source_no?, difficulty 1-3, url?, description_md?, pitfall_md?,
                                               status=todo|solved|reviewing|mastered, first_solved_at?, tag_ids?,
                                               tag_names?（按名建/挂）, solutions?:[{name*, approach_md?,
                                               time_complexity?, space_complexity?, is_preferred?, codes?:[{language*,
                                               code*, note?}]}]}；非 todo 态自动补 first_solved_at=今天；
                                               status=reviewing 建题即加入复习（首条 pending 明天到期）
GET    /api/practice/problems/{id}       详情（题目字段扁平 + tags + solutions(含 codes) + next_review）
PATCH  /api/practice/problems/{id}       更新（body 必带 revision，冲突 409；tag_ids 整体替换关联；
                                               进/出 reviewing 自动建/取消 pending 复习行）
DELETE /api/practice/problems/{id}       软删（级联硬删解法/代码/复习行/标签关联）
POST   /api/practice/problems/{id}/review     三键打卡 {result: remembered|fuzzy|forgot}（无 pending 404）；
                                                    艾宾浩斯 [1,2,4,7,15,30,60,120]：remembered 进下一档（顶档→
                                                    毕业 status=mastered）；fuzzy 原档重复；forgot 回 1 天，连续
                                                    2 次 forgot→题目回 todo → {graduated, demoted, result,
                                                    next_interval_days, next_scheduled_date, next_review?}；并发 409
POST   /api/practice/problems/{id}/unreview   退出复习（仅 reviewing：pending 置 cancelled，题目回 solved）；
                                                    非 reviewing 幂等返回 {cancelled: 0}

# 解法 / 代码（solution 独立乐观锁；code 行无独立锁——校验/递增的都是父级 solution.revision）
POST   /api/practice/problems/{pid}/solutions  201 建解法（is_preferred 单题至多一个）
                                                    PATCH/DELETE /api/practice/solutions/{sid}（revision 409）
POST   /api/practice/solutions/{sid}/codes     201 {language*, code*, note?}（language 16 项白名单 400；
                                                    同解法同语言重复 409）
                                                    PATCH/DELETE /api/practice/codes/{cid}（revision 传父级
                                                    solution.revision）

# 标签
GET/POST /api/practice/tags              GET 含每标签 problem_count；POST 201 {name*, color?, sort_order?}
                                               （color 缺省色板轮询；重名 400）· PATCH/DELETE /tags/{tid}
                                               （删除自动解除全部题目关联）

# 一键抓题（纯网络代理，不落库；草稿进程内缓存 1h）
POST   /api/practice/fetch               {source: leetcode|luogu|auto, url|slug|source_no} → 标准化草稿
                                               {source, source_no, title, difficulty, url, description_md,
                                               tag_names[], pitfall_md}；LeetCode 走国际站 GraphQL（纯数字题号
                                               400 引导粘完整链接；会员题 400）；洛谷走 x-lentille-request 新 API；
                                               网络异常收敛为中文分类文案 400

# 复习 / 统计 / 导入导出
GET    /api/practice/review/today        今日队列（pending 且 scheduled_date≤今天，到期升序）→
                                               {today, items[{review_id, scheduled_date, prev_interval_days,
                                               cycle, seq, overdue_days, problem: 摘要}]}
GET    /api/practice/stats/overview      {total, by_status, by_difficulty, by_source, languages, trend[近 30 天
                                               逐日新增], tags[{id,name,color,total,mastered}], review{pending,
                                               due_today, done, cancelled, completion_rate}}
POST   /api/practice/import              JSON {tags[], problems[]}（≤5000 题，按 id upsert 无损还原）或
                                               multipart zip（Obsidian vault：上传 ≤20MB / 条目 ≤2000 / 单条目解压
                                               ≤10MB / 累计解压 ≤50MB；按 source+source_no 或标题去重跳过）→
                                               JSON {imported_tags, imported_problems} / zip {imported_problems,
                                               skipped, invalid}
GET    /api/practice/export              ?output_format=json|md——json 全量导出走信封（含标签/解法/代码/复习
                                               流水）；md 返回二进制 zip（attachment，practice 唯一非信封响应）
```

## 18. Steamidler API（Steam 挂机，独立顶级模块）

```
POST /api/steamidler/login/begin {username,password} · POST /login/code · GET /login/status?attempt_id=
GET  /api/steamidler/accounts · DELETE /accounts/{steamid} · GET /accounts/{steamid}/log|games
POST /api/steamidler/accounts/{steamid}/idle {appids:[]} | /stop | /shared_secret | /auto_resume · GET /meta
```

## 19. 配置中心 API（confcenter）

> 模块代码 `app/confcenter/`，前端页面 `/confcenter`。全部接口挂统一登录。
> 扁平 KV：namespace+key 唯一定位 value；value = {type, data}（str 原样 / json 校验）；type 可变更。

```
GET    /api/confcenter/namespaces              # namespace + 条目数（包括空空间）
POST   /api/confcenter/namespaces              # {namespace} → 201；重名 409；非法名称 400
GET    /api/confcenter/entries                 # ?namespace= &q= &page= &page_size=
GET    /api/confcenter/{ns}/{key}              # 读：str→字符串，json→解析后结构
PUT    /api/confcenter/{ns}/{key}              # upsert {type, data}（201 新建/200 覆盖；json 非法 400）
DELETE /api/confcenter/{ns}/{key}              # 200 / 404
GET    /api/confcenter/cache/status            # {enabled, configured, reachable, url_masked, hits, misses}
GET/PUT /api/confcenter/cache/config           # Redis 配置（enabled/host/port/db/password/ttl；密码留空沿用）
POST   /api/confcenter/cache/test              # 连通性测试（可带候选配置）
POST   /api/confcenter/cache/flush             # 清空 confcenter:* 缓存键
```


创建 namespace（临时 SQLite 实测，HTTP 201）：

```json
{"namespace":"infra"}
```

响应：

```json
{"success":true,"code":201,"message":"空间创建成功","data":{"namespace":"infra","count":0}}
```

名称为 1–100 个 `[A-Za-z0-9_.:-]` 字符。空 namespace 独立保存，删除最后一条 KV 后仍会在列表中返回 `count: 0`；启动时幂等登记历史 KV 的 namespace。为兼容已有客户端，直接 PUT 到新 namespace 仍会在创建 KV 的同一事务内登记该空间；前端流程固定先建空间，再在选中空间内创建 KV。`GET /entries` 省略 namespace 的旧版全量浏览契约保留。

## 20. Clash API（代理管理：clashctl 全能力的 Web 迁移）

> 模块代码 `app/clash/`，前端页面 `/clash`；**底层能力完全复用本机 clashctl**（bash 函数集，`~/clashctl`，可用环境变量 `DOUBLOG_CLASHCTL_DIR` 覆盖），本模块只做 Web 迁移。无数据表。
> 全部接口挂统一登录；处理器为同步 def（subprocess 阻塞数秒走线程池）。实测示例（kernel=mihomo）：

```bash
# 安装检测（门户卡片置灰依据；未安装时 available=false 不报错）
$ curl -u admin:*** http://localhost:60100/api/clash/availability
{"success":true,"code":200,"message":"操作成功","data":{"available":true,"base_dir":"/home/lizy/clashctl","kernel":"mihomo"}}

# 内核状态 / 启停（clashctl status / on / off）
GET  /api/clash/status
# → data: {"running":true,"output":"529710 /home/lizy/clashctl/bin/mihomo -d ..."}
POST /api/clash/on      # → message "😼 已开启代理环境"
POST /api/clash/off     # → message "😼 已关闭代理环境"

# 系统代理（clashctl proxy [on|off]）：查询靠退出码语义 0=开启/1=关闭
GET  /api/clash/proxy          # → {"enabled":true,"output":"😼 系统代理：开启\n..."}
POST /api/clash/proxy          # body {"enable":true|false}

# Tun（clashctl tun [on|off]；需 sudo，失败首行透传，如 "sudo: a password is required"）
GET  /api/clash/tun            # → {"enabled":false,"output":"😾 Tun 状态：关闭"}
POST /api/clash/tun            # body {"enable":true|false}

# Web 控制台地址（clashctl ui 原始输出）/ 密钥（clashsecret [new]）
GET  /api/clash/ui             # → {"output":"╔══...Web 控制台...9090/ui..."}
GET  /api/clash/secret         # → {"secret":"HnR7lD","output":"😼 当前密钥：HnR7lD"}
PUT  /api/clash/secret         # body {"secret":"xxx"}；1-64 位可打印字符，不含空格/引号（400）
                                # 写 mixin + 合并重启生效

# 升级内核（clashctl upgrade [-r|-a]）
POST /api/clash/upgrade        # body {"channel":""|"release"|"alpha"}，其他值 400

# 内核日志（clashctl log）：mihomo.log 尾部，?tail=1..5000 默认 200
GET  /api/clash/log?tail=200   # → {"path":".../mihomo.log","tail":200,"level":"silent","content":"time=..."}

# 配置文件（clashmixin / -c / -r）；file 仅 mixin|base|runtime，其他 400
GET  /api/clash/config?file=mixin    # → {"file":"mixin","path":".../mixin.yaml","editable":true,"content":"..."}
PUT  /api/clash/config               # body {"content":"..."}，仅 mixin；保存即合并并重启内核（同 clashmixin -e）

# 订阅（clashsub ls / add / del / use / update）——add/update 下载**剥离代理 env 直连**
# （后端进程的 *_proxy 指向本机 clash，出口不可达时会拖垮下载；实测直连更稳）
GET  /api/clash/sub            # → {"use":5,"profiles":[{"id":5,"url":"https://...","path":".../5.yaml"}]}
POST /api/clash/sub            # body 按动作：
       {"action":"add","url":"https://..."}        # URL 须 http(s):// 或 file:// 开头、无空格引号（400）
       {"action":"del","id":6}                     # 删除使用中的订阅会被 clashctl 拒绝（400 透传）
       {"action":"use","id":6}                     # 切换并合并重启
       {"action":"update","id":6,"convert":true}   # convert=订阅转换；flag 在 id 之前（clashctl 语义）
       {"action":"update","auto":true}             # 配置 crontab 自动更新（每 2 天）
GET  /api/clash/sub/log?tail=200    # profiles.log 尾部

# 日志级别（实时日志开关）：GET /log 附带 level；订阅配置常带 log-level: silent——
# 内核静默后日志文件不再增长，页面"实时"无从谈起
GET  /api/clash/log?tail=200   # → {...,"level":"silent","content":"..."}
POST /api/clash/log/level      # body {"level":"info"}（debug|info|warning|error|silent，其他 400）
                               # yq 写 mixin 的 log-level + 合并重启（等价 clashmixin -e 改一行）
                               # → message "😼 日志级别已切换为 info，已重启生效"
```

**通用错误**：clashctl 未安装时除 `/availability` 外全部 404（`clashctl 未安装（未找到 <script 路径>）`）；动作类命令失败（退出码≠0）→ 400，clashctl 输出首行透传在 message；超时 → 504。完整行为契约见 `docs/modules/clash.md`。

### 20.1 控制器 API（mihomo external-controller 转发——zashboard 核心能力）

> 前缀 /api/clash/controller；secret 只留在后端（runtime.yaml 解析，响应不回传）；
> 内核未运行 → 503「控制器不可达」；mihomo 4xx → 400 透传。实测示例（mihomo v1.19.17）：

```
GET    /api/clash/controller/version                  # {"meta":true,"version":"v1.19.17"}
GET    /api/clash/controller/configs                  # {mode,allow-lan,log-level,mixed-port,...}
PATCH  /api/clash/controller/configs                  # body {mode:'rule|global|direct'} / {allow_lan:bool}
                                                     # / {log_level:...} —— 热切换即时生效不重启
GET    /api/clash/controller/proxies                  # 策略组+节点：{groups:[{name,type,now,
                                                     #   nodes:[{name,type,alive,delay}]}]}
PUT    /api/clash/controller/proxies                  # body {group,name} 切换 Selector 组节点
GET    /api/clash/controller/proxies/delay?name=&url=&timeout=   # 单节点 → {"delay":168}
GET    /api/clash/controller/group/delay?group=&url=&timeout=    # 整组并发 → {"节点A":56,"节点B":177,...}
GET    /api/clash/controller/connections              # {uploadTotal,downloadTotal,memory,
                                                     #   connections:[{id,host,rule,chains,upload,download,start,source}]}
DELETE /api/clash/controller/connections              # 断开全部
DELETE /api/clash/controller/connections/{id}         # 断开单条
GET    /api/clash/controller/rules                    # {rules:[{type,payload,proxy}],total}
GET    /api/clash/controller/providers                # 节点池（HTTP 订阅 vehicleType）
PUT    /api/clash/controller/providers                # body {name} 热更新节点池（不重启内核）
```

## 21. Assets API（资产库：Prompt 与 Skill）

模块文档：`docs/modules/blog.md` 资产库子域节。**2026-10-17 自独立模块并入 blog**（路径/契约不变，sys_name 由 doublog.assets 改为 doublog.blog）。前缀 `/api/assets`，全部挂认证（会话 Cookie / Basic）；
统一信封；**列表接口不含正文**（`content` 仅详情/导出返回）。

### 21.1 分类

```
GET    /api/assets/categories                     # 列表（含末尾 id=null 的「未分类」聚合项）
POST   /api/assets/categories                     # {name, icon?, color?, kind?, sort_order?} → 201
PUT    /api/assets/categories/{id}                # 部分更新（改名撞名 → 409）
DELETE /api/assets/categories/{id}                # 分类下仍有资产 → 409「请先移动或删除」
```

分类字段：`name`（唯一，≤50 字符）、`icon`（emoji，≤10）、`color`（hex，≤7）、
`kind`（all/prompt/skill，默认 all）、`sort_order`（int，小在前）。
列表项附 `item_count / prompt_count / skill_count`（非回收站资产）。

### 21.2 资产 CRUD

```
GET    /api/assets/items                          # 列表（见下过滤参数）
POST   /api/assets/items                          # 创建 → 201（v1 快照「初始版本」）
GET    /api/assets/items/{id}                     # 详情（含 content）
PUT    /api/assets/items/{id}                     # 部分更新；内容类字段变更 → 版本 +1
DELETE /api/assets/items/{id}                     # 软删入回收站；?hard=1 物理删除（级联版本/日志）
POST   /api/assets/items/{id}/restore             # 回收站/归档 → active（已在库中 → 409）
POST   /api/assets/items/{id}/duplicate           # 复制（撞名自动「（副本）」后缀）→ 201
POST   /api/assets/items/{id}/use                 # 记录使用 {action: copy|fill|export}（默认 copy）
POST   /api/assets/items/bulk                     # {ids[≤500], action, category_id?}
```

创建/更新载荷：`kind`（prompt/skill）、`title`（必填 ≤200）、`summary`（≤500）、
`content`（必填）、`tags`（≤20 个，单个 ≤32 字符，禁引号/反斜杠）、`category_id`（可空）、
`favorite`（bool）、`version_note`（≤200，内容变更时的版本备注）。
`variables` 由服务端从正文 `{{name}}` 提取，不接受前端传入。

**列表过滤**：`?kind=&category_id=<int|none>&tag=&favorite=1&status=active|archived|trash|all
&q=<关键词>&sort=updated_desc|created_desc|usage_desc|title_asc|last_used_desc&page=&page_size=`；
`q` 匹配标题/摘要/正文（LIKE 转义）。响应 `{items, total, page, page_size}`。

**批量动作**：favorite / unfavorite / archive / unarchive / trash / restore / hard_delete /
move（需 `category_id`，null=移到未分类）→ `{affected}`。

**版本策略**：title/summary/content 实际变更才快照（相同内容重复保存不产生版本）；
tags/category/favorite/kind 为元数据变更。回收站资产禁止编辑/使用/恢复版本（409）。

```json
// POST /api/assets/items → 201
{"kind":"prompt","title":"代码审查助手","content":"请审查 {{language}} 代码","tags":["编程"]}
// → data: {"id":1,"kind":"prompt","variables":["language"],"version":1,"status":"active",...}
```

### 21.3 版本

```
GET  /api/assets/items/{id}/versions              # 版本列表（v 大在前，不含正文）
GET  /api/assets/versions/{vid}                   # 单版本（含 content，供前端 diff）
POST /api/assets/items/{id}/versions/{vid}/restore  # 恢复 → 产生新版本（note「恢复自 vN」）
```

恢复「当前版本」→ 409；跨资产版本 id → 404。

### 21.4 标签 / 统计

```
GET /api/assets/tags                              # [{tag, count}]（非回收站，count 降序）
GET /api/assets/stats                             # 见下
```

stats 返回：`totals`（prompts/skills/active/archived/trash/favorites/categories/tags/
versions/total_usage）、`by_category`（含未分类聚合）、`top_used`（TOP5，使用数>0）、
`recent_used`（按 last_used_at 倒序 TOP5）、`usage_trend`（近 30 天逐日计数，零值补齐）。

### 21.5 导入 / 导出

```
GET  /api/assets/export                           # JSON 附件（非信封；Content-Disposition 下载）
     ?kind=&category_id=&favorite=&q=&include_trash=&include_versions=
GET  /api/assets/items/{id}/export?format=md|json # 单条导出（md = JSON frontmatter + 正文）
POST /api/assets/import                           # {items|[...], mode, dry_run}
```

导出格式：`{generator:"doulog-assets", version:1, exported_at, count, items:[...]}`
（item 含 content/tags/category 名称；`include_versions=1` 附完整版本链）。

导入：接受导出格式或裸数组；条目最小 `{title, content}`（默认 kind=prompt）；
`category` 接受名称字符串/`{name}`/id。`mode=create`（总是新建）/ `upsert`（按
「kind+标题」在非回收站资产中匹配更新，内容变更产生版本）。`dry_run=true` 只校验不落库。
响应 `{created, updated, errors:[{index,title,error}], categories_created, valid}`——
单条非法进 errors 不阻断整体；载荷无 items / 超 500 条 / mode 非法 → 400。
导出项含 Skill 包文件（`files:[{path,size,is_text,content}]`）与原始压缩包
（`archive_name` + `archive_b64`），导入时随条目恢复（create 模式）。

### 21.6 Skill 包导入（单文件 / zip）

```
POST /api/assets/skills/import       # multipart file：.md/.markdown/.txt 单文件（宽松）
                                     # 或 .zip 压缩包（严格规格校验）
GET  /api/assets/items/{id}/files    # 文件清单 [{id,path,size,is_text}]（树展示用）
GET  /api/assets/files/{fid}         # 单文件内容（含 content；二进制 content=null）
GET  /api/assets/items/{id}/archive  # 下载原始 zip（无原包 → 404）
```

**zip 规格（Agent Skills 惯例，`app/blog/assets/skills.py`）**：必须恰好一个 `SKILL.md`
（根或单层子目录均可，自动剥技能根目录前缀）；SKILL.md 需 YAML frontmatter 且
必含 `name`（小写字母/数字/连字符 ≤64）与 `description`（非空 ≤1024）——导入后
`title=name`、`summary=description`（**描述自动提取并先输出**，响应带 `skill`
字段：`{name, description, entry, files[]}`）。防护：zip-slip（绝对路径/`..`）→
400、条目 ≤200、解压总量 ≤20MB、单文件 ≤5MB、上传本体 ≤10MB；`__MACOSX/`、
`.git/`、`__pycache__/`、`.DS_Store` 等打包噪音任意层级自动忽略。文本文件
（按扩展名白名单）≤512KB 内容入库可预览，二进制只存元数据；原始 zip 保留
（`archive` 列）供下载原包与导出往返。

**单文件宽松**：有合规 frontmatter 走严格提取；无 frontmatter 也可导入
（标题=文件名，摘要=首个非标题行）。复用：zipfile（标准库）+ PyYAML（既有依赖）。

```json
// POST /api/assets/skills/import → 201（节选）
{"title":"pdf-report","kind":"skill","summary":"把文档批量转成 PDF…","files_count":5,
 "archive_name":"pdf-report.zip",
 "skill":{"name":"pdf-report","description":"把文档批量转成 PDF…","entry":"SKILL.md",
          "files":["SKILL.md","reference/参数说明.md","scripts/convert.py"]}}
```



## 22. Bookmarks API（书签与稍后阅读，独立顶级模块；23 端点，4 表 bookmarks_*）

> 后端 `app/bookmarks/`；前端 `/bookmarks`；权威文档 `docs/modules/bookmarks.md`。
> 统一信封 + Basic/会话认证（同全局规范）。状态机：`unread → reading → read`（→read 记 `read_at`，离开清空）；`archived` 归档；`starred` 独立维度；软删（`deleted_at`）进回收站。
> **URL 规范化**（`normalized_url`，查重/重复检测统一口径）：host 小写、去默认端口/fragment、剥 `utm_*` 参数、路径保持大小写、裸域名补 `https://`；`mailto:` 等非 http(s) 原样。

### 22.1 分类（文件夹树，≤3 层）

```
GET    /api/bookmarks/categories                 # 分类树（含直接/累计条目计数）
POST   /api/bookmarks/categories                 # body {name, parent_id?, after_sort?}；同级重名 409；超 3 层 400
PATCH  /api/bookmarks/categories/{cid}           # {name?, parent_id?(显式 null=提顶级), sort_order?}；移入自己子孙 400
DELETE /api/bookmarks/categories/{cid}           # 子分类与书签上提一级（不删书签）→ {moved_children}
```

### 22.2 条目

```
GET    /api/bookmarks/items                      # 筛选：q(标题/URL/摘要/站名) status category_id(默认含子孙,
                                                 #   include_descendants=false 关闭) tag_ids(逗号) tags_op=and|or
                                                 #   starred link_status trash=1 sort page page_size(≤100)
                                                 #   sort: created_desc|created_asc|updated_desc|title_asc|read_desc|checked_asc
                                                 # → {items(不含 note/snapshot_md 大字段), total, page, page_size}
POST   /api/bookmarks/items                      # {url*, title?, description?, note?, site_name?, favicon_url?,
                                                 #   category_id?, status?, starred?, tag_ids?, tag_names?}
                                                 # title 缺省=域名；URL 查重 409（message 带 id）；→ 201 条目（full）
GET    /api/bookmarks/items/{iid}                # 详情（含 note/snapshot_md/tags）
PATCH  /api/bookmarks/items/{iid}                # 部分更新；category_id 显式 null=未分类；改 URL 重新查重；
                                                 #   tag_ids/tag_names 整体替换（不传=不动）
DELETE /api/bookmarks/items/{iid}                # 软删 → 回收站
POST   /api/bookmarks/items/{iid}/restore        # 还原；同链新书签已存在 → 409
DELETE /api/bookmarks/items/{iid}/purge          # 彻底删除（级联标签关联）
POST   /api/bookmarks/items/batch                # {ids(≤200), action, value?, tag_names?}
                                                 #   action: status|star|unstar|move_category|add_tags|delete|restore
POST   /api/bookmarks/items/{iid}/snapshot       # 抓正文存快照（启发式抽取→Markdown）→ 条目（full）；
                                                 #   抓取失败/正文过短 → 502
DELETE /api/bookmarks/items/{iid}/snapshot       # 删除快照
GET    /api/bookmarks/items/duplicates           # 重复链接分组 [{normalized_url, items:[摘要]}]
GET    /api/bookmarks/items/queue/next           # 阅读队列下一篇（最早未读；?category_id=&tag_id=）→ 条目或 null
```

### 22.3 标签 / 元信息 / 死链 / 统计 / 导入导出

```
GET    /api/bookmarks/tags                       # [{id,name,color,item_count}]（按引用数排序）
POST   /api/bookmarks/tags                       # {name, color?}（色板轮询）；重名 409
PATCH  /api/bookmarks/tags/{tid}                 # {name?, color?}；改名冲突 409
DELETE /api/bookmarks/tags/{tid}                 # 删除并解除全部关联
GET    /api/bookmarks/meta?url=                  # 抓页面元信息（不落库）→ {url,title,description,site_name,favicon_url}；失败 502
POST   /api/bookmarks/check                      # body {ids:[]}（空=全库最久未检前 50 条）
                                                 #   → {checked, ok, dead, error}；条目记 link_status/link_code/last_checked_at
GET    /api/bookmarks/stats/overview             # {total, by_status, starred, dead, snapshots, snapshot_words, trash,
                                                 #   by_category, by_tag(top10), domains(top10), trend(30 天逐日)}
POST   /api/bookmarks/import                     # multipart file（Netscape HTML / JSON 自动嗅探）
                                                 #   → {imported, skipped, invalid, categories_created}
GET    /api/bookmarks/export?output_format=html|json   # HTML=Netscape 浏览器格式（附件下载）；JSON=全量备份（含快照）
```

**实测示例**（QA 实例）：

```bash
curl -u admin:*** -X POST /api/bookmarks/items -H 'Content-Type: application/json'   -d '{"url":"https://Example.com/A/?utm_source=x&q=1","title":"测试","tag_names":["前端"]}'
# → 201 {"data":{"normalized_url":"https://example.com/A?q=1","domain":"example.com","status":"unread",...}}

curl -u admin:*** -X POST /api/bookmarks/items -d '{"url":"https://X.COM/a"}'   # 规范化后同链
# → 409 {"message":"该书签已存在（id=01a1...）"}
```

**通用错误**：非法 status/sort/tags_op/action/format → 400（中文白名单文案）；资源不存在 → 404；同链重复/还原冲突/标签重名 → 409；网络抓取失败 → 502（FetchError 分类文案）。

## 23. 错误码与数据模型

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

## 24. 开发者工具箱（devtoolbox，/api/devtoolbox）

> 纯计算模块：无表、无后台线程。31 个前端工具中仅 4 类经后端（其余浏览器本地完成）。
> 全部端点 require_basic（统一登录会话 / Basic），DouBlog 信封，同步 def。模块细节见 `docs/modules/devtoolbox.md`。

### 24.1 能力声明

`GET /api/devtoolbox/capabilities` → `{hash_algorithms[10], hmac_algorithms[6], charsets[9], max_text_bytes, max_qrcode_chars}`（前端选项据此渲染，保持两端一致）。

### 24.2 哈希 / HMAC

`POST /api/devtoolbox/hash`，body `{text, algorithm, hmac_key?}`（text ≤1MB）→ `{algorithm, hmac, hex}`。

- algorithm 白名单：`md5 sha1 sha224 sha256 sha384 sha512 sha3_256 sha3_512 blake2b blake2s`
- 带 `hmac_key` 时走 HMAC（仅 `md5 sha1 sha224 sha256 sha384 sha512`），hex 为 UTF-8 字节摘要小写
- 错误：未知算法 400「不支持的算法 …」；HMAC+sha3 400「HMAC 不支持 …」；超限 400「输入超过 1MB 上限…」

```bash
curl -u admin:*** -X POST http://localhost:60100/api/devtoolbox/hash \
  -H 'Content-Type: application/json' \
  -d '{"text":"hello","algorithm":"md5"}'
# → {"success":true,...,"data":{"algorithm":"md5","hmac":false,"hex":"5d41402abc4b2a76b9719d911017c592"}}
```

### 23.3 字符集互转（乱码修复）

`POST /api/devtoolbox/charset/convert`，body `{text, from_charset, to_charset}` → `{from, to, result, hex, bytes}`。

- 语义：`text --encode(from)--> 中间字节(hex) --decode(to)--> result`；from=错误解码所用的字符集，to=真实字符集
- 白名单：`utf-8 gbk gb18030 big5 shift_jis euc-kr latin-1 windows-1252 utf-16`
- 错误：编码失败 400「无法用 gbk 编码该文本…换 gb18030/utf-8 试试」；解码失败 400「无法用 xx 解释字节…检查方向是否反了」

```bash
# UTF-8 内容被按 latin-1 显示成 "ä½ å¥½" 的修复：
curl -u admin:*** -X POST .../charset/convert -d '{"text":"ä½ å¥½","from_charset":"latin-1","to_charset":"utf-8"}'
# → data.result = "你好"，data.hex = "e4 bd a0 e5 a5 bd"
```

### 23.4 JSON ⇄ YAML

`POST /api/devtoolbox/yaml/convert`，body `{direction: "json2yaml"|"yaml2json", content}` → `{result, direction}`。

- json2yaml：safe_dump（allow_unicode 中文不转义、sort_keys=False 保键序、width=100）
- 解析/序列化走 libyaml 的 **CSafeLoader/CSafeDumper**（safe 语义同纯 Python 版，约 8 倍；未编译 libyaml 自动回退）
- yaml2json：C Loader → `json.dumps(indent=2, ensure_ascii=False, default=str)`（date/datetime → 字符串，空输入 → `{}`）
- 错误：JSON 失败 400「JSON 解析失败：第 N 行第 M 列…」；YAML 失败 400 含解析器定位；direction 非法 400

### 23.5 二维码生成

`POST /api/devtoolbox/qrcode`，body `{content, scale=6, border=2, ecc="m"}` → `{svg, png_data_url, version, ecc}`。

- content ≤2000 字符且非空白；ecc ∈ l(7%)/m(15%)/q(25%)/h(30%)；scale∈[1,32]、border∈[0,10] 越界钳制不报错
- `svg` 为矢量字符串（可直接内嵌），`png_data_url` 为 data:image/png;base64
- 错误：空内容 400「内容不能为空」；超长 400「内容超过 2000 字符…」；容量超限 400「内容超出二维码容量…」
