/**
 * 统计视图：指标卡 + 心情月均折线 + 每月字数柱状（纯 SVG，随容器宽度自适应）+ 年度回顾。
 */
import { useEffect, useRef, useState } from 'react'
import { diaryStats, diaryTrends, diaryYearEnd } from '../api'
import { MOODS, moodOf, Icon } from '../kit'

/** 容器宽度监听（初次量宽 + resize 事件 + ResizeObserver 三重兜底），
 *  图表按实际宽度绘制而非固定像素 */
function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // 页面隐藏（如后台标签）时 ResizeObserver 回调不派发，getBoundingClientRect + resize 事件兜底
    const measure = () => setW(Math.round(el.getBoundingClientRect().width))
    measure()
    window.addEventListener('resize', measure)
    let ro
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure)
      ro.observe(el)
    }
    return () => { window.removeEventListener('resize', measure); ro?.disconnect() }
  }, [])
  return [ref, w]
}

export default function StatsView() {
  const [stats, setStats] = useState(null)
  const [trends, setTrends] = useState(null)
  const [ye, setYe] = useState(null)
  const [year, setYear] = useState(new Date().getFullYear())

  useEffect(() => {
    diaryStats().then(d => d.success && setStats(d.data))
    diaryTrends(12).then(d => d.success && setTrends(d.data))
  }, [])
  useEffect(() => {
    diaryYearEnd(year).then(d => d.success && setYe(d.data))
  }, [year])

  // 字数统一口径：<1 万显示「N 字」，≥1 万显示「x.x 万字」
  const fmtWords = w => w >= 10000
    ? { n: (w / 10000).toFixed(1), unit: '万字' }
    : { n: String(w), unit: '字' }

  const cards = stats ? [
    { n: stats.current_streak, label: '连续天数', unit: '天', hot: stats.current_streak >= 3 },
    { n: stats.longest_streak, label: '最长连续', unit: '天' },
    { n: stats.month_count, label: '本月', unit: '篇' },
    { n: stats.total, label: '总计', unit: '篇' },
    { ...fmtWords(stats.words), label: '累计' },
    { n: stats.journals, label: '日记本', unit: '本' },
  ] : []

  return (
    <div className="max-w-[1200px] space-y-8">


      {/* 指标卡 */}
      <div className="grid grid-cols-6 gap-2">
        {cards.map(c => (
          <div key={c.label} className={'p-3 rounded-2xl border text-center ' + (c.hot
            ? 'border-rose-500/30 bg-rose-500/[0.06]'
            : 'border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]')}>
            <div className={'text-xl font-semibold tabular-nums ' + (c.hot ? 'text-rose-600 dark:text-rose-400' : '')}>
              {c.n}<span className="text-[11px] font-normal text-stone-400 ml-0.5">{c.unit}</span>
            </div>
            <div className="text-[11px] text-stone-400 mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      {/* 趋势双图 */}
      {trends && (
        <div className="grid grid-cols-2 gap-4">
          <Panel title="每月字数">
            <Bars data={trends.months.map(m => ({ x: m.month.slice(5) + '月', v: m.words }))} />
          </Panel>
          <Panel title="心情月均（1-5）">
            <Line data={trends.months.map(m => ({ x: m.month.slice(5) + '月', v: m.mood_avg }))} max={5} />
          </Panel>
        </div>
      )}

      {/* 年度回顾 */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <h3 className="text-[15px] font-semibold">年度回顾</h3>
          <div className="flex items-center gap-1">
            <button onClick={() => setYear(y => y - 1)} className="w-6 h-6 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center">{Icon.arrowL}</button>
            <span className="text-[12.5px] tabular-nums w-10 text-center">{year}</span>
            <button onClick={() => setYear(y => y + 1)} className="w-6 h-6 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center">{Icon.arrowR}</button>
          </div>
        </div>
        {ye?.empty ? (
          <p className="text-xs text-stone-400 py-6 text-center border border-dashed border-black/10 dark:border-white/10 rounded-2xl">
            {year} 年还没有日记
          </p>
        ) : ye && (
          <div className="p-5 rounded-2xl border border-rose-500/25 bg-gradient-to-br from-rose-500/[0.07] to-transparent">
            <div className="grid grid-cols-4 gap-4 mb-4">
              <Big n={ye.entries} label="篇日记" />
              <Big n={fmtWords(ye.words).n} label={fmtWords(ye.words).unit} />
              <Big n={ye.days} label="天有记录" />
              <Big n={ye.longest_streak} label="天最长连续" />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-stone-500 dark:text-stone-400">
              {ye.top_month && <span>最活跃：<b className="text-rose-600 dark:text-rose-400">{ye.top_month}</b>（{ye.top_month_words} 字）</span>}
            </div>
            {Object.keys(ye.mood_dist || {}).length > 0 && (
              <div className="flex gap-2 mt-3">
                {MOODS.map(m => ye.mood_dist[m.key]
                  ? <span key={m.key} className="text-[15px]" title={`${m.label} ×${ye.mood_dist[m.key]}`}>{m.emoji}</span>
                  : null)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Panel({ title, children }) {
  return (
    <div className="p-4 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]">
      <div className="text-xs text-stone-400 mb-3">{title}</div>
      {children}
    </div>
  )
}

function Big({ n, label }) {
  return (
    <div>
      <div className="text-xl font-semibold tabular-nums text-stone-700 dark:text-stone-200">{n}</div>
      <div className="text-[11px] text-stone-400">{label}</div>
    </div>
  )
}

/** 柱状图（SVG，无依赖，柱宽随容器自适应） */
function Bars({ data }) {
  const [ref, w] = useWidth()
  const H = 110, GAP = 6
  const n = data.length || 1
  const BW = Math.max(8, (w - GAP * (n - 1)) / n)
  const max = Math.max(1, ...data.map(d => d.v))
  const labelEvery = w / n >= 34 ? 1 : 2 // 槽位够宽时每月都标，否则隔月
  return (
    <div ref={ref} className="w-full">
      {w > 0 && (
        <svg width={w} height={H + 18}>
          {data.map((d, i) => {
            const h = d.v ? Math.max(3, (d.v / max) * (H - 10)) : 0
            const x = i * (BW + GAP)
            return (
              <g key={d.x}>
                <rect x={x} y={H - h} width={BW} height={h} rx={3}
                  className="fill-rose-500/60" />
                {i % labelEvery === 0 && (
                  <text x={x + BW / 2} y={H + 12} textAnchor="middle"
                    className="fill-stone-400" fontSize="8.5">{d.x}</text>
                )}
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

/** 折线图（SVG，缺值断开，步距随容器自适应） */
function Line({ data, max }) {
  const [ref, w] = useWidth()
  const H = 110
  const n = data.length || 1
  const step = w / n
  const pts = data.map((d, i) => d.v == null ? null : [i * step + step / 2, H - 8 - (d.v / max) * (H - 20)])
  const seg = []
  let cur = []
  for (const p of pts) {
    if (p) cur.push(p)
    else if (cur.length) { seg.push(cur); cur = [] }
  }
  if (cur.length) seg.push(cur)
  const labelEvery = step >= 34 ? 1 : 2
  return (
    <div ref={ref} className="w-full">
      {w > 0 && (
        <svg width={w} height={H + 18}>
          {[1, 2, 3, 4, 5].map(v => (
            <line key={v} x1={0} x2={w} y1={H - 8 - (v / 5) * (H - 20)} y2={H - 8 - (v / 5) * (H - 20)}
              className="stroke-black/[0.05] dark:stroke-white/[0.07]" strokeWidth={1} />
          ))}
          {seg.map((s, si) => (
            <polyline key={si} points={s.map(p => p.join(',')).join(' ')}
              className="stroke-rose-500" strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {pts.map((p, i) => p && (
            <circle key={i} cx={p[0]} cy={p[1]} r={2.5} className="fill-rose-500" />
          ))}
          {data.map((d, i) => i % labelEvery === 0 && (
            <text key={d.x} x={i * step + step / 2} y={H + 12} textAnchor="middle" className="fill-stone-400" fontSize="8.5">{d.x}</text>
          ))}
        </svg>
      )}
    </div>
  )
}
