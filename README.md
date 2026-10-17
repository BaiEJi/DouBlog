<p align="center">
  <h1 align="center">DouBlog</h1>
  <p align="center">前后端分离的单用户博客 / 知识库系统，树形文章结构 + 全功能 Markdown 渲染</p>
</p>

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | **AI 代理/协作者工作指南**：命令、验证清单、**文档同步规则**（改代码必读） |
| [api.md](api.md) | HTTP API 契约：认证、文章/日志/图片接口、错误码、实测示例 |
| [backend.md](backend.md) | 后端架构：数据模型、树形设计、双数据库切换、中间件、测试 |
| [frontend.md](frontend.md) | 前端架构：API 层、Markdown 渲染管线、页面组件、构建部署 |
| [backend-prompt.md](backend-prompt.md) | ⚠️ 历史存档（开发期 AI 提示词，不随代码更新） |

> **贡献约定**：修改代码时按 [AGENTS.md](AGENTS.md) 的"文档同步规则"在同一批改动中更新对应文档。

## 项目简介

> **⚠️ 前端不适配移动端**（2026-10-17 起）：已移除全部移动端适配（侧栏抽屉、响应式断点、触屏拖拽分支、viewport meta），所有页面按桌面宽屏单态布局渲染，手机访问得到的是缩放的桌面视图。新增前端页面禁止引入 `sm:/md:/lg:/xl:` 断点类或移动端专属 UI。

DouBlog 是一个单用户个人系统，**`/` 为统一入口（工作台，13 卡可拖拽分组）**：卡片点进对应系统——博客/知识库（`/blog`，含**资产库** tab `/assets`（Prompt 与 Skill、变量填充 `{{name}}`、版本快照与恢复、行级 diff、分类标签、使用统计、导入导出、Skill 包上传）、**日记** tab `/diary` 与**书签·稍后阅读** tab `/bookmarks`）、剧情图谱（`/gamemap`）、待办四象限（`/todo`，MyTodo 迁入）、刷题·算法练习（`/practice`）、Steam 挂机（`/steamidler`）、订阅管理（`/subs`）、密码库（`/vault`）、API Hub（`/apihub`，聚合异构上游 + QQ 官方机器人消息推送 `qq/send-c2c`）、日志查询（`/logs`）、系统配置（`/config`）、**配置中心**（`/confcenter`，namespace→key→value + Redis 缓存）、**Clash 代理**（`/clash`，clashctl + Web 控制台全能力迁移：内核启停/系统代理/Tun/订阅/Mixin/密钥/升级 + 代理组切换/延迟测速/连接管理/规则/运行时配置——zashboard 同源；未安装 clashctl 时门户卡片置灰）、**开发者工具箱**（`/devtoolbox`，31 工具 8 分类：JSON 格式化/Diff/⇄YAML/⇄CSV/转代码/转义、文本对比/统计/命名转换/行处理/占位文本、Base64/URL/HTML实体/Unicode/字符集互转（乱码修复）、哈希（MD5/SHA 全家/HMAC）/JWT 解码/密码生成、时间戳/Cron、UUID/进制/单位/颜色/二维码、URL 解析/IPv4 子网、正则测试/Markdown 预览/速查表；除 4 类后端计算外全部浏览器本地完成）。

