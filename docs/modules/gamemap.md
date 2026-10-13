# Gamemap 模块（剧情人物关系图谱，2026-10-11 迁入；2026-10-12 自 todo 拆为顶级模块）

> 数据表：gamemap_* 13 表　路由前缀：/api/gamemap　前端：/gamemap（门户"剧情图谱"卡直达）　sys_name：doublog.gamemap
> 源 C:\Users\Lizy\Desktop\Code\gamemap（只读）；迁移规范 docs/gamemap-migration.md；后端 `app/gamemap/`；前端 `src/gamemap/`

## 1. 模块契约（app/gamemap/__init__.py）

- 导出 `router`（9 组路由，/api/gamemap/*）+ `ensure_migrations(engine)`（7 默认关系类型种子 + 附件目录 ensure，幂等）；**无 start_background**
- 响应缓存 response_cache 照搬（读缓存写失效，256 条，进程内模块级——多 app 测试需 autouse 清空，见 tests/gamemap/）

## 2. 数据模型（13 表 gamemap_*）

games/chapters/characters/chapter_characters/character_photos/boards/board_nodes/relation_types/game_relation_overrides/chapter_relations/story_events/event_characters/attachments——逐列照搬源版。

## 3. API 契约（games 含 export/import+stats、chapters、characters 含批量、boards 含 merged 跨章聚合/拖动 PATCH/整板乐观锁 409、events、photos、relation_types、search、uploads 挂鉴权 + files 附件下载免认证）

附件目录 `<data_dir>/gamemap_attachments/`（白名单 png/jpg/jpeg/webp/gif，UUID 名）。

## 4. 前端（src/gamemap/，antd6/@xyflow/react 技术栈）

- 保留源技术栈（画布无法 Tailwind 平替；antd 仅此模块用，ConfigProvider 只包子树，暗色随 Doublog dark 联动）；**根 main.jsx 已移除 StrictMode**（xyflow 非受控 + 松手时序，dev 双渲染破坏拖动——源项目同款决策）
- 入口：App.jsx 顶级路由 `/gamemap/*` → GamemapShell（内部嵌套 Routes：index 概览/games/relations/search）；kit 组件跨模块引自 `src/todo/kit`
- 画布关系使用自绘 SVG EdgeLayer（勿改回内置 EdgeRenderer）；ReactFlow 节点层必须透明，背景由外层看板提供，否则会遮住下方的关系线。画布/HUD 随全站明暗主题切换。delete 章节/有子游戏 500 属于既有后端边界，本次未改删除接口。

## 5. 数据与测试

- 数据已导入（13 游戏/27 章/41 人物/27 板/39 关系/31 照片/32 附件）；`tools/import_gamemap.py` 幂等（--force 重导）
- 测试：tests/gamemap/test_gamemap.py 34 例

## 公共 UI 外壳（2026-10-13）

前端由 `shared/ModuleShell.jsx` 提供统一 220px 侧栏、多级菜单与内容画布；导航状态经 `useModuleNavigation` 注册，移动端使用同一菜单抽屉。页面内部的业务工具栏、表格、编辑器与弹层仍由模块管理。布局与性能契约见 `frontend.md` 的页面布局约定。

工作区使用显式画布高度；游戏、章节、人物、关系类型及看板请求失败均提供重试，避免无限加载。事件 / 统计卡片和 HUD 跟随明暗变量；人物 / 关系表格使用内部横向滚动。关系计数与聚焦邻居先建立 Map / Set，将节点遍历中的重复全关系扫描改为索引查询。

PNG 导出直接生成 Blob，使用对象 URL 下载并延迟释放，避免先生成完整 Base64 字符串；背景跟随画布主题。生成期间操作按钮显示加载状态并禁用重复导出，失败给出错误提示。
