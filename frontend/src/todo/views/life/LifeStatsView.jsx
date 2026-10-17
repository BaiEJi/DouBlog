/**
 * 规律生活 · 统计（照搬 MyTodo LifeStatsPage 交互）：
 * 指标卡（当前/最佳连续、计划数、今日打卡、近 30 天完成率）
 * + 近 30 天趋势（安排 vs 完成双线）+ 计划完成情况进度条 + 类别完成占比环形图。
 */
import { useEffect, useMemo, useState } from 'react'

import { todoPlanReport, todoPlanToday, todoCategories } from '../../api'
import { DualLine, DonutPie } from '../../charts'
import { Card, Empty, StatTile, adjustForDark } from '../../kit'

export default function LifeStatsView({ toast, dark }) {
  const [report, setReport] = useState(null)
  const [today, setToday] = useState(null)
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([todoPlanReport(30), todoPlanToday()])
      .then(([r, t]) => {
        if (cancelled) return
        setReport(r); setToday(t)
      })
      .catch(err => {
        if (!cancelled) toast(err instanceof Error ? err.message : '加载统计数据失败', 'error')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [toast])

  useEffect(() => {
    todoCategories(true).then(setCategories).catch(() => {})
  }, [])

  const rows = report?.plans ?? []
  const currentStreak = rows.reduce((m, r) => Math.max(m, r.current_streak), 0)
  const bestStreak = rows.reduce((m, r) => Math.max(m, r.best_streak), 0)
  const todayDone = (today?.items ?? []).filter(i => i.task?.status === 'done').length
  const scheduledTotal = rows.reduce((s, r) => s + r.scheduled, 0)
  const completedTotal = rows.reduce((s, r) => s + r.completed, 0)
  const rate = scheduledTotal > 0 ? Math.round((completedTotal / scheduledTotal) * 100) : 0

  const trendData = useMemo(
    () => (report?.trend ?? []).map(d => ({ x: d.date.slice(5), xFull: d.date, a: d.scheduled, b: d.completed })),
    [report]
  )

  const catOf = id => categories.find(c => c.id === id)
  const pieData = useMemo(() => {
    const byCat = new Map()
    for (const r of rows) {
      const cat = catOf(r.plan?.category_id ?? null)
      const key = cat?.id ?? 'none'
      const prev = byCat.get(key)
      if (prev) prev.value += r.completed
      else byCat.set(key, {
        name: cat ? `${cat.icon ? `${cat.icon} ` : ''}${cat.name}` : '未分类',
        value: r.completed,
        color: dark ? adjustForDark(cat?.color || '#94a3b8') : (cat?.color || '#94a3b8'),
      })
    }
    return [...byCat.values()].filter(d => d.value > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, categories, dark])

  if (loading) return <Empty text="统计加载中…" />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-4 flex items-center">
          <div className="flex-1">
            <div className="text-[11px] text-stone-500 dark:text-stone-400 mb-1">🔥 当前连续</div>
            <div className="text-xl font-semibold tabular-nums">{currentStreak}<span className="text-xs font-normal text-stone-400 ml-1">天</span></div>
          </div>
          <div className="w-px h-10 bg-black/[0.06] dark:bg-white/[0.08] mx-3" />
          <div className="flex-1">
            <div className="text-[11px] text-stone-500 dark:text-stone-400 mb-1">🏆 最佳连续</div>
            <div className="text-xl font-semibold tabular-nums">{bestStreak}<span className="text-xs font-normal text-stone-400 ml-1">天</span></div>
          </div>
        </div>
        <StatTile title="📅 计划数" value={rows.length} suffix="个" />
        <StatTile title="✅ 今日打卡" value={todayDone} suffix="项" />
        <StatTile title="📈 近 30 天完成率" value={rate} suffix="%" />
      </div>

      <Card title="近 30 天趋势">
        <DualLine data={trendData}
          a={{ label: '安排', color: '#a8a29e' }}
          b={{ label: '完成', color: '#10b981' }} height={240} />
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card title="计划完成情况（近 30 天）">
          {rows.length === 0 ? (
            <Empty text="还没有计划" />
          ) : (
            rows.map(r => {
              const cat = catOf(r.plan?.category_id ?? null)
              const pct = r.rate != null ? Math.round(r.rate * 100) : 0
              const color = dark ? adjustForDark(cat?.color || '#6366f1') : (cat?.color || '#6366f1')
              return (
                <div key={r.plan?.id ?? r.title} className="mb-3.5 last:mb-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[12.5px] font-medium truncate" style={{ color: color }}>{r.plan?.title || r.title}</span>
                    <span className="text-[11.5px] text-stone-400 tabular-nums shrink-0 ml-2">{r.completed}/{r.scheduled}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              )
            })
          )}
        </Card>
        <Card title="类别完成占比（近 30 天）">
          <DonutPie data={pieData} centerLabel="30 天完成" centerValue={completedTotal} />
        </Card>
      </div>
    </div>
  )
}
