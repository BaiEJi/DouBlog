# API Hub 模块文档（统一 API 网关，app/apihub/）

> **生成日期：2026-10-10**。来源：`backend/app/apihub/**`、`backend/tests/test_apihub_core.py`、
> `backend/tests/test_apihub_api.py`、`frontend/src/apihub/**`（以当前代码为准）。
> 接口契约的对外版本见 `api.md` 第 14 章；架构总览见 `backend.md` 10.51 节。

## 1. 功能概述

API Hub 是 DouBlog 的能力包之一（`app/apihub/`，导出 `router` + `start_background(app)` +
`probe_api`），把多个异构上游 API 聚合成**一个域名 + 一套平台令牌**的统一调用面：

- **聚合异构上游**：Upstream = 一组同源 API 的公共配置（base_url / 超时 / 重试 / 默认鉴权），
  下挂多个 API（方法 + 路径模板 + 请求/响应配置 + 探活配置）。base_url 与路径支持
  `{cred.字段}` / `{path.x}` 模板变量（如 `https://{cred.shop}.myshopify.com`）。
- **双调用模式**：
  - **invoke 统一信封** `POST /api/apihub/gw/apis/{slug}`——body 四桶 `{path, query, header, body}`，
    响应默认透传上游原文，`response_cfg.envelope=wrap` 时包成 `{code, message, data, meta}`；
  - **passthrough 透明代理** `ANY /api/apihub/gw/upstreams/{slug}/{path}`——原路径/query/body/header
    透传（存量客户端只换 base_url 与鉴权头即可迁移）。
- **sk- 平台令牌**：`sk-` + `secrets.token_urlsafe(32)`；库里只存 SHA-256（`key_hash` 唯一索引），
  **明文仅签发响应返回一次**；支持有效期 / API 白名单（`allowed_api_ids`，null=全部）/ IP 白名单 /
  计次配额。网关入口**不挂 Basic Auth**（管理端才挂）。
- **四级限流 + 配额预占-退还**：scope = `token_api | api | token | global`，逐级 AND 判定、任一
  拒绝即短路；同层多条规则取最严格。算法两种：令牌桶（rate_per_sec+burst）/ 固定窗口
  （window_s+max_count）。计次配额采用**预占-退还**（检查即 +1，网关侧彻底失败回退 -1），
  杜绝"先查后增"的并发超卖窗口（80 并发×quota 20 实测恰好 20 成功 / 60 个 429）。
- **密钥池加权轮换 + 401 自动禁用**：一个上游可挂多把 key（weight 展开、round-robin）；
  上游回 401/403 → 该 key 自动置 `status=2`（disabled_reason 记录原因）并 reload 快照、换 key 重试；
  连接类错误仅在**有备选 key 时**计失败（连续 3 次冷却 10s，唯一 key 永不自我熔断——防瞬时
  抖动引发 503 风暴）。入站请求的 `Authorization/Cookie` 等敏感头在转发前剥离（STRIP_HEADERS）。
- **七式鉴权适配（静态 provider 编译为注入引擎）**：`bearer / api_key_header / query_key /
  basic / static_cookie / path_token / template`，可数组组合；每把 key 的凭证字段经
  `{cred.字段}` 模板注入到 header/query/cookie 或 URL/路径里。
- **探活状态机**：`healthy / suspect / down / unknown`，失败阈值进 suspect、连续
  failure_threshold 次进 down，恢复需连续 success_threshold 次；down 态探活间隔×5；
  **down 拒绝真实调用（503 unhealthy）**，探活恢复后自动放行。未配 `probe.path` 时默认探
  **API 自身路径**（探 `/` 会把健康 API 误判 down——独立原型压测踩过的真缺陷）。
- **AES-256-GCM 凭证加密**：上游 auth_config 与每把 key 的 credential 均密文落库
  （`nonce(12B) + ct`，AAD=`doublog.apihub/v1`）；主密钥 `data/apihub.key` 首次自动生成
  （`os.urandom(32).hex()`）。管理端列表只回脱敏指纹（`abc***23`）。
- **错误归一化双通道**：HTTP 状态码 + `response_cfg.error_mapping` 的 body code 通道
  （`body_code_path/success_codes/body_message_path`），适配"HTTP 200 + body code 表错"的
  国内 API 风格；透传模式与信封模式共用同一判定。
