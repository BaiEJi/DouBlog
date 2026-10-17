/**
 * 统计视图：日期范围（快速选择 本周/本月/本季度/本年）+ 粒度（按天在跨度 ≥90 天时禁用）+
 * 支出趋势面积图 + 分类支出环形饼图（占比/明细开关，hover 提示展示订阅明细）。
 */
import { useEffect, useMemo, useState } from 'react'

import { subsStatsTrend, subsStatsByCategory } from '../api'
import { AreaTrend, DonutPie } from '../charts'
import { fmtPrice, adjustForDark } from '../kit'

const PALETTE = ['#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#f97316']
const DARK_PALETTE = ['#38bdf8', '#fbbf24', '#34d399', '#f87171', '#a78bfa', '#2dd4bf', '#f472b6', '#fb923c']

function dateRange(type) {
  const now = new Date()
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const d = new Date(now)
  if (type === 'week') {
    const dow = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - dow)
    const e = new Date(d); e.setDate(e.getDate() + 6)
    return [fmt(d), fmt(e)]
  }
  if (type === 'month') {
    const s = new Date(d.getFullYear(), d.getMonth(), 1)
    const e = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    return [fmt(s), fmt(e)]
  }
  if (type === 'quarter') {
    const q = Math.floor(d.getMonth() / 3)
    const s = new Date(d.getFullYear(), q * 3, 1)
    const e = new Date(q === 3 ? d.getFullYear() + 1 : d.getFullYear(), q === 3 ? 1 : q * 3 + 3, 0)
    return [fmt(s), fmt(e)]
  }
  return [fmt(new Date(d.getFullYear(), 0, 1)), fmt(new Date(d.getFullYear(), 11, 31))]
}

const QUICK = [
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'quarter', label: '本季度' },
  { key: 'year', label: '本年' },
]

export default function StatsView({ dark, toast }) {
  const [range, setRange] = useState(() => dateRange('month'))
  const [quick, setQuick] = useState('month')
  const [granularity, setGranularity] = useState('week')
  const [showDetails, setShowDetails] = useState(false)
  const [trend, setTrend] = useState(null)
  const [cats, setCats] = useState(null)

  const palette = dark ? DARK_PALETTE : PALETTE

  const dayDisabled = useMemo(() => {
    if (quick === 'quarter' || quick === 'year') return true
    const [s, e] = range
    return (new Date(e) - new Date(s)) / 86400000 >= 90
  }, [range, quick])

  useEffect(() => {
    if (dayDisabled && granularity === 'day') setGranularity('week')
  }, [dayDisabled, granularity])

  const [trendError, setTrendError] = useState('')
  useEffect(() => {
    subsStatsTrend(range[0], range[1], granularity).then(d => {
      if (d.success) { setTrend(d.data.trend); setTrendError('') }
      else setTrendError(d.message)
    })
    subsStatsByCategory(range[0], range[1]).then(d => d.success && setCats(d.data))
  }, [range, granularity])

  const inputCls = 'px-3 h-8 rounded-lg text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 outline-none focus:border-black/30 dark:focus:border-white/30'

  const trendData = useMemo(() =>
    (trend || []).map(t => ({ x: t.date, v: t.amount, details: t.details })), [trend])

  const pieData = useMemo(() => (cats?.categories || []).map((c, i) => ({
    name: c.category_name,
    value: c.total,
    percentage: c.percentage,
    color: dark ? adjustForDark(c.category_color) : (c.category_color || palette[i % palette.length]),
    rawColor: c.category_color,
    details: c.details || [],
  })), [cats, dark])

  const TrendTip = d => (
    <div>
      <div className="font-medium text-xs mb-1">{d.x}</div>
      <div className="text-stone-600 dark:text-stone-300 tabular-nums">支出金额：{fmtPrice(d.v)}</div>
      {showDetails && (d.details || []).map(c => (
        <div key={c.category_id} className="mt-1.5 pt-1.5 border-t border-black/[0.06] dark:border-white/[0.08]">
          <div className="font-medium" style={{ color: dark ? adjustForDark(c.category_color) : c.category_color }}>
            {c.category_name}：{fmtPrice(c.total)}
          </div>
          {c.subscriptions.map((s, i) => (
            <div key={i} className="text-stone-400">{s.member_name}{s.level ? ` (${s.level})` : ''}：{fmtPrice(s.amount)}</div>
          ))}
        </div>
      ))}
    </div>
  )

  const PieTip = d => (
    <div>
      <div className="font-medium" style={{ color: d.color }}>{d.name}</div>
      <div className="text-stone-500 dark:text-stone-300 tabular-nums">支出金额：{fmtPrice(d.value)} · 占比 {d.percentage}%</div>
      {showDetails && d.details.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-black/[0.06] dark:border-white/[0.08]">
          <div className="text-stone-400">明细：</div>
          {d.details.map((s, i) => (
            <div key={i} className="text-stone-400">{s.member_name}{s.level ? ` (${s.level})` : ''}：{fmtPrice(s.amount)}</div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">统计图表</h2>

      {/* 控制栏 */}
      <div className="flex flex-wrap items-center gap-2.5 p-5 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]">
        <div className="flex items-center gap-1.5">
          <input type="date" className={inputCls} value={range[0]}
            onChange={e => { setRange([e.target.value, range[1]]); setQuick('') }} />
          <span className="text-stone-400">→</span>
          <input type="date" className={inputCls} value={range[1]}
            onChange={e => { setRange([range[0], e.target.value]); setQuick('') }} />
        </div>
        <select className={inputCls + ' w-24'} value={granularity} onChange={e => setGranularity(e.target.value)}>
          <option value="day" disabled={dayDisabled}>按天</option>
          <option value="week">按周</option>
          <option value="month">按月</option>
          <option value="quarter">按季度</option>
        </select>
        <div className="flex items-center gap-1">
          {QUICK.map(q => (
            <button key={q.key}
              className={'px-2 h-7 rounded-lg text-xs transition-colors ' + (quick === q.key
                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300')}
              onClick={() => { setRange(dateRange(q.key)); setQuick(q.key) }}>
              {q.label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-stone-500 cursor-pointer select-none">
          支出明细
          <button role="switch" aria-checked={showDetails} onClick={() => setShowDetails(v => !v)}
            className={'w-8 h-[18px] rounded-full transition-colors relative ' + (showDetails ? 'bg-amber-500' : 'bg-black/[0.12] dark:bg-white/[0.16]')}>
            <span className={'absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ' + (showDetails ? 'left-[16px]' : 'left-[2px]')} />
          </button>
        </label>
      </div>

      {trendError && (
        <div className="rounded-lg px-3 py-2 bg-red-500/10 text-red-600 dark:text-red-400 text-[13px] flex items-center">
          {trendError}
        </div>
      )}

      {/* 图表 */}
      <div className="grid grid-cols-5 gap-4">
        <div className="col-span-3 p-5 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]">
          <div className="text-sm font-semibold mb-2">支出趋势</div>
          <AreaTrend data={trendData} height={340} color={palette[1]} renderTip={TrendTip} />
        </div>
        <div className="col-span-2 p-5 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]">
          <div className="text-sm font-semibold mb-2">
            分类支出（总计：{fmtPrice(cats?.total || 0)}）
          </div>
          <div className="pt-2 flex justify-center">
            <DonutPie data={pieData} size={230} centerLabel="范围内总支出" centerValue={`¥${(cats?.total || 0).toFixed(2)}`}
              renderTip={PieTip} />
          </div>
        </div>
      </div>
    </div>
  )
}
