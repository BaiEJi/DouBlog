/**
 * Skill 包文件树 + 文件查看弹窗。
 * 树在详情抽屉内单列展示（文件夹展开/折叠）；点击文件弹出宽幅查看器（弹窗里看内容，
 * 不挤抽屉）；SKILL.md 即正文，点击跳「预览」tab。
 */
import { useEffect, useMemo, useState } from 'react'
import { assetsFile } from '../api'
import { copyText } from '../kit'

const FILE_ICONS = {
  '.md': '📄', '.markdown': '📄', '.txt': '📄', '.py': '🐍', '.js': '📜', '.ts': '📜',
  '.json': '🧩', '.yaml': '🧩', '.yml': '🧩', '.toml': '🧩', '.sh': '⚙', '.ps1': '⚙',
  '.html': '🌐', '.css': '🎨', '.svg': '🖼', '.png': '🖼', '.jpg': '🖼', '.pdf': '📕',
}
const DEFAULT_ICON = '📄'

function iconFor(path) {
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : ''
  return FILE_ICONS[ext] || DEFAULT_ICON
}

function dirOf(path) {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(0, i + 1) : ''
}

function baseNameOf(path) {
  return path.slice(path.lastIndexOf('/') + 1)
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** path 列表 → 嵌套树 {name, dirs|files}（目录优先、同层按名称排序） */
function buildTree(files) {
  const root = { name: '', dirs: {}, files: [] }
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean)
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      node = node.dirs[parts[i]] ??= { name: parts[i], dirs: {}, files: [] }
    }
    node.files.push(f)
  }
  const sortNode = n => {
    n.files.sort((a, b) => a.path.localeCompare(b.path))
    for (const d of Object.values(n.dirs)) sortNode(d)
  }
  sortNode(root)
  return root
}

function TreeRow({ depth, active, hasChildren, expanded, icon, label, meta, onClick }) {
  return (
    <div className={`flex items-center gap-1.5 min-h-9 sm:min-h-0 py-1.5 pr-2 rounded-lg text-[13px] cursor-pointer transition-colors ${active
      ? 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 font-medium'
      : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05] text-stone-600 dark:text-stone-300'}`}
      style={{ paddingLeft: 8 + depth * 18 }}
      onClick={onClick} role={hasChildren ? 'treeitem' : 'button'}
      aria-expanded={hasChildren ? expanded : undefined}>
      {hasChildren
        ? <span className="w-4 shrink-0 text-stone-400 select-none" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        : <span className="w-4 shrink-0" />}
      <span className="shrink-0" aria-hidden="true">{icon}</span>
      <span className="truncate">{label}</span>
      {meta && <span className="ml-auto shrink-0 text-[10.5px] text-stone-400 tabular-nums">{meta}</span>}
    </div>
  )
}

