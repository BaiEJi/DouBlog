/**
 * 分类管理弹窗：新建 / 重命名 / emoji·颜色·适用类型 / 排序；删除受后端关联校验保护。
 */
import { useEffect, useState } from 'react'
import { assetsCategories, assetsCreateCategory, assetsDeleteCategory, assetsUpdateCategory } from '../api'
import { BTN_GHOST, BTN_PRIMARY, INPUT } from '../kit'

const KINDS = [['all', '通用'], ['prompt', '仅 Prompt'], ['skill', '仅 Skill']]

function CatRow({ cat, onSaved, onDeleted, toast }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ name: cat.name, icon: cat.icon || '', color: cat.color || '', kind: cat.kind, sort_order: cat.sort_order })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      const payload = { ...draft, icon: draft.icon || null, color: draft.color || null, sort_order: Number(draft.sort_order) || 0 }
      const r = await assetsUpdateCategory(cat.id, payload)
      if (r.success) { toast('分类已更新'); setEditing(false); onSaved() }
      else toast(r.message || '更新失败', 'error')
    } finally { setBusy(false) }
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await assetsDeleteCategory(cat.id)
      if (r.success) { toast('分类已删除'); onDeleted(cat.id) }
      else toast(r.message || '删除失败', 'error')
    } finally { setBusy(false) }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-black/[0.07] dark:border-white/[0.09]">
        <span className="w-6 text-center">{cat.icon || '📁'}</span>
        <span className="w-3 h-3 rounded-full shrink-0 border border-black/10" style={{ background: cat.color || 'transparent' }} />
        <span className="flex-1 min-w-0 truncate text-[13.5px]">{cat.name}</span>
        <span className="text-[11px] text-stone-400">{cat.item_count} 项 · {KINDS.find(k => k[0] === cat.kind)?.[1] || cat.kind}</span>
        <button type="button" onClick={() => setEditing(true)}
          className="px-2 py-1 rounded-lg text-[12px] border border-black/[0.1] dark:border-white/[0.12] hover:bg-black/[0.04] dark:hover:bg-white/[0.07]">编辑</button>
      </div>
    )
  }
  return (
    <div className="px-3 py-3 rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/[0.04] space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <input className={INPUT} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="分类名称" aria-label="分类名称" />
        <input className={INPUT} value={draft.icon} onChange={e => setDraft(d => ({ ...d, icon: e.target.value }))} placeholder="emoji 图标" aria-label="emoji 图标" />
        <input className={INPUT} value={draft.color} onChange={e => setDraft(d => ({ ...d, color: e.target.value }))} placeholder="#7c3aed" aria-label="颜色" />
        <select className={INPUT} value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value }))} aria-label="适用类型">
          {KINDS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2.5">
        <input type="number" className={`${INPUT} w-24`} value={draft.sort_order}
          onChange={e => setDraft(d => ({ ...d, sort_order: e.target.value }))} aria-label="排序" />
        <span className="flex-1 text-[11px] text-stone-400">排序小的在前</span>
        <button type="button" className={BTN_GHOST} onClick={() => setEditing(false)}>取消</button>
        <button type="button" className={BTN_PRIMARY} disabled={!draft.name.trim() || busy} onClick={save}>{busy ? '…' : '保存'}</button>
        <button type="button" className="px-3 py-2 rounded-xl text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
          disabled={busy || cat.item_count > 0} title={cat.item_count > 0 ? `分类下有 ${cat.item_count} 个资产` : '删除分类'}
          onClick={remove}>删除</button>
      </div>
    </div>
  )
}

export default function CategoryManager({ onClose, onChanged, toast }) {
  const [cats, setCats] = useState([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => assetsCategories().then(r => {
    if (r.success) setCats(r.data.filter(c => c.id != null))
  })
  useEffect(() => { load() }, [])

  const create = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const r = await assetsCreateCategory({ name: name.trim() })
      if (r.success) { setName(''); toast('分类已创建'); load(); onChanged() }
      else toast(r.message || '创建失败', 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="分类管理">
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-xl max-h-[80vh] flex flex-col rounded-2xl border border-black/[0.08] dark:border-white/[0.1] bg-white dark:bg-[#1c1b1a] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.08]">
          <h3 className="text-[15px] font-semibold">分类管理</h3>
          <button type="button" onClick={onClose} aria-label="关闭"
            className="w-8 h-8 rounded-lg text-stone-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]">✕</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-2.5">
          {cats.length === 0 && <p className="text-[13px] text-stone-400">还没有分类——在下方创建一个。</p>}
          {cats.map(cat => (
            <CatRow key={cat.id} cat={cat} toast={toast} onSaved={() => { load(); onChanged() }} onDeleted={() => { load(); onChanged() }} />
          ))}
        </div>
        <div className="px-5 py-3.5 border-t border-black/[0.06] dark:border-white/[0.08] flex items-center gap-2.5">
          <input className={INPUT} value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') create() }}
            placeholder="新分类名称" aria-label="新分类名称" />
          <button type="button" className={`${BTN_PRIMARY} whitespace-nowrap shrink-0`} disabled={!name.trim() || busy} onClick={create}>{busy ? '…' : '新建'}</button>
        </div>
      </div>
    </div>
  )
}
