/**
 * 概览视图：指标卡 / 分类支出汇总表（可排序+合计）/ 即将到期提醒 /
 * 会员支出排行榜（4 维度）/ 订阅到期日历（农历 + 法定节假日 + 当日弹层）。
 */
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDataIdentity } from '@/shared/dataEpoch'
const ExpiryCalendar = lazy(() => import('./ExpiryCalendar'))

import {
  subsStatsOverview, subsStatsCategorySummary, subsRemindersUpcoming,
  subsStatsRanking,
} from '../api'
import { fmtPrice, fmtDuration, Icon, adjustForDark } from '../kit'
import './overview.css'


const money = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const counts = new Intl.NumberFormat('zh-CN')
const REMINDER_PREVIEW = 6

function Metric({ label, value, currency, hint }) {
  const formatted = value == null ? '—' : (currency ? money : counts).format(value)
  return (
    <div className="subs-metric" style={{ '--metric-chars': formatted.length + 1 }}>
      <dt>
        {label}
        {hint && <span title={hint} aria-label={hint} tabIndex={0} className="cursor-help">ⓘ</span>}
      </dt>
      <dd>
        {currency && value != null && <small>¥</small>}
        {formatted}
        {!currency && value != null && <small className="subs-metric-count">个</small>}
      </dd>
    </div>
  )
}

