# Pwsvc 模块文档（密码服务 / Password Service）

> 更新日期：**2026-10-21**（依据 `backend/app/pwsvc/**`、`backend/tests/pwsvc/test_pwsvc.py`、`frontend/src/vault/components/PwsvcView.jsx`）。
> 上游文档：算法规范与威胁模型见 `docs/pwsvc-design.md`；接口契约总表见根目录 `api.md` 第 11 章；架构条目见 `backend.md` 10.47；全局红线见 `AGENTS.md` 第 13a 条。
> UI 无独立前端目录——视图在 `frontend/src/vault/components/PwsvcView.jsx`，由 **vault 模块**负责（见 vault 模块文档）。

---

## 1. 功能概述

为多个项目提供**自动轮换密码**与**机器校验 API**，定位是给测试环境 / 内部系统 / 演示账号等场景"密码始终在变、但随时可查可验"的统一服务（**非零知识**，UI 已明确标注）。

- **无状态时钟轮换（TOTP 思路）**：密码本体从不存储、从不落盘。`window = floor(unix_time / rotation_seconds)`（墙钟对齐），`password = derive(seed, window, policy)` 纯函数确定性推导。无调度器、无后台线程；多副本 / 重启结果完全一致。
- **三级模型**：项目 Project → 用户类型 UserType（密码策略 + 轮换周期）→ 用户 User（项目内唯一）。删项目级联删全部；删类型时若仍有关联用户返回 409。
- **每用户独立 seed**（32 字节 = 256-bit 随机，AES-256-GCM 加密落盘，主密钥 `data/pwsvc.key` 自动生成）——每个用户是一条完全独立的密码链。
- **30 秒宽限**：上一窗口的密码在进入新窗口后 `min(30, rotation)` 秒内仍校验通过，解决"59 秒复制的密码、61 秒提交"的边界问题（60s 轮换下实际有效期 60~90s）。
- **校验 API**：`POST /api/pwsvc/validate` 供第三方服务调用，走 `X-Api-Key` 自鉴权（**不挂 Basic / 会话**）；管理端点走统一登录（会话 Cookie 优先，Basic 兼容）。
- **进程内令牌桶限流**：每项目 `rate_limit` 次/分钟（默认 120，0 = 不限，上限 10000，页面可配即时生效）；超额返回 429 且**不落日志**。
- **校验日志**：每次校验（成功 / 失败 / 用户不存在）各记一行 `pwsvc_validate_logs`（项目/用户名/成败/IP/时间，**永不含密码内容**），保留 30 天（写入时顺手清理，无后台任务）。

## 2. 数据模型（四表，`app/pwsvc/models.py`）

所有表同库存储，表名符合 `模块名_表名` 规则。时间戳经 `_iso` 序列化（SQLite naive / PG timestamptz 归一为无偏移 ISO 字符串）。

### pwsvc_projects（项目）

| 列 | 类型 | 说明 |
|---|---|---|
| id | Integer PK | |
| name | String(100) UNIQUE | 项目名 |
| description | String(300) NULL | 描述 |
| api_key_hash | String(64) UNIQUE + 索引 | API Key 的 **SHA-256 hex**（明文只存内存，仅创建/重置时返回一次） |
| api_key_prefix | String(16) | 识别用前缀 = `'pws_' + 8 hex`（共 12 字符） |
| rate_limit | Integer，默认 120 | 校验限流（次/分钟，0 = 不限） |
| created_at / updated_at | DateTime | server_default=now，updated_at 随更新 |

### pwsvc_user_types（用户类型 = 密码策略）

| 列 | 类型 | 说明 |
|---|---|---|
| id | Integer PK | |
| project_id | FK pwsvc_projects.id ON DELETE CASCADE | UNIQUE(project_id, name) |
| name | String(50) | 如 管理员/普通用户 |
| length | Integer，默认 16 | 密码长度 8-64 |
| uppercase / lowercase / digits / symbols | Boolean，默认 True | 四类字符集开关（至少启用一个） |
| exclude_ambiguous | Boolean，默认 True | 排除易混淆字符 `I l 1 O 0 o` |
| rotation_seconds | Integer，默认 60 | 轮换周期 ∈ {30, 60, 120, 300, 600} |
| created_at | DateTime | |

