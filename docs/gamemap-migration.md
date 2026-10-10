# gamemap → DouBlog todo 模块迁移规范（子模块 gamemap）

> 2026-10-11。源仓库 C:\Users\Lizy\Desktop\Code\gamemap（只读）。目标：作为 **todo 模块的子模块**（"迁入 mytodo"= 迁入 DouBlog 的 todo）。
> 后端 `app/todo/gamemap/`；表名 `gamemap_*`；端点 `/api/todo/gamemap/*`；前端 `src/todo/gamemap/`（保留 antd 技术栈，见"依赖决策"）。

## 1. 后端（app/todo/gamemap/）

- **13 张表**全部前缀 `gamemap_`：gamemap_games/chapters/characters/chapter_characters/character_photos/boards/board_nodes/relation_types/game_relation_overrides/chapter_relations/story_events/event_characters/attachments——列/索引/约束逐列照搬源 models.py；挂 Doublog `app.db.Base`
- **9 组路由**统一前缀 `/api/todo/gamemap`：games（含 /{id}/export 与备份导入）、chapters、characters（含批量导入）、boards（merged 跨章聚合 / 拖动 PATCH / 整板 PUT 乐观锁）、events、photos、relation_types、search、uploads + 静态 `GET /api/todo/gamemap/files/{name}`（FileResponse，目录围栏）
- 全部 `Depends(require_basic)`；响应一律 Doublog 信封 api_response；服务层 HTTPException(code,msg)→api_response(None,code,msg)
- 会话模型同 todo：async def + run_db；schemas.py（pydantic）照搬
- **response_cache 保留**（读端点写失效；单进程假设成立）；seed 7 默认关系类型幂等
- 附件目录：`<data_dir>/gamemap_attachments/`（不再用相对 CWD 路径）；上传白名单 png/jpg/jpeg/webp/gif，UUID 文件名
- **舍弃**：/api/db + switch（Doublog 统一）、lizysdk 引用（Doublog 自有）、CORS/静态 SPA 托管、config.py（用 Doublog settings/data_dir）
- 由 app/todo/__init__.py 组合导出：todo router = 原 todo 路由 + gamemap 路由（两条 APIRouter 都挂，或 app.todo 导出 routers 列表——骨架契约是单 `router`，则用 `router.include_router(gamemap_router)`）

## 2. 数据迁移（backend/tools/import_gamemap.py）

- 源：gamemap/backend/gamemap.db（WAL——copy 后读）+ attachments 32 PNG
- 目标：Doublog 当前库 gamemap_* 13 表 + <data_dir>/gamemap_attachments/
- 幂等（目标 gamemap_games 空才导，--force 重导）；行数校验（期望 13 游戏/27 章/41 人物/27 板/39 关系/32 附件/7 关系类型，以源实际为准打印源→目标对照）

## 3. 前端（frontend/src/todo/gamemap/，保留 antd 技术栈）

**依赖决策**：关系画布核心是 @xyflow/react + 自绘 SVG EdgeLayer（有 React19 边静默不渲染的坑），antd6 重度使用（Modal/Table/Drawer/Upload/ConfigProvider）——Tailwind 重写等于重写画布，风险不可接受。**保留 antd 等依赖**（仅 gamemap 子模块使用；版本照源 package.json；主线负责 npm install）。antd 的 ConfigProvider 只包 gamemap 子树，不影响其他模块；暗色用 Doublog 的 dark class 联动 antd darkTheme。

- 搬运：board/ 10 文件（Workspace/panels/shared/DetailDrawer/PhotoCodex/tables/Toolbar/HUD/ui-store）+ pages（Dashboard/GameLibrary/RelationConfig/SearchPage）+ theme.ts + api.ts
- 适配：
  - api.ts → api.js（JSX 项目）：fetch('/api'+path) → apiFetch('/api/todo/gamemap'+path) + 信封 unwrap `.data`（401 由 apiFetch 统一跳登录）
  - 路由：内部用嵌套 Routes（/todo/gamemap、/todo/gamemap/games/:gameId、/todo/gamemap/games/:gameId/chapters/:chapterId、/todo/gamemap/relations、/todo/gamemap/search）；URL query（?scope=&ch=）保持
  - **去掉 AppShell 外壳**（自有 Sider）与 DbSwitcher：改为 GamemapShell（顶栏：← 返回 /todo + 标题"剧情图谱" + Doublog 主题切换联动 + 内部导航 游戏/关系类型/搜索）；antd ConfigProvider 包内容区
  - 暗色：读 document.documentElement.classList.contains('dark') + MutationObserver 联动 antd theme；初始跟随 Doublog
  - 上传/静态文件路径：/api/todo/gamemap/uploads、/api/todo/gamemap/files/...
- TodoPage.jsx 顶栏加"图谱"入口（链接到 /todo/gamemap）；**不碰 App.jsx/PortalPage/index.css**（主线接线）
- 已知坑照 README：xyflow 非受控 defaultNodes、不能 StrictMode、防重叠 50ms 时序 hack 保持原样；未引用的 hud.css/模板资产不搬

## 4. 测试（backend/tests/todo/test_gamemap.py 或拆多文件）

覆盖：games CRUD+导出导入往返、chapters/characters CRUD+批量导入、boards merged 聚合+拖动 PATCH+乐观锁 409、relation_types CRUD、events 时间线、photos CRUD、search、uploads 白名单+越界 404、鉴权 401、seed 幂等。≈35 例。

## 5. 验收

pytest（模块+全量）全绿；build 零报错（antd/xyflow 依赖由主线安装）；真实数据导入对照；浏览器走查（画布拖动/关系线/详情抽屉/图鉴）；image 审查。
