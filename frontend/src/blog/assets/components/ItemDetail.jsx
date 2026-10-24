/**
 * 资产详情抽屉：元信息 + 正文预览（渲染/原文切换）+ 变量填充台 + 版本历史（行级 diff）
 * + 操作组（复制/编辑/收藏/复制副本/归档/彻底删除/导出）。
 * onAction(action, item) 由页面执行动作并刷新；onRefresh() 仅刷新列表。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DiffViewer from '@/shared/DiffViewer'
import md, { renderMermaidDiagrams } from '@/shared/md'
import { assetsExportItem, assetsItem, assetsItemArchive, assetsItemFiles, assetsRestoreVersion, assetsUseItem, assetsVersion, assetsVersions } from '../api'
import FileTree, { FileViewerModal } from './FileTree'
import { KIND_META, copyText } from '../kit'

const FILL_KEY = id => `doublog_assets_fill_${id}`

function fmtTime(iso) {
  if (!iso) return '—'
  return iso.replace('T', ' ').slice(0, 16)
}

function PanelButton({ onClick, children, danger, title }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={`px-2.5 py-1.5 rounded-lg text-[12.5px] border transition-colors ${danger
        ? 'border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10'
        : 'border-black/[0.1] dark:border-white/[0.12] text-stone-600 dark:text-stone-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.07]'}`}>
      {children}
    </button>
  )
}

function VariableFill({ item, toast, onUsed }) {
  const [values, setValues] = useState(() => {
    try { return JSON.parse(localStorage.getItem(FILL_KEY(item.id))) || {} } catch { return {} }
  })
  const vars = item.variables || []

  const filled = useMemo(() => {
    let out = item.content || ''
    for (const v of vars) {
      out = out.split(`{{${v}}}`).join(values[v] ?? '')
    }
    return out
  }, [item.content, vars, values])

  const set = (v, text) => {
    const next = { ...values, [v]: text }
    setValues(next)
    try { localStorage.setItem(FILL_KEY(item.id), JSON.stringify(next)) } catch { /* 存储禁用 */ }
  }

  const copy = async () => {
    const r = await assetsUseItem(item.id, 'fill')
    if (r.success && await copyText(filled)) {
      toast('已复制填充结果（使用 +1）')
      onUsed()
    } else if (!r.success) {
      toast(r.message || '记录使用失败', 'error')
    }
  }

  const isLong = v => v.length > 8 || /代码|code|content|文本|正文|prompt/i.test(v)

  return (
    <div className="space-y-3">
      {vars.length === 0 && (
        <p className="text-[12.5px] text-stone-400">该资产没有声明 {'{{变量}}'}，直接复制全文即可。</p>
      )}
      {vars.map(v => (
        <div key={v}>
          <label className="block text-[12px] font-mono font-medium text-fuchsia-700 dark:text-fuchsia-400 mb-1" htmlFor={`fill-${v}`}>{`{{${v}}}`}</label>
          {isLong(v) ? (
            <textarea id={`fill-${v}`} rows={4} value={values[v] ?? ''} onChange={e => set(v, e.target.value)}
              spellCheck={false}
              className="w-full px-3 py-2 rounded-xl border border-black/[0.1] dark:border-white/[0.12] bg-white dark:bg-white/[0.04] text-[13px] font-mono outline-none focus:border-black/30 dark:focus:border-white/30 resize-y" />
          ) : (
            <input id={`fill-${v}`} value={values[v] ?? ''} onChange={e => set(v, e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-black/[0.1] dark:border-white/[0.12] bg-white dark:bg-white/[0.04] text-[13px] outline-none focus:border-black/30 dark:focus:border-white/30" />
          )}
        </div>
      ))}
      <div>
        <p className="text-[12px] font-medium text-stone-500 mb-1.5">填充结果预览</p>
        <pre className="max-h-52 overflow-auto px-3.5 py-3 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] text-[12.5px] font-mono leading-relaxed whitespace-pre-wrap break-words">{filled}</pre>
      </div>
      <button type="button" onClick={copy}
        className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-fuchsia-600 text-white hover:bg-fuchsia-500 transition-colors">
        复制填充结果
      </button>
    </div>
  )
}

function VersionPanel({ item, dark, toast, onChanged }) {
  const [versions, setVersions] = useState(null)
  const [versionPage, setVersionPage] = useState(1)
  const [versionTotal, setVersionTotal] = useState(0)
  const [compare, setCompare] = useState(null)   // 被选中对比的版本详情
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    assetsVersions(item.id, versionPage).then(r => {
      if (r.success) { setVersions(r.data.items); setVersionTotal(r.data.total) }
    })
  }, [item.id, versionPage])
  useEffect(load, [load])

  const pick = async v => {
    if (compare?.id === v.id) { setCompare(null); return }
    const r = await assetsVersion(v.id)
    if (r.success) setCompare(r.data)
    else toast(r.message || '版本加载失败', 'error')
  }

  const restore = async v => {
    if (busy) return
    setBusy(true)
    try {
      const r = await assetsRestoreVersion(item.id, v.id)
      if (r.success) {
        toast(`已恢复到 v${v.version}（当前 v${r.data.version}）`)
        setCompare(null)
        load()
        onChanged()
      } else toast(r.message || '恢复失败', 'error')
    } finally { setBusy(false) }
  }

  if (versions === null) return <p className="text-[12.5px] text-stone-400">加载中…</p>
  if (!versions.length) return <p className="text-[12.5px] text-stone-400">暂无版本记录。</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-stone-500">
        <button type="button" disabled={versionPage <= 1} onClick={() => setVersionPage(v => v - 1)} className="disabled:opacity-30">上一页</button>
        <span>{versionPage} / {Math.max(1, Math.ceil(versionTotal / 20))} · {versionTotal} 个版本</span>
        <button type="button" disabled={versionPage * 20 >= versionTotal} onClick={() => setVersionPage(v => v + 1)} className="disabled:opacity-30">下一页</button>
      </div>
      <div className="space-y-1.5">
        {versions.map(v => (
          <div key={v.id}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors ${compare?.id === v.id
              ? 'border-fuchsia-500/40 bg-fuchsia-500/[0.06]'
              : 'border-black/[0.07] dark:border-white/[0.09] hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'}`}>
            <button type="button" onClick={() => pick(v)} className="flex-1 min-w-0 text-left">
              <span className="text-[12.5px] font-mono font-medium">v{v.version}</span>
              {v.version === item.version && <span className="ml-1.5 text-[11px] text-fuchsia-600 dark:text-fuchsia-400">当前</span>}
              <span className="ml-2 text-[11.5px] text-stone-400 truncate">{v.note || fmtTime(v.created_at)}</span>
            </button>
            {v.version !== item.version && (
              <button type="button" disabled={busy} onClick={() => restore(v)}
                className="px-2 py-1 rounded-lg text-[11.5px] border border-black/[0.1] dark:border-white/[0.12] hover:bg-black/[0.04] dark:hover:bg-white/[0.07] disabled:opacity-40">
                恢复
              </button>
            )}
          </div>
        ))}
      </div>

      {compare && (
        <div>
          <p className="text-[12px] font-medium text-stone-500 mb-1.5">
            对比：<span className="font-mono">v{compare.version}</span> → <span className="font-mono">v{item.version}（当前）</span>
          </p>
          <div className="rounded-xl border border-black/[0.07] dark:border-white/[0.09] overflow-hidden">
            <DiffViewer a={compare.content || ''} b={item.content || ''} view="unified" height={420} />
          </div>
        </div>
      )}
    </div>
  )
}

export default function ItemDetail({ itemId, dark, onClose, onEdit, onAction, onRefresh, toast }) {
  const [item, setItem] = useState(null)
  const [files, setFiles] = useState([])
  const [viewingFile, setViewingFile] = useState(null)
  const [tab, setTab] = useState('preview')          // preview | fill | versions
  const [raw, setRaw] = useState(false)
  const previewRef = useRef(null)

  const load = useCallback(() => {
    assetsItem(itemId).then(r => {
      if (r.success) {
        setItem(r.data)
        if (!r.data.files_count) setFiles([])
        else assetsItemFiles(itemId).then(fr => {
          if (fr.success) setFiles(fr.data)
        })
      } else toast(r.message || '加载失败', 'error')
    })
  }, [itemId, toast])
  useEffect(load, [load])

  useEffect(() => {
    if (tab === 'preview' && !raw && item) {
      try { renderMermaidDiagrams(dark) } catch { /* mermaid 渲染失败不阻断 */ }
    }
  }, [tab, raw, item, dark])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    // 抽屉打开期间锁根滚动条（防移动端右缘露出根滚动条）
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  if (!item) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/30" onClick={onClose} />
        <p className="relative text-sm text-stone-400">加载中…</p>
      </div>
    )
  }

  const meta = KIND_META[item.kind] || KIND_META.prompt
  const archived = item.status === 'archived'

  const refreshAll = () => { load(); onRefresh() }

  const copyAll = async () => {
    const r = await assetsUseItem(item.id, 'copy')
    if (r.success && await copyText(item.content)) {
      toast('已复制（使用 +1）')
      refreshAll()
    } else if (!r.success) toast(r.message || '记录使用失败', 'error')
  }

  const downloadArchive = async () => {
    const r = await assetsItemArchive(item.id)
    if (r.success) toast('已下载原包')
    else toast(r.message || '下载失败', 'error')
  }

  const download = async fmt => {
    const r = await assetsExportItem(item.id, fmt)
    if (r.success) {
      await assetsUseItem(item.id, 'export')
      toast(`已导出 ${fmt === 'md' ? 'Markdown' : 'JSON'}`)
      refreshAll()
    } else toast(r.message || '导出失败', 'error')
  }

  const tabs = [
    { key: 'preview', label: '预览' },
    { key: 'fill', label: `变量填充${item.variables?.length ? `（${item.variables.length}）` : ''}` },
    { key: 'versions', label: `版本（${item.versions_count || item.version}）` },
    ...(item.files_count > 0 ? [{ key: 'files', label: `文件（${item.files_count}）` }] : []),
  ]

  return (
    <div className="fixed inset-0 z-[70] flex justify-end" role="dialog" aria-modal="true" aria-label={`资产 ${item.title}`}>
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative w-full max-w-[620px] h-full flex flex-col bg-white dark:bg-[#171615] border-l border-black/[0.08] dark:border-white/[0.1] shadow-2xl">
        {/* 头部：kind 徽标 + 标题 + 操作 */}
        <div className="px-5 pt-5 pb-3.5 border-b border-black/[0.06] dark:border-white/[0.08]">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className={`px-2 py-0.5 rounded-lg text-[11px] font-medium ${meta.chip}`}>{meta.icon} {meta.label}</span>
                {archived && <span className="px-2 py-0.5 rounded-lg text-[11px] bg-stone-500/10 text-stone-500">已归档</span>}
                {item.files_count > 0 && (
                  <span className="px-1.5 py-0.5 rounded-lg text-[11px] bg-sky-500/10 text-sky-700 dark:text-sky-400">📦 {item.files_count} 文件</span>
                )}
                <span className="text-[11px] font-mono text-stone-400">v{item.version} · 使用 {item.usage_count} 次</span>
              </div>
              <h2 className="text-lg font-semibold leading-snug break-words">{item.title}</h2>
              {item.summary && <p className="mt-1 text-[13px] text-stone-500 dark:text-stone-400 leading-relaxed">{item.summary}</p>}
              <div className="mt-2 flex items-center gap-2 flex-wrap text-[11.5px] text-stone-400">
                {item.category && <span>{item.category}</span>}
                {item.tags?.map(t => (
                  <span key={t} className="px-1.5 py-0.5 rounded-md bg-black/[0.05] dark:bg-white/[0.07]">#{t}</span>
                ))}
                <span>最近使用 {fmtTime(item.last_used_at)}</span>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="关闭"
              className="w-8 h-8 shrink-0 rounded-lg text-stone-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]">✕</button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button type="button" onClick={copyAll}
              className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90 transition-opacity">复制全文</button>
            <PanelButton onClick={() => onEdit(item)} title="编辑">编辑</PanelButton>
            <PanelButton onClick={() => download('md')}>导出 .md</PanelButton>
            <PanelButton onClick={() => download('json')}>导出 .json</PanelButton>
            {item.archive_name && <PanelButton onClick={downloadArchive} title={item.archive_name}>⬇ 原包 .zip</PanelButton>}
            <PanelButton onClick={() => onAction('duplicate', item)} title="复制一份新资产">复制副本</PanelButton>
            <PanelButton onClick={() => onAction('favorite', item)}>{item.favorite ? '★ 已收藏' : '☆ 收藏'}</PanelButton>
            <PanelButton onClick={() => onAction(archived ? 'unarchive' : 'archive', item)}>{archived ? '取消归档' : '归档'}</PanelButton>
            <PanelButton danger onClick={() => onAction('delete', item)}>彻底删除</PanelButton>
          </div>
        </div>

        {/* Tab 栏 */}
        <div className="flex items-center gap-1 px-5 pt-3 border-b border-black/[0.06] dark:border-white/[0.08]">
          {tabs.map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-[13px] rounded-t-lg transition-colors ${tab === t.key
                ? 'font-medium text-stone-900 dark:text-stone-100 border-b-2 border-stone-900 dark:border-stone-100 -mb-px'
                : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'}`}>
              {t.label}
            </button>
          ))}
          {tab === 'preview' && (
            <button type="button" onClick={() => setRaw(v => !v)}
              className="ml-auto text-[11.5px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-300">
              {raw ? '渲染视图' : '原文视图'}
            </button>
          )}
        </div>

        {/* 内容区 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {tab === 'preview' && (raw
            ? <pre className="text-[13px] font-mono leading-relaxed whitespace-pre-wrap break-words">{item.content}</pre>
            : <div ref={previewRef} className="md-content text-[14px] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: md.render(item.content || '') }} />)}
          {tab === 'fill' && <VariableFill item={item} toast={toast} onUsed={refreshAll} />}
          {tab === 'versions' && <VersionPanel item={item} dark={dark} toast={toast} onChanged={refreshAll} />}
          {tab === 'files' && (
            <div className="space-y-3">
              {item.summary && (
                <div className="px-3.5 py-2.5 rounded-xl bg-sky-500/[0.06] border border-sky-500/20 text-[12.5px] leading-relaxed">
                  <span className="font-medium text-sky-700 dark:text-sky-400">自动提取的描述：</span>
                  <span className="text-stone-600 dark:text-stone-300">{item.summary}</span>
                </div>
              )}
              <FileTree files={files} onOpenMain={() => setTab('preview')}
                onOpenFile={setViewingFile} />
            </div>
          )}
        </div>
      </aside>
      {viewingFile && (
        <FileViewerModal file={viewingFile} onClose={() => setViewingFile(null)} toast={toast} />
      )}
    </div>
  )
}
