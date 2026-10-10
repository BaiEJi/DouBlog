import { BackButton } from '../shared/PageHeader'
/**
 * 订阅管理主页面 /subs —— CrownFlow 迁移（DouBlog 视觉语言）。
 * 布局：左侧栏（返回入口 / 视图导航 / 主题切换）+ 主区（概览/会员/统计/设置，
 * 会员详情为子路由 /subs/members/:id）。
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import OverviewView from './views/OverviewView'
import MembersView from './views/MembersView'
import MemberDetailView from './views/MemberDetailView'
import StatsView from './views/StatsView'
import SettingsView from './views/SettingsView'
import { subsStatsOverview, subsRemindersUpcoming } from './api'
import { Icon, Toast } from './kit'

const NAV = [
  { path: '/subs', label: '概览', icon: Icon.dashboard, end: true },
  { path: '/subs/members', label: '会员', icon: Icon.members },
  { path: '/subs/stats', label: '统计', icon: Icon.stats },
  { path: '/subs/settings', label: '设置', icon: Icon.settings },
]

export default function SubsPage({ dark, setDark }) {
  const [toastMsg, setToastMsg] = useState(null)
  const [toastKind, setToastKind] = useState('')
  const [counts, setCounts] = useState(null)   // { members, active, upcoming }
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const toast = useCallback((msg, kind) => {
    setToastMsg(msg); setToastKind(kind || '')
    setTimeout(() => setToastMsg(null), 2200)
  }, [])

  const loadCounts = useCallback(() => {
    subsStatsOverview().then(d => d.success && setCounts(d.data))
    subsRemindersUpcoming().then(d => d.success && setCounts(c => c ? { ...c, upcoming: d.data.reminders.length } : null))
  }, [])
  useEffect(loadCounts, [loadCounts, pathname])

  const isActive = item => item.end ? pathname === item.path : pathname.startsWith(item.path)

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 transition-colors flex">
      {/* ── 侧栏 ── */}
      <aside className="w-[220px] shrink-0 hidden md:flex flex-col gap-1 p-4 border-r border-black/[0.05] dark:border-white/[0.06] sticky top-0 h-screen overflow-y-auto">
        <div className="mb-3"><BackButton /></div>
        
        <div className="px-2 mb-4">
          <div className="text-base font-semibold mb-0.5">订阅管理</div>
          <div className="text-[11.5px] text-stone-400 dark:text-stone-500">会员 · 支出 · 到期提醒</div>
        </div>
        {NAV.map(item => (
          <button key={item.path} onClick={() => navigate(item.path)}
            className={'flex items-center gap-2.5 px-2.5 h-9 rounded-xl text-sm transition-colors ' +
              (isActive(item)
                ? 'bg-amber-500/12 text-amber-700 dark:text-amber-400 font-medium'
                : 'text-stone-500 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]')}>
            {item.icon}{item.label}
            {item.path === '/subs' && counts?.upcoming > 0 && (
              <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] flex items-center justify-center tabular-nums">
                {counts.upcoming}
              </span>
            )}
            {item.path === '/subs/members' && counts && (
              <span className="ml-auto text-[10.5px] text-stone-400 tabular-nums">
                {counts.active_members ?? 0}/{counts.total_members ?? 0}
              </span>
            )}
          </button>
        ))}

        <div className="mt-auto pt-4 flex items-center justify-between px-2">
          <span className="text-[10.5px] text-stone-300 dark:text-stone-600">CrownFlow × DouBlog</span>
          <button onClick={() => setDark(!dark)} title="切换主题"
            className="w-8 h-8 rounded-lg border border-black/[0.08] dark:border-white/[0.1] text-stone-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors flex items-center justify-center">
            {dark ? (
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="3.4" stroke="currentColor" strokeWidth="1.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none"><path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5 6.8 6.8 0 1 0 15.5 12.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
            )}
          </button>
        </div>
      </aside>

      {/* ── 主区 ── */}
      <div className="flex-1 min-w-0">
        {/* 移动端顶栏 */}
        <div className="md:hidden sticky top-0 z-20 flex items-center gap-1 px-3 h-12 bg-stone-50/95 dark:bg-[#100f0e]/95 backdrop-blur border-b border-black/[0.05] dark:border-white/[0.06] overflow-x-auto">
          <Link to="/" className="px-1.5 text-stone-400 shrink-0">←</Link>
          {NAV.map(item => (
            <button key={item.path} onClick={() => navigate(item.path)}
              className={'px-2.5 h-8 rounded-lg text-xs shrink-0 transition-colors ' +
                (isActive(item) ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'text-stone-500')}>
              {item.label}
            </button>
          ))}
        </div>

        <div className="mx-auto w-full max-w-[1700px] px-4 sm:px-6 xl:px-10 py-8">
          <Routes>
            <Route index element={<OverviewView dark={dark} />} />
            <Route path="members" element={<MembersView dark={dark} toast={toast} />} />
            <Route path="members/:id" element={<MemberDetailView dark={dark} toast={toast} />} />
            <Route path="stats" element={<StatsView dark={dark} toast={toast} />} />
            <Route path="settings" element={<SettingsView dark={dark} />} />
          </Routes>
        </div>
      </div>

      <Toast msg={toastMsg} kind={toastKind} />
    </div>
  )
}
