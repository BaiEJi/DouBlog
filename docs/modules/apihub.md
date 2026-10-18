# API Hub 模块文档（统一 API 网关，app/apihub/）

> **生成日期：2026-10-17（system→api 两维重构 + 密钥池废除版）**。来源：`backend/app/apihub/**`、
> `backend/tests/test_apihub_*.py`、`frontend/src/apihub/**`（以当前代码为准）。
> 接口契约的对外版本见 `api.md` 第 14 章；架构总览见 `backend.md` 10.51 节。

## 1. 功能概述

API Hub 是 DouBlog 的能力包之一（`app/apihub/`，导出 `router` + `start_background(app)` +
`probe_api`），把多个异构外部系统的 API 聚合成**一个域名 + 一套平台令牌**的统一调用面：

- **分类只有 system → api 两个维度（2026-10-17 重构）**：系统（system）手动创建，类比
  配置中心 confcenter 的 namespace——独立存在、下挂多个 API；API 归属系统，`path_tpl`
  相对系统 base_url 解析（即"API 映射到当前系统上的路径"）。重构前的"上游（upstream）"
  概念整体更名为系统（表/模型/路由/前端全改名）；**系统内部 API 的自注册体系**
  （`tools/apihub_register_self.py` 注册的 doublog 上游 246 条 API、`X-Apihub-Token`
  内部令牌旁路）与 **OpenAPI 发布入口**（`/openapi/**`、`group1/group2/pub_name/doc_md`
  分组列）已整体移除，存量库由 `ensure_migrations` 启动时幂等清理（见 §7）。
- **聚合异构系统**：System = 一组同源 API 的公共**连接**配置（base_url / 超时 / 重试 /
  transport），下挂多个 API（方法 + 路径模板 + 鉴权 + 请求/响应/探活配置）。base_url 与
  路径支持 `{cred.字段}` / `{path.x}` 模板变量（如 `https://{cred.shop}.myshopify.com`）。
- **鉴权内联在 API 上（2026-10-17 简化，密钥池废除）**：每个 API 的 `auth_config`
  （providers + credential_fields + credential 值）明文 JSON 随请求/响应/探活配置一起在
  API 表单编辑——单用户自用场景不做密钥池/加密/脱敏。系统只存连接参数（含 transport，
  系统表单的"跳过 TLS 校验"开关）。
- **双调用模式**：
  - **invoke 统一信封** `POST /api/apihub/gw/apis/{slug}`——body 四桶 `{path, query, header, body}`，
    响应默认透传系统侧原文，`response_cfg.envelope=wrap` 时包成 `{code, message, data, meta}`；
  - **passthrough 透明代理** `ANY /api/apihub/gw/systems/{slug}/{path}`——原路径/query/body/header
    透传，路径映射到系统 base_url（存量客户端只换 base_url 与鉴权头即可迁移）。
- **sk- 平台令牌**：`sk-` + `secrets.token_urlsafe(32)`；库里只存 SHA-256（`key_hash` 唯一索引），
  **明文仅签发响应返回一次**；支持有效期 / API 白名单（`allowed_api_ids`，null=全部）/ IP 白名单 /
  计次配额。网关入口**不挂 Basic Auth**（管理端才挂）。
- **四级限流 + 配额预占-退还**：scope = `token_api | api | token | global`，逐级 AND 判定、任一
  拒绝即短路；同层多条规则取最严格。算法两种：令牌桶（rate_per_sec+burst）/ 固定窗口
  （window_s+max_count）。计次配额采用**预占-退还**（检查即 +1，网关侧彻底失败回退 -1），
  杜绝"先查后增"的并发超卖窗口（80 并发×quota 20 实测恰好 20 成功 / 60 个 429）。
- **七式 + 动态鉴权适配（provider 编译为注入引擎）**：`bearer / api_key_header /
  query_key / basic / static_cookie / path_token / template / qq_bot`（动态令牌），
  可数组组合；凭证值经 `{cred.字段}` 模板注入到 header/query/cookie 或 URL/路径里。
  上游回 401/403 时**同一凭证不重试**，直接以 503 `upstream_error` 归一返回（无密钥池可换）；
  连接/超时类错误按系统 max_retry 重试。入站请求的 `Authorization/Cookie` 等敏感头在
  转发前剥离（STRIP_HEADERS）。
