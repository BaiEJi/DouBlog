/**
 * MyTodo 能力包主页面 /todo —— 四象限待办系统（MyTodo 前端重建）。
 * 顶栏：← 门户 / 标题 / 主题切换；Tab 导航：今日/待办池/日历/回顾/统计/生活/设置。
 * 视图状态用查询参数承载（?v=today 等）：深链可分享，日历点日期可跳
 * 「今日·特定日期」（?v=today&view=day&date=X）或「生活·今日打卡」（?v=life&date=X）。
 * （剧情图谱/刷题/挂机已拆为独立顶级模块：/gamemap、/practice、/steamidler）
 */
import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../shared/PageHeader'

import TodayView from './views/TodayView'
import BacklogView from './views/BacklogView'
import CalendarView from './views/CalendarView'
import ReviewView from './views/ReviewView'
import StatsView from './views/StatsView'
import SettingsView from './views/SettingsView'
import LifeView from './views/LifeView'
import { Icon, Toast } from './kit'

const TABS = [
  { key: 'today', label: '今日', icon: Icon.today },
  { key: 'backlog', label: '待办池', icon: Icon.inbox },
  { key: 'calendar', label: '日历', icon: Icon.calendar },
  { key: 'review', label: '回顾', icon: Icon.review },
  { key: 'stats', label: '统计', icon: Icon.stats },
  { key: 'life', label: '生活', icon: Icon.life },
  { key: 'settings', label: '设置', icon: Icon.settings },
]

export default function TodoPage({ dark, setDark }) {
  const [sp, setSp] = useSearchParams()
  const view = TABS.some(t => t.key === sp.get('v')) ? sp.get('v') : 'today'
  const [toastMsg, setToastMsg] = useState(null)
  const [toastKind, setToastKind] = useState('')

  const toast = useCallback((msg, kind) => {
    setToastMsg(msg)
    setToastKind(kind || '')
    setTimeout(() => setToastMsg(null), 2400)
  }, [])

  const goTab = key => {
    setSp(key === 'today' ? {} : { v: key })
  }

  /** 日历点某天 → 今日页特定日期模式 */
  const openDay = dateStr => {
    setSp({ v: 'today', view: 'day', date: dateStr })
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 transition-colors">
      {/* ── 顶栏 ── */}
      <PageHeader title="MyTodo" subtitle="四象限 · 迁移 · 规律生活"
        right={
          <button onClick={() => setDark(!dark)} title="切换主题"
            className="w-9 h-9 rounded-xl border border-black/[0.08] dark:border-white/[0.1] text-stone-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center justify-center transition-colors">
            {dark ? Icon.sun : Icon.moon}
          </button>
        }
        tabs={TABS.map(t => ({ key: t.key, label: t.label, icon: t.icon }))}
        activeTab={view}
        onTabChange={goTab}
        accent="indigo" />

      {/* ── 主区 ── */}
      <main className="mx-auto max-w-[1700px] px-4 sm:px-6 xl:px-10 py-6">
        {view === 'today' && <TodayView toast={toast} dark={dark} />}
        {view === 'backlog' && <BacklogView toast={toast} />}
        {view === 'calendar' && <CalendarView variant="todo" onOpenDay={openDay} toast={toast} />}
        {view === 'review' && <ReviewView toast={toast} />}
        {view === 'stats' && <StatsView toast={toast} dark={dark} />}
        {view === 'life' && <LifeView toast={toast} dark={dark} />}
        {view === 'settings' && <SettingsView toast={toast} dark={dark} />}
      </main>

      <Toast msg={toastMsg} kind={toastKind} />
    </div>
  )
}
