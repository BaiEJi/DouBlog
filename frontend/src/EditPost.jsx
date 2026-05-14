import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import md from './md'
import mermaid from 'mermaid'
import { showRateLimitToast, isRateLimitResponse } from './toast'

const Icons = {
  search: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>,
  sun: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>,
  moon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  bold: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>,
  italic: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>,
  heading: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4v16"/><path d="M18 4v16"/><path d="M6 12h12"/></svg>,
  code: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  codeBlock: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m10 8-3 4 3 4"/><path d="m14 8 3 4-3 4"/></svg>,
  link: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
  image: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  quote: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z"/></svg>,
  list: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
}

const NAME_RE = /^[a-zA-Z][a-zA-Z0-9-]{2,99}$/

function flattenTree(nodes, level = 0) {
  const result = []
  for (const node of nodes) {
    result.push({ id: node.id, title: node.title, level })
    if (node.children && node.children.length > 0) {
      result.push(...flattenTree(node.children, level + 1))
    }
  }
  return result
}

const TOOLBAR_BTNS = [
  { icon: Icons.bold, label: '加粗', before: '**', after: '**' },
  { icon: Icons.italic, label: '斜体', before: '*', after: '*' },
  { icon: Icons.heading, label: '标题', before: '## ', after: '' },
  { icon: Icons.code, label: '行内代码', before: '`', after: '`' },
  { icon: Icons.codeBlock, label: '代码块', before: '\n```\n', after: '\n```\n' },
  { icon: Icons.link, label: '链接', before: '[', after: '](url)' },
  { icon: Icons.image, label: '图片', before: '![', after: '](url)' },
  { icon: Icons.quote, label: '引用', before: '> ', after: '' },
  { icon: Icons.list, label: '列表', before: '- ', after: '' },
]

