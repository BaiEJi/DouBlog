# DouBlog Flask → FastAPI 全面迁移规范（施工蓝图）

> 2026-10 生效。本文是迁移的唯一规范：骨架 API 契约、移植对照、表名映射、验收门槛。
> 子代理按第 6 节的模块任务清单施工。迁移阶段的暂缓已结束；本轮优化使用冻结源码与统一种子A/B，见 `docs/optimization-execution.md`。

---

## 1. 目标与约束

- Flask 3 → **FastAPI（单进程 uvicorn）**，行为对前端完全透明：URL、方法、认证（统一登录：会话 Cookie 优先 + Basic 兼容）、`{success,code,message,data}` 信封、状态码、gzip 全部不变
- **禁止**多 worker、禁止新增外部组件（无 Redis/Celery/gunicorn）
- 每模块的**日志走 lizysdk.logs**（`sys_name=doublog.<module>`）、**并发执行走 lizysdk.pools**（`app.shared.pools.get_pool('<module>')`）；结构性单写者/调度线程（sdklogs 写者线程、各 daemon 调度器）保留 `threading`，其执行体经 SDK 池。**禁止 `ThreadPoolExecutor` / `concurrent.futures`**
- 所有模块同一库（`data/blog.db` / PG `doublog`），表名 `模块名_表名`
- Flask 原版快照在 `backend/tools/flask-snapshot/`（对照行为用，只读）

## 2. 运行架构

```
uvicorn (单进程, run.py, 端口 60100, dev 模式 --reload 监听 app/)
 └─ FastAPI app (app/main.py:create_app)
     ├─ 中间件：trace（纯 ASGI，每请求绑 lizysdk trace_id，响应头 X-Trace-Id 透传/回写）
     │   → GZipMiddleware(≥1KB) → CORSMiddleware(/api/*)
     ├─ 异常处理器：AppError / HTTPException / RequestValidationError / Exception → 统一信封
     │   （AppError → {success:False, code:http_status, message, data:{error_code, details}}；
     │     401不附Basic弹框头；404 → "资源不存在"）
     ├─ app.state.testing（DOUBLOG_TESTING=1 时后台线程空转）
     └─ 动态模块注册表：按 MODULES 顺序 importlib 导入 app/<mod>，
         取 `router` 挂载、调 `start_background(app)`（存在才调）
         （必需模块导入失败终止启动）
```

请求执行模型：**DB 端点 `async def` + `return await run_db(lambda: <原同步逻辑>)`**（同步 SQLAlchemy 进 `doublog-db` SDK 线程池，结束时在工作线程清理已存在的会话）。纯内存端点可直接 async。

## 3. 骨架 API 契约（模块复用；整体优化由根任务同步维护）

### app/db.py

| 名字 | 说明 |
|---|---|
| `Base` | SQLAlchemy 2.0 DeclarativeBase，**自带 `query` 描述符**（`Model.query` ≡ `db.session.query(Model)`） |
| `db` | 兼容门面：`db.session`（当前 app runtime 的 scoped_session）、`db.engine` |
| `run_db(fn,*args,_pool=None,**kwargs)` | **async**。捕获提交时 runtime，同步 fn 进 SDK 线程池；工作线程已有 Session 才 rollback+remove，纯缓存/直接连接任务不创建空 Session；取消等待方仍计数到实际工作结束 |
| `load_db_config/save_db_config/get_database_url/SUPPORTED_BACKENDS` | 数据库切换用（system 模块） |
| `LEGACY_TABLE_MAP` | 存量表改名映射（第 5 节） |
| `init_db(app)` | 存量改名 → 建表 → 逐模块 `ensure_migrations(engine)` 钩子 → 播种虚拟根 → SQLite WAL/PRAGMA |

模型写法（迁移后）：

```python
from sqlalchemy import BigInteger, Integer, String, Text, ForeignKey, Index, LargeBinary
from sqlalchemy.orm import relationship, Mapped, mapped_column
from app.db import Base

class Post(Base):
    __tablename__ = 'blog_posts'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
```

### app/shared/（骨架提供）

