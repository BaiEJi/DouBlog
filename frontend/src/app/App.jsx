/**
 * 应用壳：主题状态 + 统一登录守卫 + 路由表（路由级代码分割）+ 全局行为（ScrollToTop/代码块复制委托）。
 * 各能力包：portal(/) blog(/blog /post /create /assets /diary /bookmarks) vault(/vault) logs(/logs)
 * apihub(/apihub) config(/config) confcenter(/confcenter) clash(/clash)；
 * diary 与 bookmarks 已并入 blog 模块（src/blog/ 下，侧栏 tab 展示）。
 * 公开页：/login 与 /diary/s/:token（分享）。
 */
import { lazy, Suspense, useState, useEffect, useCallback, useSyncExternalStore } from 'react'
import { BrowserRouter, Routes, Route, useLocation, Navigate, Link } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../shared/queryClient'
import { checkSession } from '../shared/authSession'
import { getDataEpoch, subscribeDataEpoch, isDataContextStale, subscribeDataContext } from '../shared/dataEpoch'
import ModuleErrorBoundary from '../shared/ModuleErrorBoundary'
import ModuleShell from '../shared/ModuleShell'
import { moduleForPath } from '../shared/module-routes'

const HomePage = lazy(() => import('@/blog/pages/HomePage'))
const PostDetail = lazy(() => import('@/blog/pages/PostDetail'))
const CreatePost = lazy(() => import('@/blog/pages/CreatePost'))
const EditPost = lazy(() => import('@/blog/pages/EditPost'))
const DiaryPage = lazy(() => import('@/blog/diary/DiaryPage'))
const DiaryPublicShare = lazy(() => import('@/blog/diary/PublicShare'))
const VaultPage = lazy(() => import('@/vault/VaultPage'))
const LogsPage = lazy(() => import('@/logs/LogsPage'))
const ApiHubPage = lazy(() => import('@/apihub/ApiHubPage'))
const SubsPage = lazy(() => import('@/subs/SubsPage'))
const ConfigPage = lazy(() => import('@/config/ConfigPage'))
const ConfCenterPage = lazy(() => import('@/confcenter/ConfCenterPage'))
const TodoPage = lazy(() => import('@/todo/TodoPage'))
const GamemapShell = lazy(() => import('@/gamemap/GamemapShell'))
const MindmapPage = lazy(() => import('@/mindmap/MindmapPage'))
const PracticePage = lazy(() => import('@/practice/PracticePage'))
const SteamIdlerPage = lazy(() => import('@/steamidler/SteamIdlerPage'))
const ClashPage = lazy(() => import('@/clash/ClashPage'))
const DevToolboxPage = lazy(() => import('@/devtoolbox/DevToolboxPage'))
const AssetsPage = lazy(() => import('@/blog/assets/AssetsPage'))
const BookmarksPage = lazy(() => import('@/blog/bookmarks/BookmarksPage'))
const PortalPage = lazy(() => import('@/portal/PortalPage'))
const LoginPage = lazy(() => import('@/app/LoginPage'))

/** 免登录路径：登录页本身 + 日记公开分享页 */
function isPublicPath(pathname) {
  return pathname === '/login' || pathname.startsWith('/diary/s/')
}

/**
 * 统一登录守卫：挂载时查会话（/api/auth/check，带 Cookie），
 * 未登录跳 /login?next=<原路径>；后端不可达时放行（由 apiFetch 的 401 兜底重定向）。
 */
function AuthGate({ children }) {
  const { pathname, search, hash, key } = useLocation()
  const [state, setState] = useState({ pathname: null, key: null, status: 'checking' })

  useEffect(() => {
    if (isPublicPath(pathname)) return
    let alive = true
    checkSession({ force: pathname === '/' }).then(status => { if (alive) setState({ pathname, key, status }) })
    return () => { alive = false }
  }, [pathname, key])

  // Public routes must render immediately: an earlier rejected check must not
  // rewrite /login?next=/mindmap/... to /login?next=/login during navigation.
  if (isPublicPath(pathname)) return children
  if (state.pathname !== pathname || state.status === 'checking'
      || (state.status === 'out' && state.key !== key)) return <PageFallback />
  if (state.status === 'out') {
    return <Navigate to={`/login?next=${encodeURIComponent(pathname + search + hash)}`} replace />
  }
  if (state.status === 'unavailable') return <div className="min-h-screen bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 flex items-center justify-center"><div role="alert" className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.04] p-6"><p className="text-base font-semibold">暂时无法确认服务状态</p><p className="mt-2 text-sm text-stone-500 dark:text-stone-400">服务恢复后重试，登录状态未被清除。</p><button className="mt-4 px-4 py-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm" onClick={() => window.location.reload()}>重试</button></div></div>
  return children
}

function PageFallback() {
  return (
    <div className="min-h-screen bg-stone-50 dark:bg-[#100f0e] flex items-center justify-center">
      <div className="w-40 h-2 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
        <div className="h-full w-1/2 rounded-full bg-black/15 dark:bg-white/20 animate-pulse" />
      </div>
    </div>
  )
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0 })
  }, [pathname])
}

function ModuleFrame({ dark, setDark, children }) {
  const { pathname } = useLocation()
  const module = moduleForPath(pathname)
  if (!module || isPublicPath(pathname)) return children
  return <ModuleShell key={module} module={module} dark={dark} setDark={setDark}>{children}</ModuleShell>
}

