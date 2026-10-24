# Subs 模块文档（订阅管理 / CrownFlow 全量迁移）

> 模块：`backend/app/subs/`（`__init__.py` + `models.py` + `routes.py` + `currency.py`）
> ＋ 前端 `frontend/src/subs/`（`SubsPage.jsx` + `api.js` + `kit.jsx` + `charts.jsx` + `useHolidays.js` + `views/×5`）
> 契约入口：`app/subs/__init__.py` 导出 `router` + `start_background(app)`（`app.state.testing` 时空转）；
> `ensure_migrations(engine)` 为会员/订阅补revision；另导出stop_background/drain_background供统一生命周期调用
> 更新日期：**2026-10-21**（原核心用例见第6节，新增专项见末节）

---

## 1. 功能概述

subs 是从 CrownFlow 项目全量迁移的**会员订阅管理**能力包（路由前缀 `/api/subs`，前端单页 `/subs`）：

- **会员主表 + 多订阅记录**：会员（名称/分类/备注/提前提醒天数）一对多订阅记录，每次购买/续费一条
  （价格 / 币种 5 种 / 计费周期 4 种 / 起止日期 / 渠道 / 级别）；会员状态口径 = 任意一条订阅
  `end_date ≥ 今天` ⇒ `active`
- **分类**：名称唯一，emoji 图标 + hex 颜色；删除前查会员关联（有会员 → 400 拒绝）
- **支出统计**（跨币种静态汇率折 CNY）：概览（总数/活跃/本月/年度）、日期范围支出（总额/日均/按币种/按分类占比）、
  分类明细、趋势（day/week/month/quarter四粒度，默认轻汇总；明细按需分页或显式include_details=1）
- **到期提醒**：`reminders/upcoming`（剩余天数 ≤ 会员 `reminder_days` 阈值）与 `reminders/all`（到期日历数据源）
- **前端可视化全家桶**：概览（指标卡 + 分类汇总表 + 提醒列表 + 会员支出排行榜 4 维度 + **农历/法定节假日到期日历**）、
  会员列表（表格/卡片双视图 + 筛选分页）、会员详情（订阅表 + **时间轴视图** 3m/6m/12m/全部）、
  统计图表（面积趋势图 + 环形饼图，纯 SVG 零依赖）、设置（分类 CRUD）
- **每日后台线程**：10:00 当日支出摘要写模块日志

## 2. 数据模型（`app/subs/models.py`）

三张表，`subs_` 前缀隔离，同库存储；**日期一律 `YYYY-MM-DD` 字符串**（跨 SQLite/PG 比较语义一致）。

### `subs_categories`（SubsCategory）

| 列 | 类型 | 说明 |
|---|---|---|
| id | Integer PK | 自增 |
| name | String(50), unique, index | 分类名称（唯一） |
| icon | String(10), nullable | emoji 图标 |
| color | String(7), nullable | hex 颜色（如 `#1890ff`） |
| created_at | DateTime(tz) | `server_default=now()` |

### `subs_members`（SubsMember，会员主表）

| 列 | 类型 | 说明 |
|---|---|---|
| id | Integer PK | 自增 |
| name | String(100), index | 会员名称 |
| revision | Integer, default 1 | 编辑SQL CAS版本 |
| category_id | FK→subs_categories.id, nullable, index | 分类 |
| notes | Text, nullable | 备注 |
| reminder_days | Integer, default=7 | 提前 N 天提醒续费 |
| created_at / updated_at | DateTime(tz) | now() / onupdate |

关系：`category`（多对一）；`subscriptions` 一对多，**`cascade='all, delete-orphan'`**（删会员级联删订阅）。

### `subs_subscriptions`（SubsSubscription，订阅记录）

