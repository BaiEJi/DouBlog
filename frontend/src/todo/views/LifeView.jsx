/**
 * 规律生活（照搬 MyTodo life 五视图交互）：
 * 今日打卡 / 计划 / 日历（复用 CalendarView plan_only）/ 统计 / 回顾。
 * URL：?v=life&lsub=today&date=YYYY-MM-DD。
 */
import { useSearchParams } from 'react-router-dom'

import CalendarView from './CalendarView'
import LifeTodayView from './life/LifeTodayView'
import LifePlansView from './life/LifePlansView'
import LifeStatsView from './life/LifeStatsView'
import LifeReviewView from './life/LifeReviewView'
import { Icon } from '../kit'

const SUBS = [
  { key: 'today', label: '今日打卡', icon: Icon.checkCircle },
  { key: 'plans', label: '计划', icon: Icon.life },
  { key: 'calendar', label: '日历', icon: Icon.calendar },
  { key: 'stats', label: '统计', icon: Icon.stats },
  { key: 'review', label: '回顾', icon: Icon.review },
]

export default function LifeView({ toast, dark }) {
  const [sp, setSp] = useSearchParams()
  const sub = SUBS.some(s => s.key === sp.get('lsub')) ? sp.get('lsub') : 'today'

  const setSub = key => {
    const next = { v: 'life', lsub: key }
    if (sp.get('date')) next.date = sp.get('date')
    setSp(next)
  }

  const openDay = dateStr => {
    setSp({ v: 'life', lsub: 'today', date: dateStr })
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1">
        {SUBS.map(s => (
          <button key={s.key} onClick={() => setSub(s.key)}
            className={'inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs shrink-0 transition-colors ' +
              (sub === s.key
                ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium'
                : 'text-stone-500 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]')}>
            {s.icon}{s.label}
          </button>
        ))}
      </div>

      {sub === 'today' && <LifeTodayView toast={toast} dark={dark} />}
      {sub === 'plans' && <LifePlansView toast={toast} dark={dark} />}
      {sub === 'calendar' && <CalendarView variant="life" onOpenDay={openDay} toast={toast} />}
      {sub === 'stats' && <LifeStatsView toast={toast} dark={dark} />}
      {sub === 'review' && <LifeReviewView toast={toast} dark={dark} />}
    </div>
  )
}
