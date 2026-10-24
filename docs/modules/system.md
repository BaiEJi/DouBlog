# system + shared 模块

本文覆盖系统管理、门户、认证、公共请求执行与应用生命周期。接口完整索引见根目录 `api.md`；本轮验收记录见 `docs/optimization-execution.md`。

## 数据库与任务归属

每个应用的 `app.state.db_runtime` 持有独立 engine、scoped_session、稳定 `identity`、本次启动的 `generation`、在途计数与写入屏障。`db.engine`、`db.session` 和 `Model.query` 优先解析 ContextVar 绑定；请求由纯 ASGI 中间件绑定所属应用。没有绑定时保留最近初始化 runtime 的同步兼容入口，供脚本与旧测试使用。

`run_db(fn,*args,_pool=None,**kwargs)` 在提交时捕获 runtime，计入排队与执行中的任务，在实际工作线程清理同一个 registry。清理前用 `runtime.sessions.registry.has()` 检查该线程是否已有 Session；已有时仍按 `try rollback() / finally remove()` 执行，即使回滚异常也移除会话，没有时跳过，避免纯缓存或仅 `engine.connect()` 的函数因清理而创建空 ORM 会话。Core 连接仍由函数自己的上下文关闭。Future 完成或排队取消时释放 admission，已经运行的线程在HTTP取消后仍保留ticket，直到实际执行及会话清理完成。默认使用 SDK 的 `doublog-db`（16 workers、512 在途上限、满载503）。配置中心可指定自己的 SDK 池隔离 Redis 等待。创建另一个 app 不再 dispose 第一个 app 的连接；嵌套创建应用也临时清除调用方数据库绑定，再用新runtime执行全部迁移。

后台模块必须在 `database_context(app)` 中执行，不能在执行时重新寻找全局最新数据库。后台执行仍使用 lizysdk 模块命名池；结构性调度/单写者线程允许保留。`run_blocking(module,fn,...,workers=N)` 提供带 context 与限长 admission 的通用阻塞任务入口。模块池注册受锁保护，进程退出统一回收；单个 app 的退出不会关闭其他 app 正在使用的共享池。

建库顺序：存量表 RENAME → create_all → 模块迁移 → 虚拟根/默认数据 → SQLite WAL 校验。必需模块导入或迁移失败会使启动失败。SQLite 每连接 busy_timeout=5000、synchronous=NORMAL、cache_size=-20000、temp_store=MEMORY。

## 认证

`system_accounts` 保存 PBKDF2-SHA256 200000次迭代与随机盐的哈希。配置中的默认用户名/密码只用于空库首次播种；存储不可用返回503，不能回退到默认密码放行。

会话 Cookie 优先、Basic 兼容。Basic 校验和登录的 PBKDF2 在限长 `doublog-auth` SDK 池（4 workers）执行。会话 HMAC 快速路径保持不变：`user.exp.sig`，从右侧拆分最后两段，签名/过期校验通过才放行；Cookie HttpOnly、SameSite=Lax、30天、本地HTTP部署未强制 Secure。改密使旧 Basic 密码失效，既有签名 Cookie 仍遵循有效期；需要撤销全部 Cookie 时轮换 secret_key。

- `POST /api/auth/login`：JSON凭据或Basic头，成功设置最终 Response 的 Cookie。
- `GET /api/auth/check`：返回真实 Cookie/Basic 用户 `username`、`authenticated`、`database_identity`、`generation`。
- `POST /api/auth/logout`：幂等清Cookie。
- 401使用统一信封，不附 `WWW-Authenticate: Basic`，避免浏览器额外弹框。

AuthGate 共用去重校验与身份命名空间，只有401视为登录失效；网络/503提供重试状态。业务挂载前设置用户/数据库 scope，切换时中止旧请求并清理共享查询缓存。公开分享、登录等免认证入口单独放行。未知前端路径显示404，页面加载异常有错误边界。

所有 HTTP 响应附 `X-Database-Identity`、`X-Database-Generation`；正常请求还附 `X-Trace-Id`。身份是隐藏密码后的数据库URL的SHA-256前24位，generation每次app创建重新生成。它们不包含连接密码。CORS允许前端60101的凭据请求，并暴露这些响应头；隔离验收使用相对API地址走同源代理。

现代客户端在业务请求中发送`X-Expected-Database-Identity`。身份不匹配时中间件在业务执行前返回409（`DATABASE_CHANGED`与实际identity/generation），读写请求均受保护；认证、探针和GET数据库/运行状态入口可继续访问以恢复。前端停止旧请求并保留当前未保存输入，显示备份后重新加载提示，不直接把旧草稿提交到新库。未带该头的旧客户端仍兼容。

## 数据库配置与切换

三接口仍为 `/api/admin/database`、`/test`、`/switch`。切换只改变连接配置，不复制数据；新进程读取目标库，空库自动建表播种。原有 switch 成功响应保持 `{backend,restart_required}`。

状态额外返回 `identity`、`generation`、`running_backend`、`pending_restart`、pending任务计数。`backend` 表示配置目标，不能据此认定运行连接已切换。`postgres` 不返回密码，`password_configured` 表示是否已保存密码；请求不提供新密码时保留原值。

切换先验证目标、串行取得切换锁，设置屏障，等待已接收的数据库任务以及模块耐久写入 drain，停止后台资源后才原子发布配置。同目录临时文件 fsync+replace，失败保留原文件。排空失败不发布配置；停止失败保留屏障并返回503，要求重启后端，防止半停止状态继续接收业务。恢复配置为当前运行库时可重新启动已停止资源。

