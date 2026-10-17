# Sdklogs 模块文档（日志接收 / 检索）

> 模块：`backend/app/sdklogs/`（models.py + routes.py）+ 前端 `frontend/src/logs/`（LogsPage.jsx + api.js）
> 契约入口：`app/sdklogs/__init__.py` 导出 `router` + `start_background(app)`；运行态挂 `app.state.sdklogs_pipeline`
> 生成日期：**2026-10-10**（依据当日代码；含 tests/sdklogs/ 23 用例 + tests/shared/ 3 例日志集成）

---

## 1. 功能概述

sdklogs 是 **lizysdk `send_json` 的服务端**：接收任意接入 lizysdk 的进程逐条/批量 POST 上来的 JSON 日志，
异步落库并提供一整套检索探索界面（前端 `/logs`）。DouBlog 自身也是客户端——WARNING+ 经
`data/logs_config.json` 配置回灌自身 `/api/v1/logs`（管理页 `PUT /api/admin/logging` 即时生效），
摄取路径自身的错误带 `no_remote` 标记防自摄回环（`main.py::_log_extra`）。

能力清单：

- **摄入**：单条 JSON 对象 / JSON 数组 / JSONL 文本三种请求体；`202` 异步落库（接收协程只做校验→规范化→入队）
- **死信兜底**：坏日志（级别/时间戳非法、缺 sys_name/message）不报 4xx，返 202 + 计数，写
  `data/dead_letters/YYYYMMDD.jsonl`（可整文件重放回 `/logs/batch`）；落库批次失败重试 2 次后同样进死信——
  **已接收的日志不丢**
- **保留清理**：每日后台线程删除超期行与超期死信文件（`LOGSDB_RETENTION_DAYS`，默认 30 天，0=永久）
- **检索全家桶**（全部过滤条件下推后端，列表/直方图/模式/导出共用同一组查询参数）：
  - 时间直方图（等宽桶 × 级别计数，过滤下推）
  - Live Tail（前端 3s 轮询第一页 + 增量高亮 + 相对窗口滑动）
  - 日志上下文（锚点行前后各 N 条，全局时间序）
  - 字段过滤（展开行 ⊕/⊖ 一键过滤/排除：sys_name/级别/trace_id/任意业务 kv）
  - 模式分组（message 模板化归并：数字/uuid/ip/路径/长 hex/引号串 → 占位符，按频次排序）
  - trace 时间线（同 trace_id 升序 + 跨度毫秒 + 相对偏移点阵）
  - 导出 CSV / JSON（流式，上限 1 万条）
  - 日志告警（阈值规则 + webhook 通知 + 事件表 + 确认）

## 2. 数据模型（`app/sdklogs/models.py`）

两张表，同库存储，表名规则 `sdklogs_` 前缀：

### `sdklogs_logs`（SdkLog，落库行）

| 列 | 类型 | 说明 |
|---|---|---|
| id | Integer PK | 自增 |
| ts | DateTime, index | 日志时间，**一律 naive UTC**（跨 SQLite/PG 比较语义一致；SDK 无时区时间戳按 `LOGSDB_INCOMING_TZ` 解释后转 UTC，RFC3339 带时区直接采用） |
| level / level_text | SmallInteger / String(10) | 数值对齐标准库 10/20/30/40/50；level_text 供展示 |
| sys_name | String(64) | 系统标识（DouBlog 自身 = `doublog.<module>`）；走组合索引 `ix_sdklogs_sys_ts` 前缀，无单列索引 |
| file / line | String(255) / Integer | 源码位置（可空；file 截 255、trace_id 截 64） |
| trace_id | String(64), index | 第一查询模式，提升物理列 + 索引，不埋 JSON |
| message | Text | 消息（多行堆栈原样保留，前端折叠展示） |
| fields | JSON | SDK 全部业务 kv（剥离固定字段后），**值统一 str**（容器转 JSON 文本，与 SDK 行为一致）；SQLite 为 TEXT、PG 为 Json |
| received_at | DateTime | 入库时间（naive UTC） |

