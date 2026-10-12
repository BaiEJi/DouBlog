// 刷题（practice）子模块 API 层：统一走 shared/client.js 的 apiFetch（会话 Cookie 认证）。
// 端点前缀 /api/practice，与 backend/app/practice 路由一一对应（docs/practice-spec.md）。
// 后端响应为 Doublog 信封 { success, code, message, data }——本层统一 unwrap 出 .data，
// 失败（HTTP 非 2xx 或 success=false）抛 Error(message)；409 乐观锁冲突额外带 err.conflict 标记。
// 本层同时是字段适配层：后端按资源形态返回（嵌套 problem 摘要 / by_status 聚合对象 /
// code_languages），这里一次性归一成组件消费的形状（扁平 id/title、languages、图表数组），
// 组件不感知后端结构。所有请求带 30s 超时（R8-1），超时抛「请求超时」。
// 末尾附带刷题域展示元信息（来源/难度/状态/语言），供列表、表单、统计共用。
import { apiFetch } from '@/shared/client'

const PREFIX = '/api/practice'
const TIMEOUT_MS = 30_000

/** 超时护栏（R8-1）：浏览器 fetch 默认无超时，挂死请求会让 loading 态永悬；
 *  race 一个定时 rejection，无论胜负都清掉定时器 */
function withTimeout(promise, ms = TIMEOUT_MS) {
  let timer
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('请求超时')), ms)
  })
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer))
}

async function json(path, options = {}) {
  const r = await withTimeout(apiFetch(path, options))
  const body = await r.json().catch(() => ({}))
  if (!r.ok || body.success === false) {
    const err = new Error(body.message || `请求失败(${r.status})`)
    if (r.status === 409) err.conflict = true
    throw err
  }
  return body.data
}

function qs(params = {}) {
  const usp = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false))
  )
  const s = usp.toString()
  return s ? `?${s}` : ''
}

// ── 题目 problems ───────────────────────────────────────────
/** 列表筛选：q / tags(逗号 id) / tags_op=and|or / difficulty(逗号 1,3) / status / source /
 *  language / from,to(YYYY-MM-DD) / only_due_review / sort(created_desc|solved_desc|difficulty_asc|review_asc) / page / page_size
 *  后端 → { items: [题目摘要(含 tags/solution_count/code_languages/next_review；
 *  description_md/pitfall_md 恒为 null——列表不回传大字段)], total, page, page_size }
 *  适配（R7-4）：每项补 languages = code_languages（列表读 it.languages），并补 pages 供分页 */
export const listProblems = (params = {}) =>
  json(`${PREFIX}/problems${qs(params)}`).then(res => {
    const items = (res?.items || []).map(it => ({ ...it, languages: it.code_languages || [] }))
    const total = res?.total ?? items.length
    const size = res?.page_size || 20
    return { ...res, items, total, pages: Math.max(1, Math.ceil(total / size)) }
  })
/** 创建（可带初始 tags / solutions）payload: { source, source_no, title, difficulty, url,
 *  description_md, pitfall_md, tag_ids, tag_names, solutions: [{ name, approach_md,
 *  time_complexity, space_complexity, is_preferred, sort_order, codes: [{ language, code, note }] }] } */
export const createProblem = payload =>
  json(`${PREFIX}/problems`, { method: 'POST', body: JSON.stringify(payload) })
/** 详情 → 扁平题目字段(含 description_md/pitfall_md/revision) + tags + solutions(含 codes,
 *  各解法含 revision) + next_review。适配（R7-5）：给每个 code 注入所属 solution 的
 *  revision——code 行自身没有乐观锁列，PATCH /codes/{id} 校验的是父级 solution.revision */
