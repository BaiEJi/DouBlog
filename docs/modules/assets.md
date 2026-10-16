# Assets 模块文档（资产库：Prompt 与 Skill）

> 模块：`backend/app/assets/`（`__init__.py` + `models.py` + `services.py` + `routes.py`）
> ＋ 前端 `frontend/src/assets/`（`AssetsPage.jsx` + `api.js` + `kit.jsx` + `components/×5`）
> 契约入口：`app/assets/__init__.py` 导出 `router` + `ensure_migrations(engine)`（空实现——四表均为新建，
> `create_all` 直接覆盖；存量列变更未来在此追加）；无后台线程
> 生成日期：**2026-10-16**（依据当日代码；含 `tests/assets/test_assets.py` 27 用例）

---

## 1. 功能概述

assets 是 **Prompt 与 Skill 资产库**能力包（路由前缀 `/api/assets`，前端单页 `/assets`，fuchsia 强调色）：

- **双类型资产**：`kind=prompt`（提示词）/ `skill`（技能文档），统一 CRUD；标题无唯一约束
  （复制/导入可重名，撞名复制自动加「（副本）」后缀）
- **组织维度**：自定义分类（emoji + hex 颜色 + 适用类型 all/prompt/skill，删除前校验资产关联）；
  标签（≤20 个/条目，禁引号与反斜杠——JSON 列 LIKE 匹配的转义边界）；收藏；归档
- **变量体系**：正文以 `{{name}}` 声明变量（name 以字母/下划线开头，可含数字/点/连字符），
  **服务端保存时提取去重**（前端编辑器实时检测仅为辅助）；详情抽屉「变量填充台」按变量
  生成表单 + 实时预览填充结果 + 一键复制（填充值记忆在 localStorage，键 `doublog_assets_fill_<id>`）
- **版本管理**：title/summary/content 变更即快照（元数据变更不产生版本；当前版本也在版本链中）；
  版本列表 + 单版本详情 + **行级 LCS diff**（前端 `kit.jsx diffLines`，>1500 行退化为整体替换）；
  恢复历史版本 = 产生新版本（note「恢复自 vN」）
- **使用统计**：copy/fill/export 三种动作计数（详情查看不计数），30 天使用趋势、最常用 TOP5、
  最近使用（usage logs 表驱动）
- **回收站**：软删（status=trash）→ 恢复 / 彻底删除（级联版本与使用日志）；回收站内禁止编辑/使用/恢复版本
- **批量操作**：favorite/unfavorite/archive/unarchive/trash/restore/hard_delete/move（≤500 条）
- **导入导出**：全量/过滤导出 JSON 附件（可选含历史版本）；单条导出 md（JSON frontmatter）/json；
  导入支持本库导出格式与最小 `{title, content}` 格式，create/upsert 两种模式（upsert 按
  「kind + 标题」在非回收站资产中匹配），**dry_run 预检**（不落库，报告将创建的分类），
  分类按名称自动匹配/创建；单条非法进 errors 不阻断整体；单次 ≤500 条

## 2. 数据模型（`app/assets/models.py`）

四张表，`assets_` 前缀隔离：

| 表 | 关键列 | 说明 |
|---|---|---|
| `assets_categories` | name(unique) / icon / color / kind / sort_order | 分类 |
| `assets_items` | kind / title / summary / content / category_id(FK 可空) / tags(JSON) / variables(JSON) / favorite / status / usage_count / last_used_at / version | 资产条目；status: active/archived/trash |
| `assets_versions` | item_id(FK 级联) / version / title / summary / content / note | 版本快照（当前版本在链） |
| `assets_usage_logs` | item_id(FK 级联) / action / created_at | copy/fill/export 使用日志 |

要点：
- `variables` 由服务端在 create/update/restore/import 时经 `extract_variables` 重算——**别信任前端**
- 状态机：active ⇄ archived；任意 → trash（软删）→ restore 回 active；hard 删除物理清除
- JSON 列（tags）在 SQLite 为文本、PG 为 JSON，过滤走 `cast(String).like('%"tag"%')`（故标签禁引号/反斜杠）

