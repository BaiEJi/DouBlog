# Todo 模块（四象限待办，MyTodo 迁入）

> 数据表：todo_* 五表　路由前缀：/api/todo　前端：/todo（门户"待办 · 四象限"卡）　更新：2026-10-12（gamemap/practice/steamidler 拆为独立顶级模块）
> 源仓库 C:\Users\Lizy\Desktop\Code\MyTodo（只读保留）；迁移规范见 docs/todo-migration.md；数据已导入（2500 任务/5695 事件）

## 1. 功能概述

- **四象限看板**：is_important × is_urgent 两布尔正交存储，象限为派生值；象限内排序 = 浮点中点插入法（position）；今日/特定日期视图
- **日期体系**：task_date 为空 = 收件箱（待办池）；original_date 迁移后不变；due_at + due_is_full_day
- **任务迁移链**：逾期任务待迁移（migrated_count / last_migrated_from）；干预阈值（默认 3 次触发三选：删除/降池/继续）；搁置（shelved_at 不再催办）；自动迁移开关（auto_migrate + auto_urgent_days）
- **规律生活计划（life）**：四种循环规则（weekly 周几 / interval 间隔天 / weekly_times 每周次数自动均摊 / monthly_times 每月次数），`materialize_plans` 把 [today-2, today+90] 窗口物化为真实任务实例（plan_id+task_date 幂等）；触发点 = 启动 start_background + GET /today 30s 节流 + 计划写操作
- **统计**：daily / range / heatmap / streak（按当前状态计，取消完成即回退）
- **任务级通知**：notify_time + channels（email 已实现 SMTP；chrome 渠道由扩展代发）；每日容量上限（limits）
- **完成备注** completion_note；不可变事件日志 task_events（Org-mode LOGBOOK 结构化版）；revision 乐观锁

## 2. 数据模型（app/todo/models.py）

| 表 | 要点 |
|---|---|
| todo_categories | id(uuid7)/name/color/icon/sort_order/is_archived |
| todo_tasks | 全列照搬 MyTodo tasks（四象限两布尔/position/status 四态/日期体系/迁移链/shelved/estimate/notify 三件套/completion_note/plan_id/revision/软删）；索引 date+status、important+urgent；CheckConstraint status |
| todo_task_events | task_id FK CASCADE / event_type / payload(JSON 文本) |
| todo_app_settings | key="app" 单行 JSON（时区/象限文案/迁移阈值/软上限/通知渠道配置） |
| todo_plans | 四种 rule_type + rule_data(JSON)/quadrant/start_end/enabled |

**users 表未迁移**（MyTodo 的 token 登录闸门整体舍弃，鉴权 = Doublog 统一登录 require_basic）。

## 3. API 契约（全部挂 require_basic，Doublog 信封）

tasks：GET /api/todo/tasks（date/from/to/inbox/overdue/status/category_id/quadrant/q/sort/plan_only/exclude_plans）、POST(201)、GET /{id}（含最近 50 事件）、PATCH /{id}（revision 乐观锁 409）、DELETE（软删）、POST /{id}/restore|complete（可带 note）|reopen|move|reorder。
categories：GET/POST/PATCH/DELETE（删除时任务归未分类，返回 moved_to_uncategorized）。
plans：GET（含 next_occurrence）、POST（创建即物化）、GET /today（打卡视图）、GET /report?days、PATCH、DELETE。
today：GET /api/todo/today?date=（四象限分组+待迁移+昨日概况+streak+软上限提示）。
migrations：GET /pending、GET /shelved、POST /tasks/{id}/migrate、/bulk、/decide（keep/delete/unshelve）、/auto。
stats：GET /daily、/range?from&to、/heatmap?year、/streak。
settings：GET / PUT（字段级增量，timezone/象限文案/阈值/通知渠道校验）。
notifications：POST /test（email 实测发送；未配置/未启用 400，未知渠道 404）。

服务层校验保持 MyTodo 原状态码与中文文案（404/409/422→400 信封）；pydantic body 校验失败经 Doublog 处理器出 400。

## 4. 后端要点（app/todo/）

