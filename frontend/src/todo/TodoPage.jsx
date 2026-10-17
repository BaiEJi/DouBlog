/**
 * MyTodo 能力包主页面 /todo —— 四象限待办系统（MyTodo 前端重建）。
 * 顶栏：← 门户 / 标题 / 主题切换；Tab 导航：今日/待办池/日历/回顾/统计/生活/设置。
 * 视图状态用查询参数承载（?v=today 等）：深链可分享，日历点日期可跳
 * 「今日·特定日期」（?v=today&view=day&date=X）或「生活·今日打卡」（?v=life&date=X）。
 * （剧情图谱/刷题/挂机已拆为独立顶级模块：/gamemap、/practice、/steamidler）
 */
import { lazy, Suspense, useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../shared/PageHeader'

const TodayView = lazy(() => import('./views/TodayView'))
const BacklogView = lazy(() => import('./views/BacklogView'))
const CalendarView = lazy(() => import('./views/CalendarView'))
const ReviewView = lazy(() => import('./views/ReviewView'))
const StatsView = lazy(() => import('./views/StatsView'))
const SettingsView = lazy(() => import('./views/SettingsView'))
const LifeView = lazy(() => import('./views/LifeView'))
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

export default function TodoPage({ dark }) {
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
    if (key.startsWith('backlog:')) setSp({ v: 'backlog', bsub: key.slice(8) })
    else if (key.startsWith('life:')) setSp({ v: 'life', lsub: key.slice(5) })
    else setSp(key === 'today' ? {} : { v: key })
  }

  /** 日历点某天 → 今日页特定日期模式 */
  const openDay = dateStr => {
    setSp({ v: 'today', view: 'day', date: dateStr })
  }

  return (
    <div className={'min-h-0 bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 transition-colors ' + (view === 'today' ? 'h-[calc(100vh-64px)] flex flex-col' : '')}>
      {/* ── 顶栏 ── */}
      <PageHeader title="MyTodo" subtitle="四象限 · 迁移 · 规律生活"

        tabs={TABS.map(t => ({ ...t, active: view === t.key, ...(t.key === 'backlog' ? { children: ['inbox', 'migrate', 'shelved'].map((key, i) => ({ key: `backlog:${key}`, label: ['收件箱', '迁移池', '搁置计划'][i], active: view === 'backlog' && (sp.get('bsub') || 'inbox') === key })) } : {}), ...(t.key === 'life' ? { children: ['today', 'plans', 'calendar', 'stats', 'review'].map((key, i) => ({ key: `life:${key}`, label: ['今日打卡', '计划', '日历', '统计', '回顾'][i], active: view === 'life' && (sp.get('lsub') || 'today') === key })) } : {}) }))}
        activeTab={view}
        onTabChange={goTab}
        accent="indigo" />

      {/* ── 主区 ── */}
      <main className={'mx-auto w-full max-w-full p-0 ' + (view === 'today' ? 'flex-1 min-h-0' : '')}><Suspense fallback={<div className="h-64 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] animate-pulse" aria-label="视图加载中" />}>
        {view === 'today' && <TodayView toast={toast} dark={dark} />}
        {view === 'backlog' && <BacklogView toast={toast} />}
        {view === 'calendar' && <CalendarView variant="todo" onOpenDay={openDay} toast={toast} />}
        {view === 'review' && <ReviewView toast={toast} />}
        {view === 'stats' && <StatsView toast={toast} dark={dark} />}
        {view === 'life' && <LifeView toast={toast} dark={dark} />}
        {view === 'settings' && <SettingsView toast={toast} dark={dark} />}
      </Suspense></main>

      <Toast msg={toastMsg} kind={toastKind} />
    </div>
  )
}