### pwsvc_users（用户）

| 列 | 类型 | 说明 |
|---|---|---|
| id | Integer PK | |
| project_id / type_id | FK（均 CASCADE，均建索引） | UNIQUE(project_id, username) |
| username | String(100) | 项目内唯一 |
| display_name | String(100) NULL | |
| status | String(20)，默认 'enabled' | enabled / disabled（disabled 校验必 false） |
| seed_encrypted | Text NOT NULL | seed 的 **AES-256-GCM 密文（base64(nonce+ct)）**；主密钥 `data/pwsvc.key`（32 字节 hex 自动生成，gitignore） |
| last_validated_at / last_viewed_at | DateTime NULL | 最近校验成功 / 查看密码时间（仅时间，无内容） |
| created_at | DateTime | |

### pwsvc_validate_logs（校验日志）

| 列 | 类型 | 说明 |
|---|---|---|
| id | Integer PK | |
| project_id | FK CASCADE + 索引 | |
| username | String(100) | 被校验的用户名（截 100） |
| valid | Boolean | 校验结果 |
| ip | String(64) NULL | 请求来源 IP（截 64） |
| created_at | DateTime，索引 | **naive UTC**（`_utcnow`） |
| （复合索引） | `ix_pwsvc_logs_pid_created (project_id, created_at)` | 每次校验写入时的过期清理 DELETE 与日志窗口统计的过滤列组合；存量库由 ensure_migrations 补建 |

删除语义：删项目时**应用层显式**先删 users / types / logs 再删项目行；删类型有关联用户 → 409。

## 3. API 契约

响应统一信封 `{success, code, message, data}`（`app/shared/response.py`）。管理端全部挂 `Depends(require_basic)`——统一登录：**会话 Cookie 优先，其次 Basic**（`app/shared/auth.py`），失败 401 信封（带 `WWW-Authenticate: Basic`）；校验端点走 `X-Api-Key` 自鉴权，**不挂 Basic**。

### 3.1 管理端（统一登录）

| 方法/路径 | 参数 | 成功响应 data | 错误 |
|---|---|---|---|
| `POST /api/pwsvc/projects` | body `{name≤100 必填, description≤300?, rate_limit? 0-10000}` | **201**，项目字段 + `api_key` 明文（**仅此一次**） | 400 项目名必填/已存在/限流非法 |
| `GET /api/pwsvc/projects` | — | 项目数组（按 id 升序），每项含 `type_count`、`user_count`、`rate_limit`、`api_key_prefix`；**无 api_key 明文** | — |
| `PUT /api/pwsvc/projects/{pid}` | body 可选 `{name?, description?, rate_limit?}` | 更新后项目字段 | 404 项目不存在；400 名空/重名/限流非法；rate_limit 变更即清限流桶立即生效 |
| `DELETE /api/pwsvc/projects/{pid}` | — | `{id}`（级联删类型/用户/日志，清限流桶） | 404 |
| `POST /api/pwsvc/projects/{pid}/api-key` | — | 项目字段 + 新 `api_key` 明文（仅此一次；**旧 Key 立即失效**） | 404 |
| `POST /api/pwsvc/projects/{pid}/types` | body `{name≤50, length 8-64, uppercase/lowercase/digits/symbols, exclude_ambiguous, rotation_seconds ∈{30,60,120,300,600}}` | **201** 类型字段（含策略与 rotation_seconds） | 404 项目不存在；400 名必填/重名/长度越界/空字符集/rotation 非法 |
| `GET /api/pwsvc/projects/{pid}/types` | — | 类型数组（含 `user_count`） | — |
| `PUT /api/pwsvc/types/{tid}` | body 任意策略字段 + `name?`（与现值合并后整体验校验） | 更新后类型字段；**策略变更立即生效**（当前窗口即按新策略重推导，旧密码立刻失效） | 404；400 同创建 |
| `DELETE /api/pwsvc/types/{tid}` | — | `{id}` | 404；**409 仍有用户属于该类型** |
| `POST /api/pwsvc/projects/{pid}/users` | body `{username≤100, type_id(须属本项目), display_name≤100?}` | **201** 用户字段（创建时即生成加密 seed = 独立密码链） | 404 项目不存在；400 用户名必填/重名/type_id 无效 |
| `GET /api/pwsvc/projects/{pid}/users` | — | 用户数组（**不含 seed / 密码**） | — |
| `PUT /api/pwsvc/users/{uid}` | body 可选 `{display_name?, status? enabled\|disabled, reset_seed? bool}` | 更新后用户字段；`reset_seed` 换新 seed → **旧密码链全部失效** | 404；400 status 非法 |
| `DELETE /api/pwsvc/users/{uid}` | — | `{id}` | 404 |
| `GET /api/pwsvc/users/{uid}/current` | — | `{password, expires_in(本窗口剩余秒), rotation_seconds, window}`（即时推导，**从不落盘**；副作用：更新 `last_viewed_at`） | 404 |
| `GET /api/pwsvc/projects/{pid}/logs` | query `page`(≥1，默认 1)、`per_page`(钳制 10-100，默认 50) | `{items:[{id,username,valid,ip,created_at}], total, page, per_page, stats:{h1:{ok,fail}, h24:{ok,fail}, fail_top:[{username,count}×≤5(近24h失败TOP)]}}`（items 按 id 倒序） | 404 项目不存在 |

