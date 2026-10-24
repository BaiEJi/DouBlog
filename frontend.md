# DouBlog 前端架构文档

## 思维导图模块（2026-10-20）

`/mindmap` 是与 Todo/Vault 平级的独立模块，`/mindmap/:id` 为编辑器；门户、公共侧栏、
路由识别及 Tailwind 显式扫描均已登记。继续使用统一 Cookie、`shared/client.js` 和公共桌面外壳。
具体契约见 `docs/modules/mindmap.md`，选型与上游边界见 `docs/mindmap-selection.md`。

- `mindmap/api.js` 是业务 HTTP 唯一入口；列表仅加载元数据，知识库文章关联按分页获取。
- `Library.jsx` 管理创建/筛选/排序/分页/重命名/复制/删除及文件导入。
- `Editor.jsx` 持有一次初始化的 imperative adapter；普通编辑调用原生命令，主题/面板变化不重建画布。
- `Inspector.jsx` 提供节点格式、备注、标签、链接、图片、标记、九种布局、主题、大纲与历史。
- `adapter.js` 隔离 `simple-mind-map@0.14.0-fix.3`，注册所需插件；高级导出按需加载。
  采用基础文本格式，不接收 HTML 富文本；纯文本原样显示。`commit()` 在手动保存/导出/离开前
  结束当前文字输入，避免未失焦的最后字符遗漏。聚焦分支编辑合并回完整文档后保存。
- `core-text-measure.js` 针对锁定版本的逐字符 SVG 测量增加实例级 Canvas 换行缓存，最终仍
  使用 SVG 实测尺寸；布局居中使用同一规范内容尺寸，避免极小缩放下SVG bbox失真造成框外文字。
  节点全部渲染，未启用视窗裁剪。升级核心时须复核私有方法签名并重跑基准。
- `clipboard.js` 在复制/多目标粘贴时重建节点和概要UID、映射内部关联线；保存快照清理失效
  外链，核心原始数据保留以便撤销恢复。粘贴先验证完整文档，避免先修改后报错。
- `data.js` 定义版本化 JSON 信封及入站校验；`saveController.js` 负责 900ms 防抖、单飞排队、
  超时/网络重试复用 mutation_id、CAS 冲突停写、明确保存状态及浏览器草稿。保存期间的新修改
  留在下一批；只有已确认版本才能清除对应草稿。旧基准版本的草稿只能另存新图，不能静默覆盖。

只读模式允许导航/缩放/搜索/导出，禁止工具栏、快捷键与关联线修改；它是当前登录用户的查看模式，
没有新增公开分享或第二套认证。明暗主题跟随系统，普通节点底色随主题调整；用户明确设置的颜色保留。
小地图缓存布局坐标绘制 Canvas，平移时只更新视口框。卸载清理画布插件、事件、observer、计时器和 tooltip。

`npm run test:mindmap` 使用 Node 内置测试器验证数据转换和保存状态机；真实浏览器脚本
`test:mindmap:e2e` / `test:mindmap:core` 与 `bench:mindmap` 的环境和结果见模块文档及性能报告。
最终功能证据和复现命令见 `docs/mindmap-verification.md`；5000节点全展开仍有明显布局与绘制瓶颈，
不能声称达到100ms/60FPS，具体数值见 `docs/mindmap-performance.md`。

> **技术栈**: React 19 + React Router 7 + Vite 8 + Tailwind CSS 4
> **端口**: 60101（dev 与 preview 同端口）　**入口**: `frontend/src/main.jsx`
> **本文档描述当前代码的真实架构；修改代码时必须同步更新本文档**（见 `AGENTS.md` 文档同步规则）

---

## 目录

