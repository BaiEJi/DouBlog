# 配置中心（confcenter）模块规范

> 2026-10-17。模块名 `confcenter`（配置中心）；表 `confcenter_namespaces` / `confcenter_entries`；前缀 `/api/confcenter`；前端 `/confcenter`（门户卡"配置中心"）。

## 1. 数据模型（app/confcenter/models.py）

namespace 是独立实体；空间内仍为扁平 KV：

```python
class ConfNamespace(Base):
    __tablename__ = 'confcenter_namespaces'
    namespace: str  # PrimaryKey（1–100）
    created_at: DateTime

class ConfEntry(Base):
    __tablename__ = 'confcenter_entries'
    namespace: str  # CompositePK 左（≤100）
    key: str        # CompositePK 右（≤200）
    type: str       # 'str' | 'json'
    data: Text      # type=str → 原样字符串；type=json → 合法 JSON 文本（对象/数组/数字均可）
    updated_at: DateTime
    # 索引：namespace 单列（按 ns 浏览）
```

- create_all 建表后，模块 `ensure_migrations(engine)` 从已有 KV 幂等登记 namespace；不改动原值，空空间可独立存在且重启不消失。
- **namespace + key 唯一定位一个 value**；value = {type, data} 包装
- 显式 type 的理由：裸存时 "123"/"[1,2]" 会被误判 JSON，读时无法还原"本来就是字符串"——显式声明消除歧义

## 2. 读写约定（硬性语义）

- 读：str → 客户端拿到字符串；json → 拿到结构化数据（响应里 data 为解析后的对象）
- 写（PUT 同一 ns+key 即**整体覆盖**，type 允许变更）；type=json 且 data 非法 JSON → 400 拒绝
- 删除：DELETE /{namespace}/{key}；删除最后一项后空间仍保留。
- 页面先创建空间，再选中该空间管理 KV；旧客户端直接 PUT 到新 namespace 时，创建 KV 的事务同时登记 namespace。

## 3. API 契约（全部 require_basic，Doublog 信封）

```
GET    /api/confcenter/namespaces                 # 含空空间的 namespace 列表 + 每个 ns 的条目数
POST   /api/confcenter/namespaces                 # JSON {namespace}；201 新建 / 409 重名 / 400 非法名称
GET    /api/confcenter/entries?namespace=&q=&page=&page_size=&sort_by=&sort_order=   # 浏览（q 模糊匹配 key；省略 namespace=全部；可选排序见下）
GET    /api/confcenter/{namespace}/{key}          # 读单条：data 按解析后返回（str→字符串，json→结构）
PUT    /api/confcenter/{namespace}/{key}          # upsert {type:'str'|'json', data}（201 新建 / 200 覆盖；json 非法 400）
DELETE /api/confcenter/{namespace}/{key}          # 200；不存在 404
# ↑ GET/PUT/DELETE 三条单条路由受 namespace 限流约束（超限 429）
PUT    /api/confcenter/rename                  # {namespace, old_key, new_key} 同空间重命名：单事务拷贝行（保留 type/data/updated_at）→ 删旧行；缓存双失效；计入限流；旧 404 / 新 409 / 同名 200 no-op
# Redis 缓存管理（系统配置页用）
GET    /api/confcenter/cache/status               # {enabled, configured, reachable, library_available, url_masked, ttl_seconds, hits, misses}（enabled=已启用且探活可达；不可达时不报错）
GET    /api/confcenter/cache/config               # 当前配置回显（配置 Modal 用；单用户管理端原样返回）
PUT    /api/confcenter/cache/config               # {enabled, host, port, db, password, ttl_seconds}，允许部分缺省沿用（密码留空=沿用已存）；写入 data/redis_config.json
POST   /api/confcenter/cache/test                 # 用请求体候选配置（缺省=当前配置）测试连通（PING），返回 {ok, message}
POST   /api/confcenter/cache/flush                # 按 confcenter:* 前缀 SCAN+DEL（不整库 FLUSHDB，不误伤同 db 其他业务键），管理用
# namespace 限流管理（ratelimit.py）
GET    /api/confcenter/ratelimit/status            # {enabled, mode: off|local|redis, limit, window_seconds, overrides, allowed, rejected, tracked, redis}
GET    /api/confcenter/ratelimit/config            # 当前限流配置回显
PUT    /api/confcenter/ratelimit/config            # {enabled, limit, window_seconds, overrides}（部分缺省沿用；overrides 整体替换）→ data/ratelimit_config.json
POST   /api/confcenter/ratelimit/reset             # {namespace} → 清零该空间限流窗口（本地 + Redis）
```