### 3.2 校验端（第三方服务，X-Api-Key 自鉴权，不挂 Basic）

```
POST /api/pwsvc/validate
Headers: X-Api-Key: pws_<40 hex>
Body:    {"username": "user001", "password": "..."}
```

处理顺序（`app/pwsvc/routes.py validate()`）：

1. `X-Api-Key` SHA-256 → 按 `api_key_hash` 唯一索引定位项目；查无 → **401**「API Key 无效」
2. 令牌桶限流检查；超额 → **429**（`RateLimitError`，信封 message「请求过于频繁，请稍后重试」，`data.error_code='RATE_LIMITED'`；**不落日志**）
3. 缺 `username` / `password` → **400**「缺少 username / password」（不落日志）
4. 用户不存在或 `status != 'enabled'` → **200** `{valid: false}`（落日志）
5. 解密 seed → `validate_password`（当前窗口 + 宽限，常数时间比较）→ **200**：
   - 命中：`{valid: true, expires_in: <剩余秒>}`（当前窗口=周期剩余；宽限=宽限剩余），并更新 `last_validated_at`
   - 未命中：`{valid: false}`
   - 每次走到第 4/5 步的校验都落一行日志

**应用层结果（密码对错）用 HTTP 200 + `valid` 字段表达**；401/400/429 才是传输层错误。

## 4. 后端实现要点（`app/pwsvc/routes.py`）

### 4.1 确定性推导 derive —— ⚠️ 算法红线

> **推导实现与常量不许改**：`derive_password` / `_mac` / `_rand_below` / `CHARSET` / `AMBIGUOUS` / `struct.pack('>II', ...)` 窗口打包格式 / 拒绝采样与洗牌次序，任何改动都会令**所有已发放密码漂移失效**。测试黄金向量锁死：`derive_password(bytes(range(32)), 12345, 全字符集·16位·排易混淆) == 'Y4x(59NK)yn,+L@{'`。改前必读 `docs/pwsvc-design.md` 并显式更新黄金向量。

算法（仅标准库 `hmac`/`hashlib`；`cryptography` 只用于 seed 落盘加密，见 4.3）：

1. 依策略启用字符类（`CHARSET` 固定四类常量；`exclude_ambiguous` 过滤 `AMBIGUOUS = set('Il1O0o')`，过滤后为空的类跳过）。
2. 字节流：`HMAC-SHA256(seed, pack('>II', window & 0xFFFFFFFF, counter))`，counter 递增取块。
3. `_rand_below(n)`：**确定性拒绝采样**——`limit = (256//n)*n`，字节 `b < limit` 才取 `b % n`，无 modulo 偏差。
4. 每个启用字符类先各取 1 个字符，再从全字符池补足 `length`，最后 **Fisher–Yates 确定性洗牌**（`j = _rand_below(i+1)`）打乱顺序。

同输入永远同输出；窗口不同 / seed 不同 → 密码不同。

> 性能注：步骤 1 的"字符类池构建"是策略开关的纯函数，结果按开关组合模块级缓存（`_policy_char_pools`）——采样/洗牌的取数次序与输出**逐字节不变**（黄金向量与确定性测试锁死）。

