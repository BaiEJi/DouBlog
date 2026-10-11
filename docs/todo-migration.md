# MyTodo → DouBlog todo 模块迁移规范（施工蓝图）

> 2026-10-10。源仓库 `C:\Users\Lizy\Desktop\Code\MyTodo`（保持原样只读）；本规范是唯一依据。
> 目标：MyTodo 成为 DouBlog 能力包 `todo`，与 blog/diary/vault 等完全同构。

## 1. 总映射

| 维度 | MyTodo | DouBlog todo 模块 |
|---|---|
| 后端 | FastAPI 独立服务 :8070 | `backend/app/todo/` 能力包（router 契约挂 Doublog 动态注册表） |
| 鉴权 | 自研 HMAC token（users 表/注册/login） | **删除**——统一用 `Depends(require_basic)`（会话 Cookie/Basic） |
| 表 | categories/tasks/task_events/app_settings/plans/users | `todo_categories` / `todo_tasks` / `todo_task_events` / `todo_app_settings` / `todo_plans`（**users 整表删除**；业务表本就无 user_id） |
| 端点前缀 | `/api/v1/*` | **`/api/todo/*`**（去掉 v1；避开 sdklogs 的 /api/v1 冲突） |
| 响应形状 | 裸 JSON / pydantic Out 模型 | **Doublog 信封** `api_response(data)`（前端新 api 层 unwrap `.data`） |
| 前端 | React18+TS+antd+recharts+dayjs :8071 | `frontend/src/todo/` Tailwind 重建（复用 apiFetch/暗色/dnd-kit/SVG 图表模式） |
| chrome 扩展/android | 仓库目录 | 平迁至 `DouBlog/extensions/todo/{chrome-extension,android}`（内容不改） |
| 数据 | MyTodo backend/data/todo.db（2500 任务/5695 事件/4 分类/1 设置行） | 导入脚本迁入 Doublog 库 todo_* 表 |

## 2. 端点映射（MyTodo `/api/v1/X` → Doublog `/api/todo/X`）

tasks（/api/todo/tasks）：GET ""（全部过滤参数含 plan_only/exclude_plans）、POST ""(201)、GET /{id}（含最近 50 事件）、PATCH /{id}（revision 乐观锁）、DELETE /{id}（软删）、POST /{id}/restore|complete|reopen|move|reorder。
categories（/api/todo/categories）：GET ""、POST ""(201)、PATCH /{id}、DELETE /{id}。
plans（/api/todo/plans）：GET ""（含下次发生日）、POST ""（创建即物化）、GET /today（生活打卡）、GET /report?days、PATCH /{id}、DELETE /{id}。
day（/api/todo/today）：GET ?date=（四象限分组+待迁移+昨日概况+streak；内部 30s 节流物化）。
migrations（/api/todo/migrations）：GET /pending、GET /shelved、POST /tasks/{id}/migrate、POST /bulk、POST /decide、POST /auto。
stats（/api/todo/stats）：GET /daily、/range?from&to、/heatmap?year、/streak。
settings（/api/todo/settings）：GET ""、PUT ""（字段级增量）。
notifications（/api/todo/notifications）：POST /test（email 渠道实测发送）。

**舍弃**（Doublog 已有或不适用）：auth 全部端点、/system/health、/system/response-secret、/system/db*（Doublog 有统一切换）、/system/export|import、响应加密中间件（X-MyTodo-Enc）、obs（Doublog 有自己的日志）、api_fast 缓存层（直接构造响应）。

## 3. 后端移植规则（app/todo/）

- 包结构：`models.py`（五表，`app.db.Base`，表名 todo_*，列/索引/CheckConstraint 照搬）＋`schemas.py`（pydantic 入参模型照搬；Out 模型可保留用于序列化）＋`services/`（`__init__` 含设置读写/事件日志 + tasks/migrations/day/stats/plans/notify 七文件**逻辑原样照搬**，仅改 import 与表名/模型引用）＋`timeutil.py`（uuid7/UTC↔本地 照搬）＋`limits.py`（每日容量上限 照搬）＋`routes.py`（全部端点，router 级 `dependencies=[Depends(require_basic)]`）＋`__init__.py`（导出 `router`、`start_background(app)`、`ensure_migrations` 可省）。施工后增补：`seed.py`（默认类别种子拆出）与 `readcache.py`（/today 响应缓存，2026-10 性能专项，见 docs/modules/todo.md 第 7 节）
- **错误转换**：MyTodo `HTTPException(code, msg)` → `return api_response(None, code, msg)`（Doublog 全局 404 处理器会覆盖 detail，必须显式返回）；422 校验类同
- pydantic 422（body 校验失败）会由 Doublog 处理器出 400 信封——可接受，前端 api 层按 400 处理
- 会话：Doublog `run_db` 执行模型（DB 端点 async def + 同步闭包进 doublog-db 池）；services 里的 Session 对象 = `db.session`
- `start_background(app)`：启动时 `materialize_plans`（app.state.testing 时跳过；/today 的 30s 节流物化保留在路由内）
- 时区等设置存 todo_app_settings（key="app" 原样），DEFAULT_SETTINGS 照搬
- 种子：空库时种 4 默认类别（工作/学习/生活/健康）——放 ensure 逻辑（init 后幂等）
- 通知 email（smtplib）照搬；其余渠道预留照搬

## 4. 数据导入（backend/tools/import_mytodo.py）

- 源：`C:\Users\Lizy\Desktop\Code\MyTodo\backend\data\todo.db`（WAL 活跃——先 copy 到临时文件再读）
- 目标：DoubLog 当前库（db_config 决定）的 todo_* 五表
- 幂等：目标 todo_tasks 为空才导（--force 覆盖）；映射 categories→todo_categories 等，字段一一对应，users 丢弃；完成后打印各表行数校验（期望 tasks=2500 events=5695 categories=4 settings=1 plans=0）

## 5. 前端重建（frontend/src/todo/）

- 结构：`api.js`（全部端点封装，apiFetch + unwrap `.data`）＋`TodoPage.jsx`（壳：顶栏 + 内部 Tab 子路由 today/backlog/calendar/review/stats/settings/life）＋页面组件（对照 MyTodo pages 的交互逻辑逐一移植）＋`kit.jsx`（象限文案/日期工具/Modal/Toast）
- **UI 遵循 `docs/ui-baseline.md`**（Tailwind 档位、暗色完整、个性色 **indigo** 仅用于强调位）；dnd-kit 复用（blog 树已在用）；图表用纯 SVG（参考 subs/charts.jsx）；日期用原生 Date；**禁止引入 antd/recharts/dayjs**
- 交互保真：四象限看板（拖拽跨象限/象限内排序 float 中点）、迁移抽屉（pending/decide/bulk/auto）、收件箱、日历月视图（plan_only 切换）、回顾/统计（streak/热力图/区间）、设置（时区/象限文案/迁移阈值/通知渠道 email 配置+测试发送/类别管理）；life 五视图（今日打卡/计划 CRUD/日历复用/统计/回顾）
- 路由 `/todo/*`、门户卡片（indigo）、`index.css` 加 `@source "./todo";`——这三处接线由主线做，agent 不碰 App.jsx/PortalPage/index.css

## 6. 验收

- `pytest tests/todo/ -q` 全绿（移植 MyTodo 测试 ≈50 例：api/plans/day_limits/completion_note/task_notify 核心）
- 全量 `pytest tests/ -q` 不回退；`npm run build` 零报错
- 真实数据导入后：/api/todo/tasks 计数 2500、today/stats 正常
- image 子代理 UI 审查 /todo 明暗两态
