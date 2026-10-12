/**
 * 标签多选下拉：搜索 + 彩色 Tag 徽章 + 现场新建（输入名称 → 回车/点新建 → onCreate
 * POST 创建 → 自动选中）。点外部关闭；已选以彩色 chip 展示在触发器内，chip 上 × 可移除。
 * Props: { value: string[] 标签 id, onChange(ids), tags: 全量标签对象数组, onCreate(name) => Promise<tag>, placeholder }
 */
import { useEffect, useRef, useState } from 'react'

const DEFAULT_COLOR = '#94a3b8'

export default function TagSelect({ value = [], onChange, tags = [], onCreate, placeholder = '选择标签' }) {
  const [open, setOpen] = useState(false)
  const [kw, setKw] = useState('')
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')
  // 本地标签副本：props 变化时同步；新建成功后立即乐观合并，
  // 消除「创建返回 → props 重拉生效」之间新标签选中无 chip 的空窗
  const [localTags, setLocalTags] = useState(tags)
  useEffect(() => { setLocalTags(tags) }, [tags])
  const rootRef = useRef(null)
  const inputRef = useRef(null)

  // 点外部 / Esc 关闭
  useEffect(() => {
    if (!open) return
    const onDown = e => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const byId = id => localTags.find(t => t.id === id)
  const selected = value.map(byId).filter(Boolean)
  const kwLower = kw.trim().toLowerCase()
  const filtered = kwLower ? localTags.filter(t => t.name.toLowerCase().includes(kwLower)) : localTags
  // 大小写不敏感比较：已有「DP」时输入「dp」不再出现新建入口
  const canCreate = !!kw.trim() && !localTags.some(t => t.name.toLowerCase() === kwLower)

  const toggle = id => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id])
  const remove = (id, e) => { e.stopPropagation(); onChange(value.filter(x => x !== id)) }

  const handleCreate = async () => {
    const name = kw.trim()
    if (!name || creating || !canCreate) return
    if (!onCreate) { setErr('暂不支持新建标签'); return }
    setCreating(true); setErr('')
    try {
      const tag = await onCreate(name)
      if (tag?.id) setLocalTags(list => (list.some(t => t.id === tag.id) ? list : [...list, tag]))
      if (tag?.id && !value.includes(tag.id)) onChange([...value, tag.id])
      setKw('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      {/* 触发器：已选 chips + 占位 */}
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full min-h-9 px-2 py-1 rounded-lg text-sm text-left bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors flex items-center flex-wrap gap-1">
        {selected.length === 0 && <span className="text-stone-400 px-1">{placeholder}</span>}
        {selected.map(t => (
          <span key={t.id}
            className="inline-flex items-center gap-1 rounded-full px-2 h-6 text-[11px] whitespace-nowrap"
            style={{ color: t.color || DEFAULT_COLOR, borderColor: (t.color || DEFAULT_COLOR) + '55', background: (t.color || DEFAULT_COLOR) + '14', border: `1px solid ${(t.color || DEFAULT_COLOR) + '55'}` }}>
            {t.name}
            <span role="button" tabIndex={-1} onClick={e => remove(t.id, e)}
              className="ml-0.5 opacity-60 hover:opacity-100 cursor-pointer">✕</span>
          </span>
        ))}
        <span className="ml-auto text-stone-400 text-xs px-1 shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-black/[0.08] dark:border-white/[0.1] bg-white dark:bg-[#1c1b1a] shadow-lg p-2">
          <input ref={inputRef} value={kw} onChange={e => setKw(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); if (canCreate) handleCreate(); else if (filtered.length === 1) toggle(filtered[0].id) }
            }}
            placeholder="搜索或输入新标签名称…"
            className="w-full px-3 h-8 rounded-lg text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 outline-none focus:border-black/30 dark:focus:border-white/30 mb-1.5" />

          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && !canCreate && (
              <div className="py-4 text-center text-xs text-stone-400">没有匹配的标签</div>
            )}
            {filtered.map(t => {
              const on = value.includes(t.id)
              return (
                <button type="button" key={t.id} onClick={() => toggle(t.id)}
                  className="w-full flex items-center gap-2 px-2 h-8 rounded-lg text-sm text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.07] transition-colors">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color || DEFAULT_COLOR }} />
                  <span className="truncate flex-1">{t.name}</span>
                  {t.problem_count != null && (
                    <span className="text-[11px] text-stone-400 tabular-nums">{t.problem_count}</span>
                  )}
                  {on && <span className="text-indigo-500 text-xs">✓</span>}
                </button>
              )
            })}
          </div>

          {canCreate && (
            <button type="button" onClick={handleCreate} disabled={creating}
              className="mt-1 w-full flex items-center justify-center gap-1 px-2 h-8 rounded-lg text-sm bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 transition-colors disabled:opacity-50">
              {creating ? '创建中…' : `＋ 新建标签「${kw.trim()}」`}
            </button>
          )}
          {err && <div className="mt-1 px-1 text-[11.5px] text-red-600 dark:text-red-400">{err}</div>}
        </div>
      )}
    </div>
  )
}