function RouteBoundary({ children }) {
  const { pathname } = useLocation()
  return <ModuleErrorBoundary resetKey={pathname}>{children}</ModuleErrorBoundary>
}
function NotFound() {
  return <div className="min-h-[60vh] flex flex-col items-center justify-center bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100"><p className="text-5xl font-mono text-stone-300 dark:text-stone-600">404</p><h1 className="text-2xl font-semibold mt-4">页面不存在</h1><Link className="mt-5 px-4 py-2 rounded-lg text-sm bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900" to="/">返回工作台</Link></div>
}

function DataContextNotice() {
  const stale = useSyncExternalStore(subscribeDataContext, isDataContextStale, isDataContextStale)
  if (!stale) return null
  return <div role="alert" className="fixed top-3 left-1/2 -translate-x-1/2 z-[10000] max-w-3xl rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 text-amber-950 dark:text-amber-100 shadow-xl px-5 py-3 text-sm flex items-center gap-4"><p>数据库已在其他页面切换。请先复制或下载未保存内容，再重新加载页面。</p><button type="button" className="shrink-0 rounded-lg border border-amber-400 dark:border-amber-600 px-3 py-1.5 font-medium" onClick={() => window.location.reload()}>重新加载</button></div>
}

export default function App() {
  const dataEpoch = useSyncExternalStore(subscribeDataEpoch, getDataEpoch, getDataEpoch)
  const [dark, setDark] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('doublog_dark')
      if (saved !== null) return saved === 'true'
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return false
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('doublog_dark', dark)
  }, [dark])

  const toggleDark = useCallback(() => {
    document.documentElement.classList.add('transitioning')
    setDark(prev => !prev)
    setTimeout(() => document.documentElement.classList.remove('transitioning'), 350)
  }, [])

  // 全局代码块复制按钮（事件委托）
  useEffect(() => {
    const handler = (e) => {
      const btn = e.target.closest('.code-block-copy')
      if (!btn) return
      const mermaidSource = btn.getAttribute('data-mermaid-source')
      const code = btn.closest('.code-block')?.querySelector('code')
      const text = mermaidSource || code?.textContent
      if (!text) return
      const showCopied = () => {
        btn.textContent = '已复制'
        setTimeout(() => { btn.textContent = '复制' }, 1500)
      }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(showCopied)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.cssText = 'position:fixed;left:-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        showCopied()
      }
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  return (
    <QueryClientProvider client={queryClient}><BrowserRouter><DataContextNotice />
      <ScrollToTop />
      <Suspense fallback={<PageFallback />}>
        <AuthGate key={dataEpoch}><RouteBoundary>
          <ModuleFrame dark={dark} setDark={toggleDark}>
          <Routes>
            <Route path="/login" element={<LoginPage dark={dark} setDark={toggleDark} />} />
            <Route path="/" element={<PortalPage dark={dark} setDark={toggleDark} />} />
            <Route path="/blog" element={<HomePage dark={dark} setDark={toggleDark} />} />
            <Route path="/post/:id" element={<PostDetail dark={dark} setDark={toggleDark} />} />
            <Route path="/post/:id/edit" element={<EditPost dark={dark} setDark={toggleDark} />} />
            <Route path="/create" element={<CreatePost dark={dark} setDark={toggleDark} />} />
            <Route path="/admin" element={<Navigate to="/blog" replace />} />
            <Route path="/diary" element={<DiaryPage dark={dark} setDark={toggleDark} />} />
            <Route path="/diary/s/:token" element={<DiaryPublicShare dark={dark} />} />
            <Route path="/vault" element={<VaultPage dark={dark} setDark={toggleDark} />} />
            <Route path="/logs" element={<LogsPage dark={dark} setDark={toggleDark} />} />
            <Route path="/apihub" element={<ApiHubPage dark={dark} setDark={toggleDark} />} />
            <Route path="/subs/*" element={<SubsPage dark={dark} setDark={toggleDark} />} />
            <Route path="/config" element={<ConfigPage dark={dark} setDark={toggleDark} />} />
            <Route path="/confcenter" element={<ConfCenterPage dark={dark} setDark={toggleDark} />} />
            <Route path="/todo/*" element={<TodoPage dark={dark} setDark={toggleDark} />} />
            <Route path="/gamemap/*" element={<GamemapShell dark={dark} setDark={toggleDark} />} />
            <Route path="/mindmap/*" element={<MindmapPage dark={dark} />} />
            <Route path="/practice" element={<PracticePage dark={dark} setDark={toggleDark} />} />
            <Route path="/steamidler" element={<SteamIdlerPage dark={dark} setDark={toggleDark} />} />
            <Route path="/clash" element={<ClashPage dark={dark} setDark={toggleDark} />} />
            <Route path="/assets" element={<AssetsPage dark={dark} />} />
            <Route path="/devtoolbox" element={<DevToolboxPage />} />
            <Route path="/bookmarks" element={<BookmarksPage dark={dark} setDark={toggleDark} />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </ModuleFrame>
        </RouteBoundary></AuthGate>
      </Suspense>
    </BrowserRouter></QueryClientProvider>
  )
}
