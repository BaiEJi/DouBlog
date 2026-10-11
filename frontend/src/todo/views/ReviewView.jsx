/**
 * 回顾（照搬 MyTodo ReviewPage 交互）：
 * 日回顾（stats/daily + 当日任务 status=all：创建/完成/完成率/迁入 + 完成清单 + 迁入清单）
 * + 区间回顾（stats/range：总创建/总完成/总迁入 + 创建 vs 完成分组柱图）。
 */
import { useEffect, useMemo, useState } from 'react'

import { todoStatsDaily, todoStatsRange, todoTasks } from '../api'
import { GroupedBars } from '../charts'
import { Card, Empty, StatTile, inputCls, hmOf, Dot, quadrantMeta, todayStr, startOfWeek, addDays, fmtDate } from '../kit'

const dateInput = inputCls + ' w-auto'

export default function ReviewView({ toast }) {
  const [date, setDate] = useState(todayStr())
  const [from, setFrom] = useState(fmtDate(startOfWeek(new Date())))
  const [to, setTo] = useState(fmtDate(addDays(startOfWeek(new Date()), 6)))
  const [daily, setDaily] = useState(null)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [rangeStats, setRangeStats] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([todoStatsDaily(date), todoTasks({ date, status: 'all' })])
      .then(([d, ts]) => {
        if (cancelled) return
        setDaily(d)
        setTasks(ts)
      })
      .catch(err => {
        toast(err instanceof Error ? err.message : '加载回顾数据失败', 'error')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date, toast])

  useEffect(() => {
    if (!from || !to) { setRangeStats(null); return }
    let cancelled = false
    todoStatsRange(from, to)
      .then(r => { if (!cancelled) setRangeStats(r) })
      .catch(() => { if (!cancelled) setRangeStats(null) })
    return () => { cancelled = true }
  }, [from, to])

  const completedList = tasks.filter(t => t.status === 'done')
  const migratedList = tasks.filter(
    t => t.last_migrated_from != null && t.original_date != null && t.original_date !== date
  )
  const rateText = daily?.completion_rate == null
    ? '—'
    : `${Math.round(daily.completion_rate <= 1 ? daily.completion_rate * 100 : daily.completion_rate)}%`

  const weekData = useMemo(
    () => (rangeStats?.days ?? []).map(d => ({ x: d.date.slice(5), xFull: d.date, a: d.created, b: d.completed })),
    [rangeStats]
  )

  return (
    <div className="space-y-4 max-w-[1100px]">
      {/* 日回顾 */}
      <Card title="日回顾" extra={<input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} className={dateInput} />}>
        {loading ? (
          <Empty text="加载中…" />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile title="创建" value={daily?.created ?? 0} suffix="项" />
              <StatTile title="完成" value={daily?.completed ?? 0} suffix="项" />
              <StatTile title="完成率" value={rateText} />
              <StatTile title="迁入" value={daily?.migrated_in ?? 0} suffix="项" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
              <div>
                <div className="text-sm font-semibold mb-3">当日完成（{completedList.length}）</div>
                {completedList.length === 0 ? (
                  <Empty text="这一天还没有记录" />
                ) : (
                  <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06] rounded-xl border border-black/[0.06] dark:border-white/[0.07]">
                    {completedList.map(t => (
                      <div key={t.id} className="flex items-center gap-2.5 px-3 py-2.5 text-sm">
                        <span className="text-[11.5px] text-stone-400 tabular-nums w-10 shrink-0">{hmOf(t.completed_at)}</span>
                        <Dot color={quadrantMeta(t.quadrant).color} />
                        <span className="line-through text-stone-500 dark:text-stone-400 truncate">{t.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="text-sm font-semibold mb-3">当日迁入（{migratedList.length}）</div>
                {migratedList.length === 0 ? (
                  <Empty text="没有迁入的任务" />
                ) : (
                  <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06] rounded-xl border border-black/[0.06] dark:border-white/[0.07]">
                    {migratedList.map(t => (
                      <div key={t.id} className="flex items-center gap-2.5 px-3 py-2.5 text-sm">
                        <span className="inline-flex items-center rounded-md px-2 h-5 text-[10.5px] bg-orange-500/10 text-orange-700 dark:text-orange-300 tabular-nums shrink-0">
                          ⟲ {t.last_migrated_from} · 迁移×{t.migrated_count}
                        </span>
                        <span className="truncate">{t.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </Card>

      {/* 区间回顾 */}
      <Card title="区间回顾"
        extra={
          <div className="flex items-center gap-1.5">
            <input type="date" value={from} onChange={e => e.target.value && setFrom(e.target.value)} className={dateInput} />
            <span className="text-stone-400 text-xs">–</span>
            <input type="date" value={to} onChange={e => e.target.value && setTo(e.target.value)} className={dateInput} />
          </div>
        }>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6 items-start">
          <div className="flex flex-col gap-3">
            <StatTile title="总创建" value={rangeStats?.totals.created ?? 0} suffix="项" />
            <StatTile title="总完成" value={rangeStats?.totals.completed ?? 0} suffix="项" />
            <StatTile title="总迁入" value={rangeStats?.totals.migrated ?? 0} suffix="项" />
          </div>
          <div className="md:col-span-3">
            <GroupedBars data={weekData}
              a={{ label: '创建', color: '#a8a29e' }}
              b={{ label: '完成', color: '#6366f1' }} />
          </div>
        </div>
      </Card>
    </div>
  )
}