/** 宽幅文件查看弹窗：路径头 + 复制 + 滚动内容区（max-w-5xl，弹窗里看全文件） */
export function FileViewerModal({ file, onClose, toast }) {
  const [state, setState] = useState({ loading: file.is_text })

  useEffect(() => {
    if (!file.is_text) return
    let alive = true
    assetsFile(file.id).then(r => {
      if (!alive) return
      setState(r.success ? { content: r.data.content } : { error: r.message || '加载失败' })
    })
    return () => { alive = false }
  }, [file])

  useEffect(() => {
    // 捕获阶段接管 Esc 并阻断传播：只关本弹窗，不连带底下的详情抽屉
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('keydown', onKey, true)
    // 打开期间锁根滚动条（防移动端右缘露出根滚动条亮缝）
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const copy = async () => {
    if (state.content != null && await copyText(state.content)) toast('已复制')
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4" role="dialog"
      aria-modal="true" aria-label={`文件 ${file.path}`}>
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="relative w-full max-w-5xl max-h-[86vh] flex flex-col rounded-2xl border border-black/[0.08] dark:border-white/[0.1] bg-white dark:bg-[#1c1b1a] shadow-2xl">
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-black/[0.06] dark:border-white/[0.08]">
          <span aria-hidden="true" className="shrink-0">{iconFor(file.path)}</span>
          <span className="font-mono text-[13.5px] flex-1 min-w-0 flex items-baseline gap-1">
            <span className="truncate text-stone-400">{dirOf(file.path)}</span>
            <span className="shrink-0 font-medium">{baseNameOf(file.path)}</span>
          </span>
          <span className="shrink-0 flex items-center gap-1.5">
            <span className="text-[11px] text-stone-400 tabular-nums">{fmtSize(file.size)}</span>
            <span className={`px-1.5 py-0.5 rounded-md text-[10.5px] font-medium ${file.is_text
              ? 'bg-sky-500/10 text-sky-700 dark:text-sky-400'
              : 'bg-stone-500/10 text-stone-500 dark:text-stone-400'}`}>
              {file.is_text ? '文本' : '二进制'}
            </span>
          </span>
          {file.is_text && state.content != null && (
            <button type="button" onClick={copy}
              className="px-2.5 py-1 rounded-lg text-[12px] border border-black/[0.1] dark:border-white/[0.12] hover:bg-black/[0.04] dark:hover:bg-white/[0.07] shrink-0">复制</button>
          )}
          <button type="button" onClick={onClose} aria-label="关闭"
            className="w-8 h-8 rounded-lg text-stone-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] shrink-0">✕</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {!file.is_text && (
            <p className="text-[13px] text-stone-400 py-8 text-center">
              二进制文件无文本预览（{fmtSize(file.size)}），可下载原包查看。
            </p>
          )}
          {file.is_text && state.loading && <p className="text-[13px] text-stone-400">加载中…</p>}
          {file.is_text && state.error && <p className="text-[13px] text-red-500">{state.error}</p>}
          {file.is_text && state.content != null && (
            <pre className="text-[12.5px] font-mono leading-relaxed whitespace-pre-wrap break-words">{state.content}</pre>
          )}
          {file.is_text && !state.loading && state.content == null && !state.error && (
            <p className="text-[13px] text-stone-400">文件过大，未存预览内容。</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function FileTree({ files, onOpenMain, onOpenFile }) {
  const tree = useMemo(() => buildTree(files), [files])
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [activeId, setActiveId] = useState(null)

  const renderNodes = (node, depth, prefix) => {
    const out = []
    for (const dir of Object.values(node.dirs).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = prefix ? `${prefix}/${dir.name}` : dir.name
      const expanded = !collapsed.has(fullPath)
      out.push(
        <TreeRow key={fullPath} depth={depth} hasChildren expanded={expanded}
          icon={expanded ? '📂' : '📁'} label={dir.name}
          onClick={() => setCollapsed(prev => {
            const next = new Set(prev)
            next.has(fullPath) ? next.delete(fullPath) : next.add(fullPath)
            return next
          })} />,
      )
      if (expanded) out.push(...renderNodes(dir, depth + 1, fullPath))
    }
    for (const f of node.files) {
      const isEntry = f.path === 'SKILL.md'
      out.push(
        <TreeRow key={f.id} depth={depth} icon={iconFor(f.path)}
          label={f.path.split('/').pop()}
          meta={isEntry ? '正文' : fmtSize(f.size)}
          active={activeId === f.id}
          onClick={() => {
            if (isEntry && onOpenMain) { onOpenMain(); return }
            setActiveId(f.id)
            onOpenFile?.(f)
          }} />,
      )
    }
    return out
  }

  if (!files.length) {
    return <p className="text-[12.5px] text-stone-400">该资产没有附带文件。</p>
  }

  return (
    <div className="rounded-xl border border-black/[0.07] dark:border-white/[0.09] p-2"
      role="tree" aria-label="Skill 文件树">
      <p className="px-2 py-1 text-[11.5px] text-stone-500 dark:text-stone-400">点击文件在弹窗中查看</p>
      {renderNodes(tree, 0, '')}
    </div>
  )
}