| 列 | 类型 | 说明 |
|---|---|---|
| id | Integer PK | 自增 |
| member_id | FK→subs_members.id, index | 所属会员 |
| revision | Integer, default 1 | 编辑SQL CAS版本 |
| level | String(50), nullable | 会员级别（豪华版/家庭版…） |
| price | Numeric(10,2), 必填 | 价格 |
| currency | String(3), default='CNY' | CNY/USD/EUR/GBP/JPY |
| billing_cycle | String(20), 必填 | monthly/quarterly/yearly/custom |
| custom_days | Integer, nullable | 自定义周期天数（custom 时必填 >0） |
| start_date / end_date | String(10), 必填, index | `YYYY-MM-DD` |
| channel | String(50), nullable | 订阅渠道（官方/淘宝/代充…） |
| notes | Text, nullable | 备注 |
| created_at / updated_at | DateTime(tz) | now() / onupdate |

### 会员序列化聚合字段（`to_dict`，列表即带）

`latest_subscription`（按创建时间倒序**优先取仍有效**的订阅，无有效则取最新一条）/ `status`
（active|expired）/ `subscription_count` / `total_spending`（各订阅价**静态汇率折算基准币**后求和，
两位小数）/ `total_duration_days`（Σ `(end−start).days`，**不含 +1**）。`include_subscriptions=True`
时附全部订阅记录（详情页用）。

## 3. API 契约（全部 `/api/subs/*`）

- **响应信封**：`{success, code, message, data}`（`app/shared/response.py::api_response`）
- **认证**：router 级 `dependencies=[Depends(require_basic)]`——统一登录：**会话 Cookie 优先，Basic 兼容**
  （无凭据 → 401）
- **错误码**：lizysdk 异常体系 → `ParamError`=400（`PARAM_INVALID`）/ `NotFoundError`=404（`RESOURCE_NOT_FOUND`）/
  `ConflictError`=409（`RESOURCE_ALREADY_EXISTS`）；全部中文 message
- 日期参数校验失败信息形如「开始日期格式错误，应为 YYYY-MM-DD」

### 分类

| 端点 | 说明 |
|---|---|
| `GET /api/subs/categories` | 全部分类（按 created_at, id 升序）→ `data: [category]` |
| `POST /api/subs/categories` | `{name(必填,去空格,唯一,≤50), icon?, color?}` → 201；空名/超长 → 400；重名 → 409「分类名称已存在」 |
| `PUT /api/subs/categories/{id}` | `{name?, icon?, color?}` 部分更新 → 200；改与他分类撞名 → 409；不存在 → 404 |
| `DELETE /api/subs/categories/{id}` | → 200 `{deleted: true}`；**该分类下存在会员 → 400「该分类下存在会员，无法删除」**；404 |

### 会员

| 端点 | 说明 |
|---|---|
| `GET /api/subs/members` | 分页列表（列表项即带聚合字段）→ `{items, total}`。参数：`page`(≥1)、`page_size`(1..`settings.max_page_size`=100，默认 10)、`keyword`(name ilike %kw%)、`category_id`、`status=active\|expired`(非法值 400)、`sort_by=created_at\|name`(默认 created_at，非法 400)、`order=asc\|desc`(默认 desc)；次级排序 id desc |
| `GET /api/subs/members/{id}` | 详情（含 `subscriptions` 全量数组）→ 404 会员不存在 |
| `POST /api/subs/members` | `{name(必填,≤100), category_id?(须存在,否则 400), notes?, reminder_days?(默认 `subs_default_reminder_days`=7), subscription?: {首条订阅，同下述订阅字段}}` → 201；**JSON 体缺失/解析失败 → 400「请求体不能为空」**；附带非法首条订阅时整体失败、会员不落库（run_db 兜底回滚） |
| `PUT /api/subs/members/{id}` | `{name?, category_id?, notes?, reminder_days?, revision?}` → 200；过期revision 409；name 空/超长 400；category_id 非空须存在（传 `null` 可清空分类）；404 |
| `DELETE /api/subs/members/{id}` | → 200；**级联删除其订阅记录**（delete-orphan）；404 |

### 订阅记录