索引：`ts`、`trace_id` 单列 + 组合 `ix_sdklogs_sys_ts(sys_name, ts)`、`ix_sdklogs_level_ts(level, ts)`。
sys_name **不建单列索引**（组合索引前缀已覆盖，单列纯付插入维护，实测删后写吞吐 +13.6%）；
存量库的旧单列索引由模块 `ensure_migrations` 幂等 `DROP INDEX`。

### `sdklogs_alerts`（SdkAlert，告警事件）

规则配置不在库里（`data/logs_alerts.json`），本表只存触发记录：created_at（index）/ level_text（规则级别）/
sys_name（空=全部）/ count（窗口命中数）/ window_minutes / sample（最近一条命中消息前 500 字）/ notified（webhook 是否已通知）/
acked（index，是否已确认）。

### 摄入侧白名单与常量（routes.py）

- **kv 检索参数名白名单 `KEY_SAFE = [A-Za-z0-9_.-]`**——`_kv_condition` 里 `set(key) <= KEY_SAFE` 校验，
  防 JSON 路径注入（`?user;id=1` → 400）
- `RESERVED_KEYS`（固定字段，不入 fields）：level/timestamp/file/line/sys_name/message/trace_id
- `QUERY_RESERVED`（检索保留字，之外的 query 参数视为 kv 过滤）：start/end/sys_name/level/level_gte/trace_id/q/limit/offset/format/buckets/top/before/after/id
- `BATCH_MAX = 1000`（单批上限，超出 400）；`EXPORT_MAX = 10000`

## 3. API 契约（全部 `/api/v1/*`，前缀 `APIRouter(prefix='/api/v1')`）

认证分两档：**摄入免 Basic**（SDK send_json 无凭据直发；配置 `LOGSDB_AUTH_TOKENS` 后校验
`Authorization: Bearer <token>`，逗号分隔多 token，空=完全开放）；**检索/统计/告警挂 `Depends(require_basic)`**
（统一登录：优先会话 Cookie，其次 Basic——前端登录一次即免再登录，curl/测试用 Basic）。

### 摄入（无 Basic；可选 Bearer）

| 端点 | 说明 |
|---|---|
| `POST /api/v1/logs` | 单条（body = 一个 JSON 对象或恰好一个元素的数组；多条 → 400）。坏日志 → `202 {accepted:0, dead_lettered:1}` |
| `POST /api/v1/logs/batch` | 批量：JSON 数组或 JSONL 文本（`Content-Type: text/plain`），单批 ≤1000 条。逐条校验，好日志入队、坏日志进死信 → `202 {accepted:n, dead_lettered:m}` |

请求体解析（`_ingest_payload`）：content-type 含 `json` 或 body 呈数组形（`[...]`）→ `json.loads`；
否则按 JSONL 处理。**JSONL 整包一次数组解析**（`'[' + ','.join(lines) + ']'`，比逐行 loads 快 ~20-30%），
失败退回逐行解析以定位坏行（ParamError 400，含行内容前 80 字）。

成功响应均为 `202 已接收`（信封 `api_response`）；非法 JSON / 空批次 / 超限为 400（ParamError），
token 错误 401（AuthError）。

### 检索 / 统计（require_basic）