- **探活状态机**：`healthy / suspect / down / unknown`，失败阈值进 suspect、连续
  failure_threshold 次进 down，恢复需连续 success_threshold 次；down 态探活间隔×5；
  **down 拒绝真实调用（503 unhealthy）**，探活恢复后自动放行。未配 `probe.path` 时默认探
  **API 自身路径**（探 `/` 会把健康 API 误判 down——独立原型压测踩过的真缺陷）。
- ~~AES-256-GCM 凭证加密~~（2026-10-17 随密钥池废除）：CryptoBox 仅保留供
  `ensure_migrations` 解密回填旧库（见 §7），运行时不再加密任何内容。
- **错误归一化双通道**：HTTP 状态码 + `response_cfg.error_mapping` 的 body code 通道
  （`body_code_path/success_codes/body_message_path`），适配"HTTP 200 + body code 表错"的
  国内 API 风格；透传模式与信封模式共用同一判定。
- **异步调用日志**：进入限流/转发阶段的每次网关调用（含限流 429、unhealthy 与全部失败的
  503/504 拒绝路径；401/403/404 与配额 429 不落日志）入内存队列，由单写者 daemon 线程
  批量落库（2s / 100 条 flush），配额计数随批写回 `apihub_tokens`。

**网关管道**（`routes.py`）：令牌鉴权（哈希查内存快照）→ 授权（有效期/scope/IP/健康）→
多级限流（内存）→ 配额预占 → 请求构建（模板 + 凭证注入 + 剥离入站凭证）→ 系统转发
（超时/连接错误按 max_retry 重试，401/403 不重试）→ 响应（透传/信封 + 错误归一化）→
异步日志。**透明代理**无 API 上下文，鉴权取该系统第一个 API 的 auth_config。

## 2. 数据模型（apihub_* 六表，models.py）

| 表 | 要点 |
|---|---|
| `apihub_systems` | 系统（2026-10-17 前名 apihub_upstreams）：name/slug（唯一）/base_url/timeout_ms（默认 30000）/max_retry（默认 2，attempts=retry+1）/`transport`（JSON，传输参数如 verify）/status（1 启用 2 手动禁用 3 自动禁用）+disabled_reason。**只存连接参数，无鉴权**（2026-10-17 起） |
| `apihub_apis` | API：system_id/name/slug（全局唯一）/method/path_tpl（相对系统 base_url）/`auth_config`（明文 JSON：providers + credential_fields + credential 凭证值，`{cred.x}` 模板引用）/`request_cfg`（body 类型 json·form·raw + 四桶默认值 param_defaults/query_defaults/header_defaults/body.defaults）/`response_cfg`（envelope/charset/error_mapping）/timeout_ms（null=用系统的）/`probe`（探活配置 JSON）/health_status（unknown·healthy·suspect·down）/last_probe_at/last_latency_ms/enabled |
| `apihub_tokens` | 平台令牌：name/`key_hash`（SHA-256，唯一索引）/key_hint（`sk-ab1…wxyz` 指纹）/expires_at/allowed_api_ids（null=全部）/allowed_ips/quota_total（null=不限）/quota_used/status |
| `apihub_rules` | 限流规则：scope（token_api·api·token·global，前两者带 api_id/token_id 外键）/algorithm（token_bucket·fixed_window）/rate_per_sec·burst 或 window_s·max_count/enabled |
| `apihub_call_logs` | 调用日志：token_id/api_id/system_id/mode（invoke·passthrough·test）/method/path_digest（截断 250）/status_code/latency_ms/ok/error_type/rl_scope（哪层限流触发）/created_at（索引）。writer 线程批量写入 |
| `apihub_health_logs` | 探活日志：api_id/source（manual·scheduled）/ok/status_code/latency_ms/detail(JSON) |

运行态配置不直接查库：`state.Store` 持全量内存快照（apis/systems/tokens/rules +
quota_used 计数），管理端任何写操作后 `reload()` 整体重建并 version+1；限流桶/健康状态机
属运行态，与快照分离。

## 3. API 契约（router 前缀 `/api/apihub`）

