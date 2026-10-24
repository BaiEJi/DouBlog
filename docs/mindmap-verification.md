# 思维导图交付验收记录

验收日期：2026-10-20（Asia/Shanghai）。模块入口 `/mindmap`，编辑页 `/mindmap/:id`。
使用真实 FastAPI、统一登录、共享数据库与 SimpleMindMap 核心；浏览器业务测试连接独立 SQLite QA 实例。
核心选型及上游出处见 [选型文档](mindmap-selection.md)，完整接口和数据边界见 [模块文档](modules/mindmap.md)。

## 功能与证据

| 范围 | 当前实现与验收 |
|---|---|
| 独立模块与管理 | 门户/公共侧栏/懒加载路由；创建、复制、重命名、删除、分页、名称搜索、排序、知识库及同库文章关联 |
| 编辑 | 双击/F2、Tab/Enter、删除与根节点保护、Ctrl 多选/批量样式、拖拽重挂与排序、折叠、撤销重做、右键菜单和工具栏 |
| 复杂剪贴板 | 子树选择去重；每次/每个粘贴目标重建节点与概要 UID、内部关联线及键控文字/样式；跨图清理失效外链；变更前验证；一次多目标粘贴可一次撤销 |
| 布局与内容 | 九种布局，包含左右逻辑/组织/鱼骨/两种水平时间轴/垂直时间轴；基础文本格式、形状、分支样式、图片、图标、标签、备注、链接、关联线和概要；明暗与自定义主题 |
| 导航 | 搜索定位及结果切换、父路径展开、大纲、实时小地图、分支聚焦、缩放/平移/适应/居中/全屏；聚焦保存和导出保留全图 |
| 持久化 | 完整 JSON 存共享数据库；SQL revision CAS；持久幂等回执；版本快照、恢复和真实账号审计；节点与原子批操作 API |
| 自动保存与恢复 | 900ms 防抖、排队、超时/网络重试复用请求标识；保存中的新修改仍为待保存；冲突停写；草稿恢复或另存新图；未失焦输入在保存/退出前提交 |
| 交换格式 | 页面和 API 的标准 JSON 完整往返；真实 SVG/PNG/Markdown/XMind 下载及主题树重导入；有损边界单独说明 |
| 数据边界 | document 10MiB，JSON 信封/HTTP 包装各另留16KiB；10000树节点、128层、1000概要、每批500操作；危险URL/HTML/原型键、重复UID、非法引用与概要范围拒绝，失败保持原版本 |

## 最终验证结果

| 检查 | 结果 | 可重复入口/证据 |
|---|---|---|
| 全量后端 | **772 passed**，272.00s；8条既有 Starlette 弃用警告；含真实临时 PostgreSQL 切换测试 | `backend: pytest tests -q -n 8`；本地完整日志 `.ui-qa/mindmap/final-summary-regression.log` |
| 思维导图后端专项 | **87 passed**，包含容量精确边界、原子回滚、并发/幂等、资源生命周期和审计 | `backend/tests/mindmap/test_mindmap.py` |
| 数据与保存状态机 | **23 passed** | `frontend: npm run test:mindmap` |
| 浏览器核心交互 | **17/17 passed**；无未捕获异常；包含关系/概要剪贴板、聚焦删除与撤销、真实导出、重复销毁 | [原始结果](mindmap-core-results.json)；`npm run test:mindmap:core` |
| 浏览器业务链路 | **13/13 passed**；真实登录/数据库、未失焦保存、断网、刷新恢复、409不覆盖及历史恢复 | [原始结果](mindmap-e2e-results.json)；`npm run test:mindmap:e2e` |
| 极小缩放几何回归 | **9/9布局 passed**；0.004倍缩放编辑/导入后恢复1倍，图片/图标/标签/链接组合的文字仍在节点内 | [原始结果](mindmap-geometry-core-results.json)；`node tools/run-mindmap-geometry.mjs` |
| 静态与构建 | mindmap源码/测试/工具及App的ESLint通过；`npm run build`成功 | 依赖明确锁定；adapter分包约323.97kB，gzip90.07kB |
| 可视化走查 | 桌面明暗主题、管理/新建/编辑/属性/大纲/历史/只读；布局边界和5000节点文字错位修复已验证 | 本地 `docs/shots-mindmap/` 的截图与 `ui-qa.json`；[5000节点局部截图](mindmap-5000-before-drag.png) |

构建保留已有大分包提示，以及XMind旧XML解析依赖sax的`stream`浏览器外置提示；构建无错误，实际XMind导出及重导入测试已通过。
本机测试启动器使用 base Python 加项目venv的site-packages；Windows设置`PYTHONUTF8=1`并使Git Bash完整路径可见。
测试依赖pg_ctl.exe原缺少当前用户执行权，恢复此项目依赖的执行权后，最终全量测试正常启动真实临时PostgreSQL；没有跳过相关用例。

## 浏览器测试复现

先在 `backend` 目录启动独立QA实例，数据目录需使用测试专用路径：

```powershell
./venv/Scripts/python.exe tools/mindmap_qa_server.py --port 60113 --data-dir ../.ui-qa/mindmap/data
```

在 `frontend` 目录另开终端：

```powershell
$env:VITE_API_BASE='/'
$env:VITE_API_PROXY='http://127.0.0.1:60113'
npm run dev -- --host 127.0.0.1 --port 60111 --strictPort
```

安装或指定Playwright和Chrome后运行（本机路径以性能报告记录为准）：

```powershell
$env:PLAYWRIGHT_MODULE_PATH='C:\Users\Lizy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.mjs'
$env:BROWSER_PATH='D:\Program Files\chrome-win64\chrome-win64\chrome.exe'
$env:MINDMAP_TEST_BASE='http://127.0.0.1:60111'
npm run test:mindmap:core
npm run test:mindmap:e2e
node tools/run-mindmap-geometry.mjs
npm run bench:mindmap
```

性能基准应单独运行，期间不要构建、并行跑测试或热更新源码。

## 性能与实际边界

最终100/1000/5000基准均核对实际SVG节点数、JSON完整往返、节点父关系确实变化及文字位于真实边框内。
保留实时小地图，关闭视窗裁剪；方法、源码SHA256、设备、时钟、长任务、内存和所有实际数据见
[性能报告](mindmap-performance.md)及[原始JSON](mindmap-performance.json)。

1000节点初始化约2.1s，移动期间接近60FPS；编辑/展开/放手反馈仍可能超过100ms。
5000节点全展开初始化约17.8s、重导入约18.2s，编辑约3.7s、展开约11.6s、拖动放手约6.8s；平移及缩放帧率也明显不足60FPS。
这是完整压力测试结果，不构成5000节点流畅保证。已实施Canvas换行缓存、稳定内容尺寸、事件序列化与小地图缓存优化；剩余SVG布局/绘制和全量历史成本仍需后续架构优化，不能靠隐藏节点声称达标。

本版基础文本格式作用于整个节点，不支持HTML富文本片段。Markdown/XMind为有损交换，XMind多画布取首个；完整备份使用标准JSON。
所有页面要求现有登录，只读为当前账号的查看模式。版本快照/删除tombstone/幂等回执长期保留，没有硬删除或自动清理；存储增长须纳入共享数据库容量管理。
