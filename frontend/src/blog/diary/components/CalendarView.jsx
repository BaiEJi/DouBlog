/**
 * 月历视图：周一开头月格，心情着色 + 篇数，点选某天 → 时间线过滤当天。今日 rose 描边。
 * 自适应全屏：撑满模块内容区宽；高度由 JS 按容器实际顶部到窗口底部的剩余空间
 * 显式设定（模块外壳 align-items:flex-start 不拉伸，纯 CSS 估算会留空白），
 * 网格行高 1fr 随之拉满，窗口尺寸变化时重算。
 */
import { useEffect, useRef, useState } from 'react'
import { diaryDates } from '../api'
import { MOODS, moodOf, Icon } from '../kit'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

export default function CalendarView({ onPickDate }) {
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 })
  const [days, setDays] = useState(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    diaryDates(ym.y, ym.m).then(d => d.success && setDays(d.data.days))
  }, [ym])

  // 撑满视口：容器顶到窗口底只留 12px 呼吸位（日历几乎贴窗口底边）；矮屏保底 480px
  useEffect(() => {
    const fit = () => {
      const el = wrapRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top
      el.style.height = `${Math.max(480, window.innerHeight - top - 12)}px`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const first = new Date(ym.y, ym.m - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const dim = new Date(ym.y, ym.m, 0).getDate()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)]
  while (cells.length % 7) cells.push(null)
  const todayStr = now.toISOString().slice(0, 10)
  const keyOf = d => `${ym.y}-${String(ym.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  const shift = k => {
    const d = new Date(ym.y, ym.m - 1 + k, 1)
    setYm({ y: d.getFullYear(), m: d.getMonth() + 1 })
  }

  return (
    // -mb-8 抵消模块底部 py-8 padding：日历贴底但不把文档撑出滚动条
    <div ref={wrapRef} className="flex flex-col w-full min-h-[480px] -mb-8">
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <h2 className="text-base font-semibold">{ym.y} 年 {ym.m} 月</h2>
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className="w-8 h-8 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center">{Icon.arrowL}</button>
          <button onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() + 1 })}
            className="px-2 h-8 rounded-lg text-xs text-stone-400 hover:bg-black/5 dark:hover:bg-white/10">今天</button>
          <button onClick={() => shift(1)} className="w-8 h-8 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center">{Icon.arrowR}</button>
        </div>
      </div>
      <div className="grid grid-cols-7 grid-rows-[auto_repeat(6,minmax(0,1fr))] gap-1.5 flex-1 min-h-0">
        {WEEK.map(w => (
          <div key={w} className="text-center text-[11px] text-stone-400 py-1">{w}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={i} />
          const k = keyOf(d)
          const info = days?.[k]
          const isToday = k === todayStr
          const mood = info && moodOf(info.mood)
          return (
            <button key={i} onClick={() => info && onPickDate(k)} disabled={!info}
              className={'flex flex-col items-center justify-center gap-0.5 rounded-xl transition-all border overflow-hidden ' +
                (info
                  ? 'border-black/[0.06] dark:border-white/[0.08] bg-white dark:bg-white/[0.03] hover:border-rose-500/40 hover:-translate-y-px'
                  : 'border-transparent text-stone-300 dark:text-stone-700') +
                (isToday ? ' ring-1 ring-rose-500/50 ' : '')}
              style={info && mood ? { boxShadow: `inset 0 -3px 0 -1px ${mood.color}55` } : undefined}>
              <span className={'text-sm tabular-nums ' + (isToday ? 'font-semibold text-rose-600 dark:text-rose-400' : info ? 'text-stone-700 dark:text-stone-200' : '')}>{d}</span>
              {info && (
                <span className="flex items-center gap-0.5">
                  <span className="w-1 h-1 rounded-full" style={{ background: mood?.color || '#a8a29e' }} />
                  {info.count > 1 && <span className="text-[10px] text-stone-400 tabular-nums">{info.count}</span>}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-stone-400 shrink-0">
        {MOODS.map(m => (
          <span key={m.key} className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />{m.label}</span>
        ))}
        <span className="ml-auto">点有记录的日期查看当天日记</span>
      </div>
    </div>
  )
}