### 4.2 校验与 30s 宽限

`validate_password(seed, policy, rotation, presented, now)`（纯函数，便于测试注入时间）：

- 当前窗口命中（`hmac.compare_digest` 常数时间比较）→ `valid + expires_in = 周期剩余`
- 未命中且 `elapsed = now - window*rotation < grace = min(GRACE_SECONDS=30, rotation)` → 再比对**上一窗口**（仅上一窗口，上上窗口永远无效）→ `valid + expires_in = 宽限剩余`
- 边界：`rotation=30` 时 `grace=30=周期`，上一窗口密码在整个当前窗口内均有效（实际有效期两个窗口 = 60s）；`rotation≥30` 时宽限恒 ≤30s。

### 4.3 seed 加密

- 每用户 seed = `secrets.token_bytes(32)`（**256-bit**）；`encrypt_seed` = AES-256-GCM（12 字节随机 nonce），落库 `base64(nonce+ct)`。
- 主密钥 `data/pwsvc.key`：不存在时自动生成 `token_hex(32)`（64 hex 字符 = 32 字节 = AES-256）。**该文件丢失 = 所有 seed 不可解密 = 全部密码链报废**（需逐用户 reset_seed）。
- `reset_seed` 即换新 seed，旧密码链全部立即失效。
- 性能/安全边界：主密钥与 AESGCM 实例按密钥文件路径**进程内缓存**（首次读取后不再重复读盘；文件只会被创建、不会被应用原地改写，**手动换 key 需重启进程**）。缓存的只是主密钥本身（本来就要参与每次解密），**任何用户的明文 seed 依然即解即弃、不做缓存**。

### 4.4 API Key

`'pws_' + token_hex(20)`（160-bit 熵）；落库只存 SHA-256 hex（唯一索引 + 前缀 `key[:12]` 供识别）；明文仅创建 / 重置响应返回一次，列表接口永不含。重置后旧 Key 立即失效（哈希已换）。

### 4.5 进程内令牌桶限流

- 模块级 `_buckets: {project_id: [tokens, last_monotonic]}` + 全局锁；**容量 = rate_limit**（允许短时突发打满额度），按 `limit/60` 每秒匀速回填；`rate_limit=0` 直接放行。
- 超额：`raise RateLimitError()` → `main.py` AppError 处理器 → **429** 信封（`RATE_LIMITED` /「请求过于频繁，请稍后重试」）；**被 429 的请求不写校验日志**（防刷爆日志表）。
- 改 `rate_limit`（PUT 值有变化时）或删项目 → `_reset_bucket` 清桶，新额度立即生效。
- 进程内状态：**多进程部署时每进程各算各的额度**（本仓规定 uvicorn 单进程，见"已知边界"）。

### 4.6 校验日志

- `_log_validate`：写一行 + **顺手** `DELETE` 该项目 30 天前（`LOG_RETENTION_DAYS=30`，`created_at < now-30d`）的行（`(project_id, created_at)` 复合索引范围探测），与调用方改动同事务提交——无后台清理线程。全 Core 语句（无 ORM 脏跟踪/autoflush）。
- 写事务对 `OperationalError: database is locked` 做**整笔回滚 + 小步重试**（≤3 次、50ms 起退避）——SQLite 单写者下 WAL checkpoint 瞬时 convoy 偶发打满 busy_timeout(5s)，不重试会以 500 泄漏。
- 被限流（429）与缺参（400）的请求不落日志；用户不存在 / 禁用落 `{valid:false}`。
- 查询接口按 `id` 倒序分页，附近 1h/24h 成败统计与近 24h 失败 TOP5（爆破定位）。

### 4.7 校验热路径的读写事务分离（性能专项 2026-10）

`/validate` 与 `/users/{uid}/current` 的实现顺序：**读事务**（项目定位 + user/type JOIN，Core 列查询）→ 推导/解密（CPU）→ `rollback()` 结束只读快照 → **写事务**（Core UPDATE 时间戳 + INSERT 日志 + DELETE 过期 + COMMIT）。两个原因：

