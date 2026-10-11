/**
 * 题库列表：可折叠筛选区（搜索防抖 300ms / TagSelect / 难度多选 / 状态 / 来源 / 语言 /
 * 仅看待复习开关 / 且或切换 / 清空）+ 列表表格（题号来源|标题|难度|状态|标签|解法数|
 * 语言|下一复习日(逾期红)|更新时间，行点击进详情）+ 分页 + 导入导出入口。
 */
import { useEffect, useRef, useState } from 'react'

import {
  listProblems, importProblems, exportProblems,
  SOURCES, STATUSES, LANGUAGES, DIFFICULTIES, diffMeta, statusMeta, sourceLabel, langMeta,
} from '../api'
import { Empty, Spinner, Switch, btn, Icon } from '../../kit'
import { todayStr, mdhmOf } from '../../kit'
import TagSelect from './TagSelect'

const PAGE_SIZE = 20
const SORTS = [
  { value: 'created_desc', label: '最新创建' },
  { value: 'solved_desc', label: '最近求解' },
  { value: 'difficulty_asc', label: '难度升序' },
  { value: 'review_asc', label: '最早复习' },
]

const selectCls = 'h-9 px-2.5 rounded-lg text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors'

// ─── 表格小件 ────────────────────────────────────────────────

function DiffBadge({ value }) {
  if (!value) return <span className="text-stone-400 text-xs">—</span>
  const m = diffMeta(value)
  return <span className={'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ' + m.bg + ' ' + m.text}>{m.label}</span>
}

function StatusBadge({ value }) {
  const m = statusMeta(value)
  return <span className={'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] ' + m.cls}>{m.label}</span>
}

function TagTokens({ tags = [] }) {
  if (!tags.length) return <span className="text-stone-400 text-xs">—</span>
  const shown = tags.slice(0, 2)
  return (
    <span className="inline-flex items-center gap-1">
      {shown.map(t => (
        <span key={t.id} className="inline-flex items-center rounded-full px-2 h-5 text-[10.5px] whitespace-nowrap"
          style={{ color: t.color || '#94a3b8', background: (t.color || '#94a3b8') + '14', border: `1px solid ${(t.color || '#94a3b8') + '55'}` }}>
          {t.name}
        </span>
      ))}
      {tags.length > 2 && <span className="text-[10.5px] text-stone-400">+{tags.length - 2}</span>}
    </span>
  )
}

function LangChips({ langs = [] }) {
  if (!langs.length) return <span className="text-stone-400 text-xs">—</span>
  return (
    <span className="inline-flex items-center gap-1">
      {langs.slice(0, 3).map(l => (
        <span key={l} className="font-mono text-[10px] rounded px-1 py-0.5 bg-black/[0.05] dark:bg-white/[0.08] text-stone-500 dark:text-stone-400">
          {langMeta(l).short}
        </span>
      ))}
      {langs.length > 3 && <span className="text-[10.5px] text-stone-400">+{langs.length - 3}</span>}
    </span>
  )
}

