import { useState, useEffect } from 'react'

// ─── Icons ──────────────────────────────────────────────
const Icons = {
  search: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>,
  plus: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>,
  arrow: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>,
  eye: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  clock: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
  doc: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>,
  sun: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>,
  moon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  pin: <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>,
  folder: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
}

// ─── Post Card ──────────────────────────────────────────
function PostCard({ post }) {
  const tags = post.tags
    ? (typeof post.tags === 'string' ? JSON.parse(post.tags) : post.tags)
    : []

  const date = new Date(post.created_at)
  const dateStr = `${date.getMonth() + 1}/${date.getDate()}`

  return (
    <a href={`/post/${post.id}`} className="group block">
      <article className="relative h-full p-4 rounded-xl border border-border/60 bg-card hover:border-foreground/20 transition-all duration-300">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground tracking-wide uppercase">{dateStr}</span>
            {post.children_count > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                {Icons.folder}
                {post.children_count}
              </span>
            )}
          </div>
          {post.is_top && (
            <span className="text-amber-500">{Icons.pin}</span>
          )}
        </div>

        <h3 className="text-[15px] font-semibold text-foreground mb-1.5 group-hover:text-primary transition-colors line-clamp-2">
          {post.title}
        </h3>

        {post.summary && (
          <p className="text-[13px] text-muted-foreground leading-relaxed mb-3 line-clamp-2">
            {post.summary}
          </p>
        )}

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {tags.slice(0, 3).map((tag, i) => (
              <span key={i} className="px-2 py-0.5 text-[11px] font-medium bg-secondary text-secondary-foreground rounded-md">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">{Icons.eye} {post.view_count || 0}</span>
        </div>
      </article>
    </a>
  )
}

// ─── Skeleton ───────────────────────────────────────────
function PostSkeleton() {
  return (
    <div className="p-4 rounded-xl border border-border/60 bg-card animate-pulse">
      <div className="flex justify-between mb-3">
        <div className="h-3 w-16 bg-muted rounded" />
        <div className="h-3 w-3 bg-muted rounded" />
      </div>
      <div className="h-4 w-3/4 bg-muted rounded mb-2" />
      <div className="space-y-1.5 mb-3">
        <div className="h-3 bg-muted rounded w-full" />
        <div className="h-3 bg-muted rounded w-2/3" />
      </div>
      <div className="flex gap-1.5">
        <div className="h-5 w-10 bg-muted rounded-md" />
        <div className="h-5 w-12 bg-muted rounded-md" />
      </div>
    </div>
  )
}

// ─── Empty State ────────────────────────────────────────
function EmptyState() {
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-32 animate-fade-in">
      <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4 text-muted-foreground">
        {Icons.doc}
      </div>
      <h3 className="text-base font-semibold text-foreground mb-1">暂无文章</h3>
      <p className="text-sm text-muted-foreground mb-5">创建你的第一篇文档开始使用</p>
      <button className="inline-flex items-center gap-2 px-5 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
        {Icons.plus} 新建文章
      </button>
    </div>
  )
}

// ─── App ────────────────────────────────────────────────
function App() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  useEffect(() => {
    const auth = btoa('admin:lizy111A')
    const host = window.location.hostname
    fetch(`http://${host}:60100/api/posts?page_size=50`, {
      headers: { 'Authorization': `Basic ${auth}` }
    })
      .then(r => r.json())
      .then(d => { if (d.success) setPosts(d.data.items || []) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filtered = posts.filter(p =>
    !search || p.title.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* ── Nav ────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 glass border-b border-border/40">
        <div className="w-full px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-10">
            <a href="/" className="flex items-center gap-2.5 group">
              <div className="w-7 h-7 rounded-lg bg-foreground flex items-center justify-center transition-transform group-hover:scale-105">
                <span className="text-background text-xs font-bold">D</span>
              </div>
              <span className="text-sm font-semibold tracking-tight">DouBlog</span>
            </a>
            <div className="hidden md:flex items-center gap-6 text-[13px] text-muted-foreground">
              <a href="/" className="text-foreground font-medium">首页</a>
              <a href="/archive" className="hover:text-foreground transition-colors">归档</a>
              <a href="/tags" className="hover:text-foreground transition-colors">标签</a>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">{Icons.search}</span>
              <input
                type="text"
                placeholder="搜索文章..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-56 pl-8 pr-3 py-1.5 text-[13px] bg-secondary/50 border border-border/60 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring/40 transition-all"
              />
            </div>
            <button
              onClick={() => setDark(!dark)}
              className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            >
              {dark ? Icons.sun : Icons.moon}
            </button>
            <button className="inline-flex items-center gap-2 px-4 py-1.5 bg-foreground text-background rounded-lg text-[13px] font-medium hover:opacity-90 transition-opacity">
              {Icons.plus} 新建
            </button>
          </div>
        </div>
      </nav>

      {/* ── Main Content ────────────────────────────────── */}
      <main className="flex-1 px-8 py-12">
        {/* Hero */}
        <div className="mb-12 animate-fade-in-up">
          <p className="text-[12px] font-medium text-muted-foreground mb-3 tracking-widest uppercase">Personal Docs</p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight mb-3">
            思考，记录，沉淀。
          </h1>
          <p className="text-[14px] text-muted-foreground">
            简洁高效的知识管理空间
          </p>
        </div>

        {/* Section header */}
        <div className="flex items-center gap-3 mb-5">
          <h2 className="text-sm font-semibold text-foreground">全部文章</h2>
          {!loading && (
            <span className="text-[12px] text-muted-foreground tabular-nums">{filtered.length} 篇</span>
          )}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 stagger">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <PostSkeleton key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 stagger">
            {filtered.map(post => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </main>

      {/* ── Footer ─────────────────────────────────────── */}
      <footer className="border-t border-border/40 py-6 px-8">
        <div className="flex items-center justify-between text-[12px] text-muted-foreground">
          <span>DouBlog &copy; 2025</span>
          <span className="tabular-nums">Built with React</span>
        </div>
      </footer>
    </div>
  )
}

export default App
