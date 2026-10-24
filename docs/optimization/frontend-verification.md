# 前端优化与验收记录

本记录覆盖公共前端、工作台、系统配置、Vault / 密码服务、剧情图谱与开发工具箱。知识库和平台模块的业务接入、后端全量回归、HTTP 吞吐与依赖审计由对应验收记录补充。基线是 `.ui-qa/optimization/baseline-75d4295eac1446b98e707d170bf89440`，保留该快照之前的用户修改，包括侧栏折叠图标和思维导图改动。

## 已实施的公共能力

| 能力 | 实现与边界 |
|---|---|
| API 客户端 | `ApiError` 保留 HTTP 状态、业务错误码、冲突详情、trace 与原始 cause；成功响应含坏 JSON 时明确失败。仅 401 跳转登录并保留 query / hash。外部取消与 dataEpoch 取消覆盖读取响应体的阶段。 |
| 数据源隔离 | 缓存 / 草稿按已认证用户名与数据库 identity 命名；QueryClient 统一管理并在 epoch 变化后取消、清空。每个业务请求发送预期 identity，服务端拒绝不匹配的数据源；旧页面显示提示并保留输入，后续请求被阻止，用户明确重载后才接受新上下文。 |
| 保存协调器 | 资源级单写者，合并后续输入，保持 revision / mutation ID。只有服务端明确支持幂等才自动重试未知结果；409 停止写入。草稿包含未知结果的在途 mutation，配额错误显式可见。卸载取消请求 / 退避，保留草稿。敏感模块可以不接持久化插件。 |
| Worker | 任务 ID、超时、AbortSignal、Worker 终止、过期结果丢弃；正则回溯可真正终止。 |
| 编辑器 | CodeMirror 6 通过 adapter 按需加载，语言扩展独立加载；保留 selection / undo，提供保存、失焦、粘贴 / 拖放与旧 textarea 选择、滚动接口。超过 100 万字符禁用语法装饰，正文仍可编辑。 |
| 长列表 / 轮询 | TanStack Virtual 可变高度、容器 / 窗口滚动与 imperative listRef；轮询单飞、隐藏暂停、显示恢复、卸载取消。共享时钟只保留一个计时器。 |
| 模块组织 | module manifest 统一路由识别与门户元数据；公共 UI / SVG charts 从 Todo 移入 shared，旧入口 re-export 兼容；路由错误边界与 404。 |

身份切换不会自动覆盖旧页面内容：跨标签切库触发固定提示，旧输入仍可复制或导出。业务持久化草稿只保存各模块授权内容；Vault 解密条目、VEK、主密码和 HIBP 完整哈希不进入持久缓存。

## 模块行为

工作台以服务端 revision 为准，未收到响应的同一 mutation 可安全重放；恢复默认会等待队列排空，再执行 DELETE，期间拒绝新布局提交。草稿恢复重新生成前端分组临时 ID，不依赖服务端分组 ID。保存状态与草稿存储错误分别显示。

数据库切换移除固定 3500ms 等待。前端最长等待 45 秒，检查 `running_backend`、`identity`、`generation` 和 `pending_restart`；只有确认目标后端生效才更新上下文。请求失败、待手动重启和确认超时均有明确反馈。验收切库流程使用本地响应模拟，没有修改生产或 QA 真实数据库配置。

Vault 的 Argon2id 参数保持 `t=2,m=32768,p=1`，解锁沿用账号保存的参数。KDF 在专用本地 Worker 执行，一次只允许一个任务，超时 / 锁定时终止。VEK 维持不可导出 CryptoKey；有限并发解密按批让出事件循环，session generation / AbortSignal 拒绝锁定后的所有旧结果。附件子视图还在换条目 / 卸载时废止 scope：延迟文件读取或加密完成后不能继续 POST，旧附件响应不能填入新条目。失败保存保留编辑器。外部站点图标默认关闭，开启后才发送域名；HIBP 仅发送五位哈希前缀，缓存仅驻内存，锁定取消当前请求并停止启动后续队列。剪贴板清除只操作本模块仍拥有的内容。