1. 读快照挂到写语句升级时撞 SQLite WAL **BUSY_SNAPSHOT**（busy_timeout 不重试）→ 20 并发校验必现 `database is locked` 500；
2. `rollback()` 会过期 ORM 实例——之后只碰读阶段捕获的本地标量，写一律走 Core 语句（碰过期属性会触发懒加载 SELECT + autoflush 意外升级写）。

### 4.8 存量库迁移 ensure_migrations

`app/pwsvc/models.py :: ensure_migrations(engine)`，由 `app/db.py init_db` 在建表与存量表改名**之后**逐模块调用，幂等两件事：

1. `pwsvc_projects` 表已存在但缺 `rate_limit` 列时 `ALTER TABLE pwsvc_projects ADD COLUMN rate_limit INTEGER NOT NULL DEFAULT 120`（create_all 不会修改已有表）；
2. `pwsvc_validate_logs` 缺 `ix_pwsvc_logs_pid_created (project_id, created_at)` 复合索引时 `CREATE INDEX IF NOT EXISTS`。

### 4.9 模块接入

`app/pwsvc/__init__.py` 导出 `router` + `ensure_migrations`，**无 `start_background`**（模块无后台线程）。`routes.py` 内部为两个子路由器：`validate_router`（无认证依赖）+ `admin_router`（`dependencies=[Depends(require_basic)]`），合并为 `router` 挂入 `main.py` 的 MODULES 注册表。DB 访问统一走 `run_db` 包装（scoped session）。

### 4.10 项目列表查询

`GET /projects` 只投影六个公共项目字段（id、name、description、api_key_prefix、rate_limit、created_at），类型数与用户数分别按 project_id 聚合，再 LEFT JOIN 回项目，整个列表一条 SQL。先聚合避免直接连接两张明细表造成计数相乘；无关联项目保留且计数为 0，启用和禁用用户均计数。结果仍按 id 升序，description 空值回退为空串，时间经原 `_iso` 处理。不读取 api_key_hash、用户 seed 或项目 updated_at，不调用解密或密码推导；不缓存查询结果或改变 API 字段。

`_PROJECT_LIST_QUERY` 在模块导入时构建一次，只持有表元数据、SQL 表达式及 `coalesce` 的固定 0 常量，不持有 Engine、Session、请求值、秘密或结果。每次请求仍在 `run_db` 捕获的当前 runtime 中读取 `db.session` 并执行；不同 app / 数据库共享表达式结构，各自查询自己的数据，写入后下一次 GET 重新计算计数。SQL 往返由三次减为一次，固定表达式另省去逐请求构建和 cache-key 工作；落地前隔离诊断见 `.ui-qa/optimization/pwsvc-select-poc.json`，不能据此宣称 HTTP 吞吐改善。

## 5. 前端（vault 内子视图 PwsvcView）

页面归属 **vault 模块**（结构、路由与视觉体系见 vault 模块文档）；入口：`frontend/src/vault/VaultPage.jsx` 侧栏「密码服务」分区（`section === 'pwsvc'`）→ `frontend/src/vault/components/PwsvcView.jsx`。全部请求经 `frontend/src/vault/api.js` 的 `pwsvc*` 封装（底层 `shared/client.js` apiFetch，自动带统一登录凭据）。

- **头部**：模块说明 + 琥珀色警示「本模块为服务端校验服务，非零知识加密」。
- **项目列表**：卡片网格（名称 / `api_key_prefix` / 描述 / 类型数 / 用户数）+「新建项目」弹层（名称 + 描述）。创建成功 → **ApiKeyOnce 弹层**：API Key 明文仅显示一次，附复制 Key / 复制 curl 示例，必须勾选「我已安全保存此 Key」才能关闭。
- **项目详情页**（四段）：
  1. **API 集成**：validate 端点地址 + curl 示例 + 「重置 API Key」；**校验限流**输入框（0-10000 次/分钟，保存即生效，错误前端拦截提示）。
  2. **用户类型**：策略行（名称 · N 位 · 每 Xs 轮换），编辑/删除（删除被拒 409 时 alert 后端消息）；TypeEditor 弹层：类型名、长度滑杆 8-64、轮换周期五档（30s/60s/2min/5min/10min）、四类字符集 + 排除易混淆复选。
  3. **用户表**：共享 `VirtualList` 只挂载可视 UserRow，包含用户名 / 类型、当前密码、复制、倒计时、启用 / 禁用、重置密码链与删除。全表共用一个时钟；有效期内只本地更新倒计时，**不会每秒重复请求后端**。单飞轮询在过期或用户 / 类型策略变化时才取 `/current`；隐藏页面暂停，卸载 / 隐藏取消请求。已过期或策略不一致的旧密码不显示、不提供复制；失败后显示等待，下一轮重试。「添加用户」表单不变。
  4. **校验日志**：初始折叠，点击「查询校验日志」才创建 LogsPanel 并发请求。每页 50，追加按 ID 去重，虚拟显示；重新查询 / 换项目 / 卸载取消旧请求。保留近 1h / 24h 统计、失败 TOP、≥50 次失败警示、总数和加载更多。
