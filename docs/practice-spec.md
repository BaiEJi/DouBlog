# 刷题（practice）子模块开发规范

> 基于 10 个调研代理 + 257 行开发 Prompt。作为 todo 子模块（同 gamemap/steamidler 模式）。
> 后端 `app/practice/`；前端 `src/practice/`；表 `practice_*`；前缀 `/api/practice/*`。

## 架构决策（基于调研结论，不再讨论）

| 决策 | 结论 |
|---|---|
| 挂载 | todo 子模块，`practice_router` 并入 `app/todo/__init__.py` |
| 表名 | `practice_*`（扁平，同 gamemap/steamidler 先例） |
| 前缀 | `/api/practice/*`（`/api/todo` 已覆盖 sys_name） |
| 复习算法 | 固定序列 [1,2,4,7,15,30,60,120]，三键打卡；interval 存天数不存档位下标 |
| scheduled_date | **Date 列**（本地日历日，同 todo_tasks.task_date），非 UTC 时间戳 |
| 连续 forgot | 打卡事务内查上一条 done 的 result（同 cycle），不维护计数列 |
| MD 渲染 | 复用 `shared/md.js`（KaTeX/mermaid/GFM/高亮全支持，容器加 `prose-content` class） |
| 代码高亮 | 用现有 highlight.js common 35 语言（覆盖全部刷题语言，不引入 shiki——首版够用） |
| LeetCode 抓取 | 后端 GraphQL 代理（CORS 不可直连），`question(titleSlug:)` 查询 |
| 洛谷抓取 | 后端 `GET /problem/{pid}` + 请求头 `x-lentille-request: content-only`（旧 `?_contentOnly=1` 已废弃：302 + HTML），Session 自动过 cookie challenge |
| HTML→MD | 简单正则转换（不引入 html2text——LeetCode HTML 结构简单） |
| 导入导出 | JSON + Obsidian frontmatter（手写 YAML 生成，json.dumps 双引号法） |

## 数据模型（6 表）

### practice_problems
id(String36 PK uuid7), source(varchar16 白名单 leetcode/luogu/nowcoder/sword/other), source_no(varchar64 可空), title(varchar255 必填), difficulty(smallint 1/2/3), url(varchar512), description_md(text), pitfall_md(text), status(varchar todo/solved/reviewing/mastered), first_solved_at(Date 可空), last_reviewed_at(DateTime(tz) 可空), revision(int 乐观锁), created_at/updated_at(DateTime(tz)), deleted_at(DateTime(tz) 软删)
索引: ix_practice_status_diff(status,difficulty), ix_practice_source(source), ix_practice_created(created_at), ix_practice_solved(first_solved_at)

### practice_tags
id(String36 PK), name(varchar100 唯一), color(varchar20 默认色板轮询), sort_order(int), created_at

### practice_problem_tags
problem_id(FK CASCADE), tag_id(FK) 联合主键 + Index(tag_id, problem_id)

### practice_solutions
id(String36 PK), problem_id(FK CASCADE), name(varchar128), approach_md(text), time_complexity(varchar32), space_complexity(varchar32), is_preferred(bool), sort_order(float 新建追加在尾部 max+1，浮点列预留重排空间), revision(int), created_at/updated_at
索引: ix_practice_sol_problem(problem_id)

### practice_solution_codes
id(String36 PK), solution_id(FK CASCADE), language(varchar20 白名单), code(text), note(text 可空)
约束: (solution_id, language) 唯一

### practice_reviews
id(String36 PK), problem_id(FK CASCADE), cycle(int 第几轮), seq(int 累计次数), prev_interval_days(int), scheduled_date(Date), result(varchar10 可空 remember/fuzzy/forgot), reviewed_at(DateTime(tz) 可空), next_interval_days(int 可空), status(varchar10 pending/done/cancelled), created_at
索引: uq_reviews_open(problem_id unique where status=pending), ix_reviews_due(status, scheduled_date), ix_reviews_chain(problem_id, cycle, seq)

## API 端点（22 个，全挂 require_basic，Doublog 信封）

