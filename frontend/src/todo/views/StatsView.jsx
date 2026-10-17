/**
 * 统计（照搬 MyTodo StatsPage 交互）：
 * streak 卡（当前/最长/累计活跃/今日完成/当前搁置）+ 年度完成热力图（CSS grid 方格，indigo 色阶）
 * + 近 30 天趋势（双线 SVG）+ 象限完成分布（进度条）+ 类别完成占比（环形 SVG）+ 搁置清单。
 */
import { useEffect, useMemo, useState } from 'react'

import { todoStatsStreak, todoStatsDaily, todoStatsRange, todoStatsHeatmap, todoMigrationsShelved } from '../api'
import { DualLine, DonutPie } from '../charts'
import {
  Card, Empty, StatTile, Dot,
  QUADRANT_META, addDays, fmtDate, todayStr, adjustForDark, useQuadrantText,
} from '../kit'

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
  const colTpl = `20px repeat(${cols}, minmax(0, 1fr))`

  return (
    <div className="w-full overflow-x-auto pb-1" style={{ '--gap': 'clamp(2px, 0.38vw, 4px)' }}>
      <div className="min-w-[680px]">
        {/* 月份标签 */}
        <div className="grid mb-1" style={{ gridTemplateColumns: colTpl, gap: 'var(--gap)' }}>
          {(() => {
            const marks = []
            let lastM = -1
            grid.forEach((col, ci) => {
              const first = col.find(Boolean)
              const m = first ? first.month : -1
              if (first && m !== lastM) { marks.push({ ci, m }); lastM = m }
            })
            return marks.map(({ ci, m }) => (
              <span key={m} className="text-[10px] text-stone-400 whitespace-nowrap"
                style={{ gridColumn: ci + 2 }}>{MONTHS[m]}</span>
            ))
          })()}
        </div>
        {/* 方格：周列 × 日行的整幅网格，随卡片宽度自适应撑满 */}
        <div className="grid" style={{ gridTemplateColumns: colTpl, gap: 'var(--gap)' }}>
          {['一', '', '三', '', '五', '', '日'].map((w, i) => (
            <span key={i} className="flex items-center justify-end pr-1 text-[9px] text-stone-400 dark:text-stone-500"
              style={{ gridColumn: 1, gridRow: i + 1 }}>{w}</span>
          ))}
          {grid.map((col, ci) =>
            col.map((cell, ri) => cell ? (
              <span key={cell.key}
                onMouseEnter={() => setHover({ ...cell, x: ci, y: ri })}
                onMouseLeave={() => setHover(null)}
                style={{ gridColumn: ci + 2, gridRow: ri + 1 }}
                className={'aspect-square rounded-[3px] transition-transform hover:scale-125 cursor-default ' + LEVELS[levelOf(cell.count)]} />
            ) : <span key={ri} className="aspect-square" style={{ gridColumn: ci + 2, gridRow: ri + 1 }} />)
          )}
        </div>
        {/* 图例 + 悬浮 */}
        <div className="flex items-center gap-1.5 mt-3 text-[11px] text-stone-400">
          <span>少</span>
          {LEVELS.map((l, i) => <span key={i} className={'w-[11px] h-[11px] rounded-[3px] ' + l} />)}
          <span>多</span>
          {hover && <span className="ml-3 text-stone-500 dark:text-stone-400 tabular-nums">{hover.key} · 完成 {hover.count} 项</span>}
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
    <div className="mb-3.5 last:mb-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12.5px] font-medium truncate" style={{ color: bg }}>{label}</span>
        <span className="text-[11.5px] text-stone-400 tabular-nums shrink-0 ml-2">{text}</span>
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

  if (loading) return <Empty text="统计加载中…" />

  return (
    <div className="h-full min-h-0 overflow-y-auto space-y-4">
      {/* 指标卡 */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-4 flex items-center">
          <div className="flex-1">
            <div className="text-[11px] text-stone-500 dark:text-stone-400 mb-1">🔥 当前连续</div>
            <div className="text-xl font-semibold tabular-nums">{streak?.current ?? 0}<span className="text-xs font-normal text-stone-400 ml-1">天</span></div>
          </div>
          <div className="w-px h-10 bg-black/[0.06] dark:bg-white/[0.08] mx-3" />
          <div className="flex-1">
            <div className="text-[11px] text-stone-500 dark:text-stone-400 mb-1">🏆 最长连续</div>
            <div className="text-xl font-semibold tabular-nums">{streak?.best ?? 0}<span className="text-xs font-normal text-stone-400 ml-1">天</span></div>
          </div>
        </div>
        <StatTile title="📅 累计活跃" value={streak?.total_active ?? 0} suffix="天" />
        <StatTile title="✅ 今日完成" value={daily?.completed ?? 0} suffix="项" />
        <StatTile title="📦 当前搁置" value={shelved.length} suffix="项" />
      </div>

      {/* 热力图 */}
      <Card title="完成热力图"
        extra={
          <div className="flex items-center gap-1">
            <button onClick={() => setHeatmapYear(y => y - 1)}
              className="w-8 h-8 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4l-5 6 5 6" /></svg>
            </button>
            <span className="text-sm font-medium tabular-nums w-12 text-center">{heatmapYear}</span>
            <button onClick={() => setHeatmapYear(y => Math.min(y + 1, year))}
              className="w-8 h-8 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4l5 6-5 6" /></svg>
            </button>
          </div>
        }>
        <Heatmap year={heatmapYear} days={heatmap?.days || []} />
      </Card>

      {/* 近 30 天趋势 */}
      <Card title="近 30 天趋势">
        <DualLine data={trendData}
          a={{ label: '创建', color: '#a8a29e' }}
          b={{ label: '完成', color: '#6366f1' }} height={240} />
      </Card>

      {/* 象限分布 + 类别占比 */}
      <div className="grid grid-cols-2 gap-4">
        <Card title={`象限完成分布（${daily?.date?.slice(5) || '今日'}）`}>
          {completedTotal === 0 ? (
            <Empty text="今天还没有完成的任务" />
          ) : (
            QUADRANT_META.map((m, i) => (
              <Bar key={m.quadrant} dark={dark}
                label={`${m.short} ${labels(m.quadrant)}`}
                color={m.color} value={quadrantCompleted[i]} total={completedTotal}
                text={`${quadrantCompleted[i]} 项`} />
            ))
          )}
        </Card>
        <Card title={`类别完成占比（${daily?.date?.slice(5) || '今日'}）`}>
          <DonutPie data={pieData} centerLabel="今日完成" centerValue={completedTotal} />
        </Card>
      </div>

      {/* 搁置任务 */}
      {shelved.length > 0 && (
        <Card title={`📦 搁置任务（${shelved.length}）`}>
          <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            {shelved.map(t => (
              <div key={t.id} className="flex items-center gap-2.5 py-2.5 text-sm">
                <Dot color={t.category_color || '#94a3b8'} />
                <span className="font-medium truncate">{t.title}</span>
                <span className="ml-auto text-[11px] text-stone-400 tabular-nums whitespace-nowrap shrink-0">
                  ⟲ 来自 {t.original_date || '?'}
                  {t.days_procrastinated != null ? ` · 拖延${t.days_procrastinated}天` : ''}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