| 端点 | 说明 |
|---|---|
| `GET /api/subs/members/{id}/subscriptions` | 会员的订阅列表（**不分页，全量**）→ `{items, total}`。参数：`status=active\|expired`(非法 400)、`start_date`+`end_date`（**成对给出**时筛选与区间有重叠的订阅；start>end → 400）、`sort_by=created_at\|start_date\|end_date\|price`、`order` |
| `POST /api/subs/members/{id}/subscriptions` | 新建订阅 → 201；字段校验见下；会员不存在 404 |
| `GET /api/subs/subscriptions/{id}` | 单条详情（**附 `member_name`**）；404 |
| `PUT /api/subs/subscriptions/{id}` | 部分更新（可选revision）→ 200；版本冲突409；**组合校验**见下；404 |
| `DELETE /api/subs/subscriptions/{id}` | → 200 `{deleted: true}`；404 |

**订阅字段校验**（`_validate_subscription_payload`，POST 全量 / PUT 仅校验出现字段）：

- `price`：必填，有限数字且0..99999999.99（负数/非数字/NaN/Infinity/超范围 → 400）
- `currency`：白名单 `CNY/USD/EUR/GBP/JPY`，缺省 CNY（非法 → 400）
- `billing_cycle`：白名单 `monthly/quarterly/yearly/custom`，必填（非法/空 → 400）
- `custom_days`：可空；给出则必须整数 >0（`custom_days=0` → 400）
- `start_date` / `end_date`：必填 `YYYY-MM-DD`（格式/倒置 → 400）；`level/channel/notes` 须为字符串
- **custom 组合校验**：POST 时 `billing_cycle=custom` 必须带 `custom_days>0`
  （「自定义周期必须提供 custom_days」）；**PUT 部分更新按「新值 ?? 旧值」合并后再校验**——
  切到 custom 但旧值/custom_days 缺失、或显式传 `custom_days: null` → 400；起止日期同样按合并值校验倒置

### 统计

| 端点 | 说明 |
|---|---|
| `GET /api/subs/stats/overview` | `{total_members, active_members, monthly_spending, yearly_spending}`（本月=当月 1 日~月末、本年=1-01~12-31 **整月/整年口径**，折基准币） |
| `GET /api/subs/stats/category-summary` | 各分类本月+年度支出（按年度降序）+ `{total_monthly, total_yearly}`（Dashboard 表格） |
| `GET /api/subs/stats/spending?start_date=&end_date=` | `{total, daily_average, by_currency(原币种口径), categories[{category_id, category_name, category_icon, category_color, total, count, percentage}]}`（分类按金额降序）；start/end 必填且 start≤end，否则 400 |
| `GET /api/subs/stats/by-category?start_date=&end_date=` | `{categories[{..., details: [{subscription_id, member_name, level, amount}]}], total}`（明细按金额降序，含未分类桶） |
| `GET /api/subs/stats/trend?start_date=&end_date=&granularity=` | `{trend: [{date: 标签, amount, details: []}]}`；默认汇总附start_date/end_date，`include_details=1`才返回旧按分类/订阅嵌套明细；`granularity` ∈ `day(标签=日期)/week(mm/dd-mm/dd, 周一起)/month(YYYY-MM)/quarter(YYYY-Qn)`，默认 month，非法 → 400；最多10年、day最多500点 |
| `GET /api/subs/stats/ranking?metric=&limit=10` | 全量会员TopN，metric为total_spending/avg_per_sub/subscription_count/total_duration_days，limit1..100；返回 `{items,total,metric}` |
| `GET /api/subs/stats/details?start_date=&end_date=&page=1&page_size=20&category_id=` | 所选范围订阅支出明细，page_size1..100；返回 `{items,total,page,page_size}`，category_id=0筛选未分类 |

### 提醒

