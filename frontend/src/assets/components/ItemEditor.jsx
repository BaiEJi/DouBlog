/**
 * 资产编辑器（新建/编辑共用）：kind、标题、摘要、分类、标签、正文 + 版本备注；
 * 正文实时检测 {{变量}}；Ctrl+S 保存。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { BTN_GHOST, BTN_PRIMARY, INPUT, KIND_META } from '../kit'

const VAR_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g

export default function ItemEditor({ item, categories, onClose, onSave }) {
  const editing = !!item
  const [kind, setKind] = useState(item?.kind || 'prompt')
  const [title, setTitle] = useState(item?.title || '')
  const [summary, setSummary] = useState(item?.summary || '')
  const [categoryId, setCategoryId] = useState(item?.category_id ?? '')
  const [tagInput, setTagInput] = useState((item?.tags || []).join(', '))
  const [content, setContent] = useState(item?.content || '')
  const [versionNote, setVersionNote] = useState('')
  const [saving, setSaving] = useState(false)
  const contentRef = useRef(null)

  const variables = useMemo(() => {
    const seen = []
    for (const m of (content || '').matchAll(VAR_RE)) {
      if (!seen.includes(m[1])) seen.push(m[1])
    }
    return seen
  }, [content])

  const tags = useMemo(() => {
    const out = []
    for (const t of tagInput.split(/[,，]/)) {
      const s = t.trim()
      if (s && !out.includes(s)) out.push(s)
    }
    return out
  }, [tagInput])

  const save = async () => {
    if (!title.trim() || !content.trim() || saving) return
    setSaving(true)
    const payload = {
      kind, title: title.trim(), summary: summary.trim() || null,
      content, tags,
      category_id: categoryId === '' ? null : Number(categoryId),
      version_note: versionNote.trim() || null,
    }
    try {
      await onSave(payload, editing ? item.id : null)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save() }
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={editing ? '编辑资产' : '新建资产'}>
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl border border-black/[0.08] dark:border-white/[0.1] bg-white dark:bg-[#1c1b1a] shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.08]">
          <h3 className="text-[15px] font-semibold">{editing ? `编辑 · ${item.title}` : '新建资产'}</h3>
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-black/[0.1] dark:border-white/[0.12] overflow-hidden">
              {Object.entries(KIND_META).map(([k, meta]) => (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={`px-3 py-1.5 text-[13px] transition-colors ${kind === k
                    ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
                    : 'text-stone-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'}`}>
                  {meta.icon} {meta.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={onClose} aria-label="关闭"
              className="w-8 h-8 rounded-lg text-stone-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]">✕</button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[12px] font-medium text-stone-500 mb-1.5" htmlFor="asset-title">标题 *</label>
              <input id="asset-title" className={INPUT} value={title} maxLength={200} autoFocus
                onChange={e => setTitle(e.target.value)} placeholder="如：代码审查助手" />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-stone-500 mb-1.5" htmlFor="asset-category">分类</label>
              <select id="asset-category" className={INPUT} value={categoryId}
                onChange={e => setCategoryId(e.target.value)}>
                <option value="">未分类</option>
                {categories.filter(c => c.id != null).map(c => (
                  <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-stone-500 mb-1.5" htmlFor="asset-summary">摘要</label>
            <input id="asset-summary" className={INPUT} value={summary} maxLength={500}
              onChange={e => setSummary(e.target.value)} placeholder="一句话说明用途（列表页展示）" />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-stone-500 mb-1.5" htmlFor="asset-tags">标签（逗号分隔，最多 20 个）</label>
            <input id="asset-tags" className={INPUT} value={tagInput}
              onChange={e => setTagInput(e.target.value)} placeholder="编程, review, agent" />
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {tags.map(t => (
                  <span key={t} className="px-2 py-0.5 rounded-lg text-[11px] bg-black/[0.05] dark:bg-white/[0.07] text-stone-600 dark:text-stone-300">{t}</span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-medium text-stone-500">检测到变量：</span>
            {variables.length === 0
              ? <span className="text-[12px] text-stone-400">无（可在正文中写 {'{{变量名}}'} 供填充使用）</span>
              : variables.map(v => (
                <span key={v} className="px-2 py-0.5 rounded-lg text-[11px] font-mono bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400">{v}</span>
              ))}
          </div>

          <div className="flex flex-col min-h-[220px]">
            <label className="block text-[12px] font-medium text-stone-500 mb-1.5" htmlFor="asset-content">正文 *（Markdown）</label>
            <textarea id="asset-content" ref={contentRef} value={content}
              onChange={e => setContent(e.target.value)}
              spellCheck={false}
              className="flex-1 min-h-[220px] w-full px-3.5 py-3 rounded-xl border border-black/[0.1] dark:border-white/[0.12] bg-white dark:bg-white/[0.04] text-[13px] font-mono leading-relaxed outline-none focus:border-black/30 dark:focus:border-white/30 resize-y"
              placeholder={'支持 Markdown。用 {{变量名}} 声明可填充变量，例如：\n\n请作为{{角色}}，审查以下{{语言}}代码：\n```\n{{代码}}\n```'} />
          </div>

          {editing && (
            <div>
              <label className="block text-[12px] font-medium text-stone-500 mb-1.5" htmlFor="asset-note">版本备注（内容变更时生效）</label>
              <input id="asset-note" className={INPUT} value={versionNote} maxLength={200}
                onChange={e => setVersionNote(e.target.value)} placeholder="如：补充了输出格式要求" />
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between gap-3">
          <span className="text-[11.5px] text-stone-400">Ctrl+S 保存 · Esc 取消</span>
          <div className="flex items-center gap-2.5">
            <button type="button" className={BTN_GHOST} onClick={onClose}>取消</button>
            <button type="button" className={BTN_PRIMARY} onClick={save} disabled={!title.trim() || !content.trim() || saving}>
              {saving ? '保存中…' : editing ? '保存' : '创建'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
