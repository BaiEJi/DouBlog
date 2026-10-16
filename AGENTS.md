# AGENTS.md — DouBlog 代理工作指南

> 本文件供 AI 代理（及人类协作者）在本仓库工作前阅读。**每次会话开始先读本文件与"文档同步规则"。**

---

## 📌 全局工程要求（2026-10 Flask → FastAPI 全面迁移，长期有效）

1. **后端框架是 FastAPI**（原 Flask 3 已全面迁移；单进程 uvicorn，禁止多 worker / 额外组件）
2. **每个模块的日志与并发池一律用 lizysdk**（`basekit`）：日志走 `lizysdk.logs`（`sys_name=doublog.<module>` 记录级覆盖），并发执行走 `lizysdk.pools.create_pool`（模块级命名池）；结构性单写者/调度线程（sdklogs 写者、各 daemon 调度器）保留 `threading`，执行体经 SDK 池。**禁止新增 `ThreadPoolExecutor` / 裸工作线程池**
3. **总配置页**：所有模块共用同一份数据库配置（`data/db_config.json`），本地 SQLite 与远端 PostgreSQL **一键切换**（`POST /api/admin/database/switch`），前端有统一配置页入口
4. **所有模块的存储放在同一个库**，表名规则 **`模块名_表名`**（如 `blog_posts`、`diary_diaries`、`sdklogs_logs`；`vault_*`/`pwsvc_*`/`subs_*`/`apihub_*` 本就符合）。存量库由启动迁移幂等改名（映射表见 `docs/fastapi-migration.md`）
5. **压测门槛**：任何模块迁移/重构前后必须对照压测，**吞吐不得下降**；改动后全量单测回归通过
6. **改动的前端页面必须做可视化验收**（渲染页面截图走查）；未改动页面不用重验

## 项目是什么

单用户博客/知识库：**FastAPI 后端**（uvicorn 单进程，60100，PostgreSQL 默认（`117.72.98.99:50002/app_dev`）/ SQLite 可一键切换，**只换连接读新数据不迁移**，前端总配置页 `/config`）+ **React 19 前端**（60101，Vite + Tailwind 4）。日志/异常/并发池统一走 lizysdk（basekit）。所有模块同库存储，表名规则 `模块名_表名`（存量库启动自动改名）。文章按**知识库（Workspace）**分组隔离（库间树/列表互不可见，name 库内唯一，不支持跨库移动），支持 3 层树形结构（虚拟根 id=0，顶级顺序存 `blog_workspaces.children_order`）、拖拽排序、Markdown 全功能渲染（markdown-it 12 插件 + KaTeX + Mermaid + highlight.js）。知识库特性：**双链 `[[wiki]]` + 反向链接、图片上传（粘贴/拖拽）、最近浏览、Markdown zip 导出备份、SWR 预取**。**无 Redis（例外：confcenter 可选 Redis 读穿缓存，见 17y）、无限流（apihub 网关的多级限流是其模块自身功能）**；后台线程：日志保留清理 + 订阅每日备份/支出摘要 + apihub 探活（均 daemon 随进程，TESTING 空转）——浏览计数实时写库。

**必读文档索引**（都在仓库根目录）：

| 文档 | 内容 | 何时更新 |
|---|---|---|
| `README.md` | 面向使用者：快速开始、技术栈、配置、部署 | 改动影响使用方式/配置/部署时 |
| `api.md` | HTTP 接口契约（请求/响应/错误码/示例） | **任何** API 变更 |
| `backend.md` | 后端架构（模型/树设计/双数据库/中间件/测试） | 后端结构或行为变更 |
| `frontend.md` | 前端架构（API 层/渲染管线/页面/构建） | 前端结构或渲染行为变更 |
| `docs/fastapi-migration.md` | FastAPI 迁移规范：骨架契约/移植对照/表名映射/验收门槛 | 改骨架契约、模块包对外契约（router/start_background/ensure_migrations）、表名时 |
| `docs/modules/<模块>.md` | **每模块权威文档**（功能/模型/API 契约/要点/前端/测试/边界，2026-10 按代码生成）：blog diary vault pwsvc sdklogs subs apihub system todo gamemap practice steamidler confcenter clash assets | 模块行为变更时；根文档只保留全局架构，模块细节改这里 |
| `docs/ui-baseline.md` | UI 一致性基线（字体/卡片/按钮/输入档位 + 暗色硬性检查） | 前端页面改动时对齐档位 |
| `backend-prompt.md` | ⚠️ 历史存档（开发期 AI 提示词，**不更新**） | 永不（已标注历史） |
| `frontend/README.md` | 前端子目录入口，指向根文档 | 仅当命令变化 |
| `docs/vault-design.md`、`docs/pwsvc-design.md` | 密码库 / 密码服务设计文档（算法规范与威胁模型） | 改对应模块算法或安全边界时 |