key 命名约束：`[A-Za-z0-9_.:-]`（防注入）；namespace 同样。PUT body 校验：type 只能 str/json；type=json 时 data 必须可 json.loads。

**entries 排序**（2026-10-24 新增，向后兼容）：可选 `sort_by`（`key`（默认）|`type`|`data`|`updated_at`，值预览列映射存储文本 data）+ `sort_order`（`asc`（默认）|`desc`）。未传两个参数保留旧 `namespace ASC, key ASC` 顺序与响应结构；只传 sort_order 时 sort_by=key，只传 sort_by 时 asc。排序在 SQL 端、offset/limit 之前应用（覆盖过滤后完整结果集，不是当前页）；相同主排序值以 `namespace ASC, key ASC` 稳定兜底（分页间无重漏）；updated_at 双方向 NULLS LAST；文本按存储文本字典序区分大小写（SQLite BINARY / PostgreSQL COLLATE "C"），JSON 按库中 data 原文比较。白名单外的字段/方向、显式空值 → 400（参数映射固定 SQLAlchemy 列对象，永不拼 SQL）。浏览排序不计入 namespace 限流。

## 4. Redis 缓存层（核心设计：可选、可降级）

- 配置存 `data/redis_config.json`：`{enabled, host, port, db, password, ttl_seconds}`（默认 enabled=false）
- **读路径**：GET 单条 → 配置启用且连接可用 → 先查 Redis（键 `confcenter:{namespace}:{key}`，值为整个 {type,data,updated_at} JSON）→ 命中直接返回并 hits+1 → 未命中介 DB、回填 Redis（misses+1）
- **写/删路径**：先落库 → **DEL 对应 Redis 键**（下次读重建；不做双写，避免一致性窗口）
- **降级**：redis 库缺失 / 配置未启用 / 连接失败 → 静默直连 DB（连接异常只 warn 一次/进程，不刷日志、不抛错）；hits/misses 计数仅在缓存生效时累计
- 客户端惰性连接：首次用到才建 Redis 客户端；配置变更后重建；TTL 默认 3600（键带 TTL，防止漏删的陈旧）
- 缓存状态挂 `app.state.confcenter_cache`（连接客户端 + 计数器 + 配置快照；测试多 app 不泄漏）

## 4z. namespace 限流层（核心设计：优先 lizysdk / Redis，可降级本地）

- 配置存 `data/ratelimit_config.json`：`{enabled, limit=100, window_seconds=60, overrides}`（默认 enabled=false）；overrides 按 namespace 覆盖 `{limit, window_seconds}`（limit=0=豁免该空间）
- **生效范围**：单条 KV 路由 GET/PUT/DELETE `/{namespace}/{key}`，按 namespace 计数；浏览（/namespaces /entries）与管理端点不限流
- **Redis 优先**：redis 库可用且缓存配置（与缓存层共用 `data/redis_config.json` 连接）已启用且可达 → `lizysdk.dist.SlidingWindowCounter`（ZSET+Lua 原子滑动窗口）；键前缀 `confcenter_rl`（下划线避免被缓存 flush 的 `confcenter:*` SCAN 误伤）
- **本地降级**：库缺失/未启用/连接失败/EVAL 抛错 → 进程内滑动窗口（deque+锁）；Redis 调用失败本次即时降级不阻断请求；status 探活成功自愈
- **语义**：Redis 路径 allow()=先计数再判定（被拒也占名额，原子惩罚语义）；本地路径=判定后计数（被拒不追加，deque 有界）——lizysdk 文档明确两种取舍
- 超限 → 429 RATE_LIMITED，details={namespace, limit, window_seconds, retry_after, mode}；判定在 run_db 池内执行（阻塞套接字 IO 不占事件循环）；运行态挂 `app.state.confcenter_ratelimit`

## 5. 前端（frontend/src/confcenter/）