### 3.1 网关双入口（外部调用方，`Authorization: Bearer sk-…`，不挂 Basic Auth）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/gw/apis/{slug}` | invoke 统一信封；body `{path:{}, query:{}, header:{}, body:any}`（解析失败按空对象） |
| GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS | `/gw/systems/{slug}/{path}` | 透明代理（passthrough 只受 token/global 两层限流） |

- **成功**：透传模式回系统侧状态码 + 原文（白名单响应头 content-type/etag/cache-control 等透传），
  附加 `X-Hub-Latency-Ms`；wrap 模式回 `{code, message, data, meta}`（meta 含 upstream_status/
  latency_ms/quota_remaining）。
- **错误体**：`{code: <http status>, error: <错误码>, message}`，错误码集合：

| HTTP | error | 场景 |
|---|---|---|
| 400 | template_error | 模板变量缺失/为空（此时退还配额） |
| 401 | unauthorized | 缺少/无效/过期/停用的 sk- 令牌 |
| 403 | forbidden | 令牌无此 API 权限、客户端 IP 不在白名单 |
| 404 | not_found | API / 系统 slug 不存在 |
| 429 | rate_limited | 限流触发；响应头 `Retry-After` + `X-RateLimit-Scope/Limit/Remaining`（invoke）或 Scope（passthrough） |
| 429 | quota_exceeded | 计次配额用尽（`used/total`） |
| 503 | api_disabled / system_disabled / unhealthy | API 停用 / 系统禁用 / 健康状态 down（down 也写调用日志 error_type=unhealthy） |
| 503 | upstream_error | 所有尝试失败（conn_error / auth_401 / auth_403 等；401/403 同一凭证不重试） |
| 504 | upstream_timeout | 系统转发超时（慢系统 ≠ 连接坏） |

### 3.2 管理端（全部 `Depends(require_basic)`，响应走 `api_response` 信封）

| 资源 | 端点 |
|---|---|
| 系统 | `GET/POST /admin/systems`、`PUT/DELETE /admin/systems/{sid}`（POST/PUT 均 slug 校验 `[a-zA-Z0-9_-]{1,64}`；删除前校验无 API 引用；响应带 `api_count`） |
| API | `GET/POST /admin/apis`（GET 支持可选 `?system_id=` 只取该系统 API）、`PUT/DELETE /admin/apis/{aid}`（共用 `_upsert_api`，slug 校验 `[a-zA-Z0-9_-]{1,64}`；`system_id` 必须存在；`auth_config` 非空时校验 providers，明文存取） |
| 平台令牌 | `GET/POST /admin/tokens`（创建回明文 `key` 仅一次）、`PUT/DELETE /admin/tokens/{tid}`（PUT 支持 `quota_used_reset`） |
| 限流规则 | `GET/POST /admin/rules`、`PUT/DELETE /admin/rules/{rid}`（GET 附实时 `usage` 快照） |
| 调用文档 | `GET /admin/apis/{aid}/doc`（text/markdown：元信息/认证/四桶默认值参数表/统一信封与透明代理的可复制调用示例，默认值全部代入） |
| 探活 | `POST /probes/run`　body `{"api_ids": [id,…]}`，空 = 一键探全部；返回逐条 `{ok, status_code, latency_ms, new_status, detail}` |
| 日志 | `GET /logs?api_id=&token_id=&limit=`（默认 200，封顶 1000，id 倒序） |
| 统计 | `GET /stats/overview`（24h 窗口：总调用/成功率 + per_api 明细（调用量/错误率/均延迟/健康）+ 三类资源计数 apis/systems/tokens） |

所有写操作落库后 `get_state(app).reload()` 全量刷新内存快照，下一次网关调用即生效。

## 4. 后端要点

### core.py（框架无关核心，纯同步 + threading.Lock）

- `CryptoBox`：AES-256-GCM（cryptography AESGCM，密钥 = sha256(master_key)）——
  2026-10-17 起仅供迁移回填解密旧库；`load_crypto()` 读 data/apihub.key。