- services 七文件（`__init__` 含设置读写/事件日志 + tasks/migrations/day/stats/plans/notify）**逻辑与 MyTodo 原样一致**，仅换表名/模型引用；limits（每日容量）/seed（默认类别种子）/readcache（/today 响应缓存，见第 8 节）
- timeutil（uuid7/UTC↔本地）已提升为共享层 `app/shared/timeutil.py`（todo 与 practice 共用，2026-10-12 模块拆分时上移）
- 舍弃项：自研 token 鉴权、响应加密（X-MyTodo-Enc）、/system/db 切换（Doublog 有统一实现）、api_fast 缓存层、obs（Doublog 自有日志）
- start_background(app)：启动物化一次（app.state.testing 空转）；/today 路由内 30s 节流（时间戳挂 app.state.todo_mat_at）
- ensure_migrations(engine)：空库种子 4 默认类别（工作/学习/生活/健康，幂等）
- 数据导入：`backend/tools/import_mytodo.py`（源 WAL 先 copy 再读；幂等=目标空才导，--force 重导；行数校验）

## 5. 前端（frontend/src/todo/）

TodoPage 壳（公共侧栏 + 7 视图（生活下含 5 子项）：今日/待办池/日历/回顾/统计/生活/设置，视图走 ?v= 深链）+ kit（象限文案 Hook 可被 settings 覆盖/Modal/Toast/档位件，**gamemap/practice/steamidler 页面跨模块引用它**）+ 纯 SVG 图表 charts.jsx（practice 统计面板跨模块引用）。核心视图：Today（四象限 dnd-kit 拖拽/迁移面板）、Backlog（收件箱/待迁移/已搁置）、Calendar（周/月/年，plan_only 切 life 模式）、Review、Stats（热力图 CSS grid）、Settings（偏好/类别/邮件推送）、Life（打卡/计划 CRUD 四规则表单/日历/统计/回顾，views/life/ 四文件）。鉴权/主题/请求层全部复用 Doublog（apiFetch 会话 Cookie）。

今日 / 特定日期看板按视口可用高度铺满，四象限为两行两列等宽等高；空象限保留完整空间。每格可见区固定容纳 8 行，行高随可用高度均分，超过 8 条时仅该象限内部滚动。任务标题、类别、生活/迁移标记同一行显示；长标题省略，备注和完成备注通过悬停提示或编辑弹窗查看。软上限告警移到象限标题旁，避免挤占任务行；操作菜单通过 portal 定位在视口内，可跨出滚动区显示，滚动 / Escape / 点击外部关闭。

## 6. 测试（tests/todo/ 核心 5 文件 53 用例）

test_api（任务 CRUD/过滤/象限/排序/乐观锁/软删恢复/401 鉴权/序列化等价性/今日缓存失效）、test_plans（四规则物化/打卡/报告）、test_day_limits（每日容量）、test_completion_note、test_task_notify；断言从 MyTodo 测试等价移植（信封 unwrap + /api/todo 前缀适配）。

## 7. 已知边界

- 迁移数据：951 个历史任务带 plan_id 但源库 plans 已删（孤儿实例，展示/统计口径与 MyTodo 一致）；2406/2500 为软删除（列表历来排除）
- Chrome 扩展 / Android（DouBlog/extensions/todo/{chrome-extension,android} 平迁自 MyTodo）**仍指向旧服务 8070 + token 协议**——按用户指令平迁不改码；待后续按 Doublog 统一登录改造
- MyTodo 技能（~/.agents/skills/mytodo）仍指向 8070；停掉旧服务后该技能与两端客户端需另行适配
- GET /api/todo/today 已加进程内响应缓存（`app/todo/readcache.py`，2026-10 性能专项）：信封字节缓存于 app.state，键含 (view_date, 本地今日)，todo 模块全部写端点 commit 后 bump 纪元失效——写后立即可见，跨午夜自然换键；直接改库不经 API 不在失效范围（单进程约定）。其余读接口（/tasks 列表、stats 族）仍直查（列表过滤组合多，缓存收益低）

## 公共 UI 外壳（2026-10-13）

前端由 `shared/ModuleShell.jsx` 提供统一紧凑可折叠侧栏、多级菜单与内容画布；导航状态经 `useModuleNavigation` 注册。前端仅适配桌面浏览器，无移动端布局。页面内部的业务工具栏、表格、编辑器与弹层仍由模块管理。布局与性能契约见 `frontend.md` 的页面布局约定。

待办池的收件箱 / 迁移池 / 搁置计划使用侧栏二级菜单，URL 为 `?v=backlog&bsub=inbox|migrate|shelved`；生活子视图仍使用 `lsub`。长表单通用 Modal 限制到视口高度，正文内部滚动，标题与操作按钮固定可见。
