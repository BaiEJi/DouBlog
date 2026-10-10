# diary 模块文档（私人日记，Memos × Day One 超集）

> 位置：后端 `backend/app/diary/`（models + routes）、测试 `backend/tests/diary/`、前端 `frontend/src/diary/`
> 表：`diary_diaries` / `diary_journals`（同库存储，表名规则 `模块名_表名`）
> 路由前缀 `/api/diary`，除 `GET /api/diary/share/{token}` 免登录外全部挂 `Depends(require_basic)`（会话 Cookie 优先，Basic 兼容）
> 与文章体系（blog）零耦合。本文档按 2026-10-10 代码现状生成。

---

## 1. 功能概述

单用户私人日记，"随记（note）+ 每日总结（summary）"两种条目共存：

| 能力 | 说明 |
|---|---|
| 随记分本 | 随记必须归属一个日记本（DiaryJournal，预置 日常🏡/工作💼/感悟🌱，可自建/改名/排序）；每日总结不属于任何本（journal_id=NULL） |
| 每日总结 upsert | `POST /api/diary/summary` 每天一篇：当天已有未删除总结则整包更新，否则新建（返回 `created` 标志）；时间线里总结排在当天随记之前 |
| 置顶 / 归档 | `PUT ?action=pin/unpin/archive/unarchive`；置顶条目排时间线最前；归档从时间线移入归档视图（archive 同时取消置顶） |
| 回收站软删 | DELETE = 软删除（deleted_at 置位、取消置顶）；`?hard=1` 彻底删除（仅回收站内允许，且先清分享字段）；`?action=restore` 恢复 |
| 分享 token | 单篇免登录只读链接（token_urlsafe(24) + 有效期 1h~1 年）；过期/撤销/进回收站一律 404，不泄露存在性 |
| 快速录入 | `POST /api/diary/quick` 一句话打卡（外部脚本/快捷指令），服务端取当天日期，journal_id 必填 |
| 热力图 / 日历 | 年度每天篇数+心情色阶（含归档）；月历每天篇数+当天最好心情（不含归档） |
| 那年今日 | 往年同月同日条目（至多 20 条）；不足 3 条时从最近 300 条旧记忆中按日期确定性挑 1 条 |
| 趋势 / 年度回顾 | 近 N 月（1-36）每月篇数/字数/心情均值（缺月补零）；年度篇数/字数/心情分布/最长连续/最活跃月 |
| 统计 | 总篇数/总字数/当前连续/最长连续/本月篇数/本数（口径均排除回收站与归档） |
| 导出 | 全量 Markdown zip（按 `本子/日期-ID.md` 组织，frontmatter 含日期/心情/标签/天气/位置） |
| 模板 / 引导问题 | 内置 5 个模板（晨间/晚间/周回顾/感恩/自由书写）；21 条引导问题按日期确定性轮换（无状态） |
| 天气 / 位置 | 前端 open-meteo + 浏览器定位采集（用户点按钮才触发），后端只存白名单字段（数字保留 5 位小数、字符串 ≤80 字符） |

## 2. 数据模型（`app/diary/models.py`）

### diary_journals（日记本/分册）

| 列 | 类型 | 说明 |
|---|---|---|
| id | Integer PK | |
| name | String(50) UNIQUE NOT NULL | 本子名（≤50 字符，重名 409） |
| emoji | String(8) NULL | 图标 emoji，缺省 📖 |
| sort | Integer | 排序（预置 日常=0 / 工作=1 / 感悟=2） |
| created_at | DateTime | server_default now() |

### diary_diaries（条目：随记与总结同表）

| 列 | 类型 | 说明 |
|---|---|---|
| id | Integer PK | |
| content | Text NOT NULL | Markdown 正文（≤20 万字符） |
| entry_date | String(10) NOT NULL, index | **日记日期 `YYYY-MM-DD` 字符串**，同一天可多篇 |
| mood | String(20) NULL | great / good / ok / low / bad |
| tags | Text NULL | 标签 JSON 数组——**遗留列**：API 已不写入不检索，仅导出时读旧数据 |
| word_count | Integer | 正文字数，**保存时服务端计算** |
| journal_id | Integer FK(diary_journals.id) NULL, index | 所属本；随记必填（API 层保证），总结恒 NULL |
| kind | String(10) NOT NULL, index | note=随记 / summary=每日总结（每天一篇由 upsert 保证） |
| pinned | Boolean, index | 置顶 |
| archived_at | DateTime NULL, index | 归档时间（NULL=未归档） |
| deleted_at | DateTime NULL, index | 软删除时间（回收站；NULL=正常） |
| weather | Text NULL | JSON `{temp, code, text, wind, humidity}`（白名单清洗后存） |
| location | Text NULL | JSON `{lat, lon, place}` |
| share_token | String(40) NULL UNIQUE, index | 分享 token |
| share_expires | DateTime NULL | 分享过期时间（naive UTC） |
| created_at / updated_at | DateTime(timezone=True) | server_default now()，updated_at 带 onupdate |

