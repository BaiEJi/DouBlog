# Bookmarks 模块（书签与稍后阅读，2026-10-16 新增）

> 数据表：bookmarks_* 4 表　路由前缀：/api/bookmarks　前端：/bookmarks（门户"书签 · 稍后阅读"卡直达）　sys_name：doublog.bookmarks
> 后端 `app/bookmarks/`；前端 `src/bookmarks/`

## 1. 模块契约（app/bookmarks/__init__.py）

- 仅导出 `router`（~23 端点，/api/bookmarks/*）；无 start_background、无 ensure_migrations（全新表，create_all 直接建；死链检测是手动触发的批量任务，无定时线程）
- 无跨模块依赖；网络抓取（元信息/快照/死链）在 `fetcher.py` 纯函数不落库；导入导出（Netscape HTML + JSON）在 `transfer.py`

## 2. 数据模型（4 表 bookmarks_*）

- `bookmarks_categories`：分类（文件夹）树，≤3 层（level 0/1/2，与 blog 文章树同口径），sort_order 浮点中点插入；删除时子孙与条目上提一级（不删书签）
- `bookmarks_items`：核心条目。`normalized_url` 为查重/重复检测统一口径（host 小写、去默认端口/fragment、剥 utm_* 追踪参数、路径保持大小写、裸域名补 https）；status ∈ unread/reading/read/archived（read_at 随状态机维护）；starred 独立维度；link_status ∈ unknown/ok/dead/error + link_code + last_checked_at（死链检测）；snapshot_md/snapshot_words/snapshot_at（离线快照，Text 大字段，列表查询必须 defer）；软删 deleted_at → 回收站
- `bookmarks_tags` + `bookmarks_item_tags`：标签 M2M（同 practice 模式，name 唯一，色板轮询）

## 3. API 要点（完整契约见 api.md 第 22 节）

- 分类树（含直接/累计计数）/条目 CRUD/标签 CRUD/多维筛选（q、status、category_id 含子孙、tag_ids and/or、starred、link_status、trash、6 种排序、分页）
- 状态机：→read 记 read_at、离开 read 清空；batch 七种动作（status/star/unstar/move_category/add_tags/delete/restore）
- **URL 查重**：创建/改链/还原（restore 遇同链新书签 409）都按 normalized_url 校验未删除条目；回收站旧档不阻塞新建
- **元信息抓取** `GET /meta?url=`（不落库，表单自动填充）；**离线快照** `POST /items/{id}/snapshot`（启发式正文抽取→Markdown，article/main/body 取可读文本最长者，词数 <20 视为失败 502；复用 blog 前端 md.js 渲染）
- **死链检测** `POST /check`：显式 ids（≤50）或空=全库最久未检前 50；HEAD 优先、405/403/400/5xx 回退 GET；<400 与 401/403/405/429=ok，其余=dead，网络异常=error；并发走模块池 get_pool('bookmarks', 8)，网络段 run_in_threadpool 包裹不阻塞事件循环
- **阅读队列** `GET /items/queue/next`（最早未读，可按分类/标签过滤；前端"下一篇"英雄卡）
- **导入导出**：Netscape HTML（浏览器通用格式；文件夹→分类树、ADD_DATE→created_at、TAGS/DATA-STATUS/DATA-STARRED/DATA-NOTE 自定义属性往返；`<DD>` 无闭合标签按"持续到下一标记"解析）+ JSON（全量备份含快照/分类树/标签/已读状态）；重复自动跳过计数
- 网络异常一律收敛为 FetchError 分类文案（502 信封），原文进 warning 日志

## 4. 前端（src/bookmarks/）

独立页 BookmarksPage（公共 ModuleShell 侧栏，个性色 orange）→ BookmarksView 五子视图：收藏夹（筛选+批量操作条+分页）/ 稍后阅读（英雄卡+队列）/ 统计（指标卡+状态环形+30 天趋势+分类/标签/站点 TOP）/ 工具（导入导出/死链检测/重复链接去重）/ 回收站（还原/彻底删除/清空）；详情与收录/编辑为覆盖层（state 切换，同 practice 先例）；分类管理为模态。kit/charts 组件跨模块引自 `src/todo/`；快照正文经 shared/md.js 渲染。

## 5. 质量与测试

- tests/bookmarks/test_bookmarks.py **50 例**全绿（URL 规范化/正文抽取单元参数化；网络端点 meta/snapshot/check 全 monkeypatch，不连外网；Netscape/JSON 导入导出往返含快照/分类/标签/已读状态还原）
- 全量回归：除 clash 14 例（main 基线即失败的本机环境问题）外全部通过，零新增失败
- UI 走查：docs/shots11/ 14 张截图（明暗两态、全部视图与覆盖层），image 子智能体审查记录见提交说明
