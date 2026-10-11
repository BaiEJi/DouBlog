/**
 * 复习页：今日待复习队列逐题卡片流。
 * 先只展示题目信息（标题/难度/标签），点「看答案」（或空格）展开主解法
 * 思路与代码（答案按需拉详情，含全部解法可切换；题目描述折叠也用这份详情——
 * 队列摘要不回传 description_md 大字段，R14-1）；
 * 底部三键打卡「忘了(红) / 模糊(黄) / 记得(绿)」自动下一题，键盘 1/2/3 = 三档、空格 = 看答案。
 * 队列清空显示总结（三档计数），可刷新队列复查余量。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { reviewToday, reviewProblem, getProblem, diffMeta, sourceLabel } from '../api'
import { Spinner, Icon, todayStr } from '../../kit'
import { MdBlock, CodeBlock } from './ProblemDetail'

const RESULT_OF_KEY = { '1': 'forgot', '2': 'fuzzy', '3': 'remembered' }

function DiffBadge({ value }) {
  if (!value) return null
  const m = diffMeta(value)
  return <span className={'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ' + m.bg + ' ' + m.text}>{m.label}</span>
}

/** 答案区：主解法（星标优先）思路 + 代码；可切换查看其他解法 */
function AnswerPanel({ detail, dark }) {
  const solutions = (detail?.solutions || [])
    .slice()
    .sort((a, b) => (b.is_preferred ? 1 : 0) - (a.is_preferred ? 1 : 0) || (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const [sid, setSid] = useState(solutions[0]?.id || null)
  const active = solutions.find(s => s.id === sid) || solutions[0]
  if (!solutions.length) {
    return <div className="text-center text-xs text-stone-400 py-6">这题还没有记录解法，去题目详情页补充吧</div>
  }
  return (
    <div className="space-y-3">
      {solutions.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {solutions.map(s => (
            <button type="button" key={s.id} onClick={() => setSid(s.id)}
              className={'px-2.5 h-7 rounded-lg text-xs transition-colors ' +
                (s.id === active?.id
                  ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium'
                  : 'bg-black/[0.05] dark:bg-white/[0.08] text-stone-500 dark:text-stone-400 hover:bg-black/10 dark:hover:bg-white/[0.14]')}>
              {s.is_preferred ? '★ ' : ''}{s.name || '未命名解法'}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium">{active?.is_preferred ? '★ ' : ''}{active?.name || '未命名解法'}</span>
        {active?.time_complexity && <span className="font-mono text-[11px] rounded-md px-1.5 py-0.5 bg-black/[0.05] dark:bg-white/[0.08] text-stone-600 dark:text-stone-300">时 {active.time_complexity}</span>}
        {active?.space_complexity && <span className="font-mono text-[11px] rounded-md px-1.5 py-0.5 bg-black/[0.05] dark:bg-white/[0.08] text-stone-600 dark:text-stone-300">空 {active.space_complexity}</span>}
      </div>
      {active?.approach_md && (
        <div className="rounded-xl border border-black/[0.05] dark:border-white/[0.07] bg-black/[0.015] dark:bg-white/[0.02] px-4 py-3">
          <MdBlock text={active.approach_md} dark={dark} />
        </div>
      )}
      {(active?.codes || []).map(c => <CodeBlock key={c.id || c.language} code={c.code} language={c.language} />)}
    </div>
  )
}

export default function ReviewQueue({ toast, dark, onReviewed }) {
  const [queue, setQueue] = useState(null)   // null=加载中 []=空
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [detail, setDetail] = useState(null) // 当前题答案详情
  const [detailLoading, setDetailLoading] = useState(false)
  const [counts, setCounts] = useState({ remembered: 0, fuzzy: 0, forgot: 0 })
  const [busy, setBusy] = useState(false)

  // 卸载守卫：异步回调 setState 前确认组件仍挂载
  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])

  const load = useCallback(() => {
    setQueue(null); setIndex(0); setRevealed(false); setDetail(null)
    setCounts({ remembered: 0, fuzzy: 0, forgot: 0 })
    reviewToday()
      .then(res => {
        if (!aliveRef.current) return
        setQueue(res || [])
      })
      .catch(err => {
        if (!aliveRef.current) return
        toast(err instanceof Error ? err.message : '加载复习队列失败', 'error')
        setQueue([])
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const current = queue?.[index]
  const finished = queue != null && index >= queue.length

  // 当前题 id 的 ref：答案异步返回时校验归属，防止打卡切题后过期答案覆盖下一题
  const currentIdRef = useRef(null)
  useEffect(() => { currentIdRef.current = current?.id }, [current])

  const reveal = useCallback(() => {
    if (!current || revealed || detailLoading) return
    const id = current.id
    setRevealed(true)
    setDetailLoading(true)
    getProblem(id)
      .then(d => { if (aliveRef.current && currentIdRef.current === id) setDetail(d) })
      .catch(err => {
        if (aliveRef.current && currentIdRef.current === id) {
          toast(err instanceof Error ? err.message : '加载答案失败', 'error')
        }
      })
      .finally(() => { if (aliveRef.current) setDetailLoading(false) })
  }, [current, revealed, detailLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  const grade = useCallback(result => {
    if (!current || busy) return
    setBusy(true)
    reviewProblem(current.id, result)
      .then(res => {
        if (!aliveRef.current) return
        setCounts(c => ({ ...c, [result]: (c[result] || 0) + 1 }))
        if (res?.demoted) toast('连续忘记：这题已移出复习计划，回到待做')
        else if (res?.graduated) toast('毕业！这道题已达到最长间隔，标记为已掌握 🎉')
        setRevealed(false); setDetail(null)
        setIndex(i => i + 1)
        onReviewed?.()
      })
      .catch(err => {
        if (aliveRef.current) toast(err instanceof Error ? err.message : '打卡失败，请重试', 'error')
      })
      .finally(() => { if (aliveRef.current) setBusy(false) })
  }, [current, busy]) // eslint-disable-line react-hooks/exhaustive-deps

  // 键盘：1/2/3 三档，空格看答案
  useEffect(() => {
    const onKey = e => {
      if (finished || !current) return
      if (e.key === ' ') { e.preventDefault(); reveal(); return }
      const result = RESULT_OF_KEY[e.key]
      if (result && revealed) grade(result)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, finished, revealed, reveal, grade])

  if (queue == null) return <Spinner text="加载复习队列…" />
  if (queue.length === 0) {
    return (
      <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] py-16 text-center">
        <div className="text-3xl mb-3">🌱</div>
        <div className="text-sm font-medium mb-1">今日没有待复习的题目</div>
        <p className="text-xs text-stone-400">在题库中把题目「加入复习」，按 [1,2,4,7,15,30,60,120] 天间隔自动安排回顾。</p>
      </div>
    )
  }

  // ── 总结页 ──
  if (finished) {
    const total = counts.remembered + counts.fuzzy + counts.forgot
    return (
      <div className="max-w-xl mx-auto rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-8 text-center">
        <div className="text-3xl mb-2">✅</div>
        <h3 className="text-lg font-semibold mb-1">今日复习完成</h3>
        <p className="text-xs text-stone-400 mb-6">共打卡 {total} 题</p>
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-xl bg-emerald-500/10 p-4">
            <div className="text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{counts.remembered}</div>
            <div className="text-[11.5px] text-stone-500 dark:text-stone-400 mt-0.5">记得</div>
          </div>
          <div className="rounded-xl bg-amber-500/10 p-4">
            <div className="text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{counts.fuzzy}</div>
            <div className="text-[11.5px] text-stone-500 dark:text-stone-400 mt-0.5">模糊</div>
          </div>
          <div className="rounded-xl bg-red-500/10 p-4">
            <div className="text-xl font-semibold tabular-nums text-red-600 dark:text-red-400">{counts.forgot}</div>
            <div className="text-[11.5px] text-stone-500 dark:text-stone-400 mt-0.5">忘了</div>
          </div>
        </div>
        <p className="text-xs text-stone-400 mb-5 leading-relaxed">
          「模糊」的原档重复、「忘了」回到 1 天间隔；间隔序列走满 120 天即毕业。
        </p>
        <button type="button" onClick={load}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 transition-colors">
          {Icon.refresh}刷新队列
        </button>
      </div>
    )
  }

  const scheduled = current.scheduled_date
  // R11-2：逾期判定用队列响应的 today（todo 设置时区），缺省退回本地日期
  const overdue = scheduled && scheduled < (queue.today || todayStr())

  return (
    <div className="max-w-3xl mx-auto">
      {/* 进度条 */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs text-stone-400 tabular-nums shrink-0">{index + 1} / {queue.length}</span>
        <div className="flex-1 h-1.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] overflow-hidden">
          <div className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${Math.round((index / queue.length) * 100)}%` }} />
        </div>
        <span className="text-xs text-stone-400 shrink-0">记得 {counts.remembered} · 模糊 {counts.fuzzy} · 忘了 {counts.forgot}</span>
      </div>

      {/* 题目卡片 */}
      <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-6">
        <div className="flex items-center gap-2.5 flex-wrap mb-3">
          <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            {sourceLabel(current.source)}
          </span>
          {current.source_no && <span className="font-mono text-xs text-stone-500 dark:text-stone-400">#{current.source_no}</span>}
          <DiffBadge value={current.difficulty} />
          {(current.tags || []).slice(0, 4).map(t => (
            <span key={t.id}
              className="inline-flex items-center rounded-full px-2 h-5 text-[10.5px]"
              style={{ color: t.color || '#94a3b8', background: (t.color || '#94a3b8') + '14', border: `1px solid ${(t.color || '#94a3b8') + '55'}` }}>
              {t.name}
            </span>
          ))}
        </div>

        <h3 className="text-base font-semibold mb-1">{current.title}</h3>
        {scheduled && (
          <p className="text-[11.5px] text-stone-400 mb-3 tabular-nums">
            计划复习日 {scheduled}{overdue ? '（逾期）' : ''} · 第 {current.next_review?.cycle ?? current.cycle ?? 1} 轮
          </p>
        )}

        {/* R14-1：队列摘要的 description_md 恒为 null——用「看答案」拉回的详情渲染；
            key=题目 id：切题时重置折叠态 */}
        <DescToggle key={current.id} descriptionMd={detail?.description_md} dark={dark} />

        {/* 答案区 */}
        {revealed ? (
          <div className="mt-5 pt-5 border-t border-black/[0.06] dark:border-white/[0.07]">
            {detailLoading && !detail
              ? <Spinner text="加载答案中…" />
              : <AnswerPanel detail={detail} dark={dark} />}
          </div>
        ) : (
          <div className="mt-6 flex justify-center">
            <button type="button" onClick={reveal}
              className="inline-flex items-center gap-2 px-6 h-11 rounded-xl text-sm font-medium bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90 transition-opacity">
              👀 看答案
              <span className="text-[11px] font-normal opacity-60">空格</span>
            </button>
          </div>
        )}
      </div>

      {/* 三键打卡 */}
      {revealed && (
        <div className="grid grid-cols-3 gap-3 mt-4">
          <button type="button" onClick={() => grade('forgot')} disabled={busy}
            className="h-12 rounded-xl text-sm font-medium bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50">
            忘了 <span className="opacity-60 font-normal">1</span>
          </button>
          <button type="button" onClick={() => grade('fuzzy')} disabled={busy}
            className="h-12 rounded-xl text-sm font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50">
            模糊 <span className="opacity-60 font-normal">2</span>
          </button>
          <button type="button" onClick={() => grade('remembered')} disabled={busy}
            className="h-12 rounded-xl text-sm font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50">
            记得 <span className="opacity-60 font-normal">3</span>
          </button>
        </div>
      )}
    </div>
  )
}

/** 题目描述折叠（复习时先自己回忆，默认收起）。
 *  R14-1：description_md 来自「看答案」的 getProblem 详情（随答案一次请求带回，
 *  队列摘要不回传该大字段）——未展开答案前不显示折叠入口 */
function DescToggle({ descriptionMd, dark }) {
  const [open, setOpen] = useState(false)
  if (!descriptionMd) return null
  return (
    <div className="rounded-xl border border-black/[0.05] dark:border-white/[0.07] bg-black/[0.015] dark:bg-white/[0.02]">
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 h-10 text-xs text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 transition-colors">
        <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" className={'transition-transform ' + (open ? 'rotate-90' : '')}>
          <path d="M7 4l6 6-6 6" />
        </svg>
        题目描述
      </button>
      {open && (
        <div className="px-4 pb-4">
          <MdBlock text={descriptionMd} dark={dark} />
        </div>
      )}
    </div>
  )
}
