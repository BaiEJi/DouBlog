import { useModuleNavigation } from '../shared/module-navigation'
/**
 * 订阅管理主页面 /subs —— CrownFlow 迁移（DouBlog 视觉语言）。
 * 布局：左侧栏（返回入口 / 视图导航 / 主题切换）+ 主区（概览/会员/统计/设置，
 * 会员详情为子路由 /subs/members/:id）。
 */
import { useCallback, useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'

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

export default function SubsPage({ dark }) {
  const [toastMsg, setToastMsg] = useState(null)
  const [toastKind, setToastKind] = useState('')
  const [counts, setCounts] = useState(null)   // { members, active, upcoming }
  const { pathname, search } = useLocation()

  const toast = useCallback((msg, kind) => {
    setToastMsg(msg); setToastKind(kind || '')
    setTimeout(() => setToastMsg(null), 2200)
  }, [])

  const loadCounts = useCallback(() => {
    Promise.all([subsStatsOverview(), subsRemindersUpcoming()])
      .then(([overview, reminders]) => {
        if (overview.success) setCounts({ ...overview.data, upcoming: reminders.success ? reminders.data.reminders.length : 0 })
      }).catch(() => {})
  }, [])
  useEffect(loadCounts, [loadCounts, pathname])

  useModuleNavigation({
    items: NAV.map(item => ({ key: item.path, label: item.label, icon: item.icon, to: item.path,
      active: item.end ? pathname === item.path : pathname.startsWith(item.path),
      ...(item.path === '/subs/settings' ? { children: ['category', 'distribution', 'backup'].map((key, i) => ({ key: `settings:${key}`, label: ['分类管理', '会员分布', '备份'][i], to: `/subs/settings?panel=${key}`, active: pathname === '/subs/settings' && (new URLSearchParams(search).get('panel') || 'category') === key })) } : {}),
      badge: item.path === '/subs' ? (counts?.upcoming || undefined) : item.path === '/subs/members' && counts ? `${counts.active_members ?? 0}/${counts.total_members ?? 0}` : undefined,
    })),
  })

  return (
    <div className="min-h-0 bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 transition-colors flex">
      <div className="flex-1 min-w-0">
        <div className="mx-auto w-full max-w-full p-0">
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