密码服务沿用原后端推导算法。用户行借共享时钟计算倒计时，在密码有效期内不逐秒请求后端，过期或策略变化后再取值；日志明确展开后才查询、分页和虚拟渲染。切换项目会取消旧查询，旧项目响应不能填入新项目。

剧情图谱保留自绘 SVG 边与非 StrictMode。几何缓存维护关联边和空间网格，节点移动只重新计算受影响边 / 标签，平移缩放仅改变 SVG transform。透明命中层位于 React Flow renderer 内，鼠标在边上滚轮也能交给 ZoomPane。位置写入章节 CAS 批量接口，聚合视图多章节在同一事务提交。未确认草稿必须选择恢复、放弃或下载；不会在读取时自动覆盖服务端，恢复前阻止节点移动。冲突保留本地坐标并停止自动覆盖。

开发工具箱的 JSON、文本差异、正则、CSV、统计、逐行变换、Base64 和 Unicode 运算移到 Worker。输入预算 10 MiB；JSON 超过 100 万节点 / 2048 层或预计 50 MiB 输出时明确报错；正则 UI 使用 1500ms deadline 和 500 匹配上限。jsdiff 差异仍返回完整预算内结果，并虚拟渲染；超预算不静默截断。JSON 任意键名、CSV 下标数组、引号 / 换行和 UTF-8 经专项回归。

## 可复现验证

在 `frontend/` 执行：

```powershell
node --test tests/optimization-shared.test.js tests/optimization-client-crypto.test.js
$testFiles = @(rg --files tests | Where-Object { $_ -match '\.test\.js$' })
node --test @testFiles
node tools/compare-frontend-lint.mjs ../.ui-qa/optimization/baseline-75d4295eac1446b98e707d170bf89440
npm run build
node tools/test-optimization-frontend.mjs
node tools/test-optimization-faults.mjs
node tools/test-optimization-vault-cancellation.mjs
```

浏览器脚本需要 `PLAYWRIGHT_MODULE_PATH`、`BROWSER_PATH` 和专用 QA 服务。脚本在登录之前断言 `API_BASE=''`，写入之前断言 `data_dir` 属于 `browser-db-3`；浏览器网络只允许本机 60111 / 60113 / 60115，拒绝 60100 与外网。测试夹具包含 250 个真实密文 Vault 条目、30 节点 / 45 关系图谱、以及其他模块批量数据。测试命名、隔离数据与可视化截图不会写入生产。

该批功能与构建验证记录（**不包含最终性能验收结论**）：整个前端 `tests/` 的 7 文件 **52 / 52**（含负责范围专项 25 项）；114 个负责前端文件相对基线的 ESLint 规则计数增量为 0；当前生产构建与基线原锁文件独立生产构建均成功。日志为 `frontend-final-tests.log`、`frontend-final-build.log`、`baseline-final-frontend-build.log`。真实 Chromium 常规流程 22 / 22 项检查、故障注入完整流程 12 / 12 项检查，另有 Vault 队列 / 附件取消 4 / 4 项检查，均无未捕获页面错误、无被阻止的外网请求。保存错误只显示在当前 Vault 编辑器，取消编辑后不遗留全局错误。仓库原有规则告警没有被算作新问题；仅针对 TanStack 当前 API 的 compiler 警告、外部 store 快照的显式失效依赖保留定向解释。构建仍报告原有 `stream` 浏览器外部化和超过 500 kB 的 chunk，不能据此声称所有页面首次加载已变小。

完整浏览器结果在 `.ui-qa/optimization/frontend-results.json`，故障注入结果在 `frontend-faults.json`（`scope=full, passed=true`），截图分别在 `frontend-shots/` 与 `frontend-fault-shots/`。全部故障运行原始结果按时间保存于 `frontend-fault-history/`，局部复现使用单独的 `frontend-faults-gamemap.json`，不会覆盖完整汇总。最终重新运行的结果时间与计数以这些 JSON 为准。