- **后端** FastAPI（uvicorn 单进程），提供文章 CRUD、树形结构、图片服务、浏览计数、操作审计；日志与并发池统一走 [LizySDK](https://github.com/BaiEJi/LizySDK)；**SQLite / PostgreSQL 双数据库一键切换**（`/config` 总配置页，只换连接读新数据，不迁移，随时可切回）；所有模块同库存储，表名规则 `模块名_表名`（如 `blog_posts`，存量库启动时自动改名）
- **前端** React 19 + Vite 8 + Tailwind CSS 4，集成 markdown-it 全家桶渲染、KaTeX 数学公式、Mermaid 图表、代码高亮
- **多知识库**：文章按知识库分组隔离（首页切换器一键新建/切换，`/?ws=<id>` 记忆当前库）
- **全文搜索**：关键词匹配标题/摘要/英文名/正文，跨知识库，`Ctrl+K` 快速聚焦
- **双链 `[[wiki]]` + 反向链接**：`[[英文名]]`/`[[标题]]`/`[[名|显示文字]]` 三种写法，文末自动聚合"谁链接了我"
- **图片上传**：编辑器内粘贴/拖拽/按钮上传（自动插入 Markdown），10MB 上限 + 类型白名单
- **最近浏览**：首页按最近阅读横条快速回访（跨知识库，hover 预取不虚增浏览量）
- **导出备份**：单篇页“导出”按钮下载该文 `.md`（frontmatter + 图片 URL 绝对化）；通过 `GET /api/export/markdown` 下载全库 Markdown + 图片 zip（树形目录 + frontmatter，Obsidian 可直接导入）
- **编辑器**：快捷键（`Ctrl+S` 保存、`Ctrl+B/I` 加粗斜体、`Ctrl+K` 链接、`Tab` 缩进）、预览同步滚动、表格/图表/代码块模板
- **书签与稍后阅读**（知识库模块 tab `/bookmarks`，2026-10-17 自独立模块并入 blog）：**分类树**（≤3 层文件夹）+ **条目状态机**（未读→阅读中→已读/归档/星标）+ 标签；**URL 规范化查重**（剥 utm 追踪参数）；**收录表单一键抓取页面元信息**；**离线快照**（HTML→Markdown 正文抽取，原文删帖也不怕，列表页不传大字段）；**死链批量检测**（可达/失效/异常三态标记）；**阅读队列**（"下一篇"英雄卡）；**统计**（状态分布/30 天趋势/分类·标签·站点 TOP）；**导入导出**（Netscape 浏览器书签格式 + JSON 全量备份，重复自动跳过）；回收站（还原/彻底删除）
- **订阅管理**（`/subs`，CrownFlow 全量迁移）：**会员主表 + 多订阅记录**（一次购买/续费一条：价格/币种 5 种/计费周期 4 种/起止/渠道）按自定义分类（emoji+颜色）组织；**支出统计**（日均×重叠天数折算 CNY 静态汇率；概览/分类汇总/趋势 day·week·month·quarter 粒度）；**到期提醒**（按会员 reminder_days 阈值）与**订阅到期日历**（农历/法定节假日/当日徽标）；会员支出排行榜（4 维度）、订阅时间轴（3m/6m/12m/全部+今天线）、表格/卡片双视图；**每日 02:00 自动备份**（90 天保留，可手动触发）
- **私人日记**（知识库模块 tab `/diary`，Memos × Day One 超集，2026-10-17 自独立模块并入 blog）：**随记分日记本**（预置 日常🏡/工作💼/感悟🌱，可自建；随记必选本，录入框内直接切换）+ **每日总结**（每天一篇 upsert，总结卡置顶日期组、随记带连接线挂在总结之后）；侧栏工作台（视图/日记本含计数）+ 快捷录入（**本子**/心情/模板/**每日引导问题**/**天气位置一键记录**）；置顶/归档/**回收站**；**年度热力图**、**那年今日**、统计图表（连续/每月字数/心情趋势/**年度回顾**）；单篇**免登录分享链接**（可撤销/有效期）；一句话快速录入 API + 全量 Markdown 导出
- **密码库**（`/vault`，零知识端到端加密）：Argon2id 派生 + AES-256-GCM，服务端只存密文；**TOTP 验证码生成**（RFC 6238，30s 环形倒计时 + 一键复制，编辑器粘贴 otpauth:// 自动解析）、**HIBP 泄露检查**（k-anonymity，仅上传 SHA-1 前 5 位，结果本地缓存）、**健康总评分**（0-100 环，按泄露/弱/复用等加权扣分，点击下钻）、**安全附件**（前端 VEK 加密上传/下载/删除，5MB/文件，purge 级联清理）、密码历史（改密自动归档）、身份（邮箱/手机 → 关联账号）、密码/口令短语生成器 + 编辑器实时强度条、安全中心（泄露/弱/复用/过旧/**到期提醒**/无 2FA/重复/缺恢复，全客户端分析）、**密码到期提醒**（条目可设 N 天周期，超期概览横条+详情徽标）、⌘K 全局搜索、自动锁定、Recovery Key、加密备份导入导出；全中文界面，三面板布局，明暗主题
- **密码服务**（密码库内子模块）：为项目提供**自动轮换密码**（30s~10min）与机器校验 API——项目 → 用户类型（密码策略）→ 用户（**每用户独立密码链**）；密码不落盘、由 seed+时间窗口确定性推导（TOTP 思路），上一窗口 **30 秒宽限**；`POST /api/pwsvc/validate`（X-Api-Key）供第三方服务校验；**校验限流**（页面可配，默认 120 次/分钟）+ **校验日志与失败统计**（项目页时间线，保留 30 天，永不含密码内容）；设计见 `docs/pwsvc-design.md`
- **API Hub QQ 机器人接入**（2026-10-17）：`qq_bot` 动态令牌鉴权（token 进程内缓存自动刷新）+ 全局出站代理（`/config` 页配置，QQ 域名直连不通时走 Clash）+ API 参数默认值（openid/msg_type 可不传）——`POST /api/apihub/gw/apis/qq-send-c2c` 传 `{"content": "..."}` 即推送 QQ 私聊，见 api.md 第 14 章
- **模块化日志上报**：每个模块独立 sys_name（doublog.blog（含资产/日记/书签子域）/vault/…），WARNING+ 按标准 HTTP 发往日志查询模块，**服务地址/开关/级别在系统配置页 `/config` 配置**（即时生效）
- **日志接收**（`/logs`，lizysdk 配套）：接收 `lizysdk` `send_json=True` 的 JSON 日志（单条/批量），队列+单写者批量落库、坏日志死信兜底（不丢已接收日志）、按保留期自动清理；存储跟随设置页数据库；SDK 侧 `send_url="http://host:60100/api/v1/logs"` 即装即用。查询页为完整日志探索界面（对齐 Datadog/Better Stack 主路径，调研见 `docs/logs-benchmark.md`）：**时间直方图**（级别分色，点击柱/拖拽框选缩放）、相对时间 chips、**Live Tail**（3s 轮询增量置顶）、**日志上下文**（前后各 N 条，锚点高亮）、**一键字段过滤**（⊕/⊖）、搜索词高亮、级别统计 chips、**保存的查询集**、URL 同步查询状态、导出 CSV/JSON、多行堆栈折叠、**模式分组**（相似消息模板归并）、键盘导航（j/k/Enter//）、无限滚动+加载更多、**日志告警**（阈值规则+webhook 通知+事件确认）、**trace 时间线**（同 trace_id 点阵+偏移）
- **LizySDK 接入**（[BaiEJi/LizySDK](https://github.com/BaiEJi/LizySDK)）：后端日志经 lizysdk 落盘 `data/logs/doublog.log`（INFO+，轮转）并**自摄**——INFO+ 全量回灌自身 `/api/v1/logs`（2026-10-13 起默认全量采集；含每请求 access 日志，trace 贯穿同请求全部记录；系统配置页可切回仅 WARNING），日志查询页实时检索本服务全部日志；API 异常统一走 SDK 的 `AppError` 家族（响应 `data.error_code` 携带 SDK 错误码）
- **配置中心**（`/confcenter`）：先创建 namespace，再从左侧进入空间管理 KV；空空间独立保留；value={type,data}（str 原样/json 校验，type 可变更）；Redis 读穿缓存（未配置/不可达自动降级直连 DB，配置页可启停/测试/清空）
- **四象限待办**（`/todo`，MyTodo 迁入）：今日看板（拖拽跨象限/象限内排序）、待办池（收件箱/待迁移/已搁置+干预三选）、日历（周/月/年）、回顾与统计（streak/热力图/趋势）、**规律生活计划**（四循环规则自动物化任务+打卡）、任务级邮件提醒；数据已从 MyTodo 全量导入（2500 任务）；Chrome 扩展与 Android 客户端平迁至仓库 `extensions/todo/`（仍对接旧 8070 协议，见 docs/modules/todo.md 已知边界）
- **剧情图谱**（`/gamemap`，独立模块，gamemap 迁入）：React Flow 关系画布（拖拽存档/关系线/跨章聚合）、人物档案/图鉴、剧情事件时间线、关系类型配置、整游戏备份导入导出
- **刷题练习**（`/practice`，独立模块）：题解/代码/标签管理、艾宾浩斯复习、一键抓题（LeetCode/洛谷）
- **Steam 挂机**（`/steamidler`，独立模块，steam-idler 迁入）：账号登录挂机、时长统计、运行日志
- **资产库**（知识库模块 tab，`/assets`，2026-10-17 自独立模块并入 blog）：**Prompt 与 Skill 双类型**（`{{变量}}` 声明 + 详情抽屉变量填充台 + 填充值本地记忆）；**版本管理**（内容变更即快照、行级 diff、一键恢复）；分类/标签/收藏/归档/回收站；批量操作；使用统计（copy/fill/export 计数、30 天趋势、最常用 TOP5）；导入导出（upsert/create + dry_run 预检，分类按名自动建）；**Skill 包上传**（单文件或 zip：规格校验、描述自动提取、可展开文件树 + 宽幅弹窗查看、原包下载）
- **统一导航（仅桌面）**：业务模块共用 220px 常驻多级侧栏，内容画布尺寸统一；文章编辑与预览左右分栏
- 文章支持**最多 3 层**父子结构（`MAX_LEVEL = 2`，即 level 0/1/2），侧边栏树形展示、拖拽排序
- **统一登录**：`/login` 登录一次全站生效（HttpOnly 会话 Cookie，30 天）——所有模块免二次登录；密码库的"主密码解锁"是零知识加密的解密步骤而非登录；Basic Auth 保留为 API/脚本/测试通道

## 技术栈

| 层级 | 技术 |
|---|---|
| 后端框架 | FastAPI 0.143（uvicorn 单进程，60100） |
| ORM / 数据库 | SQLAlchemy 2.0 / SQLite（WAL 模式） |
| 认证 | 统一登录：会话 Cookie（HMAC 签名，30 天）+ Basic 兼容（`require_basic` 双通道） |
| 日志/异常/并发池 | lizysdk（basekit）：logs / errors(AppError) / pools |
| 数据库 | PostgreSQL 17（psycopg2，默认 117.72.98.99:50002/app_dev）/ SQLite（WAL，可切换） |
| 前端框架 | React 19 + React Router 7 |
| 构建 | Vite 8 |
| 样式 | Tailwind CSS 4 |
| Markdown | markdown-it 14 + 12 个插件 |
| 数学公式 | KaTeX（`$...$` / `$$...$$`） |
| 图表 | Mermaid 11 |
| 代码高亮 | highlight.js（common 常用语言子集） |
| 搜索 | Fuse.js（客户端模糊搜索） |
| 拖拽排序 | dnd-kit |
| 农历（订阅到期日历） | lunar-javascript |

## 项目结构

```
DouBlog/
├── README.md
├── api.md                    # API 协议文档
├── backend.md                # 后端设计文档
├── backend-prompt.md         # 后端 AI 开发提示词
├── backend/                  # 后端 (FastAPI/uvicorn)
│   ├── run.py                # 启动入口 (端口 60100，dev 模式 --reload)
│   ├── requirements.txt
│   ├── migrate_children_order.py  # 旧数据迁移脚本（虚拟根节点）
│   ├── app/
│   │   ├── main.py           # FastAPI 应用工厂 + gzip/CORS + 统一异常信封 + 动态模块注册
│   │   ├── config.py         # 配置
│   │   ├── db.py             # 纯 SQLAlchemy：双后端 + 表名规范(模块名_表名,存量自动改名) + run_db
│   │   ├── shared/           # 公共层：response / auth(require_basic) / pools(lizysdk) / timestamps / timeutil(todo+practice 共用) / logging_setup / modules
│   │   ├── blog/ vault/ pwsvc/ sdklogs/ subs/ apihub/ system/ todo/ gamemap/ practice/ steamidler/ confcenter/ clash/ devtoolbox/  # 能力包（models+routes；导出 router/start_background/ensure_migrations；clash 与 devtoolbox 无表；blog/ 下含 assets 资产库、diary 日记、bookmarks 书签三个子包）
│   └── tests/                # pytest（与能力包镜像分层，自包含）
├── extensions/todo/           # MyTodo 客户端平迁：chrome-extension/ + android/（仍指旧 8070）
├── frontend/                 # 前端 (React)
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js        # 端口 60101
│   └── src/
│       ├── main.jsx / index.css
│       ├── app/              # 壳：App.jsx（路由表 + 主题 + 全局行为）+ LoginPage.jsx
│       ├── shared/           # 公共层：client.js（后端地址唯一处）+ md.js（渲染管线）+ PageHeader.jsx
│       ├── portal/           # / 工作台门户（dnd 分组布局）
│       ├── blog/             # /blog /post /create：api + pages×4 + editor×2（快捷键/图片上传）
│       ├── vault/            # /vault：VaultPage + api + components（crypto/core/ui/密码服务）
│       ├── logs/ subs/ apihub/ config/ confcenter/   # 其余能力包（api + 页面 + 组件）
│       ├── todo/             # /todo：TodoPage + views×11 + kit + charts（kit/charts 被 gamemap/practice/steamidler/bookmarks 跨模块引用）
│       ├── gamemap/          # /gamemap：GamemapShell（antd6/@xyflow 保留栈）+ board/ + pages/
│       │   ├── assets/        # /assets 资产库（blog 模块 tab）：AssetsPage + api + kit + components（详情抽屉/编辑器/填充/版本/导入导出/统计）
│       │   ├── diary/           # /diary 日记（blog 模块 tab）：DiaryPage + PublicShare + api + kit + components×8
│       │   └── bookmarks/       # /bookmarks 书签（blog 模块 tab）：BookmarksPage + BookmarksView（五视图）+ api + components（表单/详情/分类管理）
│       ├── practice/         # /practice：PracticePage + PracticeView + components/
│       ├── steamidler/       # /steamidler：SteamIdlerPage + SteamIdlerView + components/
│       ├── clash/            # /clash：ClashPage（总览/订阅/配置/日志）+ api.js
│       └── devtoolbox/       # /devtoolbox：DevToolboxPage + registry + kit + lib×5 + tools×31
├── data/                     # 运行时数据（gitignore）
│   ├── blog.db               # SQLite 数据库
│   ├── pwsvc.key             # 密码服务 seed 加密密钥（自动生成）
│   └── dead_letters/          # 日志摄入死信（JSONL，可重放）
│   └── images/               # 图片文件
└── shell/                    # 管理脚本（Linux/macOS/Git Bash）
```

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 18+
- PostgreSQL 17（默认）：`117.72.98.99:50002/app_dev`（用户 `lizy`）；也可在系统配置页 `/config` 一键切回本地 SQLite（零配置）

### 1. 启动后端（端口 60100）

```bash
cd backend
python -m venv venv
venv/Scripts/activate        # Windows
# source venv/bin/activate   # Linux/macOS
pip install -r requirements.txt
python run.py
```

首次启动自动建表、播种虚拟根节点（id=0）、创建"默认知识库"并把存量文章归入其中（幂等迁移）。

### 2. 启动前端（端口 60101）

```bash
cd frontend
npm install
npm run dev
```

### 3. 访问

打开 **http://localhost:60101**

默认账号：`admin` / `lizy111A`

> 前端不经过代理，直接请求 `http://{当前主机名}:60100`（CORS 凭据模式，来源收敛 `:60101`）。
> **统一登录**：打开前端即进 `/login`，登录一次签发会话 Cookie（30 天）全站生效；前端 bundle 不再持有任何凭据。Basic Auth 仅作为 API/脚本/测试的兼容通道。

## 生产部署

开发脚本只适合本机调试；对外提供服务请使用构建产物：

```bash
cd frontend
npm run build               # 产物在 frontend/dist/
npx vite preview --host 0.0.0.0 --port 60101   # 或交给 nginx 等静态服务器
```

或使用管理脚本（自动定位项目目录）：

```bash
bash shell/backend/start.sh          # 启动后端
bash shell/frontend/start.sh         # 构建 + preview 启动前端（生产模式）
bash shell/frontend/start.sh dev     # 前端开发模式（Vite dev server）
bash shell/backend/status.sh         # 查看状态
bash shell/backend/stop.sh           # 停止
```

> 注意：`backend/app/config.py` 中 `debug=True` 与 `host='0.0.0.0'` 仅供开发使用，公网部署务必关闭 debug 并收敛监听地址与 CORS。

## 配置说明

### 后端（`backend/app/config.py`）

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `host` / `port` | `0.0.0.0` / `60100` | 监听地址 |
| `debug` | `True` | 调试模式（生产必须关闭） |
| `cors_origins` | `*` | ⚠️ 死配置：中间件实际用 `allow_origin_regex ^https?://.*:60101$` + 凭据模式，不读此项 |
| `auth_enabled` | `True` | 是否启用认证 |
| `auth_username` / `auth_password` | `admin` / `lizy111A` | **仅首次播种默认**——凭据实际存 `system_accounts` 表（PBKDF2 哈希），`/config` 页可改 |
| `database_backend` | `postgres` | 默认后端（运行时以 `data/db_config.json` 为准） |
| `postgres_host/port/user/password/dbname` | `117.72.98.99/50002/lizy/lizy111pg/app_dev` | PG 连接默认值 |
| `data_dir` / `images_dir` | `<根目录>/data[/images]` | 数据与图片目录 |
| `max_page_size` | `100` | 分页上限 |

### 前端

- 端口：`vite.config.js` 中 `server.port = 60101`
- 后端地址：`src/shared/client.js`（全项目唯一持有处；凭据不进前端，认证走会话 Cookie）

## API 概览

统一响应格式：`{ "success": bool, "code": int, "message": str, "data": any }`（orjson 渲染，NaN→null）；认证=统一登录（会话 Cookie 或 Basic；免认证例外：图片 GET、sdklogs 摄入、日记分享、apihub gw）；JSON 响应超过 1KB 自动 gzip。

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/auth/login` | 登录校验 |
| `GET` | `/api/auth/check` | 检查认证状态 |
| `GET` | `/api/posts` | 文章列表（分页；**不含正文**；`?workspace_id=` 按库筛选） |
| `GET` | `/api/posts/tree` | 文章树（**不含正文**，按知识库返回，缺省 = 默认库） |
| `GET` | `/api/posts/id/<id>` | 详情（含正文，自增浏览量；`?no_view=1` 预取不计） |
| `GET` | `/api/posts/recent?limit=` | 最近浏览（跨库，按时间倒序） |
| `GET` | `/api/posts/id/<id>/backlinks` | 反向链接（同库内 `[[双链]]` 指向该文章的列表） |
| `GET` | `/api/posts/slug/<name>` | 按英文名查详情 |
| `GET` | `/api/posts/path/<slug>` | 按路径查详情（兼容旧版） |
| `POST` | `/api/posts` | 创建 |
| `PUT` | `/api/posts/id/<id>` | 更新（改名/移动会级联更新子孙 slug） |
| `DELETE` | `/api/posts/id/<id>[?recursive=1]` | 删除（默认子文章提升为顶级；recursive 级联删除） |
| `PUT` | `/api/posts/reorder` | 拖拽排序 |
| `GET` | `/api/posts/audit-logs` | 操作日志（分页） |
| `GET` | `/api/images[...]?type=` | 图片服务（见下） |
| `POST` | `/api/images/upload` | 上传图片（multipart `file`，返回可写入 Markdown 的 url） |
| `GET` | `/api/export/markdown` | 导出全库 Markdown + 图片 zip 备份 |
| `ANY` | `/openapi/{一级分组}/{二级分组}/{api名称}` | **OpenAPI 发布入口**（apihub 平台令牌 sk-；服务内 API 已发布为 `self/<模块>/**`；路径变量经同名 query 参数传入） |
| `GET` | `/openapi/{…}/{api名称}/doc` | OpenAPI 的完整 Markdown 文档（公开） |
| `GET/POST` | `/api/diary/entries` | 随记列表（?date/?search/?journal_id/?mood，总结在前随记挂后）/ 新建随记（**journal_id 必填**） |
| `PUT/DELETE` | `/api/diary/entries/<id>` | 更新（自动保存）/ 删除 |
| `POST` | `/api/diary/summary` | **每日总结 upsert**（每天一篇，body: entry_date+content[+mood]，返回 created 标志） |
| `GET/POST/PUT/DELETE` | `/api/diary/journals[...]` | 日记本管理（预置 日常/工作/感悟，存量随记自动归入日常） |
| `GET` | `/api/diary/dates?year=&month=` | 日历视图（每天篇数+心情） |
| `GET` | `/api/diary/stats` | 写作统计（连续天数/总篇数/总字数） |
| `GET/POST/PUT/DELETE` | `/api/vault/*` | 零知识密码库（账号材料/条目密文 CRUD/回收站/审计/备份），见 api.md |
| `GET/POST` | `/api/vault/items/<id>/attachments` | **安全附件**（零知识密文，明文 ≤5MB 双端校验；软删保留/purge 级联；`GET/DELETE /attachments/<aid>` 单取/删除） |
| `GET/POST/PUT/DELETE` | `/api/pwsvc/*` | 密码服务：项目/类型/用户管理与当前密码（Basic Auth），见 api.md |
| `POST` | `/api/pwsvc/validate` | **轮换密码校验**（`X-Api-Key` 认证，供第三方服务；30s 上一窗口宽限；限流超额 429） |
| `GET` | `/api/pwsvc/projects/<id>/logs` | 校验日志分页 + 失败统计（近 1h/24h、失败 TOP5） |
| `POST` | `/api/v1/logs(/batch)` | **日志摄入**（lizysdk send_json 接收端；202 异步落库；可选 Bearer token） |
| `GET` | `/api/v1/logs(/count)` | 日志检索/计数（时间/系统/级别/trace/全文/任意 kv 字段过滤） |
| `GET` | `/api/v1/logs/histogram` | **时间直方图**（等宽时间桶 × 级别计数，过滤条件与检索共用） |
| `GET` | `/api/v1/logs/context?id=&before=&after=` | **日志上下文**（锚点行前后各 N 条，时间升序） |
| `GET` | `/api/v1/logs/patterns` | **模式分组**（数字/uuid/ip/路径占位化归并相似消息，按频次排序） |
| `GET` | `/api/v1/logs/export?format=csv|json` | **导出**当前查询（流式，上限 1 万条） |
| `GET` | `/api/v1/logs/trace?id=` | **trace 时间线**（同 trace_id 日志升序 + 跨度） |
| `GET/POST/PUT/DELETE` | `/api/subs/*` | **订阅管理**（CrownFlow 迁移）：会员/订阅记录/分类 CRUD、支出统计、到期提醒、备份，见 api.md 第 13 节 |
| `GET/PUT/POST` | `/api/v1/alerts(/config|/check|/ack)` | **日志告警**：阈值规则（级别/条数/窗口/冷却/系统/webhook）+ 立即检查 + 事件确认（每 60s 自动巡检） |
| `GET` | `/api/v1/stats` | 日志统计（近 24h 计数、队列/丢弃/死信指标） |
| `GET` | `/api/admin/database` | 数据库状态（当前后端/数据量） |
| `POST` | `/api/admin/database/test` | 测试目标数据库连通性 |
| `POST` | `/api/admin/database/switch` | **只换连接切换后端**（SQLite ↔ PostgreSQL，不迁移数据），`/config` 页操作 |
| `GET/POST/PUT/DELETE` | `/api/clash/*` | **Clash 代理管理**（clashctl 全能力 Web 迁移 + mihomo 控制器：代理组/测速/连接/规则/热配置），见 api.md 第 20 节 |
| `GET/POST` | `/api/devtoolbox/*` | **开发者工具箱计算端**（哈希/HMAC、字符集互转乱码修复、JSON⇄YAML、二维码），见 api.md 第 24 节 |
| `GET/POST/PUT/DELETE` | `/api/assets/*` | **资产库**（blog 模块子域：Prompt/Skill CRUD、版本恢复、批量、标签、统计、导入导出），见 api.md 第 21 节 |
| `GET/POST/PATCH/DELETE` | `/api/bookmarks/*` | **书签与稍后阅读**（blog 模块子域）：分类树/条目 CRUD 与状态机/标签/查重/快照/死链检测/队列/统计/导入导出（Netscape HTML + JSON），见 api.md 第 22 节 |

### 图片服务规则

- **上传**：`POST /api/images/upload`（multipart 字段 `file`），白名单 png/jpg/jpeg/gif/webp/bmp/avif（不含 svg），单文件 ≤10MB，随机文件名落盘 `data/images/`，返回 `{url}`
- `type` 缺省：从 `data/images/` 目录解析
- `type=relative`：相对项目根目录
- `type=absolute`：绝对路径
- **安全约束**：所有路径经 realpath 归一化后必须落在项目根目录（或 images 目录）围栏内，且扩展名必须在白名单（png/jpg/jpeg/gif/webp/svg/ico/bmp/avif）内，否则 404

## Markdown 渲染能力

文章正文由 `frontend/src/md.js` 渲染，支持（共 40+ 项，均经实测）：

- **基础**：6 级标题（ATX/Setext）、粗体、斜体、删除线、行内代码、两种硬换行、转义、有序/无序/嵌套/任务列表、引用（嵌套）、GFM 表格（三种对齐）、三种分隔线
- **链接图片**：行内/引用式链接、自动链接、裸 URL 与邮箱自动识别、图片标题自动生成 figure 图注、行内 HTML 直通、HTML 实体
- **代码块**：190+ 语言高亮 + 语言标签 + 复制按钮、`~~~` 围栏、`{.line-numbers}` 行号、`{data-highlight="2,4-6"}` 行高亮
- **扩展**：`==高亮==`、上下标 `H~2~O` / `X^2^`、脚注（含行内脚注）、定义列表、缩写、`::: tip/info/warning/danger` 容器、GitHub Alerts（5 种）、`{#id .class}` 属性
- **图表公式**：Mermaid（流程图/时序图等）、KaTeX 行内与块级公式（含矩阵）
- **双链**：`[[文章英文名]]` / `[[文章标题]]` / `[[名|显示文字]]`（同库解析，未找到显示灰色虚线；代码块内不生效）
- **智能排版**：`(c)`→©、`--`→–、`...`→…、智能引号等
- **Emoji**：`:name:` 代码（内置 light 词典 150 个，注意 `:+1:` `:rocket:` 等**不在**词典内）+ `:)` `<3` 等颜文字快捷转换

## 测试

```bash
cd backend
python -m pytest tests/ -q
```

测试完全自包含（每用例独立临时 SQLite，无外部依赖）；日志接收模块另带压测工具 `backend/tools/sdklogs_loadtest.py`（隔离实例实测摄入/写入/查询吞吐）；其中 SQLite ↔ PostgreSQL 切换往返的集成测试需要 venv 内安装 `pgserver`（内嵌 PG，`pip install pgserver`），未安装时自动跳过。

## 已知限制

- **前端不适配移动端**：2026-10-17 移除全部移动端适配（设计决策，非待修复项），仅保证桌面浏览器体验
- 单用户系统：会话 Cookie 未设 Secure、secret_key 为默认值、无服务端会话撤销——公网部署前需加固（详见 docs/modules/system.md 已知边界）
- 文章层级上限 3 层（`MAX_LEVEL = 2`）
- 无 404 兜底页（`/archive` 死链的导航入口已移除，路由仍未注册）
- 路径参数类型差异：非整数路径段（如 `/api/posts/id/abc`）返回 400「请求参数错误」（Flask 时代为 404）
- gzip 现作用于一切 ≥1KB 响应（按 Accept-Encoding；Flask 时代仅 JSON/文本）

### 前端本地验收配置

默认 API 地址仍为当前主机的 `60100`。开发时可设置 `VITE_API_BASE=/`，通过 Vite 的 `/api` 与 `/openapi` 代理使用同源请求；`VITE_API_PROXY` 可指定独立后端（默认 `http://127.0.0.1:60100`）。生产构建采用相对 API 地址时，部署服务器也需要配置相同路径的反向代理。界面与性能验收记录见 [docs/ui-qa-2026-10-13.md](docs/ui-qa-2026-10-13.md)；书签模块验收见 [docs/ui-qa-2026-10-16.md](docs/ui-qa-2026-10-16.md)。
