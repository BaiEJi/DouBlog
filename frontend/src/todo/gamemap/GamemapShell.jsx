import PageHeader from '../../shared/PageHeader'
/**
 * 剧情图谱（gamemap）外壳 —— MyTodo 子模块，替换源版 main.tsx + AppShell。
 * 顶栏遵循 Doublog 外壳基线（← /todo 返回 · 标题 · 内部导航 · 主题切换接 Doublog dark props）；
 * 内容区包 antd ConfigProvider（dark ? darkTheme : lightTheme 联动 Doublog，中文 locale，
 * 只作用于本子树）+ AntApp（message/modal 上下文）+ QueryClientProvider（react-query）。
 * 路由为嵌套 Routes：挂在 Doublog 的 /todo/* 下，路径以 gamemap 开头（相对路径，
 * 与 subs 模块的子路由写法一致）；URL query（?scope=&ch=&ids=）由 Workspace 自行读写。
 */
import { Suspense, lazy } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Icon } from '../kit'
import { darkTheme, lightTheme } from './theme'

// 路由级代码分割：各页面按需加载（antd/xyflow 等公共依赖自动进 vendor chunk）
const Dashboard = lazy(() => import('./pages/Dashboard'))
const GameLibrary = lazy(() => import('./pages/GameLibrary'))
const GameWorkspace = lazy(() => import('./pages/GameWorkspace'))
const RelationConfig = lazy(() => import('./pages/RelationConfig'))
const SearchPage = lazy(() => import('./pages/SearchPage'))

// staleTime：15s 内的重复挂载/聚焦不重复请求（显式 invalidateQueries 仍立即刷新）
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15000, retry: 1 } },
})

const NAV = [
  { to: '/todo/gamemap', label: '概览', exact: true },
  { to: '/todo/gamemap/games', label: '游戏库' },
  { to: '/todo/gamemap/relations', label: '关系类型' },
  { to: '/todo/gamemap/search', label: '搜索' },
]

/** 简易图谱图标（关系节点连线，stroke 1.5 / viewBox 20） */
const MapGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="4.5" cy="5" r="2" /><circle cx="15.5" cy="7" r="2" /><circle cx="9" cy="15" r="2" />
    <path d="M6.4 6l7-.2M5.5 7l2.6 6M13.8 8.7L10.6 13.6" />
  </svg>
)

function PageFallback() {
  return (
    <div className="h-full min-h-[60vh] flex items-center justify-center text-sm text-stone-400 dark:text-stone-500">
      加载中…
    </div>
  )
}

export default function GamemapShell({ dark, setDark }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  return (
    <ConfigProvider locale={zhCN} theme={dark ? darkTheme : lightTheme}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <div className="h-screen flex flex-col bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 transition-colors">
            {/* ── 顶栏（统一 PageHeader + 路由 tabs）── */}
            <PageHeader title="剧情图谱" subtitle="游戏 · 人物 · 关系" backLabel="门户"
              right={
                <>
                  <Link to="/todo" className="text-[13px] text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors shrink-0">‹ 待办</Link>
                  <button onClick={() => setDark(!dark)} title="切换主题"
                    className="w-9 h-9 rounded-xl border border-black/[0.08] dark:border-white/[0.1] text-stone-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center justify-center transition-colors shrink-0">
                    {dark ? Icon.sun : Icon.moon}
                  </button>
                </>
              }
              tabs={NAV.map(t => ({ key: t.to, label: t.label }))}
              activeTab={NAV.find(t => t.exact ? pathname === t.to : pathname.startsWith(t.to))?.to || NAV[0].to}
              onTabChange={to => navigate(to)}
              accent="violet" />

            {/* ── 主区（Workspace 需整幅画布，故不加统一内边距，由各页自管） ── */}
            <main className="flex-1 min-h-0 overflow-auto">
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="gamemap" element={<Dashboard dark={dark} />} />
                  <Route path="gamemap/games" element={<GameLibrary />} />
                  <Route path="gamemap/games/:gameId" element={<GameWorkspace />} />
                  <Route path="gamemap/games/:gameId/chapters/:chapterId" element={<GameWorkspace />} />
                  <Route path="gamemap/relations" element={<RelationConfig dark={dark} />} />
                  <Route path="gamemap/search" element={<SearchPage dark={dark} />} />
                  <Route path="gamemap/*" element={<Navigate to="/todo/gamemap" replace />} />
                </Routes>
              </Suspense>
            </main>
          </div>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  )
}
