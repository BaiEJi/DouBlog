/**
 * 收藏夹主列表：筛选（搜索/分类/状态/标签/排序）+ 批量操作条 + 分页。
 * 数据由 BookmarksView 传入 categories/tags，操作经 onChanged 通知上层刷新。
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  listItems, batchItems, deleteItem, updateItem, flattenCategories, STATUSES, SORTS,
} from '../api'
import { Icon, Spinner, Empty, inputCls } from '../../../todo/kit'
import { useDebouncedValue } from '../../../shared/useDebouncedValue'
import ItemRow from './ItemRow'

const STATUS_CHIPS = [{ value: '', label: '全部' },
  ...STATUSES.map(s => ({ value: s.value, label: s.label })),
  { value: 'starred', label: '星标' }]

export default function ListView({ toast, categories, tags, refreshSignal, onChanged, onOpenDetail, onEdit, onManageCategories }) {
  const [q, setQ] = useState('')
  const dq = useDebouncedValue(q, 300)
  const [status, setStatus] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [tagId, setTagId] = useState('')
  const [sort, setSort] = useState('created_desc')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const flatCats = useMemo(() => flattenCategories(categories), [categories])

  // 筛选变化回到第 1 页
  useEffect(() => { setPage(1) }, [dq, status, categoryId, tagId, sort])

  useEffect(() => {
    setLoading(true)
    listItems({
      q: dq, status: status === 'starred' ? '' : status,
      starred: status === 'starred' ? true : undefined,
      category_id: categoryId, tag_ids: tagId, sort, page, page_size: 20,
    })
      .then(res => { if (alive.current) { setData(res); setSelected(new Set()) } })
      .catch(e => { if (alive.current) { toast(e.message, 'err'); setData({ items: [], total: 0, pages: 1 }) } })
      .finally(() => { if (alive.current) setLoading(false) })
  }, [dq, status, categoryId, tagId, sort, page, refreshSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = data?.items || []
  const allChecked = items.length > 0 && items.every(it => selected.has(it.id))

  const toggleAll = () => {
    setSelected(prev => {
      const next = new Set(prev)
      if (allChecked) items.forEach(it => next.delete(it.id))
      else items.forEach(it => next.add(it.id))
      return next
    })
  }

  const runBatch = async (action, extra, okMsg) => {
    if (selected.size === 0) return
    setBusy(true)
    try {
      await batchItems([...selected], action, extra)
      toast(okMsg)
      setSelected(new Set())
      onChanged()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const onAction = async (action, item) => {
    if (action === 'detail') return onOpenDetail(item.id)
    if (action === 'edit') return onEdit(item.id)
    if (action === 'delete') {
      if (!window.confirm(`把「${item.title}」移入回收站？`)) return
      setBusy(true)
      try { await deleteItem(item.id); toast('已移入回收站'); onChanged() }
      catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
      return
    }
    // star / read / unread
    setBusy(true)
    try {
      await updateItem(item.id, action === 'star' ? { starred: !item.starred } : { status: action })
      onChanged()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      {/* ── 筛选栏 ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索标题 / 链接 / 摘要…"
            className={inputCls + ' w-64 pl-8'} />
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" viewBox="0 0 20 20" fill="none">
            <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M13.5 13.5 17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className={inputCls} style={{ width: '11rem' }}>
          <option value="">全部分类</option>
          {flatCats.map(c => (
            <option key={c.id} value={c.id}>{'　'.repeat(c.depth)}{c.name}（{c.total_count}）</option>
          ))}
        </select>
        <select value={tagId} onChange={e => setTagId(e.target.value)} className={inputCls} style={{ width: '9.5rem' }}>
          <option value="">全部标签</option>
          {tags.map(t => <option key={t.id} value={t.id}>{t.name}（{t.item_count}）</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)} className={inputCls} style={{ width: '8.5rem' }}>
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button type="button" onClick={onManageCategories}
          className="inline-flex items-center gap-1 px-3 h-9 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">
          分类管理</button>
      </div>

      {/* ── 状态 chips ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {STATUS_CHIPS.map(c => (
          <button key={c.value} type="button" onClick={() => setStatus(c.value)}
            className={'px-2.5 h-7 rounded-full text-xs transition-colors ' +
              (status === c.value
                ? 'bg-orange-500 text-white font-medium'
                : 'bg-black/[0.05] dark:bg-white/[0.07] text-stone-500 dark:text-stone-400 hover:bg-black/10 dark:hover:bg-white/[0.12]')}>
            {c.label}
          </button>
        ))}
        <span className="flex-1" />
        {data && <span className="text-xs text-stone-400 dark:text-stone-500 tabular-nums">{data.total} 条</span>}
      </div>

      {/* ── 批量操作条 ── */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-3.5 py-2 rounded-xl border border-orange-400/40 dark:border-orange-400/30 bg-orange-500/[0.05] text-sm">
          <span className="text-xs text-stone-500 dark:text-stone-400">已选 {selected.size} 条</span>
          <button type="button" disabled={busy} onClick={() => runBatch('status', { value: 'read' }, '已标为已读')}
            className="px-2.5 h-7 rounded-lg text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50">标为已读</button>
          <button type="button" disabled={busy} onClick={() => runBatch('status', { value: 'unread' }, '已标为未读')}
            className="px-2.5 h-7 rounded-lg text-xs bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50">标为未读</button>
          <button type="button" disabled={busy} onClick={() => runBatch('star', {}, '已加星标')}
            className="px-2.5 h-7 rounded-lg text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50">加星标</button>
          <select disabled={busy} defaultValue=""
            onChange={e => { const v = e.target.value; if (v !== '') runBatch('move_category', { value: v || null }, '已移动分类'); e.target.value = '' }}
            className="px-2 h-7 rounded-lg text-xs bg-black/[0.05] dark:bg-white/[0.08] border-0 outline-none disabled:opacity-50" style={{ width: '9rem' }}>
            <option value="">移动到分类…</option>
            <option value="">（未分类）</option>
            {flatCats.map(c => <option key={c.id} value={c.id}>{'　'.repeat(c.depth)}{c.name}</option>)}
          </select>
          <input placeholder="加标签（逗号分隔）" className="px-2 h-7 w-40 rounded-lg text-xs bg-black/[0.05] dark:bg-white/[0.08] border-0 outline-none"
            onKeyDown={e => {
              if (e.key === 'Enter' && e.target.value.trim()) {
                runBatch('add_tags', { tag_names: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) }, '已加标签')
                e.target.value = ''
              }
            }} />
          <button type="button" disabled={busy} onClick={() => runBatch('delete', {}, '已移入回收站')}
            className="px-2.5 h-7 rounded-lg text-xs text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-50">移入回收站</button>
          <span className="flex-1" />
          <button type="button" onClick={() => setSelected(new Set())}
            className="px-2 h-7 rounded-lg text-xs text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">取消选择</button>
        </div>
      )}

      {/* ── 列表 ── */}
      {loading && !data ? <Spinner /> : items.length === 0 ? (
        <Empty text="这里还没有书签——用右上角「收录网址」开始收藏" />
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-2 px-1 text-xs text-stone-400 dark:text-stone-500 cursor-pointer select-none">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} className="w-3.5 h-3.5 accent-orange-500 dark:[color-scheme:dark]" />
            全选本页
          </label>
          {loading && <div className="text-center py-1"><Spinner text="刷新中…" /></div>}
          {items.map(it => (
            <ItemRow key={it.id} item={it} mode="list" busy={busy}
              selected={selected.has(it.id)}
              onToggleSelect={() => setSelected(prev => {
                const next = new Set(prev)
                next.has(it.id) ? next.delete(it.id) : next.add(it.id)
                return next
              })}
              onOpen={item => onOpenDetail(item.id)}
              onAction={onAction} />
          ))}
        </div>
      )}

      {/* ── 分页 ── */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-1">
          <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="inline-flex items-center px-3 h-8 rounded-lg text-sm bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-40">
            {Icon.chevL}上一页</button>
          <span className="text-xs text-stone-400 tabular-nums">{page} / {data.pages}</span>
          <button type="button" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}
            className="inline-flex items-center px-3 h-8 rounded-lg text-sm bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-40">
            下一页{Icon.chevR}</button>
        </div>
      )}
    </div>
  )
}