---

## 关键事实（改代码前必须知道）

1. **端口**：后端 `60100`、前端 `60101`；**api-hub 子服务 `8300`**（见第 17 条）
2. **凭据与登录**：凭据存 **system_accounts 表**（PBKDF2-SHA256 哈希，system 模块播种/管理，`config.py` 的 auth_username/auth_password 仅作首次播种默认与中间态回退）；管理页 `/config` 登录账号卡可改用户名/密码（PUT /api/admin/account，验旧密码）。**统一登录**：前端 `/login` 登录一次 → HttpOnly 会话 Cookie（30 天，HMAC secret_key 在 config.py）全站生效；`require_basic` 依赖=Cookie 优先、Basic 兼容（API/测试通道）；前端 bundle **不持有任何凭据**（`shared/client.js` 仅 credentials:include + 401 跳 /login）；免认证例外：图片 GET / sdklogs 摄入 / diary 分享 / apihub gw(sk-)；vault 主密码解锁是加密步骤不是登录
3t. **请求级 trace**：main.py 纯 ASGI 中间件每请求绑 lizysdk trace_id（响应头 X-Trace-Id 透传/回写；所有日志行自动携带——经 shared/logging_setup 的 LogRecord 工厂注入，勿用 handler filter 方案，SDK 队列 handler 会绕过）
3h. **统一侧栏/内容画布（2026-10-13）**：全部业务模块由 App 的 ModuleFrame 包入 `shared/ModuleShell.jsx`（220px sticky 侧栏 + 多级菜单 + 移动端抽屉）；PageHeader 为 tabs 注册适配器，不再绘制顶栏。页面使用 `useModuleNavigation` 注册视图/徽标/插槽；内容全局留白只在 ModuleShell 提供（`max-w-[1700px] px-4 sm:px-6 xl:px-10 py-8`），禁止内页再包一层全局 padding。门户/登录/公开分享独立外壳。gamemap 画布须保留显式容器高度与明暗主题变量；导航不得重挂正文/画布组件。
3. **双数据库**：运行时后端由 `data/db_config.json` 决定（sqlite/postgres）；切换走 `POST /api/admin/database/switch`——**只换连接不迁移数据**（空库自动建表播种，PG 库不存在自动创建；dev 模式 touch `_reload_stamp.py` 触发 uvicorn 重启，生产需手动重启）；**前端总配置页 `/config`**（数据库 + 日志上报）与 `/admin` 均可操作
3z. **FastAPI 骨架契约**（详见 `docs/fastapi-migration.md`，改骨架前必读）：`app/db.py`（`Base` 自带 `Model.query` 描述符 / scoped session / `run_db`）/ `app/shared/`（`api_response` 信封、`require_basic` 依赖、`pools.get_pool`）；**模块包三契约**：`__init__.py` 导出 `router` + 可选 `start_background(app)`（`app.state.testing` 空转）+ 可选 `ensure_migrations(engine)`；模块运行态挂 `app.state.<mod>`（禁模块级单例，测试多 app）；`init_db` 顺序 = 存量 RENAME **先于** create_all；Flask 原版快照 `backend/tools/flask-snapshot/`（只读）；压测工具 `backend/tools/bench/`（`launch.py` 支持 flask/fastapi 两实现对照）
4. **虚拟根节点**：id=0 的 Post 行；所有查询过滤 `id != 0`；建库时自动播种（`db.py`）
5. **知识库**：`workspaces` 表 + `posts.workspace_id`；树接口按库返回（缺省 = id 最小库）；顶级排序在库上、子级排序在父文章上；存量数据由 blog 模块 `ensure_migrations` 幂等迁移（ALTER + 回填 + 拷贝顶级顺序）
6. **层级上限 3 层**：`posts.py` 的 `MAX_LEVEL = 2`
7. **正文按需传输**：列表/树接口**不含** `content`，详情接口才有——别在列表序列化里把正文加回去
8. **slug 级联**：改名/移动父文章必须级联更新子孙 slug（`update_slug_for_subtree`），否则 `/path/<slug>` 查询失效
9. **图片接口**：GET（realpath 目录围栏 + 扩展名白名单）+ **POST `/api/images/upload`**（multipart `file`，白名单不含 svg，≤10MB，uuid 文件名落盘 `data/images/`）；编辑器粘贴/拖拽/按钮均走它
10. **双链**：渲染在前端（`md.js` 的 `wiki_link` inline 规则 + `applyWikiLinks`，`buildWikiMap` 从树构建映射，name 优先于 title）；后端 `/api/posts/id/<id>/backlinks` 同库扫描正文；改寻址规则时**前后端两处必须一致**
11. **导出**（`app/blog/routes/export.py`）：**必须排除虚拟根 id=0**——存量库根挂在默认知识库下，不排除会树递归死循环（另有 depth 32 兜底）；图片 URL 三种引用形式都要重写为相对 `images/` 路径
12. **日记模块独立**：`diary_diaries` 表 + `/api/diary/*`，与文章体系零耦合；日期一律 `YYYY-MM-DD` 字符串（避免跨后端时区问题）；字数后端保存时算（CJK 逐字+西文按词），别信任前端计数
13. **Vault 零知识密码库**：服务端只存密文（blob={n,ct} 与包裹 VEK），API 层不存在明文敏感参数，禁止加"服务端搜索/密码分析"类接口；加密在 `frontend/src/vault/components/crypto.js`（Argon2id@noble/hashes + WebCrypto AES-GCM），VEK 仅内存；UI 枚举（类型/分类等）存储英文值、展示中文映射；审计只记 action+item_id；**密码到期提醒**（`expiry_days` 在加密 blob 内，判定在 `vault/components/core.js expiryInfo()`）是纯客户端功能，服务端不感知到期与否
13e. **日记超集**（app/diary/）：分册/置顶/归档/回收站(软删+hard)/分享(免登录 token，过期即 404)/快速录入/热力图/那年今日/趋势/年度回顾/导出/模板+引导问题；存量库靠 diary 模块 `ensure_migrations` 幂等补列
13f. **模块化日志上报（全量采集，2026-10-13）**：`shared/modules.py` 每模块 sys_name=doublog.<m>（路径前缀映射）；**依赖 basekit(lizysdk) 的记录级 sys_name 覆盖**（formatter extra 支持，改 SDK 格式器需回归 basekit 测试）；上报配置在 `data/logs_config.json`，管理页 PUT /api/admin/logging 即时重装配（级别 INFO=全量 / WARNING=仅告警，**默认 INFO**——此前默认 WARNING 致日常日志几乎不进采集页）；**每请求 access 日志**由 main.py trace 中间件产生（INFO `access <method> <path> -> <status> (Nms)`，sys_name=doublog.main，/api/v1/logs 路径 no_remote 防回环）；**trace 全链路实测通**（含 run_db 工作线程——lizysdk 池默认 propagate_context 复制 contextvars）；mod_logger 必须显式持模块名（防 doublog.doublog 双前缀）；测试里 TestClient(httpx) 的请求回声日志（消息含 URL query 串）也会入库，断言用 level/trace_id 参数钉死目标记录
13b. **Sdklogs 日志接收**（`app/sdklogs/` + `logs/LogsPage.jsx`）：`/api/v1/logs(/batch)` **不挂 Basic Auth**（SDK send_json 无凭据直发；可选 `LOGSDB_AUTH_TOKENS`）；`ts` 一律 naive UTC（无时区按 `LOGSDB_INCOMING_TZ` 解释）；写入是**每 app 一条单写者线程**（队列满丢最旧，落库失败→死信 `data/dead_letters/`，坏日志 202+死信不报 4xx）；保留清理每日线程（`LOGSDB_RETENTION_DAYS`，0=永久）——「无定时任务」的例外只有这一个清理线程；kv 检索参数名限 `[A-Za-z0-9_.-]` 防注入；测试用 `pipeline.flush(timeout)` 等待落库
13g. **Subs 订阅管理**（`app/subs/` + `subs/SubsPage.jsx`，CrownFlow 全量迁移，路径前缀 `/api/subs`）：三表 `subs_categories/subs_members/subs_subscriptions`（日期一律 YYYY-MM-DD 字符串）；**月/年支出与趋势按「日均×重叠天数（闭区间+1）」计算，整月/整年口径**（不是"至今"），跨币种按 `settings.subs_exchange_rates` 静态汇率折 CNY——改口径须同步 api.md 第 13 节；custom 计费周期必须带 custom_days>0（PUT 部分更新也做组合校验）；分类删除前查会员关联；**每日线程**（start_daily_loop：02:00 备份当前 SQLite 库（sqlite3 backup API 出 WAL 一致快照 → data/backups/，90 天保留，PG 后端 skipped，`SUBS_BACKUP_ENABLED=0` 关闭）+ 10:00 当日支出摘要写模块日志）——测试直接调 run_daily_spending_log/backup_database，别 sleep 等线程；前端唯一新增依赖 `lunar-javascript`（仅到期日历农历显示，独立到期日历 chunk ~104KB gzip，勿在别处引入）；**新增前端目录必须在 `index.css` 补一行 `@source "./目录";`**——本仓是 `source(none)` 显式白名单模式，漏加则该目录独有工具类（含 `dark:` 变体）全部**静默不生成**（subs 首版暗色表头白底即此坑）
13a. **Pwsvc 密码服务**（`app/pwsvc/routes.py` + `vault/PwsvcView.jsx`，**非零知识**，UI 已标注）：轮换密码**不存储**，由 `derive(seed, window, policy)` 纯函数推导（HMAC-SHA256 + 拒绝采样 + 洗牌，seed 为 32 字节/256-bit）——**改算法会令所有密码漂移**，测试里有黄金向量锁死，改前必读 `docs/pwsvc-design.md`；**每用户独立 seed**（AES-256-GCM 落盘，密钥 `data/pwsvc.key` 自动生成）；宽限 = 上一窗口仅在进入新窗口 **30s 内**有效（`min(30, rotation)`）；`/api/pwsvc/validate` 用 `X-Api-Key`（只存 SHA-256 哈希，明文仅创建/重置时返回一次）；密码明文**禁止落库与写日志**；**限流是进程内令牌桶**（多进程部署时每进程各算各的额度）；校验日志 `pwsvc_validate_logs` 保留 30 天、被 429 的请求不落日志；存量库升级靠 pwsvc 模块 `ensure_migrations` 幂等 ALTER 补列
14. **SWR 预取**：链接 hover/focus → `prefetchPost`（`?no_view=1` **不计浏览量、不进最近浏览**）；详情页命中缓存即渲染、后台重拉覆盖；编辑保存/删除后 `invalidatePost`
15. **响应超 1KB 自动 gzip**（main.py `GZipMiddleware(minimum_size=1024, compresslevel=6)`）
15a. **SQLite WAL 坑**：`journal_mode=WAL` 必须在 `init_db` 无并发窗口强制设置并校验返回值（并发下切换会**静默失败**回到 delete 模式 → 读写互斥锁死）；每连接 PRAGMA（busy_timeout/synchronous/cache_size/temp_store）走 connect 监听器。压测工具在 `backend/tools/sdklogs_loadtest.py`（改写入/存储路径后跑一遍对照）
16. **测试完全自包含**（临时 SQLite，无外部依赖）；PG 切换集成测试可选 `pip install pgserver`（未装自动跳过）
17y. **配置中心模块**（app/confcenter/ + /confcenter 页，cyan）：扁平 KV namespace→key→value；value={type:str|json,data} 显式类型（json 写校验 400、type 可变更）；Redis 读穿缓存三态降级（库缺失/未启用/连接失败→直连 DB，只 warn 一次）；缓存配置 data/redis_config.json；**字面量路由必须先于 /{ns}/{key} 注册**；测试 39 例（FakeRedis）
17z. **Todo 模块**（app/todo/ + frontend/src/todo/，MyTodo 迁入）：四象限待办+迁移链+规律生活计划（物化任务）+统计+邮件提醒；表 todo_* 五表（users/token 鉴权未迁，走统一登录）；前缀 /api/todo（信封）；真实数据已导入（tools/import_mytodo.py，2500 任务）；**extensions/todo/{chrome-extension,android} 为平迁客户端，仍指向旧服务 8070+token 协议**（未改造，见 docs/modules/todo.md）；测试 53 例；timeutil 已上移 `app/shared/timeutil.py`（todo 与 practice 共用）；前端 kit/charts 被 gamemap/practice/steamidler 跨模块引用
17m. **Gamemap 模块**（app/gamemap/ + src/gamemap/，2026-10-12 自 todo 拆出，前缀 /api/gamemap）：剧情图谱 13 表 gamemap_*；保留 antd6/@xyflow 技术栈——**根 main.jsx 无 StrictMode**（xyflow dev 双渲染坑，勿恢复）、画布勿改回内置 EdgeRenderer；ensure_migrations=7 默认关系类型种子+附件目录；测试 34 例（docs/modules/gamemap.md）
17p. **Practice 模块**（app/practice/ + src/practice/，2026-10-12 自 todo 拆出，前缀 /api/practice）：刷题记录+艾宾浩斯复习+一键抓题（LeetCode/洛谷），6 表 practice_*；时区设置跨模块复用 todo（app.todo.services.get_settings）；测试 61 例——20 轮评审 100 问题修复（docs/modules/practice.md）
17s. **Steamidler 模块**（app/steamidler/ + src/steamidler/，2026-10-12 自 todo 拆出，前缀 /api/steamidler）：Steam 挂机，单表 steamidler_accounts；auth/worker 与源逐字节一致、gevent 限 worker 线程独立 hub；protobuf 被 steam[client] 锁 3.20.3 勿升 4+；start_background 恢复挂机账号；测试 18 例（docs/modules/steamidler.md）
17c. **Clash 模块**（app/clash/ + src/clash/，前缀 /api/clash，sky）：**clashctl 全能力 + mihomo Web 控制台（zashboard）核心能力的 Web 迁移**。①clashctl 面（service.py）——底层完全复用其 bash 函数（`bash -c '. "$0"; <fn> "$@"'`，参数走 argv 防注入；stdin=DEVNULL 防 `_error_quit` 挂起；输出剥 ANSI），禁止在 Python 重实现；②控制器面（controller.py）——转发 mihomo external-controller REST（代理组/节点切换/单组延迟测速/连接管理/规则/运行时配置 PATCH/Provider 热更新），secret 从 runtime.yaml 解析**只留后端**，requests trust_env=False，组名 quote(safe='') 进路径段。无表/无后台线程；安装检测=DOUBLOG_CLASHCTL_DIR（默认 ~/clashctl）下有 scripts/cmd/clashctl.sh，未装时门户卡片置灰+页面空态、其余端点 404；**状态语义靠退出码**（clashproxy/clashtun rc 0=开启/1=关闭）；mixin 保存=写文件+`_merge_config_restart`；订阅 update 的 flag 必须在 id 之前；**订阅 add/update 下载剥离代理 env 直连**（strip_proxy——*_proxy 指向本机 clash，出口不可达会拖垮 curl）；实时日志开关=POST /log/level（订阅配置常带 silent 致日志不增长）；处理器全 sync def（subprocess/requests 阻塞数秒，防占事件循环）；Tun 需 sudo（无免密时"报成功但仅写配置"是 clashctl 原生语义）；测试 34 例（假 clashctl + 假 mihomo 控制器，docs/modules/clash.md）
17q. **Assets 资产库模块**（app/assets/ + src/assets/，前缀 /api/assets，fuchsia）：Prompt/Skill 双类型资产管理；四表 assets_categories/items/versions/usage_logs（无后台线程）；**变量 `{{name}}` 由服务端保存时提取**（extract_variables，别信任前端）；**版本策略：title/summary/content 实际变更才快照，当前版本也在版本链**（元数据变更/相同内容不产生版本；恢复=产生新版本）；状态机 active⇄archived→trash（软删；hard 级联版本与日志；回收站内禁编辑/使用）；标签 JSON 列 LIKE 匹配故**禁引号与反斜杠**（400 兜底）；列表不含正文（同 blog）；导入 upsert 按「kind+标题」匹配（标题**不唯一**是设计），dry_run 不落库；单用户数据量小，统计/聚合 Python 端算；测试 27 例（docs/modules/assets.md）
17. **API Hub 模块**（`app/apihub/`，能力包同款结构）：聚合异构上游 API，网关入口 `/api/apihub/gw/*` 走**平台令牌 sk-（SHA-256 落库，不挂 Basic Auth）**，管理端 `/api/apihub/admin/*` 走 Basic Auth；四级限流/计次配额（预占-退还）/密钥池/探活。运行态挂 `app.state.apihub`（持真实 app 引用）；凭证 AES-GCM 密文落库，主密钥 `data/apihub.key`；上游连接池为标准库 http.client keepalive（每目标封顶 128 并发，超时≠连接错误不重试）；探活调度 daemon 线程 TESTING 空转。前端 `/apihub` 单页（门户卡片）。测试 core/api/selfreg/openapi 四套；接口契约见 api.md 第 14 章。**OpenAPI 发布**（2026-10-12）：API 带 `group1/group2/pub_name/doc_md`（最多二级分组，`doc` 保留字）；顶级入口 `ANY /openapi/{g1}/{g2}/{name}` + `GET .../doc`（公开 Markdown 文档：骨架自动生成 + doc_md）；路径模板变量以**同名 query 参数**注入；**内部服务令牌 `X-Apihub-Token`**（`data/internal_token` 自动生成，require_basic 见此头即信任——服务内 API 不走用户身份验证，泄漏=绕过全站认证，按密钥文件管理）。**自注册**：`tools/apihub_register_self.py` 把本服务全部模块 API（246 个/13 模块）注册为上游 `doublog` 并发布为 `self/<模块>` 二级分组，配三级限流（api 级读写 20/5rps + token 50rps + global 100rps，幂等可重跑）；`tools/apihub_verify_self.py <sk-令牌>` 做 45 项端到端验收（转发一致性/写操作/429/鉴权/openapi/doc）

