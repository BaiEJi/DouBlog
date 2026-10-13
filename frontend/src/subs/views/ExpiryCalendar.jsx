import { useCallback, useEffect, useMemo, useState } from 'react'
import { Solar } from 'lunar-javascript'
import { subsRemindersAll } from '../api'
import { fmtPrice, daysRemaining, Icon, Modal } from '../kit'
import { useHolidays } from '../useHolidays'
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

export default function ExpiryCalendar({ onGo, onRefresh }) {
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
    const cells = Array(lead).fill(null)
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