- `response.api_response(data=None, code=200, message='操作成功') -> JSONResponse`（签名/信封与 Flask 时代一致，中文不转义）
- `auth.require_basic`：**依赖**（会话 Cookie 优先，Basic 兼容；/api/auth/login JSON 载荷签发 Cookie、/logout 清除）。用法 `APIRouter(prefix=..., dependencies=[Depends(require_basic)])` 或路由级。免认证路由不挂。`verify_password(u,p)` 供复用。旧 `auth`/`@auth.login_required` **不存在了**
- `pools.get_pool(module, workers=None)`：模块命名池（`doublog-<module>`，缓存）；`DB_POOL`；`shutdown_pools()`
- `modules.module_for_path/sys_name_for/mod_logger/load_logs_config`：与 Flask 版一致（apihub 前缀已加入映射）
- `timestamps._iso/_utcnow`：不变
- `logging_setup.setup_logging_for_app()`：不变

### 模块包对外契约（main.py 靠它发现你）

```python
# app/<mod>/__init__.py 必须导出：
router                # APIRouter（可由多个子 router 组成）
start_background(app) # 可选：后台线程启动（内部 app.state.testing 时直接 return）
ensure_migrations(engine)  # 可选：列/索引幂等迁移钩子（init_db 在表改名后调用）
```

### 运行态挂载原则

- 模块运行态（apihub 的 state、sdklogs 的 pipeline 等）挂 **`app.state.<mod>`**，**禁止模块级单例**——测试每个用例都新建 app，单例会跨 app 泄漏
- 后台线程持有**真实 app 对象**（FastAPI 无代理，直接传引用即可）

## 4. Flask → FastAPI 移植对照

| Flask | FastAPI |
|---|---|
| `Blueprint('x', url_prefix='/api/x')` | `APIRouter(prefix='/api/x')` |
| `@bp.route('/e/<int:id>', methods=['GET'])` | `@router.get('/e/{id}')`，函数参数 `id: int` |
| `request.get_json(silent=True) or {}` | `body = await request.json()` try/except（**不用 pydantic 体模型**，保持原校验与错误文案） |
| `request.args.get('page', 1, type=int)` | `request.query_params.get('page')` + 原转换逻辑 |
| `request.form` / `request.files` | `form = await request.form()`（UploadFile） |
| `request.headers.get(...)` | 同名一致 |
| `@auth.login_required` | `dependencies=[Depends(require_basic)]` |
| `send_file(path, mimetype=...)` | `FileResponse(path, media_type=...)`（目录围栏/白名单逻辑照搬） |
| `send_file(BytesIO...)` / zip 导出 | `Response(content=bytes, media_type=..., headers={'Content-Disposition': ...})` |
| `db.session` / `Model.query` | **不变**（兼容层同义） |
| `current_app` / `app.extensions['x']` | 显式传 `app` 或 `request.app.state.<x>` |
| `app.config['TESTING']` | `app.state.testing` |
| werkzeug reloader（touch `_reload_stamp.py`） | uvicorn `--reload` 监听 app/ 目录，touch 同一文件 |
| `ThreadPoolExecutor(...)` | `get_pool('<module>', workers=N)` |

**移植纪律**：路径/方法/参数/响应/错误文案一字不改；DB 与业务逻辑照搬只换框架调用；每条路由对照原实现自检。

**测试移植**：`response.get_json()` → `.json()`；`data=json.dumps(...)+content_type` → `json=`；`query_string=` → `params=`；表单 `data={...}` → `data=`（httpx 同名）；`follow_redirects=True` → `follow_redirects=True`。契约断言（状态码/信封/错误文案）不许动。

## 5. 表名映射（模块名_表名）

| 模块 | 旧表名 | 新表名 |
|---|---|---|
| blog | `posts` | `blog_posts` |
| blog | `workspaces` | `blog_workspaces` |
| blog | `audit_logs` | `blog_audit_logs` |
| diary | `diaries` | `diary_diaries` |
| diary | `diary_journals` | 不变（已合规） |
| sdklogs | `sdk_logs` | `sdklogs_logs` |
| sdklogs | `sdk_alerts` | `sdklogs_alerts` |
| vault/pwsvc/subs/apihub | 全部 | 不变（已合规） |

