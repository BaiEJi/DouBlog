/**
 * 统计（照搬 MyTodo StatsPage 交互）：
 * streak 卡（当前/最长/累计活跃/今日完成/当前搁置）+ 年度完成热力图（CSS grid 方格，indigo 色阶）
 * + 近 30 天趋势（双线 SVG）+ 象限完成分布（进度条）+ 类别完成占比（环形 SVG）+ 搁置清单。
 */
import { useEffect, useMemo, useState } from 'react'

import { todoStatsStreak, todoStatsDaily, todoStatsRange, todoStatsHeatmap, todoMigrationsShelved } from '../api'
import { DualLine, DonutPie } from '../charts'
import {
  Empty, Dot,
  QUADRANT_META, addDays, fmtDate, todayStr, adjustForDark, useQuadrantText,
} from '../kit'
import { ReportMetrics, ReportPage, ReportPanel } from './ReportLayout'

const LEVELS = [
  'bg-black/[0.045] dark:bg-white/[0.055]',
  'bg-indigo-500/25', 'bg-indigo-500/45', 'bg-indigo-500/70', 'bg-indigo-500',
]
const levelOf = c => (c <= 0 ? 0 : c === 1 ? 1 : c === 2 ? 2 : c < 5 ? 3 : 4)
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

/** 年度热力图：周列（周一开头）× 日行，indigo 色阶（色阶类自带 dark: 变体） */
function Heatmap({ year, days }) {
  const [hover, setHover] = useState(null)
  const grid = useMemo(() => {
    const countMap = new Map((days || []).map(d => [d.date, d.count]))
    const jan1 = new Date(year, 0, 1)
    const lead = (jan1.getDay() + 6) % 7
    const total = Math.floor((new Date(year, 11, 31) - jan1) / 86400000) + 1
    const cells = []
    for (let i = 0; i < lead; i++) cells.push(null)
    for (let i = 0; i < total; i++) {
      const d = new Date(year, 0, 1 + i)
      const key = `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      cells.push({ key, count: countMap.get(key) || 0, month: d.getMonth() })
    }
    while (cells.length % 7 !== 0) cells.push(null)
    const cols = []
    for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7))
    return cols
  }, [year, days])

  const cols = grid.length
  const colTpl = `25px repeat(${cols}, minmax(0, 1fr))`

  return (
    <div className="w-full overflow-x-auto pb-1" style={{ '--gap': '4px' }}>
      <div className="min-w-[680px]">
        {/* 月份标签 */}
        <div className="mb-2 grid" style={{ gridTemplateColumns: colTpl, gap: 'var(--gap)' }}>
          {(() => {
            const marks = []
            grid.forEach((col, ci) => {
              const first = col.find(cell => cell?.key.endsWith('-01'))
              if (first) marks.push({ ci, m: first.month })
            })
            return marks.map(({ ci, m }) => (
              <span key={m} className="todo-report-muted text-[13px] leading-5 whitespace-nowrap"
                style={{ gridColumn: ci + 2 }}>{MONTHS[m]}</span>
            ))
          })()}
        </div>
        {/* 方格：周列 × 日行的整幅网格，随卡片宽度自适应撑满 */}
        <div className="grid" style={{ gridTemplateColumns: colTpl, gap: 'var(--gap)' }}>
          {['一', '', '三', '', '五', '', '日'].map((w, i) => (
            <span key={i} className="todo-report-muted flex items-center justify-start text-xs leading-none"
              style={{ gridColumn: 1, gridRow: i + 1 }}>{w}</span>
          ))}
          {grid.map((col, ci) =>
            col.map((cell, ri) => cell ? (
              <span key={cell.key}
                title={`${cell.key} · 完成 ${cell.count} 项`}
                onMouseEnter={() => setHover(cell)}
                onMouseLeave={() => setHover(null)}
                style={{ gridColumn: ci + 2, gridRow: ri + 1 }}
                className={'aspect-square rounded-[3px] transition-transform hover:scale-125 cursor-default ' + LEVELS[levelOf(cell.count)]} />
            ) : <span key={ri} className="aspect-square" style={{ gridColumn: ci + 2, gridRow: ri + 1 }} />)
          )}
        </div>
        {/* 图例 + 悬浮 */}
        <div className="todo-report-muted mt-3 flex min-h-6 items-center gap-1.5 text-sm">
          <span>少</span>
          {LEVELS.map((l, i) => <span key={i} className={'w-[11px] h-[11px] rounded-[3px] ' + l} />)}
          <span>多</span>
          {hover && <span className="ml-3 tabular-nums">{hover.key} · 完成 {hover.count} 项</span>}
        </div>
      </div>
    </div>
  )
}

/** 象限/类别进度条 */
function Bar({ label, color, value, total, text, dark }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  const bg = dark ? adjustForDark(color) : color
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="truncate text-base font-medium">{label}</span>
        <span className="todo-report-muted shrink-0 text-[15px] tabular-nums">{text}</span>
      </div>
      <div className="h-1.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: bg }} />
      </div>
    </div>
  )
}

export default function StatsView({ toast, dark }) {
  const year = new Date().getFullYear()
  const [streak, setStreak] = useState(null)
  const [daily, setDaily] = useState(null)
  const [range, setRange] = useState(null)
  const [heatmapYear, setHeatmapYear] = useState(year)
  const [heatmap, setHeatmap] = useState(null)
  const [shelved, setShelved] = useState([])
  const [loading, setLoading] = useState(true)
  const { labels } = useQuadrantText()

  useEffect(() => {
    let cancelled = false
    Promise.all([
      todoStatsStreak(),
      todoStatsDaily(todayStr()),
      todoStatsRange(fmtDate(addDays(new Date(), -29)), todayStr()),
      todoMigrationsShelved(),
    ])
      .then(([s, d, r, sh]) => {
        if (cancelled) return
        setStreak(s); setDaily(d); setRange(r); setShelved(sh)
      })
      .catch(err => {
        toast(err instanceof Error ? err.message : '加载统计数据失败', 'error')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [toast])

  useEffect(() => {
    let cancelled = false
    todoStatsHeatmap(heatmapYear)
      .then(h => { if (!cancelled) setHeatmap(h) })
      .catch(() => { if (!cancelled) setHeatmap(null) })
    return () => { cancelled = true }
  }, [heatmapYear])

  const trendData = useMemo(
    () => (range?.days ?? []).map(d => ({ x: d.date.slice(5), xFull: d.date, a: d.created, b: d.completed })),
    [range]
  )

  const quadrantCompleted = daily
    ? [daily.quadrant_completed.q1, daily.quadrant_completed.q2, daily.quadrant_completed.q3, daily.quadrant_completed.q4]
    : [0, 0, 0, 0]
  const completedTotal = quadrantCompleted.reduce((a, b) => a + b, 0)

  const pieData = useMemo(
    () => (daily?.by_category ?? []).map(c => ({
      name: c.name, value: c.completed,
      color: dark ? adjustForDark(c.color || '#94a3b8') : (c.color || '#94a3b8'),
    })).filter(d => d.value > 0),
    [daily, dark]
  )

  const metrics = [
    { label: '当前连续', value: streak?.current ?? 0, unit: '天' },
    { label: '最长连续', value: streak?.best ?? 0, unit: '天' },
    { label: '累计活跃', value: streak?.total_active ?? 0, unit: '天' },
    { label: '今日完成', value: daily?.completed ?? 0, unit: '项', accent: true },
    { label: '当前搁置', value: shelved.length, unit: '项' },
  ]
  const summaryDate = daily?.date || todayStr()
  const dayLabel = <time className="todo-report-muted text-sm tabular-nums" dateTime={summaryDate}>{summaryDate.slice(5).replace('-', ' / ')}</time>
  const yearButton = 'inline-flex size-8 items-center justify-center rounded-md text-stone-600 hover:bg-stone-200/70 focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:cursor-default disabled:opacity-35 dark:text-stone-200 dark:hover:bg-white/10'

  if (loading) return <ReportPage title="任务统计"><Empty text="统计加载中…" /></ReportPage>

  return (
    <ReportPage title="任务统计" controls={
      <time dateTime={summaryDate} className="todo-report-muted text-[15px] tabular-nums">截至 {summaryDate}</time>
    }>
      <ReportMetrics items={metrics} />
      <ReportPanel title="完成热力图" controls={
        <div className="inline-flex items-center gap-1 rounded-lg border border-stone-200 p-0.5 dark:border-stone-700">
          <button type="button" aria-label="上一年" className={yearButton} onClick={() => setHeatmapYear(y => y - 1)}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4l-5 6 5 6"/></svg>
          </button>
          <span className="w-12 text-center text-base font-semibold tabular-nums">{heatmapYear}</span>
          <button type="button" aria-label="下一年" disabled={heatmapYear >= year} className={yearButton} onClick={() => setHeatmapYear(y => y + 1)}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 4l5 6-5 6"/></svg>
          </button>
        </div>
      }>
        <Heatmap key={heatmapYear} year={heatmapYear} days={heatmap?.year === heatmapYear ? heatmap.days : []} />
      </ReportPanel>

      <ReportPanel title="近 30 天趋势">
        <DualLine data={trendData} showScale height={210} a={{ label: '创建', color: '#9995a1' }} b={{ label: '完成', color: '#7064dc' }} />
      </ReportPanel>

      <div className="todo-report-columns items-stretch">
        <ReportPanel title="象限完成分布" controls={dayLabel}>
          {completedTotal === 0 ? <Empty text="今天还没有完成的任务" /> :
            QUADRANT_META.map((m, i) => (
              <Bar key={m.quadrant} dark={dark} label={`${m.short} ${labels(m.quadrant)}`}
                color={m.color} value={quadrantCompleted[i]} total={completedTotal} text={`${quadrantCompleted[i]} 项`} />
            ))}
        </ReportPanel>
        <ReportPanel title="类别完成占比" controls={dayLabel}>
          <DonutPie data={pieData} size={170} thickness={24} centerLabel="今日完成" centerValue={completedTotal} />
        </ReportPanel>
      </div>

      {shelved.length > 0 && (
        <ReportPanel title="搁置任务" controls={<span className="todo-report-muted text-[15px] tabular-nums">{shelved.length} 项</span>}>
          <ul className="divide-y divide-stone-200/75 dark:divide-stone-700/70">
            {shelved.map(t => (
              <li key={t.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <Dot color={t.category_color || '#94a3b8'} />
                <span className="min-w-0 text-base [overflow-wrap:anywhere]">{t.title}</span>
                <span className="todo-report-muted ml-auto shrink-0 text-sm tabular-nums whitespace-nowrap">
                  {t.original_date || '—'}{t.days_procrastinated != null ? ` · 延后 ${t.days_procrastinated} 天` : ''}
                </span>
              </li>
            ))}
          </ul>
        </ReportPanel>
      )}
    </ReportPage>
  )
}
