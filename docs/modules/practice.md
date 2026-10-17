# Practice 模块（刷题记录，2026-10-11 新增；2026-10-12 自 todo 拆为顶级模块）

> 数据表：practice_* 6 表　路由前缀：/api/practice　前端：/practice（门户"刷题 · 算法练习"卡直达）　sys_name：doublog.practice
> 后端 `app/practice/`；前端 `src/practice/`；规范 docs/practice-spec.md

## 1. 模块契约（app/practice/__init__.py）

- 仅导出 `router`（~22 端点，/api/practice/*）；无 start_background、无 ensure_migrations（全新表，create_all 直接建）
- **跨模块依赖**：复习调度的时区设置复用 todo 模块（`app.todo.services.get_settings`，读 todo_app_settings）

## 2. 数据模型（6 表 practice_*）

problems/tags/problem_tags/solutions/solution_codes/reviews；艾宾浩斯复习 [1,2,4,7,15,30,60,120] 三键打卡。

## 3. API 要点

CRUD/筛选/解法代码/标签/抓题 LeetCode+洛谷/复习/统计/导入导出；列表/队列 defer Text 大字段（独立 Summary schema）。
- 一键抓题：LeetCode GraphQL（国际版）+ 洛谷 x-lentille-request（新 API）适配器，草稿不落库；HTML→MD 手写正则（转换顺序：结构标签→strip 标签→html.unescape），未引入 html2text
- 复习状态机：pending→done/cancelled，partial unique index 防双 pending，连续 2 forgot→todo，stage=7→mastered
- 依赖：仅 PyYAML（frontmatter 解析，requirements.txt 已显式声明 PyYAML==6.0.3）

## 4. 前端（src/practice/）

独立页 PracticePage（公共 ModuleShell 侧栏，个性色 blue）→ PracticeView（自带 Segmented 视图切换：题单/复习队列/统计）；kit/charts 组件跨模块引自 `src/todo/`。

## 5. 质量与测试

- 20 轮代码评审：100 个问题发现并修复（数据完整性/API 一致性/性能/安全/边界/契约对齐/资源管理/整洁度）
- 测试：tests/practice/test_practice.py 61 例（抓题全 Mock fixture 回放，不连外网）

## 公共 UI 外壳（2026-10-13）

前端由 `shared/ModuleShell.jsx` 提供统一紧凑可折叠侧栏、多级菜单与内容画布；导航状态经 `useModuleNavigation` 注册。前端仅适配桌面浏览器，无移动端布局。页面内部的业务工具栏、表格、编辑器与弹层仍由模块管理。布局与性能契约见 `frontend.md` 的页面布局约定。

> 2026-10-16 性能：Obsidian 导入 frontmatter 解析改走 libyaml C（shared/yamlfast.CSafeLoader），500 篇导入 1.33s→0.25s（实测 5.2×）。
