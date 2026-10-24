# 全模块优化实施与验收记录

> 交付复核更新：Confcenter惰性清理钩子的公共登记已修复，6项新增回归及新版930项全量均通过。eb12冻结源码的完整五轮固定CPU对照已完成：126,768次成功、0错误，16项吞吐增加、6项下降；严格性能门槛仍未通过。修复前cbcc被中止的部分数据不可验收。

本轮按已审阅技术方案实施。主要实现、全量回归与浏览器验收已有证据；严格性能门槛尚未全部满足，不能把功能通过等同于所有性能门槛通过。[请求路径诊断](optimization/request-path-diagnostics.md)确认的窄优化和后续生命周期修复已纳入最终930项回归，冻结源码为`eb12ae5c29841ecc4d3bbe8cf56c29e6970bcd0f087fe3d37ddff0cac690cf20`。最终HTTP与全量测试的源码、依赖指纹由报告生成器交叉核对。

## 固定基线

- 修改前源代码复制至 `.ui-qa/optimization/baseline-75d4295eac1446b98e707d170bf89440`，811 文件。
- 清单 SHA-256：`17ef2d35e646750bc1688a18861f93cb7506287badd8a1c2863e891dfcc6f080`。
- 修改前全量后端：772 passed，包含真实临时 PostgreSQL。
- 保留此前思维导图及用户未提交改动。本轮不修改密码派生/加密算法与订阅金额口径。

## 范围与完成条件

| 范围 | 实施内容 | 验收门槛 |
|---|---|---|
| 公共数据层/登录 | 每 app 数据库 runtime、提交时绑定会话、限长 SDK 池、认证计算移出事件循环、原子配置、drain/stop/readiness | 双 app 并发隔离、取消清理、退出重入、切库失败保留配置、SQLite/PG |
| 公共前端 | API错误/取消/dataEpoch、保存队列、轮询、Worker、CodeMirror/Diff/VirtualList、路由清单/404 | 单测+构建+浏览器；过期响应、超时、冲突和草稿隔离 |
| Blog/资产 | 服务端分页/链接投影/层级、列表与历史元数据投影、批量导出、完整差异 | >2000 数据、N+1计数、移动/改名/删除、正文不混入列表 |
| 日记/书签 | 日记 CAS/幂等保存与分页、书签限长流式获取/提取/导入 | 重试不重建、失败保留草稿、FK删除、慢响应/超限/固定语料 |
| Todo/Practice/Subs | SQL CAS/计划唯一、练习聚合原子编辑、服务端完整统计/分类分页/时区 | 并发、部分失败回滚、既有规则与 Decimal 金额/闭区间回归 |
| 日志/APIHub | 行/字节队列、水位flush、SQL直方图、分批导出；配额预留/退款、重试边界、writer drain | 溢出、落库失败、关闭、>10万统计、POST超时不重发、并发配额 |
| 配置/Clash/Steam | Redis恢复围栏与原子更新、阻塞IO隔离、配置缓存/原子文件、生命周期与完成态 | 故障恢复不复活旧值、无重叠轮询、fake worker/CM、进程退出预算 |
| 门户/总配置 | 布局CAS/幂等与重置屏障、切库状态按实际runtime确认 | 延迟保存/重试/重置并发、拒绝旧版本、重启状态 |
| 剧情图谱 | incident-edge/几何缓存、空间索引、批量位置CAS | 多章原子回滚/重试、真实画布节点/关系与拖动性能 |
| Vault/Pwsvc/工具箱 | KDF Worker/解锁代次、有限并发/虚拟列表、HIBP内存缓存；危险正则/JSON/Diff Worker | 加密golden不变、锁定后迟响应不回填、Worker终止、完整diff |

## 统一验收标准

1. 模块专项后，全量后端测试包含真实临时 PostgreSQL；原表迁移幂等与旧API兼容。
2. 前端所有新增单测、生产构建，思维导图既有保存/几何回归。
3. 使用隔离测试库与本地mock，对实际修改页面进行明暗主题截图和交互验收；不触达生产数据。
4. 冻结最终 source SHA，按相同固定种子、认证方式、并发与缓存策略进行至少三轮 A/B。只统计成功业务响应，报告错误数与真实 p50/p95。
5. 核对包精确版本、许可证、依赖审计，更新模块及根文档。未通过项继续处理，不用空列表或错误响应冒充吞吐提升。


## 当前已完成的功能验收（2026-10-21）

