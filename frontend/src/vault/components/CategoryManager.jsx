/**
 * 类别管理弹窗（类别页左栏「管理类别」入口）：
 * - 内置 9 项只读（固定枚举，label 由 core.js 映射）
 * - 自定义类别：添加（≤12 字符、禁重名）/ 行内改名 / 删除（条目数 >0 拒删并提示）
 * - 自定义类别仅存本机 localStorage（零知识：服务端不存 vault 元数据），随备份往返
 * 行布局统一：label 弹性宽 + 计数右对齐定宽 + 操作区定宽右对齐，两类行同高同参。
 */
import { useEffect, useRef, useState } from 'react'
import { I } from './ui'

const inputCls = 'h-9 px-3 text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-lg text-stone-800 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors'
const btnPri = 'h-9 px-3.5 inline-flex items-center gap-1 text-sm font-medium rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors disabled:opacity-40 shrink-0'
const btnSub = 'h-8 px-2.5 inline-flex items-center text-[12px] font-medium rounded-lg text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-40 shrink-0'
const btnDanger = 'h-8 px-2.5 inline-flex items-center text-[12px] font-medium rounded-lg text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40 shrink-0'
const rowBase = 'flex items-center gap-2 h-9 px-2.5 rounded-lg bg-stone-50/60 dark:bg-white/[0.02]'
const countCls = 'w-20 shrink-0 text-right text-[12px] text-stone-400 dark:text-stone-500 tabular-nums'
const actionCls = 'w-[112px] shrink-0 flex items-center justify-end gap-1.5'

function BuiltinRow({ entry, count }) {
  return (
    <div className={rowBase}>
      <span className="min-w-0 flex-1 truncate text-sm text-stone-700 dark:text-stone-200">{entry.label}</span>
      <span className={countCls}>{count} 个条目</span>
      <span className={actionCls}>
        <span className="px-1.5 py-0.5 rounded-md text-[11px] bg-stone-500/10 text-stone-500 dark:text-stone-400">内置</span>
      </span>
    </div>
  )
}

function CustomRow({ entry, count, onRename, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(entry.label)
  const [err, setErr] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const saveRename = () => {
    const r = onRename(entry.key, text)
    if (r.ok) { setEditing(false); setErr('') }
    else setErr(r.err)
  }

  if (editing) {
    return (
      <>
        <div className="flex items-center gap-2 h-9 px-2.5">
          <input ref={inputRef} className={`${inputCls} flex-1 min-w-0 h-8`} value={text} maxLength={20}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') { setEditing(false); setText(entry.label); setErr('') } }} />
          <span className={actionCls}>
            <button type="button" className={btnSub} onClick={saveRename}>保存</button>
            <button type="button" className={btnSub} onClick={() => { setEditing(false); setText(entry.label); setErr('') }}>取消</button>
          </span>
        </div>
        {err && <p className="px-2.5 text-[12px] text-red-600 dark:text-red-400">{err}</p>}
      </>
    )
  }

  return (
    <>
      <div className={rowBase}>
        <span className="min-w-0 flex-1 truncate text-sm text-stone-800 dark:text-stone-100" title={entry.label}>{entry.label}</span>
        <span className={countCls}>{count} 个条目</span>
        <span className={actionCls}>
          <button type="button" className={btnSub} onClick={() => { setText(entry.label); setErr(''); setEditing(true) }}>改名</button>
          <button type="button" className={btnDanger} onClick={() => {
            const r = onDelete(entry.key, count)
            setErr(r.ok ? '' : r.err)
          }}>删除</button>
        </span>
      </div>
      {err && <p className="px-2.5 text-[12px] text-red-600 dark:text-red-400">{err}</p>}
    </>
  )
}

export default function CategoryManager({ catalog, counts, onAdd, onRename, onDelete, onClose }) {
  const [newLabel, setNewLabel] = useState('')
  const [addErr, setAddErr] = useState('')

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const add = () => {
    const r = onAdd(newLabel)
    if (r.ok) { setNewLabel(''); setAddErr('') }
    else setAddErr(r.err)
  }

  const builtins = catalog.filter(c => c.builtin)
  const customs = catalog.filter(c => !c.builtin)

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.08] rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        <div className="shrink-0 flex items-center px-5 h-14 border-b border-black/[0.06] dark:border-white/[0.06]">
          <h2 className="text-base font-semibold">管理类别</h2>
          <button onClick={onClose} aria-label="关闭" className="ml-auto w-8 h-8 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">✕</button>
        </div>
        <div className="overflow-y-auto p-5 space-y-5">
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500 mb-2">内置类别</h3>
            <div className="space-y-1.5">
              {builtins.map(c => (
                <BuiltinRow key={c.key} entry={c} count={counts[c.key] || 0} />
              ))}
            </div>
          </section>
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500 mb-2">自定义类别</h3>
            <div className="space-y-1.5">
              {customs.length === 0 && (
                <p className="px-2.5 py-3 text-[12px] text-stone-400 dark:text-stone-500">还没有自定义类别——在下方添加，如「家人」「游戏」。</p>
              )}
              {customs.map(c => (
                <CustomRow key={c.key} entry={c} count={counts[c.key] || 0} onRename={onRename} onDelete={onDelete} />
              ))}
            </div>
          </section>
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500 mb-2">添加类别</h3>
            <div className="flex items-center gap-2">
              <input className={`${inputCls} flex-1 min-w-0`} value={newLabel} maxLength={20} placeholder="新类别名称（≤12 字符）"
                onChange={e => { setNewLabel(e.target.value); setAddErr('') }}
                onKeyDown={e => { if (e.key === 'Enter') add() }} />
              <button type="button" className={btnPri} onClick={add} disabled={!newLabel.trim()}>{I.plus}添加</button>
            </div>
            {addErr && <p className="mt-1.5 text-[12px] text-red-600 dark:text-red-400">{addErr}</p>}
          </section>
        </div>
      </div>
    </div>
  )
}
