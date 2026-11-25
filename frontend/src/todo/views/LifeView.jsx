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

const VIEWS = ['today', 'plans', 'calendar', 'stats', 'review']

export default function LifeView({ toast, dark }) {
  const [sp, setSp] = useSearchParams()
  const sub = VIEWS.includes(sp.get('lsub')) ? sp.get('lsub') : 'today'

  const openDay = dateStr => {
    setSp({ v: 'life', lsub: 'today', date: dateStr })
  }

  return (
    <div className="h-full min-h-0">
      {sub === 'today' && <LifeTodayView toast={toast} dark={dark} />}
      {sub === 'plans' && <LifePlansView toast={toast} dark={dark} />}
      {sub === 'calendar' && <CalendarView variant="life" onOpenDay={openDay} toast={toast} />}
      {sub === 'stats' && <LifeStatsView toast={toast} dark={dark} />}
      {sub === 'review' && <LifeReviewView toast={toast} dark={dark} />}
    </div>
  )
}