真实故障流程覆盖：保存已提交但响应丢失、保存中重置、切库就绪超过旧 3.5 秒时限、503 与 401 的认证区别、跨标签数据源不匹配仍保留编辑输入、Vault 400 保留输入、密码服务有效期内不重复取密和按需日志、图谱草稿明确恢复 / 下载 / 放弃、CAS 409 停止重试、600ms 键盘防抖前离开页面保留最终坐标。浏览器辅助脚本通过 Vite 实际资源 URL 获取有状态 singleton，避免 HMR 时间戳产生第二份测试上下文；这不改变生产模块行为。

`vault-cancellation-results.json` 另记录三个挂起请求的 HIBP 队列在锁定后不再启动剩余任务、锁定期间延迟文件读取释放后附件 POST 数为 0、切换条目后旧文件读取释放仍无 POST。七个独立密码的密文只在浏览器响应中替换，HIBP 请求完全本地 fulfill，没有访问外网或改变服务端夹具；附件与安全中心明暗截图在 `frontend-fault-shots/`。

## 几何性能与 ELK 试验

`tools/bench-optimization-graph.mjs` 对 100 / 500 / 1000 节点、每节点三条边进行 production build，使用同一份当前依赖分别运行旧 / 新几何实现。全部节点和边挂载，包含 200×140 minimap，真实鼠标拖动、平移与 Control 滚轮；验证节点坐标、边路径、viewport 确实变化。暖机排除，三个测量轮次交替顺序。记录 rAF 分布、长任务、heap 与鼠标松开后两个 rAF 反馈时间。该实验隔离几何算法，不能当成整应用旧依赖与新依赖的性能对比。

旧实现来自基线 `frontend/src/gamemap/board/shared.jsx` 第 175 行至 EOF（280 行内容、末尾换行）。原文件 SHA256 为 `19f9eaef793c9610c9650f80afda912c3e104ada61644da3dec121ce715edd2c`，规范化 CRLF 后摘取 SHA256 为 `00b95fe24fa69fdd785f4bdf385f81fad6524ca2b54695166c33c01c1f3731a5`。工具仅加两行说明与 RF import，并在每次启动断言摘取完全相等。构建前和测量后保存全部输入 hash，任何变化都会使结果无效。最终一轮样本记录于 `.ui-qa/optimization/graph-performance.json`；早期受同机负载影响的样本另存 `graph-performance-contended.json`，不与本轮混合统计，也不以开发模式 smoke 推导帧率承诺。

最终一轮于 2026-10-21 03:06–03:10（Asia/Shanghai）完成，共 18 个样本，`sourcesUnchanged=true`、`failures=[]`。本轮我方未并行其他测试，已知的旧 timeline 基准已自然退出；未采集全主机 CPU 指标，不能据此宣称硬件独占或排除所有背景负载。hash 一致只证明代码未变。环境为 Windows、i5-11400、Chromium 124、1600×1000；下表为本轮每组 3 次中位数，fps 是手势期间 rAF 观测频率：

| 节点 / 边 | 初始化 ms 旧 → 新 | 拖动 fps 旧 → 新 | 拖动 p95 帧间隔 ms 旧 → 新 | 平移 fps 旧 → 新 | 松手后两个 rAF ms 旧 → 新 |
|---|---:|---:|---:|---:|---:|
| 100 / 300 | 288.7 → 241.4 | 60.0 → 60.0 | 16.7 → 16.7 | 60.0 → 60.0 | 34.1 → 21.1 |
| 500 / 1500 | 1393.2 → 845.6 | 21.9 → 58.7 | 116.7 → 16.8 | 22.9 → 47.3 | 132.9 → 25.8 |
| 1000 / 3000 | 4568.3 → 1634.3 | 6.4 → 43.1 | 533.3 → 50.0 | 6.5 → 36.3 | 511.1 → 36.1 |