### 题目
- GET /problems — 多维筛选（见下方参数）+ 分页 + 每题摘要（小字段Core投影后，当页ids → 3条聚合IN查询；不读取Text大字段，description_md/pitfall_md恒为null；复习队列仍用defer）
- POST /problems — 201，可带初始 tags/solutions
- GET /problems/{id} — 详情（题目字段扁平 + tags + solutions(含 codes) + next_review）
- PATCH /problems/{id} — 带 revision 乐观锁 409
- DELETE /problems/{id} — 软删
- POST /problems/{id}/review — {"result": "remembered|fuzzy|forgot"} 打卡
- POST /problems/{id}/unreview — 退出复习

### 解法/代码
- POST /problems/{id}/solutions
- PATCH /solutions/{id} / DELETE /solutions/{id}
- POST /solutions/{id}/codes
- PATCH /codes/{id} / DELETE /codes/{id}

### 标签
- GET /tags（含每标签题目数）/ POST /tags
- PATCH /tags/{id} / DELETE /tags/{id}

### 一键抓题
- POST /fetch — {"source": "leetcode|luogu|auto", "url" 或 "slug" 或 "source_no"} → 标准化草稿（不落库）

### 复习/统计/导入导出
- GET /review/today — 今日队列
- GET /stats/overview — 总数/难度/来源/语言分布/趋势/标签掌握度/复习完成率
- POST /import — JSON 或 Markdown(zip)（multipart 上限 20MB；zip 条目 ≤2000、单条目解压 ≤10MB、累计解压 ≤50MB）
- GET /export?output_format=json|md — 参数名 output_format（R20-3 起不遮内置 format 名；json 走信封，md 返回二进制 zip）

## 列表筛选参数
q(标题/source_no icontains), tags=uuid1,uuid2 + tags_op=and|or, difficulty=1,3(IN), status, source, language(EXISTS 子查询), from/to(Date 区间), only_due_review(bool), sort(created_desc|solved_desc|difficulty_asc|review_asc), page/page_size

## 复习算法核心逻辑

```python
INTERVALS = (1, 2, 4, 7, 15, 30, 60, 120)

def do_review(session, review_row, result, today):
    stage = INTERVALS.index(clamp_interval_days(review_row.prev_interval_days))  # 非法档位值就近 clamp（如 3→2、200→120）
    if result == 'remembered':
        next_days = INTERVALS[min(stage + 1, 7)]
        if stage == 7: → 毕业 status='mastered'，不生成下一行
    elif result == 'fuzzy':
        next_days = INTERVALS[stage]  # 原档重复
    else:  # forgot
        next_days = INTERVALS[0]  # 回到 1 天
        prev = 查上一条 done 的 result（同 problem_id + cycle, seq < 当前）
        if prev and prev.result == 'forgot':
            problem.status = 'todo'; 不生成下一行; return {demoted: True}
    # 正常路径：打卡 + 生成下一行
    review_row.result = result; review_row.reviewed_at = now_utc(); review_row.status = 'done'
    review_row.next_interval_days = next_days
    下一行 = PracticeReview(prev_interval_days=next_days, scheduled_date=today + timedelta(days=next_days), ...)
```

## LeetCode 适配器
- Endpoint: `https://leetcode.com/graphql/（国际版无 WAF；CN 站有 alicfw WAF 需 session）` (POST JSON)
- 查询: `question(titleSlug:)` 取 questionFrontendId/title/translatedTitle/difficulty/content/translatedContent/topicTags/isPaidOnly
- 难度映射: Easy→1, Medium→2, Hard→3（PascalCase；未知难度 → 2 中性）
- 标签: topicTags 取 translatedName ?? name
- HTML→MD: `<p>`→段落, `<pre><code>`→代码块, `<ul><li>`→列表, `&nbsp;`→空格, `<sup>/<sub>` 预转换为 `^x^` / `~x~`
- 转换顺序硬约束: 结构标签 → strip 剩余标签 → html.unescape（先解 `&lt;` 会把 "2 ≤ i ≤ 10" 的约束文本当标签剥掉）；未知/纯数字 slug 提前 400 引导
- 错误: data.question==null → 提示国际版未收录（可能是中文站独有）; isPaidOnly → "会员题"