### 本机环境注意（Windows）

- 后端虚拟环境：`backend/venv`（Windows 下 `venv/Scripts/python.exe`）
- shell 脚本兼容 Git Bash（lsof 缺失时自动回退 netstat）
- PG 切换的集成测试依赖 venv 内 `pgserver`（内嵌 PostgreSQL，`pip install pgserver`；注意其默认在宿主 Python 进程退出时停止 PG，长跑场景需常驻进程保活）

---

## 常用命令

### 后端

```bash
cd backend
./venv/Scripts/python.exe run.py            # 启动（60100，uvicorn 单进程，dev 自动 --reload）—— Windows Git Bash
./venv/Scripts/python.exe -m pytest tests/ -q -n 8   # 测试（501 用例，含 clash 34；并行 ≈2 分钟；xdist 已装入 venv）
./venv/Scripts/pip.exe install -r requirements.txt
```

### 前端

```bash
cd frontend
npm run dev        # 开发（60101）
npm run build      # 生产构建（验收门槛，必须零报错）
npx vite preview --host 0.0.0.0 --port 60101
```

### 管理脚本（Linux/macOS/Git Bash）

```bash
bash shell/backend/start.sh | stop.sh | restart.sh | status.sh
bash shell/frontend/start.sh          # 生产模式：build + preview
bash shell/frontend/start.sh dev      # 开发模式
```