**日期一律 `YYYY-MM-DD` 字符串的原因**：SQLite 与 PG 对 DATE/DATETIME 的驱动返回和时区处理不一致（PG timestamptz 带偏移、SQLite naive），字符串形式让两个后端的 JSON 输出与比较语义完全一致——字典序即时间序，月/年过滤直接 `LIKE 'YYYY-MM%'` 前缀匹配，天然避开跨后端时区坑（AGENTS.md 关键事实 12）。

## 3. API 契约（22 端点，均在 `routes.py`）

统一信封 `{success, code, message, data}`（`api_response`）；错误抛 `lizysdk.errors` 的 `ParamError`(400) / `NotFoundError`(404) / `ConflictError`(409)，由全局异常处理器转信封。鉴权：模块路由器级 `dependencies=[Depends(require_basic)]`；仅公开分享在独立 `public_router`。

### 3.1 条目

| # | 方法/路径 | 参数 | 响应 / 错误 |
|---|---|---|---|
| 1 | `GET /api/diary/entries` | `?view=timeline(默认)\|archive\|trash\|pinned`；`?date=` 或 `?start=&end=`（YYYY-MM-DD，非法 400）；`?search=`（仅正文 LIKE %kw%，**不搜标签、无 ?tag= 参数**）；`?mood=`；`?journal_id=`（trash 视图下后两者被忽略）；`?limit=`（默认 500，上限 500）`?offset=` | `{total, items:[entry]}`。entry 含 content（注意：日记列表**带正文**，与文章列表不含正文的约定不同）。排序：timeline/pinned = 置顶优先→日期倒序→**当天总结在随记前**→id 倒序；archive/trash = 日期倒序、id 倒序 |
| 2 | `POST /api/diary/entries` | body：`entry_date`（必填合法日期）、`content`（必填 str ≤20 万）、`mood?`、`kind?`（note/summary，默认 note）、`journal_id`（**kind=note 时必填且须存在**，否则 400）、`weather?` / `location?`（白名单键，塞私货字段被丢弃） | 201 创建成功，返回 entry；word_count 服务端算 |
| 3 | `PUT /api/diary/entries/{id}` | 两种模式：`?action=pin\|unpin\|archive\|unarchive\|restore`（archive 会同时取消置顶；非法 action 400；**有 action 时忽略 body**）；或 body 部分更新（entry_date/content/mood/journal_id/weather/location 任选；kind 不可改） | entry；404 日记不存在 |
| 4 | `DELETE /api/diary/entries/{id}` | 默认软删（进回收站、取消置顶）→ `{id, trashed:true}`；`?hard=1` 彻底删除（**必须先软删**否则 400，硬删前清 share_token/share_expires）→ `{id, purged:true}` | 404 不存在 |
| 5 | `POST /api/diary/quick` | body：`content`（必填非空 ≤2 万）、`journal_id`（必填且存在）、`mood?` | 201 已记录；entry_date 取**服务端**当天 |
| 6 | `POST /api/diary/summary` | body：`entry_date`、`content`（≤20 万）、`mood?`。当天已有未删除总结→整包更新（200 总结已更新），否则新建（201 总结已生成）；journal_id 恒置 NULL | `{summary, created, notes:[当天未归档未删除的随记（id 倒序）]}`——前端直接用 notes 渲染"总结挂随记" |

### 3.2 日记本

| # | 方法/路径 | 说明 |
|---|---|---|
| 7 | `GET /api/diary/journals` | 按 sort,id 升序；每本带 `entry_count`（**未删除**的随记数，含归档；无"默认虚拟本"） |
| 8 | `POST /api/diary/journals` | `{name ≤50 必填, emoji ≤8 字符缺省📖, sort?}`；重名 409；201 |
| 9 | `PUT /api/diary/journals/{jid}` | 部分更新 name/emoji/sort；改名重名（排除自身）409；404 不存在 |
| 10 | `DELETE /api/diary/journals/{jid}` | 仍有未删除条目 → 409"先清空或迁移"；成功 `{id}` |

