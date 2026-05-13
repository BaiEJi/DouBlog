import { useState, useEffect, useCallback, useMemo } from 'react'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import Fuse from 'fuse.js'
import { showRateLimitToast, isRateLimitResponse } from './toast'
import PostDetail from './PostDetail'
import CreatePost from './CreatePost'

// ─── Icons ──────────────────────────────────────────────
const Icons = {
  search: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>,
  plus: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>,
  eye: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  doc: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>,
  sun: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>,
  moon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  pin: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>,
  folder: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
  arrow: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>,
}

// ─── Post Card ──────────────────────────────────────────
function PostCard({ post }) {
  const date = new Date(post.created_at)
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

  return (
    <a href={`/post/${post.id}`} className="group block">
      <article className="relative h-full p-6 rounded-2xl border border-black/5 dark:border-white/10 bg-white dark:bg-[#111] hover:border-black/10 dark:hover:border-white/20 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:hover:shadow-[0_8px_30px_rgb(255,255,255,0.02)]">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-[#999] dark:text-[#666] font-mono">{dateStr}</span>
          {post.is_top && (
            <span className="text-amber-500">{Icons.pin}</span>
          )}
        </div>
        <h3 className="text-xl font-semibold text-[#111] dark:text-[#eee] mb-3 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors leading-snug">
          {post.title}
        </h3>
        {post.summary && (
          <p className="text-base text-[#666] dark:text-[#888] leading-relaxed mb-5 line-clamp-2">
            {post.summary}
          </p>
        )}
        <div className="flex items-center justify-between mt-auto">
          <div className="flex items-center gap-4 text-sm text-[#999] dark:text-[#666]">
            <span className="inline-flex items-center gap-1.5">{Icons.eye} {post.view_count || 0}</span>
            {post.children_count > 0 && (
              <span className="inline-flex items-center gap-1.5">{Icons.folder} {post.children_count}</span>
            )}
          </div>
          <span className="text-sm text-[#ccc] dark:text-[#444] group-hover:text-blue-500 transition-colors inline-flex items-center gap-1">
            阅读 {Icons.arrow}
          </span>
        </div>
      </article>
    </a>
  )
}

// ─── Skeleton ───────────────────────────────────────────
function PostSkeleton() {
  return (
    <div className="p-6 rounded-2xl border border-black/5 dark:border-white/10 bg-white dark:bg-[#111] animate-pulse">
      <div className="flex justify-between mb-4">
        <div className="h-4 w-24 bg-black/5 dark:bg-white/5 rounded" />
        <div className="h-4 w-4 bg-black/5 dark:bg-white/5 rounded" />
      </div>
      <div className="h-6 w-3/4 bg-black/5 dark:bg-white/5 rounded mb-3" />
      <div className="space-y-2.5 mb-5">
        <div className="h-5 bg-black/5 dark:bg-white/5 rounded w-full" />
        <div className="h-5 bg-black/5 dark:bg-white/5 rounded w-2/3" />
      </div>
      <div className="flex justify-between">
        <div className="h-4 w-20 bg-black/5 dark:bg-white/5 rounded" />
        <div className="h-4 w-16 bg-black/5 dark:bg-white/5 rounded" />
      </div>
    </div>
  )
}

// ─── Empty State ────────────────────────────────────────
function EmptyState() {
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-32 animate-fade-in">
      <div className="w-16 h-16 rounded-2xl bg-black/5 dark:bg-white/5 flex items-center justify-center mb-5 text-[#999] dark:text-[#666]">
        {Icons.doc}
      </div>
      <h3 className="text-xl font-semibold text-[#111] dark:text-[#eee] mb-2">暂无文章</h3>
      <p className="text-base text-[#666] dark:text-[#888] mb-6">创建你的第一篇文档开始使用</p>
      <Link to="/create" className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#111] dark:bg-[#eee] text-white dark:text-[#111] text-base font-medium rounded-xl hover:opacity-90 transition-opacity">
        {Icons.plus} 新建文章
      </Link>
    </div>
  )
}

