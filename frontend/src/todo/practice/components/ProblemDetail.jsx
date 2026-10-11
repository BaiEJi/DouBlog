/**
 * 题目详情：头部信息条（标题/原题外链/难度/状态按钮组/标签）+ 题目描述（Markdown 渲染）+
 * 易错点折叠面板 + 解法卡片（解法名/复杂度徽章/星标/思路 Markdown/代码语言 Tab + 复制）。
 * 同时导出 MdBlock（md.render + prose-content + mermaid 补画）与 CodeBlock
 * （pre>code + highlight.js 渐进高亮 + 复制），供复习页 / 编辑预览复用。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import md, { renderMermaidDiagrams } from '@/shared/md'
import hljs from 'highlight.js/lib/common'

import { getProblem, updateProblem, deleteProblem, unreviewProblem, diffMeta, statusMeta, sourceLabel, langMeta } from '../api'
import { Card, Empty, Spinner, Confirm, btn, Icon } from '../../kit'
import { todayStr, mdhmOf } from '../../kit'

// ─── Markdown 渲染块（详情/复习/编辑预览共用） ────────────────

export function MdBlock({ text, dark, className = '' }) {
  const html = useMemo(() => (text ? md.render(text) : ''), [text])
  useEffect(() => { if (html) renderMermaidDiagrams(dark) }, [html, dark])
  if (!html) return <div className="py-3 text-xs text-stone-400">暂无内容</div>
  return <div className={'prose-content text-sm ' + className} dangerouslySetInnerHTML={{ __html: html }} />
}

// ─── 代码块（pre>code + hljs.highlightElement + 复制） ────────

export function CodeBlock({ code, language }) {
  const ref = useRef(null)
  const copiedTimer = useRef(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.querySelectorAll('pre code').forEach(block => {
      if (!block.dataset.hl) {
        try { hljs.highlightElement(block) } catch { /* 未知语言：保持纯文本 */ }
        block.dataset.hl = '1'
      }
    })
  }, [code, language])

  // 卸载 / 重复复制时清理「已复制」回置定时器，避免卸载后 setState
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current) }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code || '')
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch { /* 剪贴板不可用（非安全上下文）时静默 */ }
  }

  return (
    <div className="code-block" ref={ref}>
      <div className="code-block-header">
        <span className="code-block-lang">{langMeta(language).label}</span>
        <button type="button" className="code-block-copy" onClick={copy}>{copied ? '已复制' : '复制'}</button>
      </div>
      <pre className="hljs"><code className={`language-${language || 'plaintext'}`}>{code || ''}</code></pre>
    </div>
  )
}

// ─── 小徽章 ──────────────────────────────────────────────────

function DiffBadge({ value }) {
  const m = diffMeta(value)
  return <span className={'inline-flex items-center rounded-md px-2 h-5.5 text-[11px] font-medium ' + m.bg + ' ' + m.text}>{m.label}</span>
}

function StatusBadge({ value }) {
  const m = statusMeta(value)
  return <span className={'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ' + m.cls}>{m.label}</span>
}

/** 下一复习日（Date 字符串 YYYY-MM-DD；逾期红字）。
 *  R11-2：逾期判定优先后端 today（todo 设置时区，父级自复习队列透传），
 *  缺省（队列未加载/后端不可用）才退回浏览器本地日期 */