| 端点 | 说明 |
|---|---|
| `GET /api/subs/reminders/upcoming` | `end_date ≥ 今天` 且 `days_remaining ≤ 会员 reminder_days`（null 按 0）的订阅，按剩余天数升序 → `{reminders: [{subscription_id, member_id, member_name, level, category_name/icon/color, end_date, days_remaining, price, currency}]}` |
| `GET /api/subs/reminders/all` | 全部未到期订阅（到期日历数据源），升序，结构同上 |

## 4. 后端要点

### 4.1 统计口径红线（AGENTS.md 13g 原文照录）

> **月/年支出与趋势按「日均×重叠天数（闭区间+1）」计算，整月/整年口径**（不是"至今"），跨币种按
> `settings.subs_exchange_rates` 静态汇率折 CNY——改口径须同步 api.md 第 13 节；custom 计费周期必须带
> custom_days>0（PUT 部分更新也做组合校验）；分类删除前查会员关联

routes.py 模块注释的口径表述：

> 支出计算：日均 = 价格 / 计费周期天数；实际支出 = 日均 × 与查询范围重叠天数（闭区间）；
> 跨币种按 settings.subs_exchange_rates 静态汇率折算基准币（CNY）。

实现落点：

- `_spend_rows(subs)`：把订阅列表**预计算**成 `_SpendRow`（namedtuple：日期序数 / 原币与基准币日均
  `Decimal` / 分类引用等），相关支出统计接口共用，避免逐期 × 逐订阅重复解析与 ORM 访问
- `_overlap_ord(s, e, qs, qe)`：序数版整数重叠天数 `min(终点) − max(起点) + 1`（**闭区间 +1**，
  ≤0 即无重叠）；各统计接口输出统一 `quantize('0.01')` 转 float
- overview / category-summary 的"本月/年度"分别取**整月（1 日~月末）与整年（1-01~12-31）**区间
  （`_month_year_bounds`），**不是月初至今**——月中查看时未来天数也计入（日均口径天然如此）
- `stats/spending` 的 `by_currency` 按**原币种**累计（不折算）；`daily_average` = 总额（折基准币）÷ 范围天数（含端点 +1）

### 4.2 每日后台线程（`routes.py::start_daily_loop`）

- `app.state.testing=True`（测试模式）→ **直接 return，不启动线程**
- 线程 `subs-daily`（daemon、挂app.state）：启动等待10秒，之后每60秒检查；使用stopEvent等待，可及时停止并重新启动——
  - `now.hour ≥ 10` 且当天未执行过 → `run_daily_spending_log(app)`
- 当日去重记录在每app运行时的 `done` 日期，执行体投递SDK的subs有限池并确认成功后才标记；异常记录日志并在下轮重试。启动后若已过业务时区10点且未执行会补跑；进程重启会重新补跑当天任务。
- `run_daily_spending_log(app)`：当日活跃订阅（start ≤ 今天 ≤ end）按分类汇总日均支出，多行 info 写模块日志
  （sys_name=`doublog.subs`）；在 `database_context(app)` 内绑定正确数据库，末尾 `db.session.remove()` 还连接
- **测试直接调 `run_daily_spending_log`，不要 sleep 等线程**

### 4.3 currency.py

- `get_billing_cycle_days(cycle, custom_days, start_date)`：**monthly = 起始月实际天数**
  （`monthrange`，按 `start_date` 的年月，**终身固定**）；quarterly = 90；yearly = 365/366（闰年按起始年）；
  custom = `custom_days`（缺省兜底 30，正常路径被 API 校验拦住）；未知周期兜底 30
- `calculate_daily_rate(price, cycle, custom_days, start_date)` → `Decimal(str(price)) / Decimal(天数)`（原币种日均）
- `convert_to_base(amount, currency)`：基准币原值；未知币种原值；否则 `× settings.subs_exchange_rates[currency]`
- 常量：`VALID_CURRENCIES = ('CNY','USD','EUR','GBP','JPY')`、`VALID_BILLING_CYCLES =
  ('monthly','quarterly','yearly','custom')`（币种符号映射在前端 kit.jsx）