- **异步调用日志**：进入限流/转发阶段的每次网关调用（含限流 429、unhealthy 与全部失败的
  503/504 拒绝路径；401/403/404 与配额 429 不落日志）入内存队列，由单写者 daemon 线程
  批量落库（2s / 100 条 flush），配额计数随批写回 `apihub_tokens`。

**网关管道**（`routes.py`）：令牌鉴权（哈希查内存快照）→ 授权（有效期/scope/IP/健康）→
多级限流（内存）→ 配额预占 → 选 key（加权轮询）→ 请求构建（模板 + 凭证注入 + 剥离入站
凭证）→ 上游转发（超时/换 key 重试）→ 响应（透传/信封 + 错误归一化）→ 异步日志。

## 2. 数据模型（apihub_\* 七表，models.py）

| 表 | 要点 |
|---|---|
| `apihub_upstreams` | 上游：name/slug（唯一）/base_url/timeout_ms（默认 30000）/max_retry（默认 2，attempts=retry+1）/`auth_config_enc`（AES-GCM 密文，明文结构 `{providers, credential_fields, transport}`）/status（1 启用 2 手动禁用 3 自动禁用）+disabled_reason |
| `apihub_keys` | 密钥池：upstream_id 级联删除；`credential_enc`（AES-GCM 密文 `{字段:值}`）/weight/status（1 启用 2 禁用）/last_used_at/last_ok_at |
| `apihub_apis` | API：upstream_id/name/slug（全局唯一）/method/path_tpl/`request_cfg`（body 类型 json·form·raw + header 模板）/`response_cfg`（envelope/charset/error_mapping）/timeout_ms（null=用上游的）/`probe`（探活配置 JSON）/health_status（unknown·healthy·suspect·down·half_open）/last_probe_at/last_latency_ms/enabled |
| `apihub_tokens` | 平台令牌：name/`key_hash`（SHA-256，唯一索引）/key_hint（`sk-ab1…wxyz` 指纹）/expires_at/allowed_api_ids（null=全部）/allowed_ips/quota_total（null=不限）/quota_used/status |
| `apihub_rules` | 限流规则：scope（token_api·api·token·global，前两者带 api_id/token_id 外键）/algorithm（token_bucket·fixed_window）/rate_per_sec·burst 或 window_s·max_count/enabled |
| `apihub_call_logs` | 调用日志：token_id/api_id/upstream_id/key_id/mode（invoke·passthrough）/method/path_digest（截断 250）/status_code/latency_ms/ok/error_type/rl_scope（哪层限流触发）/created_at（索引）。writer 线程批量写入 |
| `apihub_health_logs` | 探活日志：api_id/source（manual·scheduled）/ok/status_code/latency_ms/detail(JSON) |

运行态配置不直接查库：`state.Store` 持全量内存快照（apis/upstreams/keys/tokens/rules +
quota_used 计数），管理端任何写操作后 `reload()` 整体重建并 version+1；限流桶/健康状态机
属运行态，与快照分离。

## 3. API 契约（router 前缀 `/api/apihub`）

### 3.1 网关双入口（外部调用方，`Authorization: Bearer sk-…`，不挂 Basic Auth）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/gw/apis/{slug}` | invoke 统一信封；body `{path:{}, query:{}, header:{}, body:any}`（解析失败按空对象） |
| GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS | `/gw/upstreams/{slug}/{path}` | 透明代理（passthrough 只受 token/global 两层限流） |

- **成功**：透传模式回上游状态码 + 原文（白名单响应头 content-type/etag/cache-control 等透传），
  附加 `X-Hub-Latency-Ms`；wrap 模式回 `{code, message, data, meta}`（meta 含 upstream_status/
  latency_ms/quota_remaining）。
- **错误体**：`{code: <http status>, error: <错误码>, message}`，错误码集合：

| HTTP | error | 场景 |
|---|---|---|
| 400 | template_error | 模板变量缺失/为空（此时退还配额） |
| 401 | unauthorized | 缺少/无效/过期/停用的 sk- 令牌 |
| 403 | forbidden | 令牌无此 API 权限、客户端 IP 不在白名单 |
| 404 | not_found | API / 上游 slug 不存在 |
| 429 | rate_limited | 限流触发；响应头 `Retry-After` + `X-RateLimit-Scope/Limit/Remaining`（invoke）或 Scope（passthrough） |
| 429 | quota_exceeded | 计次配额用尽（`used/total`） |
| 503 | api_disabled / upstream_disabled / unhealthy | API 停用 / 上游禁用 / 健康状态 down（down 也写调用日志 error_type=unhealthy） |
| 503 | upstream_error | 所有尝试失败（no_available_key / conn_error / auth_401 等） |
| 504 | upstream_timeout | 上游超时（**超时不重试**：慢上游 ≠ 连接坏） |