---

## 修改代码的规则

### 硬性规则

1. **前端发请求只走各能力包 `api.js`（底层 `src/shared/client.js` 的 apiFetch，会话 Cookie 认证）**：新增接口调用就往对应模块 api.js 加函数。禁止在组件里出现 `btoa(`、裸 `fetch(`、硬编码 `:60100`（豁免：登录流三处——App.jsx AuthGate / LoginPage / 门户登出可用裸 fetch + `API_BASE`，因 apiFetch 的 401 兜底整页跳转会与 SPA 路由守卫冲突）
2. **后端响应统一走 `api_response`**（`app/shared/response.py`），新接口必须挂 `Depends(require_basic)`（免认证端点显式豁免：sdklogs 摄入 / diary share / apihub gw / 图片下载）
3. **新后端行为必须带测试**：在 `backend/tests/` 加用例（conftest 提供隔离的临时 SQLite，无外部依赖）
4. **SQLite 连接保持现状**：WAL + busy_timeout 已配好；不要引入需要单独迁移服务的东西
5. **不新增重量级依赖**；确需新增时同步更新 `requirements.txt`/`package.json` 并在本文件"关键事实"里注明坑（如 pwsvc 的 `cryptography` 仅用于 seed AES-256-GCM 落盘加密，推导本身只用标准库 hmac/hashlib)