| 端点 | 参数 | 说明 |
|---|---|---|
| `GET /api/v1/logs` | start/end（时间，`YYYY-MM-DD` 形式的 end 当天 23:59:59.999）、sys_name（逗号多值 OR）、level（逗号多值精确）、level_gte（≥ 某级）、trace_id、q（message LIKE 全文，autoescape 转义 `%_`）、limit(1-1000, 默认 100)、offset、**其余任意参数 = fields kv 过滤** | `{total, items:[{id, ts, level, level_text, sys_name, file, line, trace_id, message, fields, received_at}], limit, offset}`；按 ts desc, id desc。kv 过滤跨方言：SQLite `json_extract(fields,'$.key')` / PG `fields->>'key'` |
| `GET /api/v1/logs/count` | 同上过滤 | 仅 `{total}` |
| `GET /api/v1/logs/sysnames` | — | distinct sys_name + 条数，按条数倒序，限 200（查询页下拉数据源；**5s TTL 缓存**） |
| `GET /api/v1/stats` | — | 近 24h 按 sys_name（TOP10）/level 计数 + `queue_size` + `total_rows` + 管道计数器 `accepted/dropped/failed/dead_letter`（DB 聚合部分 **5s TTL 缓存**，队列/计数器实时） |
| `GET /api/v1/logs/histogram` | 同检索过滤 + buckets(10-240, 默认 60)；缺省窗口=最近 24h | 等宽时间桶 × 级别计数 `{buckets:[{start,total,counts}], bucket_secs, start, end, totals, total}`；拉 (ts,level) 上限 10 万行在 Python 聚合（避免跨方言日期分桶 SQL）；按查询串 **5s TTL 缓存** |
| `GET /api/v1/logs/context` | id（必填）、before/after(1-100, 默认 10) | 锚点行前后各 N 条全局时间序（含锚点，`anchor:true` 标记）；id 不存在 404 |
| `GET /api/v1/logs/patterns` | 同检索过滤 + top(5-50, 默认 20) | message 模板化分组：`<uuid>/<ip>/<path>/<hex>/<str>/<num>` 占位，按频次排序；分析近 2 万行 |
| `GET /api/v1/logs/export` | 同检索过滤 + format=csv\|json（默认 csv） | StreamingResponse 流式导出，上限 1 万条，`Content-Disposition: attachment; filename=logs-<时间戳>.<fmt>` |
| `GET /api/v1/logs/trace` | id（trace_id，必填） | 同 trace_id 日志升序（限 1000）+ `{span:{start,end,span_ms}}` |

### 告警（require_basic）