### 3.2 管理端（全部 `Depends(require_basic)`，响应走 `api_response` 信封）

| 资源 | 端点 |
|---|---|
| 上游 | `GET/POST /admin/upstreams`、`PUT/DELETE /admin/upstreams/{uid}`（POST/PUT 均 slug 校验 `[a-zA-Z0-9_-]{1,64}`；删除前校验无 API 引用；级联删 key） |
| 密钥池 | `GET/POST /admin/upstreams/{uid}/keys`（列表回脱敏指纹）、`PUT/DELETE /admin/upstreams/keys/{kid}` |
| API | `GET/POST /admin/apis`、`PUT/DELETE /admin/apis/{aid}`（共用 `_upsert_api`，slug 校验 `[a-zA-Z0-9_-]{1,64}`） |
| 平台令牌 | `GET/POST /admin/tokens`（创建回明文 `key` 仅一次）、`PUT/DELETE /admin/tokens/{tid}`（PUT 支持 `quota_used_reset`） |
| 限流规则 | `GET/POST /admin/rules`、`PUT/DELETE /admin/rules/{rid}`（GET 附实时 `usage` 快照） |
| 探活 | `POST /probes/run`　body `{"api_ids": [id,…]}`，空 = 一键探全部；返回逐条 `{ok, status_code, latency_ms, new_status, detail}` |
| 日志 | `GET /logs?api_id=&token_id=&limit=`（默认 200，封顶 1000，id 倒序） |
| 统计 | `GET /stats/overview`（24h 窗口：总调用/成功率 + per_api 明细（调用量/错误率/均延迟/健康）+ 三类资源计数） |

所有写操作落库后 `get_state(app).reload()` 全量刷新内存快照，下一次网关调用即生效。

## 4. 后端要点

### core.py（框架无关核心，纯同步 + threading.Lock）

- `CryptoBox`：AES-256-GCM（cryptography AESGCM，密钥 = sha256(master_key)）；`mask_secret` 脱敏。
- 平台令牌：`generate_token/hash_token/token_hint`。
- `render/render_obj`：`{a.b.c}` 点路径模板，缺变量/空值抛 `TemplateError`。
- `apply_providers`：七式静态鉴权编译为 `Injection{headers, query, cookies}`；`path_token`
  无注入动作（凭证变量供 URL/路径模板用）。
- `RateLimiter`：进程内多级限流（令牌桶 `TokenBucket` + 固定窗口 `FixedWindow`），
  check 依次判定 L1..Ln 任一拒绝短路；空闲桶 600s / 每 60s 清扫一次；`snapshot` 供规则列表。
  桶键格式统一走 `level_key(scope, api_id, token_id)`（state 构建层级与 routes 用量快照共用，
  防两处漂移）。
- `KeySelector`：weight 展开表（签名缓存，>256 清空）+ round-robin 游标 + 连续失败冷却
  （threshold 3 → cooldown 10s，成功清零）。
- `HealthMonitor`：状态机（RLock 可重入），`apply_result` 推进状态、`schedule_next` 定下次
  探活时间（down ×5 间隔）。

### pool.py（上游 HTTP 连接池：标准库 http.client，零新增依赖）

- 按 `(scheme, host, port, verify)` 分目标池；**每目标并发封顶 128**（Semaphore，超额短暂
  等待，超时按 UpstreamTimeout）；空闲连接 **4.5s 过期**（低于常见服务端 keepalive 5s）、
  每目标空闲上限 256。
- **陈旧连接重试一次**：空闲连接被服务端提前关闭（RemoteDisconnected/BadStatusLine/
  ConnectionError/OSError）→ 换新连接重试一次（仅复用连接时；新连接直接抛）；
  **超时不重试**（慢上游 ≠ 连接坏）。
- 请求头重建：剥离 host/content-length/connection/transfer-encoding/accept-encoding，
  显式 `Connection: keep-alive`（不发 Accept-Encoding，上游响应按 identity 返回）；
  响应体上限 32MB（MAX_BODY）。
- 异常三分类：`UpstreamTimeout` / `UpstreamConnectError` / `UpstreamProtocolError`，
  routes 按类决定重试与冷却。复杂 transport（代理/自定义 CA/HTTP2）不支持；
  `transport.verify=false` 走全局共享的 unverified SSL context。

