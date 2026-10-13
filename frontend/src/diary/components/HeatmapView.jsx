/**
 * 年度热力图（GitHub 式）：周×日格子，色阶按当天篇数，点格子跳时间线看当天。
 */
import { useEffect, useMemo, useState } from 'react'
import { diaryHeatmap } from '../api'
import { Icon, moodOf } from '../kit'

const LEVELS = ['bg-black/[0.045] dark:bg-white/[0.055]', 'bg-rose-500/25', 'bg-rose-500/45', 'bg-rose-500/70', 'bg-rose-500']
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

export default function HeatmapView({ onPickDate }) {
  const [year, setYear] = useState(new Date().getFullYear())
  const [data, setData] = useState(null)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    diaryHeatmap(year).then(d => d.success && setData(d.data))
  }, [year])

  // 把 days 映射到周列网格：col=ISO 周序（周一开头），row=weekday
  const grid = useMemo(() => {
    if (!data) return null
    const jan1 = new Date(year, 0, 1)
    const lead = (jan1.getDay() + 6) % 7
    const total = Math.floor((new Date(year, 11, 31) - jan1) / 86400000) + 1
    const cells = []
    for (let i = 0; i < lead; i++) cells.push(null)
    for (let i = 0; i < total; i++) {
      const d = new Date(year, 0, 1 + i)
      const key = `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      cells.push({ key, info: data.days[key] || null, month: d.getMonth() })
    }
    while (cells.length % 7 !== 0) cells.push(null)
    const cols = []
    for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7))
    return cols
  }, [data, year])

  const lvl = info => {
    if (!info) return 0
    const c = info.count
    if (!c) return 0
    if (!data?.max || data.max === 1) return 3
    if (c === 1) return 1
    if (c <= Math.ceil(data.max / 3)) return 2
    if (c <= Math.ceil((data.max * 2) / 3)) return 3
    return 4
  }

  const totalDays = data ? Object.keys(data.days).length : 0
  const totalCount = data ? Object.values(data.days).reduce((a, b) => a + b.count, 0) : 0

  return (
    <div className="max-w-[1200px]" style={{ '--cell': 'clamp(11px, 1.55vw, 17px)', '--gap': 'clamp(3px, 0.42vw, 5px)' }}>
      <div className="flex items-center gap-3 mb-5">

        <div className="flex items-center gap-1">
          <button onClick={() => setYear(y => y - 1)} className="w-8 h-8 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center">{Icon.arrowL}</button>
          <span className="text-sm font-medium tabular-nums w-12 text-center">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="w-8 h-8 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center">{Icon.arrowR}</button>
        </div>
        <span className="text-xs text-stone-400">{totalDays} 天有记录 · 共 {totalCount} 篇</span>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="min-w-[720px]">
          {/* 月份标签：相对本容器定位，left=列序×(格宽+间距)，起点对齐星期标签列(20px+2px) */}
          <div className="relative ml-[22px] h-3.5 mb-0.5">
            {(() => {
              if (!grid) return null
              const marks = []
              let lastM = -1
              grid.forEach((col, ci) => {
                const first = col.find(Boolean)
                const m = first ? first.month : -1
                if (first && m !== lastM) { marks.push({ ci, m }); lastM = m }
              })
              return marks.map(({ ci, m }) => (
                <span key={m} className="absolute top-0 text-[10px] text-stone-400 whitespace-nowrap" style={{ left: `calc((var(--cell) + var(--gap)) * ${ci})` }}>{MONTHS[m]}</span>
              ))
            })()}
          </div>
          <div className="flex gap-[var(--gap)]">
            {/* 星期标 */}
            <div className="flex flex-col gap-[var(--gap)] pt-[1px] mr-0.5">
              {['一', '', '三', '', '五', '', '日'].map((w, i) => (
                <span key={i} className="h-[var(--cell)] text-[9px] text-stone-400 dark:text-stone-500 w-[20px] text-right leading-[var(--cell)]">{w}</span>
              ))}
            </div>
            {grid?.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-[var(--gap)]">
                {col.map((cell, ri) => cell ? (
                  <button key={cell.key}
                    onClick={() => cell.info && onPickDate(cell.key)}
                    onMouseEnter={() => setHover({ ...cell, x: ci, y: ri })}
                    onMouseLeave={() => setHover(null)}
                    className={'w-[var(--cell)] h-[var(--cell)] rounded-[3px] transition-transform hover:scale-125 ' +
                      (cell.info ? LEVELS[lvl(cell.info)] : 'bg-black/[0.02] dark:bg-white/[0.055]')} />
                ) : <span key={ri} className="w-[var(--cell)] h-[var(--cell)]" />)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 图例 + 悬浮 */}
      <div className="flex items-center gap-1.5 mt-3 text-[11px] text-stone-400">
        <span>少</span>
        {LEVELS.map((l, i) => <span key={i} className={'w-[11px] h-[11px] rounded-[3px] ' + l} />)}
        <span>多</span>
        {hover && (
          <span className="ml-3 text-stone-500">
            {hover.key}{hover.info ? ` · ${hover.info.count} 篇${hover.info.mood ? ' · ' + moodOf(hover.info.mood)?.emoji : ''}` : ' · 无记录'}
          </span>
        )}
      </div>
    </div>
  )
}
