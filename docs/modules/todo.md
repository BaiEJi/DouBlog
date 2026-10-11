# Todo 模块（四象限待办，MyTodo 迁入）

> 数据表：todo_* 五表　路由前缀：/api/todo　前端：/todo（门户"待办 · 四象限"卡）　更新：2026-10-11（自 MyTodo 仓库迁入）
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

- services 七文件（`__init__` 含设置读写/事件日志 + tasks/migrations/day/stats/plans/notify）**逻辑与 MyTodo 原样一致**，仅换表名/模型引用；timeutil（uuid7/UTC↔本地）/limits（每日容量）/seed（默认类别种子）/readcache（/today 响应缓存，见第 10 节）
- 舍弃项：自研 token 鉴权、响应加密（X-MyTodo-Enc）、/system/db 切换（Doublog 有统一实现）、api_fast 缓存层、obs（Doublog 自有日志）
- start_background(app)：启动物化一次（app.state.testing 空转）；/today 路由内 30s 节流（时间戳挂 app.state.todo_mat_at）
- ensure_migrations(engine)：空库种子 4 默认类别（工作/学习/生活/健康，幂等）
- 数据导入：`backend/tools/import_mytodo.py`（源 WAL 先 copy 再读；幂等=目标空才导，--force 重导；行数校验）

## 5. 前端（frontend/src/todo/，18 文件）

TodoPage 壳（顶栏 +「图谱」入口 + 9 Tab：今日/待办池/日历/回顾/统计/刷题/生活/挂机/设置，视图走 ?v= 深链）+ kit（象限文案 Hook 可被 settings 覆盖/Modal/Toast/档位件）+ 纯 SVG 图表（照 subs/charts 模式）。核心视图：Today（四象限 dnd-kit 拖拽/迁移面板）、Backlog（收件箱/待迁移/已搁置）、Calendar（周/月/年，plan_only 切 life 模式）、Review、Stats（热力图 CSS grid）、Settings（偏好/类别/邮件推送）、Life（打卡/计划 CRUD 四规则表单/日历/统计/回顾，views/life/ 四文件）；「刷题」「挂机」Tab 见第 9/8 节子模块，「图谱」见第 7 节。鉴权/主题/请求层全部复用 Doublog（apiFetch 会话 Cookie）。

## 6. 测试（tests/todo/ 核心 5 文件 53 用例）

test_api（任务 CRUD/过滤/象限/排序/乐观锁/软删恢复/401 鉴权/序列化等价性/今日缓存失效）、test_plans（四规则物化/打卡/报告）、test_day_limits（每日容量）、test_completion_note、test_task_notify；断言从 MyTodo 测试等价移植（信封 unwrap + /api/todo 前缀适配）。todo 域合计 166（基础 53 + gamemap 34 + steamidler 18 + practice 61）。

## 7. 子模块 gamemap（剧情人物关系图谱，2026-10-11 迁入）

> 源 C:\Users\Lizy\Desktop\Code\gamemap；规范 docs/gamemap-migration.md；后端 `app/todo/gamemap/`；前端 `src/todo/gamemap/`（入口：TodoPage「图谱」→ /todo/gamemap，门户"剧情图谱"卡直达）