### state.py（app.state.apihub，每 app 一份）

- `ApiHubState` 聚合：Store（配置内存快照 + reload）+ RateLimiter + KeySelector +
  HealthMonitor + UpstreamPool + LogWriter；构造时读/建 `data/apihub.key`。
- `get_state(app)`：惰性创建并挂 `app.state.apihub`（持真实 app 对象引用，后台线程直接用）。
- `LogWriter`：队列 + 单写者 daemon 线程（2s / 100 条批量写 `apihub_call_logs`，并把内存
  quota_used 写回 token 行、刷新 last_used_at；写完显式 `db.session.remove()` 对齐请求级
  会话回收；失败 rollback 丢批不阻塞网关）。
- `probe_due_apis()`：到期需探活的 API 列表（enabled 且 interval_s>0 且过 next_due）。

### 路由与执行模型（routes.py）

- `router = APIRouter(prefix='/api/apihub')`；管理端 `_ADMIN_AUTH = [Depends(require_basic)]`，
  gw 路由不挂。
- **执行模型**：gw 两个入口是 `async def`，但整条同步管道（含阻塞的 http.client 上游调用）
  包进闭包经 `_run_gw` 提交到模块 SDK 池 **apihub-gw**（`get_pool('apihub-gw', workers=32)`）
  执行，响应对象直接返回（FastAPI 对同步 Response 正常工作）。网关常规路径（鉴权/限流/
  配额/转发/日志入队）不触数据库，**不走 run_db 的共享 doublog-db 池**（免每请求
  scoped_session 固定开销、不与其余模块抢 16 个共享 worker）；仅 401/403 禁用 key 分支触库
  （`_disable_denied_key`，分支内就地清理线程会话）。
- 探活：`probe_api(app, api_id, source)` 同步探测（构建探测请求 → 状态机 → 写 health_logs +
  回写 api 行）；手动 `POST /probes/run` 与调度线程共用 SDK 池 `get_pool('apihub-probe', workers=10)`。
- 调度线程 `start_apihub_loop(app)`（`start_background` 钩子）：daemon，每秒检查到期探活并
  submit 到 apihub-probe 池；`app.state.testing` 为真时空转（测试不跑后台）。

## 5. 前端（frontend/src/apihub/）

- **ApiHubPage.jsx**（路由 `/apihub`，门户卡片入口）：单页六内部 Tab——
  1. **总览**：24h 统计卡（调用量/错误率/上游/API/令牌）+ API 健康与调用表 + 一键探活按钮；
  2. **上游**：表格 CRUD + 密钥池弹窗（credential 脱敏展示、启停/删除、按 credential_fields
     逐字段添加，支持 `k=v` 自定义字段）；
  3. **API**：表格 CRUD + 单条探活（结果弹窗含 detail JSON）；
  4. **平台令牌**：签发弹窗（名称/过期/IP 白名单/配额），**明文 Key 仅弹窗显示一次** + 复制
     按钮 + 调用方式提示；列表操作含启停/重置用量/删除；
  5. **限流规则**：四级 scope 彩色徽章 + 算法动态表单（token_bucket↔fixed_window 切字段）+
     实时余量进度条（<20% 变红）；
  6. **调用日志**：按 API 筛选，限流触发标紫并注明层级，含 mode/状态码/延迟/错误类型。
- **JsonArea**：配置类字段（auth_config / request_cfg / response_cfg / probe）的 JSON 编辑器——
  受控文本 + 失焦 `JSON.parse` 校验，**无效标红不改值**（touched ref 防外部覆盖未保存的编辑）。
- **api.js**：全部走 `shared/client.js` 的 `apiFetch`（Basic Auth 唯一持有处）；网关调用
  （sk-）是外部调用方的事，页面内不出现。
- UI 档位对齐 `docs/ui-baseline.md`（2026-10-10）：底色 `bg-stone-50 dark:bg-[#100f0e]`、
  amber 个性色（主按钮/徽章）、表格 divide/行高 py-2.5、暗色全变体。

## 6. 测试（backend/tests/，完全自包含）

- **test_apihub_core.py（22 例）**：CryptoBox 往返/错钥/篡改/脱敏；令牌格式与哈希；模板嵌套/
  缺失/render_obj；鉴权适配（bearer/api_key_header/query+basic+cookie/template+path_token/
  validate）；限流器（突发后拒绝、多级短路（L1 拒绝时 L2 不消耗）、固定窗口、strictest 取严）；
  KeySelector（加权轮询、冷却阈值 3、成功清零、跳过禁用）；HealthMonitor 状态迁移全路径。
