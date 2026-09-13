# DouBlog 前端架构文档

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
| **无代理直连后端** | 前端不经 Vite proxy，直接请求 `http://{当前主机名}:60100`（后端 CORS 放开）。地址集中在 `api.js` |
| **Basic Auth 每请求携带** | 单用户系统，凭据硬编码于 `api.js`（无登录会话）。⚠️ bundle 中可见，仅适合个人/内网 |
| **正文按需加载** | 列表/树接口不返回正文；详情页按 id 取全文 |
| **管理页** | `/admin` 数据库管理页：SQLite ↔ PostgreSQL 一键切换（连接测试/迁移/自动重启提示） |
| **多知识库** | 首页导航选择器切换/新建知识库（`/?ws=` 记忆）；树/搜索/父文章选项均按当前库 |
| **首页全量分页拉取** | `fetchAllPosts` 以 100/页循环拉完（上限 2000），保证搜索覆盖全部文章 |
| **全文搜索（服务端）** | 输入防抖 300ms 调 `GET /api/posts?keyword=`，后端匹配 标题/摘要/英文名/**正文**，跨所有知识库；结果卡片带所属库名 chip；`Ctrl/Cmd+K` 聚焦搜索框；清空回到当前库客户端过滤视图 |
| **路由级代码分割** | 首页关键路径仅 React/路由/API 层（主入口 gzip ≈ 61KB）；markdown 全家桶随详情/编辑页懒加载（React.lazy + Suspense） |

## 2. 文件结构

```
frontend/src/
├── main.jsx            # 入口：BrowserRouter 挂载 App
├── App.jsx             # 路由表 + 首页(HomePage) + 归档页 + 布局/导航/搜索/主题切换
├── PostDetail.jsx      # 详情页：目录(TOC)/侧边栏树/拖拽排序/右键菜单/lightbox/mermaid
├── CreatePost.jsx      # 新建：表单校验 + 实时预览
├── EditPost.jsx        # 编辑：并行加载详情与树 + 实时预览
├── AdminPage.jsx       # 管理页：数据库后端状态/连接测试/一键切换
├── (知识库逻辑分散在 App/CreatePost/PostDetail/EditPost,见下文)
├── api.js              # 统一 API 客户端（唯一持有凭据/端口处）
└── md.js               # markdown-it 实例 + 12 插件 + 定制渲染规则
```

页面路由（`App.jsx`）：`/`（首页，`?ws=<id>` 记忆当前库）、`/post/:id`（详情）、`/create`（新建，`?ws=` 预选库）、`/post/:id/edit`（编辑）、`/admin`（管理）。

> ⚠️ 导航栏的"归档"链接指向 `/archive`，但**该路由未注册**（死链，点击后内容区空白）——遗留问题，修复时更新本节。

## 3. API 层（api.js）

**全项目唯一的凭据与后端地址定义处**。新增任何请求必须走它，禁止在组件里再写 `btoa(...)`/裸 fetch。

```js
API_BASE                 // http://{hostname}:60100
apiFetch(path, options)  // 自动附加 Authorization 与 Content-Type；JSON body 直接传对象
fetchAllPosts({pageSize=100, maxPosts=2000})  // 循环分页拉全量；err.status 携带 HTTP 状态码
fetchWorkspaces()        // GET  /api/workspaces            知识库列表(含文章数)
createWorkspace(name)    // POST /api/workspaces            新建知识库
fetchPostTree(wsId?)     // GET  /api/posts/tree            按库取树(缺省默认库)
fetchDbStatus()          // GET  /api/admin/database        当前后端/连接配置/数据量
testDbConnection(p)      // POST /api/admin/database/test   测试目标后端连通性
switchDatabase(p)        // POST /api/admin/database/switch 迁移并切换（返回统一信封）
searchPosts(kw, wsId?)   // GET  /api/posts?keyword=        全文搜索
```

**文章详情 SWR 预取缓存**（提速核心，改详情加载逻辑时必读）：

```js
prefetchPost(id)       // 链接 hover/focus 时调用：GET /api/posts/id/<id>?no_view=1（不计浏览量），Promise 去重并发
takeCachedPost(id)     // 详情页挂载时同步读取已解析缓存（未决返回 null 不阻塞）
setCachedPost(id, d)   // 详情页正常拉取（计浏览）后回填缓存
invalidatePost(id)     // 编辑保存/删除后失效；LRU 上限 50 条
```

语义为 stale-while-revalidate：hover 已拉取的文章，点击瞬间用缓存渲染，详情页仍后台重拉覆盖（浏览计数只由这次计入）。

约定：列表/树接口条目**没有 `content` 字段**，需要正文时调 `GET /api/posts/id/<id>`（详见根目录 `api.md`）。

## 4. Markdown 渲染管线（md.js）

`MarkdownIt({ html: true, linkify: true, typographer: true, highlight: hljs })` + 插件：

task-lists(label)、footnote、emoji(**light 词典 150 个**，无 `:+1:`/`:rocket:`)、deflist、abbr、sub、sup、attrs、texmath(KaTeX, `dollars` 定界符)、container(`::: tip/info/warning/danger`)。

**定制渲染规则**（改渲染行为时更新此表）：

| 规则 | 行为 |
|---|---|
| `fence` | 包装为 `.code-block`（语言标签 + 复制按钮）；`mermaid` 输出 `.mermaid` div + `data-mermaid-source` 复制源；attrs 解析 `{.line-numbers}`(行号) 与 `{data-highlight="2,4-6"}`(行高亮) |
| `blockquote_open` | GitHub Alerts：首行 `[!NOTE|TIP|WARNING|CAUTION|IMPORTANT]` → `blockquote.github-alert-*` + emoji 图标（**同时剥离 children 首个 text token 的标记**，只改 content 无效） |
| `image` | 非 http/blob/data 的 src 改写为后端图片接口 URL（`/api/images/` 前缀→只补主机名，`/` 开头→absolute，否则→relative）；带 title 时包 `figure.image-figure` + `figcaption` |
| `inline: wiki_link` | `[[目标]]` / `[[目标\|显示文字]]` → `<a class="wiki-link" data-wiki-target>` 占位；目标=同库文章的 name 或标题（`buildWikiMap` 构建映射，name 优先）；`applyWikiLinks(html, map)` 二次解析出 href，未命中标记 `wiki-link-missing`（无 href 不可点）。代码块/行内代码内不生效 |
| render 后处理 | `==text==` → `<mark>`（先摘出 `<pre>/<code>` 再替换，避免误伤代码） |

渲染能力全清单（40+ 项）见根目录 `README.md` 的"Markdown 渲染能力"一节。

**mermaid 为异步渲染**：统一走 `md.js` 导出的 `renderMermaidDiagrams(dark)`——内部**动态 `import('mermaid')`**（不打进文章/编辑页首屏关键路径，正文文字先出，图表模块后台加载后补画）+ 模块级队列串行化（防主题切换/快速切换时并发 `run()` 互扰，单次失败不会毒化队列）。调用方：详情页 `MermaidRunner`、编辑器两页的 useEffect，均为 100ms 定时器后调用。详情页 `MermaidRunner` 挂在正文 div 内部、`key={html}`（内容真实变化即重挂重画）、只依赖 `[dark]`——内容区被重建的任何路径（切换文章 key 变化、骨架屏往返、SWR 内容更新）都会重新渲染图表；不要改回依赖 `[html]` 的旧写法（同一篇文章卸载重建时 content 字符串按值相等会命中 useMemo 缓存导致不重跑）。

## 5. 页面组件

### App.jsx（首页 + 路由 + 布局）
- `HomePage`：`fetchAllPosts` 全量拉取 → **按当前知识库过滤** → 卡片网格（骨架屏 loading）；Fuse.js 客户端搜索（仅当前库内）；**最近浏览**横条（`fetchRecentPosts(8)`，跨库，仅非搜索态显示）
- **WorkspaceSwitcher**（导航栏，`App.jsx` 内组件）：触发按钮（文件夹图标 + 当前库名截断 + 旋转箭头）→ 下拉面板（`animate-dropdown` 入场）：库名 + 文章数 + 选中态高亮（蓝点/蓝底）、"＋ 新建知识库"进入创建模式（面板内输入框 + 行内错误 + 取消/创建按钮，Enter 提交 Esc 取消）、点外部/Esc 关闭；选择或创建后 `history.replaceState` 更新 `?ws=` 并自动切换
- 顶部导航（**移动端自适应**：`<sm` 时 logo 文字与新建文字隐藏、搜索框收窄、导航允许换行成两行、知识库切换器全尺寸可见）：logo/知识库切换器/首页/管理/搜索框/主题切换/新建

### PostDetail.jsx（最重的页面）
- **数据**：先 `GET /api/posts/id/:id`（正文 + 得知所属知识库）→ 再 `GET /api/posts/tree?workspace_id=`（侧边栏树只含同库文章）；文章一到即解除内容区骨架，树在后台刷新。挂载时先查 `takeCachedPost`（hover 预取缓存）命中即渲染再后台刷新（SWR）；侧栏树链接/首页卡片/子文章卡均挂 `onPointerEnter/onFocus → prefetchPost`
- **切换文章只刷新内容区**：组件在同路由参数变化时保持挂载，导航/侧栏/TOC 外壳不动；仅首次进入（从未加载出文章）才显示整页骨架，之后切换时正文列显示内容级骨架、`key={post.id}` 重建内容 div 并淡入；滚动复位通过 `articleRef.scrollTo(0)` 显式处理（滚动容器被复用不会自动归零）；切换期间 TOC 传空数组避免显示旧文章标题
- **目录（TOC）**：对渲染后 HTML 的 h1~h6 注入 `heading-N` id，右侧生成锚点目录，`IntersectionObserver` 高亮当前节
- **侧边栏树**：树形展开/折叠、右键菜单（删除等）、dnd-kit 拖拽排序（乐观更新 + `PUT /reorder`（顶级需带 workspace_id）+ 失败回滚重拉同库树）
- **渲染**：`md.render(content)` 走模块级 `renderCache`（按正文内容 LRU 16 条，重访近期文章跳过整个渲染管线）+ `useMemo`；图片点击进入自研 lightbox（缩放/拖动）
- **双链**：`buildWikiMap(tree)` → `applyWikiLinks(html, map)` 解析 `[[...]]`（树异步到达后自动补 href）；正文内双链点击走事件委托 → SPA 导航（不整页刷新）；文末**反向链接**区（`GET /api/posts/id/:id/backlinks`，hover 预取）
- **单篇导出**：meta 行“导出”按钮（纯前端）——正文已在手，合成 YAML frontmatter + 图片 URL 绝对化（`/api/images/x` → `API_BASE + path`，导出文件在任意位置图片仍可访问）→ Blob 下载 `<name>.md`；全库 zip 备份在管理页
- **mermaid**：见上节
- **dangerouslySetInnerHTML 必须传稳定引用**（`proseProps = useMemo(() => ({ __html: html }), [html])`，编辑器两页同理 `previewProps`）：react-dom 的更新路径对 innerHTML 不做同值比较，行内对象字面量会让任何无关重渲染（树刷新/TOC 高亮/展开折叠）都整体重建正文 DOM——抹掉 mermaid.run 注入的 SVG 且无法自动恢复，还有整段 HTML 重新解析的性能开销

### CreatePost.jsx / EditPost.jsx（编辑器增强）
- `useEditorEnhancements`（共用 hook）：图片**粘贴/拖拽/工具栏按钮**上传（`POST /api/images/upload`，成功后光标处插入 `![alt](/api/images/x.png)`）、**预览同步滚动**（编辑区滚动→预览按比例跟随，用户滚预览时暂停 400ms；EditPost 需传 `active: !loading`——其编辑器在 loading 放行后才渲染）、块模板（表格/mermaid/代码块）
- 分栏为固定高 `h-[70vh]`：两栏各自内部滚动（长文工具栏常驻），同步滚动才有意义

### AdminPage.jsx（管理页）
- **状态卡**：当前后端徽章（SQLite/PostgreSQL）、文章数/日志数、数据目录（`fetchDbStatus`，PG 连接参数自动预填）
- **切换到 PostgreSQL**：连接表单（host/port/user/password/dbname）+ `测试连接`（成功显示 PG 版本，失败显示驱动错误）+ `切换并连接`
- **切回 SQLite**：PG 模式下显示一键切回
- **切换语义**：只换连接读目标库现有数据（空库自动初始化），不迁移数据、互不影响
- **切换后**：`restart_required=false`（开发模式自动重启）→ 提示并 3 秒后自动刷新；`true`（生产）→ 提示手动重启
- **导出备份**：`导出 Markdown 备份 (.zip)` 按钮 → `fetchExportZip()` 拉 blob 触发下载（见 api.md 导出一节）

### CreatePost.jsx / EditPost.jsx
- 表单字段：标题、name（英文名，前端校验格式，**同库内唯一**）、所属知识库下拉（`?ws=` 预选，切换库时清空父文章）、正文（`#md-editor` textarea + 工具栏插入语法）、摘要、父文章（**同库**树的扁平化下拉，过滤自身与子孙）、状态
- **编辑器快捷键**（`useEditorShortcuts`，两页共用）：`Ctrl/Cmd+S` 保存/发布、`Ctrl/Cmd+B` 加粗、`Ctrl/Cmd+I` 斜体、`Ctrl/Cmd+K` 插入链接、正文内 `Tab` 两格缩进；B/I/K 仅在正文区/页面空白处生效，不干扰标题等普通输入框
- **实时预览**：`md.render` + mermaid.run，与详情页同一管线
- Edit 先拉详情再按库拉树（父文章选项仅同库）；提交 `PUT /api/posts/id/:id` 后跳回详情

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
| FPS 徽章 | `FPSMeter`（`App.jsx`）：右上角固定小徽章，rAF 帧间隔 500ms 滑动窗口统计实时帧率，`pointer-events-none` 不挡交互。**帧率自适应无需实现**——本应用动画全部为 CSS 合成器驱动，天然按屏幕 vsync 跑（170Hz 屏即 170fps）；浏览器对遮挡/后台窗口会把 rAF 节流到 1Hz，属预期行为 |

## 7. 构建与部署

```bash
npm run dev                          # 开发（60101，热更新）
npm run build                        # 生产构建 → dist/（主入口 ~197KB/gzip ~61KB，重依赖按路由分块）
npx vite preview --host 0.0.0.0 --port 60101   # 静态服务 dist
bash shell/frontend/start.sh         # 一键：build + preview（生产模式）
bash shell/frontend/start.sh dev     # 一键：dev server
```

**改前端的验收门槛**：`npm run build` 零报错 + 浏览器过一遍首页/详情/新建/编辑四页（详见 AGENTS.md 验证清单）。

## 8. 已知限制

1. 单包无路由级 lazy / 无 vendor 分包，首屏体积大（历史优化清单遗留项）
2. mermaid/KaTeX 静态导入三个页面，无法按需加载
3. highlight.js 全量语言包导入（未用 `lib/core` 按需注册）
4. 凭据在 `api.js` 源码中（bundle 可见）
5. 无 404 兜底页（`/archive` 死链已从导航移除，路由仍未注册）
6. 生产模式下管理页切换数据库后需手动重启后端（页面有提示）
7. 开发模式下连续改动源文件后，Vite 依赖重优化窗口内 mermaid 偶发不渲染（刷新即恢复，仅 dev，生产预打包不受影响）