### 渲染管线（`src/md.js`）修改注意

- 改 GitHub Alert/图片/fence/`==mark==` 规则后，用仓库演示文章《Markdown 语法完全指南》（post id 以线上为准）在浏览器过一遍全要素
- emoji 只有 light 词典（150 个）；别在文档里宣称支持 `:+1:` `:rocket:` 等

---

## 验证清单（每次改动后执行，全过才算完成）

| 改动范围 | 必做验证 |
|---|---|
| 后端 | `pytest tests/ -q` 全过；重启服务后 `curl http://localhost:60100/health` |
| 后端 API | 用 curl 过一遍改动的接口（含错误分支）；涉及树/slug 的验证级联正确性 |
| 前端 | `npm run build` 零报错；UI 档位遵循 `docs/ui-baseline.md`；浏览器走查首页/详情/新建/编辑四页 |
| 渲染 | 演示文章页检查：mermaid 出图、KaTeX、代码块高亮/行号、GitHub Alerts 无标记泄漏、图片加载 |
| 图片/路径安全 | 越界路径（`C:/Windows/win.ini`、`../`）→ 404，`data/images/` 内正常文件 → 200；上传：正常 png → 200 且 URL 可取回，svg/空文件 → 400 |
| 双链/导出 | 双链三种写法渲染 + 未找到置灰 + 代码块豁免；反链列表正确；导出 zip 解包含 frontmatter/嵌套目录/images 且图片 URL 已重写 |
| 数据库切换 | 配置页 `/config`（或 `/admin`、curl）：测试连接 → 切到空 PG（应只剩默认库 0 文章）→ 切回 sqlite（原数据原封不动）→ 日志确认两次 uvicorn reload（`WARNING: WatchFilesReload detected changes` 或进程重启行） |
| 知识库 | 首页选择器新建库 → 在新库发文章 → 默认库不可见 → 详情侧边栏仅同库文章 |