- **test_apihub_api.py（18 例）**：管理端（401 守门、上游 CRUD+key 脱敏不回明文、删除被 API
  引用阻止、令牌明文仅一次、规则参数校验）+ 网关端到端（bearer 注入、wrap 信封 + body code
  双通道、form body + 路径模板、401/404、api 层限流 429 头、token×API 隔离、**配额并发不超卖**
  （ThreadPoolExecutor 20 并发 80 请求 × quota 20）、上游 401 自动禁用换 key、超时 504、
  透明代理、探活与健康、down 阻断流量 503、日志与统计（sleep 2.5s 等 writer 落库））。
- mock 上游：`ThreadingHTTPServer`（module 级 fixture，随机端口）——`/echo`（回显方法/query/
  敏感头/body）、`/protected`（Bearer good-key 校验 401）、`/biz`（HTTP 200 + body code 表错）、
  `/slow`（sleep 1.2s）、`/health`。
- **test_apihub_selfreg.py（6 例）**：自注册脚本（tools/apihub_register_self.py）纯函数——
  路由枚举完整性（FastAPI 0.14x 惰性 `_IncludedRouter` 展平、排除 apihub 自身）、slug
  合法/唯一（超长路径哈希后缀防撞）、`{param}` → `{path.param}` 模板转换（含 `{slug:path}`
  转换器）、按方法分级限流参数、13 业务模块全覆盖。
- **test_apihub_openapi.py（17 例，2026-10-12）**：内部令牌旁路（X-Apihub-Token 对/错）、
  分组校验（二级需一级/字符集/'doc' 保留/组内重名/字段回读）、/openapi 转发（401/404/405/
  query+body 透传/路径变量提取/上游凭证注入/缺变量 400/一级分组）、/doc（公开+text/markdown+
  全要素）、api 级限流 429 头、ensure_migrations 幂等补列。

## 6.3 OpenAPI 发布（2026-10-12）

**服务内 API 以 OpenAPI 形式对外提供**，调用方只持 apihub 平台令牌（sk-），不接触内部凭据：

- **二级分组**：API 增加 `group1/group2/pub_name/doc_md` 四列（存量库由模块 `ensure_migrations`
  幂等 ALTER 补列）；一级为空 = 不发布；二级需先有一级（最多二级）；分组内 pub_name 唯一，
  缺省 slug；`doc` 为文档路由保留字
- **公开入口**（`routes.py openapi_router`，模块 `__init__` 与 /api/apihub 合并挂载）：
  `ANY /openapi/{g1}/{g2}/{name}`（二级可空）与 `GET .../doc`（公开）。转发透明——
  method/query/body 原样转发；**路径模板变量以同名 query 参数注入**（`?task_id=x` 填
  `{path.task_id}`，该参数不再转发，缺变量 400）；四级限流/配额/健康/密钥池与 gw invoke
  共用；日志 `mode='openapi'`
- **/doc**：`text/markdown`——元信息表（分组/上游/方法/模板/调用与文档地址）+ 认证说明 +
  路径变量表 + 限流（读 api 级规则实时值）+ curl 示例 + `doc_md` 自定义段落
- **内部服务令牌**（`app/shared/auth.py`）：`data/internal_token` 首次访问自动生成
  （32B hex）；`require_basic` 见有效 `X-Apihub-Token` 头即信任（服务到服务，不以用户身份
  执行）。泄漏该令牌 = 绕过全站认证，等同密钥文件管理（同 pwsvc.key/apihub.key 模式）
- 前端 `/apihub` API 列表新增「OpenAPI 分组」列（组名即 doc 链接，指向后端源）；编辑表单
  含分组/名称/文档补充区块与对外路径实时预览；**「状态」列行内一键启停**（`PUT /admin/apis/{id}/enabled`，
  2026-10-12）——关闭后 gw/openapi 调用立即 503「已关闭，不可用」（/doc 仍公开），关闭行半透明

## 6.5 自注册（本服务全量 API 接入网关，2026-10-12；同日升级 OpenAPI 发布）

`tools/apihub_register_self.py` 把 DouBlog 自身注册为一个上游，**全部模块 API 经网关可用**：

- **枚举**：进程内导入 FastAPI app 展平路由树（`_IncludedRouter.original_router`），取全部
  `/api/*` 端点（排除 apihub 自身防网关递归）；`{param}`（含 `:path` 转换器）转 apihub
  模板 `{path.param}`；slug = `模块-方法-路径`（超 64 字符截断 + sha1 后缀防撞）