公共侧栏两个同级视图（PageHeader tabs 注册，2026-10-24）：**配置管理**（entries，默认）与**限流配置**（`?view=ratelimit&namespace=…` 可深链/刷新，缺省/非法 view 回 entries）；两视图保持挂载切换（隐藏另一侧），限流未保存草稿与列表状态不丢。

- `ConfCenterPage.jsx`（配置管理视图）：先创建 namespace（独立弹窗，名称校验与重名提示），左侧列表选择空间（含计数，无“全部”项，`?namespace=` 保持刷新后的选择）+ 右侧当前空间 KV 表格（key / 类型徽章 str|json / 值预览（统一单行，点击查看完整值）/ 更新时间 / 操作）；四个数据列表头可排序（button 触发，活动列 aria-sort + 方向箭头，非活动列淡双向箭头暗示；点当前列切升/降、点其他列从升序开始、变更回第 1 页；排序覆盖全部匹配项后分页——服务端排序，非当前页重排；namespace 切换保留排序，搜索/保存/删除刷新保留排序）；新建/编辑 Modal（namespace 只读绑定当前空间，输入 key/value；type 段选 str|json **共用同一个带行号的值编辑器实例**——CodeMirror 6（`JsonEditor.jsx` 适配公共 `shared/CodeEditor.jsx`：行号 gutter、虚拟长文档、明暗主题、撤销；str=language text 原样文本不解析，json=着色 + Worker 格式化/压缩（>64KiB 防抖 180ms 进 Worker，5s 预算，迟到结果不落地）+ 失焦校验非法标红禁存、错误带行列定位）；编辑器不因 type/字号切换重建（撤销栈/滚动保留）；格式化/校验状态区固定 48px 占位（aria-live），忙碌/错误文案增删不改变居中弹窗几何布局——修复点击格式化的屏幕抖动）；值工具栏含**字号调整**（默认 15px、整数 12–24、A−/A+/统一下拉（模块 `Select.jsx`）/恢复默认；正文与行号同步；localStorage `doublog.confcenter.editor.fontSize.v1` 持久化，缺失/越界/损坏回退 15，存储禁用仅本次会话；新建/编辑、str/json 共用）；删除两步确认（第一步入列，3.5s 自动撤销）；搜索框 q（300ms 防抖）+ 分页；切换空间会清空搜索并回到第一页，异步旧结果不覆盖新空间（请求身份含排序+版本）
- 顶部 Redis 状态条三态（调 cache/status）：绿=已启用（探活可达）/ 琥珀=已配置但连接异常（降级直连）/ 灰=未启用，附 url_masked 与命中计数；未配置时按钮文案「去配置」
- 缓存配置 Modal（GET /cache/config 回显，密码不回显、留空=沿用已存）：enabled/host/port/db/password/ttl + 测试连接 + 保存 + 清空缓存
- `RateLimitPage.jsx`（限流配置视图，2026-10-24 自状态条+Modal 迁移为独立页）：状态卡（mode 三态 + 默认规则/放行/拒绝计数 + tracked 窗口计数 + 主动刷新；status GET 失败显示错误/重试，不永久“加载中”）；配置表单（启用开关、按空间覆盖行（添加/删除，**namespace 用统一下拉选择已有空间**（2026-10-24 用户指令）；limit=0 豁免；未选/重复禁存）；**默认额度/窗口不在页面编辑**（2026-10-24 用户指令）——保存 payload 省略字段、后端沿用已存默认值；**配置 GET 失败禁存 + 重试**——不放开默认值提交；保存提交→回读完成期间禁用表单（防回读覆盖在途新草稿），PUT 失败与“已保存但回读失败”区分提示且草稿保留，手动回读带编辑代次围栏，PUT 成功刷新配置/状态并重建“已保存快照”，可“恢复已保存值”）；**重置计数卡已按用户要求移除（2026-10-24），reset API 保留**；覆盖行构造走 `overrides.js` 纯函数（`__proto__`/`constructor` 等合法名以 Object.defineProperty 成为自有键，不经原型 setter）
- `api.js` 走 apiFetch + unwrap（模块内全部端点均有包装，组件不裸调 fetch；confEntries 含 sortBy/sortOrder）；个性色 **cyan**；遵循 docs/ui-baseline.md
- 字号：主要控件/正文 16px；状态、表头及辅助说明 14px；namespace/key 和完整值 15px；类型徽章 13px；弹窗标题 18px；**值编辑器用户偏好字号默认 15px（12–24，localStorage 持久化）**。类型、时间和操作列配合加宽，删除确认使用“确认删除 / 取消”两步按钮。
- 值预览：中性浅底的等高单行预览，长值省略，多行字符串以 ↵ 标识换行，空字符串明确标注；点击打开只读弹窗查看完整原文或格式化 JSON（json 类型 CodeMirror 着色），可直接进入编辑。JSON 字符串标量保留引号。表格固定列宽，长 key 省略并支持悬停查看。