- **13 表 gamemap_***（games/chapters/characters/chapter_characters/character_photos/boards/board_nodes/relation_types/game_relation_overrides/chapter_relations/story_events/event_characters/attachments）逐列照搬
- **端点 /api/todo/gamemap/***（games 含 export/import+stats、chapters、characters 含批量、boards 含 merged 跨章聚合/拖动 PATCH/整板乐观锁 409、events、photos、relation_types、search、uploads 挂鉴权 + files 附件下载免认证）；response_cache 照搬（读缓存写失效，256 条）；附件 `<data_dir>/gamemap_attachments/`（白名单 png/jpg/jpeg/webp/gif，UUID 名）
- 前端保留 antd6/@xyflow/react 技术栈（画布无法 Tailwind 平替；antd 仅此子模块用，ConfigProvider 只包子树，暗色随 Doublog dark 联动）；**根 main.jsx 已移除 StrictMode**（xyflow 非受控 + 松手时序，dev 双渲染破坏拖动——源项目同款决策）
- 已知坑：xyflow 12.11.6 + React19 边静默不渲染（自绘 SVG EdgeLayer 绕过，勿改回内置）；画布/HUD 深空色板不随浅色模式变（保留源设计）；delete 章节/有子游戏 500（源缺陷锁定，勿在新代码依赖）
- 数据已导入（13 游戏/27 章/41 人物/27 板/39 关系/31 照片/32 附件）；`tools/import_gamemap.py` 幂等（--force 重导）
- 测试：tests/todo/test_gamemap.py 34 例（todo 域合计 166：基础 53 + gamemap 34 + steamidler 18 + practice 61）

## 8. 子模块 steamidler（Steam 挂机，2026-10-11 迁入）

> 源 Code/steam-idler（只读）；规范 docs/steamidler-migration.md；后端 `app/todo/steamidler/`；前端 `src/todo/steamidler/`（TodoPage「挂机」Tab）

- 自研 Steam IAuthenticationService 认证（protobuf 请求体）+ 每账号一个 CM 挂机线程；gevent 限在 worker 线程独立 hub，**禁 monkey.patch_all**——auth.py/worker.py 与源**逐字节一致**（保持可 diff）
- 表 steamidler_accounts（SQLAlchemy 单表挂主库，create_all 直接建）；refresh_token/shared_secret 明文存储（源语义）；DB 访问统一 db_svc（scoped_session 逐调用 commit+remove）
- 12 端点 /api/todo/steamidler/*（router 级 require_basic + 信封，处理器保持 sync def）；登录成功经 login/status 去重落库（模块级 `_completed_attempts`）
- Manager 挂 app.state.steamidler_manager（get_manager 懒建）；start_background 启动即恢复账号（TESTING 空转）+ atexit 尽力 shutdown；日志 mod_logger('todo')
- 前端 6 文件：SteamIdlerView（统计栏+登录卡+账号网格+弹窗调度，3s 轮询）+ LoginCard/AccountCard/GamePicker/LogPanel + api.js（apiFetch 信封 unwrap .data）；Tailwind 化，个性色 rose
- 依赖 steam[client] 1.4.4（gevent 26.x / protobuf 3.20.3 / pycryptodomex）——**protobuf 被 steam[client] 锁 3.20.3，不得引入 protobuf 4+/grpcio**；测试 18 例（登录/worker 全打桩，无真实 Steam 连接）

## 9. 子模块 practice（刷题记录，2026-10-11 新增）

> 后端 app/todo/practice/；前端 src/todo/practice/（TodoPage「刷题」Tab，门户"刷题 · 算法练习"卡直达 /todo?v=practice）；规范 docs/practice-spec.md

- **6 表 practice_*：problems/tags/problem_tags/solutions/solution_codes/reviews**；艾宾浩斯复习 [1,2,4,7,15,30,60,120] 三键打卡
- **22 端点 /api/todo/practice/***（CRUD/筛选/解法代码/标签/抓题 LeetCode+洛谷/复习/统计/导入导出）；列表/队列 defer Text 大字段（独立 Summary schema）
- 一键抓题：LeetCode GraphQL（国际版）+ 洛谷 x-lentille-request（新 API）适配器，草稿不落库；HTML→MD 手写正则（转换顺序：结构标签→strip 标签→html.unescape），未引入 html2text
- 复习状态机：pending→done/cancelled，partial unique index 防双 pending，连续 2 forgot→todo，stage=7→mastered
- 依赖：仅 PyYAML（frontmatter 解析，requirements.txt 已显式声明 PyYAML==6.0.3）
- 20 轮代码评审：100 个问题发现并修复（数据完整性/API 一致性/性能/安全/边界/契约对齐/资源管理/整洁度）
- 测试：tests/todo/test_practice.py 61 例（抓题全 Mock fixture 回放，不连外网）

## 10. 已知边界

- 迁移数据：951 个历史任务带 plan_id 但源库 plans 已删（孤儿实例，展示/统计口径与 MyTodo 一致）；2406/2500 为软删除（列表历来排除）
- Chrome 扩展 / Android（DouBlog/extensions/todo/{chrome-extension,android} 平迁自 MyTodo）**仍指向旧服务 8070 + token 协议**——按用户指令平迁不改码；待后续按 Doublog 统一登录改造
- MyTodo 技能（~/.agents/skills/mytodo）仍指向 8070；停掉旧服务后该技能与两端客户端需另行适配
- GET /api/todo/today 已加进程内响应缓存（`app/todo/readcache.py`，2026-10 性能专项）：信封字节缓存于 app.state，键含 (view_date, 本地今日)，todo 模块全部写端点 commit 后 bump 纪元失效——写后立即可见，跨午夜自然换键；直接改库不经 API 不在失效范围（单进程约定）。其余读接口（/tasks 列表、stats 族）仍直查（列表过滤组合多，缓存收益低）