function SpendingHeader({ label, column, sort, onSort }) {
  const active = sort.key === column
  return (
    <th scope="col" aria-sort={active ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(column)}>
        {label}<span aria-hidden="true">{active ? (sort.asc ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  )
}

function CategorySummaryTable({ summary, sort, setSort, dark }) {
  if (!summary) return <p className="subs-overview-empty">加载中…</p>
  if (!summary.categories.length) return <p className="subs-overview-empty">暂无分类支出</p>
  const monthly = sort.key === 'monthly'
  const field = monthly ? 'monthly_spending' : 'yearly_spending'
  const period = monthly ? '本月' : '年度'
  const total = monthly ? summary.total_monthly : summary.total_yearly
  const rows = [...summary.categories].sort((a, b) => (sort.asc ? 1 : -1) * (a[field] - b[field]))
  const contributors = rows.filter(c => c[field] > 0)
  const changeSort = key => setSort(current => ({ key, asc: current.key === key && !current.asc }))
  const colorOf = category => {
    const color = category.category_color || '#a8a29e'
    return dark ? adjustForDark(color) : color
  }

  return (
    <>
      {total > 0 && contributors.length > 0 && (
        <figure className="subs-composition">
          <figcaption><span>{period}支出占比</span><span>{rows.length} 个分类</span></figcaption>
          <div className="subs-share">
            {contributors.map(c => {
              const share = c.category_name + ' · ' + (c[field] / total * 100).toFixed(1) + '%'
              return (
                <span key={c.category_id ?? 'unassigned'} title={share}
                  style={{ flexGrow: c[field], '--category-color': colorOf(c) }}>
                  <span className="sr-only">{share} </span>
                </span>
              )
            })}
          </div>
        </figure>
      )}
      <div className="subs-table-scroll">
        <table className="subs-spend-table" aria-label="分类支出明细">
          <colgroup><col className="w-[42%]" /><col /><col /></colgroup>
          <thead><tr>
            <th scope="col">分类</th>
            <SpendingHeader label="本月支出" column="monthly" sort={sort} onSort={changeSort} />
            <SpendingHeader label="年度支出" column="yearly" sort={sort} onSort={changeSort} />
          </tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.category_id ?? 'unassigned'}>
                <td><span className="subs-category">
                  <span className="subs-category-mark" aria-hidden="true" style={{ '--category-color': colorOf(c) }}>{c.category_icon || '•'}</span>
                  <span className="subs-category-name" title={c.category_name}>{c.category_name}</span>
                </span></td>
                <td className="money">¥{money.format(c.monthly_spending)}</td>
                <td className="money">¥{money.format(c.yearly_spending)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <th scope="row">合计</th>
            <td className="money">¥{money.format(summary.total_monthly)}</td>
            <td className="money">¥{money.format(summary.total_yearly)}</td>
          </tr></tfoot>
        </table>
      </div>
    </>
  )
}

function RemindersPanel({ reminders, onGo }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? reminders : reminders?.slice(0, REMINDER_PREVIEW)
  return (
    <section className="subs-overview-panel" aria-labelledby="subs-reminder-title">
      <header className="subs-panel-head">
        <h2 id="subs-reminder-title">即将到期提醒</h2>
        {reminders && <span className="subs-panel-meta">{reminders.length} 项</span>}
      </header>
      {!reminders ? <p className="subs-overview-empty">加载中…</p> : !reminders.length ? (
        <p className="subs-overview-empty">暂无即将到期的订阅</p>
      ) : (
        <>
          <ul id="subs-upcoming-list">
            {visible.map(r => (
              <li key={r.subscription_id}>
                <button type="button" className="subs-reminder" onClick={() => onGo(r.member_id)}>
                  <time dateTime={r.end_date} title={r.end_date} aria-label={r.end_date}
                    className={'subs-reminder-date' + (r.days_remaining === 0 ? ' is-today' : '')}>
                    <small>{Number(r.end_date.slice(5, 7))}月</small><b>{r.end_date.slice(8, 10)}</b>
                  </time>
                  <span className="min-w-0">
                    <strong className="truncate" title={r.member_name}>{r.member_name}</strong>
                    <span className="subs-reminder-detail truncate">{[r.category_name, r.level].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="subs-reminder-end">
                    <strong title={r.currency}>{fmtPrice(r.price, r.currency)}</strong>
                    <span className={'subs-reminder-due' + (r.days_remaining <= 1 ? ' is-soon' : '')}>
                      {r.days_remaining === 0 ? '今天到期' : r.days_remaining === 1 ? '明天到期' : r.days_remaining + ' 天后到期'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {reminders.length > REMINDER_PREVIEW && (
            <button type="button" className="subs-reminder-more" aria-expanded={expanded} aria-controls="subs-upcoming-list"
              onClick={() => setExpanded(value => !value)}>
              {expanded ? '收起提醒' : '展开其余 ' + (reminders.length - REMINDER_PREVIEW) + ' 项'}
              <span aria-hidden="true" className={expanded ? '-rotate-90' : 'rotate-90'}>{Icon.arrowR}</span>
            </button>
          )}
        </>
      )}
    </section>
  )
}

// ─── 会员支出排行榜 ───────────────────────────────────────

const RANK_DIMS = [
  { key: 'total_spending', label: '累计花费' },
  { key: 'avg_per_sub', label: '平均订阅' },
  { key: 'subscription_count', label: '订阅次数' },
  { key: 'total_duration_days', label: '累计时长' },
]

function RankingCard({ onGo }) {
  const [dim, setDim] = useState('total_spending')
  const ranking = useQuery({
    queryKey: ['subs-ranking', getDataIdentity(), dim],
    queryFn: async ({ signal }) => {
      const response = await subsStatsRanking(dim, { signal })
      if (!response.success) throw new Error(response.message || '排行加载失败')
      return response.data.items
    },
  })
  const members = ranking.data
  const load = () => ranking.refetch()

  const ranked = members || []

  const maxVal = ranked.length ? Math.max(...ranked.map(m => m[dim] || 0)) || 1 : 1

  const fmtVal = m => dim === 'subscription_count' ? `${m.subscription_count} 次`
    : dim === 'total_duration_days' ? fmtDuration(m.total_duration_days || 0)
    : '¥' + money.format(dim === 'avg_per_sub' ? m.avg_per_sub : m.total_spending)

  return (
    <section className="subs-overview-panel" aria-labelledby="subs-ranking-title">
      <header className="subs-panel-head">
        <h2 id="subs-ranking-title">会员支出排行榜</h2>
        <button type="button" onClick={load} aria-label="刷新会员排行" title="刷新会员排行" className="subs-overview-refresh">{Icon.refresh}</button>
      </header>
      <div className="subs-rank-tabs" role="group" aria-label="排行指标">
        {RANK_DIMS.map(d => (
          <button type="button" key={d.key} aria-pressed={dim === d.key} onClick={() => setDim(d.key)}>{d.label}</button>
        ))}
      </div>
      {ranking.error ? <div role="alert" className="py-4 text-sm text-red-600 dark:text-red-400">{ranking.error.message}</div> : !members ? (
        <p className="subs-overview-empty">加载中…</p>
      ) : !ranked.length ? (
        <p className="subs-overview-empty">暂无会员数据</p>
      ) : (
        <ol>
          {ranked.map((m, index) => (
            <li key={m.id}>
              <button type="button" className="subs-rank-row" onClick={() => onGo(m.id)}>
                <span className={'subs-rank-number' + (index < 3 ? ' is-leading' : '')}>{index + 1}</span>
                <span className="min-w-0">
                  <span className="subs-rank-label">
                    <strong className="truncate" title={m.name}>{m.name}</strong>
                    {m.category && <small className="truncate" title={m.category.name}>{m.category.name}</small>}
                  </span>
                  <span aria-hidden="true" className="subs-rank-track">
                    <span style={{ width: ((m[dim] || 0) / maxVal * 100) + '%' }} />
                  </span>
                </span>
                <span className="subs-rank-value">{fmtVal(m)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}


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
    <div className="subs-overview">
      <div className="subs-overview-kpis" role="group" aria-label="订阅指标">
        <dl className="subs-metric-pair">
          <Metric label="会员总数" value={overview?.total_members} />
          <Metric label="活跃会员" value={overview?.active_members} />
        </dl>
        <dl className="subs-metric-pair">
          <Metric label="本月支出" currency value={overview?.monthly_spending} hint="按日均价格 × 本月覆盖天数计算（整月）" />
          <Metric label="年度支出" currency value={overview?.yearly_spending} hint="按日均价格 × 本年覆盖天数计算（整年）" />
        </dl>
      </div>

      <div className="subs-overview-grid">
        <section className="subs-overview-panel" aria-labelledby="subs-spending-title">
          <header className="subs-panel-head">
            <h2 id="subs-spending-title">分类支出汇总</h2>
            <button type="button" className="subs-overview-refresh" onClick={() => setStamp(s => s + 1)}>
              {Icon.refresh} 刷新概览
            </button>
          </header>
          <CategorySummaryTable summary={summary} sort={sort} setSort={setSort} dark={dark} />
        </section>
        <RemindersPanel reminders={reminders} onGo={go} />
      </div>

      <div className="subs-overview-grid">
        <RankingCard onGo={go} />
        <Suspense fallback={<div className="subs-overview-panel min-h-72" aria-label="日历加载中" />}>
          <ExpiryCalendar onGo={go} onRefresh={() => setStamp(s => s + 1)} />
        </Suspense>
      </div>
    </div>
  )
}