本轮 500 节点拖动中位数为 21.886 → 58.713fps，1000 节点为 6.418 → 43.113fps；1000 节点拖动与平移仍未达到 60fps。这些是同依赖、固定夹具和单设备的观测，不能保证任意数据 / 设备达到相同改善幅度或帧率。p95 指 rAF 帧间隔，不能等同 JavaScript 单次计算耗时；松手指标是 pointerup 后等待两个 rAF 的观测间隔，包含调度和自动化等待，不能当作端到端输入延迟。初始化为该 harness 到 ready 的计时，不能视为业务路由首次可交互指标。1000 节点初始化 JS heap 中位数约从 77.0MB 降至 56.1MB，但 100 节点约从 8.65MB 增至 10.59MB，不能宣称所有规模的内存均下降。这仅反映 `performance.memory.usedJSHeapSize` 的单点读数，不是峰值、强制 GC 后存活量或整个进程 / GPU 内存。该图谱脚本只验证到 1000 节点，未覆盖更大规模、所有真实布局、图片和长期会话；思维导图模块的 5000 节点测试不能替代本画布验证。

ELK 0.12.0 已用官方 Worker 做 100 / 500 节点试验。按当前直线边口径，交叉数分别从 5264 降至 3793、128785 降至 115752，均无节点重叠；耗时约 0.78 / 3.72 秒，500 节点包围盒面积约扩大 18 倍。Worker 阶段没有测得主线程长任务，但 fit-to-view 可读性代价明显，因此没有加入生产依赖。原始坐标、帧记录和版本 / 许可 / hash 在 `.ui-qa/optimization/elk-poc/results.json`；将来若引入正交路由可单独重新评估。

## 生产体积与未启用插件证明

`npm run build -- --manifest` 分别在当前目录和基线自有 `node_modules` 执行。基线保持原 lock 与 Vite 8.0.11，当前为升级后 lock 与 Vite 8.3.4。`tools/audit-optimization-chunks.mjs` 统计两个 manifest 的静态闭包，并额外生成当前生产产物到内存；**所有生成 JS 的 SHA256 与普通磁盘生产构建逐文件相同**，再检查实际 rendered module IDs 和 entry 的静态 / 动态可达图。结果保存于 `.ui-qa/optimization/frontend-bundle-comparison.json`。

在全部当前 rendered chunk 中，`quill`、`simple-mind-map/src/plugins/RichText.js`、`Formula.js` 和 simple-mind-map 内嵌旧 KaTeX 模块均为 **0**；实际用于 Markdown 的 KaTeX 为 **0.19.0**。最终依赖审计仍有 **2 条 low**（Quill 与父 SimpleMindMap 传播报告，见 `docs/optimization-dependencies.md`）。模块证明只说明上述目标模块没有进入该次生产产物，不把 node_modules 中仍安装的传递依赖说成已删除，也不把剩余报告自动视为整体风险为零。

以上结论只覆盖该次构建产物；后续改动插件注册或构建依赖，需要重新生成模块图。包体统计不等同加载耗时，也不替代独立的运行时性能验证。

体积存在明确代价（逐文件 gzip、十进制 kB，不代表网络时延）：

| 口径 | 基线 gzip kB | 当前 gzip kB |
|---|---:|---:|
| 所有 JS（含所有 lazy / Worker，非一次页面加载） | 2341.9 | 2653.8 |
| 初始 entry 静态 JS 闭包 | 82.3 | 89.9 |
| 工作台冷 entry + 页面静态闭包 | 107.3 | 116.8 |
| Vault 冷 entry + 页面静态闭包 | 390.4 | 403.1 |
| 图谱冷 entry + 工作区静态闭包 | 490.0 | 499.5 |
| 思维导图 adapter 冷 entry + 静态闭包 | 206.3 | 215.0 |

不能直接比较 adapter 单一 chunk：新构建会把原有公共 chunk 合并，且某些路由静态依赖已加载的 entry，必须去重后比较。排除 entry 后的图谱增量为 407.7 → 409.5kB，思维导图 adapter 为 124.0 → 125.1kB。新增 CodeMirror / Lezer 所在 lazy chunks 合计 201.3kB gzip，是总包约 311.9kB 增量的主要成本；语言按需加载，编辑器不会全部塞入首屏。初始静态 JS 闭包 gzip 82,302 → 89,947B，增加 **7,645B**；全部生产 JS（含 entry、所有 lazy / Worker）gzip 2,341,947 → 2,653,836B，增加 **13.3%**，后者不是首屏传输量。公共 QueryClient、认证 / 数据源隔离与恢复边界带来入口成本；本轮不宣称全站包体减少。