- **项目切换**：中止上一项目的 users / types 查询，按活动项目 ID 和组件存活标记拒绝旧结果；ProjectDetail 按项目 ID 重挂本地状态，防止慢响应串到另一项目。管理请求仍经统一客户端的取消、认证与数据库 identity 边界。
- 注意：密码行**不做打码**（与设计文档早期"复用 SecretField"的设想不同）——轮换密码明文直显 + 倒计时，是本模块的产品形态。

## 6. 测试（`backend/tests/pwsvc/`，24 个参数化用例，自包含）

conftest 提供隔离临时 SQLite + `client` / `auth_headers`（Basic admin）fixture；限流桶是进程级状态，辅助函数建项目后 `_reset_bucket` 清零防跨用例串味。

| 组 | 用例 | 覆盖 |
|---|---|---|
| 推导算法（5） | `test_golden_vector` | **黄金向量** `bytes(range(32))+window 12345 → 'Y4x(59NK)yn,+L@{'`，锁死算法防漂移 |
| | `test_derive_deterministic_and_independent` | 同输入同输出；窗口/seed 不同 → 密码不同（独立链） |
| | `test_derive_policy_classes` | 纯数字策略、排除易混淆、字符类保底 |
| | `test_validate_grace_logic` | 当前窗口命中+剩余秒、10s<30s 宽限通过（剩 20s）、31s 拒绝、错误密码拒绝、上上窗口永远无效 |
| | `test_grace_capped_by_short_rotation` | 30s 轮换宽限封顶 = 周期 |
| 项目/Key（2） | `test_project_crud_and_api_key_lifecycle` | 创建含一次性 api_key、列表不回明文、重名 400、重置后旧 Key 401、改名/删除 |
| | `test_validate_requires_api_key` | 无 Key / 伪造 Key → 401 |
| 类型/用户/端到端（6） | `test_full_flow_validate_current_password` | UI 取当前密码 → validate 通过；错误密码/不存在用户 false |
| | `test_disabled_user_and_seed_reset` | 禁用 false、启用恢复；reset_seed 旧密码全失效、新密码可验 |
| | `test_policy_change_takes_effect` | 改策略**立即**按新策略（当前窗口即变化，8 位纯数字） |
| | `test_type_delete_blocked_by_users_and_cascade` | 有用户删类型 409；删项目级联清空 |
| | `test_uniqueness_and_validation_errors` | 用户重名 400；长度 4 / rotation 45 / 空字符集 400 |
| | `test_no_plaintext_secrets_at_rest` | **零明文断言**：seed 列非密码明文（含 base64 解码检查）、api_key 只存 64 位哈希 |
| 日志/限流（7） | `test_validate_logs_written` | 成功/密码错/用户不存在各落一行、倒序、IP、h1/h24 统计、fail_top、日志不含密码 |
| | `test_logs_pagination` | per_page 分页、倒序 |
| | `test_logs_pruned_after_retention` | 40 天前旧日志在下一次写入时被清理 |
| | `test_rate_limit_returns_429` | 额度 3：`[200,200,200,429,429]`，message 含「频繁」 |
| | `test_rate_limit_429_not_logged` | 被 429 的请求不落日志 |
| | `test_rate_limit_zero_means_unlimited` | 0 = 不限，连发 30 次全 200 |
| | `test_rate_limit_validation` | -1/'abc'/10001 → 400；创建时可指定；默认 120 |
| 迁移（1） | `test_ensure_migrations_adds_logs_composite_index` | 存量库缺日志复合索引时幂等补建 |
| 项目列表投影（2） | `test_project_listing_public_projection_and_single_query` | 空库与多项目：按 id 升序、公共字段与时间语义、空描述、零关联、禁用用户计数；2 类型 / 3 用户不相乘，查询恒为一条且不读 hash / seed / updated_at，不调用解密或派生 |
| 表达式跨库复用（1） | `test_shared_project_query_uses_each_app_database_and_reads_new_counts` | 两个 app 不同 SQLite 库、相同项目 / 类型 ID 并发重复读取完整 DTO；仅写 B 后其计数更新而 A 不变，每请求一条业务 SQL；关闭 B 后 A 仍正确 |

