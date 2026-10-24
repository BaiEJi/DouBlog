# Gamemap 模块（剧情人物关系图谱，2026-10-11 迁入；2026-10-12 自 todo 拆为顶级模块）

> 数据表：gamemap_* 14 表　路由前缀：/api/gamemap　前端：/gamemap（门户"剧情图谱"卡直达）　sys_name：doublog.gamemap
> 源 C:\Users\Lizy\Desktop\Code\gamemap（只读）；迁移规范 docs/gamemap-migration.md；后端 `app/gamemap/`；前端 `src/gamemap/`

## 1. 模块契约（app/gamemap/__init__.py）

- 导出 `router`（10 组路由，/api/gamemap/*）+ `ensure_migrations(engine)`（7 默认关系类型种子 + 附件目录 ensure，幂等）；**无 start_background**
- 响应缓存 response_cache 照搬（读缓存写失效，按app数据库runtime隔离、最多256条/32MiB、单项最多4MiB；旧读纪元回填被拒绝）

## 2. 数据模型（14 表 gamemap_*）

games/chapters/characters/chapter_characters/character_photos/boards/board_nodes/relation_types/game_relation_overrides/chapter_relations/story_events/event_characters/attachments；新增position_mutations存批量坐标保存的耐久幂等回执。

## 3. API 契约（games 含 export/import+stats、chapters、characters 含批量、boards 含 merged 跨章聚合/拖动 PATCH/整板乐观锁 409、events、photos、relation_types、search、uploads 挂鉴权 + files 附件下载免认证）

附件目录 `<data_dir>/gamemap_attachments/`（白名单 png/jpg/jpeg/webp/gif，UUID 名）。

## 4. 前端（src/gamemap/，antd6/@xyflow/react 技术栈）

- 保留源技术栈（画布无法 Tailwind 平替；antd 仅此模块用，ConfigProvider 只包子树，暗色随 Doublog dark 联动）；**根 main.jsx 已移除 StrictMode**（xyflow 非受控 + 松手时序，dev 双渲染破坏拖动——源项目同款决策）
- 入口：App.jsx 顶级路由 `/gamemap/*` → GamemapShell（内部嵌套 Routes：index 概览/games/relations/search）；通用组件经 `src/shared/ui` 复用
- 画布关系使用自绘 SVG EdgeLayer（勿改回内置 EdgeRenderer）；ReactFlow 节点层必须透明，背景由外层看板提供，否则会遮住下方的关系线。画布/HUD 随全站明暗主题切换。删除章节/游戏在事务内按FK依赖清理从属数据；保留可能共享的上传附件文件。

## 5. 数据与测试

- 数据已导入（13 游戏/27 章/41 人物/27 板/39 关系/31 照片/32 附件）；`tools/import_gamemap.py` 幂等（--force 重导）
- 测试：tests/gamemap/ 共37例（含positions批量幂等、校验、跨游戏归属和第二看板冲突整体回滚）

## 公共 UI 外壳（2026-10-13）

前端由 `shared/ModuleShell.jsx` 提供统一 220px 侧栏、多级菜单与内容画布；导航状态经 `useModuleNavigation` 注册。前端仅适配桌面浏览器，无移动端布局。页面内部的业务工具栏、表格、编辑器与弹层仍由模块管理。布局与性能契约见 `frontend.md` 的页面布局约定。

工作区使用显式画布高度；游戏、章节、人物、关系类型及看板请求失败均提供重试，避免无限加载。事件 / 统计卡片和 HUD 跟随明暗变量；人物 / 关系表格使用内部横向滚动。关系计数与聚焦邻居先建立 Map / Set，将节点遍历中的重复全关系扫描改为索引查询。

PNG 导出直接生成 Blob，使用对象 URL 下载并延迟释放，避免先生成完整 Base64 字符串；背景跟随画布主题。生成期间操作按钮显示加载状态并禁用重复导出，失败给出错误提示。

## 2026-10-21 保存与几何优化

- 新增 `PUT /api/gamemap/games/{game_id}/boards/chapters/{chapter_id}/positions`，请求 `{revision,mutation_id,positions:[{character_id,x,y}]}`，只变更位置，保留关系/状态/节点尺寸。
- 新增 `POST /api/gamemap/games/{game_id}/boards/positions/batch`，请求 `{mutation_id,boards:[{chapter_id,revision,positions}]}`。最多100看板/10000位置，每章ID和人物ID不可重复，坐标必须有限且绝对值≤10000000；所有看板同一事务，任一冲突整体409回滚。
- 相同mutation和请求重放返回首次回执；复用ID改变内容409。单章返回chapter_id/revision/version/positions/mutation_id，多章返回boards数组。merged读取增加board_versions映射。
- 整板PUT使用SQL版本条件更新；节点增删、旧PATCH与关系改动都会递增board.version。前端按真实确认版本串行批量保存，队列未清空不宣称已保存。
- 自绘SVG关系层保留；按incident-edge和几何缓存减少无关重算，空间网格避免每条边逐一扫描全部节点。拖动时绘制层和命中层共享同一几何结果。根StrictMode与原生EdgeRenderer约束保持。
- ELK仅做隔离Worker PoC。当前直线边下500节点布局面积增大约18倍，未加入正式依赖；完整PoC与几何采样状态见前端验收记录，不将上游折线路由的收益套用到当前直线画布。


### 本机几何最终轮样本（2026-10-21）

同一当前生产依赖分别编译冻结旧几何与新几何，全部节点和3倍数量的边挂载，真实鼠标交互。`graph-performance.json`记录最终一轮18样本，`sourcesUnchanged=true`、`failures=[]`；早期受同机负载影响的样本保留于`graph-performance-contended.json`。本轮我方未并行其他测试，已知的旧timeline基准已自然退出；未采集全主机CPU指标，不能宣称硬件独占或排除所有背景负载。源码hash一致只证明输入未变。

本轮三轮中位：500节点拖动21.886→58.713fps，1000节点6.418→43.113fps；1000节点p95 **rAF帧间隔**533.3→50.0ms、松手后两个rAF观测间隔511.1→36.1ms，初始化4568.3→1634.3ms。p95帧间隔不等于单次JavaScript计算耗时；松手指标从pointerup后等待两个rAF，包含调度/自动化等待，不能当作端到端输入延迟；初始化为harness到ready的计时，不能视为业务路由首次可交互指标。1000节点拖动和平移仍未达到60fps；几何算法隔离对比不能推导整站依赖升级的冷加载收益，且只测到1000节点，未覆盖更大规模或所有真实布局。方法、基线摘取证明与限制见`docs/optimization/frontend-verification.md`。