- [1. 概述与关键决策](#1-概述与关键决策)
- [2. 文件结构](#2-文件结构)
- [3. API 层（api.js）](#3-api-层apijs)
- [4. Markdown 渲染管线（md.js）](#4-markdown-渲染管线mdjs)
- [5. 页面组件](#5-页面组件)
- [6. 样式与主题](#6-样式与主题)
- [7. 构建与部署](#7-构建与部署)
- [8. 已知限制](#8-已知限制)

---

## 1. 概述与关键决策

| 决策 | 说明 |
|---|---|
| **API 地址可配置** | 缺省直连 `http://{当前主机名}:60100`，地址唯一在 `shared/client.js`；`VITE_API_BASE=/` 可启用同源开发代理，代理目标由 `VITE_API_PROXY` 决定（缺省 60100） |
| **统一登录（会话 Cookie）** | `/login` 登录一次签发 HttpOnly Cookie（30 天）全站生效；apiFetch `credentials:'include'`，401 自动跳 `/login`；AuthGate 路由守卫（公开页：/login、/diary/s/*）；bundle 不持有凭据，Basic 仅后端 API 兼容通道 |
| **正文按需加载** | 列表/树接口不返回正文；详情页按 id 取全文 |
| **系统配置** | `/config` 统一操作数据库切换、日志上报和账号；旧 `/admin` 地址重定向到 `/blog` |
| **多知识库** | 知识库页面选择器切换/新建知识库（`/blog?ws=` 记忆）；树/搜索/父文章选项均按当前库 |
| **首页服务端分页** | `HomePage` 调 `fetchPosts`，每页24条；未搜索时携带当前 `workspace_id`，按服务端返回的 `total` / 页码导航。浏览器只保留当前页，不再启动全量拉取或设置2000条客户端截断 |
| **全文关键词匹配（服务端）** | 输入防抖300ms调 `GET /api/posts?page=&page_size=24&keyword=`，后端匹配标题/摘要/英文名/**正文**；有关键词时不传 `workspace_id`，跨库分页展示。结果带库名，`Ctrl/Cmd+K` 聚焦搜索；清空关键词回到当前库的服务端分页。换页/换库/新输入取消旧请求 |
| **路由级代码分割** | entry 承载React/路由、QueryClient、认证与公共外壳；Markdown/Mermaid与编辑器重依赖按需加载。本轮单个entry约270.4kB / gzip86.4kB，**包含静态依赖的初始JS闭包**为gzip89,947B（基线82,302B，增加7,645B）；单chunk大小不等于首屏闭包或页面总传输 |

## 2. 文件结构

```
frontend/src/                       # 按一级路径分包，每个能力目录自包含（页面+组件+自己的 api）
├── main.jsx                        # 入口：挂载 app/App
├── index.css
├── app/                            # 应用壳
│   ├── App.jsx                     # 主题状态 + AuthGate 登录守卫 + 路由表（懒加载）+ ScrollToTop/PageFallback/代码复制委托
│   └── LoginPage.jsx               # /login 统一登录页（会话 Cookie 签发）
├── shared/                         # 公共层
│   ├── client.js                   # API_BASE/apiFetch（后端地址唯一持有处；会话 Cookie 认证 + 401 跳登录）
│   ├── ModuleShell.jsx             # 全模块公共侧栏（220px 常驻 sticky）、递归多级菜单（分区作用域：带 to 的顶层 tab 其 children 仅在激活分区展示/匹配，防跨分区 key 重名串扰与误点）、统一内容画布
│   ├── module-navigation.js        # 页面注册本地视图与侧栏扩展的 context/hook
│   ├── module-routes.js            # 一级路径到模块的映射（文章页归 blog）
│   ├── ModuleErrorBoundary.jsx     # 路由渲染/懒加载错误兜底，导航保持可用
│   ├── PageHeader.jsx              # 兼容适配器：将页面 tabs 注册到侧栏，渲染内容标题；BackButton 单独导出
│   └── md.js                       # markdown-it 渲染管线（12 插件 + 双链 + mermaid）
├── portal/                         # /        统一入口（13 卡；dnd 自定义分组布局——**布局与卡片标题/描述覆盖全量持久化服务端**（/api/home/layout，system_home_* 表，2026-10-17）：localStorage doublog_portal_layout_v2 仅首屏缓存、服务端为唯一事实源，旧 doublog_portal_layout/doublog_portal_order 在服务端为空时一次性迁移上存；卡片 hover 铅笔按钮 → CardEditModal 编辑标题描述（空 = systems.jsx 内置默认文案，"恢复默认文案"清覆盖）；systems.jsx 卡片定义单源（key/to/默认文案/配色/图标）、api.js 布局 API；新模块自动追加末组 + 未知卡/跨组重复卡去重自愈；**落点判定 pointerWithin→closestCenter 兜底**——原 closestCorners 下全宽分组 section 四角偏远，悬停空分组中部时 over 误判成别组卡片致"拖不进空分组"（2026-10-13 修复）；拖拽走 DragOverlay 悬浮克隆（拎起微倾+大投影，原槽位虚线占位，松手 240ms 缓动归位，2026-10-13）；新建分组后平滑滚动到新组）
├── blog/                           # /blog /post/:id /create + 模块 tab：/assets /diary /bookmarks（assets·diary·bookmarks 子目录）
│   ├── api.js                      # 文章/知识库/图片/最近浏览/反链/导出/数据库管理（透传 client 基础导出）
│   ├── pages/                      # HomePage PostDetail CreatePost EditPost
│   └── editor/                     # useEditorShortcuts / useEditorEnhancements
│                                   #   HeatmapView StatsView ShareDialog SummaryCard
├── vault/                          # /vault（零知识密码库 + 密码服务子视图）
│   ├── api.js                      # vault* + pwsvc* 封装
│   ├── VaultPage.jsx               # 锁屏/侧栏/三面板外壳
│   └── components/                 # crypto core ui ItemDetail ItemEditor Generator SecurityCenter PwsvcView
├── logs/                          # /logs：api.js + LogsPage.jsx（lizysdk 接收端查询页；全页等宽字体）
├── apihub/                        # /apihub（统一 API 调用平台）：api.js + ApiHubPage.jsx（全页等宽字体）
├── config/                        # /config：api.js + ConfigPage.jsx（公共 ModuleShell 侧栏）
├── todo/                          # /todo（四象限待办，MyTodo 迁入）：api.js + kit + charts(纯SVG) + TodoPage + views×11（kit/charts 被 gamemap/practice/steamidler 跨模块引用）
├── gamemap/                       # /gamemap（剧情图谱，antd6+@xyflow 保留栈）：GamemapShell（App.jsx 顶级路由 /gamemap/*）+ board/ + pages/
├── practice/                      # /practice（刷题）：PracticePage（公共 ModuleShell 侧栏）+ PracticeView + components/
├── steamidler/                    # /steamidler（Steam 挂机）：SteamIdlerPage（公共 ModuleShell 侧栏）+ SteamIdlerView + components/
├── confcenter/                    # /confcenter（配置中心）：api.js + ConfCenterPage.jsx（创建/切换 namespace、空间内 KV、Redis 状态与配置）
├── clash/                         # /clash（Clash 代理，clashctl Web 迁移）：api.js + ClashPage.jsx（总览/订阅/配置/日志；门户卡片未装置灰）
└── subs/                          # /subs（订阅管理，CrownFlow 迁移）
    ├── api.js                     # 会员/订阅/分类/统计/提醒封装
    ├── kit.jsx                    # 格式化(价格/剩余天数/周期)/状态与分类标签/Modal/Confirm/Toast/暗色提亮/DateInput(点击整块弹日历)
    ├── charts.jsx                 # 纯 SVG 图表：useWidth + AreaTrend(面积趋势) + DonutPie(环形饼)
    ├── useHolidays.js             # 法定节假日 API（timor.tech，localStorage 缓存 7 天，失败降级按周末）
    ├── SubsPage.jsx               # /subs/* 壳：公共侧栏导航(概览/会员/统计/设置+计数徽标) + 内嵌 <Routes>
    └── views/                     # OverviewView MembersView MemberDetailView StatsView SettingsView
```


## 3. API 层（shared/client.js + 各包 api.js）

**全项目唯一的后端地址定义处**（认证=会话 Cookie，自动携带）。新增任何请求必须走它，禁止在组件里再写 `btoa(...)`/裸 fetch/硬编码端口。

```js
API_BASE                 // http://{hostname}:60100（全项目唯一持有处）
apiFetch(path, options)  // JSON body 需 JSON.stringify；自动补 Content-Type，FormData 保留浏览器边界。
                         // 认证=会话 Cookie（credentials:'include'），401 统一跳 /login
```

业务函数在各能力包自己的 api.js（见下）；`apiFetch` 保留 Response 契约，部分旧函数仍返回业务信封，调用方须检查 `success`。`apiJson` / `readEnvelope` 抛出的 `ApiError` 保留 `status`、业务码、详情、trace 与 cause。

**文章详情 SWR 预取缓存**（提速核心，改详情加载逻辑时必读）：

```js
prefetchPost(id)       // 链接 hover/focus 时调用：GET /api/posts/id/<id>?no_view=1（不计浏览量），Promise 去重并发
takeCachedPost(id)     // 详情页挂载时同步读取已解析缓存（未决返回 null 不阻塞）
setCachedPost(id, d)   // 详情页正常拉取（计浏览）后回填缓存
invalidatePost(id)     // 编辑保存/删除后失效；LRU 上限 50 条
```

语义为 stale-while-revalidate：hover 已拉取的文章，点击瞬间用缓存渲染，详情页仍后台重拉覆盖（浏览计数只由这次计入）。

**api.js 已按能力分包**（每个能力目录自己的 api.js，公共传输层唯一在 `shared/client.js`）：

- `blog/api.js`：`fetchPosts(params,{signal})` 为当前首页分页/搜索入口；fetchWorkspaces / createWorkspace / fetchPostTree / prefetchPost·takeCachedPost·setCachedPost·invalidatePost（按账号/数据库隔离的SWR缓存）/ uploadImage / fetchRecentPosts / fetchBacklinks；保留旧 fetchAllPosts / searchPosts helper，但首页不再调用；并透传 `apiFetch, API_BASE`
- `blog/diary/api.js`（日记子域）：条目 CRUD/动作/快速录入、分册 CRUD、日历/热力图/那年今日/统计/趋势/年度回顾、分享（含免登录 `diaryPublicShare` 走 API_BASE 直连）、导出、模板/引导
- `vault/api.js`：vault*（条目/审计/备份）+ pwsvc*（项目/类型/用户/校验日志/限流）封装，透传 `API_BASE`
- `logs/api.js`：sdklogSearch / sdklogSysnames

约定：列表/树接口条目**没有 `content` 字段**，需要正文时调 `GET /api/posts/id/<id>`（详见根目录 `api.md`）。

## 4. Markdown 渲染管线（shared/md.js）

`MarkdownIt({ html: true, linkify: true, typographer: true, highlight: hljs })` + 插件：

task-lists(label)、footnote、emoji(**light 词典 150 个**，无 `:+1:`/`:rocket:`)、deflist、abbr、sub、sup、attrs、texmath(KaTeX, `dollars` 定界符)、container(`::: tip/info/warning/danger`)。

**定制渲染规则**（改渲染行为时更新此表）：

| 规则 | 行为 |
|---|---|
| `fence` | 包装为 `.code-block`（语言标签 + 复制按钮）；`mermaid` 输出 `.mermaid` div + `data-mermaid-source` 复制源；attrs 解析 `{.line-numbers}`(行号) 与 `{data-highlight="2,4-6"}`(行高亮) |
| `blockquote_open` | GitHub Alerts：首行 `[!NOTE|TIP|WARNING|CAUTION|IMPORTANT]` → `blockquote.github-alert-*` + emoji 图标（**同时剥离 children 首个 text token 的标记**，只改 content 无效） |
| `image` | 非 http/blob/data 的 src 改写为后端图片接口 URL（`/api/images/` 前缀→只补主机名，`/` 开头→absolute，否则→relative）；带 title 时包 `figure.image-figure` + `figcaption` |
| `inline: wiki_link` | `[[目标]]` / `[[目标\|显示文字]]` → `<a class="wiki-link" data-wiki-target>` 占位；`buildWikiMap` 收集同库全部name后补title，name优先，重复title以最小ID稳定决定；`applyWikiLinks(html, map)` 二次解析href，未命中标记 `wiki-link-missing`（无href不可点）。代码块/行内代码内不生效 |
| render 后处理 | `==text==` → `<mark>`（先摘出 `<pre>/<code>` 再替换，避免误伤代码） |

渲染能力全清单（40+ 项）见根目录 `README.md` 的"Markdown 渲染能力"一节。

**mermaid 为异步渲染**：统一走 `md.js` 导出的 `renderMermaidDiagrams(dark)`——内部**动态 `import('mermaid')`**（不打进文章/编辑页首屏关键路径，正文文字先出，图表模块后台加载后补画）+ 模块级队列串行化（防主题切换/快速切换时并发 `run()` 互扰，单次失败不会毒化队列）。调用方：详情页 `MermaidRunner`、编辑器两页的 useEffect，均为 100ms 定时器后调用。详情页 `MermaidRunner` 挂在正文 div 内部、`key={html}`（内容真实变化即重挂重画）、只依赖 `[dark]`——内容区被重建的任何路径（切换文章 key 变化、骨架屏往返、SWR 内容更新）都会重新渲染图表；不要改回依赖 `[html]` 的旧写法（同一篇文章卸载重建时 content 字符串按值相等会命中 useMemo 缓存导致不重跑）。

## 5. 页面组件（按能力包）

### blog/pages（博客各页）
- `HomePage`：`fetchPosts` 按当前库请求每页24条元数据并显示上一页/下一页；输入关键词后300ms防抖，改为跨知识库的服务端关键词分页，清空后回当前库，不对浏览器已加载卡片做全量搜索。旧请求由AbortController取消；列表/搜索仍不返回正文。**最近浏览**横条为 `fetchRecentPosts(8)`，跨库且仅非搜索态显示。
- **WorkspaceSwitcher**（正文工具行，`blog/pages/HomePage.jsx` 内组件）：触发按钮（文件夹图标 + 当前库名截断 + 旋转箭头）→ 下拉面板（`animate-dropdown` 入场）：库名 + 文章数 + 选中态高亮（蓝点/蓝底）、"＋ 新建知识库"进入创建模式（面板内输入框 + 行内错误 + 取消/创建按钮，Enter 提交 Esc 取消）、点外部/Esc 关闭；选择或创建后 `history.replaceState` 更新 `?ws=` 并自动切换
- 公共左侧栏提供知识库（含子项新建文章）/ 资产库（Prompt/Skill）导航；正文工具行保留知识库切换器、搜索与新建按钮
- 门户“管理”卡片、知识库“内容管理”导航及旧独立管理页已移除；历史 `/admin` 地址通过 replace 重定向到 `/blog`，保存的门户分组会自动过滤旧卡片。

### PostDetail.jsx（最重的页面）
- **数据**：先 `GET /api/posts/id/:id`（正文 + 得知所属知识库）→ 再 `GET /api/posts/tree?workspace_id=`（侧边栏树只含同库文章）；文章一到即解除内容区骨架，树在后台刷新。挂载时先查 `takeCachedPost`（hover 预取缓存）命中即渲染再后台刷新（SWR）；侧栏树链接/首页卡片/子文章卡均挂 `onPointerEnter/onFocus → prefetchPost`
- **切换文章只刷新内容区**：组件在同路由参数变化时保持挂载，导航/侧栏/TOC 外壳不动；仅首次进入（从未加载出文章）才显示整页骨架，之后切换时正文列显示内容级骨架、`key={post.id}` 重建内容 div 并淡入；滚动复位通过 `articleRef.scrollTo(0)` 显式处理（滚动容器被复用不会自动归零）；切换期间 TOC 传空数组避免显示旧文章标题
- **目录（TOC）**：对渲染后 HTML 的 h1~h6 注入 `heading-N` id，右侧生成锚点目录，`IntersectionObserver` 高亮当前节
- **侧边栏树**：树形展开/折叠、右键菜单（删除等）、dnd-kit 拖拽排序（乐观更新 + `PUT /reorder`（顶级需带 workspace_id）+ 失败回滚重拉同库树）
- **渲染**：`md.render(content)` 走模块级 `renderCache`（按正文内容 LRU 16 条，重访近期文章跳过整个渲染管线）+ `useMemo`；图片点击进入自研 lightbox（缩放/拖动）
- **双链**：`buildWikiMap(tree)` → `applyWikiLinks(html, map)` 解析 `[[...]]`（树异步到达后补href），点击事件委托走SPA导航。文末反向链接仍请求 `GET /api/posts/id/:id/backlinks`：后端从 `blog_post_links` 查询同库来源元数据，不在浏览时扫描全库正文；正文写入/修改时维护目标文本投影，content哈希避免无内容变化时重建，迁移补齐未索引文章。name优先、重复title最小ID的目标规则与前端映射保持一致，源文章链接可hover预取。
- **单篇导出**：meta 行“导出”按钮（纯前端）——正文已在手，合成 YAML frontmatter + 图片 URL 绝对化（`/api/images/x` → `API_BASE + path`，导出文件在任意位置图片仍可访问）→ Blob 下载 `<name>.md`；全库 zip 备份通过 `GET /api/export/markdown` 下载
- **mermaid**：见上节
- **dangerouslySetInnerHTML 必须传稳定引用**（`proseProps = useMemo(() => ({ __html: html }), [html])`，编辑器两页同理 `previewProps`）：react-dom 的更新路径对 innerHTML 不做同值比较，行内对象字面量会让任何无关重渲染（树刷新/TOC 高亮/展开折叠）都整体重建正文 DOM——抹掉 mermaid.run 注入的 SVG 且无法自动恢复，还有整段 HTML 重新解析的性能开销

### blog/editor（编辑器增强）
- `useEditorEnhancements`（共用 hook）：图片**粘贴/拖拽/工具栏按钮**上传（`POST /api/images/upload`，成功后光标处插入 `![alt](/api/images/x.png)`）、**预览同步滚动**（编辑区滚动→预览按比例跟随，用户滚预览时暂停 400ms；EditPost 需传 `active: !loading`——其编辑器在 loading 放行后才渲染）、块模板（表格/mermaid/代码块）
- 编辑/预览左右分栏，固定高 `h-[70vh]`，两栏各自内部滚动

### CreatePost.jsx / EditPost.jsx
- 表单字段：标题、name（英文名，前端校验格式，**同库内唯一**）、所属知识库下拉（`?ws=` 预选，切换库时清空父文章）、正文（CodeMirror adapter，保留 `#md-editor` / editorRef 选择与滚动兼容接口及工具栏插入语法）、摘要、父文章（**同库**树的扁平化下拉，过滤自身与子孙）、状态
- **编辑器快捷键**（`useEditorShortcuts`，两页共用）：`Ctrl/Cmd+S` 保存/发布、`Ctrl/Cmd+B` 加粗、`Ctrl/Cmd+I` 斜体、`Ctrl/Cmd+K` 插入链接、正文内 `Tab` 两格缩进；B/I/K 仅在正文区/页面空白处生效，不干扰标题等普通输入框
- **实时预览**：`useDeferredValue(content)` 延后重渲染 + `md.render` + mermaid.run，与详情页同一管线
- Edit 先拉详情再按库拉树（父文章选项仅同库）；提交 `PUT /api/posts/id/:id` 后跳回详情

### DiaryPage.jsx（blog/diary/，Memos × Day One 超集 UI——知识库模块 tab）
- blog 模块侧栏「日记」项（children：时间线/日历/热力图/统计/回收站，useModuleNavigation 仅注册 activeKey/onSelect）；日记本列表为页内左列内侧栏（卡片式 sticky，timeline 视图显示，含行内新建与导出全部）
- 时间线：那年今日横幅（往年同月同日 + 随机记忆）→ QuickCapture 快捷录入盒（自动增高 + 心情 + 标签 + 模板下拉 + ✦每日引导问题 + 🌤️天气位置一键采集 open-meteo）→ 日期分组 EntryCard 卡（元信息行：日期/心情/天气图标/位置/字数；hover 操作：置顶/编辑/分享/归档/回收站）
- Editor 全屏弹层：日期/心情/本子/模板/预览/自动保存（1.2s 防抖，状态行"已保存 HH:MM"）
- CalendarView 月历（心情着色+今日环+点选过滤）、HeatmapView 年度热力图（365 格色阶+悬浮详情+点选）、StatsView（6 指标卡 + SVG 柱状/折线（纯手写无依赖）+ 年度回顾大卡）、ShareDialog（有效期选项+复制+撤销）、PublicShare 免登录只读页（/diary/s/:token，柔和阅读排版）
- kit.jsx 公共小件：MOODS 模型/天气码映射/Icon/Chip/Confirm

### SubsPage.jsx（subs/，订阅管理 —— CrownFlow 迁移 UI）
- 壳：侧栏（返回入口 / 概览/会员/统计/设置导航；概览带即将到期计数徽标、会员带 活跃/总数）+ 内嵌 `<Routes>`
  （`/subs` 概览、`/subs/members`、`/subs/members/:id` 详情、`/subs/stats`、`/subs/settings`）
- **OverviewView**：4 指标卡（总数/活跃/本月/年度支出，月年口径=整月整年）+ 分类汇总表（列排序+合计行）+
  即将到期提醒列表（点击进详情）+ 会员支出排行榜（4 维度切换：累计花费/平均订阅/订阅次数/累计时长，金银铜奖杯+火焰）+
  **订阅到期日历**（月历：`lunar-javascript` 农历与节日（红字优先显示法定节假日/补班）、timor.tech 节假日着色、
  当日到期数徽标（橙=7 天内/绿=更远）、点有订阅的日期弹当日列表、今天高亮、图例）
- **MembersView**：搜索（300ms 防抖）/分类/状态筛选 + **表格/卡片双视图**（localStorage 记忆 subs-members-view）+
  分页（页大小记忆）+ 新建/编辑会员弹窗 + 删除确认
- **MemberDetailView**：信息卡（分类/订阅数/分币种累计/提醒天数/备注）+ 订阅表（级别/周期/状态/覆盖日期四维筛选）+
  **时间轴视图**（3m/6m/12m/全部 + 缩放/平移/回到当前 + 今天竖线 + 状态着色条形(绿=有效 橙=提醒窗口内 灰=过期) +
  条形详情弹层含日均）+ 添加/编辑订阅弹窗（周期切换自动推算结束日期=整周期-1 天、custom 显自定义天数输入、组合校验）
- **StatsView**：日期范围 + 快速选择（本周/本月/本季度/本年）+ 粒度（跨度≥90 天禁用按天并自动回落按周）+
  面积趋势图（hover 提示，明细开关展开分类/订阅明细）+ 环形饼图（中心总计、图例带占比、明细）
- **SettingsView**：分类管理（CRUD/16 色预设+任意 hex/emoji/搜索）
- 依赖：`lunar-javascript`（仅农历显示，独立到期日历 chunk ~104KB gzip）；图表零依赖（手写 SVG，useWidth 三重兜底自适应）

### LogsPage.jsx（logs/，日志查询）
- 查询工具条（自绘 Dropdown 级别与 sys_name 下拉/自绘 DateTimeInput 日历+时分微调/任意 kv）+ 紧凑单行结果（时间|级别|文件:行|traceId|消息）点击展开字段表格 + 复制 JSON

### ApiHubPage.jsx（apihub/，统一 API 调用平台 UI）

单页 `/apihub`（门户卡片入口），六个内部 Tab：总览（24h 统计卡+健康徽标+一键探活）、
系统（CRUD+密钥池弹窗，credential 脱敏展示；2026-10-17 重构前名「上游」）、API（**按
所属系统分区块展示**：每个系统一个可折叠卡——组头=折叠箭头+系统名/slug+API 数徽章+
`/gw/systems/{slug}/{path}` 透明代理前缀提示；≥8 条的系统默认折叠、手动状态存
localStorage `doublog_apihub_system_fold`，工具条搜索框按 slug/名称/method/路径/系统
过滤（命中系统保留整组，无命中组隐藏，搜索中强制展开）、全部展开/收起批量按钮；行操作
调用/文档/探活/编辑/删除+行内启停开关——**调用弹窗参数齐全**：路径变量/query/header/body
四桶输入框按 request_cfg 默认值自动预填（KeyValueFields 组件：可追加自定义键、清空即回落
后端默认值），**文档弹窗**经 `GET /admin/apis/{id}/doc` 取 Markdown 用 shared/md.js 渲染
（prose-content 样式，示例参数默认值全代入可直接复制））、平台令牌（签发弹窗明文仅显示一次+复制）、
限流规则（四级+算法动态表单+实时余量进度条）、调用日志（按 API 筛选，限流触发标紫并
注明层级）。配置类字段（auth_config/request_cfg/response_cfg/probe）用 JsonArea 组件
（失焦校验标红不改值）。全页 select 用 selectCls（inputCls + `[color-scheme:light]
dark:[color-scheme:dark]`，展开的原生选项列表跟随明暗）；弹窗暗色用实底深色卡
（dark:bg-[#1c1b1a]，与 subs/diary kit 一致）。
api.js 走 apiFetch（admin 接口走统一登录会话）；网关调用（sk-）是外部调用方的事，不在页面内。

### AssetsPage.jsx（blog/assets/，资产库 UI——知识库模块 tab）

单页 `/assets`（2026-10-17 自独立模块并入 blog，module-routes 归 blog；模块侧栏「资产库」项的 children 为 Prompt/Skill 两项——「浏览」按资产类型拆分、列表按 kind 隔离，经 useModuleNavigation 仅注册 activeKey/onSelect，不覆盖 blog 静态菜单；回收站与统计视图及能力已移除，删除为直接彻底删除〔带确认〕）。资产库视图 = 页内左过滤栏（全部/★收藏 快速过滤 + 分类树含计数 + 标签 chips）+ 工具栏（Ctrl+K 搜索/排序/批量/导入导出/上传 Skill〔仅 Skill 视图〕/新建〔按视图预填 kind〕）+ 卡片网格（kind 徽标、`{{}}` 变量数、标签、版本/使用数 footer、hover 操作；批量模式行内勾选）。
详情为右滑抽屉（ItemDetail）：操作组（复制全文/编辑/导出 md·json/复制副本/收藏/归档/回收站）+ 三 tab——预览（`shared/md.js` 渲染与原文切换）、变量填充（{{变量}} 表单 + 实时填充预览 + 复制计使用，值记忆 localStorage）、版本（分页列表 + 共享DiffViewer完整差异 + 恢复）。编辑器为弹窗（ItemEditor：kind 分段、实时变量检测 chips、版本备注、Ctrl+S/Esc）。导入面板先预检后执行（dry_run 结果展示、分类自动创建提示）；导出走 blob 下载解析 filename*。统计视图为纯 CSS 柱图（30 天趋势零依赖）。kit.jsx 提供 Toast/Modal/diffLines/copyText/KIND_META。

### DevToolboxPage.jsx（devtoolbox/，开发者工具箱 UI）

单页 `/devtoolbox`（lime 个性色，门户卡片入口，`?t=<工具id>` 深链）。侧栏两级导航（8 分类 → 31 工具）经 useModuleNavigation 注册；首页为搜索 + 分组卡片网格。31 个工具组件各自 React.lazy 独立分包（registry.js 为分组/名称/描述/组件单源）。绝大多数工具纯本地计算（隐私 + 即时）；仅哈希/字符集互转/JSON⇄YAML/二维码走 `api.js`（网络错误本地化中文并保留 cause）。kit.jsx 提供 UI 原子（ToolHead 的 `right` prop 为头部动作区、TwoPane 双栏编辑器、CopyBtn/Segmented/Check/Toast）；lib/ 为纯逻辑（diff 共享jsdiff/Worker+行内高亮+jsonDiff、cron 解析推算、color WCAG、misc 的 UTF-8 安全 Base64 与 uuid/nanoId/密码生成）。md-preview 直接复用 `shared/md.js`。模块细节见 `docs/modules/devtoolbox.md`。

### ConfigPage.jsx（config/，系统配置总入口 UI）

单页 `/config`（门户卡片入口，teal 图标），全站唯一总配置页，三张卡（数据库、日志上报、登录账号）：

- **数据库卡**：当前后端徽章（SQLite（本地）/PostgreSQL（远端））+ 统计行（文章数/审计日志/连接串掩码，`GET /api/admin/database`）；PostgreSQL 连接参数表单（主机/端口/库名/用户/密码——状态返回值自动预填，密码留空表示沿用已存）；三个动作：`测试连接`（POST /database/test，连通返回 PG 版本，库不存在时后端提示切换会自动创建）、`一键切换到 PostgreSQL`（目标=表单值）、`一键切换回 SQLite`——当前后端对应按钮高亮、另一个置灰；切换成功按 `restart_required` 提示（dev 自动重启 3.5s 后自动刷新状态 / 生产提示手动重启）
- **日志上报卡**：外发启用开关 + 服务地址 + 外发最低级别（WARNING/INFO，`GET/PUT /api/admin/logging`，保存即重装配管道即时生效）+ `发送测试日志`（POST /logging/test，返回 marker 引导到 /logs 验证）+ 各模块 sys_name 徽章墙（doublog.blog 等）
- `config/api.js` 走 apiFetch；数据库与日志上报统一从 `/config` 操作

### ConfCenterPage.jsx（confcenter/，namespace 与 KV）

首次进入引导创建独立 namespace；左侧为带 KV 计数的空间导航，点击进入后只查看和搜索该空间的 KV。新建 KV 绑定当前空间，namespace 只读；空空间持久保存，选中项由 `?namespace=` 保持。切换空间重置搜索/分页，并丢弃旧请求的异步结果。表格使用固定列宽和等高单行值预览，长 key/value 省略；点击预览弹窗查看完整原文或格式化 JSON，空字符串明确标注，JSON 字符串标量保留引号，可从预览进入编辑。配置中心采用放大后的字号：主要控件/正文 16px，状态条、表头、计数和辅助说明 14px，namespace/key 与完整值 15px，类型徽章 13px，弹窗标题 18px；值预览保持单行。Redis 配置入口保留；模型、接口及迁移详见 `docs/modules/confcenter.md`。

### TodoPage.jsx（todo/，今日 / 特定日期四象限）

今日视图使用 `calc(100vh - 64px)` 容器衔接公共内容留白，标题和工具栏外的剩余高度由两行两列等高看板占满。每象限固定显示 8 行空间，空内容不收缩，超出行数在象限内滚动；任务标题与标记单行，长文省略，说明和完成备注通过悬停或编辑查看。菜单使用 portal 避免被滚动容器裁切。其余视图保留原来的页面流布局；模块细节见 `docs/modules/todo.md`。

### bookmarks（书签与稍后阅读，blog 子域 src/blog/bookmarks/，路由 /bookmarks——知识库模块 tab）
- `BookmarksPage` → `BookmarksView`（blog 模块侧栏「书签 · 稍后阅读」项的 children：收藏夹/稍后阅读(徽标=待读数，经 useModuleNavigation badges 合并)/统计/工具/回收站）；详情与收录/编辑为覆盖层（state 切换，同 practice 先例）
- 收藏夹：筛选栏（搜索防抖/分类树拍平下拉/标签/排序）+ 状态 chips + 批量操作条（选中后出现：已读/未读/星标/移动分类/加标签/回收站）+ 行卡片（favicon 回退字母块/状态徽章/链路状态点/快照标记）+ 分页
- 稍后阅读：「下一篇要读的」英雄卡（开始阅读=打开原文并标 reading）+ 队列列表；统计：指标卡 + 状态环形（DonutPie）+ 30 天趋势柱 + 分类/标签/站点 TOP 横条；工具：导入导出/死链检测/重复链接去重（保留最早）；回收站：还原/彻底删除/清空
- 表单：URL 一键抓取元信息自动填充（GET /meta，不落库）；标签自由输入逗号分隔 + 已有标签点选；快照正文经 shared/md.js 渲染（prose-content）
- kit/charts 跨模块引自 `src/todo/`

## 6. 样式与主题

- Tailwind CSS 4（`@tailwindcss/vite` 插件），类名写在 JSX，无独立组件库
- 明/暗主题：`dark` class 挂在 `<html>`；**`index.html` 内联预渲染脚本**（读 `doublog_dark`/系统偏好）在任何绘制前设置主题与背景色，暗色刷新无白闪；切换时挂 `transitioning` 类做全局色彩过渡
- 自定义样式集中在 `index.css`（`.code-block`、`.github-alert-*`、`.custom-block-*`、`.mermaid`、prose 排版等）

## 6.1 过渡与防闪屏（UI 流畅性约定）

| 机制 | 说明 |
|---|---|
| 预渲染主题 | `index.html` 头部阻塞脚本 + 内联关键背景色，先于 React/JS-CSS 加载生效 |
| SPA 导航 | 全部内部跳转用 `<Link>`（禁止 `<a href>` 整页刷新）；新增导航入口必须用 Link |
| 路由过渡 | 各页面根容器挂 `animate-fade-in`；首页卡片 `stagger` 逐个入场 |
| 切文章不闪屏 | 详情页同路由切换时导航/侧栏/TOC 外壳保持挂载不动，仅正文列骨架→淡入；禁止让 loading 早退分支替换整页布局 |
| 加载骨架 | 首页/详情页为结构化骨架屏（`animate-pulse`），与正文布局一致避免跳变 |
| Mermaid 占位 | `.mermaid:not([data-processed])` 显示"图表渲染中…"呼吸占位，替代原始代码闪现 |
| 下拉动画 | `.animate-dropdown`（透明度 + 轻微上移缩放，0.16s），用于知识库切换器等浮层 |
| 滚动恢复 | `ScrollToTop`：路由切换回顶部（锚点跳转除外） |
| 动效守卫 | `prefers-reduced-motion: reduce` 时全局禁用动画/过渡 |
| 图谱 FPS 徽章 | `FpsBadge`（`gamemap/board/shared.jsx`）：约500ms累计rAF间隔并统计观测频率。该读数受主线程工作、浏览器节流与同机负载影响，不等同实际显示刷新率或输入延迟；JavaScript 图谱几何、布局与编辑处理不能由 CSS/vsync 保证固定帧率。后台窗口可能被节流。 |

## 7. 构建与部署

```bash
npm run dev                          # 开发（60101，热更新）
npm run build                        # 生产构建 → dist/；entry单chunk与初始静态闭包分别统计，重依赖按需加载
npx vite preview --host 0.0.0.0 --port 60101   # 静态服务 dist
bash shell/frontend/start.sh         # 一键：build + preview（生产模式）
bash shell/frontend/start.sh dev     # 一键：dev server
```

**改前端的验收门槛**：`npm run build` 零报错 + 浏览器过一遍门户/首页/详情/新建/日记/日志/密码库/系统配置（详见 AGENTS.md 验证清单）。

- **ConfigPage**：数据库 / 日志上报 / **API Hub 出站代理**（2026-10-17 新增卡片：enabled+host+port，保存即时生效，测试按钮经当前配置探测 bots.qq.com）/ 登录账号 四卡片两列网格。
- **vite 代理键必须用正则（2026-10-17 修复）**：`server.proxy` 的 `/api` 纯字符串前缀会把
  `/apihub` 页面路由也吞进代理（浏览器打开 /apihub 直接显示后端 404 JSON）——已改为
  `'^/api(/|$)'`；新增前端一级路由若与代理前缀撞车同理。
- **页面布局约定（2026-10-17 更新）**：App 的 ModuleFrame 将所有业务模块包入同一 `shared/ModuleShell.jsx`（文章详情/新建/编辑均属于 blog）。220px 左侧栏常驻 sticky（`h-screen`），侧栏整体纵向滚动；菜单字号 14px，模块标题 16px 等宽字体（font-mono），标题下方不显示说明文字，徽标与页脚 11px；菜单行高 36px、行间距 4px；带 children 的激活分区菜单项右侧配折叠/展开按钮（SVG 雪佛龙图标，viewBox 0 0 20 20、stroke 1.5、w-4 h-4，收起态 rotate -90°，按钮 w-8 h-8 rounded-lg 图标档位，遵循 ui-baseline.md；2026-10-18 前为文本字符 `⌄`/`›`，渲染游离且档位不符，已修）。内容画布一律 `max-w-[1700px] px-10 py-8`，页面内部不再重复加全局 padding。门户、登录和日记公开分享保留独立外壳。**前端不适配移动端**：已移除移动端菜单抽屉、响应式断点类（sm:/md:/lg:/xl:）、触屏拖拽分支与 viewport meta，全部页面按桌面宽屏单态渲染；新增页面禁止引入任何响应式断点类或移动端专属 UI。
- **菜单契约**：`useModuleNavigation({title?,subtitle?,items,activeKey,onSelect,sidebar?})`；item 支持 `key/label/icon/to/badge/active/children/onClick`，children 可任意递归。路由菜单用 Link，本地视图用 onSelect。Context 只暴露稳定 setter，侧栏状态刷新不会连带重渲染页面。PageHeader 将原 tabs 适配到公共菜单，不再绘制独立顶栏；注册的 subtitle 不在公共侧栏显示；主题按钮统一放侧栏底部。生活子视图、订阅设置、gamemap 章节/视图和 vault 分类/标签使用多级菜单。
- **布局细节**：日记本与导出放公共侧栏 sidebar 插槽，剧情图谱的章节按钮/摘要也使用侧栏插槽；密码库保留条目列表/详情两面板及工具栏；文章页保留文档树/正文/目录；配置中心左侧为独立 namespace 导航（先创建空间，再管理该空间的 KV）。gamemap 游戏工作区显式提供 `calc(100dvh - 100px)` 高度（至少 600px），避免 React Flow 父容器无高度导致空画布；画布/网格/HUD/缩放控件/小地图随主题变化。数据加载失败显示重试，懒加载或渲染失败由 ModuleErrorBoundary 兜底。- **性能（2026-10-13）**：Todo 七个视图改为按需加载；农历日历从订阅概览拆到独立 ExpiryCalendar chunk；文章编辑预览用 useDeferredValue 延后 Markdown 解析；Steam 轮询防重入、后台页面暂停、游戏名称缓存 60s；日志实时追尾防重入/后台暂停，增量合并用 Set；日记搜索 300ms 防抖并忽略过时结果，统计等独立视图不再额外拉时间线。仍保持文章预取/SWR 与稳定 innerHTML 引用。模块内导航不重挂路由子树。
- **⚠️ Tailwind 扫描失效事故（2026-09-19，已修复）**：症状=全系统 UI 崩（内联 SVG 失去尺寸约束撑满整页、间距全乱、深色类失效）。根因有三：① **tailwindcss 4.3.0 扫描器 bug**（部分 utilities 静默跳过/多目录合并扫描丢候选）——升级 4.3.3；② vite.config URL 式别名 `'@': '/src'` 干扰模块图——改 `path.resolve(__dirname, 'src')`；③ index.css 的 `@source` 路径**相对 CSS 文件**（src/index.css）而非 CWD，`../` 与 `!` 写法都会静默失效——最终形态：`@import "tailwindcss" source(none);` + 按能力目录显式 `@source "./app"` 等（见 src/index.css）。**诊断技巧**：对页面 style 标签文本用 JS `indexOf('w-3')` 定位（grep `.w-3{` 会被非压缩空格换行骗）；CSS 里类名转义 `.w-\[104px\]`，正则查转义前形式必误报
- **4.3.3 残留 bug 规避**：**任意值色 + 透明度修饰**（如 `dark:bg-[#100f0e]/95`、`bg-[rgba(...)]`）不会被编译（标准色+透明度如 `dark:bg-white/[0.04]` 正常）——此类需求一律写显式无修饰等价类（如 `dark:bg-[#141312]`）。新增深色样式后在 /logs 页抽查 `getComputedStyle` 确认真的生成了

**改前端的验收门槛**：`npm run build` 零报错 + 浏览器过一遍门户/首页/详情/新建/日记/日志/密码库/管理（详见 AGENTS.md 验证清单）。

## 8. 已知限制

2. 生产模式下系统配置页切换数据库后需手动重启后端（页面有提示）
3. 开发模式下连续改动源文件后，Vite 依赖重优化窗口内 mermaid 偶发不渲染（刷新即恢复，仅 dev，生产预打包不受影响）
4. 新增编辑器、Worker与公共恢复能力有包体成本：初始静态JS闭包gzip82,302→89,947B（**+7,645B**）；全部生产JS（含entry、所有lazy/Worker）合计gzip2,341,947→2,653,836B（**+13.3%**），后者不是首屏传输量。CodeMirror/Lezer相关懒加载chunk约201.3kB gzip。统计口径与原锁文件独立构建证据见 `docs/optimization/frontend-verification.md`；包体不等于实际加载时延。
5. 依赖审计仍有**2条low**（Quill及父SimpleMindMap传播报告），没有通过强制降级掩盖。该次普通生产构建与审计构建逐文件SHA一致；全部rendered chunks中的Quill/RichText/Formula及旧嵌套KaTeX模块均为0，证明上述目标模块没有进入该产物，不能说依赖已删除或整体风险归零。启用插件或改变构建后须重审；证据见 `docs/optimization-dependencies.md` 和 `frontend-bundle-comparison.json`。
6. 首页分页限制的是传输与DOM数量，不代表全文检索已建立专用索引：当前关键词匹配仍由服务端查询标题/摘要/英文名/正文。更大数据量下的查询耗时应独立验证，不能从客户端只显示24条推导固定响应时间。


## 2026-10-21 全模块公共组件优化

统一ApiError/readEnvelope/apiJson与AbortSignal，响应头到body读取期间均检查dataEpoch；身份和数据库分scope管理草稿及Query缓存。AuthGate去重认证且只有401退出，网络/503有重试状态，未知路由显示404并提供错误边界。

通用UI迁往shared/ui，todo/kit保留兼容reexport。CodeMirror6取代高频大textarea路径；TanStack Virtual承载长列表；jsdiff/正则/大JSON使用可取消、有截止时间的Worker。saveCoordinator提供单资源串行确认与未知结果mutation重放；门户reset设屏障。图谱保留自绘SVG/ReactFlow，复用几何缓存与空间网格，拖动以多看板CAS批量确认；ELK仅PoC、不加入依赖。

Vault Argon2派生在Worker，解锁会话以generation取消迟回填，有限并发解密和虚拟列表，HIBP仅内存缓存，默认本地图标；密码派生及加密参数不变。总配置按running_backend/pending_restart轮询切库实际状态。

精确组件版本与许可见docs/optimization-dependencies.md；功能验证、性能样本及最终验收进度见docs/optimization-execution.md。整站构建/体积对照分别安装各自lockfile；几何算法隔离实验使用相同当前依赖，不能外推为整站依赖升级收益。`graph-performance.json`记录最终一轮18样本，`sourcesUnchanged=true`、`failures=[]`；早期受同机负载影响的样本另存`graph-performance-contended.json`。本轮我方未并行其他测试，已知的旧timeline基准已自然退出，但未采集全主机CPU指标，不能宣称硬件独占。1000节点拖动中位数6.418→43.113fps，仍未达到60fps；p95为rAF帧间隔，松手指标为pointerup后两个rAF的观测间隔，均不能当作端到端输入延迟。方法、完整数据与单设备验证边界详见docs/optimization/frontend-verification.md。