屏障期间业务请求503，状态、认证和切换入口仍可用。开发模式通过重载戳触发重启；生产模式仍需手动重启。前端最长45秒轮询实际 running_backend 与 pending_restart，不再固定等待3.5秒后宣称成功。目标PG不存在时可创建数据库；test接口也保留该原有行为。

`GET /api/admin/runtime` 需认证，返回数据库任务/屏障、SDK池快照、模块列表与后台状态。runtime额外含admissions_paused与pending_controls；pending_tasks计工作单元，一个HTTP请求及其worker可以各有ticket，并非唯一请求数。`GET /health` 是廉价存活探针；`GET /ready` 需认证，检查实际数据库和启动状态，未就绪503。

## 应用生命周期

短HTTP请求在读取body前取得ticket，覆盖慢上传及非DB写入者；数据库切换控制请求与长连接SSE单独处理。显式绑定runtime的`run_blocking`也在Future最终完成后才释放ticket，防止HTTP取消后文件IO等任务越过停机屏障。system-config控制任务单独计数，切库不等待自身，停机仍等待全部控制任务。Basic认证按只读任务计数，待重启期间仍可认证并恢复配置。

资源在构造时初始化以兼容同步脚本与旧测试；lifespan重入/退出转换通过SDK工作线程中的锁串行执行。最后一个使用者退出时，在总计5秒预算内先封闭新admission，再等待业务及控制任务，随后drain写入水位、stop后台资源，最后dispose自身engine。超时不提前停掉仍有生产者的writer或销毁engine，保留围栏、未完成资源和`shutdown_error`；之后重入先重试清理，再恢复服务。模块可导出幂等 `drain_background(app,timeout=5.0)` 与 `stop_background(app,timeout=5.0)`；返回False表示未完成。创建新app、关闭旧app与关闭进程是三个不同边界。

公共启动入口也登记仅有 `stop_background` 的惰性资源模块（如 Confcenter），不创建额外线程。普通启动钩子成功后才登记，已登记模块不重复启动；停止按模块反序执行，成功才移除登记，失败保留以便重试。`tests/system/test_lazy_resource_lifecycle.py` 经真实 lifespan 和数据库切换路径验证 Redis 只关闭一次、缓存/限流状态清理、多 app 隔离及重入重建，并覆盖启动失败和停止失败后的登记语义。

日志设置可重复执行，LogRecord上下文工厂只安装一层，避免每次保存配置增加递归包装。日志配置同样原子写入。

## 门户布局

表：`system_home_groups`、`system_home_cards`、`system_home_state`、`system_home_mutations`。状态单行revision从0开始，空布局/恢复默认也保留版本。

- `GET /api/home/layout`：`{groups,revision}`。无自定义布局时groups为空。
- `PUT /api/home/layout`：groups整体替换；现代客户端带revision、mutation_id。
- `DELETE /api/home/layout`：可带revision、mutation_id的JSON体，清布局并递增revision。

SQL条件更新版本、分组/卡片替换、幂等回执在同一事务。相同mutation与相同请求重试返回首次结果；复用ID但改变内容409；旧revision409，不能覆盖重置后的状态。保留不传revision的旧客户端兼容写入。前端保存协调器串行确认，reset先建立队列屏障；失败保留输入。

GET使用一条outer join读取revision、分组与卡片，确保它们属于同一已提交快照，避免多条SELECT在并发写入时混合内容与版本。

该固定Select经懒初始化仅构建一次，保留模型延迟导入；每次仍由当前runtime的db.session执行并重新拼装完整JSON，不缓存Engine、Session或布局结果。双app相同ID不串库，关闭一个app不影响另一个，提交内容/revision后下次读取可见；专项见tests/system/test_home_expression.py。

布局上限20组、每组60卡，组名64字，标题120字、描述300字；key小写字母开头、字母数字下划线短横线、最多40位、全布局唯一。title/desc null沿用默认文案，卡片未知key由前端过滤。

## 公共前端组件

- `ApiError/readEnvelope/apiJson`：统一结构错误、trace和AbortError，读取响应体时也校验dataEpoch。
- `saveCoordinator`：每资源一个在途请求，未确认请求复用mutation ID，冲突停止自动写，身份/数据库草稿隔离。
- `usePolling`：单飞、隐藏页面暂停、卸载取消、退避。
- `CodeEditor`：CodeMirror6适配，事务、撤销、只读、语言扩展和主题；旧textarea引用通过桥兼容。
- `VirtualList`：TanStack Virtual，动态行高、滚动容器和可到达末行。
- `workerTask/compute`：任务ID、截止时间、取消、超时终止；差异、正则和大JSON在Worker计算。
- `shared/ui`：通用组件，todo旧入口保留reexport兼容。

## 验证与已知边界

`tests/system/test_system_optimization.py` 覆盖双app隔离、取消清理、原子文件失败、门户CAS/幂等/reset、失败排空与停止屏障、认证存储失败、lifespan重入。`tests/system/test_run_db_sessions.py` 覆盖纯缓存/Core-only 任务不创建 Session、实际数据库事务在成功/失败时回滚并移除精确工作线程 registry、回滚异常仍移除，以及运行中取消直到真实清理完成才释放 ticket。`tests/system/test_home.py`、`test_admin.py` 包含真实临时PostgreSQL往返。全量回归与浏览器/性能最终证据以实施记录为准。

后台线程无法强制中断任意Python阻塞调用；各模块需对网络/执行设置自身截止时间，失败状态必须可见。生产切库仍依赖重启。签名Cookie没有逐设备撤销列表。布局旧客户端不传revision的兼容写没有跨标签页冲突保护。