export default function EditPost({ dark, setDark }) {
  const navigate = useNavigate()
  const { id } = useParams()
  const [title, setTitle] = useState('')
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [summary, setSummary] = useState('')
  const [parentId, setParentId] = useState('')
  const [status, setStatus] = useState('published')
  const [tree, setTree] = useState([])
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  // 加载文章数据
  useEffect(() => {
    const auth = btoa('admin:lizy111A')
    const host = window.location.hostname

    // 并行加载文章详情和树结构
    Promise.all([
      fetch(`http://${host}:60100/api/posts/id/${id}`, {
        headers: { 'Authorization': `Basic ${auth}` }
      }).then(r => {
        if (isRateLimitResponse(r)) { showRateLimitToast(); return null }
        return r.json()
      }),
      fetch(`http://${host}:60100/api/posts/tree`, {
        headers: { 'Authorization': `Basic ${auth}` }
      }).then(r => {
        if (isRateLimitResponse(r)) { showRateLimitToast(); return null }
        return r.json()
      })
    ])
      .then(([postRes, treeRes]) => {
        if (postRes && postRes.success) {
          const p = postRes.data
          setTitle(p.title || '')
          setName(p.name || '')
          setContent(p.content || '')
          setSummary(p.summary || '')
          setParentId(p.parent_id ? String(p.parent_id) : '')
          setStatus(p.status || 'published')
        } else {
          setLoadError(postRes?.message || '文章不存在')
        }
        if (treeRes && treeRes.success) {
          setTree(treeRes.data || [])
        }
      })
      .catch(() => setLoadError('网络错误，请重试'))
      .finally(() => setLoading(false))
  }, [id])

  const flatPosts = useMemo(() => flattenTree(tree), [tree])

  const previewHtml = useMemo(() => md.render(content || ''), [content])

  // Mermaid 渲染
  useEffect(() => {
    if (!previewHtml) return
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: dark ? {
        primaryColor: '#1e3a5f', primaryBorderColor: '#3b82f6', primaryTextColor: '#e0e7ff',
        secondaryColor: '#422006', tertiaryColor: '#052e16',
        lineColor: '#9ca3af', arrowheadColor: '#9ca3af',
        background: '#0d1117', mainBkg: '#1e3a5f', nodeBkg: '#1e3a5f', nodeBorder: '#3b82f6',
        clusterBkg: '#0c1629', clusterBorder: '#1e40af',
        textColor: '#e5e7eb', titleColor: '#f9fafb', edgeLabelBackground: '#161b22',
        fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", "JetBrains Mono", "Source Code Pro", "Menlo", "Monaco", "Consolas", monospace', fontSize: '14px',
        radius: 8, strokeWidth: 1.5, useGradient: true,
        actorBkg: '#1e3a5f', actorBorder: '#3b82f6', actorTextColor: '#e0e7ff',
        signalColor: '#d1d5db', signalTextColor: '#f9fafb',
        activationBorderColor: '#3b82f6', activationBkgColor: '#172554',
        taskBkgColor: '#1e3a5f', taskBorderColor: '#3b82f6',
        doneTaskBkgColor: '#14532d', doneTaskBorderColor: '#22c55e',
        critBorderColor: '#dc2626', critBkgColor: '#450a0a', todayLineColor: '#3b82f6',
      } : {
        primaryColor: '#dbeafe', primaryBorderColor: '#3b82f6', primaryTextColor: '#1e3a5f',
        secondaryColor: '#fef3c7', tertiaryColor: '#f0fdf4',
        lineColor: '#6b7280', arrowheadColor: '#6b7280',
        background: '#ffffff', mainBkg: '#dbeafe', nodeBkg: '#dbeafe', nodeBorder: '#3b82f6',
        clusterBkg: '#f0f9ff', clusterBorder: '#93c5fd',
        textColor: '#1f2937', titleColor: '#111827', edgeLabelBackground: '#ffffff',
        fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", "JetBrains Mono", "Source Code Pro", "Menlo", "Monaco", "Consolas", monospace', fontSize: '14px',
        radius: 8, strokeWidth: 1.5, useGradient: true,
        actorBkg: '#dbeafe', actorBorder: '#3b82f6', actorTextColor: '#1e3a5f',
        signalColor: '#374151', signalTextColor: '#111827',
        activationBorderColor: '#3b82f6', activationBkgColor: '#eff6ff',
        taskBkgColor: '#dbeafe', taskBorderColor: '#3b82f6',
        doneTaskBkgColor: '#86efac', doneTaskBorderColor: '#22c55e',
        critBorderColor: '#ef4444', critBkgColor: '#fef2f2', todayLineColor: '#3b82f6',
      }
    })
    let cancelled = false

    const renderMermaid = async () => {
      if (cancelled) return
      try {
        await mermaid.run({ querySelector: '.mermaid:not([data-processed])' })
      } catch (e) {
        console.error('Mermaid render error:', e)
      }
    }

    const timer = setTimeout(renderMermaid, 100)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [previewHtml, dark])

  // Lightbox: 点击图片放大查看
  const [lightbox, setLightbox] = useState(null)
  const lightboxZoom = useRef(1)
  const lightboxRef = useRef(null)
  lightboxRef.current = setLightbox

  // 事件委托：在容器上统一处理图片点击，不受 React 重渲染影响
  useEffect(() => {
    const handler = (e) => {
      const img = e.target.closest('.prose-content img')
      if (img) {
        e.preventDefault()
        lightboxRef.current({ src: img.src, alt: img.alt || '' })
      }
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  const lightboxZoomIn = () => {
    lightboxZoom.current = Math.min(lightboxZoom.current + 0.25, 5)
    const el = document.getElementById('lightbox-img')
    if (el) el.style.transform = `scale(${lightboxZoom.current})`
  }
  const lightboxZoomOut = () => {
    lightboxZoom.current = Math.max(lightboxZoom.current - 0.25, 0.5)
    const el = document.getElementById('lightbox-img')
    if (el) el.style.transform = `scale(${lightboxZoom.current})`
  }
  const lightboxClose = () => { setLightbox(null); lightboxZoom.current = 1 }

  useEffect(() => {
    if (!lightbox) return
    const handler = (e) => {
      if (e.key === 'Escape') lightboxClose()
      if (e.key === '+' || e.key === '=') lightboxZoomIn()
      if (e.key === '-') lightboxZoomOut()
    }
    const wheelHandler = (e) => {
      e.preventDefault()
      if (e.deltaY < 0) lightboxZoomIn()
      else lightboxZoomOut()
    }
    document.addEventListener('keydown', handler)
    const overlay = document.getElementById('lightbox-overlay')
    if (overlay) overlay.addEventListener('wheel', wheelHandler, { passive: false })
    return () => {
      document.removeEventListener('keydown', handler)
      if (overlay) overlay.removeEventListener('wheel', wheelHandler)
    }
  }, [lightbox])

  const validate = () => {
    const e = {}
    if (!title.trim()) e.title = '标题不能为空'
    if (!name.trim()) e.name = 'slug 不能为空'
    else if (!NAME_RE.test(name)) e.name = '格式：字母开头，仅字母数字连字符，3-100字符'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setSubmitting(true)
    setServerError('')

    try {
      const auth = btoa('admin:lizy111A')
      const host = window.location.hostname
      const res = await fetch(`http://${host}:60100/api/posts/id/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        },
        body: JSON.stringify({
          title: title.trim(),
          content,
          summary: summary.trim() || undefined,
        })
      })
      if (isRateLimitResponse(res)) { showRateLimitToast(); return }
      const data = await res.json()
      if (data.success) {
        navigate(`/post/${id}`)
      } else {
        setServerError(data.message || '保存失败')
      }
    } catch (err) {
      setServerError('网络错误，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const insertAtCursor = (before, after) => {
    const textarea = document.getElementById('md-editor')
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = content.substring(start, end)
    const newText = content.substring(0, start) + before + selected + after + content.substring(end)
    setContent(newText)
    setTimeout(() => {
      textarea.focus()
      textarea.selectionStart = start + before.length
      textarea.selectionEnd = start + before.length + selected.length
    }, 0)
  }

  // 加载中
  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] text-[#111] dark:text-[#eee]">
        <nav className="sticky top-0 z-50 bg-[#fafafa]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-black/5 dark:border-white/5">
          <div className="w-full px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-10">
              <Link to="/" className="flex items-center gap-2.5 group">
                <div className="w-9 h-9 rounded-xl bg-[#111] dark:bg-[#eee] flex items-center justify-center transition-transform group-hover:scale-105">
                  <span className="text-white dark:text-[#111] text-sm font-bold">D</span>
                </div>
                <span className="text-xl font-bold tracking-tight">DouBlog</span>
              </Link>
            </div>
          </div>
        </nav>
        <main className="max-w-6xl mx-auto px-8 py-10">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-32 bg-black/5 dark:bg-white/5 rounded" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="h-10 bg-black/5 dark:bg-white/5 rounded-lg" />
              <div className="h-10 bg-black/5 dark:bg-white/5 rounded-lg" />
              <div className="h-10 bg-black/5 dark:bg-white/5 rounded-lg" />
              <div className="h-10 bg-black/5 dark:bg-white/5 rounded-lg" />
            </div>
            <div className="h-20 bg-black/5 dark:bg-white/5 rounded-lg" />
            <div className="h-[500px] bg-black/5 dark:bg-white/5 rounded-xl" />
          </div>
        </main>
      </div>
    )
  }

  // 加载失败
  if (loadError) {
    return (
      <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] text-[#111] dark:text-[#eee]">
        <nav className="sticky top-0 z-50 bg-[#fafafa]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-black/5 dark:border-white/5">
          <div className="w-full px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-10">
              <Link to="/" className="flex items-center gap-2.5 group">
                <div className="w-9 h-9 rounded-xl bg-[#111] dark:bg-[#eee] flex items-center justify-center transition-transform group-hover:scale-105">
                  <span className="text-white dark:text-[#111] text-sm font-bold">D</span>
                </div>
                <span className="text-xl font-bold tracking-tight">DouBlog</span>
              </Link>
            </div>
          </div>
        </nav>
        <main className="max-w-6xl mx-auto px-8 py-10">
          <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">
            {loadError}
          </div>
          <Link to="/" className="inline-block mt-4 text-sm text-[#666] dark:text-[#888] hover:text-[#111] dark:hover:text-[#eee] transition-colors">
            &larr; 返回首页
          </Link>
        </main>
      </div>
    )
  }

  const parentTitle = flatPosts.find(p => String(p.id) === parentId)?.title || ''

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] text-[#111] dark:text-[#eee]">
      {/* Nav */}
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
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDark()}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-[#666] dark:text-[#888]"
            >
              {dark ? Icons.sun : Icons.moon}
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-8 py-10">
        <h1 className="text-2xl font-bold mb-8">编辑文章</h1>

        {/* Meta Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-[13px] font-medium text-[#666] dark:text-[#888] mb-1">标题 *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="文章标题"
              className={`w-full px-3 py-2 text-[14px] font-mono bg-white dark:bg-[#111] border rounded-lg text-[#111] dark:text-[#eee] placeholder:text-[#bbb] dark:placeholder:text-[#555] focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all ${errors.title ? 'border-red-400' : 'border-black/10 dark:border-white/10'}`}
            />
            {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title}</p>}
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[#666] dark:text-[#888] mb-1">slug</label>
            <input
              type="text"
              value={name}
              disabled
              className="w-full px-3 py-2 text-[14px] font-mono bg-black/[0.02] dark:bg-white/[0.03] border border-black/10 dark:border-white/10 rounded-lg text-[#999] dark:text-[#666] cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[#666] dark:text-[#888] mb-1">父文章</label>
            <input
              type="text"
              value={parentTitle || '无（顶级文章）'}
              disabled
              className="w-full px-3 py-2 text-[14px] font-mono bg-black/[0.02] dark:bg-white/[0.03] border border-black/10 dark:border-white/10 rounded-lg text-[#999] dark:text-[#666] cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[#666] dark:text-[#888] mb-1">状态</label>
            <input
              type="text"
              value={status === 'published' ? '已发布' : '归档'}
              disabled
              className="w-full px-3 py-2 text-[14px] font-mono bg-black/[0.02] dark:bg-white/[0.03] border border-black/10 dark:border-white/10 rounded-lg text-[#999] dark:text-[#666] cursor-not-allowed"
            />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-[13px] font-medium text-[#666] dark:text-[#888] mb-1">摘要</label>
          <textarea
            value={summary}
            onChange={e => setSummary(e.target.value)}
            placeholder="可选"
            rows={2}
            className="w-full px-3 py-2 text-[14px] font-mono bg-white dark:bg-[#111] border border-black/10 dark:border-white/10 rounded-lg text-[#111] dark:text-[#eee] placeholder:text-[#bbb] dark:placeholder:text-[#555] focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all resize-none"
          />
        </div>

        {/* Editor */}
        <div className="border border-black/10 dark:border-white/10 rounded-xl overflow-hidden bg-white dark:bg-[#111]">
          {/* Toolbar */}
          <div className="flex items-center gap-0.5 px-3 py-2 border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.03]">
            {TOOLBAR_BTNS.map((btn, i) => (
              <button
                key={i}
                onClick={() => insertAtCursor(btn.before, btn.after)}
                title={btn.label}
                className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-[#666] dark:text-[#888] transition-colors"
              >
                {btn.icon}
              </button>
            ))}
          </div>

          {/* Split View */}
          <div className="flex min-h-[500px]">
            {/* Editor */}
            <div className="w-1/2 border-r border-black/5 dark:border-white/5">
              <textarea
                id="md-editor"
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="在此输入 Markdown 内容..."
                className="w-full h-full min-h-[500px] px-5 py-4 text-[14px] font-mono leading-relaxed bg-transparent text-[#333] dark:text-[#ccc] placeholder:text-[#bbb] dark:placeholder:text-[#555] focus:outline-none resize-none border-none"
              />
            </div>
            {/* Preview */}
            <div className="w-1/2 px-5 py-4 overflow-y-auto">
              {content ? (
                <div className="prose-content font-mono" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              ) : (
                <div className="text-[#bbb] dark:text-[#555] text-sm font-mono">预览区域...</div>
              )}
            </div>
          </div>
        </div>

        {/* Error */}
        {serverError && (
          <div className="mt-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">
            {serverError}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between mt-6">
          <Link
            to={`/post/${id}`}
            className="px-5 py-2.5 text-[15px] text-[#666] dark:text-[#888] hover:text-[#111] dark:hover:text-[#eee] transition-colors"
          >
            取消
          </Link>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2.5 bg-[#111] dark:bg-[#eee] text-white dark:text-[#111] text-[15px] font-medium rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? '保存中...' : '保存'}
          </button>
        </div>
      </main>

      {/* Lightbox */}
      {lightbox && (
        <div
          id="lightbox-overlay"
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85"
          onClick={(e) => { if (e.target === e.currentTarget) lightboxClose() }}
        >
          <div className="absolute top-4 right-4 flex items-center gap-1 z-[201]">
            <button onClick={lightboxZoomIn} className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white text-lg transition-colors" title="放大">+</button>
            <button onClick={lightboxZoomOut} className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white text-lg transition-colors" title="缩小">-</button>
            <button onClick={lightboxClose} className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white text-lg transition-colors ml-2" title="关闭">✕</button>
          </div>
          <img
            id="lightbox-img"
            src={lightbox.src}
            alt={lightbox.alt}
            className="max-w-[90vw] max-h-[90vh] object-contain transition-transform duration-200"
            style={{ transform: `scale(${lightboxZoom.current})` }}
            draggable={false}
          />
        </div>
      )}
    </div>
  )
}