| 端点 | 说明 |
|---|---|
| `GET /api/v1/alerts` | `{config, events(最近 50), unacked}`；配置存 `data/logs_alerts.json` |
| `PUT /api/v1/alerts/config` | 部分更新，逐字段校验：enabled(bool)、level_gte(合法级别)、threshold(1-100000)、window_minutes/cooldown_minutes(1-1440)、webhook_url(http(s):// 开头)、sys_name(≤64) |
| `POST /api/v1/alerts/check` | 立即执行一次 `check_alerts`（后台线程同款逻辑） |
| `POST /api/v1/alerts/ack` | `{id}` 或 `{all:true}` 确认 → `{acked:n}` |

默认配置：`enabled=false, level_gte=ERROR, threshold=10, window_minutes=5, sys_name='', webhook_url='', cooldown_minutes=30`。
触发语义：窗口内 ≥threshold 条 ≥level_gte（可限定 sys_name）→ 写 SdkAlert 事件 + webhook POST（3s 超时尽力通知，
失败静默、`notified` 标志可查）；**冷却**：同级别+同系统最近一条事件（无论是否确认）在 cooldown_minutes 内不重复触发。
后台巡检线程每 60s 一次（启动延迟 10s）。

## 4. 后端要点（写入路径与并发模型）

- **每 app 一条单写者线程**（`_Pipeline`，挂 `app.state.sdklogs_pipeline`，惰性创建）：
  - 接收协程只做轻活：校验 → `normalize_record` → 入队 → 202；落库由名为 `sdklogs-writer` 的 daemon 线程批量完成
  - **禁跨 app 泄漏**：管道创建时捕获当时的 scoped_session（`self._registry = db.session`）——`db.session` 是随
    `rebuild_engine` 整体替换的全局，若落库时才解析，测试多 app 并存会把上一个 app 的存量行写进新 app 的库（跨库串写）；
    全部存活管道进 `weakref.WeakSet` 注册表，`atexit` 退出前统一排空（不延长 app 生命周期）
  - **队列满丢最旧并计数**（`dropped`），永不阻塞接收协程；`submit_list` 可整批作为一个队列元素（摊薄锁开销，等效容量大增）
  - 攒批：首元素最多等 0.2s，之后满 `logs_batch_size`（默认 500）行或自首条起 `logs_flush_ms`（默认 500ms）到期即落库
  - 落库失败重试 2 次（共 3 次，退避 0.1s×2^n），仍失败 → 每行进死信（`db_insert_failed`），`failed` 计数
  - 写者线程 scoped session 用完即 `remove()`；`flush(timeout)` 用 `q.join()` + watcher 线程实现——**测试等待落库用它**，不要 sleep
- **uvicorn 访问日志过滤**（`_QuietIngestLog`）：`POST /api/v1/logs*` 逐条访问日志被丢弃（高频摄入纯耗 I/O），其他端点保留
- 时间解析快路径：19 字符朴素格式（lizysdk 现行 `YYYY-MM-DDTHH:MM:SS`）走 `fromisoformat` − 缓存时区偏移
  （`_tz_offset`，避免每条 zoneinfo 换算；本项目时区无 DST）；带时区（`Z`/±offset）直接采用转 UTC
- **检索 Core 直取列**：`select(具体列) + 手工装 dict`，省掉 ORM 实例化与逐行 `to_dict`（百行级省毫秒）；
  count 用 ORM query 计数
- **两个后台线程**（`start_background(app)`：retention + alert loop，daemon 随进程；**`app.state.testing` 时空转直接 return**——测试直接调 `run_retention` / `check_alerts`）：
  - `sdklogs-retention`：启动延迟 5s，每 24h 一次 `run_retention`（删超期行 + 死信文件按日期名比较清理）
  - `sdklogs-alerts`：启动延迟 10s，每 60s 一次 `check_alerts`
- 配置（`app/config.py`，env 可覆盖）：`LOGSDB_INCOMING_TZ`（默认 Asia/Shanghai）、`LOGSDB_RETENTION_DAYS`（30，0=永久）、
  `LOGSDB_AUTH_TOKENS`（空=摄入开放）、`LOGSDB_BATCH_SIZE`（500）、`LOGSDB_FLUSH_MS`（500）、`LOGSDB_QUEUE_MAX`（10000）
- DouBlog 自身上报配置独立于本模块：`DOUBLOG_LOG_SEND` / `DOUBLOG_LOG_SEND_URL`（默认 `http://127.0.0.1:60100/api/v1/logs`），
  由 `shared/logging_setup.py` 装配（管理页可改，见 logs_config.json）

## 5. 前端（`frontend/src/logs/`）

- `api.js`：11 个函数全部经 `shared/client.js` 的 `apiFetch`（Basic/会话凭据唯一持有处）——
  sdklogSearch / sdklogSysnames / sdklogHistogram / sdklogContext / sdklogPatterns / sdklogTrace /
  sdklogExport（blob 下载以携带认证头）/ sdklogAlerts / sdklogAlertConfig / sdklogAlertCheck / sdklogAlertAck
- `LogsPage.jsx`（`/logs`，完整查询页，能力对齐 Datadog/Better Stack 主路径，调研见 `docs/logs-benchmark.md`）：
  - **结构**：sticky 工具栏（Live Tail / 查询集 / 导出 / 告警 / 刷新）→ 查询表单（相对时间 chips 15m/1h/6h/24h/7d +
    自绘 Dropdown（sys_name 带条数、level ≥）+ 消息全文 + 自绘 DateTimeInput 日历时分选择器 + trace_id + kv 字段名/值）→
    kv/精确级别 chips → 时间直方图（级别分色堆叠柱，点击柱缩放到该桶、拖拽框选时间范围）+ 级别统计 chips（可点选精确过滤）→
    模式分组面板（模板归并，选中后本地正则过滤当前结果）→ 结果列表（紧凑单行：时间|级别徽章|file:line|trace_id|消息，
    点击展开全字段表格）→ 无限滚动哨兵 + 加载更多
  - **交互细节**：
    - 键盘导航：`j/k` 选行（scrollIntoView）、`Enter` 展开、`/` 聚焦搜索框
    - Live Tail：3s 轮询第一页、新日志 `animate-newlog` 置顶高亮、相对窗口随墙钟滑动
    - 展开行：⊕/⊖ 一键字段过滤（核心字段映射到对应控件、业务 kv 走 kv 过滤）、⇅ 上下文、⇗ trace、复制 JSON、
      多行堆栈折叠展开
    - **保存的查询**（localStorage `doublog.log.saved`，命名/应用/删除）
    - **URL 同步**：过滤状态 b64 JSON 编码进 `?f=`，进入还原、查询后 replaceState（可分享/收藏）
    - 过滤动作以 `filtersRef` 快照直接执行（规避 setState 未 flush 的旧闭包，v2 修正）
    - 无限滚动用 scroll 事件 + getBoundingClientRect（非 IntersectionObserver——隐藏标签页不派发回调），哨兵区按钮兜底
  - 上下文模态（锚点琥珀高亮，行点击可跳 trace）/ trace 时间线模态（相对偏移点阵 + 毫秒列）/ 告警模态
    （阈值规则表单 + 最近事件 + 单条/全部确认，未确认时页首横幅 + 工具栏红点计数）
  - 时间显示：后端 naive UTC → 前端加 `Z` 解释为本地时区展示；datetime-local 输入转 UTC ISO 提交
  - 模块个性色 **sky**（trace 链接 / INFO 级别）；amber 用于实时/选中/锚点等状态语义

## 6. 测试

- **`backend/tests/sdklogs/test_sdklogs.py`（23 用例）**：
  - 摄入与规范化（6）：单条往返（级别大写化/无时区 Asia/Shanghai→UTC 换算/kv 剥离进 fields/trace_id 成列）、
    RFC3339 偏移（Z 与 +02:00 等价）、批量（数组+JSONL 等价、超 1000 条 400）、坏日志进死信（202+死信文件内容断言）、
    kv 非字符串值转 str/JSON 文本、token 鉴权三态（无 token 401 / 错 token 401 / 对 token 202）
  - 检索（5）：全部过滤维度（sys_name OR/level 精确与 ≥/trace_id/q 全文/kv/时间范围/倒序）、分页与 count、
    非法参数 400（含 `user;id=1` 注入）、stats 端点（h24 窗口用动态时间戳防时间炸弹）、摄入免 Basic + 检索仍需 Basic
  - 保留（1）：`run_retention` 直调（fresh 用动态近 1 小时时间戳；含 0=永久分支）
  - 纯函数（2）：normalize_record 边界（小写级别/strip/数字行号/非字符串 message）、sysnames 下拉数据源
  - 探索能力（6）：直方图（桶数/分桶归属/级别计数/过滤下推/非法 buckets）、上下文（锚点前后 N 条/404）、
    templatize 与模式分组、导出 CSV/JSON（头行/行数/Content-Disposition/非法 format）、trace 时间线（升序+跨度+空命中）、
    告警全流程（非法配置 400→保存→触发→冷却抑制→状态→单条/全部确认）
  - 性能优化回归（3，2026-10 专项）：检索快路径与 ORM 过滤路径**逐字段等价**（零微秒省略/非零微秒保留/fields 解析/
    单一 sys_name 快路径 vs 多值 ORM）、sysnames/stats/histogram **TTL 缓存命中分支**（二次调用可用且结果一致）、
    SQLite 写者快路径落库回读（时间精度/kv/空列无损 + 未走死信）
  - 同步要点：测试用 `pipeline.flush(timeout=5.0)` 等待落库（`_flush` helper），**不要 sleep**
- **`backend/tests/shared/test_logging_integration.py`（3 例）**：DouBlog 自身日志经 lizysdk 落盘 +
  回灌自身 `/api/v1/logs` 的集成——AppError 异常信封（ParamError 400 / AuthError 401 带 error_code）、
  WARNING 自摄回灌可检索（**uvicorn 线程伺服本 app** 实现真实 HTTP 回灌 + 本地文件落盘断言）、
  `no_remote` 防回环（摄入路径错误只落盘不外发）
- 相关：`tests/system/test_admin.py` 覆盖管理页日志上报配置（`PUT /api/admin/logging`）
- 压测工具（非 pytest）：`backend/tools/bench/sdklogs/bench.py`（性能专项：起 60250 实例 → 5200 行种子 →
  autocannon 检索/摄入两场景 → results/*.json；`SDKLOGS_FASTPATH=0/1` A/B 对照）、
  `backend/tools/sdklogs_loadtest.py`（隔离实例真实 HTTP 打点）、`sdklogs_probe.py`（写者线程诊断）

## 7. 已知边界

- **任意 kv 过滤 = `json_extract` 全表扫（O(N)）**：SQLite JSON1 无索引可下推，历史实测每行 ~6.4µs
  （50k 行库上可感知）。缓解：先缩小时间窗/系统再叠 kv 过滤
- **性能历史数字**：Flask 时代（backend.md 10.48 节）单条摄入 ~440-490 rps / 批量 ~40k 行/s。
  2026-10 性能专项（`tools/bench/sdklogs/bench.py`，fastapi 单进程 uvicorn，5200 行种子，c=20 d=10）：
  检索 `GET /logs?limit=20` 优化前 ~205 rps → 优化后 ~280-326 rps（**+35~51%**，静态 SQL 快路径）；
  摄入 `POST /logs/batch`（50 条/批）~468 → ~510-616 rps（写者线程吞吐是硬上界，见下条）
- **摄入吞吐受单写者 SQLite 管道上界约束**（设计语义，保顺序不死锁）：HTTP rps × 50 ≈ 写者行吞吐。
  专项优化（驱动级 executemany、删冗余索引、批内共享 received_at）把写者容量从 ~20.4k 提到 ~27k 行/s
  （隔离实测），但 HTTP 层受 GIL 分片与机器噪声影响，净增益 ~+5-15%。SDKLOGS_FASTPATH=0 可回退全 ORM 路径（A/B 对照）
- **检索快路径**（2026-10 性能专项）：`/logs`、`/logs/count` 的「无过滤 / 单一 sys_name」两形状走模块级
  静态 SQL（绕过 ORM 会话；实测 impl 2.47ms → 0.53ms），其余过滤组合走原 ORM 路径，输出逐字段一致（有等价性测试）
- 直方图在 Python 侧聚合（拉 ≤10 万行 (ts,level)），超大窗口下内存/延迟随之增长；单用户量级（≤10 万行窗口）设计
- `parse_ts` 依赖 `_tz_offset` 缓存——解释时区若有 DST 会取固定时刻偏移（本项目 Asia/Shanghai 无 DST，非问题）
- 队列满丢最旧是设计语义（保接收不保全量）；`dropped` 计数可在 `/api/v1/stats` 观察
- webhook 通知为尽力而为（3s 超时静默失败），可靠性以事件表 `notified` 标志为准
- `atexit` 排空是尽力而为：强杀进程时队列残留可能丢失（设计已接受；死信只兜底已解析的坏数据与落库失败批次）
- 摄入端点默认开放（无 Basic）——依赖网络边界保护；需要鉴权时设 `LOGSDB_AUTH_TOKENS`

## 公共 UI 外壳（2026-10-13）

前端由 `shared/ModuleShell.jsx` 提供统一 220px 侧栏、多级菜单与内容画布；导航状态经 `useModuleNavigation` 注册。前端仅适配桌面浏览器，无移动端布局。页面内部的业务工具栏、表格、编辑器与弹层仍由模块管理。布局与性能契约见 `frontend.md` 的页面布局约定。

同时间戳上下文结果按 ID 去重并保留锚点标记。Live Tail 在隐藏页面暂停，避免请求重叠；增量合并使用 Set。

> 2026-10-16 性能：摄入解析/写者序列化/JSON 导出换 orjson（各 2-2.7×）；JSON 导出行内分隔符更紧凑（`"k":v`，原 `"k": v`），语义不变。信封响应随全站 FastJSONResponse 提速（大响应 ~18×）。
