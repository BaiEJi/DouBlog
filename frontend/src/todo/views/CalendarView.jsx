/**
 * 日历（照搬 MyTodo CalendarPage 交互）：周 / 月 / 年三模式；
 * 月视图每日迷你任务列表（最多 4 条），年视图 indigo 热度方格。
 * variant: 'todo'（全部任务）| 'life'（plan_only=true 生活模式）。
 * 点某天 → onOpenDay(dateStr)（今日页特定日期 / life 今日打卡）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { todoTasks } from '../api'
import {
  Segmented, fmtDate, todayStr, monthMatrix, startOfWeek, addDays,
  weekdayIndex, WEEKDAY_LABELS, quadrantMeta,
} from '../kit'

/** 单元格迷你任务列表（定义在组件外，保持引用稳定） */
function TaskMiniList({ list, max = 4 }) {
  if (!list || list.length === 0) return null
  return (
    <div className="flex flex-col gap-[3px] mt-1 min-h-0">
      {list.slice(0, max).map(t => {
        const m = quadrantMeta(t.quadrant)
        return (
          <div key={t.id}
            className={'flex items-center gap-1 text-[10.5px] leading-4 rounded px-1 truncate ' +
              (t.status === 'done' ? 'opacity-50 line-through' : '')}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: m.color }} />
            <span className="truncate">{t.title}</span>
          </div>
        )
      })}
      {list.length > max && <div className="text-[10px] text-stone-400 px-1">还有 {list.length - max} 项…</div>}
    </div>
  )
}

const intensityCls = count => {
  if (count <= 0) return 'bg-black/[0.03] dark:bg-white/[0.055]'
  if (count === 1) return 'bg-indigo-500/25'
  if (count === 2) return 'bg-indigo-500/45'
  if (count <= 4) return 'bg-indigo-500/70'
  return 'bg-indigo-500'
}

