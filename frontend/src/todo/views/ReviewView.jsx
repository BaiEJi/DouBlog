/**
 * 日回顾使用选中日期的任务与统计，区间回顾独立选择起止日期。
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDataIdentity } from '@/shared/dataEpoch'

import { todoStatsDaily, todoStatsRange, todoTasks } from '../api'
import { GroupedBars } from '../charts'
import { Dot, quadrantMeta, hmOf, todayStr, startOfWeek, addDays, fmtDate } from '../kit'
import { ReportMetrics, ReportPage, ReportPanel } from './ReportLayout'

const filters = [
  { key: 'done', label: '完成' },
  { key: 'migrated', label: '迁入' },
]
const noTasks = []

function DateField({ label, value, onChange }) {
  return <input type="date" aria-label={label} className="todo-report-date" value={value}
    onChange={event => { if (event.target.value) onChange(event.target.value) }} />
}

function ActivityTable({ items, migrated }) {
  if (!items.length) {
    return <p className="todo-report-muted py-10 text-center text-base">{migrated ? '当天没有迁入任务' : '当天没有完成记录'}</p>
  }
  return (
    <table className="w-full table-fixed border-collapse text-left">
      <thead className="todo-report-muted border-b border-stone-200 text-sm dark:border-stone-700">
        <tr>
          <th scope="col" className={'pb-2.5 font-medium ' + (migrated ? 'w-[102px]' : 'w-[76px]')}>{migrated ? '迁自日期' : '完成时间'}</th>
          <th scope="col" className="pb-2.5 font-medium">任务</th>
          <th scope="col" className={'pb-2.5 text-right font-medium ' + (migrated ? 'w-[76px]' : 'w-[52px]')}>{migrated ? '迁移次数' : '象限'}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-stone-200/75 dark:divide-stone-700/70">
        {items.map(task => (
          <tr key={task.id}>
            <td className="todo-report-muted py-3 pr-2 text-sm tabular-nums whitespace-nowrap">{migrated ? task.last_migrated_from : hmOf(task.completed_at)}</td>
            <td className="py-3 pr-2 text-base leading-6 [overflow-wrap:anywhere]" title={task.completion_note || task.title}>
              {task.title}
              {task.plan_id && <span className="ml-2 inline-block rounded bg-stone-100 px-1.5 align-middle text-xs leading-5 text-stone-600 dark:bg-white/[0.07] dark:text-stone-300">生活打卡</span>}
            </td>
            <td className="todo-report-muted py-3 text-right text-sm tabular-nums whitespace-nowrap">
              {migrated ? `${task.migrated_count} 次` : (
                <span className="inline-flex items-center gap-1.5"><Dot color={quadrantMeta(task.quadrant).color} />Q{task.quadrant}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function ReviewView() {
  const [date, setDate] = useState(todayStr())
  const [from, setFrom] = useState(fmtDate(startOfWeek(new Date())))
  const [to, setTo] = useState(fmtDate(addDays(startOfWeek(new Date()), 6)))
  const [filter, setFilter] = useState('done')
  const identity = getDataIdentity()
  const dayQuery = useQuery({
    queryKey: ['todo-review-day', identity, date],
    queryFn: ({ signal }) => Promise.all([todoStatsDaily(date, { signal }), todoTasks({ date, status: 'all' }, { signal })]),
  })
  const rangeQuery = useQuery({
    queryKey: ['todo-review-range', identity, from, to],
    enabled: from <= to,
    queryFn: ({ signal }) => todoStatsRange(from, to, { signal }),
  })
  const [daily, tasks] = dayQuery.data ?? [null, noTasks]
  const loading = dayQuery.isPending
  const dayMessage = dayQuery.error?.message || (loading ? '加载中…' : '')
  const rangeStats = rangeQuery.data
  const rangeError = from > to ? '开始日期须早于或等于结束日期' : rangeQuery.error?.message

  const completed = useMemo(() => tasks.filter(t => t.status === 'done')
    .sort((a, b) => Date.parse(b.completed_at || b.created_at) - Date.parse(a.completed_at || a.created_at)), [tasks])
  const migrated = tasks.filter(t => t.last_migrated_from && t.original_date && t.original_date !== date)
  const groups = { done: completed, migrated }
  const rate = daily?.completion_rate
  const dailyMetrics = [
    { label: '当日创建', value: daily?.created, unit: '项' },
    { label: '当日完成', value: daily?.completed, unit: '项', accent: true },
    { label: '完成率', value: rate == null ? null : Math.round(rate <= 1 ? rate * 100 : rate), unit: '%' },
    { label: '当日迁入', value: daily?.migrated_in, unit: '项' },
  ]
  const chart = useMemo(() => (rangeStats?.days ?? []).map(d => ({
    x: d.date.slice(5), xFull: d.date, a: d.created, b: d.completed,
  })), [rangeStats])

  return (
    <ReportPage title="任务回顾" controls={
      <label className="todo-report-muted flex shrink-0 items-center gap-3 text-base">
        回顾日期<DateField label="回顾日期" value={date} onChange={setDate} />
      </label>
    }>
      <ReportMetrics items={dailyMetrics.map(item => ({ ...item, value: loading ? '—' : item.value ?? '—' }))} />
      <div className="todo-report-columns">
        <ReportPanel title="当日记录" controls={
          <div role="group" aria-label="记录类型" className="flex items-center gap-1 rounded-lg bg-stone-100 p-1 dark:bg-white/[0.07]">
            {filters.map(({ key, label }) => (
              <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}
                className={'rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-indigo-500 ' +
                  (filter === key ? 'bg-white text-indigo-700 shadow-sm dark:bg-stone-700 dark:text-indigo-200' : 'text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-white')}>
                {label}<span className="ml-1.5 tabular-nums">{loading ? '—' : groups[key].length}</span>
              </button>
            ))}
          </div>
        }>
          {dayMessage ? <p className="todo-report-muted py-10 text-center">{dayMessage}</p> : (
            <ActivityTable items={groups[filter]} migrated={filter === 'migrated'} />
          )}
        </ReportPanel>

        <ReportPanel title="区间回顾">
          <div className="mb-4 flex items-center gap-2">
            <DateField label="区间开始日期" value={from} onChange={setFrom} />
            <span className="todo-report-muted text-sm">至</span>
            <DateField label="区间结束日期" value={to} onChange={setTo} />
          </div>
          <ReportMetrics compact items={[
            { label: '总创建', value: rangeStats?.totals.created ?? '—', unit: '项' },
            { label: '总完成', value: rangeStats?.totals.completed ?? '—', unit: '项', accent: true },
            { label: '总迁入', value: rangeStats?.totals.migrated ?? '—', unit: '项' },
          ]} />
          <div className="mt-5 min-w-0">
            {rangeError || !rangeStats ? <p className="todo-report-muted py-10 text-center text-base">{rangeError || '加载中…'}</p> : (
              <GroupedBars data={chart} showScale height={202}
                a={{ label: '创建', color: '#9995a1' }} b={{ label: '完成', color: '#7064dc' }} />
            )}
          </div>
        </ReportPanel>
      </div>
    </ReportPage>
  )
}
