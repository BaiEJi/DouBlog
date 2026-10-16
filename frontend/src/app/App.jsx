/**
 * 应用壳：主题状态 + 统一登录守卫 + 路由表（路由级代码分割）+ 全局行为（ScrollToTop/代码块复制委托）。
 * 各能力包：portal(/) blog(/blog /post /create /admin) diary(/diary) vault(/vault) logs(/logs)
 * apihub(/apihub) config(/config) confcenter(/confcenter) clash(/clash)；公开页：/login 与 /diary/s/:token（分享）。
 */
import { lazy, Suspense, useState, useEffect, useCallback } from 'react'
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { API_BASE } from '../shared/client'
import ModuleShell from '../shared/ModuleShell'
import { moduleForPath } from '../shared/module-routes'

const HomePage = lazy(() => import('@/blog/pages/HomePage'))
const PostDetail = lazy(() => import('@/blog/pages/PostDetail'))
const CreatePost = lazy(() => import('@/blog/pages/CreatePost'))
const EditPost = lazy(() => import('@/blog/pages/EditPost'))
const AdminPage = lazy(() => import('@/blog/pages/AdminPage'))
const DiaryPage = lazy(() => import('@/diary/DiaryPage'))
const DiaryPublicShare = lazy(() => import('@/diary/PublicShare'))
const VaultPage = lazy(() => import('@/vault/VaultPage'))
const LogsPage = lazy(() => import('@/logs/LogsPage'))
const ApiHubPage = lazy(() => import('@/apihub/ApiHubPage'))
const SubsPage = lazy(() => import('@/subs/SubsPage'))
const ConfigPage = lazy(() => import('@/config/ConfigPage'))
const ConfCenterPage = lazy(() => import('@/confcenter/ConfCenterPage'))
const TodoPage = lazy(() => import('@/todo/TodoPage'))
const GamemapShell = lazy(() => import('@/gamemap/GamemapShell'))
const PracticePage = lazy(() => import('@/practice/PracticePage'))
const SteamIdlerPage = lazy(() => import('@/steamidler/SteamIdlerPage'))
const ClashPage = lazy(() => import('@/clash/ClashPage'))
const DevToolboxPage = lazy(() => import('@/devtoolbox/DevToolboxPage'))
const AssetsPage = lazy(() => import('@/assets/AssetsPage'))
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
  const { pathname } = useLocation()
  const [state, setState] = useState('checking')

  useEffect(() => {
    if (isPublicPath(pathname)) { setState('ok'); return }
    let alive = true
    fetch(`${API_BASE}/api/auth/check`, { credentials: 'include' })
      .then(r => { if (alive) setState(r.ok ? 'ok' : 'out') })
      .catch(() => { if (alive) setState('ok') })
    return () => { alive = false }
  }, [pathname])

  if (state === 'checking') return <PageFallback />
  if (state === 'out') {
    return <Navigate to={`/login?next=${encodeURIComponent(pathname)}`} replace />
  }
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

export default function App() {
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
    <BrowserRouter>
      <ScrollToTop />
      <Suspense fallback={<PageFallback />}>
        <AuthGate>
          <ModuleFrame dark={dark} setDark={toggleDark}>
          <Routes>
            <Route path="/login" element={<LoginPage dark={dark} setDark={toggleDark} />} />
            <Route path="/" element={<PortalPage dark={dark} setDark={toggleDark} />} />
            <Route path="/blog" element={<HomePage dark={dark} setDark={toggleDark} />} />
            <Route path="/post/:id" element={<PostDetail dark={dark} setDark={toggleDark} />} />
            <Route path="/post/:id/edit" element={<EditPost dark={dark} setDark={toggleDark} />} />
            <Route path="/create" element={<CreatePost dark={dark} setDark={toggleDark} />} />
            <Route path="/admin" element={<AdminPage dark={dark} setDark={toggleDark} />} />
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
            <Route path="/practice" element={<PracticePage dark={dark} setDark={toggleDark} />} />
            <Route path="/steamidler" element={<SteamIdlerPage dark={dark} setDark={toggleDark} />} />
            <Route path="/clash" element={<ClashPage dark={dark} setDark={toggleDark} />} />
            <Route path="/assets" element={<AssetsPage dark={dark} />} />
            <Route path="/devtoolbox" element={<DevToolboxPage />} />
          </Routes>
          </ModuleFrame>
        </AuthGate>
      </Suspense>
    </BrowserRouter>
  )
}
