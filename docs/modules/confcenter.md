# 配置中心模块（confcenter）

> 表：confcenter_namespaces / confcenter_entries　前缀：/api/confcenter　前端：/confcenter（门户卡，cyan）　更新：2026-10-17
> 规范：docs/confcenter-spec.md

## 1. 功能概述

通用 KV 配置平台：**独立 namespace → key → value** 映射（空间可为空）；value 统一 `{type, data}` 包装——`type=str` 原样字符串、`type=json` 合法 JSON（对象/数组/数字）；显式 type 消除 "123"/"[1,2]" 的裸值歧义。**Redis 读穿缓存**（可选可降级），减轻数据库压力。**namespace 维度限流**（可选可降级，2026-10-17）：单条 KV 读写按空间计数，优先 Redis 滑动窗口（lizysdk），无 Redis 降级本地窗口。

## 2. 数据模型

`confcenter_namespaces`：namespace(≤100) 主键、created_at；通过 `POST /namespaces` 独立创建。`ensure_migrations(engine)` 在 create_all 后从历史 KV 幂等回填缺失空间。

`confcenter_entries`：namespace(≤100)+key(≤200) 复合主键、type、data(Text)、updated_at；namespace 单列索引。字符白名单 `[A-Za-z0-9_.:-]`（含 `/` 的段在路由层结构性 404）。

## 3. 读写约定（核心语义）

- 读：str→字符串；json→解析后结构化数据
- 空间独立保留，删除最后一个 KV 不会移除 namespace；旧客户端直接 PUT 新 KV 时，在同一事务中补登记 namespace。
- 写：同 ns+key 整体覆盖（201 新建/200 覆盖），**type 允许变更**（json→str 后 "[1,2]" 读回即字符串）
- type=json 且非法 JSON → 400 拒绝

## 4. API（全部 require_basic，信封）