### 4.4 配置（`config.py`）

| 配置 | 默认 | 说明 |
|---|---|---|
| `subs_base_currency` | `'CNY'` | 支出统计折算基准币 |
| `subs_exchange_rates` | `{CNY:1.0, USD:7.0, EUR:10.0, GBP:9.0, JPY:0.05}` | **静态汇率表**（不联网更新） |
| `subs_default_reminder_days` | `7` | 新会员默认提前提醒天数 |

## 5. 前端（`frontend/src/subs/`）

### 5.1 SubsPage.jsx（壳）

公共 220px 侧栏（返回入口 `/`、模块标题、四项导航：概览/会员/统计/设置——概览带**即将到期计数橙色徽标**、
会员带 `活跃/总数` 计数、主题切换按钮）+ 公共ModuleShell内容画布内嵌
`<Routes>`（`/subs` 概览、`/subs/members`、`/subs/members/:id` 详情、`/subs/stats`、`/subs/settings`）+ 全局 Toast。
页面底色全站统一 `bg-stone-50 dark:bg-[#100f0e]`。

### 5.2 views/×5

- **OverviewView**：4 指标卡（总数/活跃/本月/年度支出，月年口径=整月整年，卡片带口径提示 icon）+
  分类汇总表（列排序 + sticky 合计行）+ 即将到期提醒列表（点击进详情）+ 会员支出排行榜（4 维度切换：
  累计花费/平均订阅/订阅次数/累计时长，通过服务端全量TopN接口取数，前3名奖杯+火焰、条形按名次配色）+ **订阅到期日历**
  （月历：农历节日/日期红字、法定节假日（timor.tech）红底/补班标注/休息日蓝底、当日到期数徽标
  （橙=7 天内/绿=更远）、点有订阅日期弹当日列表、今天高亮、图例）
- **MembersView**：搜索（300ms 防抖）/分类/状态筛选 + 表格/卡片双视图（localStorage `subs-members-view`）+
  分页（页大小记忆 `subs-members-page-size`）+ 新建/编辑会员弹窗 + 删除确认；URL `?category_id=` 可预置筛选
- **MemberDetailView**：信息卡（分类/订阅数/**分币种累计**/提醒天数/备注）+ 订阅表（级别/周期/状态/覆盖日期
  四维筛选）+ **时间轴视图**（3m/6m/12m/全部 + 缩放/平移/回到当前 + 今天竖线 + 状态着色条形
  绿=有效/橙=提醒窗口内/灰=过期 + 条形详情弹层含日均）+ 添加/编辑订阅弹窗
  （改开始日期按周期自动推算结束日期 = 整周期 − 1 天、custom 显自定义天数输入、前端预校验与后端同规则）
- **StatsView**：日期范围 + 快速选择（本周/本月/本季度/本年）+ 粒度（跨度 ≥90 天禁用按天并自动回落按周）+
  面积趋势图与环形饼图（hover提示）；“支出明细”开关按需请求整个所选范围的分页订阅明细，不重复嵌入每个趋势点
- **SettingsView**：分类管理（CRUD / 16 色预设 + 任意 hex / emoji / 搜索）
- **DateInput**（kit.jsx）：原生 `type="date"` 封装的受控组件；**捕获阶段**调 `showPicker()`——
  点击日期文本（原生仅图标可弹）也弹选择器，且先于原生图标处理器执行，两处「已打开则跳过」守卫
  挡住重复弹开； StatsView 日期范围与 MemberDetailView 订阅表单/日期筛选在用

### 5.3 kit.jsx / charts.jsx / useHolidays.js

- **kit.jsx**：格式化（`fmtPrice` 价格+币种符号、`daysRemaining` 本地零点差值、`cycleLabel`/`fmtDuration`/
  `toDateInput`）；**`adjustForDark(hex)`**——暗色下用户自配分类色按相对亮度向白混合提亮（对比度循环，
  `#100f0e` 底色常量），保证深底可读；`StatusTag`（active/expiring/expired 三态）/`CategoryTag`（hex 色 + 14 透明度底）；
  `Modal`（Esc 关闭/遮罩点击）`Confirm` `Toast`；表单 `inputCls`/`Field`/`btn` 四档按钮；`DateInput`（见 5.2）；
  Icon 集（stroke 1.7）