| 检查 | 实际结果 | 原始证据 |
|---|---|---|
| 后端完整回归 | 930 passed，0 failures/errors/skipped；8个worker，pytest总耗时356.00秒（JUnit suite为355.949秒） | `.ui-qa/optimization/backend-full-final.xml`、同名log及`.source.json`起止冻结证明 |
| 真实PostgreSQL | 门户持久化/重启、切库往返、Practice/Assets/Pwsvc查询及书签索引幂等/列表/软删，共3项均通过，未排除 | JUnit中的`test_pg_layout_roundtrip`、`test_real_switch_roundtrip`、`test_optimized_queries_execute_on_real_postgres` |
| 前端完整Node目录 | 7文件、52/52通过 | `frontend-final-tests.log` |
| 生产构建 | 当前lock与基线原lock分别构建成功 | `frontend-final-build.log`、`baseline-final-frontend-build.log` |
| 公共前端/密码库/图谱/工具箱 | 常规22、故障注入12、锁定取消4全部通过 | `frontend-results.json`、`frontend-faults.json`、`vault-cancellation-results.json` |
| 知识域 | 18项交互，另Diff完成/预算/取消3项；明暗截图齐全 | `knowledge-browser/report.json`、`diff-report.json` |
| 平台域 | 9项交互、11张明暗截图，无页面异常 | `platform-browser/results.json` |
| 既有导图与Markdown | 导图完整浏览器13项、真实KaTeX/表格/代码回归通过 | `docs/mindmap-e2e-results.json`、`root-shots/math-result.json` |
| Lint增量 | 前端公共域114文件、知识域78文件相对基线无新增；平台定向文件通过 | `frontend-lint-comparison.json`、`knowledge-lint-comparison.json`、`platform-eslint.json` |

原始证据均位于`.ui-qa/optimization/`（导图旧E2E按工具指定目录）；[前端详细报告](optimization/frontend-verification.md)包含完整范围、取消边界、构建模块证明和已测包体成本。

回归日志保留了Starlette关于TestClient/httpx的弃用提示，以及pgserver退出时第三方SDK异步日志写入已关闭pytest捕获流的诊断；JUnit结果为零失败，无跳过。这些环境诊断没有被算成产品断言通过，也没有改动第三方SDK去隐藏输出。

前一收敛轮将Practice摘要改为所需列的Core Row、Assets分页版本计数合入存在性查询、Pwsvc两张明细先分别聚合后连接为一条SQL；纯缓存/直接连接任务不再为清理创建空Session，已有会话的事务回滚和取消清理保留。该轮新增35项专项及1项真实PG集成，形成910项全量。

随后根据实际调用采样，再加入14项回归并完成924项全量：Practice将Row映射直接交给原schema；文章列表推迟两个DTO不用的列；书签新增`(deleted_at, created_at, id)`联合索引及旧库幂等迁移，完整正文与返回数量保持；门户和Pwsvc复用固定SQL表达式，每次仍从当前runtime的Session查新数据，不缓存Engine、Session或查询结果。这些窄改的PoC、完整JSON等价边界和多app隔离见[请求路径诊断](optimization/request-path-diagnostics.md)。Vault原有的一次完整拼接保留，首末条目封装候选没有足够收益，未采用。压缩level 6、KDF和加密算法保持原参数，未采用HTTPX、ELK或线程间隔候选替换。

交付审计又发现Confcenter的stop-only惰性清理钩子未进入公共资源登记。修复前真实lifespan测试复现关闭次数0，修复后新增6项与关联23项通过。首次全量929通过、1项书签迁移并发测试在SQL前的栅栏失败；最小诊断确认与SDK懒扩容出队/idle窗口有关。测试改用两个独立SDK worker，保留原栅栏/超时和索引断言，新增不同线程ID断言；SDK本体未改。最终930项完整回归通过；原失败全量保留为`backend-full-lifecycle-failed.*`，修复前924项保留为`backend-full-cbcc.*`。前端源码在此阶段未变化。

## 性能测量的收敛记录

首轮发现文章列表、日志分页和配置读取的重复工作，已分别移除COUNT排序/大列、合并全局日志水位查询、合并配置限流与读取SDK任务。另发现两个此前导图验收遗留的孤立Chrome renderer持续占用CPU；已按精确profile/PID及退出的父进程核实后清理。原始受干扰测量仍保留为`*-contended.json`，不丢弃负值记录。

修复前cbcc源码与当时924项全量一致。第一完整HTTP轮75,991个成功业务响应、0错误，14增8降；随后两个同代码A/A控制分别41,318与41,866成功、均0错误，同样出现负中位数。两个控制的绝对吞吐高于第一完整A/B，因此预先声明重启两个服务，再以相同4秒×3轮×并发4协议做完整22场景复核，不按端点挑选结果。复测前只读核实另一DouBlog聊天已完成、此前两个Chrome PID不存在；未跨聊天发送消息，未取得硬件独占，也不知道其退出时刻或吞吐变化原因。

