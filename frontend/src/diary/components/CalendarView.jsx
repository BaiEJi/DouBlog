/**
 * 月历视图：周一开头月格，心情着色 + 篇数，点选某天 → 时间线过滤当天。今日 rose 描边。
 */
import { useEffect, useState } from 'react'
import { diaryDates } from '../api'
import { moodOf, Icon } from '../kit'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

export default function CalendarView({ onPickDate }) {
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 })
  const [days, setDays] = useState(null)

  useEffect(() => {
    diaryDates(ym.y, ym.m).then(d => d.success && setDays(d.data.days))
  }, [ym])

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
    <div className="max-w-[1200px]">
      <div className="flex items-center gap-3 mb-5">
        <h2 className="text-base font-semibold">{ym.y} 年 {ym.m} 月</h2>
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className="w-8 h-8 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center">{Icon.arrowL}</button>
          <button onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() + 1 })}
            className="px-2 h-8 rounded-lg text-xs text-stone-400 hover:bg-black/5 dark:hover:bg-white/10">今天</button>
          <button onClick={() => shift(1)} className="w-8 h-8 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center">{Icon.arrowR}</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
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
              className={'aspect-square rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all border ' +
                (info
                  ? 'border-black/[0.06] dark:border-white/[0.08] bg-white dark:bg-white/[0.03] hover:border-rose-500/40 hover:-translate-y-px'
                  : 'border-transparent text-stone-300 dark:text-stone-700') +
                (isToday ? ' ring-1 ring-rose-500/50 ' : '')}
              style={info && mood ? { boxShadow: `inset 0 -3px 0 -1px ${mood.color}55` } : undefined}>
              <span className={'text-[13px] tabular-nums ' + (isToday ? 'font-semibold text-rose-600 dark:text-rose-400' : info ? 'text-stone-700 dark:text-stone-200' : '')}>{d}</span>
              {info && (
                <span className="flex items-center gap-0.5">
                  <span className="w-1 h-1 rounded-full" style={{ background: mood?.color || '#a8a29e' }} />
                  {info.count > 1 && <span className="text-[9px] text-stone-400 tabular-nums">{info.count}</span>}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-4 text-[11px] text-stone-400">
        {[...moodEntries()].map(([k, label, color]) => (
          <span key={k} className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />{label}</span>
        ))}
        <span className="ml-auto">点有记录的日期查看当天日记</span>
      </div>
    </div>
  )
}

function* moodEntries() {
  yield ['great', '很棒', '#f59e0b']
  yield ['good', '不错', '#84a860']
  yield ['ok', '一般', '#a8a29e']
  yield ['low', '低落', '#7d9bb3']
  yield ['bad', '糟糕', '#d8849c']
}