- **charts.jsx**（**纯 SVG 手写，零依赖**）：`useWidth`（初测 + resize + ResizeObserver 三重兜底）、
  `AreaTrend`（面积+折线+hover 竖线+数据点、x 轴标签按步长抽稀、tooltip 180px 卡片）、
  `DonutPie`（扇区 path 手绘、hover 外扩 3px/其余 35% 透明、中心总计、图例带占比、下方明细区）
- **useHolidays.js**：timor.tech 年度节假日 API（公网、免认证）；内存 Map + localStorage 双层缓存
  （key `doublog_subs_holidays_<year>`，TTL 7 天）；自动预取目标年 ±1；**失败静默降级**为仅按周末判定休息日
  （日历仍可用）

### 5.4 依赖与 @source 红线

- **本模块特有依赖 `lunar-javascript`**（仅 ExpiryCalendar 到期日历农历显示）：在独立懒加载 ExpiryCalendar 顶部
  `import { Solar } from 'lunar-javascript'`，随 `App.jsx` 路由级 `lazy(() => import('@/subs/SubsPage'))`
  由 `OverviewView` 的 Suspense 单独加载（不进入订阅壳初始 chunk）——**勿在别处引入**
- **新增前端目录必须在 `index.css` 补 `@source "./目录";`**（本仓 `source(none)` 显式白名单模式，漏加则该目录
  独有工具类含 `dark:` 变体全部静默不生成）——`@source "./subs";` 已在（index.css 第 11 行）；
  **subs 首版暗色表头白底即漏加此行所致**，改动后需自查明暗两态

## 6. 测试（`backend/tests/subs/test_subs.py`，原核心13例，自包含临时 SQLite）