export const getProblem = id => json(`${PREFIX}/problems/${id}`).then(d => {
  const solutions = (d?.solutions || []).map(s => ({
    ...s,
    codes: (s.codes || []).map(c => ({ ...c, revision: s.revision })),
  }))
  return { ...d, solutions }
})
/** 部分更新（带 revision 乐观锁，冲突 409） */
export const updateProblem = (id, payload) =>
  json(`${PREFIX}/problems/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
/** 软删（级联解法/代码/复习行） */
export const deleteProblem = id => json(`${PREFIX}/problems/${id}`, { method: 'DELETE' })
/** 复习打卡 result: 'remembered' | 'fuzzy' | 'forgot'
 *  → { graduated, demoted, result, next_interval_days, next_scheduled_date, next_review? } */
export const reviewProblem = (id, result) =>
  json(`${PREFIX}/problems/${id}/review`, { method: 'POST', body: JSON.stringify({ result }) })
/** 退出复习（取消 pending 复习行，状态回 solved） */
export const unreviewProblem = id => json(`${PREFIX}/problems/${id}/unreview`, { method: 'POST' })

// ── 解法 solutions / 代码 codes ─────────────────────────────
export const createSolution = (problemId, payload) =>
  json(`${PREFIX}/problems/${problemId}/solutions`, { method: 'POST', body: JSON.stringify(payload) })
export const updateSolution = (id, payload) =>
  json(`${PREFIX}/solutions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
export const deleteSolution = id => json(`${PREFIX}/solutions/${id}`, { method: 'DELETE' })
export const createCode = (solutionId, payload) =>
  json(`${PREFIX}/solutions/${solutionId}/codes`, { method: 'POST', body: JSON.stringify(payload) })
export const updateCode = (id, payload) =>
  json(`${PREFIX}/codes/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
export const deleteCode = id => json(`${PREFIX}/codes/${id}`, { method: 'DELETE' })

// ── 标签 tags ───────────────────────────────────────────────
/** → [{ id, name, color, sort_order, problem_count }] */
export const listTags = () => json(`${PREFIX}/tags`)
/** payload: { name, color? }（color 缺省走后端色板轮询）→ 新标签 */
export const createTag = payload =>
  json(`${PREFIX}/tags`, { method: 'POST', body: JSON.stringify(payload) })
export const updateTag = (id, payload) =>
  json(`${PREFIX}/tags/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
export const deleteTag = id => json(`${PREFIX}/tags/${id}`, { method: 'DELETE' })

// ── 一键抓题 / 复习 / 统计 / 导入导出 ────────────────────────
/** payload: { source: 'leetcode'|'luogu'|'auto', url | slug | source_no }
 *  → 标准化草稿 { source, source_no, title, difficulty, url, description_md,
 *    tag_names: [建议标签名], pitfall_md }（不落库） */
export const fetchFromSite = payload =>
  json(`${PREFIX}/fetch`, { method: 'POST', body: JSON.stringify(payload) })
/** 今日复习队列。后端 → { today, items: [{ review_id, scheduled_date, prev_interval_days,
 *  cycle, seq, overdue_days, problem: 题目摘要 }] }
 *  适配（R7-1）：把嵌套 problem 摘要展开到顶层（组件直接读 id/title/difficulty/tags/
 *  source），复习行字段随后覆盖。返回纯数组（长度即今日待复习数），并把后端的
 *  today（todo 设置时区）以非枚举属性挂在数组上带出（R11-2：逾期判定与浏览器
 *  本地时钟解耦——摘要的 description_md 恒为 null，详情需另拉 getProblem） */
export const reviewToday = () => json(`${PREFIX}/review/today`).then(res => {
  const items = (res?.items || []).map(it => ({
    ...(it.problem || {}),
    review_id: it.review_id,
    scheduled_date: it.scheduled_date,
    overdue_days: it.overdue_days,
    cycle: it.cycle,
    seq: it.seq,
  }))
  items.today = res?.today || null
  return items
})
/** 统计总览。后端 → { total, by_status: {todo,solved,reviewing,mastered},
 *  by_difficulty: {'1':n,'2':n,'3':n}, by_source: {leetcode:n,…}, languages: {python:n,…},
 *  trend: [{date,count}] 近30天逐日新增, tags: [{id,name,color,total,mastered}],
 *  review: {pending,due_today,done,cancelled,completion_rate} }
 *  适配（R7-2/3）：by_* 聚合对象 → 图表数组 {key/name,value}；languages 对象 → [{name,value}]；
 *  trend → [{date,created,solved}]（后端只统计逐日新增，solved 无数据恒 0）；
 *  tags 补 solved = mastered（掌握度条读 solved/total）；review 补 completed/total/rate */
export const statsOverview = () => json(`${PREFIX}/stats/overview`).then(d => {
  d = d || {}
  const review = d.review || {}
  return {
    ...d,
    solved: d.by_status?.solved ?? 0,
    reviewing: d.by_status?.reviewing ?? 0,
    mastered: d.by_status?.mastered ?? 0,
    difficulty: Object.entries(d.by_difficulty || {})
      .map(([k, v]) => ({ key: k, name: { 1: '简单', 2: '中等', 3: '困难' }[k] || k, value: v })),
    source: Object.entries(d.by_source || {}).map(([name, value]) => ({ name, value })),
    language: Object.entries(d.languages || {}).map(([name, value]) => ({ name, value })),
    trend: (d.trend || []).map(t => ({ date: t.date, created: t.count, solved: 0 })),
    tags: (d.tags || []).map(t => ({ ...t, solved: t.mastered ?? t.solved ?? 0 })),
    review: {
      ...review,
      completed: review.done ?? 0,
      total: (review.done ?? 0) + (review.pending ?? 0),
      rate: review.completion_rate ?? 0,
    },
  }
})
/** 导入 JSON 或 Markdown(zip)（multipart file）。
 *  后端 → JSON: { imported_tags, imported_problems } / zip: { imported_problems, skipped, invalid }
 *  适配（R7-4）：补 imported = imported_problems（导入 toast 读 res.imported） */
export const importProblems = file => {
  const fd = new FormData()
  fd.append('file', file)
  return json(`${PREFIX}/import`, { method: 'POST', body: fd })
    .then(res => ({ ...(res || {}), imported: res?.imported_problems ?? 0 }))
}
/** 导出并触发浏览器下载（format: 'json' | 'md'，md 为 zip 包）；同样受 30s 超时保护。
 *  R20-3：后端查询参数已改名 output_format（路由不变） */
export async function exportProblems(format = 'json') {
  const r = await withTimeout(apiFetch(`${PREFIX}/export${qs({ output_format: format })}`))
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    throw new Error(body.message || `导出失败(${r.status})`)
  }
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `practice-${new Date().toISOString().slice(0, 10)}.${format === 'md' ? 'zip' : 'json'}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 延迟释放：click 后立即 revoke 在部分浏览器（尤其 Safari）会中断尚未开始的下载
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── 展示元信息 ──────────────────────────────────────────────

export const SOURCES = [
  { value: 'leetcode', label: 'LeetCode' },
  { value: 'luogu', label: '洛谷' },
  { value: 'nowcoder', label: '牛客' },
  { value: 'sword', label: '剑指 Offer' },
  { value: 'other', label: '其他' },
]
export const sourceLabel = v => SOURCES.find(s => s.value === v)?.label || (v || '其他')

export const DIFFICULTIES = [
  { value: 1, label: '简单', text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-500/10', color: '#10b981' },
  { value: 2, label: '中等', text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-500/10', color: '#f59e0b' },
  { value: 3, label: '困难', text: 'text-red-700 dark:text-red-400', bg: 'bg-red-500/10', color: '#ef4444' },
]
export const diffMeta = v => DIFFICULTIES.find(d => d.value === Number(v)) || DIFFICULTIES[0]

export const STATUSES = [
  { value: 'todo', label: '待做', cls: 'bg-stone-500/10 text-stone-600 dark:text-stone-300' },
  { value: 'solved', label: '已解', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  { value: 'reviewing', label: '复习中', cls: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' },
  { value: 'mastered', label: '已掌握', cls: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
]
export const statusMeta = v => STATUSES.find(s => s.value === v) || STATUSES[0]

/** 代码语言白名单（R7-7：与后端 models.SOLUTION_LANGUAGES 16 项一一对齐——
 *  删掉后端不收的 scala/dart/r/lua/perl/plaintext，补上 other；提交白名单外
 *  语言会被后端 400。高亮走 highlight.js common 子集，未识别语言回退纯文本） */
export const LANGUAGES = [
  { value: 'python', label: 'Python', short: 'Py' },
  { value: 'cpp', label: 'C++', short: 'C++' },
  { value: 'c', label: 'C', short: 'C' },
  { value: 'java', label: 'Java', short: 'Jv' },
  { value: 'javascript', label: 'JavaScript', short: 'JS' },
  { value: 'typescript', label: 'TypeScript', short: 'TS' },
  { value: 'go', label: 'Go', short: 'Go' },
  { value: 'rust', label: 'Rust', short: 'Rs' },
  { value: 'csharp', label: 'C#', short: 'C#' },
  { value: 'ruby', label: 'Ruby', short: 'Rb' },
  { value: 'php', label: 'PHP', short: 'PHP' },
  { value: 'swift', label: 'Swift', short: 'Sw' },
  { value: 'kotlin', label: 'Kotlin', short: 'Kt' },
  { value: 'sql', label: 'SQL', short: 'SQL' },
  { value: 'bash', label: 'Bash', short: 'Sh' },
  { value: 'other', label: '其他', short: '其他' },
]
export const langMeta = v => LANGUAGES.find(l => l.value === v) || { value: v || 'other', label: v || '其他', short: (v || '其他').slice(0, 3) }

/** 从粘贴链接自动识别来源（leetcode.cn / leetcode.com / luogu.com.cn / nowcoder.com） */
export function detectSourceFromUrl(url) {
  const u = String(url || '').toLowerCase()
  if (/leetcode\./.test(u)) return 'leetcode'
  if (/luogu\.com/.test(u)) return 'luogu'
  if (/nowcoder\.com/.test(u)) return 'nowcoder'
  return 'auto'
}

/** 抓题入参：链接 → url；非链接按来源拆 slug / source_no */
export function buildFetchPayload(source, value) {
  const v = String(value || '').trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return { source: source || 'auto', url: v }
  if (source === 'luogu') return { source, source_no: v }
  if (source === 'leetcode') return { source, slug: v }
  return { source: 'auto', url: v }
}
