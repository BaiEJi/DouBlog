/**
 * 概览视图：指标卡 / 分类支出汇总表（可排序+合计）/ 即将到期提醒 /
 * 会员支出排行榜（4 维度）/ 订阅到期日历（农历 + 法定节假日 + 当日弹层）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Solar } from 'lunar-javascript'

import {
  subsStatsOverview, subsStatsCategorySummary, subsRemindersUpcoming, subsRemindersAll,
  subsMembers,
} from '../api'
import { fmtPrice, daysRemaining, fmtDuration, Icon, Modal, adjustForDark } from '../kit'
import { useHolidays } from '../useHolidays'

// ─── 指标卡 ───────────────────────────────────────────────

function StatCard({ label, value, prefix, hint, tone }) {
  return (
    <div className="p-5 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]">
      <div className="flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400 mb-1.5">
        {label}
        {hint && (
          <span title={hint} className="cursor-help">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.8.3-.9 1-.9 1.7M12 17v.1" strokeLinecap="round" /></svg>
          </span>
        )}
      </div>
      <div className={'text-xl font-semibold tabular-nums leading-none ' + (tone || '')}>
        {prefix}{value}
      </div>
    </div>
  )
}

// ─── 分类汇总表 ───────────────────────────────────────────

function CategorySummaryTable({ summary, sort, setSort }) {
  if (!summary) return null
  const rows = [...summary.categories]
  if (sort.key === 'monthly') rows.sort((a, b) => sort.asc ? a.monthly_spending - b.monthly_spending : b.monthly_spending - a.monthly_spending)
  else rows.sort((a, b) => sort.asc ? a.yearly_spending - b.yearly_spending : b.yearly_spending - a.yearly_spending)

  const Th = ({ k, children, align = 'right' }) => (
    <th className={'px-3 py-2 font-medium text-stone-400 ' + (align === 'right' ? 'text-right' : 'text-left')}>
      <button className="inline-flex items-center gap-0.5 hover:text-stone-600 dark:hover:text-stone-300"
        onClick={() => setSort(s => ({ key: k, asc: s.key === k ? !s.asc : false }))}>
        {children}
        <span className="text-[8px] opacity-70">{sort.key === k ? (sort.asc ? '▲' : '▼') : '⇅'}</span>
      </button>
    </th>
  )

  return (
    <div className="overflow-y-auto max-h-[248px] -mx-1">
      <table className="w-full text-sm tabular-nums">
        <thead className="sticky top-0 bg-white dark:bg-[#171615] z-10">
          <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
            <th className="px-3 py-2 font-medium text-stone-400 text-left">分类</th>
            <Th k="monthly">本月支出</Th>
            <Th k="yearly">年度支出</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(c => (
            <tr key={c.category_id} className="border-b border-black/[0.06] dark:border-white/[0.06]">
              <td className="px-3 py-2.5">
                <span className="mr-1.5">{c.category_icon || '📦'}</span>{c.category_name}
              </td>
              <td className="px-3 py-2.5 text-right">¥{c.monthly_spending.toFixed(2)}</td>
              <td className="px-3 py-2.5 text-right">¥{c.yearly_spending.toFixed(2)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={3} className="px-3 py-8 text-center text-stone-400">暂无分类支出</td></tr>
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot className="sticky bottom-0 bg-white dark:bg-[#171615]">
            <tr className="border-t border-black/[0.08] dark:border-white/[0.1]">
              <td className="px-3 py-2.5 font-medium">合计</td>
              <td className="px-3 py-2.5 text-right font-medium">¥{summary.total_monthly.toFixed(2)}</td>
              <td className="px-3 py-2.5 text-right font-medium">¥{summary.total_yearly.toFixed(2)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

// ─── 到期提醒列表 ─────────────────────────────────────────

function RemindersList({ reminders, loading, onGo }) {
  if (loading) return <div className="py-10 text-center text-xs text-stone-400">加载中…</div>
  if (!reminders.length) return <div className="py-10 text-center text-sm text-stone-400">暂无即将到期的订阅 🎉</div>
  return (
    <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
      {reminders.map(r => (
        <button key={r.subscription_id} onClick={() => onGo(r.member_id)}
          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors text-left">
          <span className="text-[20px] w-7 text-center shrink-0">{r.category_icon || '📦'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{r.member_name}</span>
              {r.level && <span className="px-1.5 h-5 rounded-full text-[11px] bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center">{r.level}</span>}
            </div>
            <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              {r.category_name && <span className="mr-2">{r.category_name}</span>}
              到期日期：{r.end_date}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm tabular-nums">{fmtPrice(r.price, r.currency)}</div>
            <div className={'mt-1 inline-flex px-2 h-5 rounded-full text-[11px] items-center tabular-nums ' +
              (r.days_remaining === 0
                ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                : 'bg-orange-500/10 text-orange-600 dark:text-orange-400')}>
              {r.days_remaining === 0 ? '今天到期' : `${r.days_remaining}天后到期`}
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}

// ─── 会员支出排行榜 ───────────────────────────────────────

const RANK_DIMS = [
  { key: 'total_spending', label: '累计花费' },
  { key: 'avg_per_sub', label: '平均订阅' },
  { key: 'subscription_count', label: '订阅次数' },
  { key: 'total_duration_days', label: '累计时长' },
]

function RankingCard({ dark, onGo }) {
  const [dim, setDim] = useState('total_spending')
  const [members, setMembers] = useState(null)

  const load = useCallback(() => {
    subsMembers({ page: 1, page_size: 1000 }).then(d => d.success && setMembers(d.data.items))
  }, [])
  useEffect(load, [load])

  const ranked = useMemo(() => {
    if (!members) return []
    const withAvg = members.map(m => ({ ...m, avg_per_sub: m.subscription_count ? m.total_spending / m.subscription_count : 0 }))
    withAvg.sort((a, b) => (b[dim] || 0) - (a[dim] || 0))
    return withAvg.slice(0, 10)
  }, [members, dim])

  const maxVal = ranked.length ? Math.max(...ranked.map(m => m[dim] || 0)) || 1 : 1

  const fmtVal = m => dim === 'subscription_count' ? `${m.subscription_count} 次`
    : dim === 'total_duration_days' ? fmtDuration(m.total_duration_days || 0)
    : dim === 'avg_per_sub' ? fmtPrice(m.avg_per_sub)
    : fmtPrice(m.total_spending)

  const barColor = rank => dark
    ? adjustForDark(['#dc2626', '#ea580c', '#f59e0b', '#0284c7', '#16a34a'][rank <= 3 ? rank - 1 : rank <= 5 ? 3 : 4])
    : ['#dc2626', '#ea580c', '#f59e0b', '#0284c7', '#16a34a'][rank <= 3 ? rank - 1 : rank <= 5 ? 3 : 4]

  return (
    <div className="p-5 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold">{Icon.stats} 会员支出排行榜</div>
        <button onClick={load} className="w-8 h-8 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center">{Icon.refresh}</button>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {RANK_DIMS.map(d => (
          <button key={d.key} onClick={() => setDim(d.key)}
            className={'px-2.5 h-7 rounded-full text-xs border transition-colors ' +
              (dim === d.key
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-400'
                : 'bg-black/[0.03] dark:bg-white/[0.05] border-black/[0.06] dark:border-white/[0.08] text-stone-500 hover:border-black/15 dark:hover:border-white/20')}>
            {d.label}
          </button>
        ))}
      </div>
      {!members ? (
        <div className="py-8 text-center text-xs text-stone-400">加载中…</div>
      ) : !ranked.length ? (
        <div className="py-8 text-center text-sm text-stone-400">暂无会员数据</div>
      ) : (
        <div className="flex flex-col">
          {ranked.map((m, i) => {
            const rank = i + 1
            const pct = ((m[dim] || 0) / maxVal) * 100
            return (
              <button key={m.id} onClick={() => onGo(m.id)}
                className={'flex items-center gap-2.5 py-2 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors rounded-lg ' +
                  (rank < ranked.length ? 'border-b border-black/[0.06] dark:border-white/[0.06]' : '')}>
                <div className="w-6 text-center shrink-0">
                  {rank <= 3
                    ? <span style={{ color: ['#d4a017', '#94a3b8', '#b97d4f'][rank - 1] }}>{Icon.trophy}</span>
                    : <span className="text-xs text-stone-400 tabular-nums">{rank}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={'text-sm truncate ' + (rank <= 3 ? 'font-semibold' : '')}>{m.name}</span>
                    {m.category && (
                      <span className="text-[11px] px-1.5 h-4.5 rounded-full border flex items-center whitespace-nowrap"
                        style={{
                          color: dark ? adjustForDark(m.category.color) : (m.category.color || '#d97706'),
                          borderColor: (dark ? adjustForDark(m.category.color) : (m.category.color || '#d97706')) + '55',
                        }}>
                        {m.category.icon} {m.category.name}
                      </span>
                    )}
                    {rank <= 3 && (dim === 'total_spending' || dim === 'total_duration_days') && (
                      <span className="text-red-500 shrink-0">{Icon.fire}</span>
                    )}
                  </div>
                  <div className="h-1.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor(rank) }} />
                  </div>
                </div>
                <div className="w-[92px] text-right text-sm font-medium tabular-nums shrink-0" style={{ color: barColor(rank) }}>
                  {fmtVal(m)}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── 到期日历（农历 + 节假日）─────────────────────────────

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const LUNAR_RED = ['春节', '元宵', '端午', '七夕', '中秋', '重阳', '冬至', '腊八', '除夕', '清明']

function lunarText(dateStr) {
  try {
    const [y, m, d] = dateStr.split('-').map(Number)
    const lunar = Solar.fromYmd(y, m, d).getLunar()
    const festivals = [...lunar.getFestivals(), ...lunar.getOtherFestivals()]
    if (festivals.length) return festivals[0]
    if (d === 1) return lunar.getMonthInChinese() + '月'
    return lunar.getDayInChinese()
  } catch {
    return ''
  }
}

function ExpiryCalendar({ dark, onGo, onRefresh }) {
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [items, setItems] = useState(null)
  const [selected, setSelected] = useState(null)
  const { getDayInfo } = useHolidays(ym.y)

  const load = useCallback(() => {
    subsRemindersAll().then(d => d.success && setItems(d.data.reminders))
  }, [])
  useEffect(load, [load])

  const byDate = useMemo(() => {
    const map = {}
    for (const it of items || []) (map[it.end_date] ||= []).push(it)
    return map
  }, [items])

  const days = useMemo(() => {
    const first = new Date(ym.y, ym.m, 1)
    const n = new Date(ym.y, ym.m + 1, 0).getDate()
    const lead = (first.getDay() + 6) % 7   // 周一开头
    const cells = Array.from({ length: lead }, (_, i) => null)
    for (let d = 1; d <= n; d++) {
      cells.push(`${ym.y}-${String(ym.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    }
    return cells
  }, [ym])

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const badgeColor = list => {
    if (!list?.length) return null
    const soon = list.some(i => i.days_remaining >= 0 && i.days_remaining <= 7)
    return soon ? '#f59e0b' : '#10b981'
  }

  const cell = (dateStr, i) => {
    if (!dateStr) return <div key={'e' + i} className="h-[72px]" />
    const list = byDate[dateStr]
    const isToday = dateStr === todayStr
    const info = getDayInfo(dateStr)
    const lt = lunarText(dateStr)
    const lunarRed = LUNAR_RED.some(f => lt.includes(f)) || (lt.includes('月') && lt.length <= 3)
    const bc = badgeColor(list)
    const holidayLabel = info.holidayName ? (info.isHoliday ? info.holidayName : '补班') : null

    const bg = isToday ? 'bg-emerald-500/[0.07] border-emerald-500/50 border-[1.5px]'
      : info.isHoliday ? 'bg-red-500/[0.05] border-red-500/20'
      : info.isRestDay ? 'bg-sky-500/[0.05] border-sky-500/20'
      : 'border border-black/[0.05] dark:border-white/[0.06]'
    const dateColor = isToday ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
      : info.isHoliday ? 'text-red-600 dark:text-red-400'
      : info.isRestDay ? 'text-sky-600 dark:text-sky-400'
      : 'text-stone-700 dark:text-stone-200'

    return (
      <button key={dateStr}
        onClick={() => list?.length && setSelected(dateStr)}
        className={'relative h-[72px] rounded-lg flex flex-col items-center justify-center gap-0.5 transition-colors ' + bg +
          (list?.length ? ' cursor-pointer hover:brightness-95 dark:hover:brightness-125' : ' cursor-default')}>
        <span className={'text-[12px] tabular-nums leading-4 ' + dateColor}>{Number(dateStr.slice(8))}</span>
        {holidayLabel ? (
          <span className={'text-[9px] leading-3 max-w-full px-0.5 truncate ' +
            (info.isHoliday ? 'text-red-600 dark:text-red-400' : 'text-orange-500')}>
            {holidayLabel}
          </span>
        ) : lt && (
          <span className={'text-[9px] leading-3 max-w-full px-0.5 truncate ' +
            (lunarRed ? 'text-red-500/90' : 'text-stone-400/80')} title={lt}>{lt}</span>
        )}
        {bc && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full text-[9.5px] text-white flex items-center justify-center tabular-nums"
            style={{ background: bc }}>{list.length}</span>
        )}
      </button>
    )
  }

  return (
    <div className="p-5 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold">{Icon.calendar} 订阅到期日历</div>
        <div className="flex items-center gap-1.5">
          <button className="w-8 h-8 rounded-lg border border-black/[0.07] dark:border-white/[0.1] hover:bg-black/[0.03] dark:hover:bg-white/[0.05] flex items-center justify-center"
            onClick={() => setYm(({ y, m }) => m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 })}>{Icon.arrowL}</button>
          <button className="px-2 h-8 rounded-lg text-xs hover:bg-black/[0.03] dark:hover:bg-white/[0.05]" onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}>今天</button>
          <button className="w-8 h-8 rounded-lg border border-black/[0.07] dark:border-white/[0.1] hover:bg-black/[0.03] dark:hover:bg-white/[0.05] flex items-center justify-center"
            onClick={() => setYm(({ y, m }) => m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 })}>{Icon.arrowR}</button>
          <button className="w-8 h-8 rounded-lg text-stone-400 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] flex items-center justify-center"
            onClick={() => { load(); onRefresh?.() }}>{Icon.refresh}</button>
        </div>
      </div>

      <div className="text-center text-sm font-semibold tabular-nums mb-2.5">{ym.y} 年 {ym.m + 1} 月</div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((wd, i) => (
          <div key={wd} className={'text-center text-[11px] py-1 ' + (i >= 5 ? 'text-sky-500' : 'text-stone-400')}>{wd}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map(cell)}
      </div>
      <div className="flex gap-4 justify-center mt-3 text-[11.5px] text-stone-400">
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-red-500/[0.12] border border-red-500/25 inline-block" />节假日</span>
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-sky-500/[0.12] border border-sky-500/25 inline-block" />休息日</span>
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.1] inline-block" />工作日</span>
      </div>

      <Modal open={!!selected} onClose={() => setSelected(null)}
        title={`${selected || ''} 到期的订阅`}>
        <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
          {(byDate[selected] || []).map(it => (
            <button key={it.subscription_id} onClick={() => onGo(it.member_id)}
              className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.03] rounded-lg">
              <span className="text-[20px] w-7 text-center">{it.category_icon || '📦'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{it.member_name}</span>
                  {it.level && <span className="px-1.5 h-5 rounded-full text-[11px] bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center">{it.level}</span>}
                </div>
                <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{it.category_name} · {fmtPrice(it.price, it.currency)}</div>
              </div>
              <span className="text-[11px] text-stone-400 shrink-0">
                {daysRemaining(it.end_date) === 0 ? '当日到期' : it.days_remaining <= 7 ? '即将到期' : '未到期'}
              </span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  )
}

// ─── 概览主视图 ───────────────────────────────────────────

export default function OverviewView({ dark }) {
  const navigate = useNavigate()
  const [overview, setOverview] = useState(null)
  const [summary, setSummary] = useState(null)
  const [reminders, setReminders] = useState(null)
  const [sort, setSort] = useState({ key: 'monthly', asc: false })
  const [stamp, setStamp] = useState(0)

  const load = useCallback(() => {
    subsStatsOverview().then(d => d.success && setOverview(d.data))
    subsStatsCategorySummary().then(d => d.success && setSummary(d.data))
    subsRemindersUpcoming().then(d => d.success && setReminders(d.data.reminders))
  }, [])
  useEffect(load, [load, stamp])

  const go = id => navigate(`/subs/members/${id}`)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">概览</h2>
        <button className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors"
          onClick={() => setStamp(s => s + 1)}>
          {Icon.refresh} 刷新
        </button>
      </div>

      {/* 指标卡 + 分类汇总 */}
      <div className="flex flex-col xl:flex-row gap-4">
        <div className="grid grid-cols-2 gap-3 flex-1">
          <StatCard label="会员总数" value={overview?.total_members ?? '—'} />
          <StatCard label="活跃会员" value={overview?.active_members ?? '—'}
            tone="text-emerald-600 dark:text-emerald-400" />
          <StatCard label="本月支出" value={overview ? overview.monthly_spending.toFixed(2) : '—'} prefix="¥"
            hint="按日均价格 × 本月覆盖天数计算（整月）"
            tone="text-red-600 dark:text-red-400" />
          <StatCard label="年度支出" value={overview ? overview.yearly_spending.toFixed(2) : '—'} prefix="¥"
            hint="按日均价格 × 本年覆盖天数计算（整年）"
            tone="text-violet-600 dark:text-violet-400" />
        </div>
        <div className="p-5 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] xl:w-[420px]">
          <div className="text-sm font-semibold mb-2">分类支出汇总</div>
          <CategorySummaryTable summary={summary} sort={sort} setSort={setSort} />
        </div>
      </div>

      {/* 即将到期提醒 */}
      <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] overflow-hidden">
        <div className="flex items-center gap-2 px-4 h-11 border-b border-black/[0.05] dark:border-white/[0.06] text-sm font-semibold">
          <span className="text-amber-500">{Icon.warning}</span> 即将到期提醒
        </div>
        <RemindersList reminders={reminders || []} loading={reminders === null} onGo={go} />
      </div>

      {/* 排行榜 + 日历 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RankingCard dark={dark} onGo={go} />
        <ExpiryCalendar dark={dark} onGo={go} onRefresh={() => setStamp(s => s + 1)} />
      </div>
    </div>
  )
}