### 3.3 日历 / 热力图 / 回忆

| # | 方法/路径 | 说明 |
|---|---|---|
| 11 | `GET /api/diary/dates?year=&month=` | 缺省当月；year 1900-2200、month 1-12 否则 400。**排除归档与回收站**。`{year, month, days:{"YYYY-MM-DD":{count, mood}}}`，mood 取当天**最好**心情 |
| 12 | `GET /api/diary/heatmap?year=` | **含归档**、排除回收站。`{year, days:{...}, max}`，max 供前端色阶归一化 |
| 13 | `GET /api/diary/onthisday` | 往年同月同日（排除今年今天与归档，至多 20 条）+ 不足 3 条时补 1 条确定性随机旧记忆（池=最近 300 条今天之前的条目，索引 `(今天.toordinal()*31 + 池首 id) % 池长`）。`{today, past:[entry], random:entry\|null}` |

### 3.4 统计 / 趋势 / 年度回顾

| # | 方法/路径 | 说明 |
|---|---|---|
| 14 | `GET /api/diary/stats` | 排除归档+回收站：`{total, words, current_streak(今天起或昨天起向前), longest_streak, month_count, journals}` |
| 15 | `GET /api/diary/trends?months=` | 1-36（缺省 12，越界钳制）。`{months:[{month:"YYYY-MM", entries, words, mood_avg}]}`，缺月补零、mood_avg 无心情条目时为 null；月份起点按月历推算（不用天数差） |
| 16 | `GET /api/diary/yearend?year=` | 含归档、排除回收站。无数据 `{year, empty:true}`；否则 `{year, entries, words, days, mood_dist, longest_streak, top_month, top_month_words}`（**无 top_tags**——标签已废弃） |

### 3.5 分享

| # | 方法/路径 | 说明 |
|---|---|---|
| 17 | `POST /api/diary/entries/{id}/share` | body `{expires_hours: 1-8760 整数, 缺省 72}`（非法 400）；条目不存在或在回收站 404。token=`secrets.token_urlsafe(24)`，过期时间 naive UTC。201 `{token, expires_at}`（重复创建=轮换旧 token） |
| 18 | `DELETE /api/diary/entries/{id}/share` | 清 token+过期时间 → `{id, revoked:true}`；404 不存在 |
| 19 | `GET /api/diary/share/{token}` | **免登录**（public_router，不挂 require_basic）。找不到/在回收站/已过期一律 404 同文案（不泄露存在性）。200 `{entry:{entry_date, mood, word_count, content, created_at}}`——只读视图，无 id/管理字段 |

### 3.6 导出 / 模板 / 引导

| # | 方法/路径 | 说明 |
|---|---|---|
| 20 | `GET /api/diary/export` | 全量 Markdown zip（未删除，**含归档**；直接返回 `application/zip` Response，不走 api_response 信封）。路径 `本子emoji+名/日期-ID.md`（总结/无本条目落 `默认/`）；frontmatter：date / mood / tags(旧数据) / weather / location；附 `README.txt`（日期+总篇数）；`Content-Disposition` UTF-8 文件名 diary-export.zip |
| 21 | `GET /api/diary/templates` | 内置 5 模板：morning 晨间规划 / evening 晚间复盘 / weekly 周回顾 / gratitude 感恩三件事 / blank 自由书写（key/name/emoji/body） |
| 22 | `GET /api/diary/prompt?date=` | 21 条引导问题，索引 `(ordinal*7+3) % 21`——**同一天恒同一条，无状态**。`{date, prompt, total}` |

## 4. 后端要点

- **字数后端计算**（`_count_words`）：CJK（中日韩统一表意 + 平假名/片假名 + 谚文）逐字计数 + 西文 `[A-Za-z0-9]+` 按词计数；创建/更新/quick/summary 保存时重算，**不信任前端计数**（AGENTS.md 关键事实 12）。
- **ensure_migrations 钩子**（`models.py`，模块三契约之一，`init_db` 在存量表 RENAME、create_all 之后逐模块调用）：幂等做四件事——
  1. `diary_diaries` 缺列补列（create_all 不改已有表）：journal_id/kind/pinned/archived_at/deleted_at/weather/location/share_token/share_expires，新列均带默认值，旧行语义不变（未置顶/未归档/未删除/kind=note）；
  2. 确保预置三本 日常🏡/工作💼/感悟🌱 存在（sort 0/1/2）；
  3. 存量 `journal_id IS NULL AND kind='note'` 的随记归入"日常"；
  4. 缺索引补建：`ix_diaries_deleted` / `ix_diaries_share_token` / `ix_diaries_journal`。
  （AGENTS.md/backend.md 旧称 `_ensure_diary_migration`，实际导出名是 `ensure_migrations`。）