// ─── Home Page ──────────────────────────────────────────
function HomePage({ dark, setDark }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const auth = btoa('admin:lizy111A')
    const host = window.location.hostname
    fetch(`http://${host}:60100/api/posts?page_size=50`, {
      headers: { 'Authorization': `Basic ${auth}` }
    })
      .then(r => {
        if (isRateLimitResponse(r)) { showRateLimitToast(); return null }
        return r.json()
      })
      .then(d => { if (d && d.success) setPosts(d.data.items || []) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const fuse = useMemo(() => {
    if (!posts.length) return null
    return new Fuse(posts, {
      keys: ['title', 'summary', 'name'],
      threshold: 0.3,
      includeScore: true,
      ignoreLocation: true,
    })
  }, [posts])

  const filtered = search.trim() && fuse
    ? fuse.search(search).map(r => r.item)
    : posts

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] text-[#111] dark:text-[#eee]">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-[#fafafa]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-black/5 dark:border-white/5">
        <div className="w-full px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-10">
            <a href="/" className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-xl bg-[#111] dark:bg-[#eee] flex items-center justify-center transition-transform group-hover:scale-105">
                <span className="text-white dark:text-[#111] text-sm font-bold">D</span>
              </div>
              <span className="text-xl font-bold tracking-tight">DouBlog</span>
            </a>
            <div className="hidden md:flex items-center gap-6 text-base text-[#666] dark:text-[#888]">
              <a href="/" className="text-[#111] dark:text-[#eee] font-medium">首页</a>
              <a href="/archive" className="hover:text-[#111] dark:hover:text-[#eee] transition-colors">归档</a>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999] dark:text-[#666]">{Icons.search}</span>
              <input
                type="text"
                placeholder="搜索文章..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-56 pl-9 pr-3 py-2.5 text-base bg-black/[0.03] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] rounded-xl text-[#111] dark:text-[#eee] placeholder:text-[#999] dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all"
              />
            </div>
            <button
              onClick={() => setDark()}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-[#666] dark:text-[#888]"
            >
              {dark ? Icons.sun : Icons.moon}
            </button>
            <Link to="/create" className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#111] dark:bg-[#eee] text-white dark:text-[#111] text-base font-medium rounded-xl hover:opacity-90 transition-opacity">
              {Icons.plus} 新建
            </Link>
          </div>
        </div>
      </nav>

      {/* Main */}
      <main className="flex-1 w-full px-8 py-16">
        <div className="mb-16 animate-fade-in-up">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight mb-4">
            思考，记录，沉淀。
          </h1>
          <p className="text-xl text-[#666] dark:text-[#888]">
            简洁高效的知识管理空间
          </p>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-lg font-semibold text-[#111] dark:text-[#eee]">全部文章</h2>
          {!loading && (
            <span className="text-base text-[#999] dark:text-[#666] tabular-nums">{filtered.length} 篇</span>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
            {[1, 2, 3, 4, 5, 6].map(i => <PostSkeleton key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
            {filtered.map(post => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-black/5 dark:border-white/5">
        <div className="w-full px-8 py-8 flex items-center justify-between text-xs text-[#ccc] dark:text-[#444]">
          <span>DouBlog &copy; 2025</span>
          <span className="tabular-nums">Built with React</span>
        </div>
      </footer>
    </div>
  )
}

// ─── App ────────────────────────────────────────────────
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
      const code = btn.closest('.code-block')?.querySelector('code')
      if (!code) return
      const text = code.textContent
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
      <Routes>
        <Route path="/" element={<HomePage dark={dark} setDark={toggleDark} />} />
        <Route path="/post/:id" element={<PostDetail dark={dark} setDark={toggleDark} />} />
        <Route path="/create" element={<CreatePost dark={dark} setDark={toggleDark} />} />
      </Routes>
    </BrowserRouter>
  )
}