- 平台令牌：`generate_token/hash_token/token_hint`。
- `render/render_obj`：`{a.b.c}` 点路径模板，缺变量/空值抛 `TemplateError`。
- `apply_providers`：七式静态鉴权编译为 `Injection{headers, query, cookies}`；`path_token`
  无注入动作（凭证变量供 URL/路径模板用）。**`qq_bot`**：动态令牌 provider，
  经 `token_fetch(provider, cred)` 回调取 `Authorization: QQBot <token>`（网关/探活绑定
  `state.token_exchange`，纯函数调用不绑定时抛 TemplateError）。
- `TokenExchanger`：QQ access_token 交换（POST token_url JSON {appId, clientSecret}），按
  (token_url, app_id) 进程内缓存、`expires_in - 300s` 自动刷新；请求走共享连接池（含出站代理）；
  非 200/无 token 抛 ValueError（routes 归入 upstream_error）。
- `RateLimiter`：进程内多级限流（令牌桶 `TokenBucket` + 固定窗口 `FixedWindow`），
  check 依次判定 L1..Ln 任一拒绝短路；空闲桶 600s / 每 60s 清扫一次；`snapshot` 供规则列表。
  桶键格式统一走 `level_key(scope, api_id, token_id)`（state 构建层级与 routes 用量快照共用，
  防两处漂移）。
- `HealthMonitor`：状态机（RLock 可重入），`apply_result` 推进状态、`schedule_next` 定下次
  探活时间（down ×5 间隔）。
- ~~`KeySelector`~~（2026-10-17 随密钥池删除）。

### pool.py（系统 HTTP 连接池：标准库 http.client，零新增依赖）

- 按 `(scheme, host, port, verify, proxy)` 分目标池；**出站代理（全局可选）**：
  `app/apihub/proxy.py`（data/apihub_proxy.json，/config 页读写），仅 https 目标且非 localhost
  走正向代理 CONNECT 隧道（`HTTPSConnection.set_tunnel`），配置变更即生效（池键含代理，旧空闲
  连接 4.5s 自然淘汰；PUT 时主动 close_all）；**每目标并发封顶 128**（Semaphore，超额短暂
  等待，超时按 UpstreamTimeout）；空闲连接 **4.5s 过期**（低于常见服务端 keepalive 5s）、
  每目标空闲上限 256。
- **陈旧连接重试一次**：空闲连接被服务端提前关闭（RemoteDisconnected/BadStatusLine/
  ConnectionError/OSError）→ 换新连接重试一次（仅复用连接时；新连接直接抛）；
  **超时不重试**（慢系统 ≠ 连接坏）。
- 请求头重建：剥离 host/content-length/connection/transfer-encoding/accept-encoding，
  显式 `Connection: keep-alive`（不发 Accept-Encoding，系统响应按 identity 返回）；
  响应体上限 32MB（MAX_BODY）。
- 异常三分类：`UpstreamTimeout` / `UpstreamConnectError` / `UpstreamProtocolError`，
  routes 按类决定重试与冷却。自定义 CA/HTTP2 不支持；
  `transport.verify=false` 走全局共享的 unverified SSL context。

### state.py（app.state.apihub，每 app 一份）

- `ApiHubState` 聚合：Store（配置内存快照 + reload）+ RateLimiter + HealthMonitor +
  UpstreamPool + TokenExchanger + LogWriter（不再持 CryptoBox/KeySelector）。
- `get_state(app)`：惰性创建并挂 `app.state.apihub`（持真实 app 对象引用，后台线程直接用）。
- `LogWriter`：队列 + 单写者 daemon 线程（2s / 100 条批量写 `apihub_call_logs`，并把内存
  quota_used 写回 token 行、刷新 last_used_at；写完显式 `db.session.remove()` 对齐请求级
  会话回收；失败 rollback 丢批不阻塞网关）。
- `probe_due_apis()`：到期需探活的 API 列表（enabled 且 interval_s>0 且过 next_due）。

### 路由与执行模型（routes.py）

- `router = APIRouter(prefix='/api/apihub')`；管理端 `_ADMIN_AUTH = [Depends(require_basic)]`，
  gw 路由不挂。
- **执行模型**：gw 两个入口是 `async def`，但整条同步管道（含阻塞的 http.client 系统调用）
  包进闭包经 `_run_gw` 提交到模块 SDK 池 **apihub-gw**（`get_pool('apihub-gw', workers=32)`）
  执行，响应对象直接返回（FastAPI 对同步 Response 正常工作）。网关常规路径（鉴权/限流/
  配额/转发/日志入队）不触数据库，**不走 run_db 的共享 doublog-db 池**（免每请求
  scoped_session 固定开销、不与其余模块抢 16 个共享 worker）。