## 洛谷适配器
- URL: `https://www.luogu.com.cn/problem/{pid}` + 请求头 `x-lentille-request: content-only`
- UA: 不含 "python-requests"
- 用 requests.Session() 自动处理 C3VK cookie challenge（首次 302→Set-Cookie→重访 200）
- 响应: data.currentData.problem；字段 content.background/description/formatI/formatO/hint（注意 formatI 不是 inputFormat）
- 难度映射: 0-3→1(简单), 4-5→2(中等), 6-8→3(困难)（**9 级制**，非旧 7 级）
- 标签: tags 是数字 ID，需从 /_lfe/tags 拉取名称映射（505 个，可缓存）
- 内容本就是 Markdown，无需转换

## 前端

### 结构（Tab 风格，同 steamidler）
- `PracticeView.jsx` — 主视图（题库/复习/统计三子视图 + 详情/编辑覆盖层；复习 Tab 徽标 = 今日待复习数）
- `api.js` — 全端点封装（信封 unwrap + 30s 超时 + 字段形状适配）
- `components/ProblemList.jsx` — 列表表格 + 筛选区 + 分页 + 导入导出
- `components/ProblemDetail.jsx` — 详情页（描述/易错点/解法卡/代码Tab；导出 MdBlock/CodeBlock 供复习页与编辑预览复用）
- `components/ProblemForm.jsx` — 新增/编辑（含一键抓题条；编辑保存走解法/代码差异同步）
- `components/ReviewQueue.jsx` — 复习页（卡片流 + 三键打卡 + 键盘 1/2/3/空格）
- `components/StatsPanel.jsx` — 统计（复用 charts.jsx）
- `components/TagSelect.jsx` — 标签多选下拉（搜索 + 彩色 chip + 现场新建）
- TodoPage.jsx TABS 加 `{ key: 'practice', label: '刷题', icon }`（容器继承 1700px 档位）

### 关键组件
- TagSelect: 多选+彩色+新建（基于 kit.Segmented 改造或独立实现）
- 代码块: 用 `prose-content` class + md.js fence（或独立 `<pre><code>` + highlight.js）
- MD 渲染: `md.render()` + 容器 `className="prose-content"` + MermaidRunner

### 个性色
跟随 todo 主色 **indigo**（同 parent accent）

## 测试（61 用例，tests/practice/test_practice.py，全部 Mock 不连外网）
1. 鉴权 401 × 5 端点
2. 题目 CRUD 全流程（创建→列表→详情→PATCH→软删→404）
3. 乐观锁 409
4. 筛选组合（q/tags and|or/difficulty/status/language/from-to/only_due_review）
5. 解法与代码级联（加解法→加代码→改→删→题目删除级联）
6. 标签 CRUD + 多对多关联 + 删除标签自动解除
7. 复习状态机：加入→首条 pending→三种打卡各分支→连续 forgot 置回 todo→退出复习
8. 复习毕业（stage=7 remembered；毕业后重进 cycle 递增、seq 跨轮累计）
9. 导入导出无损往返（JSON + Markdown）
10. LeetCode/Luogu 适配器（Mock 响应 fixture，禁止外网）
11. 空库初始化
12. 统计端点
13. 20 轮代码评审回归（100 项）：实体解码顺序、缓存驱逐上限、zip 防炸三上限、
    导入白名单清洗与状态机不变量修复、并发竞态 409、400 信封格式等

## 开发约束
- 不引入新前端依赖（highlight.js/markdown-it/katex/mermaid 已有）
- 后端零新增依赖：HTML→MD 用手写正则（不引 html2text——LeetCode 结构简单，决策见上表）
- PyYAML 用于 frontmatter 解析（importer 直接 `import yaml`；注意它目前是 venv 内
  手动安装、requirements.txt 未显式声明，重装环境需补）