- **AppError 异常风格**：路由内不 try/except，直接 `raise ParamError/NotFoundError/ConflictError(message=…)`，由 `main.py` 全局 `handle_app_error` 统一转 `{success:false, code, message, data:null}` 信封；DB 操作包在 `run_db(_impl)` 里走 scoped session。
- 请求体解析宽容：`_json_body` 坏 JSON/空体一律 `{}`（对齐旧版 `get_json(silent=True)`）；查询参数 `_arg_int` 转换失败回默认值。
- 元数据白名单清洗 `_clean_meta`：weather/location 只保留白名单键，数值 round 5 位、字符串 ≤80 字符，防塞私货。
- 心情分值映射 `MOOD_SCORE`（great5~bad1）用于日历"当天最好心情"与趋势均值。
- 与文章体系零耦合：不经过 posts/workspaces，任何 diary 接口都不写 blog 表。

## 5. 前端（`frontend/src/diary/`，路由 `/diary`）

- **DiaryPage.jsx**（页面骨架）：左 228px 侧栏（返回入口、视图导航 时间线/日历/热力图/统计/回收站、日记本列表带计数 + 行内新建本输入、切换主题、导出全部）+ 主区；移动端顶部横滚导航。时间线 = 搜索/心情过滤行 → 那年今日横幅 → 快捷录入盒 → **按日期分组**（粘性日期头 + 「写/改今日总结」按钮；组内**总结卡在前、随记卡挂后**——有总结时随记卡 `ml-4` 缩进并画连接线）。回收站视图 = 恢复 / 彻底删除（Confirm 确认）。
- **components×9**（`components/` 8 个 + `kit.jsx` 轻组件）：
  - `QuickCapture`：Memos 式录入盒——自动增高 textarea、日记本选择（必选，未选红边提示）、心情、天气一键采集、模板下拉、今日引导问题、Ctrl/Cmd+Enter 落库；
  - `EntryCard`：随记卡（日期/本子徽章/心情/天气/位置/字数/已分享点 元信息行 + Markdown 正文点击进编辑 + hover 操作行 置顶/编辑/分享/归档/回收站；置顶卡个性色左边条；`attached` 时带挂线）；
  - `SummaryCard`：每日总结大卡（徽章 + 渐变底 + 底部连接线引出随记）；
  - `Editor`：全屏右侧编辑抽屉——日期/心情/本子选择/天气/模板/预览切换；停止输入 1.2s 自动保存（新篇首存 POST 后转 PUT；总结模式走 summary upsert）；Ctrl+Enter 保存退出；
  - `CalendarView`：周一开头月历，心情色条 + 篇数 + 今日描边，点选某天跳时间线过滤；
  - `HeatmapView`：GitHub 式年热力图（周×日格、5 档色阶按 max 归一、月份标签、悬浮详情、点格跳当天）；
  - `StatsView`：6 指标卡（连续≥3 高亮）+ 纯 SVG 柱状（每月字数）/折线（心情月均，缺值断开）+ 年度回顾大卡（年份切换）；
  - `ShareDialog`：有效期 1 天/7 天/30 天/一年 → 生成链接一键复制 → 可撤销；
  - `kit.jsx`：MOODS 心情模型（含显示色）、WMO 天气码映射、Icon 图标集、Chip / Confirm / Fade 轻组件。
- **PublicShare.jsx**（`/diary/s/:token`）：**免登录只读页**——不走 apiFetch（无 Basic 头），`fetch(API_BASE)` 直连；Markdown 渲染 + 过期/撤销"蜡烛"空态。
- **api.js**：全部经 `@/shared/client` 的 apiFetch（唯一持凭据处）；例外两个——`diaryPublicShare` 裸 fetch 直连、`diaryExportZip` blob 下载触发浏览器存盘。
- **api-entry.js**：天气采集（纯前端，open-meteo 免 key；仅在用户点按钮时请求定位权限，坐标只发给天气 API 换数据，不外发内容）。
- `index.css` 已含 `@source "./diary";`（白名单模式，漏加工具类会静默不生成）。
- 个性色 rose：仅用于图标底/徽章/心情色等点缀，其余中性 stone（见 `docs/ui-baseline.md`）。