- 探活：`probe_api(app, api_id, source)` 同步探测（构建探测请求 → 状态机 → 写 health_logs +
  回写 api 行）；手动 `POST /probes/run` 与调度线程共用 SDK 池 `get_pool('apihub-probe', workers=10)`。
- 调度线程 `start_apihub_loop(app)`（`start_background` 钩子）：daemon，每秒检查到期探活并
  submit 到 apihub-probe 池；`app.state.testing` 为真时空转（测试不跑后台）。

## 5. 前端（frontend/src/apihub/）

- **ApiHubPage.jsx**（路由 `/apihub`，门户卡片入口）：单页五内部 Tab（**API 不占侧栏一级入口**，
  参照配置中心 confcenter 的 namespace 模式收敛进「系统」页）——
  1. **总览**：24h 统计卡（调用量/错误率/系统/API/令牌）+ API 健康与调用表 + 一键探活按钮；
  2. **系统**：系统表格（名称/Slug、Base URL、API 数量、状态、操作；平铺 colgroup +
     table-fixed，操作列实底小钮右对齐）+ CRUD（表单只含连接参数：名称/Slug/Base URL/超时/
     重试/状态/跳过 TLS 校验）；**点系统名称/数量/「进入」即进入该系统详情**（选中系统经 URL
     `?system=<slug>` 深链，刷新/分享不丢；slug 失效回落列表）；**系统详情页** = 系统信息卡
     （名称/slug/状态/Base URL/超时重试/API 数 + 透明代理入口前缀 `/gw/systems/{slug}/{path}`）+
     编辑系统 + **该系统自己的 API 表格**（搜索 + CRUD + 单条探活（结果弹窗含 detail JSON）+
     行内启停；行操作「调用」「文档」「探活」「编辑」「删除」实底钮——**调用弹窗参数齐全**
     （路径变量/query/header/body 四桶输入框，已配置默认值的参数自动预填、清空回落后端默认、
     可追加自定义键），**文档弹窗**渲染后端 Markdown 调用文档（shared/md.js + prose-content））；
     **API 表单**（xwide 弹窗）= 名称/Slug/所属系统（只读）+ Method/路径模板 + 四个 JSON 配置块
     （请求/响应/探活/**鉴权**，标签+提示固定行高顶对齐）——**鉴权配置即 providers + credential
     凭证值内联的明文 JSON**（无密钥池/加密/脱敏）；API 行内路径尾带鉴权类型徽章；
     **不同系统展示不同的 API 内容**；
  3. **平台令牌**：签发弹窗（名称/过期/IP 白名单/配额），**明文 Key 仅弹窗显示一次** + 复制
     按钮 + 调用方式提示；列表操作含启停/重置用量/删除；
  4. **限流规则**：四级 scope 彩色徽章 + 算法动态表单（token_bucket↔fixed_window 切字段）+
     实时余量进度条（<20% 变红）；
  5. **调用日志**：按 API 筛选，限流触发标紫并注明层级，含 mode/状态码/延迟/错误类型。
- **JsonArea**：配置类字段（auth_config / request_cfg / response_cfg / probe）的 JSON 编辑器——
  受控文本 + 失焦 `JSON.parse` 校验，**无效标红不改值**（touched ref 防外部覆盖未保存的编辑）。
- **api.js**：全部走 `shared/client.js` 的 `apiFetch`（Basic Auth 唯一持有处）；网关调用
  （sk-）是外部调用方的事，页面内不出现。
- UI 档位对齐 `docs/ui-baseline.md`：底色 `bg-stone-50 dark:bg-[#100f0e]`、
  amber 个性色（主按钮/徽章）、表格 divide/行高 py-2.5、暗色全变体。

## 6. 测试（backend/tests/，完全自包含）

- **test_apihub_core.py（17 例）**：CryptoBox 往返/错钥/篡改（仅迁移用）；令牌格式与哈希；
  模板嵌套/缺失/render_obj；鉴权适配（bearer/api_key_header/query+basic+cookie/template+
  path_token/validate）；限流器（突发后拒绝、多级短路（L1 拒绝时 L2 不消耗）、固定窗口、
  strictest 取严）；HealthMonitor 状态迁移全路径。
- **test_apihub_api.py（23 例）**：管理端（401 守门、系统 CRUD、**API 级 auth_config 校验 +
  明文回读**、删除被 API 引用阻止、**系统维度 API 过滤 + api_count**、令牌明文仅一次、规则
  参数校验）+ 网关端到端（bearer 注入、wrap 信封 + body code 双通道、form body + 路径模板、
  401/404、api 层限流 429 头、token×API 隔离、**配额并发不超卖**、**四桶默认值**
  （path/query/header/body 未传补齐/显式优先，gw 与调试调用同语义）、**调用文档 Markdown**
  （参数表/示例默认值代入/401/404）（ThreadPoolExecutor 20 并发 80 请求 × quota 20）、
  **上游 401 归一 503（不重试）**、超时 504、透明代理（取系统第一个 API 的鉴权）、
  探活与健康、down 阻断流量 503、日志与统计（sleep 2.5s 等 writer 落库））。
- mock 系统：`ThreadingHTTPServer`（module 级 fixture，随机端口）——`/echo`（回显方法/query/
  敏感头/body）、`/protected`（Bearer good-key 校验 401）、`/biz`（HTTP 200 + body code 表错）、
  `/slow`（sleep 1.2s）、`/health`。
- **test_apihub_qq.py（12 例，2026-10-17）**：QQ 接入三件套——qq_bot provider 端到端
  （mock token 端点 + C2C 发送端点：QQBot 头注入/默认值填充）、token 缓存与过期重交换、
  调用方显式值覆盖、错误凭证 5xx、缺路径变量 400、apply_providers 未绑 fetch 抛错、
  代理 resolve 规则（https-only/localhost/开关）+ admin 接口校验 +
  池代理建连路径（端口 1 拒连/超时证明走代理）+ 管理端直发调用。
- **admin invoke（2026-10-17）**：`POST /admin/apis/{id}/invoke` 页面调试调用——与 gw invoke
  同一套默认值/转发构件，但不走平台令牌/限流/配额，响应为 api_response 信封包系统侧原文
  （status_code/latency_ms/ok/body），日志 mode='test'；前端 API 表格行「调用」按钮弹窗
  （路径变量预填 param_defaults、body 预填 body.defaults、query 可选；结果面板显示状态/延迟/响应体）。
- **test_apihub_migration.py（9 例，2026-10-17）**：upstream → system 重构 + 密钥池废除
  迁移——自建旧版 schema（含真实加密的系统鉴权与 key 凭证，夹具预置 apihub.key）后跑迁移，
  断言表/列改名、OpenAPI 四列删除、自注册遗留数据（doublog 系统/doublog-self 令牌及其
  API/密钥/规则/日志）清理、正常数据原样保留、**auth_config 回填（providers + 第一把启用
  key 凭证解密合并）+ keys 表/ auth_config_enc/key_id 列删除**、幂等、新库零动作、
  X-Apihub-Token 旁路失效（伪造头 401）、/openapi 路由 404。

## 7. upstream → system 迁移（2026-10-17，`__init__.ensure_migrations` + `db.LEGACY_TABLE_MAP`）

- **表改名** `apihub_upstreams` → `apihub_systems`：走 `db.py` 的 LEGACY_TABLE_MAP（在
  create_all **之前**执行，防先建空新表导致 RENAME 被跳过）；ensure_migrations 内有兜底改名。
- **列改名**：`apihub_keys.upstream_id` / `apihub_apis.upstream_id` / `apihub_call_logs.upstream_id`
  → `system_id`（SQLite ≥3.25 / PG 均支持 RENAME COLUMN）。
- **一次性清理自注册数据**（判定条件 = 旧列 `group1` 仍存在于 apihub_apis，即老库首次迁移）：
  删除系统 `doublog`（自注册脚本 `apihub_register_self.py` 的产物）及其下全部 API / 密钥 /
  探活日志 / 调用日志 / api 级限流规则，删除令牌 `doublog-self` 及其 token 级规则。此后
  DROP OpenAPI 发布四列（旧 SQLite <3.35 不支持 DROP COLUMN 时仅告警，残留列不影响功能）。
- 全新库（无旧表旧列）零动作；手动创建的普通系统/令牌不受清理影响（test_apihub_migration 覆盖）。

## 7b. 密钥池 → API 内联鉴权迁移（2026-10-17，`__init__.ensure_migrations` 第 4 步）

判定条件 = `apihub_systems.auth_config_enc` 列仍存在（待迁移的老库）：

1. **补列**：`apihub_systems.transport`（create_all 不给存量表加列）、`apihub_apis.auth_config`；
2. **回填**：`load_crypto()`（读 data/apihub.key）解密每个系统的旧 auth_config 与第一把
   **启用** key 的 credential，合并为 `{providers, credential_fields, credential}` 明文 JSON
   写入该系统每个 `auth_config IS NULL` 的 API；旧 auth_config 里的 `transport` 回种到系统级
   `transport` 列；无 key 的系统凭证留空（用户在 API 表单补填）；单行解密失败不阻断其余；
3. **清理**：`DROP TABLE apihub_keys`、`ALTER TABLE apihub_systems DROP COLUMN auth_config_enc`、
   `ALTER TABLE apihub_call_logs DROP COLUMN key_id`（旧 SQLite <3.35 不支持 DROP COLUMN 时
   仅告警，残留列不影响功能）。
- 迁移后 `CryptoBox` 无运行时调用方（仅供再次迁移时解密）；`data/apihub.key` 可留可删。

## 8. 已知边界

1. **gw 并发受 apihub-gw 池（32 workers）约束**：系统转发（阻塞 http.client）占用 worker
   直至返回/超时（系统默认 timeout 30s）——32 个慢系统并发占满后，后续 gw 调用在池队列
   排队等待（不拒绝、不报错）。使用独立模块池正是为了不占用全站共享的 doublog-db
   （run_db）16 workers，慢系统不影响其他模块的 DB 操作。
2. **限流/配额/探活均为进程内状态**：单进程 uvicorn 部署假设；多实例需外置（限流器接口已
   抽象，独立原型报告建议 Redis 化）。
3. **固定窗口跨边界重置**是算法特性（非超卖）；令牌桶/窗口清扫仅清空闲条目。
4. **quota_used 落库有 ~2s 窗口**：内存计数 + writer 批量写回，进程重启会丢失未落库计数
   （配额可被"找回"少量额度）；重启时从库内 quota_used 重新起步。
5. **快通道限制**：不支持自定义 CA/HTTP2 系统；不发 Accept-Encoding（系统侧不压缩）；
   响应体 >32MB 拒绝；https verify=false 为全局共享 context（影响所有走它的系统）。
6. **连接池等待也算超时**：每目标 128 并发满时等待上限 = 该请求 timeout，报 UpstreamTimeout
   （504 语义），与真实系统超时不区分。
7. **客户端 IP 取 `X-Forwarded-For` 第一段**（信任反代头），直连时取 `request.client.host`；
   IP 白名单在可伪造头场景下依赖部署层防护。
9. **日志/统计窗口**：`/logs` 封顶 1000 条、`/stats/overview` 固定 24h 窗口；调用日志约 2s
   延迟可见（异步批量落库）。
10. **passthrough 不做错误归一化**（透传系统侧原文），且不受 token_api/api 两层限流（无 API
    上下文）；其鉴权取**该系统第一个 API**（按 id）的 auth_config——系统无 API 时以空凭证转发。
11. **auth_config 明文存储**：单用户自用场景的有意简化（无加密/脱敏）；库文件即含全部上游
    凭证，安全性依赖库文件权限；多把账号轮换/自动禁用场景需自行重建（当前设计不再支持）。

## 公共 UI 外壳（2026-10-13）

前端由 `shared/ModuleShell.jsx` 提供统一 220px 侧栏、多级菜单与内容画布；导航状态经 `useModuleNavigation` 注册。前端仅适配桌面浏览器，无移动端布局。页面内部的业务工具栏、表格、编辑器与弹层仍由模块管理。布局与性能契约见 `frontend.md` 的页面布局约定。
