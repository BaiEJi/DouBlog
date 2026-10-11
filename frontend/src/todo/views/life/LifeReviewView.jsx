/**
 * 规律生活 · 回顾（照搬 MyTodo LifeReviewPage 交互）：
 * 日打卡回顾（plans/today?date：安排/完成/完成率/错过 + 完成清单 + 待打卡/错过清单）
 * + 趋势回顾（plans/report?days=7|30：总安排/总完成/完成率 + 分组柱图）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { todoPlanToday, todoPlanReport, todoCategories } from '../../api'
import { GroupedBars } from '../../charts'
import { Card, Empty, StatTile, Segmented, inputCls, hmOf, Dot, adjustForDark, todayStr } from '../../kit'

export default function LifeReviewView({ toast, dark }) {
  const [date, setDate] = useState(todayStr())
  const [days, setDays] = useState(30)
  const [dayData, setDayData] = useState(null)
  const [report, setReport] = useState(null)
  const [categories, setCategories] = useState([])

  const loadDay = useCallback(async () => {
    try {
      setDayData(await todoPlanToday(date))
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载打卡数据失败', 'error')
    }
  }, [date, toast])

  useEffect(() => {
    loadDay()
    todoPlanReport(days).then(setReport).catch(() => setReport(null))
  }, [loadDay, days])

  useEffect(() => {
    todoCategories(true).then(setCategories).catch(() => {})
  }, [])

  const items = dayData?.items ?? []
  const doneList = items.filter(i => i.task?.status === 'done')
  const missedList = items.filter(i => date < todayStr() && i.task?.status !== 'done')
  const pendingList = items.filter(i => i.task?.status !== 'done')
  const rateText = items.length === 0 ? '—' : `${Math.round((doneList.length / items.length) * 100)}%`
  const isToday = date === todayStr()
  const catOf = id => categories.find(c => c.id === id)
  const catColor = id => {
    const c = catOf(id)?.color || '#94a3b8'
    return dark ? adjustForDark(c) : c
  }

  const trendData = useMemo(
    () => (report?.trend ?? []).map(d => ({ x: d.date.slice(5), xFull: d.date, a: d.scheduled, b: d.completed })),
    [report]
  )
  const totals = useMemo(
    () => (report?.trend ?? []).reduce(
      (acc, d) => ({ scheduled: acc.scheduled + d.scheduled, completed: acc.completed + d.completed }),
      { scheduled: 0, completed: 0 }
    ),
    [report]
  )

  return (
    <div className="space-y-4 max-w-[1100px]">
      {/* 日打卡回顾 */}
      <Card title="日打卡回顾"
        extra={<input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} className={inputCls + ' w-auto'} />}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile title="安排" value={items.length} suffix="项" />
          <StatTile title="完成" value={doneList.length} suffix="项" />
          <StatTile title="完成率" value={rateText} />
          <StatTile title="错过" value={missedList.length} suffix="项" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          <div>
            <div className="text-sm font-semibold mb-3">当日完成（{doneList.length}）</div>
            {doneList.length === 0 ? (
              <Empty text="这一天还没有打卡记录" />
            ) : (
              <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06] rounded-xl border border-black/[0.06] dark:border-white/[0.07]">
                {doneList.map(({ plan, task, title }) => (
                  <div key={task?.id ?? title} className="flex items-center gap-2.5 px-3 py-2.5 text-sm flex-wrap">
                    <span className="text-[11.5px] text-stone-400 tabular-nums w-10 shrink-0">{hmOf(task?.completed_at)}</span>
                    <Dot color={catColor(plan?.category_id)} />
                    <span className="line-through text-stone-500 dark:text-stone-400 truncate">{plan?.title || title}</span>
                    {task?.completion_note && (
                      <span className="text-[11px] text-stone-400 truncate max-w-[180px]">📝 {task.completion_note}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="text-sm font-semibold mb-3">{isToday ? '今日待打卡' : `错过（${missedList.length}）`}</div>
            {pendingList.length === 0 ? (
              <Empty text={isToday ? '今天已全部完成 🎉' : '没有错过的安排'} />
            ) : (
              <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06] rounded-xl border border-black/[0.06] dark:border-white/[0.07]">
                {pendingList.map(it => (
                  <div key={it.task?.id ?? it.title} className="flex items-center gap-2.5 px-3 py-2.5 text-sm">
                    <Dot color={catColor(it.plan?.category_id)} />
                    <span className="truncate">{it.plan?.title || it.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* 趋势回顾 */}
      <Card title="趋势回顾"
        extra={<Segmented value={days} onChange={setDays} options={[{ label: '近 7 天', value: 7 }, { label: '近 30 天', value: 30 }]} />}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6 items-start">
          <div className="flex flex-col gap-3">
            <StatTile title="总安排" value={totals.scheduled} suffix="项" />
            <StatTile title="总完成" value={totals.completed} suffix="项" />
            <StatTile title="完成率" value={totals.scheduled ? `${Math.round((totals.completed / totals.scheduled) * 100)}%` : '—'} />
          </div>
          <div className="md:col-span-3">
            <GroupedBars data={trendData}
              a={{ label: '安排', color: '#a8a29e' }}
              b={{ label: '完成', color: '#6366f1' }} />
          </div>
        </div>
      </Card>
    </div>
  )
}