function NextReviewChip({ date, today }) {
  if (!date) return <span className="text-[11.5px] text-stone-400">未在复习</span>
  const overdue = date < (today || todayStr())
  return (
    <span className={'text-[11.5px] tabular-nums ' + (overdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-stone-500 dark:text-stone-400')}>
      {date.slice(5)}{overdue ? ' · 逾期' : ''}
    </span>
  )
}

/** 单个解法卡片：名称 + 复杂度徽章 + 星标 + 思路 + 代码语言 Tab */
function SolutionCard({ solution, dark }) {
  const codes = solution.codes || []
  const [activeLang, setActiveLang] = useState(codes.length ? codes[0].language : '')
  const active = codes.find(c => c.language === activeLang) || codes[0]

  return (
    <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <h4 className="text-[15px] font-medium">
          {solution.is_preferred && <span className="text-amber-500 mr-1" title="主解法">★</span>}
          {solution.name || '未命名解法'}
        </h4>
        {solution.time_complexity && (
          <span className="font-mono text-[11px] rounded-md px-1.5 py-0.5 bg-black/[0.05] dark:bg-white/[0.08] text-stone-600 dark:text-stone-300">
            时 {solution.time_complexity}
          </span>
        )}
        {solution.space_complexity && (
          <span className="font-mono text-[11px] rounded-md px-1.5 py-0.5 bg-black/[0.05] dark:bg-white/[0.08] text-stone-600 dark:text-stone-300">
            空 {solution.space_complexity}
          </span>
        )}
      </div>

      {solution.approach_md && (
        <div className="rounded-xl border border-black/[0.05] dark:border-white/[0.07] bg-black/[0.015] dark:bg-white/[0.02] px-4 py-3 mb-3">
          <MdBlock text={solution.approach_md} dark={dark} />
        </div>
      )}

      {codes.length > 0 && (
        <>
          {codes.length > 1 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {codes.map(c => (
                <button key={c.language} type="button" onClick={() => setActiveLang(c.language)}
                  className={'px-2.5 h-7 rounded-lg text-xs transition-colors ' +
                    (c.language === active?.language
                      ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium'
                      : 'bg-black/[0.05] dark:bg-white/[0.08] text-stone-500 dark:text-stone-400 hover:bg-black/10 dark:hover:bg-white/[0.14]')}>
                  {langMeta(c.language).label}
                </button>
              ))}
            </div>
          )}
          <CodeBlock code={active?.code} language={active?.language} />
        </>
      )}
    </div>
  )
}

// ─── 详情主组件 ──────────────────────────────────────────────

/** 详情响应兼容两种形态：扁平 { ...题目, tags, solutions, next_review } 或 { problem, tags, solutions, next_review } */
function normalizeDetail(raw) {
  const p = raw?.problem || raw || {}
  return {
    problem: p,
    tags: raw?.tags || p.tags || [],
    solutions: (raw?.solutions || p.solutions || []).slice()
      .sort((a, b) => (b.is_preferred ? 1 : 0) - (a.is_preferred ? 1 : 0) || (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    nextReview: raw?.next_review || p.next_review || null,
  }
}

export default function ProblemDetail({ id, dark, toast, today, onBack, onEdit, onDeleted, onChanged }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pitfallOpen, setPitfallOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  // 卸载守卫：异步回调 setState 前确认组件仍挂载
  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])

  const load = () => {
    setLoading(true)
    getProblem(id)
      .then(raw => { if (aliveRef.current) setData(normalizeDetail(raw)) })
      .catch(err => {
        if (aliveRef.current) toast(err instanceof Error ? err.message : '加载题目失败', 'error')
      })
      .finally(() => { if (aliveRef.current) setLoading(false) })
  }
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <Spinner text="加载题目中…" />
  if (!data?.problem) return <Empty text="题目不存在或已删除" />

  const p = data.problem
  const inReview = p.status === 'reviewing'
  const canMarkSolved = p.status === 'todo'

  const withBusy = async (fn) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error')
    } finally {
      if (aliveRef.current) setBusy(false)
    }
  }

  /** 状态类操作成功后：重拉详情 + 通知父级刷新列表/徽标 */
  const done = () => { load(); onChanged?.() }

  const joinReview = () => withBusy(async () => {
    await updateProblem(id, { status: 'reviewing', revision: p.revision })
    toast('已加入复习计划')
    done()
  })
  const exitReview = () => withBusy(async () => {
    await unreviewProblem(id)
    toast('已退出复习计划')
    done()
  })
  const markSolved = () => withBusy(async () => {
    await updateProblem(id, { status: 'solved', revision: p.revision })
    toast('已标记为已解')
    done()
  })
  const handleDelete = () => withBusy(async () => {
    await deleteProblem(id)
    toast('题目已删除')
    onDeleted?.()
  })

  const nextDate = data.nextReview?.scheduled_date || p.next_review?.scheduled_date || null

  return (
    <div className="space-y-4">
      {/* ── 顶栏 ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" onClick={onBack}
          className="inline-flex items-center gap-1 px-3 h-9 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors shrink-0">
          {Icon.back}返回
        </button>
        <h2 className="text-lg font-semibold tracking-tight truncate flex-1 min-w-[200px]">{p.title}</h2>
        {p.url && (
          <a href={p.url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 px-3 h-9 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors shrink-0">
            原题 ↗
          </a>
        )}
      </div>

      {/* ── 信息条 ── */}
      <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            {sourceLabel(p.source)}
          </span>
          {p.source_no && <span className="font-mono text-xs text-stone-500 dark:text-stone-400">#{p.source_no}</span>}
          <DiffBadge value={p.difficulty} />
          <StatusBadge value={p.status} />
          <span className="w-px h-4 bg-black/[0.08] dark:bg-white/[0.1]" />
          <span className="text-[11.5px] text-stone-400">下一复习</span>
          <NextReviewChip date={nextDate} today={today} />
          <span className="ml-auto text-[11.5px] text-stone-400 dark:text-stone-500 tabular-nums">
            {p.last_reviewed_at ? `最近复习 ${mdhmOf(p.last_reviewed_at)}` : `创建 ${mdhmOf(p.created_at)}`}
          </span>
        </div>

        {data.tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-3">
            {data.tags.map(t => (
              <span key={t.id}
                className="inline-flex items-center rounded-full px-2 h-5.5 text-[10.5px]"
                style={{ color: t.color || '#94a3b8', background: (t.color || '#94a3b8') + '14', border: `1px solid ${(t.color || '#94a3b8') + '55'}` }}>
                {t.name}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap mt-4 pt-4 border-t border-black/[0.05] dark:border-white/[0.07]">
          {inReview
            ? <button type="button" onClick={exitReview} disabled={busy} className={btn.plain}>退出复习</button>
            : <button type="button" onClick={joinReview} disabled={busy} className={btn.primary}>加入复习</button>}
          {canMarkSolved && (
            <button type="button" onClick={markSolved} disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50">
              标记已解
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={() => onEdit?.(id)} className={btn.plain}>{Icon.edit}编辑</button>
          <button type="button" onClick={() => setConfirmDel(true)} disabled={busy}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50">
            {Icon.trash}删除
          </button>
        </div>
      </div>

      {/* ── 题目描述 ── */}
      <Card title="题目描述">
        <MdBlock text={p.description_md} dark={dark} />
      </Card>

      {/* ── 易错点（折叠面板） ── */}
      <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]">
        <button type="button" onClick={() => setPitfallOpen(!pitfallOpen)}
          className="w-full flex items-center gap-2 px-5 h-12 text-sm font-semibold">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round"
            className={'transition-transform ' + (pitfallOpen ? 'rotate-90' : '')}>
            <path d="M7 4l6 6-6 6" />
          </svg>
          易错点
          {p.pitfall_md && <span className="ml-1 text-[11px] font-normal text-amber-600 dark:text-amber-400">有记录</span>}
        </button>
        {pitfallOpen && (
          <div className="px-5 pb-5 pt-1 border-t border-black/[0.05] dark:border-white/[0.07]">
            <MdBlock text={p.pitfall_md} dark={dark} />
          </div>
        )}
      </div>

      {/* ── 解法区 ── */}
      <div>
        <h3 className="text-base font-semibold mb-3">解法（{data.solutions.length}）</h3>
        {data.solutions.length === 0
          ? <Empty text="还没有解法，点右上角「编辑」补充" />
          : (
            <div className="space-y-4">
              {data.solutions.map(s => <SolutionCard key={s.id} solution={s} dark={dark} />)}
            </div>
          )}
      </div>

      {confirmDel && (
        <Confirm text={`确定删除「${p.title}」吗？其下解法、代码与复习记录将一并删除。`}
          danger onOk={handleDelete} onCancel={() => setConfirmDel(false)} />
      )}
    </div>
  )
}