---

## 📌 文档同步规则（联动更新，强制）

> **核心规则：代码与文档在同一批改动里更新。没有"以后补文档"——收尾时文档必须与代码一致，这是验收的一部分，与测试同等重要。**

### 变更 → 文档 映射表

| 你改了什么 | 必须同步更新 |
|---|---|
| 接口新增/删除/参数/响应字段/错误码 | `api.md` 对应小节（含示例）；若影响使用方式，`README.md` 的 API 概览表 |
| 数据库切换/双后端行为/迁移逻辑 | `api.md` 管理端章节 + `backend.md` 第 3.5 节 + 管理页（`frontend.md`） |
| 知识库行为（隔离/唯一性/排序归属） | `api.md` 知识库与文章章节 + `backend.md` 第 3/4 章 + `frontend.md` 对应页面小节 |
| 后端模型/树设计/数据库切换/中间件/安全逻辑 | `backend.md` 对应章节；若属"已知限制"的修复，删除对应条目 |
| 后端配置项、端口、依赖 | `README.md` 配置表；依赖坑写进本文件"关键事实" |
| 前端 api.js、渲染管线、页面结构、构建方式 | `frontend.md` 对应章节 |
| 测试结构/conftest 行为 | `backend.md` 第 12 节 |
| 启动/部署方式、shell 脚本 | `README.md` 快速开始/生产部署两节 |
| 新增已知限制或技术债 | 对应架构文档的"已知限制"节 **和** `README.md` 的"已知限制"节（两处都要） |
| 常用命令/验证流程/关键事实变化 | **本文件（AGENTS.md）** |

### 执行约定

1. **开始改代码前**：先读对应文档小节，确认文档描述与代码现状一致（发现不一致 = 先修文档再动手）
2. **收尾自检**：对照映射表逐项检查，`git diff` 里代码与文档改动应在同一批
3. **写文档的标准**：只写**当前真实行为**（最好有实测依据），不写愿景；过时内容直接删除或移入 `backend-prompt.md` 式的历史标注，不留"两套说法"
4. **示例优先**：API 文档的示例应来自真实响应（curl 实测），不要手编

---

## 已知未修复问题（接手时注意，避免误判为新 bug）

1. AuditLog 无清理策略
3. 移动子树不重算子孙 `level` 列（slug 已级联，level 陈旧仅影响展示）
4. 前端无 404 兜底页（`/archive` 死链的导航入口已移除，路由仍未注册）
5. 生产模式下数据库切换需手动重启；切换期间的并发写入可能丢失（单用户可忽略）

修复以上任一项后：从本列表和 `README.md`/`backend.md`/`frontend.md` 的"已知限制"中**同时移除**对应条目。
