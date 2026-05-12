import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`
      } catch (_) {}
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
  }
})

const Icons = {
  search: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>,
  plus: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>,
  sun: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>,
  moon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  eye: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  clock: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
  chevron: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>,
  chevronRight: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>,
  doc: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>,
  folder: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
}

// ─── 目录树（带记忆） ────────────────────────────────────
const treeLevelColors = [
  'text-[#111] dark:text-[#eee] font-semibold', // level 0 - bold, strongest
  'text-[#333] dark:text-[#ddd]',                // level 1
  'text-[#666] dark:text-[#999]',                // level 2
  'text-[#888] dark:text-[#777]',                // level 3+
]

function TreeNode({ node, activeId, level = 0, expandedMap, onToggle }) {
  const isActive = node.id === activeId
  const hasChildren = node.children && node.children.length > 0
  const isDefaultExpanded = hasChildren && isAncestor(node, activeId)
  const expanded = expandedMap[node.id] !== undefined ? expandedMap[node.id] : isDefaultExpanded
  const levelColor = treeLevelColors[Math.min(level, treeLevelColors.length - 1)]

  return (
    <div>
      <a
        href={`/post/${node.id}`}
        className={`flex items-center py-1.5 text-[13px] font-mono rounded-md transition-all duration-150 ${
          isActive
            ? 'bg-black/5 dark:bg-white/10 text-[#111] dark:text-[#eee] font-medium'
            : `${levelColor} hover:bg-black/[0.03] dark:hover:bg-white/[0.05] hover:text-[#111] dark:hover:text-[#eee]`
        }`}
        style={{ paddingLeft: `${12 + level * 16 + (level > 0 ? 10 : 0)}px`, paddingRight: '8px' }}
      >
        {/* 箭头区域：固定宽度，保证文字对齐 */}
        <span className="w-5 shrink-0 flex items-center justify-center">
          {hasChildren && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(node.id) }}
              className="p-0.5"
            >
              <span className={`block transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`}>
                {Icons.chevron}
              </span>
            </button>
          )}
        </span>
        <span className="truncate ml-1">{node.title}</span>
      </a>
      {hasChildren && expanded && (
        <div>
          {node.children.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              activeId={activeId}
              level={level + 1}
              expandedMap={expandedMap}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// 判断是否是某个节点的祖先
function isAncestor(node, targetId) {
  if (node.id === targetId) return true
  if (!node.children) return false
  return node.children.some(child => isAncestor(child, targetId))
}

// ─── 右侧 TOC ──────────────────────────────────────────
function TableOfContents({ headings, activeId }) {
  if (!headings.length) return null

  return (
    <div className="sticky top-24">
      <h4 className="text-[11px] font-semibold text-[#999] dark:text-[#555] uppercase tracking-widest mb-4 font-mono">
        目录
      </h4>
      <nav className="space-y-1">
        {headings.map((h, i) => {
          const isActive = activeId === h.id
          return (
            <a
              key={i}
              href={`#${h.id}`}
              className={`block py-1 text-[14px] font-mono transition-colors duration-150 border-l-2 ${
                isActive
                  ? 'border-[#111] dark:border-[#eee] text-[#111] dark:text-[#eee] font-medium'
                  : 'border-transparent text-[#999] dark:text-[#555] hover:text-[#666] dark:hover:text-[#999]'
              }`}
              style={{ paddingLeft: `${8 + (h.level - 1) * 12}px` }}
            >
              {h.text}
            </a>
          )
        })}
      </nav>
    </div>
  )
}

