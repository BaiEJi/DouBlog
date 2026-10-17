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
GET    /api/confcenter/entries?namespace=&q=&page=&page_size=   # 浏览（q 模糊匹配 key；省略 namespace=全部）
GET    /api/confcenter/{namespace}/{key}          # 读单条：data 按解析后返回（str→字符串，json→结构）
PUT    /api/confcenter/{namespace}/{key}          # upsert {type:'str'|'json', data}（201 新建 / 200 覆盖；json 非法 400）
DELETE /api/confcenter/{namespace}/{key}          # 200；不存在 404
# ↑ GET/PUT/DELETE 三条单条路由受 namespace 限流约束（超限 429）
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

- `ConfCenterPage.jsx`：先创建 namespace（独立弹窗，名称校验与重名提示），左侧列表选择空间（含计数，无“全部”项，`?namespace=` 保持刷新后的选择）+ 右侧当前空间 KV 表格（key / 类型徽章 str|json / 值预览（统一单行，点击查看完整值）/ 更新时间 / 操作）；新建/编辑 Modal（namespace 只读绑定当前空间，输入 key/value；type 段选 str|json：str=多行文本原样；json=**JSON 编辑器**（JsonEditor.jsx：textarea 透明覆层+highlight.js 着色，GitHub 亮暗主题沿用 index.css，零新依赖；Tab 两空格缩进、格式化/压缩、失焦校验非法标红禁存、错误带行列定位）；删除两步确认（第一步入列，3.5s 自动撤销）；搜索框 q（300ms 防抖）+ 分页；切换空间会清空搜索并回到第一页，异步旧结果不覆盖新空间
- 顶部 Redis 状态条三态（调 cache/status）：绿=已启用（探活可达）/ 琥珀=已配置但连接异常（降级直连）/ 灰=未启用，附 url_masked 与命中计数；未配置时按钮文案「去配置」
- 缓存配置 Modal（GET /cache/config 回显，密码不回显、留空=沿用已存）：enabled/host/port/db/password/ttl + 测试连接 + 保存 + 清空缓存
- 限流状态条（ratelimit/status）：绿=Redis 滑动窗口 / 琥珀=本地窗口（Redis 不可用降级）/ 灰=未启用；附默认规则、覆盖行数、放行/拒绝计数；启用且选中空间时可「重置 {ns} 计数」（POST /ratelimit/reset）
- 限流配置 Modal：启用开关 + 默认额度/窗口 + 按空间覆盖行编辑（添加/删除，namespace 输入带已有空间 datalist 建议；limit=0 豁免）→ PUT /ratelimit/config
- `api.js` 走 apiFetch + unwrap（模块内全部端点均有包装，组件不裸调 fetch）；个性色 **cyan**；遵循 docs/ui-baseline.md
- 字号：主要控件/正文 16px；状态、表头及辅助说明 14px；namespace/key 和完整值 15px；类型徽章 13px；弹窗标题 18px。类型、时间和操作列配合加宽，删除确认使用“确认删除 / 取消”两步按钮。
- 值预览：中性浅底的等高单行预览，长值省略，多行字符串以 ↵ 标识换行，空字符串明确标注；点击打开只读弹窗查看完整原文或格式化 JSON（json 类型 highlight.js 着色），可直接进入编辑。JSON 字符串标量保留引号。表格固定列宽，长 key 省略并支持悬停查看。

## 6. 测试（tests/confcenter/，69 例，FakeRedis 内存假客户端——不连真实 Redis）

- CRUD：upsert 新建 201/覆盖 200/读回（str 保字符串形状、json 解析回对象）/**type 变更**（json→str 后读回字符串）/删除/404
- 校验：非法 type 400；json 非法 400（"[1,2" 拒绝）；key/namespace 非法字符与超长 400；含 `/` 的段结构性 404
- **缓存五路径**：命中（不查库、hits+1）/未命中回填（SETEX 键/TTL/载荷）/写删后失效（DEL 被调用）/未启用直连 DB（零交互零计数）/连接抛错静默降级（进程内只 warn 一次，test 探活自愈）；另覆盖 损坏载荷视同未命中、redis 库缺失降级
- 缓存管理端点：配置落盘与回显、非法配置 400、test（候选配置试连）、flush 前缀 SCAN+DEL（不误伤同 db 其他业务键）、status 密码掩码
- namespace：独立创建、重名 409、字符/长度/鉴权校验、重启与最后 KV 删除后仍保留、旧 PUT 兼容、相同 key 跨空间隔离、历史回填幂等
- 浏览：namespaces 聚合、entries 过滤分页（非法分页参数回退默认）
- 鉴权：无凭据/错凭据 401（全端点）
- **限流 23 例**：默认未启用不限流；GET/PUT/DELETE 三路由均受限而浏览/管理端点不受限；本地 429 信封（RATE_LIMITED+details.retry_after/mode）与空间隔离；窗口到期恢复（monkeypatch _monotonic）；覆盖行更严/豁免（limit=0）；status tracked/计数；Redis 路径（confcenter_rl 前缀 ZSET、被拒占名额、mode=redis）；缓存 flush 不误伤限流键；EVAL 抛错即时降级本地；配置保存/回显/部分缺省沿用/非法 400（8 组参数化）；reset 本地与 Redis 双路径；限流端点鉴权。FakeRedis 相应扩展 EVAL/ZRANGE/ZCARD（按脚本内容识别 lizysdk 两段 Lua，内存 ZSET 语义等价执行）

## 7. 验收

`pytest tests/confcenter/ -q` 全绿；全量回归不退；真实 Redis 未运行时一切照常（降级路径）；前端 build 零报错；image 审查（含 Redis 配置 Modal）。