export default function CalendarView({ variant = 'todo', onOpenDay, toast }) {
  const [mode, setMode] = useState('month')
  const [anchor, setAnchor] = useState(new Date())
  const [tasks, setTasks] = useState(null)
  const today = todayStr()

  const range = useMemo(() => {
    if (mode === 'week') {
      const start = startOfWeek(anchor)
      return { start, end: addDays(start, 6) }
    }
    if (mode === 'month') {
      return {
        start: new Date(anchor.getFullYear(), anchor.getMonth(), 1),
        end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0),
      }
    }
    return {
      start: new Date(anchor.getFullYear(), 0, 1),
      end: new Date(anchor.getFullYear(), 11, 31),
    }
  }, [mode, anchor])

  const load = useCallback(async () => {
    try {
      const params = { from: fmtDate(range.start), to: fmtDate(range.end), status: 'all' }
      if (variant === 'life') params.plan_only = true
      setTasks(await todoTasks(params))
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载日历数据失败', 'error')
    }
  }, [range, variant, toast])

  useEffect(() => {
    setTasks(null)
    load()
  }, [load])

  const byDate = useMemo(() => {
    const map = new Map()
    for (const t of tasks || []) {
      if (!t.task_date) continue
      if (!map.has(t.task_date)) map.set(t.task_date, [])
      map.get(t.task_date).push(t)
    }
    return map
  }, [tasks])

  const shift = dir => {
    const next =
      mode === 'week' ? addDays(anchor, dir * 7)
        : mode === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1)
          : new Date(anchor.getFullYear() + dir, anchor.getMonth(), 1)
    setAnchor(next)
  }

  const rangeLabel = useMemo(() => {
    if (mode === 'week') {
      return `${fmtDate(range.start)} – ${fmtDate(range.end)}`
    }
    if (mode === 'month') return `${anchor.getFullYear()} 年 ${anchor.getMonth() + 1} 月`
    return `${anchor.getFullYear()} 年`
  }, [mode, anchor, range])

  const todayAnchor = new Date()

  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* 工具栏 */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 mb-4">
        <Segmented value={mode} onChange={setMode}
          options={[{ label: '周', value: 'week' }, { label: '月', value: 'month' }, { label: '年', value: 'year' }]} />
        <div className="inline-flex rounded-lg border border-black/10 dark:border-white/10 overflow-hidden">
          <button onClick={() => shift(-1)} title="上一页"
            className="w-8 h-9 flex items-center justify-center text-stone-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.07] transition-colors">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4l-5 6 5 6" /></svg>
          </button>
          <button onClick={() => setAnchor(todayAnchor)}
            className="px-3 h-9 text-xs text-stone-600 dark:text-stone-300 border-l border-black/10 dark:border-white/10 hover:bg-black/[0.04] dark:hover:bg-white/[0.07] transition-colors">
            今天
          </button>
          <button onClick={() => shift(1)} title="下一页"
            className="w-8 h-9 flex items-center justify-center text-stone-500 border-l border-black/10 dark:border-white/10 hover:bg-black/[0.04] dark:hover:bg-white/[0.07] transition-colors">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4l5 6-5 6" /></svg>
          </button>
        </div>
        <span className="text-sm font-medium tabular-nums">{rangeLabel}</span>
        <span className="ml-auto text-xs text-stone-400 dark:text-stone-500">
          {tasks ? `共 ${tasks.length} 个任务` : '加载中…'}
        </span>
      </div>

      {/* 周视图 */}
      {mode === 'week' && (
        <div className="grid grid-cols-7 gap-2 flex-1 min-h-0" style={{ gridAutoRows: 'minmax(0, 1fr)' }}>
          {Array.from({ length: 7 }, (_, i) => addDays(range.start, i)).map(d => {
            const key = fmtDate(d)
            const list = byDate.get(key) || []
            const pending = list.filter(t => t.status === 'pending' || t.status === 'in_progress').length
            return (
              <button key={key} onClick={() => onOpenDay(key)} title="点击查看当天明细"
                className={'flex flex-col text-left rounded-2xl border p-3 min-h-0 transition-colors ' +
                  (key === today
                    ? 'border-indigo-400/70 bg-indigo-500/[0.06]'
                    : 'border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] hover:border-black/20 dark:hover:border-white/20')}>
                <div className="flex items-center gap-2 mb-1 shrink-0">
                  <span className="text-[11px] text-stone-400">{WEEKDAY_LABELS[weekdayIndex(d)]}</span>
                  <span className={'text-sm font-semibold tabular-nums ' + (key === today ? 'text-indigo-600 dark:text-indigo-400' : '')}>{d.getDate()}</span>
                  {pending > 0 && (
                    <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-stone-200 dark:bg-white/[0.14] text-stone-600 dark:text-stone-300 text-[10px] flex items-center justify-center tabular-nums">
                      {pending}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1 overflow-y-auto min-h-0">
                  {list.slice(0, 50).map(t => {
                    const m = quadrantMeta(t.quadrant)
                    return (
                      <div key={t.id}
                        className={'flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11.5px] truncate border ' +
                          (t.status === 'done' ? 'opacity-50 line-through border-transparent' : 'border-black/[0.05] dark:border-white/[0.06]')}>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: m.color }} />
                        <span className="truncate">{t.title}</span>
                      </div>
                    )
                  })}
                  {list.length === 0 && <span className="text-[11px] text-stone-300 dark:text-stone-600 mt-2">无任务</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* 月视图 */}
      {mode === 'month' && (
        <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-4">
          <div className="grid grid-cols-7 mb-1.5 shrink-0">
            {WEEKDAY_LABELS.map(w => (
              <div key={w} className="text-center text-[11px] text-stone-400 py-1">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5 flex-1 min-h-0" style={{ gridAutoRows: 'minmax(0, 1fr)' }}>
            {monthMatrix(anchor).flatMap((row, ri) =>
              row.map((d, ci) => {
                const key = `${ri}-${ci}`
                if (!d) return <div key={key} className="min-h-0 rounded-xl bg-black/[0.015] dark:bg-white/[0.012]" />
                const ds = fmtDate(d)
                const list = byDate.get(ds) || []
                return (
                  <button key={key} onClick={() => onOpenDay(ds)} title="点击查看当天明细"
                    className={'flex flex-col text-left rounded-xl border p-1.5 min-h-0 overflow-hidden align-start transition-colors ' +
                      (ds === today
                        ? 'border-indigo-400/70 bg-indigo-500/[0.06]'
                        : list.length
                          ? 'border-black/[0.08] dark:border-white/[0.09] hover:border-black/20 dark:hover:border-white/25'
                          : 'border-black/[0.05] dark:border-white/[0.06] hover:border-black/15 dark:hover:border-white/20')}>
                    <span className={'text-[11.5px] font-medium tabular-nums px-0.5 shrink-0 ' +
                      (ds === today ? 'text-indigo-600 dark:text-indigo-400' : 'text-stone-500 dark:text-stone-400')}>{d.getDate()}</span>
                    <TaskMiniList list={list} />
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* 年视图 */}
      {mode === 'year' && (
        <div className="grid grid-cols-4 gap-3 flex-1 min-h-0" style={{ gridAutoRows: 'minmax(0, 1fr)' }}>
          {Array.from({ length: 12 }, (_, m) => {
            const monthAnchor = new Date(anchor.getFullYear(), m, 1)
            return (
              <div key={m} className="flex flex-col min-h-0 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-3">
                <div className="text-xs font-medium mb-1.5 shrink-0">{m + 1} 月</div>
                <div className="grid grid-cols-7 gap-[3px] mb-1 shrink-0">
                  {WEEKDAY_LABELS.map(w => (
                    <div key={w} className="text-[9px] text-stone-300 dark:text-stone-600 text-center">{w}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-[3px] flex-1 min-h-0" style={{ gridAutoRows: 'minmax(0, 1fr)' }}>
                  {monthMatrix(monthAnchor).flat().map((d, i) => {
                    if (!d) return <div key={i} className="rounded-[3px]" />
                    const ds = fmtDate(d)
                    const list = byDate.get(ds) || []
                    const done = list.filter(t => t.status === 'done').length
                    return (
                      <button key={i} onClick={() => onOpenDay(ds)}
                        title={`${ds}：共 ${list.length} 项${done ? `，完成 ${done}` : ''}`}
                        className={'rounded-[3px] transition-transform hover:scale-110 ' +
                          intensityCls(list.length) +
                          (ds === today ? ' ring-2 ring-indigo-400 ring-offset-1 ring-offset-white dark:ring-offset-[#1c1b1a]' : '')} />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
