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
- 已知坑：xyflow 12.11.6 + React19 边静默不渲染（自绘 SVG EdgeLayer 绕过，勿改回内置）；画布/HUD 深空色板不随浅色模式变（保留源设计）；delete 章节/有子游戏 500（源缺陷锁定，勿在新代码依赖）

## 5. 数据与测试

- 数据已导入（13 游戏/27 章/41 人物/27 板/39 关系/31 照片/32 附件）；`tools/import_gamemap.py` 幂等（--force 重导）
- 测试：tests/gamemap/test_gamemap.py 34 例