- 模型 `__tablename__` 改新名；**所有裸 SQL 字符串**（`text(...)`、迁移函数、统计 SQL）同步改新名
- 存量库 RENAME 由骨架 `init_db` 统一做；列/索引迁移放模块 `ensure_migrations(engine)`（表名用新名），保持既有数据

## 6. 模块任务清单

每模块 = `app/<mod>/` 全部 + `tests/<mod>/`（apihub 为 `tests/test_apihub_*.py`）。交付：模型（新表名）→ 路由（契约不变）→ `__init__.py` 三契约 → 测试全绿 → `grep -rn "flask\|current_app\|ThreadPoolExecutor\|from concurrent.futures" app/<mod>/` 零命中。

模块特殊点：

- **system**：`/api/admin/database*` 切换语义不变；`restart_required = not settings.debug`（dev 下 touch `_reload_stamp.py` 触发 uvicorn 重载，沿用延时线程）；`GET /api/admin/database` 的统计 SQL 用新表名；logging 配置三端点照搬
- **blog**：把 `_ensure_workspace_migration` 改造成 `ensure_migrations(engine)`（列补齐用新表名 `blog_posts/blog_workspaces`）；链式转发书签迁移，在 `engine.begin()` 中用 SQLAlchemy `CreateIndex(if_not_exists=True)` 为存量 `bookmarks_items` 补 `ix_bmitem_deleted_created_id(deleted_at,created_at,id)`，保留既有数据与索引（create_all 不会给已存在的表补索引）；图片上传/下载（`FileResponse` + 目录围栏）；zip 导出；树/列表**不含 content**（契约不变）
- **diary**：`_ensure_diary_migration` → `ensure_migrations`（新表名 `diary_diaries`）；share 端点免 Basic Auth
- **pwsvc**：`_ensure_pwsvc_migration` → `ensure_migrations`；限流令牌桶是进程内实现照搬；黄金向量测试不许改断言
- **sdklogs**：摄入端点免 Basic Auth（可选 token）；pipeline 挂 `app.state`（多 app 测试不泄漏）；写者/保留/告警三线程保留，`app.state.testing` 空转；`tests/shared/test_logging_integration.py`（已移植）依赖你的端点，最终一并跑绿
- **subs**：每日线程保留（testing 空转）；测试直接调 `run_daily_spending_log/backup_database` 不等线程
- **apihub**：运行态 `app.extensions['apihub']` → `app.state.apihub`（state 持真实 app）；`get_state()` 改显式传 app 或 request.app；探活 executor → `get_pool('apihub-probe', workers=10)`；`http.client` 连接池（pool.py）保留不动（连接复用不是并发池）；gw 端点鉴权走 sk- 令牌不是 Basic

## 7. 验收（每模块，全过才算完）

| 门槛 | 证据 |
|---|---|
| 模块测试全绿 | `./venv/Scripts/python.exe -m pytest tests/<mod>/ -q`（apihub：`pytest tests/test_apihub_core.py tests/test_apihub_api.py -q`） |
| 契约不变 | 移植前后同输入同状态码同信封（对照 `tools/flask-snapshot/` 原实现逐路由自检） |
| 无框架残留 | 第 6 节 grep 零命中 |
| 压测 | **暂缓**（用户指令）；工具在 `tools/bench/`，恢复后按第 8 节对照 |


## 2026-10-21 当前骨架增补

`db.database_context(app_or_runtime)` 为后台绑定所属库；`run_db(fn,*args,_pool=None,**kwargs)` 捕获提交时runtime，并包含排队/执行计数与取消清理。默认DbFacade只作为未绑定同步脚本的兼容入口，后台不能依赖它寻找最近创建的app。

模块除router/start_background/ensure_migrations外，可导出幂等 `drain_background(app,timeout=5.0)` 与 `stop_background(app,timeout=5.0)`，False阻止切换或报告退出未完成。仅提供stop钩子的惰性资源模块也必须登记到app的活动资源集，退出/切库同样清理；无需为登记而创建后台线程。启动钩子成功后才标记活动，停止失败保留登记供重试。应用lifespan关闭自己的资源，SDK执行池由进程退出统一关闭。`shared.pools.run_blocking`用于非DB阻塞工作，`shared.files`提供原子JSON/text写入。跨app缓存使用runtime身份；读结果回填必须核对查询前捕获的写纪元。