## 6. 测试（tests/confcenter/，76 例 + 可靠性 8 例 + 排序 12 例 SQLite + 1 例真实 PG，FakeRedis 内存假客户端——不连真实 Redis）

- CRUD：upsert 新建 201/覆盖 200/读回（str 保字符串形状、json 解析回对象）/**type 变更**（json→str 后读回字符串）/删除/404
- 校验：非法 type 400；json 非法 400（"[1,2" 拒绝）；key/namespace 非法字符与超长 400；含 `/` 的段结构性 404
- **排序（test_sorting.py，2026-10-24）**：四列×双向；未传参数兼容旧顺序；只传其一的缺省组合；空/非法字段与方向 400（含注入样例）；未授权 401；105 项跨三页稳定兜底无重漏；两空间同 key；过滤与 q 转义；空文本/多行/中文/JSON 的 data 存储文本序；updated_at 双向 NULL 最后
- **排序 PG（test_sorting_pg.py）**：pgserver 临时本机 PostgreSQL 复核四列双向/同值兜底/NULL 最后/COLLATE "C"/分页无重漏——证明排序 SQL 不依赖 SQLite 方言
- **缓存五路径**：命中（不查库、hits+1）/未命中回填（SETEX 键/TTL/载荷）/写删后失效（DEL 被调用）/未启用直连 DB（零交互零计数）/连接抛错静默降级（进程内只 warn 一次，test 探活自愈）；另覆盖 损坏载荷视同未命中、redis 库缺失降级
- 缓存管理端点：配置落盘与回显、非法配置 400、test（候选配置试连）、flush 前缀 SCAN+DEL（不误伤同 db 其他业务键）、status 密码掩码
- namespace：独立创建、重名 409、字符/长度/鉴权校验、重启与最后 KV 删除后仍保留、旧 PUT 兼容、相同 key 跨空间隔离、历史回填幂等
- 浏览：namespaces 聚合、entries 过滤分页（非法分页参数回退默认）
- 鉴权：无凭据/错凭据 401（全端点）
- 重命名 7 例：值/类型/时间戳原样迁移、旧 key 404、目标冲突 409 不动原值、同名 no-op 200、参数校验 400、缓存对旧/新键双失效（FakeRedis DEL 断言）、计入 namespace 限流（429）
- **限流 23 例**：默认未启用不限流；GET/PUT/DELETE 三路由均受限而浏览/管理端点不受限；本地 429 信封（RATE_LIMITED+details.retry_after/mode）与空间隔离；窗口到期恢复（monkeypatch _monotonic）；覆盖行更严/豁免（limit=0）；status tracked/计数；Redis 路径（confcenter_rl 前缀 ZSET、被拒占名额、mode=redis）；缓存 flush 不误伤限流键；EVAL 抛错即时降级本地；配置保存/回显/部分缺省沿用/非法 400（8 组参数化）；reset 本地与 Redis 双路径；限流端点鉴权。FakeRedis 相应扩展 EVAL/ZRANGE/ZCARD（按脚本内容识别 lizysdk 两段 Lua，内存 ZSET 语义等价执行）

## 7. 验收

`pytest tests/confcenter/ -q` 全绿；全量回归不退；真实 Redis 未运行时一切照常（降级路径）；前端 build 零报错；`node --test tests/confcenter-*.test.js`（含 Worker 校验/格式化保真、编辑器字号偏好读写异常/越界回退、排序参数与请求身份行为测试）通过；浏览器走查（ZCode 内置 browser-use，独立 context + 网络白名单仅 20130/20131 + 写前断言数据库隔离；截图经 image 子代理审查——覆盖明暗两态的列表排序、str 行号+字号、json 格式化/非法、独立限流页（默认/覆盖/加载失败））。