`GET /namespaces`（含空空间，计数为 0）；`POST /namespaces`（JSON `{namespace}`：201 创建，409 重名，400 非法名称）；`GET /entries?namespace=&q=&page=&page_size=`；`GET|PUT|DELETE /{namespace}/{key}`（**三条单条路由受 namespace 限流约束，超限 429**）；`PUT /rename`（{namespace, old_key, new_key}：同空间重命名，单事务拷贝行（保留 type/data/updated_at）后删旧行，缓存双失效，计入限流；旧 404/新 409）；缓存管理：`GET /cache/status`、`GET|PUT /cache/config`（data/redis_config.json，密码留空沿用）、`POST /cache/test`（可带候选配置试连）、`POST /cache/flush`（`confcenter:*` 前缀 SCAN+DEL）；限流管理：`GET /ratelimit/status`、`GET|PUT /ratelimit/config`（data/ratelimit_config.json）、`POST /ratelimit/reset`（清零某空间窗口计数）。
**路由陷阱**：字面量路由（/namespaces /entries /cache/* /ratelimit/*）必须先于 `/{namespace}/{key}` 注册。

## 5. Redis 缓存层（cache.py）

- 读=先缓存（键 `confcenter:{database_identity}:{escaped_ns}:{escaped_key}`，值整个载荷 JSON，TTL 默认 3600）→ 未命中回填；写/删=先落库再 DEL（不双写）
- **三态降级**：redis 库缺失 / 未启用（默认）/ 连接失败 → 静默直连 DB（进程内只 warn 一次；写语义完整）；status/test/flush 探活成功可自愈
- 运行态挂 `app.state.confcenter_cache`（禁模块级单例）
- 故障或配置变化标记 dirty；恢复成功必须先清当前数据库命名空间旧键，再允许命中。DB 读取携带回填代次，写后失效与 setex 串行校验，旧读取不能在 DEL 后重新填入旧值

## 6. namespace 限流层（ratelimit.py，2026-10-17）

- **生效范围**：GET/PUT/DELETE `/{namespace}/{key}` 三条单条路由，按 namespace 计数；浏览（/namespaces /entries）与缓存/限流管理端点不限流
- **Redis 优先**：redis 库可用且缓存配置（redis_config.json 与缓存层**共用连接**）已启用且可达 → `lizysdk.dist.SlidingWindowCounter`（ZSET+Lua 原子滑动窗口）；键前缀 `confcenter_rl:{database_identity}`（下划线——不被缓存 flush 的 `confcenter:*` SCAN 误伤）
- **本地降级**：无 Redis（库缺失/未启用/连接失败/EVAL 抛错）→ 进程内滑动窗口（deque+锁，`_monotonic` 时间接缝可测）；Redis 调用失败本次即时降级，不阻断请求；ratelimit/status 探活成功自愈
- **语义注记**：Redis 路径 `allow()`=先计数再判定（被拒也占名额，超限即惩罚，原子）；本地路径=判定后计数（被拒不追加，deque 天然有界）——持续速率一致，仅洪泛恢复节奏不同（lizysdk 文档对两取舍均有说明）
- 配置 `data/ratelimit_config.json`：`{enabled=false, limit=100, window_seconds=60, overrides}`；overrides 按空间覆盖 `{limit, window_seconds}`，limit=0 豁免；PUT 允许部分缺省沿用，overrides 整体替换；保存后本地窗口清空（Redis 窗口 TTL 自然过期，可 reset 立即清零）
- 超限 → `RateLimitError`（429/RATE_LIMITED），details 带 `{namespace, limit, window_seconds, retry_after, mode}`；Redis 路径 retry_after 由窗口内最老事件 score 精确估算（窥探失败回退整窗）
- 判定在 `run_db` 池内执行（Redis EVAL 是阻塞套接字 IO，不占事件循环）；运行态挂 `app.state.confcenter_ratelimit`

## 7. 前端（frontend/src/confcenter/）

先创建 namespace；左侧列表选择空间（含 KV 计数，无“全部”项），选中状态由 `?namespace=` 保存；右侧只展示该空间的 KV 表（类型徽章/等高单行值预览；长值省略，换行以 ↵ 标识，空字符串显式标注，**整格可点击**（after 伪元素热区撑满单元格），点击弹窗查看完整值及格式化 JSON，并可进入编辑；JSON 字符串标量在预览和编辑时保留引号）；新建/编辑 Modal（**编辑时 key 可改**——保存时单请求原子重命名并更新值，携带 if_updated_at 防旧编辑覆盖；**加宽档 max-w-4xl**（Mask xwide，比值预览的 max-w-2xl 再宽一档），str 与 json 编辑器同高（16 行 × leading-6 + p-3 同度量，切换类型弹窗尺寸不变），namespace 固定为当前空间，只填写 key/value；type 段选；str 多行原样；**json=JSON 编辑器**——`JsonEditor.jsx` 复用公共 CodeMirror 6 适配器（虚拟文档视图、明暗主题与撤销），Tab 两空格缩进、格式化/压缩按钮、失焦校验非法标红禁存且错误带行列定位（`jsonTools.js`，devtoolbox 同款 V8 position 约定））；值预览弹窗 json 类型同款着色（`JsonHighlightedView`，折行只读）；删除两步确认；搜索仅在当前空间内防抖查询，切换空间重置搜索和分页，过期请求不覆盖新空间；Redis 状态条（绿=启用/琥珀=降级/灰=未启用 + 命中计数）+ 缓存配置 Modal（测试连接/保存/清空）；**限流状态条**（绿=Redis 滑动窗口/琥珀=本地降级/灰=未启用 + 当前规则与放行/拒绝计数 + 重置当前空间计数）+ 限流配置 Modal（默认额度/窗口 + 按空间覆盖行编辑，limit=0 豁免，namespace 输入带已有空间 datalist）。

配置中心采用放大后的字号：主要控件/正文 16px，状态条、表头、计数和辅助说明 14px，namespace/key 与完整值 15px，类型徽章 13px，弹窗标题 18px；值预览保持单行。表格类型、时间和操作列同步加宽；删除确认展示“确认删除 / 取消”两步按钮。

## 8. 测试（tests/confcenter/，原 76 例 + 可靠性 8 例）

namespace 创建/重名/校验/重启保留/最后 KV 删除/空间隔离/历史迁移幂等（7）+ CRUD/type 变更/非法校验/浏览/鉴权 + 重命名 7 例（迁移保值保时间戳/404/409 冲突不动原值/同名 no-op/参数校验/缓存双失效/计入限流）（30）+ 缓存五路径（命中/回填/写失效/未启用/连接异常降级）与管理端点（16）+ **限流 23**：默认不限流、三路由均受限、本地 429 信封/空间隔离/窗口到期（_monotonic 接缝）/覆盖行更严与豁免、Redis 滑动窗口（confcenter_rl 前缀、被拒占名额、status tracked）、缓存 flush 不误伤限流键、EVAL 抛错即时降级本地、配置回显/部分缺省/非法 400、reset 双路径、鉴权。FakeRedis 扩展 EVAL/ZRANGE/ZCARD（按脚本内容识别 lizysdk 两段 Lua 以内存 ZSET 语义等价执行，TTL 忽略）。

## 公共 UI 外壳（2026-10-13）

前端由 `shared/ModuleShell.jsx` 提供统一 220px 侧栏、多级菜单与内容画布；导航状态经 `useModuleNavigation` 注册。前端仅适配桌面浏览器，无移动端布局。页面内部的业务工具栏、表格、编辑器与弹层仍由模块管理。布局与性能契约见 `frontend.md` 的页面布局约定。

> 2026-10-16 行为微调：json 类型值入库文本改 orjson 紧凑格式（`{"a":1}`，旧 `{"a": 1}`，空格消失）；语义不变，JsonArea 显示的存储原文随之变化。读路径与 Redis 缓存解析同步换 orjson（大 JSON 值 1.5-8×）。


## 2026-10-21 原子编辑与缓存恢复

- `PUT /rename` 保留旧重命名契约；可同时携带 `type/data/if_updated_at`，在同一事务锁定旧行、核对版本、检查新 key 冲突、更新值并迁移 key。任一步失败不保留半次编辑。省略 type/data 仍保留原值和时间戳；同名带值可以原子编辑。
- `PUT /{ns}/{key}` 可选 `if_updated_at`（API 返回的 naive UTC 更新时间）做 SQL CAS；可选 `if_absent:true` 只允许新建；冲突均 409。DELETE 可选同名 query 参数；无条件的旧 API 调用保持兼容。页面编辑和删除均带版本，新建使用 if_absent，409 时输入保留。
- KV/限流数据路径复用共享 run_db 的 admission/context/清理，并改用 `confcenter-db` SDK 池（8 workers），Redis 故障不会占满全站 DB 池。Redis 管理 PING/SCAN/配置写与限流管理转 `confcenter-cache` SDK 池，事件循环不执行阻塞套接字。配置文件原子替换；临时测试连接关闭，配置变化关闭旧连接。
- GET 单条只提交一次 `confcenter-db` 任务，在其中依次执行限流、缓存、DB 与带 generation 的回填；命中缓存也先检查限流，减少一次排队/切线程和会话清理，故障隔离与失效保护不变。
- CodeMirror 编辑超过 64 KiB 的 JSON 时，校验在 180ms 防抖后进入独立 Worker；输入变化终止旧校验，超时 5s 终止 Worker。格式化/压缩也在 Worker 执行，结果只应用到未变化的原稿；校验/格式化期间禁存，Ctrl+S 使用同一保存路径。
- Redis KV 和限流键均包含不含密码的数据库 identity；namespace/key 的冒号做编码，两个不同复合键不再碰撞。清缓存每批 500 键，只清当前数据库 KV，不清限流键或其他数据库。
- 缓存初始化与限流初始化有锁，每 app 独立；公共生命周期登记本模块的惰性停止钩子（无需启动线程）。停机或切库时关闭客户端并清缓存/限流运行态，重复停止不重复关闭，重入后的首次访问按当前数据库建立新状态；关闭一个 app 不影响另一个。真实生命周期专项见 `tests/system/test_lazy_resource_lifecycle.py`。
- `tests/confcenter/test_reliability.py` 覆盖原子改名+值、非法 JSON 零半次写入、同名和改名 CAS、迟到回填、冒号复合键与条件 PUT/DELETE/新建；原恢复旧值断言已更新为恢复后立即读取最新值。
- 83 项后端专项通过；前端独立浏览器覆盖 409 保留草稿、原子改名、4000 行 JSON Worker 校验/压缩、有限 CodeMirror DOM 与 Ctrl+S 保存。`frontend/tests/confcenter-json-worker.test.js` 验证大文档仅回传小校验结果、格式化值保真、错误位置和 JSON 标量。