- **注册**（经管理端 API，幂等可重跑）：上游 `doublog`（base_url=本机 60100，
  **max_retry=0**——写接口重放会重复写入）+ **内部服务令牌注入**（`X-Apihub-Token`
  api_key_header，密文落库；凭证结构变更时自动重建密钥池）+ 每端点一条 API（2026-10-12
  实测 246 个/13 模块），**全部发布为 OpenAPI：一级分组 `self`（自我服务）/ 二级分组=模块名**
- **限流**（token_bucket，四级中配三层）：每 API 读写分级（GET/HEAD 20rps·burst40，
  写方法 5rps·burst10）+ 令牌级（doublog-self 50rps·burst100）+ 全局（100rps·burst200）
- **令牌**：签发 `doublog-self`（sk- 明文仅签发时输出一次；重签 `--recreate-token`）
- **验证**：`tools/apihub_verify_self.py <sk-令牌>`（45 项检查全过，2026-10-12 实测）——
  13 模块 gw 转发与直连逐字节一致、写操作与路径参数/乐观锁、透明代理、429 触发与恢复、
  伪造/缺失令牌 401；**OpenAPI 段**：13 模块 /openapi/self/<模块>/<slug> 与直连一致、
  401/405/404/400 分支、POST+DELETE 路径变量经 query、/doc 公开且含全要素、
  X-Apihub-Token 直连后端免用户鉴权
- 前端 `/apihub` 页可查看这批注册（246 API 带 self/<模块> 分组）；探活可按需在管理页为单条 API 配置

## 7. 已知边界

1. **gw 并发受 apihub-gw 池（32 workers）约束**：上游转发（阻塞 http.client）占用 worker
   直至返回/超时（上游默认 timeout 30s）——32 个慢上游并发占满后，后续 gw 调用在池队列
   排队等待（不拒绝、不报错）。使用独立模块池正是为了不占用全站共享的 doublog-db
   （run_db）16 workers，慢上游不影响其他模块的 DB 操作。
2. **限流/配额/探活均为进程内状态**：单进程 uvicorn 部署假设；多实例需外置（限流器接口已
   抽象，独立原型报告建议 Redis 化）。
3. **固定窗口跨边界重置**是算法特性（非超卖）；令牌桶/窗口清扫仅清空闲条目。
4. **quota_used 落库有 ~2s 窗口**：内存计数 + writer 批量写回，进程重启会丢失未落库计数
   （配额可被"找回"少量额度）；重启时从库内 quota_used 重新起步。
5. **快通道限制**：不支持代理/自定义 CA/HTTP2 上游；不发 Accept-Encoding（上游不压缩）；
   响应体 >32MB 拒绝；https verify=false 为全局共享 context（影响所有走它的上游）。
6. **连接池等待也算超时**：每目标 128 并发满时等待上限 = 该请求 timeout，报 UpstreamTimeout
   （504 语义），与真实上游超时不区分。
7. **客户端 IP 取 `X-Forwarded-For` 第一段**（信任反代头），直连时取 `request.client.host`；
   IP 白名单在可伪造头场景下依赖部署层防护。
8. **主密钥 `data/apihub.key` 明文 hex 落盘**：安全性依赖文件系统权限；丢失即全部凭证不可解。
9. **日志/统计窗口**：`/logs` 封顶 1000 条、`/stats/overview` 固定 24h 窗口；调用日志约 2s
   延迟可见（异步批量落库）。
10. **passthrough 不做错误归一化**（透传上游原文），且不受 token_api/api 两层限流（无 API
    上下文）；探活不鉴权模拟仅按上游 providers 注入（用轮询到的第一把可用 key）。
11. **"有备选 key"按该上游 key 总数（含禁用）判定**：2 把 key 中 1 把已被 401 自动禁用时，
    仅剩的可用 key 连续 3 次连接错误仍会进入冷却（10s 内该上游 503）——"唯一 key 永不
    自我熔断"仅指 store 中只有 1 把 key 的情形。

## 公共 UI 外壳（2026-10-13）

前端由 `shared/ModuleShell.jsx` 提供统一 220px 侧栏、多级菜单与内容画布；导航状态经 `useModuleNavigation` 注册。前端仅适配桌面浏览器，无移动端布局。页面内部的业务工具栏、表格、编辑器与弹层仍由模块管理。布局与性能契约见 `frontend.md` 的页面布局约定。