/** 下一复习日（逾期红） */
function NextReviewCell({ it }) {
  const date = it.next_review?.scheduled_date || null
  if (!date) return <span className="text-stone-400 text-xs">—</span>
  const overdue = date < todayStr()
  return (
    <span className={'text-xs tabular-nums whitespace-nowrap ' + (overdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-stone-500 dark:text-stone-400')}>
      {date.slice(5)}{overdue ? ' ⚠' : ''}
    </span>
  )
}

/** 分页页码窗口：始终含首尾，中间窗口收缩 */
function pageWindow(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const set = new Set([1, pages, page - 1, page, page + 1])
  const list = [...set].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b)
  const out = []
  let prev = 0
  for (const n of list) {
    if (n - prev > 1) out.push('…')
    out.push(n)
    prev = n
  }
  return out
}

// ─── 列表主组件 ──────────────────────────────────────────────

export default function ProblemList({ toast, onOpen, onImported, refreshSignal = 0, tags, onCreateTag }) {
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [qInput, setQInput] = useState('')
  const [filters, setFilters] = useState({
    q: '', tags: [], tagsOp: 'or', difficulty: [], status: '', source: '', language: '', onlyDue: false, sort: 'created_desc',
  })
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busyIO, setBusyIO] = useState(false)
  const fileRef = useRef(null)

  // 搜索防抖 300ms
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters(f => (f.q === qInput ? f : { ...f, q: qInput }))
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [qInput])

  // 拉取列表
  useEffect(() => {
    let alive = true
    setLoading(true)
    const params = {
      q: filters.q || undefined,
      tags: filters.tags.join(',') || undefined,
      tags_op: filters.tags.length > 1 ? filters.tagsOp : undefined,
      difficulty: filters.difficulty.join(',') || undefined,
      status: filters.status || undefined,
      source: filters.source || undefined,
      language: filters.language || undefined,
      only_due_review: filters.onlyDue ? 'true' : undefined,
      sort: filters.sort,
      page, page_size: PAGE_SIZE,
    }
    listProblems(params)
      .then(res => { if (alive) setData(res) })
      .catch(err => { if (alive) { toast(err instanceof Error ? err.message : '加载题库失败', 'error'); setData(null) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [filters, page, refreshSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = data?.items || []
  const total = data?.total ?? items.length
  const pages = data?.pages || 1
  const hasFilter = filters.q || filters.tags.length || filters.difficulty.length ||
    filters.status || filters.source || filters.language || filters.onlyDue

  const patch = (p) => { setFilters(f => ({ ...f, ...p })); setPage(1) }
  const toggleDiff = v => patch({
    difficulty: filters.difficulty.includes(v)
      ? filters.difficulty.filter(x => x !== v)
      : [...filters.difficulty, v],
  })
  const clearAll = () => {
    setQInput('')
    setFilters({ q: '', tags: [], tagsOp: 'or', difficulty: [], status: '', source: '', language: '', onlyDue: false, sort: filters.sort })
    setPage(1)
  }

  const doExport = async format => {
    if (busyIO) return
    setBusyIO(true)
    try {
      await exportProblems(format)
      toast(format === 'md' ? '已导出 Markdown(zip)' : '已导出 JSON')
    } catch (err) {
      toast(err instanceof Error ? err.message : '导出失败', 'error')
    } finally { setBusyIO(false) }
  }
  const doImport = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusyIO(true)
    try {
      const res = await importProblems(file)
      toast(`导入 ${res.imported} 题${res.skipped ? `，跳过 ${res.skipped} 题` : ''}${res.invalid ? `，${res.invalid} 条无效` : ''}`)
      onImported?.() // 通知父级刷新列表（refreshSignal 递增触发重拉）
    } catch (err) {
      toast(err instanceof Error ? err.message : '导入失败', 'error')
    } finally { setBusyIO(false) }
  }

  return (
    <div className="space-y-4">
      {/* ── 工具栏：筛选折叠 + 导入导出 ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => setFiltersOpen(!filtersOpen)} className={btn.plain}>
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" className={'transition-transform ' + (filtersOpen ? 'rotate-90' : '')}>
            <path d="M7 4l6 6-6 6" />
          </svg>
          筛选{hasFilter ? ' ·' : ''}
          {hasFilter && <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500" />}
        </button>
        <span className="text-xs text-stone-400 tabular-nums">共 {total} 题</span>
        <span className="flex-1" />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busyIO}
          className="inline-flex items-center gap-1 px-3 h-9 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50">
          导入
        </button>
        <button type="button" onClick={() => doExport('json')} disabled={busyIO}
          className="inline-flex items-center gap-1 px-3 h-9 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50">
          导出 JSON
        </button>
        <button type="button" onClick={() => doExport('md')} disabled={busyIO}
          className="inline-flex items-center gap-1 px-3 h-9 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50">
          导出 MD
        </button>
        <input ref={fileRef} type="file" accept=".json,.zip" className="hidden" onChange={doImport} />
      </div>

      {/* ── 筛选区（可折叠） ── */}
      {filtersOpen && (
        <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-4 space-y-3">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[220px]">
              <input value={qInput} onChange={e => setQInput(e.target.value)}
                placeholder="搜索标题 / 题号…"
                className="w-full h-9 pl-8 pr-3 rounded-lg text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors" />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400">
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="9" cy="9" r="5.5" /><path d="M13.5 13.5 17 17" /></svg>
              </span>
            </div>
            <select value={filters.status} onChange={e => patch({ status: e.target.value })} className={selectCls}>
              <option value="">全部状态</option>
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select value={filters.source} onChange={e => patch({ source: e.target.value })} className={selectCls}>
              <option value="">全部来源</option>
              {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select value={filters.language} onChange={e => patch({ language: e.target.value })} className={selectCls}>
              <option value="">全部语言</option>
              {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <select value={filters.sort} onChange={e => setFilters(f => ({ ...f, sort: e.target.value }))} className={selectCls}>
              {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* 难度多选 */}
            {DIFFICULTIES.map(d => {
              const on = filters.difficulty.includes(d.value)
              return (
                <button type="button" key={d.value} onClick={() => toggleDiff(d.value)}
                  className={'h-8 px-2.5 rounded-lg text-xs border transition-colors ' +
                    (on ? d.bg + ' ' + d.text + ' border-transparent font-medium'
                      : 'border-black/10 dark:border-white/10 text-stone-500 dark:text-stone-400 hover:border-black/25 dark:hover:border-white/25')}>
                  {d.label}
                </button>
              )
            })}
            <span className="w-px h-5 bg-black/[0.08] dark:bg-white/[0.1] mx-1" />
            {/* 仅看待复习 */}
            <label className="inline-flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400 cursor-pointer select-none">
              <Switch checked={filters.onlyDue} onChange={v => patch({ onlyDue: v })} size="sm" />
              仅看待复习
            </label>
            <span className="flex-1" />
            <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 px-2 h-8 rounded-lg text-xs text-stone-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
              {Icon.refresh}清空筛选
            </button>
          </div>

          {/* 标签行 */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="min-w-[260px] flex-1 max-w-md">
              <TagSelect value={filters.tags} onChange={ids => patch({ tags: ids })} tags={tags} onCreate={onCreateTag} placeholder="按标签筛选…" />
            </div>
            {filters.tags.length > 1 && (
              <div className="inline-flex p-0.5 rounded-lg bg-black/[0.05] dark:bg-white/[0.06] h-8">
                {[{ value: 'or', label: '任意' }, { value: 'and', label: '全部' }].map(o => (
                  <button type="button" key={o.value} onClick={() => setFilters(f => ({ ...f, tagsOp: o.value }))}
                    className={'px-2.5 rounded-md text-xs transition-colors ' +
                      (filters.tagsOp === o.value
                        ? 'bg-white dark:bg-white/[0.12] shadow-sm font-medium text-stone-900 dark:text-stone-100'
                        : 'text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300')}>
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 列表 ── */}
      <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]">
        {loading && !data ? (
          <Spinner text="加载题库中…" />
        ) : items.length === 0 ? (
          <Empty text={hasFilter ? '没有符合条件的题目，试试调整筛选' : '题库还是空的，点右上角「新增题目」开始刷题'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead>
                <tr className="text-left text-[11px] text-stone-400 dark:text-stone-500 border-b border-black/[0.06] dark:border-white/[0.06]">
                  <th className="px-4 py-2.5 font-medium">来源 / 题号</th>
                  <th className="px-3 py-2.5 font-medium">标题</th>
                  <th className="px-3 py-2.5 font-medium">难度</th>
                  <th className="px-3 py-2.5 font-medium">状态</th>
                  <th className="px-3 py-2.5 font-medium">标签</th>
                  <th className="px-3 py-2.5 font-medium text-right">解法</th>
                  <th className="px-3 py-2.5 font-medium">语言</th>
                  <th className="px-3 py-2.5 font-medium">下一复习</th>
                  <th className="px-4 py-2.5 font-medium">更新</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
                {items.map(it => (
                  <tr key={it.id} onClick={() => onOpen?.(it.id)}
                    className="cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                        {sourceLabel(it.source)}
                      </span>
                      {it.source_no && <span className="ml-1.5 font-mono text-xs text-stone-400">#{it.source_no}</span>}
                    </td>
                    <td className="px-3 py-2.5 max-w-[280px]">
                      <span className="font-medium truncate block">{it.title}</span>
                    </td>
                    <td className="px-3 py-2.5"><DiffBadge value={it.difficulty} /></td>
                    <td className="px-3 py-2.5"><StatusBadge value={it.status} /></td>
                    <td className="px-3 py-2.5"><TagTokens tags={it.tags} /></td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-stone-500 dark:text-stone-400">{it.solution_count ?? 0}</td>
                    <td className="px-3 py-2.5"><LangChips langs={it.languages} /></td>
                    <td className="px-3 py-2.5"><NextReviewCell it={it} /></td>
                    <td className="px-4 py-2.5 text-xs text-stone-400 tabular-nums whitespace-nowrap">{mdhmOf(it.updated_at || it.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── 分页 ── */}
        {pages > 1 && (
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-black/[0.06] dark:border-white/[0.06]">
            <span className="text-xs text-stone-400 tabular-nums">第 {page} / {pages} 页</span>
            <div className="flex items-center gap-1">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}
                className="w-8 h-8 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 flex items-center justify-center transition-colors">
                {Icon.chevL}
              </button>
              {pageWindow(page, pages).map((n, i) => n === '…'
                ? <span key={'e' + i} className="px-1 text-stone-400 text-xs">…</span>
                : (
                  <button type="button" key={n} onClick={() => setPage(n)}
                    className={'min-w-8 h-8 px-2 rounded-lg text-xs tabular-nums transition-colors ' +
                      (n === page
                        ? 'bg-indigo-500 text-white font-medium'
                        : 'text-stone-500 dark:text-stone-400 hover:bg-black/5 dark:hover:bg-white/10')}>
                    {n}
                  </button>
                ))}
              <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}
                className="w-8 h-8 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 flex items-center justify-center transition-colors">
                {Icon.chevR}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
