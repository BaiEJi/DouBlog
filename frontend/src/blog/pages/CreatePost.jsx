import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import md, { renderMermaidDiagrams, applyWikiLinks, buildWikiMap } from '@/shared/md'
import { apiFetch, fetchWorkspaces, fetchPostTree } from '@/blog/api'
import { useEditorShortcuts } from '../editor/useEditorShortcuts'
import { useEditorEnhancements, BLOCK_TEMPLATES } from '../editor/useEditorEnhancements'

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

export default function CreatePost({ dark, setDark }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [title, setTitle] = useState('')
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [summary, setSummary] = useState('')
  const [parentId, setParentId] = useState(searchParams.get('parent_id') || '')
  const [status, setStatus] = useState('published')
  const [workspaces, setWorkspaces] = useState([])
  const [wsId, setWsId] = useState(searchParams.get('ws') || '')
  const [tree, setTree] = useState([])
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')

  // 知识库列表 + 初始树（默认库）
  useEffect(() => {
    fetchWorkspaces()
      .then(d => {
        if (d.success) {
          setWorkspaces(d.data)
          if (!searchParams.get('ws') && d.data.length) {
            setWsId(String(d.data[0].id))
          }
        }
      })
      .catch(console.error)
  }, [searchParams])

  // 树跟随所选知识库
  useEffect(() => {
    fetchPostTree(wsId || undefined)
      .then(d => { if (d && d.success) setTree(d.data || []) })
      .catch(console.error)
  }, [wsId])

  const flatPosts = useMemo(() => flattenTree(tree), [tree])

  const previewHtml = useMemo(() => md.render(content || ''), [content])
  // 稳定引用：避免无关重渲染(标题输入/保存状态)整体重建预览 DOM 抹掉 mermaid
  // 预览的双链解析（按当前所选知识库的树）
  const wikiMap = useMemo(() => buildWikiMap(tree), [tree])
  const previewProps = useMemo(() => ({ __html: applyWikiLinks(previewHtml, wikiMap) }), [previewHtml, wikiMap])

  // Mermaid: 渲染预览区图表（统一走 md.js 的动态加载入口，不打进编辑页首屏）
  useEffect(() => {
    if (!previewHtml) return
    const timer = setTimeout(() => { renderMermaidDiagrams(dark) }, 100)
    return () => clearTimeout(timer)
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
      const res = await apiFetch('/api/posts', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          name: name.trim(),
          content,
          summary: summary.trim() || undefined,
          workspace_id: wsId ? parseInt(wsId) : undefined,
          parent_id: parentId ? parseInt(parentId) : undefined,
          status,
        })
      })
      const data = await res.json()
      if (data.success) {
        navigate(`/post/${data.data.id}`)
      } else {
        setServerError(data.message || '创建失败')
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

  // 编辑器快捷键：Ctrl+S 保存 / Ctrl+B 加粗 / Ctrl+I 斜体 / Ctrl+K 链接 / Tab 缩进
  const ed = useEditorEnhancements({ content, setContent })

    useEditorShortcuts({ onSave: handleSubmit, insert: insertAtCursor })


  return (
    <div className="min-h-screen bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 animate-fade-in">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-stone-50 dark:bg-[#141312] backdrop-blur-xl border-b border-black/5 dark:border-white/5">
        <div className="w-full px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-10">
            <Link to="/" className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-xl bg-[#111] dark:bg-[#eee] flex items-center justify-center transition-transform group-hover:scale-105">
                <span className="text-white dark:text-[#111] text-sm font-bold">D</span>
              </div>
              <span className="text-xl font-bold tracking-tight hidden sm:inline">DouBlog</span>
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

      <main className="mx-auto w-full max-w-[1700px] px-6 sm:px-8 xl:px-10 py-10">
        <h1 className="text-2xl font-semibold tracking-tight mb-8">新建文章</h1>

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
            <label className="block text-[13px] font-medium text-[#666] dark:text-[#888] mb-1">slug *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如: my-new-post"
              className={`w-full px-3 py-2 text-[14px] font-mono bg-white dark:bg-[#111] border rounded-lg text-[#111] dark:text-[#eee] placeholder:text-[#bbb] dark:placeholder:text-[#555] focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all ${errors.name ? 'border-red-400' : 'border-black/10 dark:border-white/10'}`}
            />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[#666] dark:text-[#888] mb-1">所属知识库</label>
            <select
              value={wsId}
              onChange={e => { setWsId(e.target.value); setParentId('') }}
              className="w-full px-3 py-2 text-[14px] bg-white dark:bg-[#111] border border-black/10 dark:border-white/10 rounded-lg text-[#111] dark:text-[#eee] focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all"
            >
              {workspaces.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[#666] dark:text-[#888] mb-1">父文章</label>
            <select
              value={parentId}
              onChange={e => setParentId(e.target.value)}
              className="w-full px-3 py-2 text-[14px] font-mono bg-white dark:bg-[#111] border border-black/10 dark:border-white/10 rounded-lg text-[#111] dark:text-[#eee] focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all appearance-none"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23666' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")", backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
            >
              <option value="">无（顶级文章）</option>
              {flatPosts.map(p => (
                <option key={p.id} value={p.id}>{' '.repeat(p.level * 4)}{'└ '}{p.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[#666] dark:text-[#888] mb-1">状态</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="w-full px-3 py-2 text-[14px] font-mono bg-white dark:bg-[#111] border border-black/10 dark:border-white/10 rounded-lg text-[#111] dark:text-[#eee] focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all appearance-none"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23666' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")", backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
            >
              <option value="published">已发布</option>
              <option value="archived">归档</option>
            </select>
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
                    {/* 图片上传：粘贴/拖拽/按钮共用 */}
          <input
            ref={ed.fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif"
            multiple
            hidden
            onChange={e => { [...e.target.files].forEach(ed.uploadAndInsert); e.target.value = '' }}
          />
          {/* Toolbar */}
          <div className="flex items-center gap-0.5 px-3 py-2 border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.03]">
            {TOOLBAR_BTNS.map((btn, i) => (
              <button
                key={i}
                onClick={() => insertAtCursor(btn.before, btn.after)}
                title={btn.label}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[#666] dark:text-[#888] transition-colors"
              >
                {btn.icon}
              </button>
            ))}
            <div className="w-px h-5 bg-black/10 dark:bg-white/10 mx-1.5" />
            <button onClick={ed.pickImage} title="插入图片（也可直接粘贴/拖拽截图）"
              className="px-2 h-8 flex items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[#666] dark:text-[#888] text-[12px] transition-colors">
              图片
            </button>
            <button onClick={() => ed.insertText(BLOCK_TEMPLATES.table)} title="插入表格模板"
              className="px-2 h-8 flex items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[#666] dark:text-[#888] text-[12px] transition-colors">
              表格
            </button>
            <button onClick={() => ed.insertText(BLOCK_TEMPLATES.mermaid)} title="插入 Mermaid 图表模板"
              className="px-2 h-8 flex items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[#666] dark:text-[#888] text-[12px] transition-colors">
              图表
            </button>
            <button onClick={() => ed.insertText(BLOCK_TEMPLATES.code)} title="插入代码块模板"
              className="px-2 h-8 flex items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[#666] dark:text-[#888] text-[12px] transition-colors">
              代码块
            </button>
            {ed.uploading > 0 && (
              <span className="ml-2 text-[12px] text-blue-500 animate-pulse">图片上传中…</span>
            )}
          </div>

          {/* Split View */}
          <div className="flex h-[70vh] min-h-[420px]">
            {/* Editor */}
            <div className="w-1/2 border-r border-black/5 dark:border-white/5">
              <textarea
                id="md-editor"
                ref={ed.editorRef}
                value={content}
                onChange={e => setContent(e.target.value)}
                onPaste={ed.handlePaste}
                onDrop={ed.handleDrop}
                onDragOver={e => e.preventDefault()}
                placeholder="在此输入 Markdown 内容..."
                className="w-full h-full px-5 py-4 text-[14px] font-mono leading-relaxed bg-transparent text-[#333] dark:text-[#ccc] placeholder:text-[#bbb] dark:placeholder:text-[#555] focus:outline-none resize-none border-none"
              />
            </div>
            {/* Preview */}
            <div ref={ed.previewRef} className="w-1/2 px-5 py-4 overflow-y-auto">
              {content ? (
                <div className="prose-content" dangerouslySetInnerHTML={previewProps} />
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
            to="/"
            className="px-4 py-2 text-sm text-[#666] dark:text-[#888] hover:text-[#111] dark:hover:text-[#eee] transition-colors"
          >
            取消
          </Link>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 bg-[#111] dark:bg-[#eee] text-white dark:text-[#111] text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? '发布中...' : '发布'}
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