## 3. API 契约（前缀 `/api/assets`，全部挂 `require_basic`）

- 分类：`GET/POST /categories`、`PUT/DELETE /categories/<id>`（删除时有关联资产 → 409）；
  列表末尾附 `id=null` 的「未分类」聚合项（item_count/prompt_count/skill_count）
- 资产：`GET/POST /items`（列表过滤 `?kind= ?category_id=<int|none> ?tag= ?favorite= ?status=
  ?q= ?sort= ?page= ?page_size=`，**列表不含 content**）；`GET/PUT/DELETE /items/<id>`
  （DELETE 软删，`?hard=1` 物理删除）；`POST .../restore | /duplicate | /use`；`POST /items/bulk`
- 版本：`GET /items/<id>/versions`（列表不含正文）；`GET /versions/<vid>`（含正文，供 diff）；
  `POST /items/<id>/versions/<vid>/restore`
- 聚合：`GET /tags`（非回收站资产聚合）；`GET /stats`（totals/by_category/top_used/recent_used/usage_trend）
- 传输：`GET /export?kind=&category_id=&favorite=&q=&include_trash=&include_versions=`（JSON 附件，
  非信封）；`GET /items/<id>/export?format=md|json`；`POST /import`（见上）

排序键：updated_desc（默认）/ created_desc / usage_desc / title_asc / last_used_desc。
搜索 q：LIKE 匹配标题/摘要/正文（`%`/`_`/`\` 转义）。

## 4. 前端（`frontend/src/assets/`）

- `AssetsPage.jsx`：PageHeader 注册模块侧栏三视图（资产库/回收站/统计）+ 页内左过滤栏
  （快速过滤/分类/标签）+ 卡片网格（批量勾选、hover 操作）+ 分页；Ctrl+K 聚焦搜索
- `ItemDetail.jsx`：右滑抽屉——元信息 + 操作组（复制全文/编辑/导出 md·json/复制副本/收藏/归档/回收站）
  + 三 tab（预览：markdown 渲染（复用 `shared/md.js`）与原文切换；变量填充；版本 diff）
- `ItemEditor.jsx`：新建/编辑弹窗——kind 分段切换、分类/标签/摘要/正文、**实时变量检测 chips**、
  版本备注；Ctrl+S 保存、Esc 取消
- `CategoryManager.jsx` / `ImportPanel.jsx` / `StatsView.jsx`：分类管理、导入（预检→执行）/导出、
  统计（总量卡 + 30 天 CSS 柱图 + 分类分布 + TOP5/最近使用）
- `kit.jsx`：Toast/Modal 常量、`diffLines`、`copyText`、KIND_META
- api.js 走 `shared/client.js`；导出走 blob 下载（解析 content-disposition 的 filename*）

## 5. 测试（`tests/assets/test_assets.py`，27 例）

认证 / 分类 CRUD·唯一性·删除保护·计数 / 创建校验（13 组非法载荷）/ 列表过滤（kind/分类/
标签/收藏/搜索/LIKE 转义）/ 排序分页 / 版本策略（元数据不产生版本、相同内容不产生版本）/
软删恢复彻底删除 / 复制 / use 三动作 / 批量全动作 / 版本恢复（含跨资产 404、恢复当前版本 409）/
标签聚合（回收站不计）/ 统计口径 / 导出（过滤·带版本·md·json）/ 导入（upsert·create·dry_run·
历史版本·非法载荷·往返一致性）。

## 6. 边界与已知限制

- 资产标题不唯一：upsert 匹配「kind+标题」取第一条；有意支持重名（复制/导入场景）
- 标签含引号/反斜杠被 400 拒绝（LIKE 匹配转义边界，前端输入无硬拦截——后端兜底）
- 使用趋势按 UTC 日期分桶（单用户本地部署偏差可忽略）；PG 下时区语义与 SQLite 有细微差异
- 导入的历史版本会重排为连续版本链（原始 version 号不保留）
- 单条导出 md 的 frontmatter 为 JSON 格式（YAML 子集），非标准 Jekyll frontmatter