| 分组 | 用例 |
|---|---|
| 分类（2） | `test_category_crud`（CRUD 全流程）；`test_category_validations`（名称必填/超长/重名 409（创建+更新撞名）/404/**有会员关联 400 拒删**） |
| 会员（3） | `test_member_crud_with_first_subscription`（建带首条订阅/更新/详情/删除级联，删后订阅列表 404）；`test_member_validations`（名称空/空白/超长、分类不存在、**非法首条订阅整体失败不落会员**）；`test_member_list_filters_and_sort`（分页/keyword/category/status（含非法值 400）/排序（含非法字段 400）/**无凭据 401**） |
| 订阅（2） | `test_subscription_crud`（CRUD/详情带 member_name/状态与日期范围筛选/排序/404）；`test_subscription_validations`（价格空/负/非数字、周期空/非法、币种非法、日期格式/空/倒置、**custom 无天数/天数 0、PUT 切 custom 清空天数 400、PUT 改日期致倒置 400**、合法 custom 45 天） |
| 聚合（1） | `test_member_aggregation`（CNY 30 + USD 10×7.0 = total_spending 100、时长 60、latest 取最新有效订阅、列表同带聚合） |
| 统计（3） | `test_stats_overview_and_summary`（月/年支出=整月口径 30、category-summary 合计）；`test_stats_spending_and_by_category`（USD 7×7.0 折算、by_currency 原币、占比、日均、by-category 明细降序、缺参/倒置/非法日期 400）；`test_stats_trend_granularities`（month=12 段/quarter=4 段标签、week/day 标签、金额核对、非法粒度/缺日期 400） |
| 提醒（1） | `test_reminders`（3 天内提醒/30 天不提醒/已过期不出现、reminder_days 收紧后为空、all 含未到期不含过期、升序） |
| 每日任务（1） | `test_daily_spending_log`（直接调函数，含活跃数/未分类桶/总支出文案、无订阅/重复执行不炸） |

## 7. 已知边界

1. `total_duration_days` = Σ`(end−start).days`，不含闭区间+1；支出重叠天数仍含+1，两者是不同指标约定。
2. 汇率是静态配置，不联网更新；未知币种按原值折算。
3. monthly日均分母固定为订阅起始月的实际天数，跨月不变；绕过API直接入库的custom缺custom_days时按30天兜底。
4. `reminders/upcoming` 的reminder_days=null按0处理，仅当天到期提醒。
5. useHolidays依赖timor.tech公网，失败静默降级为周末着色。
6. 每日去重日期保存在每app运行时内存，进程重启后当天任务可能补跑；数据库与执行状态不会跨app共享。
7. 趋势最多10年、day粒度最多500点；大范围明细采用独立分页接口。排行榜已覆盖全量会员，未分类支出也参与分类汇总，今天/活跃状态按应用配置业务时区判定。

## 公共 UI 外壳（2026-10-13）

前端由 `shared/ModuleShell.jsx` 提供统一侧栏（默认 220px，可拖动/键盘调整 180–420px，可折叠为 56px 图标窄轨；见 docs/modules/frontend.md）、多级菜单与内容画布；导航状态经 `useModuleNavigation` 注册。前端仅适配桌面浏览器，无移动端布局。页面内部的业务工具栏、表格、编辑器与弹层仍由模块管理。布局与性能契约见 `frontend.md` 的页面布局约定。

到期日历独立懒加载，会员 / 统计 / 设置视图无需加载农历实现；通用弹窗正文滚动，页头与操作栏保持可见。


## 2026-10-21 全量统计与并发生命周期

- 会员及订阅增加revision，编辑PUT可携带revision，SQL CAS冲突409。省略revision保留旧客户端兼容；前端编辑提交已读版本，失败保留弹层输入。
- 新增 `GET /api/subs/stats/ranking?metric=total_spending|avg_per_sub|subscription_count|total_duration_days&limit=10`，limit1..100。覆盖全部会员（包含零订阅），不再只取列表第一页100人后客户端排序。服务端用小字段聚合和heap topN，返回 `{items,total,metric}`。排名Query key含账号、数据库与metric，切维度取消旧请求。
- `/stats/trend` 默认仅汇总点，兼容保留每点 `details:[]`；显式 `include_details=1` 才返回旧嵌套明细。趋势最多10年、day粒度最多500点；周桶从周一开始，首尾桶只计请求闭区间交集，不出现未重叠负金额。
- 新增 `GET /api/subs/stats/details?start_date=&end_date=&page=1&page_size=20&category_id=`：当前请求区间订阅支出明细分页。图表使用轻汇总，用户展开明细后才请求；前端按整个查询区间展示明细，不重复嵌进每个趋势点。
- 未分类订阅也计入spending、by-category、category-summary，分类合计与总支出一致。金额保持Decimal计算后输出两位；NaN/Infinity/负数及大于99999999.99的价格拒绝。
- 今天/活跃状态/每日10点日志统一读取应用配置的业务时区（与todo时区共用），不依赖操作系统本地时区。会员列表无status过滤时，COUNT去掉排序/关联加载，并在同次SQL通过scalar subquery读取原始Todo配置；共用settings_from_raw解析后只计算一次today，不增加配置查询或把配置写入响应。有status过滤时也只求一次today供过滤与DTO复用。原YYYY-MM-DD存储保持跨SQLite/PG兼容。
- 每日调度器挂app.state，stopEvent可停止且可重启，工作投递SDK有限池，并在 `database_context(app)` 内绑定对应数据库；停止/切库等待在途工作，避免多app串库。只有工作确认成功才记录已执行日期。
- 新专项 `tests/subs/test_subs_optimization.py` 覆盖第101名以后的最高支出、轻趋势/分页明细、版本冲突、未分类汇总与非有限价格；最终测试、明暗截图和统一A/B见执行报告。
