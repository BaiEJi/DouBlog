/**
 * MyTodo 能力包主页面 /todo —— 四象限待办系统（MyTodo 前端重建）。
 * 顶栏：← 门户 / 标题 / 图谱入口 / 主题切换；Tab 导航：今日/待办池/日历/回顾/统计/刷题/生活/挂机/设置。
 * 视图状态用查询参数承载（?v=today 等）：深链可分享，日历点日期可跳
 * 「今日·特定日期」（?v=today&view=day&date=X）或「生活·今日打卡」（?v=life&date=X）。
 */
import { lazy, Suspense, useCallback, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import PageHeader from '../shared/PageHeader'

import TodayView from './views/TodayView'
import BacklogView from './views/BacklogView'
import CalendarView from './views/CalendarView'
import ReviewView from './views/ReviewView'
import StatsView from './views/StatsView'
import SettingsView from './views/SettingsView'
import LifeView from './views/LifeView'
import SteamIdlerView from './steamidler/SteamIdlerView'
import PracticeView from './practice/PracticeView'
import { Icon, Toast } from './kit'

// 剧情图谱子模块（antd 技术栈）懒加载，避免拖慢 MyTodo 首屏
const GamemapShell = lazy(() => import('./gamemap/GamemapShell'))

/** 手柄图标（kit 图标同款规格：viewBox 20 / stroke 1.5 / 16px），steamidler 挂机 Tab 用 */
const IdlerIcon = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.8 6h6.4A3.3 3.3 0 0 1 16.5 9.3v1.2a3 3 0 0 1-5.3 1.9l-.5-.6H9.3l-.5.6a3 3 0 0 1-5.3-1.9V9.3A3.3 3.3 0 0 1 6.8 6z" />
    <path d="M6.9 9v2.6M5.6 10.3h2.6M12.9 9.6h.01M14.2 11h.01" />
  </svg>
)

/** 代码括号图标（kit 图标同款规格），刷题 practice Tab 用 */
const PracticeIcon = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 4.5 3 10l4 5.5" />
    <path d="M13 4.5 17 10l-4 5.5" />
  </svg>
)

const TABS = [
  { key: 'today', label: '今日', icon: Icon.today },
  { key: 'backlog', label: '待办池', icon: Icon.inbox },
  { key: 'calendar', label: '日历', icon: Icon.calendar },
  { key: 'review', label: '回顾', icon: Icon.review },
  { key: 'stats', label: '统计', icon: Icon.stats },
  { key: 'practice', label: '刷题', icon: PracticeIcon },
  { key: 'life', label: '生活', icon: Icon.life },
  { key: 'steamidler', label: '挂机', icon: IdlerIcon },
  { key: 'settings', label: '设置', icon: Icon.settings },
]

export default function TodoPage({ dark, setDark }) {
  const [sp, setSp] = useSearchParams()
  const location = useLocation()
  const view = TABS.some(t => t.key === sp.get('v')) ? sp.get('v') : 'today'
  const [toastMsg, setToastMsg] = useState(null)
  const [toastKind, setToastKind] = useState('')

  const toast = useCallback((msg, kind) => {
    setToastMsg(msg)
    setToastKind(kind || '')
    setTimeout(() => setToastMsg(null), 2400)
  }, [])

  // 剧情图谱子模块（/todo/gamemap/** 由本页承接后转交其内部嵌套路由）。
  // 注意：提前 return 必须放在全部 Hook 之后（/todo 与 /todo/gamemap 同挂载内切换不卸载本组件）
  if (location.pathname.startsWith('/todo/gamemap')) {
    return (
      <Suspense fallback={
        <div className="min-h-screen bg-stone-50 dark:bg-[#100f0e] flex items-center justify-center text-sm text-stone-400 dark:text-stone-500">加载中…</div>
      }>
        <GamemapShell dark={dark} setDark={setDark} />
      </Suspense>
    )
  }

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
          <>
            <Link to="/todo/gamemap" title="剧情图谱"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] text-[13px] font-medium text-stone-600 dark:text-stone-300 transition-colors">
              图谱 ›
            </Link>
            <button onClick={() => setDark(!dark)} title="切换主题"
              className="w-9 h-9 rounded-xl border border-black/[0.08] dark:border-white/[0.1] text-stone-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center justify-center transition-colors">
              {dark ? Icon.sun : Icon.moon}
            </button>
          </>
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
        {view === 'practice' && <PracticeView toast={toast} dark={dark} />}
        {view === 'life' && <LifeView toast={toast} dark={dark} />}
        {view === 'steamidler' && <SteamIdlerView toast={toast} />}
        {view === 'settings' && <SettingsView toast={toast} dark={dark} />}
      </main>

      <Toast msg={toastMsg} kind={toastKind} />
    </div>
  )
}