## 6. 测试（`backend/tests/diary/test_diary.py`，26 用例，自包含临时 SQLite）

| 覆盖点 | 用例 |
|---|---|
| 预置本 | test_preset_journals（三本存在、带计数、无虚拟本） |
| 随记必选本 | test_note_requires_journal（缺 journal_id/不存在 id 均 400；创建响应无 tags 字段）、test_note_assigned_to_journal（归属 + ?journal_id 过滤） |
| 每日总结 | test_summary_upsert_once_per_day（201→200 upsert 同 id、总结恒无本、响应带当天随记、坏日期 400）、test_timeline_summary_first_then_notes（排序：总结最前、随记 id 倒序）、test_summary_edit_and_flow（总结可 PUT/置顶/软删，删后重写 created=true） |
| CRUD/校验 | test_update_flow（改内容/换本）、test_validation_errors（坏日期/坏心情/坏 kind 均 400） |
| 置顶/归档/回收站 | test_pin_and_order（置顶最前 + pinned 视图）、test_archive_flow（archive 视图 + unarchive）、test_trash_restore_purge（软删→trash 视图、未软删 hard=1 400、restore、hard 200、再删 404） |
| 快速录入 | test_quick_capture_requires_journal（201 落当天、缺本/空白 400） |
| 过滤/搜索 | test_filters_search_mood_date（search/mood/start） |
| 日历/热力图/回忆 | test_month_dates_shape（count 聚合 + 当天最好心情）、test_heatmap（max 归一 + 当天计数）、test_onthisday（往年今日入列，2/29 边界自动跳过） |
| 统计/趋势/年度 | test_stats_and_streaks（连续 3 天 + 断档最长连续）、test_trends_months_backfilled（6 月补零、末月有值、mood_avg 键在）、test_yearend_no_tags（**断言无 top_tags**） |
| 分享 | test_share_lifecycle（创建/公开读取无 id 无 tags/坏 token 404/撤销 404/expires_hours=0 400）、test_share_blocked_after_trash（软删即 404） |
| 本子管理 | test_journals_crud_and_guard（409 拒删非空、entry_count、重名 409、清空后可删） |
| 元数据/导出/模板 | test_weather_location_persist（白名单清洗 junk 丢弃）、test_export_zip（zip 结构 + frontmatter mood）、test_templates_and_prompt（模板含 body、同日期同问题） |
| 鉴权 | test_requires_auth（entries/quick/summary 无凭据 401） |

## 7. 已知边界

1. **列表上限 500**：`total` 是全量计数，`items` 默认/最多 500 条，前端无分页 UI——超量时旧条目看不到（只能按日期/搜索过滤）。
2. **search 只搜正文**（content LIKE），不搜标签；`?tag=` 参数不存在（api.md 曾写有，以本文档为准）。tags 列为遗留：仅导出时读旧数据，API 不写入。
3. **trash 视图忽略 journal_id/mood 过滤**（代码路径决定，仅 timeline/archive/pinned 生效）。
4. **hard=1 必须先软删**；硬删会连带撤销分享，软删期间分享直接 404（restore 后恢复可见）。
5. **删本守卫只数未删除条目**：回收站内仍挂在本子上的条目不拦——SQLite 默认不强制外键可删成，PG 有 FK 约束会 500（把回收站条目彻底删除后再删本即可）。
6. **quick 的 entry_date 取服务端本地日期**，前端录入框用浏览器日期，服务器时区不同时可能差一天。
7. **PUT 可给总结设置 journal_id**（部分更新无 kind 联动校验），会破坏"总结无本"不变量——前端不会这么发，接口层未拦。
8. 导出 zip 不含回收站条目；总结与无本条目统一落 `默认/` 目录。
9. 分享过期比较用 naive UTC（`_utcnow`），与 SQLite/PG 双后端时间语义一致，但对墙钟时区无感知。
10. word_count 按 Markdown 源文本计（语法符号也计入）；引导问题轮换与那年今日随机挑选均为确定性算法，同一天结果恒定。
11. 日历（dates）排除归档、热力图（heatmap）含归档——口径刻意不同：日历服务时间线导航，热力图反映写作活跃度；前端两处均按此消费。
