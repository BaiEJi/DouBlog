import PageHeader from '../shared/PageHeader'
import './board/canvas.css'
/**
 * 剧情图谱（gamemap）外壳 —— 顶级模块，替换源版 main.tsx + AppShell。
 * ModuleShell 提供公共侧栏与画布；PageHeader 将路由菜单注册到公共导航；
 * 内容区包 antd ConfigProvider（dark ? darkTheme : lightTheme 联动 Doublog，中文 locale，
 * 只作用于本子树）+ AntApp（message/modal 上下文）+ QueryClientProvider（react-query）。
 * 路由为嵌套 Routes：挂在 /gamemap/* 下（相对路径 index/games/...，与 subs 模块的
 * 子路由写法一致）；URL query（?scope=&ch=&ids=）由 Workspace 自行读写。
 */
import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { darkTheme, lightTheme } from './theme'

// 路由级代码分割：各页面按需加载（antd/xyflow 等公共依赖自动进 vendor chunk）
const Dashboard = lazy(() => import('./pages/Dashboard'))
const GameLibrary = lazy(() => import('./pages/GameLibrary'))
const GameWorkspace = lazy(() => import('./pages/GameWorkspace'))
const RelationConfig = lazy(() => import('./pages/RelationConfig'))
const SearchPage = lazy(() => import('./pages/SearchPage'))

// staleTime：15s 内的重复挂载/聚焦不重复请求（显式 invalidateQueries 仍立即刷新）

const NAV = [
  { to: '/gamemap', label: '概览', exact: true },
  { to: '/gamemap/games', label: '游戏库' },
  { to: '/gamemap/relations', label: '关系类型' },
  { to: '/gamemap/search', label: '搜索' },
]

function PageFallback() {
  return (
    <div className="h-full min-h-[60vh] flex items-center justify-center text-sm text-stone-400 dark:text-stone-500">
      加载中…
    </div>
  )
}

export default function GamemapShell({ dark }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  return (
    <ConfigProvider locale={zhCN} theme={dark ? darkTheme : lightTheme}>
      <AntApp>
          <div className="gamemap-shell flex flex-col min-h-0 bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 transition-colors">
            {/* ── 顶栏（统一 PageHeader + 路由 tabs）── */}
            <PageHeader title="剧情图谱" subtitle="游戏 · 人物 · 关系" backLabel="门户"

              tabs={NAV.map(t => ({ key: t.to, label: t.label }))}
              activeTab={NAV.find(t => t.exact ? pathname === t.to : pathname.startsWith(t.to))?.to || NAV[0].to}
              onTabChange={to => navigate(to)}
              accent="violet" hideTitle />

            {/* ── 主区（Workspace 需整幅画布，故不加统一内边距，由各页自管） ── */}
            <main className="flex-1 min-h-0">
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route index element={<Dashboard dark={dark} />} />
                  <Route path="games" element={<GameLibrary />} />
                  <Route path="games/:gameId" element={<GameWorkspace />} />
                  <Route path="games/:gameId/chapters/:chapterId" element={<GameWorkspace />} />
                  <Route path="relations" element={<RelationConfig dark={dark} />} />
                  <Route path="search" element={<SearchPage dark={dark} />} />
                  <Route path="*" element={<Navigate to="/gamemap" replace />} />
                </Routes>
              </Suspense>
            </main>
          </div>
      </AntApp>
    </ConfigProvider>
  )
}
