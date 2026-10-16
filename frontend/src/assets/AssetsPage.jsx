/**
 * 资产库主页面 /assets —— Prompt 与 Skill 的沉淀、检索、填充与版本管理。
 * 布局：模块侧栏（ModuleShell，经 PageHeader 注册 资产库/回收站/统计 三视图）+
 * 页内左过滤栏（快速过滤/分类/标签）+ 列表卡片网格 + 右侧详情抽屉；
 * 编辑器/分类管理/导入导出为弹层；支持批量操作与 Ctrl+K 搜索。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PageHeader from '../shared/PageHeader'
import { useDebouncedValue } from '../shared/useDebouncedValue'
import {
  assetsBulkItems, assetsCategories, assetsCreateItem, assetsDeleteItem,
  assetsDuplicateItem, assetsItems, assetsRestoreItem, assetsTags,
  assetsUpdateItem, assetsUseItem,
} from './api'
import { KIND_META, Toast, copyText } from './kit'
import ItemDetail from './components/ItemDetail'
import ItemEditor from './components/ItemEditor'
import CategoryManager from './components/CategoryManager'
import ImportPanel from './components/ImportPanel'
import StatsView from './components/StatsView'

const PAGE_SIZE = 24
const SORTS = [
  ['updated_desc', '最近更新'],
  ['created_desc', '最近创建'],
  ['usage_desc', '最常用'],
  ['last_used_desc', '最近使用'],
  ['title_asc', '标题'],
]

function ItemCard({ item, selected, bulkMode, onOpen, onToggle, onAction, onTag }) {
  const meta = KIND_META[item.kind] || KIND_META.prompt
  return (
    <div className={`relative flex flex-col p-4 rounded-2xl border transition-all group ${selected
      ? 'border-fuchsia-500/50 bg-fuchsia-500/[0.04]'
      : 'border-black/[0.07] dark:border-white/[0.09] bg-white dark:bg-white/[0.025] hover:border-black/[0.16] dark:hover:border-white/[0.18] hover:shadow-sm'}`}>
      <div className="flex items-start gap-2">
      {bulkMode && (
        <input type="checkbox" checked={selected} onChange={() => onToggle(item.id)}
          className="w-4 h-4 accent-fuchsia-600 shrink-0 mt-0.5" aria-label={`选择 ${item.title}`} />
      )}
      <button type="button" onClick={() => onOpen(item.id)} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-medium ${meta.chip}`}>{meta.icon} {meta.label}</span>
          {item.status === 'archived' && <span className="px-1.5 py-0.5 rounded text-[10.5px] bg-stone-500/10 text-stone-500">归档</span>}
          {item.variables?.length > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400">
              {'{{}}'} {item.variables.length}
            </span>
          )}
        </div>
        <h3 className="text-[14px] font-medium leading-snug break-words line-clamp-2 mb-1.5">{item.title}</h3>
        {item.summary
          ? <p className="text-[12px] text-stone-500 dark:text-stone-400 leading-relaxed line-clamp-2 mb-2.5">{item.summary}</p>
          : <p className="text-[12px] text-stone-400 leading-relaxed line-clamp-2 mb-2.5 font-mono">{(item.content || '').slice(0, 120)}</p>}
        <div className="flex items-center gap-1.5 flex-wrap">
          {item.category && <span className="text-[11px] text-stone-400">{item.category}</span>}
          {item.tags?.slice(0, 3).map(t => (
            <button key={t} type="button" onClick={e => { e.stopPropagation(); onTag(t) }}
              className="px-1.5 py-0.5 rounded-md text-[10.5px] bg-black/[0.05] dark:bg-white/[0.07] text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200">#{t}</button>
          ))}
        </div>
      </button>
      </div>
      <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-black/[0.05] dark:border-white/[0.06]">
        <span className="text-[10.5px] text-stone-400 tabular-nums whitespace-nowrap">
          v{item.version} · 用 {item.usage_count} · {(item.updated_at || '').slice(5, 10)}
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button type="button" title="收藏" onClick={() => onAction('favorite', item)}
            className={`w-6 h-6 rounded-lg text-[13px] ${item.favorite ? 'text-amber-500' : 'text-stone-400 hover:text-amber-500'}`}>
            {item.favorite ? '★' : '☆'}
          </button>
          <button type="button" title="复制全文" onClick={() => onAction('quick_copy', item)}
            className="w-6 h-6 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200">⧉</button>
          <button type="button" title="编辑" onClick={() => onAction('edit', item)}
            className="w-6 h-6 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200">✎</button>
          <button type="button" title="移入回收站" onClick={() => onAction('trash', item)}
            className="w-6 h-6 rounded-lg text-stone-400 hover:text-red-500">🗑</button>
        </div>
      </div>
    </div>
  )
}

export default function AssetsPage({ dark }) {
  const [view, setView] = useState('library')            // library | trash | stats
  const [kindFilter, setKindFilter] = useState('')       // '' | prompt | skill
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [categoryId, setCategoryId] = useState('')       // '' | <id> | 'none'
  const [tagFilter, setTagFilter] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search, 300)
  const [sort, setSort] = useState('updated_desc')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [categories, setCategories] = useState([])
  const [tags, setTags] = useState([])
  const [bulkMode, setBulkMode] = useState(false)
  const [selection, setSelection] = useState(() => new Set())
  const [detailId, setDetailId] = useState(null)
  const [editing, setEditing] = useState(null)           // null | {} (新建) | item
  const [showCategory, setShowCategory] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [toastMsg, setToastMsg] = useState(null)
  const [toastKind, setToastKind] = useState('')
  const searchRef = useRef(null)

  const toast = useCallback((msg, kind) => {
    setToastMsg(msg); setToastKind(kind || '')
    setTimeout(() => setToastMsg(null), 2400)
  }, [])

  const status = view === 'trash' ? 'trash' : 'active'
  const filters = useMemo(() => ({
    kind: kindFilter, category_id: categoryId, tag: tagFilter, favorite: favoriteOnly ? 1 : '',
  }), [kindFilter, categoryId, tagFilter, favoriteOnly])

  const loadLists = useCallback(() => {
    assetsCategories().then(r => { if (r.success) setCategories(r.data) })
    assetsTags().then(r => { if (r.success) setTags(r.data) })
  }, [])

  const load = useCallback(() => {
    const params = { ...filters, q, sort, page, page_size: PAGE_SIZE }
    if (view === 'trash') {
      params.status = 'trash'
      params.kind = params.category_id = params.tag = params.favorite = ''
      params.q = q
    } else if (view === 'archived') {
      params.status = 'archived'
    }
    assetsItems(params).then(r => {
      if (r.success) setData(r.data)
      else toast(r.message || '列表加载失败', 'error')
    })
  }, [filters, q, sort, page, view, toast])
  useEffect(load, [load])
  useEffect(loadLists, [loadLists])

  // 过滤条件变化回到第一页
  useEffect(() => { setPage(1) }, [filters, q, sort, view])

  // Ctrl+K 聚焦搜索
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !editing && !detailId) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editing, detailId])

  const refresh = useCallback(() => { load(); loadLists() }, [load, loadLists])

  const openDetail = id => setDetailId(id)

  const doAction = async (action, item) => {
    if (action === 'edit') { setEditing(item); return }
    if (action === 'favorite') {
      const r = await assetsUpdateItem(item.id, { favorite: !item.favorite })
      if (r.success) { toast(item.favorite ? '已取消收藏' : '已收藏'); refresh() }
      else toast(r.message || '操作失败', 'error')
      return
    }
    if (action === 'quick_copy') {
      const r = await assetsUseItem(item.id, 'copy')
      if (r.success && await copyText(r.data.content)) {
        toast('已复制（使用 +1）'); refresh()
      } else if (!r.success) toast(r.message || '复制失败', 'error')
      return
    }
    if (action === 'trash') {
      const r = await assetsDeleteItem(item.id)
      if (r.success) { toast('已移入回收站'); refresh(); if (detailId === item.id) setDetailId(null) }
      else toast(r.message || '操作失败', 'error')
      return
    }
    if (action === 'restore') {
      const r = await assetsRestoreItem(item.id)
      if (r.success) { toast('已恢复'); refresh(); if (detailId === item.id) setDetailId(null) }
      else toast(r.message || '操作失败', 'error')
      return
    }
    if (action === 'hard_delete') {
      if (!window.confirm(`彻底删除「${item.title}」？连同版本与使用记录，不可恢复。`)) return
      const r = await assetsDeleteItem(item.id, true)
      if (r.success) { toast('已彻底删除'); refresh(); if (detailId === item.id) setDetailId(null) }
      else toast(r.message || '操作失败', 'error')
      return
    }
    if (action === 'duplicate') {
      const r = await assetsDuplicateItem(item.id)
      if (r.success) { toast('已复制一份'); refresh() }
      else toast(r.message || '复制失败', 'error')
      return
    }
    if (action === 'archive' || action === 'unarchive') {
      const r = await assetsBulkItems({ ids: [item.id], action })
      if (r.success) { refresh() } else toast(r.message || '操作失败', 'error')
      return
    }
  }

  const bulk = async action => {
    const ids = [...selection]
    if (!ids.length) return
    if (action === 'hard_delete' && !window.confirm(`彻底删除 ${ids.length} 项？不可恢复。`)) return
    const r = await assetsBulkItems({ ids, action, ...(action === 'move' ? { category_id: null } : {}) })
    if (r.success) {
      toast(`已对 ${r.data.affected} 项执行操作`)
      setSelection(new Set())
      setBulkMode(false)
      refresh()
    } else toast(r.message || '批量操作失败', 'error')
  }

  const saveItem = async (payload, id) => {
    const r = id ? await assetsUpdateItem(id, payload) : await assetsCreateItem(payload)
    if (r.success) {
      toast(id ? '已保存' : '已创建')
      setEditing(null)
      refresh()
    } else toast(r.message || '保存失败', 'error')
  }

  const toggleSelect = id => {
    setSelection(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const quickFilters = [
    { key: 'all', label: '全部', active: !kindFilter && !favoriteOnly, onClick: () => { setKindFilter(''); setFavoriteOnly(false) } },
    { key: 'fav', label: '★ 收藏', active: favoriteOnly, onClick: () => setFavoriteOnly(v => !v) },
    { key: 'prompt', label: 'Prompt', active: kindFilter === 'prompt' && !favoriteOnly, onClick: () => { setKindFilter(kindFilter === 'prompt' ? '' : 'prompt'); setFavoriteOnly(false) } },
    { key: 'skill', label: 'Skill', active: kindFilter === 'skill' && !favoriteOnly, onClick: () => { setKindFilter(kindFilter === 'skill' ? '' : 'skill'); setFavoriteOnly(false) } },
  ]

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <div>
      <PageHeader
        title="资产库"
        subtitle="Prompt · Skill · 变量 · 版本"
        accent="fuchsia"
        tabs={[
          { key: 'library', label: '资产库' },
          { key: 'trash', label: '回收站' },
          { key: 'stats', label: '统计' },
        ]}
        activeTab={view === 'trash' ? 'trash' : view === 'stats' ? 'stats' : 'library'}
        onTabChange={key => { setView(key); setSelection(new Set()); setBulkMode(false) }}
      />

      {view === 'stats' ? (
        <StatsView onOpenItem={openDetail} toast={toast} />
      ) : (
        <div className="flex gap-6 items-start">
          {/* 左过滤栏 */}
          <aside className="hidden lg:flex flex-col w-52 shrink-0 sticky top-4 space-y-5" aria-label="资产过滤">
            <div className="space-y-1">
              {quickFilters.map(f => (
                <button key={f.key} type="button" onClick={f.onClick}
                  className={`w-full flex items-center px-3 py-2 rounded-xl text-[13px] transition-colors ${f.active
                    ? 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400 font-medium'
                    : 'text-stone-600 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'}`}>
                  {f.label}
                </button>
              ))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5 px-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-stone-400">分类</span>
                <button type="button" onClick={() => setShowCategory(true)}
                  className="text-[11px] text-stone-400 hover:text-stone-700 dark:hover:text-stone-200">管理</button>
              </div>
              <div className="space-y-0.5">
                <button type="button" onClick={() => setCategoryId('')}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12.5px] ${categoryId === ''
                    ? 'bg-black/[0.05] dark:bg-white/[0.07] font-medium' : 'text-stone-600 dark:text-stone-400 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'}`}>
                  全部分类
                </button>
                {categories.map(c => (
                  <button key={c.id ?? 'none'} type="button" onClick={() => setCategoryId(c.id === null ? 'none' : String(c.id))}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12.5px] ${String(categoryId) === String(c.id === null ? 'none' : c.id)
                      ? 'bg-black/[0.05] dark:bg-white/[0.07] font-medium' : 'text-stone-600 dark:text-stone-400 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'}`}>
                    <span>{c.icon || '·'}</span>
                    <span className="flex-1 min-w-0 truncate text-left">{c.name}</span>
                    <span className="text-[10.5px] text-stone-400 tabular-nums">{c.item_count}</span>
                  </button>
                ))}
              </div>
            </div>

            {tags.length > 0 && (
              <div>
                <span className="block mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-stone-400">标签</span>
                <div className="flex flex-wrap gap-1.5">
                  {tagFilter && (
                    <button type="button" onClick={() => setTagFilter('')}
                      className="px-2 py-1 rounded-lg text-[11.5px] bg-fuchsia-600 text-white">✕ {tagFilter}</button>
                  )}
                  {tags.filter(t => t.tag !== tagFilter).slice(0, 14).map(t => (
                    <button key={t.tag} type="button" onClick={() => setTagFilter(t.tag)}
                      className="px-2 py-1 rounded-lg text-[11.5px] bg-black/[0.05] dark:bg-white/[0.07] text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200">
                      #{t.tag} <span className="text-stone-400">{t.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* 主区 */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* 工具栏 */}
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="relative flex-1 min-w-[220px] max-w-md">
                <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="搜索资产（Ctrl+K）"
                  aria-label="搜索资产"
                  className="w-full pl-9 pr-8 py-2 rounded-xl border border-black/[0.1] dark:border-white/[0.12] bg-white dark:bg-white/[0.04] text-sm outline-none focus:border-black/30 dark:focus:border-white/30" />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-[13px]" aria-hidden="true">⌕</span>
                {search && (
                  <button type="button" onClick={() => setSearch('')} aria-label="清空搜索"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600">✕</button>
                )}
              </div>

              {view === 'library' && (
                <>
                  <select value={sort} onChange={e => setSort(e.target.value)} aria-label="排序"
                    className="px-2.5 py-2 rounded-xl border border-black/[0.1] dark:border-white/[0.12] bg-white dark:bg-white/[0.04] text-[13px] outline-none">
                    {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                  <button type="button" onClick={() => { setBulkMode(v => !v); setSelection(new Set()) }}
                    className={`px-3 py-2 rounded-xl text-[13px] border transition-colors ${bulkMode
                      ? 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400 font-medium'
                      : 'border-black/[0.1] dark:border-white/[0.12] text-stone-600 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.07]'}`}>
                    批量
                  </button>
                </>
              )}

              <span className="flex-1" />

              <button type="button" onClick={() => setShowImport(true)}
                className="px-3 py-2 rounded-xl text-[13px] border border-black/[0.1] dark:border-white/[0.12] text-stone-600 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.07]">
                导入 / 导出
              </button>
              <button type="button" onClick={() => setEditing({})}
                className="px-3.5 py-2 rounded-xl text-[13px] font-medium bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90 transition-opacity">
                ＋ 新建资产
              </button>
            </div>

            {/* 批量操作条 */}
            {bulkMode && view === 'library' && (
              <div className="flex items-center gap-2.5 flex-wrap px-4 py-2.5 rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/[0.05]">
                <span className="text-[12.5px]">已选 <b>{selection.size}</b> 项</span>
                <button type="button" onClick={() => bulk('favorite')} disabled={!selection.size} className="px-2.5 py-1 rounded-lg text-[12px] border border-black/[0.1] dark:border-white/[0.12] hover:bg-black/[0.04] dark:hover:bg-white/[0.07] disabled:opacity-40">收藏</button>
                <button type="button" onClick={() => bulk('unfavorite')} disabled={!selection.size} className="px-2.5 py-1 rounded-lg text-[12px] border border-black/[0.1] dark:border-white/[0.12] hover:bg-black/[0.04] dark:hover:bg-white/[0.07] disabled:opacity-40">取消收藏</button>
                <button type="button" onClick={() => bulk('archive')} disabled={!selection.size} className="px-2.5 py-1 rounded-lg text-[12px] border border-black/[0.1] dark:border-white/[0.12] hover:bg-black/[0.04] dark:hover:bg-white/[0.07] disabled:opacity-40">归档</button>
                <button type="button" onClick={() => bulk('move')} disabled={!selection.size} className="px-2.5 py-1 rounded-lg text-[12px] border border-black/[0.1] dark:border-white/[0.12] hover:bg-black/[0.04] dark:hover:bg-white/[0.07] disabled:opacity-40" title="移到未分类">移出分类</button>
                <button type="button" onClick={() => bulk('trash')} disabled={!selection.size} className="px-2.5 py-1 rounded-lg text-[12px] border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-40">移入回收站</button>
                <button type="button" onClick={() => setSelection(new Set())}
                  className="ml-auto text-[12px] text-stone-400 hover:text-stone-600">全不选</button>
              </div>
            )}

            {/* 回收站批量条 */}
            {view === 'trash' && (
              <div className="flex items-center gap-2.5 flex-wrap px-4 py-2.5 rounded-2xl border border-black/[0.07] dark:border-white/[0.09]">
                <span className="text-[12.5px] text-stone-500">回收站 · {data?.total ?? '…'} 项</span>
                <button type="button" onClick={() => bulk('restore')} disabled={!selection.size}
                  className="px-2.5 py-1 rounded-lg text-[12px] border border-black/[0.1] dark:border-white/[0.12] hover:bg-black/[0.04] dark:hover:bg-white/[0.07] disabled:opacity-40">恢复所选</button>
                <button type="button" onClick={() => bulk('hard_delete')} disabled={!selection.size}
                  className="px-2.5 py-1 rounded-lg text-[12px] border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-40">彻底删除所选</button>
              </div>
            )}

            {/* 列表 */}
            {!data ? (
              <p className="text-[13px] text-stone-400 py-14 text-center">加载中…</p>
            ) : data.items.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-[13px] text-stone-400 mb-4">
                  {view === 'trash' ? '回收站是空的' : search || tagFilter || categoryId || kindFilter || favoriteOnly
                    ? '没有匹配的资产——试试放宽过滤条件'
                    : '还没有资产——新建一个 Prompt 或 Skill 开始沉淀'}
                </p>
                {view === 'library' && !search && !tagFilter && !categoryId && !kindFilter && (
                  <button type="button" onClick={() => setEditing({})}
                    className="px-4 py-2 rounded-xl text-sm font-medium bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90">＋ 新建第一个资产</button>
                )}
              </div>
            ) : (
              <div className={`grid gap-3.5 ${view === 'trash'
                ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3'
                : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'}`}>
                {data.items.map(item => view === 'trash' ? (
                  <div key={item.id}
                    className={`flex items-center gap-3 p-4 rounded-2xl border ${selection.has(item.id)
                      ? 'border-fuchsia-500/50 bg-fuchsia-500/[0.04]'
                      : 'border-black/[0.07] dark:border-white/[0.09] bg-white dark:bg-white/[0.025]'}`}>
                    <input type="checkbox" checked={selection.has(item.id)} onChange={() => toggleSelect(item.id)}
                      className="w-4 h-4 accent-fuchsia-600 shrink-0" aria-label={`选择 ${item.title}`} />
                    <button type="button" onClick={() => openDetail(item.id)} className="flex-1 min-w-0 text-left">
                      <div className="text-[13.5px] font-medium truncate mb-0.5">{item.title}</div>
                      <div className="text-[11px] text-stone-400 truncate">
                        {(KIND_META[item.kind] || {}).label} · 删除于 {(item.updated_at || '').slice(5, 10)}
                      </div>
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button type="button" onClick={() => doAction('restore', item)}
                        className="px-2.5 py-1 rounded-lg text-[12px] border border-black/[0.1] dark:border-white/[0.12] hover:bg-black/[0.04] dark:hover:bg-white/[0.07]">恢复</button>
                      <button type="button" onClick={() => doAction('hard_delete', item)}
                        className="px-2.5 py-1 rounded-lg text-[12px] border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10">彻底删除</button>
                    </div>
                  </div>
                ) : (
                  <ItemCard key={item.id} item={item} bulkMode={bulkMode} selected={selection.has(item.id)}
                    onOpen={openDetail} onToggle={toggleSelect} onAction={doAction}
                    onTag={t => setTagFilter(t === tagFilter ? '' : t)} />
                ))}
              </div>
            )}

            {/* 分页 */}
            {data && data.total > data.page_size && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                  className="px-3 py-1.5 rounded-xl text-[13px] border border-black/[0.1] dark:border-white/[0.12] hover:bg-black/[0.04] dark:hover:bg-white/[0.07] disabled:opacity-40 disabled:cursor-not-allowed">上一页</button>
                <span className="text-[12.5px] text-stone-400 tabular-nums">{page} / {totalPages} · 共 {data.total} 项</span>
                <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                  className="px-3 py-1.5 rounded-xl text-[13px] border border-black/[0.1] dark:border-white/[0.12] hover:bg-black/[0.04] dark:hover:bg-white/[0.07] disabled:opacity-40 disabled:cursor-not-allowed">下一页</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 弹层 */}
      {detailId && (
        <ItemDetail itemId={detailId} dark={dark} toast={toast}
          onClose={() => setDetailId(null)}
          onEdit={item => setEditing(item)}
          onAction={doAction}
          onRefresh={() => { load(); loadLists() }} />
      )}
      {editing && (
        <ItemEditor item={editing.id ? editing : null} categories={categories}
          onClose={() => setEditing(null)} onSave={saveItem} />
      )}
      {showCategory && (
        <CategoryManager onClose={() => setShowCategory(false)} onChanged={loadLists} toast={toast} />
      )}
      {showImport && (
        <ImportPanel filters={filters} onClose={() => setShowImport(false)} onDone={refresh} toast={toast} />
      )}
      <Toast msg={toastMsg} kind={toastKind} />
    </div>
  )
}