// ─── 阅读页 ────────────────────────────────────────────
export default function PostDetail({ dark, setDark }) {
  const { id } = useParams()
  const [post, setPost] = useState(null)
  const [tree, setTree] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTocId, setActiveTocId] = useState('')
  const [expandedMap, setExpandedMap] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('doublog_tree_expanded') || '{}')
    } catch { return {} }
  })

  // 保存展开状态到 localStorage
  const toggleExpand = (nodeId) => {
    setExpandedMap(prev => {
      const next = { ...prev, [nodeId]: !prev[nodeId] }
      localStorage.setItem('doublog_tree_expanded', JSON.stringify(next))
      return next
    })
  }

  useEffect(() => {
    const controller = new AbortController()
    const auth = btoa('admin:lizy111A')
    const host = window.location.hostname
    const headers = { 'Authorization': `Basic ${auth}` }

    setLoading(true)

    Promise.all([
      fetch(`http://${host}:60100/api/posts/id/${id}`, { headers, signal: controller.signal }).then(r => r.json()),
      fetch(`http://${host}:60100/api/posts/tree`, { headers, signal: controller.signal }).then(r => r.json())
    ])
      .then(([postRes, treeRes]) => {
        if (postRes.success) setPost(postRes.data)
        if (treeRes.success) setTree(treeRes.data)
      })
      .catch(err => {
        if (err.name !== 'AbortError') console.error(err)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [id])

  const { html, headings } = useMemo(() => {
    if (!post?.content) return { html: '', headings: [] }

    const rendered = md.render(post.content)

    const headingRegex = /<h([1-6])\s*(?:id="([^"]*)")?[^>]*>([^<]+)<\/h\1>/g
    const extracted = []
    let match
    while ((match = headingRegex.exec(rendered)) !== null) {
      extracted.push({
        level: parseInt(match[1]),
        id: match[2] || `heading-${match.index}`,
        text: match[3].trim()
      })
    }

    let processed = rendered
    let idx = 0
    processed = processed.replace(/<h([1-6])>([^<]+)<\/h\1>/g, (_, level, text) => {
      const hId = `heading-${idx++}`
      return `<h${level} id="${hId}">${text}</h${level}>`
    })

    return { html: processed, headings: extracted }
  }, [post?.content])

  useEffect(() => {
    if (!headings.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveTocId(entry.target.id)
          }
        }
      },
      { rootMargin: '-80px 0px -70% 0px' }
    )

    headings.forEach(h => {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [headings])

  const date = post ? new Date(post.created_at) : null
  const dateStr = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : ''

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a]">
        <div className="h-16 border-b border-black/5 dark:border-white/5 bg-[#fafafa]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl" />
        <div className="flex items-center justify-center py-32">
          <div className="text-sm text-[#999] dark:text-[#555]">加载中...</div>
        </div>
      </div>
    )
  }

  if (!post) {
    return (
      <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a]">
        <div className="h-16 border-b border-black/5 dark:border-white/5 bg-[#fafafa]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl" />
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <p className="text-[#999] dark:text-[#555] mb-4">文章不存在</p>
            <Link to="/" className="text-sm text-[#111] dark:text-[#eee] hover:underline">返回首页</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] text-[#111] dark:text-[#eee]">
      {/* ── Nav ────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-[#fafafa]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-black/5 dark:border-white/5">
        <div className="w-full px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-10">
            <Link to="/" className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-xl bg-[#111] dark:bg-[#eee] flex items-center justify-center transition-transform group-hover:scale-105">
                <span className="text-white dark:text-[#111] text-sm font-bold">D</span>
              </div>
              <span className="text-xl font-bold tracking-tight">DouBlog</span>
            </Link>
            <div className="hidden md:flex items-center gap-6 text-base text-[#666] dark:text-[#888]">
              <Link to="/" className="hover:text-[#111] dark:hover:text-[#eee] transition-colors">首页</Link>
              <a href="/archive" className="hover:text-[#111] dark:hover:text-[#eee] transition-colors">归档</a>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999] dark:text-[#555]">{Icons.search}</span>
              <input
                type="text"
                placeholder="搜索文章..."
                className="w-56 pl-9 pr-3 py-2.5 text-base bg-black/[0.03] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] rounded-xl text-[#111] dark:text-[#eee] placeholder:text-[#999] dark:placeholder:text-[#555] focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all"
              />
            </div>
            <button
              onClick={() => setDark(!dark)}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-[#666] dark:text-[#888]"
            >
              {dark ? Icons.sun : Icons.moon}
            </button>
          </div>
        </div>
      </nav>

      {/* ── Layout ─────────────────────────────────────── */}
      <div className="flex w-full">
        {/* Left Sidebar */}
        <aside className="hidden lg:block w-64 shrink-0 border-r border-black/5 dark:border-white/5 h-[calc(100vh-64px)] sticky top-16 overflow-y-auto py-6 px-3">
          <div className="mb-4 px-2">
            <div className="text-[11px] font-semibold text-[#999] dark:text-[#555] uppercase tracking-widest">
              文档
            </div>
          </div>
          <div className="space-y-0.5">
            {tree.map(node => (
              <TreeNode
                key={node.id}
                node={node}
                activeId={parseInt(id)}
                expandedMap={expandedMap}
                onToggle={toggleExpand}
              />
            ))}
          </div>
        </aside>

        {/* Center Content */}
        <article className="flex-1 min-w-0 h-[calc(100vh-64px)] overflow-y-auto">
          <div className="max-w-3xl mx-auto px-10 py-14">
            {post.parent && (
              <div className="flex items-center gap-2 text-sm text-[#999] dark:text-[#555] mb-6">
                <Link to="/" className="hover:text-[#111] dark:hover:text-[#eee] transition-colors">首页</Link>
                <span>/</span>
                <span className="text-[#666] dark:text-[#888]">{post.parent.title}</span>
                <span>/</span>
                <span className="text-[#111] dark:text-[#eee]">{post.title}</span>
              </div>
            )}

            <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight mb-4">
              {post.title}
            </h1>

            <div className="flex items-center gap-5 text-sm text-[#999] dark:text-[#555] mb-10 pb-8 border-b border-black/5 dark:border-white/5">
              <span className="inline-flex items-center gap-1.5">{Icons.eye} {post.view_count}</span>
              <span className="inline-flex items-center gap-1.5">{Icons.clock} {dateStr}</span>
              {post.children && post.children.length > 0 && (
                <span className="inline-flex items-center gap-1.5">{Icons.folder} {post.children.length} 篇</span>
              )}
            </div>

            <div className="prose-content font-mono" dangerouslySetInnerHTML={{ __html: html }} />

            {post.children && post.children.length > 0 && (
              <div className="mt-16 pt-10 border-t border-black/5 dark:border-white/5">
                <h3 className="text-[11px] font-semibold text-[#999] dark:text-[#555] uppercase tracking-widest mb-5">
                  子文章
                </h3>
                <div className="space-y-2">
                  {post.children.map(child => (
                    <Link
                      key={child.id}
                      to={`/post/${child.id}`}
                      className="flex items-center gap-4 px-5 py-4 rounded-xl border border-black/5 dark:border-white/10 bg-white dark:bg-[#111] hover:border-black/10 dark:hover:border-white/20 transition-all duration-200 group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-black/[0.03] dark:bg-white/[0.06] flex items-center justify-center text-[#999] dark:text-[#555] group-hover:bg-black/[0.06] dark:group-hover:bg-white/10 transition-colors">
                        {Icons.doc}
                      </div>
                      <span className="text-[15px] font-medium">{child.title}</span>
                      <span className="ml-auto text-[#ccc] dark:text-[#444] group-hover:text-[#999] dark:group-hover:text-[#666] transition-colors">
                        {Icons.chevronRight}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-16 pt-8 border-t border-black/5 dark:border-white/5">
              <Link to="/" className="text-sm text-[#999] dark:text-[#555] hover:text-[#111] dark:hover:text-[#eee] transition-colors">
                &larr; 返回首页
              </Link>
            </div>
          </div>
        </article>

        {/* Right TOC */}
        <aside className="hidden xl:block w-52 shrink-0 h-[calc(100vh-64px)] sticky top-16 overflow-y-auto py-14 px-4">
          <TableOfContents headings={headings} activeId={activeTocId} />
        </aside>
      </div>
    </div>
  )
}
