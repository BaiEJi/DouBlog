# Practice 模块（刷题记录，2026-10-11 新增；2026-10-12 自 todo 拆为顶级模块）

> 数据表：practice_* 7 表　路由前缀：/api/practice　前端：/practice（门户"刷题 · 算法练习"卡直达）　sys_name：doublog.practice
> 后端 `app/practice/`；前端 `src/practice/`；规范 docs/practice-spec.md；更新：2026-10-21

## 1. 模块契约（app/practice/__init__.py）

- 仅导出 `router`（/api/practice/*，含聚合编辑端点）；无 start_background、无 ensure_migrations（全新表，create_all 直接建）
- **跨模块依赖**：复习调度的时区设置复用 todo 模块（`app.todo.services.get_settings`，读 todo_app_settings）

## 2. 数据模型（7 表 practice_*）

problems/tags/problem_tags/solutions/solution_codes/reviews/mutations；艾宾浩斯复习 [1,2,4,7,15,30,60,120] 三键打卡。

## 3. API 要点

CRUD/筛选/解法代码/标签/抓题 LeetCode+洛谷/复习/统计/导入导出；列表以Core投影小字段、队列defer Text大字段（共用独立Summary schema）。
- 一键抓题：LeetCode GraphQL（国际版）+ 洛谷 x-lentille-request（新 API）适配器，草稿不落库；HTML→MD 使用共享BeautifulSoup + markdownify适配器，旧正则保留为显式legacy对照
- 复习状态机：pending→done/cancelled，partial unique index 防双 pending，连续 2 forgot→todo，stage=7→mastered
- 依赖：markdownify1.2.3、BeautifulSoup4（共享HTML适配器）及 PyYAML（frontmatter 解析，requirements.txt 已显式声明 PyYAML==6.0.3）

## 4. 前端（src/practice/）

独立页 PracticePage（公共 ModuleShell 侧栏，个性色 blue）→ PracticeView（通过公共侧栏注册题单/复习队列/统计；表单/详情为覆盖视图）；通用UI与图表经共享组件复用（旧todo入口保留兼容导出）。

## 5. 质量与测试

- 首版历史验收：20轮代码评审发现并修复100个问题（数据完整性/API 一致性/性能/安全/边界/契约对齐/资源管理/整洁度）
- 原核心 tests/practice/test_practice.py 61例（抓题全Mock fixture回放，不连外网）；本轮 tests/practice/test_aggregate.py覆盖原子事务、冲突、幂等和client_ids，最终结果以统一执行报告为准。

## 公共 UI 外壳（2026-10-13）

前端由 `shared/ModuleShell.jsx` 提供统一 220px 侧栏、多级菜单与内容画布；导航状态经 `useModuleNavigation` 注册。前端仅适配桌面浏览器，无移动端布局。页面内部的业务工具栏、表格、编辑器与弹层仍由模块管理。布局与性能契约见 `frontend.md` 的页面布局约定。

> 2026-10-16 性能：Obsidian 导入 frontmatter 解析改走 libyaml C（shared/yamlfast.CSafeLoader），500 篇导入 1.33s→0.25s（实测 5.2×）。


## 2026-10-21 原子编辑与幂等创建

- 新增 `PUT /api/practice/problems/{id}/aggregate`。请求为ProblemUpdate字段 + 必填 `revision,mutation_id,solution_revisions,solutions`。solutions为完整编辑快照（最多200），每解法codes最多32；旧项携带id，新项可携带client_id。solution_revisions为打开编辑器时的完整 `{解法id:revision}` 映射。所有归属/语言/重复ID/首选解法等校验先于修改。
- 同一事务完成题目CAS、解法增改删及代码增改删；任一失败整体回滚。与旧细粒度写接口共享题目行锁，避免父子接口交错覆盖。响应是完整题目detail，增加client_ids映射，前端将新建client_id映射回服务端ID。
- `practice_mutations` 持久保存mutation_id、请求指纹与成功结果。相同请求重放返回历史成功；相同ID不同负载或旧revision409。旧创建 `POST /problems` 可选mutation_id，题目、子项和收据同事务提交；创建超时后重试不会多建题目。
- 前端整份表单只提交一个聚合事务，失败保持题干/解法/代码。结果不确定时先重放旧请求并吸收其ID/版本，再提交期间产生的新编辑；不把HTTP成功误当作全部子项成功。409提供本地输入下载与显式读取最新版本，不自动覆盖。
- 题干、解法说明及代码均接共享CodeMirror6；代码保留原语言字段，支持保存快捷键。抓题走SDK有限网络池，转换共享 `app/shared/html.py`；外部网络不进入自动化回归。
- 回归 `tests/practice/test_aggregate.py` 覆盖完整替换、校验失败回滚、版本冲突、幂等重放和创建client_ids；原test_practice.py的61例继续保留。统一最终结果见优化执行报告。


## 列表投影收敛（2026-10-21）

默认题目列表显式选择DTO需要的12个小字段，返回Core Row后继续用原ProblemSummaryOut完成日期/空值/默认值序列化；不构造Problem ORM状态，也不再装入已知无用的deleted_at列。题干description_md和pitfall_md此前已defer，本次收益来自减少对象装配，不能把既有正文排除重复算作新收益。

标签关联从Tag实体改为problem_id/id/name/color四列，原sort_order/name排序保持；待复习摘要从Review实体改为problem_id/id/cycle/seq/prev_interval_days/scheduled_date六列，保持原过滤、迭代与同题最后一条覆盖规则。Solution/Code仍是原三列小投影。聚合的四个默认摘要字段不先序列化再覆盖，最终DTO仍完整包含这些字段。

_build_summaries仍接受复习队列既有ORM调用，题目/标签/复习筛选与顺序不变。tests/practice/test_list_projection.py以原schema完整DTO为参考，覆盖四种排序、筛选、UTC日期、空页、关联去重、默认列表零域ORM装配及大字段不读取；另覆盖复习队列和隔离旧库多pending的原选取语义。

Core Row序列化时将其_mapping交给同一ProblemSummaryOut，避免逐字段属性寻址；复习队列的ORM输入路径保持原样。四组日期/空值/revision边界核对完整schema JSON与原Row属性路径及ORM路径一致。独立CPU PoC仅验证内存序列化阶段，不等同于HTTP吞吐结果。
