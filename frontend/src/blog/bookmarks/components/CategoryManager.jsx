/**
 * 分类管理（模态）：树形列表 + 新建（选父级，最深 3 层）+ 重命名 + 移动 + 删除（子孙上提一级）。
 */
import { useState } from 'react'

import { createCategory, updateCategory, deleteCategory } from '../api'
import { flattenCategories } from '../api'
import { Icon, Modal, inputCls } from '../../../todo/kit'

export default function CategoryManager({ open, onClose, categories, onChanged, toast }) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')

  const flat = flattenCategories(categories)

  const add = async () => {
    if (!name.trim()) { toast('分类名不能为空', 'err'); return }
    setBusy(true)
    try {
      await createCategory({ name: name.trim(), parent_id: parentId || null })
      setName(''); toast('已创建'); onChanged()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const saveEdit = async () => {
    if (!editName.trim()) return
    setBusy(true)
    try {
      await updateCategory(editingId, { name: editName.trim() })
      setEditingId(null); toast('已重命名'); onChanged()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const remove = async (cat) => {
    if (!window.confirm(`删除分类「${cat.name}」？其子分类与书签会上提一级，不会丢失`)) return
    setBusy(true)
    try { await deleteCategory(cat.id); toast('已删除'); onChanged() }
    catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <Modal title="分类管理" open={open} onClose={onClose} width="max-w-lg">
      <div className="space-y-4">
        {/* 新建 */}
        <div className="flex items-center gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="新分类名"
            className={inputCls + ' flex-1'} onKeyDown={e => e.key === 'Enter' && add()} />
          <select value={parentId} onChange={e => setParentId(e.target.value)} className={inputCls} style={{ width: '10rem' }}>
            <option value="">作为顶级</option>
            {flat.filter(c => c.depth < 2).map(c => (
              <option key={c.id} value={c.id}>{'　'.repeat(c.depth)}{c.name} 下</option>
            ))}
          </select>
          <button type="button" onClick={add} disabled={busy}
            className="inline-flex items-center gap-1 px-3 h-9 rounded-lg text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors disabled:opacity-50 whitespace-nowrap">
            {Icon.plus}新建</button>
        </div>

        {/* 树列表 */}
        <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06] max-h-80 overflow-y-auto -mx-1 px-1">
          {flat.length === 0 && (
            <p className="py-6 text-center text-xs text-stone-400 dark:text-stone-500">还没有分类</p>
          )}
          {flat.map(c => (
            <div key={c.id} className="flex items-center gap-2 py-2" style={{ paddingLeft: c.depth * 20 }}>
              {c.depth > 0 && <span className="text-stone-300 dark:text-stone-600 text-xs">└</span>}
              {editingId === c.id ? (
                <>
                  <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                    className={inputCls + ' flex-1 h-8'} onKeyDown={e => e.key === 'Enter' && saveEdit()} />
                  <button type="button" onClick={saveEdit} disabled={busy}
                    className="px-2 h-8 rounded-lg text-xs bg-orange-500 text-white hover:bg-orange-600 transition-colors disabled:opacity-50">保存</button>
                  <button type="button" onClick={() => setEditingId(null)}
                    className="px-2 h-8 rounded-lg text-xs bg-black/[0.06] dark:bg-white/[0.08] transition-colors">取消</button>
                </>
              ) : (
                <>
                  <span className="text-sm flex-1 truncate">{c.name}</span>
                  <span className="text-[11px] text-stone-400 dark:text-stone-500 tabular-nums">{c.total_count} 条</span>
                  <button type="button" title="重命名"
                    onClick={() => { setEditingId(c.id); setEditName(c.name) }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">{Icon.edit}</button>
                  <button type="button" title="删除" onClick={() => remove(c)} disabled={busy}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-stone-400 hover:bg-red-500/10 hover:text-red-500 transition-colors">{Icon.trash}</button>
                </>
              )}
            </div>
          ))}
        </div>
        <p className="text-[11.5px] text-stone-400 dark:text-stone-500">
          分类最多 3 层；删除分类不删书签（内容上提一级）
        </p>
      </div>
    </Modal>
  )
}