新增列表专项位于 `test_project_listing.py`。首次投影 / 拼接优化与 Vault 合跑共 48 项通过（当时 Pwsvc 23 项、Vault 25 项，日志 `.ui-qa/optimization/vault-pwsvc-final-tests.log`）。固定表达式复用后，Pwsvc 全域 24 项通过，含新增并发跨库与写后更新回归、原推导黄金向量（日志 `.ui-qa/optimization/pwsvc-fixed-query-tests.log`）。两轮均使用隔离 SQLite；没有用 SQL 条数或局部 CPU 诊断替代 HTTP 吞吐与延迟复测。

2026-10 前端优化不改 `derive`、随机采样次序、seed 格式或轮换窗口，现有黄金向量继续适用。隔离 Chromium 创建真实项目 / 类型 / 用户，验证有效期内连续多个时钟 tick 不重复获取密码、日志展开前请求数为 0、展开后查询一次，并走查明暗截图。结果见 `docs/optimization/frontend-verification.md` 与 `.ui-qa/optimization/frontend-faults.json`。

## 7. 已知边界

1. **多进程部署时限流各算各的**：令牌桶是进程内 dict，N 个 worker = N 倍实际额度。本仓规定 uvicorn 单进程（AGENTS 全局要求 1），故当前无实际影响。
2. **非零知识是功能定位**：服务端必须能推导密码才能提供校验 API——服务器被完全攻破 = 攻击者可推导该项目全部轮换密码（固有属性，UI 与设计文档已声明）。
3. **`data/pwsvc.key` 丢失 = 全部密码链报废**：seed 不可解密，只能逐用户 reset_seed 重建（旧密码全部失效）。主密钥进程内缓存（见 4.3）：**手动替换该文件后必须重启进程**才生效。
4. **API Key 无自助找回**：只存哈希，明文仅创建/重置返回一次；遗失只能重置。
5. **日志 IP 是直连地址**：`request.client.host`，反代后若无 proxy_headers 配置记录的是代理 IP。
6. **30s 轮换时宽限覆盖整个窗口**（`min(30,30)=30`）：上一窗口密码在整个当前窗口有效，实际有效期 60s；为宽限机制的既定行为，非缺陷。
7. **限流桶 / 日志清理均为进程内、写入时机制**：无后台线程；长期零写入的项目其过期日志会留存到下一次写入才清理。
8. 密码本体永不落库 / 落日志（测试断言锁死）；但校验请求 body 中的密码明文会短暂存在于进程内存——HTTP 传输需依赖部署层 TLS（本仓单用户内网定位）。
9. 长列表仍一次获取项目 users / types 元数据，虚拟化仅限制 DOM 与活动行；重新滚入的行可以重新获取当前密码。密码只存在当前页面内存，不做 localStorage 缓存。共享时钟和隐藏暂停减少请求，不能保证在浏览器被节流或服务离线时秒级更新；旧密码到期后停止显示，等待成功取到新值。

## 公共 UI 外壳（2026-10-13）

前端由 `shared/ModuleShell.jsx` 提供统一侧栏（默认 220px，可拖动/键盘调整 180–420px，可折叠为 56px 图标窄轨；见 docs/modules/frontend.md）、多级菜单与内容画布；导航状态经 `useModuleNavigation` 注册。前端仅适配桌面浏览器，无移动端布局。页面内部的业务工具栏、表格、编辑器与弹层仍由模块管理。布局与性能契约见 `frontend.md` 的页面布局约定。
