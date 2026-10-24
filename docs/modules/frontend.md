# 公共前端外壳（frontend 专项文档，2026-10-24）

> 本文档描述公共前端能力：启动引导/白屏恢复、认证会话边界、公共侧栏（拖动调宽/折叠窄轨）
> 与内容区加载分层。它不是新的后端业务模块——没有独立 router、数据库表或 API；
> 所有业务模块（todo/blog/gamemap…）继续使用各自的 api.js 与 `docs/modules/*.md` 契约。

## 1. 文件与职责

| 文件 | 职责 |
|---|---|
| `index.html` | 预渲染主题脚本（暗色刷新无白闪）+ 启动首帧占位（"正在打开 DouBlog…"，不依赖 Tailwind）+ noscript 提示 + 20s 启动看门狗（入口脚本失败/超时 → 可见失败卡片：重新加载/返回工作台） |
| `src/main.jsx` | 入口：静态导入 App 并调用 `mountApplication(root, App)`（RootErrorBoundary → BootProbe → App）；挂载前同步异常经 `showBootFailure` 展示失败卡片。不启用 StrictMode（gamemap React Flow 约定） |
| `src/shared/bootstrap.js` | 生产启动组合：`RootErrorBoundary`（App 整树渲染错误的最后防线，不依赖 Router）；`BootProbe`（**首次有效 commit** 的 passive effect 才 `markBootSuccess`——不把"安排 render"当作"已显示页面"，且透传 children）；`markBootSuccess` 幂等并**复位看门狗已触发的失败态**（资源晚到且成功时不残留失败卡）；`showBootFailure` 显示失败卡+原因+占位移除 |
| `src/shared/bootstrap.js` | `markBootSuccess`（幂等清理看门狗钩子）/ `showBootFailure`（占位移除 + 失败卡片）/ `bootApp(root, loadApp)`（可注入加载器的备选挂载入口，测试覆盖） |
| `src/shared/authSession.js` | 会话检查：10s 总截止时间（AbortController，覆盖响应头与 body 解析）；成功缓存 10s；并发单飞；epoch 竞态防护（旧结果晚到归为 unavailable，旧 finally 不清新请求引用）；401→`out`，超时/网络失败/5xx/坏 JSON→`unavailable` |
| `src/app/App.jsx` | AuthGate：公开路由（/login、/diary/s/*）立即渲染；本 epoch 曾确认成功的路由切换乐观放行（不再整页 fallback），仅 401 跳 `/login?next=完整路径含query/hash`；unavailable 首次为阻断卡片、已确认会话为非阻断横幅+重试（重试不复用被拒 promise）。Suspense 下移到 ModuleFrame 内容区（懒加载挂起时公共壳保持可见）。主题读写全部 try/catch（存储禁用时可挂载） |
| `src/shared/ModuleShell.jsx` | 公共外壳（见 §2）；内容错误由 ModuleErrorBoundary 在内容画布内兜底（错误卡含"复制未保存内容再重载"提示 + 返回工作台），侧栏导航保持可用 |
| `src/shared/sidebarPreferences.js` | 偏好纯逻辑（见 §2 契约） |
| `src/shared/useSidebarLayout.js` | 拖动/键盘手势（Pointer Events + pointer capture + rAF；Escape 回滚；窗口失焦/pointercancel/lostpointercapture/卸载清理；拖动中禁文本选中） |
| `src/shared/RouteLoading.jsx` | 内容区加载占位（可读文案，不用空白 div） |
| `backend/tools/frontend_qa.py` | 本模块隔离 QA 入口（verify/serve/pytest）：登记表校验、解释器精确比对+no_user_site 启动断言、导入前 settings 注入、SQLite 隔离库（默认用户空库）、回环围栏（显式拒绝 60100/60101）、默认用户凭据文件、演示数据播种 |
| `frontend/tools/test-frontend-shell.mjs` | 真实浏览器烟测（CDP；默认用户登录、侧栏行为矩阵、**Fetch 发送前白名单拦截**并本地验证阻断） |
| `frontend/tools/fault-injection.mjs` | 生产故障注入（真实故障源：入口/chunk 文件级 404、停后端、清 Cookie、存储 getter 抛错；含截图） |
| `frontend/tools/visual-capture.mjs` | 多模块可视化取证采集（12 页面状态矩阵，双拍稳定帧，状态元数据 index.json） |
| `frontend/tools/bench-frontend-startup.mjs` | 启动性能 A/B（--prepare-baseline git archive 基线构建；--mode ab 串行复用端口、独立 profile、新文档确认、冷/暖 3×5×8 场景、失败非零退出） |

## 2. 公共侧栏契约

- **宽度**：默认 220px；右边界手柄拖动或键盘调整，范围 **180–420px**；双击手柄恢复 220。折叠窄轨 **56px**。
- **持久化**：`localStorage["doublog_sidebar_layout_v1"]`，值严格为 `{"version":1,"width":220,"collapsed":false}`。width 仅存有限数字（非法类型回退默认、超界截断）；collapsed 按布尔严格解析；version≠1/坏 JSON 整体回退默认。全站共享（跨模块一致）；折叠保留"上一次展开宽度"，展开恢复该值（56 永不写入 width）。读写全部捕获存储异常，失败用内存态继续。**拖动过程中不写存储**（rAF 只改 DOM 宽度），pointerup/键盘确认/折叠切换才提交；提交由 effect 统一落盘。
- **手柄**：`role=separator`、`aria-orientation=vertical`、`aria-valuemin/max/now`（180/420/当前）、`aria-controls=module-sidebar`；tabIndex=0；左右键 ±10px、Home/End 到边界、拖动中 Escape 回到本次开始前宽度；光标 col-resize；命中区 7px。
- **底部固定操作区**：不随长菜单滚走（侧栏为固定头部 + 独立滚动菜单区 + 固定底部三段）。展开态含"DouBlog"标识、主题按钮、"折叠侧边栏"按钮（原生 button，aria-expanded/aria-controls/aria-label 随状态变化）。
- **折叠窄轨（56px）**：显示**一级菜单图标**（item.icon 优先，否则 label 首字符；title/aria-label 为完整名称，点击行为与展开态一致；激活项模块 accent 高亮）；**二级不进入窄轨**。完整菜单树 `display:none` 保持挂载——**分组展开状态与插槽状态在折叠→展开后不变**；顶部保留返回门户箭头，底部保留主题/展开按钮。
- **过渡**：宽度 150ms（`prefers-reduced-motion` 时禁用）。宽度/折叠状态**绝不作为业务子树的 key**；拖动不触发业务重渲染/请求/URL 变化。

## 3. 启动与认证行为

- 首帧：index.html 内联占位 + 主题底色（明 `#fafafa`/暗 `#0a0a0a`）在任何 JS 之前可见；入口失败由 20s 看门狗兜底（用户指示截止时间明确、有手动重试，不自动刷新循环）。
- 认证检查超时/失败 ≠ 未登录：不清 Cookie、不进自动刷新环；只有真实 401 跳登录并保留完整 `pathname+search+hash`。
- 路由懒加载挂起：公共壳先出（静态 manifest 菜单即时可见），内容区显示 RouteLoading；模块渲染失败：内容区错误卡 + 侧栏可导航；`React.lazy` 失败 promise 可能被缓存，恢复入口是真实页面重载（提示先复制未保存输入）。

## 4. QA 与运行（隔离端口：frontend 20160 / backend 20161）

**默认用户（2026-10-24 v1.1.0 起）**：QA 使用模块隔离 SQLite 空库（`.qa/frontend/data-defaultuser`）
按现有配置首次播种的默认用户（admin）——不创建替代账号、不覆盖 settings 凭据；
密码由 `frontend_qa.py serve` 写入 `.qa/frontend/qa-credentials.json` 供浏览器工具读取，
不进入命令行/报告/截图/代码。QA 严格模式（`FRONTEND_QA=1`）下 vite 启动前校验：
`VITE_API_BASE=/`、`VITE_API_PROXY` 指向本模块 20161（缺失/回落 60100/60101 直接拒绝启动）；
Python 围栏显式拒绝受保护端口；解释器与登记 conda.prefix 精确比对并要求启动即 no_user_site。

```powershell
# 后端（工作目录 = 本模块 backend/）
& conda.exe run -n dev python tools/frontend_qa.py verify --module frontend --registry <collaboration.json>
& conda.exe run -n dev python tools/frontend_qa.py serve  --module frontend --registry <collaboration.json> --seed
& conda.exe run -n dev python tools/frontend_qa.py pytest --module frontend --registry <collaboration.json>
# 前端（工作目录 = 本模块 frontend/；生产 preview，代理经 VITE_API_PROXY 指向 20161）
$env:VITE_API_BASE='/'; $env:VITE_API_PROXY='http://127.0.0.1:20161'; $env:FRONTEND_QA_PORT='20160'
& conda.exe run -n dev npm.cmd run build
& conda.exe run -n dev npm.cmd run preview -- --host 127.0.0.1 --port 20160 --strictPort
# 演示数据：todo 5 / 文章 2 / 导图 1 / 图谱 30 人物 45 关系（author=默认用户）；凭据经 .qa/frontend/qa-credentials.json
```

注意：preview 代理默认回落 `http://127.0.0.1:60100`——隔离 QA **必须**显式传 `VITE_API_PROXY`，否则违反端口白名单（本轮实测出现过 502 教训）。

## 5. 性能与体积（2026-10-24 实测）

- 入口静态 JS 闭包 gzip **93,571B**（固定基线 713744e 实测 89,947B，**+3,624B ≈ +3.54KiB**，4KiB 预算内）。增量含侧栏拖动/折叠/键盘可达、启动看门狗+根错误边界+首次 commit 探针、认证截止与信封严格校验。
- **正式 A/B 对照（v1.1.0，F06）**：git archive 固定基线 713744e 独立构建（npm ci + VITE_API_BASE=/ build），与最终候选串行复用 20160（QA 模式同代理/同端口），Edge headless 独立 profile、默认用户同库同种子、每次导航确认新文档（timeOrigin 变化）、冷/暖各 3 轮×5 样本×8 场景，0 失败/0 白名单违例。冷 ready 中位数对比：portal +0.2%、todo +0.7%（421→424ms，绝对 +3ms 噪声内）、todo-calendar +2.9%、blog 0.0%、**post-detail −9.8%（478→431ms）**、**mindmap-list −59.7%（417→168ms）**、mindmap-editor +2.8%、gamemap +0.2%。全部场景无 >5% 回退；"慢路径下降 20%"目标未达成——基线本身 <1s，按口径报告绝对差（todo +3ms / post −47ms / mindmap 列表 −249ms）。原始样本见 `.qa/frontend/evidence/startup-ab-*.json`。

## 6. 已知限制

1. A/B 为单机单浏览器（Edge headless）小样本（每场景每组冷/暖各 15 个），数字仅描述本机现状；FCP/LCP 未从 Performance 域提取（ready 锚点为真实内容文本）；未采集 long tasks/布局偏移明细。
2. ZCode 内置浏览器（IAB/WebView2 宿主）对 HttpOnly Cookie 偶发清理与遮挡页面 paint 提交挂起——影响的是验收工具环境，不是产品缺陷（curl 链路 25s+ 复测稳定；前台浏览器交互全部即时生效）。截图取证需双拍取第二张。
3. 折叠窄轨第一版不含复杂图标子菜单（悬停展开二级），二级入口需先展开侧栏——与方案一致的有意取舍。