重启后完整轮在2026-10-21 05:24–05:33（Asia/Shanghai）完成：75,448个成功业务响应、0错误，source/tool/fixtures/dependencies结束校验均为true；18项吞吐中位数增加，4项下降。逐组整机CPU平均占用范围13.51%–35.15%。仍不能把小负值直接判为噪声，或把某轮正值泛化为任意环境的稳定收益。全部场景、两完整轮对照、A/A原值、p50/p95、压缩前后响应体字节和指纹见[性能证据](optimization/performance-evidence.md)。c479源码的73,872成功/12增10降及更早轮亦完整保留。

依据[AGENTS.md](../AGENTS.md)的“任何模块迁移/重构前后必须对照压测，吞吐不得下降；改动后全量单测回归通过”，修复前最后完整轮4个负项属于观测未达：图谱读取-0.28%、Vault列表-0.01%、Pwsvc项目-5.14%、日志检索-0.52%。没有设置5%容差、用A/A波动豁免或用正确性收益抵消结果。两完整轮之间存在符号变化，不能跨源码/跨轮挑选转正端点拼成全模块通过。

修复后eb12最终完整轮于2026-10-21 06:11–06:26（Asia/Shanghai）完成，使用与930项回归相同的源码及已安装依赖。预先固定两个测试服务到CPU affinity mask=4，客户端mask=64，本地mock mask=256；全部22场景、每版本5轮×4秒、并发4，逐轮交替，不筛选端点。126,768个成功业务响应、0错误；源码/工具/夹具/依赖与亲和性起止检查全部通过。整机每组CPU平均范围12.76%–28.42%，没有硬件独占声明。

本轮16项吞吐增加、6项下降，完整负值为：门户布局-1.68%、图谱读取-2.86%、Pwsvc项目-1.16%、日志直方图-2.73%、配置列表-1.62%、APIHub调用-1.48%。其余场景也完整列出，含每轮RPS/p50/p95、成功数、压缩前后字节。固定CPU与五轮属于新的控制条件，不能将它与旧三轮自由调度结果称为完全同协议，也不能用单场景Pwsvc的+0.78%专项抵消本轮负值。原始文件为`http-performance-lifecycle-final.json`及同名方法/亲和性证明；[性能证据](optimization/performance-evidence.md)主表仅采用本完整轮。

图谱最终18样本交互断言通过、源码冻结；500节点拖动中位约21.9→58.7fps，1000节点6.4→43.1fps，1000节点仍未达到60fps。详见[前端验收](optimization/frontend-verification.md)。首屏静态JS gzip增加7,645字节；HTML提取改善结构保真但增加解析耗时；ELK、HTTPX及线程间隔实验没有作为产品替换。

接口形态变化已在api.md列明：Diary的include_content=0排除正文，Assets历史可分页，Subs趋势默认轻汇总、details空数组，需include_details=1取旧嵌套明细。这些收益包含按需传输，不能当作完整字段等价的纯计算提速。补验确认Subs显式完整明细JSON前后完全相等、轻摘要日期/金额一致（final-payload-equivalence.json）；旧调用若依赖默认嵌套details，需要调整参数。

## 交付状态与后续条件

代码、功能回归、浏览器与组件成本证据已整理；整体性能验收仍未完成。现有观测不足以确认负值的全部原因。插桩、窄优化、同代码A/A及最终固定CPU五轮之后，仍有6项负值；公共HTTP路径静态复核未找到有足够证据的重复SQL/序列化/Session构造。Pwsvc最终窄采样显示DB成本下降，仍不能解释或豁免完整HTTP负项；不能为凑门槛删除一致性票据或盲目更换并发机制。继续验收需要更稳定的独占测试环境/时段与预先确定的测量判据，或由用户明确修改阈值。当前严格门槛保留，尚未收到验收阈值调整，不再仅重复测量后选择最好轮次。不能自行终止同机其他项目的任务，未在无人授权时跨聊天发送协调消息。

2026-10-21 06:27（Asia/Shanghai）最终核对：工作区/冻结快照/测试/依赖/JUnit/运行器指纹均与930项回归一致，见`final-integrity-lifecycle.json`。隔离端口60115/60117/60119/60125/60127均已关闭，用户后端60100健康检查及前端60101页面返回200。未登录`/ready`为401，未将其当作生产数据库认证就绪证明。证据为`service-health-final.json`，旧05:34记录保存在`service-health-before-lifecycle.json`。本轮没有提交或推送Git变更。

## 2026-10-24 主干集成

按用户“合并至主干分支”的明确指令集成本轮代码。当前工作区原已在main，远端更新核对后main与origin/main基点一致。先记录基线中已有的思维导图等先决功能，再记录全模块优化，分别保留变更归属；测试库、依赖目录及构建产物继续忽略。

合入前重新确认后端源码、测试、已安装依赖与JUnit指纹全部匹配930项冻结证据；前端52项测试及生产构建重新通过，日志为`merge-frontend-tests-20261024.log`和`merge-frontend-build-20261024.log`。本次合入不调整性能阈值，6个负项和未完成的严格性能验收继续保留。
