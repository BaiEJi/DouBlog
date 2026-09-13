import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { fetchAllPosts, fetchWorkspaces, createWorkspace, searchPosts, prefetchPost, fetchRecentPosts } from './api'

// 路由级代码分割：首页关键路径只含 React/路由/API 层，
// 重依赖（markdown-it/hljs/KaTeX/mermaid）随详情、编辑页按需加载
const PostDetail = lazy(() => import('./PostDetail'))
const CreatePost = lazy(() => import('./CreatePost'))
const EditPost = lazy(() => import('./EditPost'))
const AdminPage = lazy(() => import('./AdminPage'))

function PageFallback() {
  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-40 h-2 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
        <div className="h-full w-1/2 rounded-full bg-black/15 dark:bg-white/20 animate-pulse" />
      </div>
    </div>
  )
}

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
function PostCard({ post, workspaceName }) {
  const date = new Date(post.created_at)
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

  return (
    <Link to={`/post/${post.id}`} onPointerEnter={() => prefetchPost(post.id)} onFocus={() => prefetchPost(post.id)} className="group block">
      <article className="relative h-full p-6 rounded-2xl border border-black/5 dark:border-white/10 bg-white dark:bg-[#111] hover:border-black/10 dark:hover:border-white/20 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:hover:shadow-[0_8px_30px_rgb(255,255,255,0.02)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm text-[#999] dark:text-[#666] font-mono shrink-0">{dateStr}</span>
            {workspaceName && (
              <span className="px-1.5 py-0.5 text-[11px] rounded-md bg-blue-500/10 dark:bg-blue-400/15 text-blue-600 dark:text-blue-400 truncate">{workspaceName}</span>
            )}
          </div>
          {post.is_top && (
            <span className="text-amber-500 shrink-0">{Icons.pin}</span>
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
    </Link>
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

// ─── Workspace Switcher：知识库切换/新建下拉 ─────────────
function WorkspaceSwitcher({ workspaces, current, onSelect, onCreate }) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const ref = useRef(null)
  const inputRef = useRef(null)

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) close() }
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const close = () => {
    setOpen(false)
    setCreating(false)
    setName('')
    setError('')
  }

  const startCreate = () => {
    setCreating(true)
    setError('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setError('')
    const result = await onCreate(trimmed)
    setSubmitting(false)
    if (result.ok) {
      close()
    } else {
      setError(result.error || '创建失败')
    }
  }

  return (
    <div ref={ref} className="relative">
      {/* 触发按钮 */}
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="flex items-center gap-2 pl-2.5 pr-2 py-1.5 max-w-[9.5rem] sm:max-w-52 rounded-xl border border-black/[0.08] dark:border-white/[0.1]
          bg-black/[0.02] dark:bg-white/[0.05] hover:bg-black/[0.05] dark:hover:bg-white/[0.09] transition-colors"
      >
        <span className="w-5 h-5 rounded-md bg-blue-500/10 dark:bg-blue-400/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
          {Icons.folder}
        </span>
        <span className="text-sm font-medium text-[#111] dark:text-[#eee] truncate">{current ? current.name : '知识库'}</span>
        <span className="text-[#999] dark:text-[#666] shrink-0 transition-transform duration-200" style={{ transform: open ? 'rotate(180deg)' : '' }}>
          {Icons.chevron}
        </span>
      </button>

      {/* 下拉面板 */}
      {open && (
        <div className="absolute left-0 top-[calc(100%+8px)] w-64 p-1.5 rounded-2xl border border-black/[0.08] dark:border-white/[0.1]
          bg-white dark:bg-[#181818] shadow-xl shadow-black/10 dark:shadow-black/50 animate-dropdown z-50">
          {!creating ? (
            <>
              <div className="px-3 pt-2 pb-1.5 text-xs font-medium text-[#999] dark:text-[#666]">
                知识库 · {workspaces.length}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {workspaces.map(w => {
                  const active = current && w.id === current.id
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => { onSelect(w.id); close() }}
                      className={'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-colors ' + (
                        active
                          ? 'bg-blue-500/[0.08] dark:bg-blue-400/[0.12]'
                          : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                      )}
                    >
                      <span className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (active ? 'bg-blue-500 dark:bg-blue-400' : 'bg-black/15 dark:bg-white/15')} />
                      <span className={'text-sm truncate flex-1 ' + (active ? 'font-medium text-[#111] dark:text-[#eee]' : 'text-[#333] dark:text-[#ccc]')}>
                        {w.name}
                      </span>
                      <span className="text-xs text-[#999] dark:text-[#666] tabular-nums shrink-0">{w.post_count}</span>
                    </button>
                  )
                })}
              </div>
              <div className="my-1.5 h-px bg-black/[0.06] dark:bg-white/[0.08]" />
              <button
                type="button"
                onClick={startCreate}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm text-[#333] dark:text-[#ccc]
                  hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
              >
                <span className="w-5 h-5 rounded-md border border-dashed border-black/20 dark:border-white/25 flex items-center justify-center shrink-0 text-[#666] dark:text-[#999]">＋</span>
                新建知识库
              </button>
            </>
          ) : (
            <div className="p-2">
              <div className="text-xs font-medium text-[#999] dark:text-[#666] mb-2">新知识库名称</div>
              <input
                ref={inputRef}
                value={name}
                onChange={e => { setName(e.target.value); setError('') }}
                onKeyDown={e => {
                  if (e.key === 'Enter') submit()
                  if (e.key === 'Escape') { e.stopPropagation(); close() }
                }}
                placeholder="例如：读书笔记"
                maxLength={50}
                className="w-full px-3 py-2 text-sm bg-black/[0.03] dark:bg-white/[0.06] border border-black/10 dark:border-white/10
                  rounded-xl text-[#111] dark:text-[#eee] placeholder:text-[#bbb] dark:placeholder:text-[#555]
                  focus:outline-none focus:border-blue-400 transition-colors"
              />
              {error && <div className="mt-1.5 px-1 text-xs text-red-500">{error}</div>}
              <div className="flex items-center justify-end gap-2 mt-3">
                <button type="button" onClick={close} className="px-3 py-1.5 text-sm rounded-lg text-[#666] dark:text-[#999] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors">取消</button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!name.trim() || submitting}
                  className="px-3.5 py-1.5 text-sm rounded-lg bg-[#111] dark:bg-[#eee] text-white dark:text-[#111] font-medium
                    hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {submitting ? '创建中…' : '创建'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Home Page ──────────────────────────────────────────
function HomePage({ dark, setDark }) {
  const [posts, setPosts] = useState([])
  const [recent, setRecent] = useState([])
  const [workspaces, setWorkspaces] = useState([])
  const [currentWs, setCurrentWs] = useState(() => {
    const v = new URLSearchParams(window.location.search).get('ws')
    return v ? parseInt(v) : null   // null = 默认库（后端 id 最小）
  })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    Promise.all([fetchAllPosts(), fetchWorkspaces(), fetchRecentPosts(8)])
      .then(([items, wsRes, rcRes]) => {
        setPosts(items)
        if (wsRes.success) setWorkspaces(wsRes.data)
        if (rcRes.success) setRecent(rcRes.data)
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false))
  }, [])

  // 当前知识库对象（未匹配到 ?ws= 时回退第一个）
  const ws = useMemo(() => {
    return workspaces.find(w => w.id === currentWs) || workspaces[0] || null
  }, [workspaces, currentWs])

  // 切库：更新 URL（不刷新页面）
  const switchWs = (id) => {
    setCurrentWs(id)
    const url = new URL(window.location)
    url.searchParams.set('ws', id)
    window.history.replaceState(null, '', url)
  }

  // 供切换器调用的创建回调（成功后自动切换到新库）
  const handleCreateWs = async (name) => {
    try {
      const d = await createWorkspace(name)
      if (d.success) {
        setWorkspaces(prev => [...prev, d.data])
        switchWs(d.data.id)
        return { ok: true }
      }
      return { ok: false, error: d.message || '创建失败' }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  // 全文搜索：防抖走后端（标题/摘要/英文名/正文，跨所有知识库）
  const [remoteResults, setRemoteResults] = useState(null)   // null = 非搜索态
  const searchRef = useRef(null)

  useEffect(() => {
    const q = search.trim()
    if (!q) { setRemoteResults(null); return }
    let stale = false
    const t = setTimeout(async () => {
      try {
        const d = await searchPosts(q)
        if (!stale) setRemoteResults(d.success ? d.data.items : [])
      } catch {
        if (!stale) setRemoteResults([])
      }
    }, 300)
    return () => { stale = true; clearTimeout(t) }
  }, [search])

  // Ctrl/Cmd+K 聚焦搜索框
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const searching = !!search.trim() && remoteResults !== null
  const filtered = searching ? remoteResults : (ws ? posts.filter(p => p.workspace_id === ws.id) : posts)

  // 搜索结果需要显示所属库名
  const wsNameById = useMemo(() => {
    const m = {}
    workspaces.forEach(w => { m[w.id] = w.name })
    return m
  }, [workspaces])

  const wsCount = ws ? posts.filter(p => p.workspace_id === ws.id).length : posts.length

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] text-[#111] dark:text-[#eee] animate-fade-in">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-[#fafafa]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-black/5 dark:border-white/5">
        <div className="w-full px-4 sm:px-8 min-h-16 sm:h-16 py-2 sm:py-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-2.5 sm:gap-10 min-w-0">
            <Link to="/" className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-xl bg-[#111] dark:bg-[#eee] flex items-center justify-center transition-transform group-hover:scale-105">
                <span className="text-white dark:text-[#111] text-sm font-bold">D</span>
              </div>
              <span className="text-xl font-bold tracking-tight hidden sm:inline">DouBlog</span>
            </Link>
            {/* 知识库切换器 */}
            <div>
              <WorkspaceSwitcher workspaces={workspaces} current={ws} onSelect={switchWs} onCreate={handleCreateWs} />
            </div>
            <div className="hidden md:flex items-center gap-5 text-base text-[#666] dark:text-[#888] ml-1 lg:ml-4">
              <Link to="/" className="hover:text-[#111] dark:hover:text-[#eee] transition-colors">首页</Link>
              <Link to="/admin" className="hover:text-[#111] dark:hover:text-[#eee] transition-colors">管理</Link>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999] dark:text-[#666]">{Icons.search}</span>
              <input
                ref={searchRef}
                type="text"
                placeholder="搜索全部内容 ⌘K"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-28 sm:w-56 pl-9 pr-3 py-2.5 text-sm sm:text-base bg-black/[0.03] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] rounded-xl text-[#111] dark:text-[#eee] placeholder:text-[#999] dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all"
              />
            </div>
            <button
              onClick={() => setDark()}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-[#666] dark:text-[#888]"
            >
              {dark ? Icons.sun : Icons.moon}
            </button>
            <Link to={ws ? `/create?ws=${ws.id}` : '/create'} className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#111] dark:bg-[#eee] text-white dark:text-[#111] text-base font-medium rounded-xl hover:opacity-90 transition-opacity">
              {Icons.plus}<span className="hidden sm:inline">新建</span>
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

        {!loading && recent.length > 0 && !searching && (
          <div className="mb-10 animate-fade-in">
            <h2 className="text-[11px] font-semibold text-[#999] dark:text-[#555] uppercase tracking-widest mb-3 font-mono">
              最近浏览
            </h2>
            <div className="flex gap-2 flex-wrap">
              {recent.map(r => (
                <Link
                  key={r.id}
                  to={`/post/${r.id}`}
                  onPointerEnter={() => prefetchPost(r.id)}
                  className="group flex items-center gap-2 pl-3 pr-3.5 py-2 rounded-xl border border-black/5 dark:border-white/10
                    bg-white dark:bg-[#111] hover:border-black/15 dark:hover:border-white/20 hover:shadow-sm transition-all max-w-full"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500/70 dark:bg-blue-400/70 shrink-0" />
                  <span className="text-sm text-[#333] dark:text-[#ccc] group-hover:text-[#111] dark:group-hover:text-[#eee] transition-colors truncate max-w-[16rem]">
                    {r.title}
                  </span>
                  <span className="text-[11px] text-[#bbb] dark:text-[#555] shrink-0 truncate max-w-[8rem] hidden sm:inline">
                    {r.workspace_name}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-lg font-semibold text-[#111] dark:text-[#eee]">
            {searching ? `搜索“${search.trim()}” · ${filtered.length} 条` : (ws ? ws.name : '全部文章')}
          </h2>
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
              <PostCard key={post.id} post={post} workspaceName={searching ? wsNameById[post.workspace_id] : undefined} />
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

// ─── FPS Meter：右上角实时帧率徽章 ───────────────────────
// rAF 由浏览器按屏幕 vsync 派发：静态页面上读数 ≈ 屏幕刷新率
// （170Hz 屏显示 ~170，60Hz 显示 ~60），动画期间显示实际渲染帧率
function FPSMeter() {
  const [fps, setFps] = useState(0)

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let frames = 0
    let acc = 0
    const loop = (t) => {
      acc += t - last
      last = t
      frames += 1
      if (acc >= 500) {
        setFps(Math.round((frames * 1000) / acc))
        frames = 0
        acc = 0
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      className="fixed right-2 top-[70px] z-[60] px-2 py-1 rounded-lg text-[11px] font-mono tabular-nums
        bg-white/70 dark:bg-black/50 backdrop-blur border border-black/10 dark:border-white/10
        text-[#666] dark:text-[#999] select-none pointer-events-none"
      title="实时帧率 ≈ 屏幕刷新率（页面动画均为 CSS 合成器驱动，随屏幕 vsync 自适应）"
    >
      {fps || '…'} FPS
    </div>
  )
}

// ─── ScrollToTop：SPA 导航回到顶部（锚点跳转除外）────────
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0 })
  }, [pathname])
  return null
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
      // mermaid 复制源代码，普通代码块复制 code 内容
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
      <FPSMeter />
      <ScrollToTop />
      <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<HomePage dark={dark} setDark={toggleDark} />} />
        <Route path="/post/:id" element={<PostDetail dark={dark} setDark={toggleDark} />} />
        <Route path="/post/:id/edit" element={<EditPost dark={dark} setDark={toggleDark} />} />
        <Route path="/create" element={<CreatePost dark={dark} setDark={toggleDark} />} />
        <Route path="/admin" element={<AdminPage dark={dark} setDark={toggleDark} />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
