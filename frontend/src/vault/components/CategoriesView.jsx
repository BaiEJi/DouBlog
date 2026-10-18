/**
 * Vault 类别页 /vault（section='categories'）：布局参考配置中心（/confcenter）——
 * 左侧类别栏（内置 9 项 + 自定义类别，含条目计数与「管理」入口），
 * 右侧当前类别条目表。个性色玫瑰粉（rose）：只用于徽章、主按钮、选中态。
 * 类别存于条目加密 blob 的 category 字段（自由字符串），计数与过滤均在客户端
 * 解密后进行；目录（含自定义类别）见 categoryCatalog.js。
 */
import { useMemo, useState } from 'react'
import { TYPE_LABELS, itemMatches, domainOf } from './core'
import { Favicon, I } from './ui'
import CategoryManager from './CategoryManager'

const card = 'rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]'
const btnPri = 'h-9 px-3.5 text-sm font-medium rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors disabled:opacity-40 shrink-0 inline-flex items-center gap-1.5'
const btnGhost = 'h-7 px-2 text-[12px] font-medium rounded-lg text-stone-500 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors shrink-0'
const btnView = 'px-2.5 h-7 rounded-md text-sm text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors'
const inputCls = 'w-60 h-9 px-3 text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-lg text-stone-800 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors'

function fmtTime(s) {
  if (!s) return '-'
  const d = new Date(s)
  return isNaN(d) ? String(s) : d.toLocaleString('zh-CN', { hour12: false })
}

/** 类型徽章：中性 stone（玫瑰粉只给选中态/主按钮/计数） */
function TypeBadge({ type }) {
  return (
    <span className="px-1.5 py-0.5 rounded-md text-[13px] font-medium bg-stone-500/10 text-stone-600 dark:text-stone-300">
      {TYPE_LABELS[type] || type}
    </span>
  )
}

export default function CategoriesView({
  items, catalog, active: activeProp, onActiveChange, onOpenItem, onNew,
  onAddCategory, onRenameCategory, onDeleteCategory,
}) {
  const counts = useMemo(() => {
    const m = Object.create(null)
    for (const c of catalog) m[c.key] = 0
    for (const i of items) {
      const k = i.data?.category
      if (k && m[k] != null) m[k]++
      else if (k) m[k] = (m[k] || 0) + 1
    }
    return m
  }, [catalog, items])

  // 选中类别由父级持有（新建/编辑往返不丢）；未指定时默认第一个有条目的类别
  const fallbackActive = catalog.find(c => counts[c.key] > 0)?.key || catalog[0]?.key || ''
  const active = activeProp && catalog.some(c => c.key === activeProp) ? activeProp : fallbackActive
  const [q, setQ] = useState('')
  const [managerOpen, setManagerOpen] = useState(false)

  const pick = (key) => { setQ(''); onActiveChange?.(key) }

  const activeEntry = catalog.find(c => c.key === active) || catalog[0]
  const inCategory = useMemo(() => items.filter(i => i.data?.category === active), [items, active])
  const rows = useMemo(() => {
    const query = q.trim()
    return query ? inCategory.filter(i => itemMatches(i, query)) : inCategory
  }, [inCategory, q])

  return (
    <div className="p-0 animate-fade-in max-w-full w-full mx-auto">
      <div className="flex items-start gap-4">
        {/* 左栏：类别目录（计数 + 管理入口） */}
        <aside aria-label="类别" className={`${card} w-52 shrink-0 p-2 sticky top-8`}>
          <div className="px-2 py-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-stone-500 dark:text-stone-400">类别</h2>
            <span className="text-[13px] tabular-nums text-stone-400 dark:text-stone-500">{items.length}</span>
          </div>
          <div className="px-2 pb-2">
            <button type="button" className={btnGhost + ' w-full justify-center inline-flex items-center gap-1'} onClick={() => setManagerOpen(true)}>
              {I.sliders} 管理类别
            </button>
          </div>
          <nav aria-label="类别列表" className="space-y-0.5 max-h-[calc(100vh-340px)] overflow-y-auto">
            {catalog.map(c => (
              <button key={c.key} type="button" onClick={() => pick(c.key)} aria-pressed={active === c.key}
                title={c.orphan ? `${c.label}（备份恢复的类别，可改类归位）` : c.label}
                className={'w-full flex items-center justify-between gap-2 px-2.5 h-9 rounded-lg text-sm transition-colors ' +
                  (active === c.key
                    ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 font-medium'
                    : 'text-stone-600 dark:text-stone-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]')}>
                <span className="min-w-0 truncate">{c.label}</span>
                <span className="text-[12px] text-stone-400 dark:text-stone-500 tabular-nums shrink-0">{counts[c.key] || 0}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* 右栏：当前类别条目表 */}
        <section aria-label={`类别 ${activeEntry?.label || ''}`} className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-4 min-w-0">
            <h2 className="text-xl font-semibold">{activeEntry?.label || '类别'}</h2>
            <span className="shrink-0 text-sm text-stone-400 dark:text-stone-500">{inCategory.length} 个条目</span>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <input value={q} onChange={e => setQ(e.target.value)} aria-label="搜索当前类别" placeholder="搜索当前类别内的条目…" className={inputCls} />
            <button type="button" className={`${btnPri} ml-auto`} onClick={onNew}>{I.plus} 新建条目</button>
          </div>
          <div className={`${card} overflow-x-auto`}>
            <table className="w-full min-w-[640px] table-fixed text-base">
              <colgroup>
                <col /><col /><col className="w-[96px]" /><col className="w-[176px]" /><col className="w-[88px]" />
              </colgroup>
              <thead><tr className="text-left text-sm text-stone-500 dark:text-stone-400 border-b border-black/[0.06] dark:border-white/[0.06]">
                <th className="pl-4 pr-2 py-2 font-normal">名称</th><th className="px-2 py-2 font-normal">用户名</th><th className="px-2 py-2 font-normal">类型</th><th className="px-2 py-2 font-normal">更新时间</th><th className="pl-2 pr-4 py-2 font-normal text-right">操作</th>
              </tr></thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="py-14 text-center">
                    <p className="text-base text-stone-500 dark:text-stone-400">{q ? `没有匹配“${q}”的条目` : '这个类别还没有条目'}</p>
                    {!q && <button type="button" onClick={onNew} className="mt-3 text-sm font-medium text-rose-600 dark:text-rose-400 hover:underline">新建第一个条目</button>}
                  </td></tr>
                )}
                {rows.map(item => (
                  <tr key={item.id} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-black/[0.015] dark:hover:bg-white/[0.02] transition-colors">
                    <td className="pl-4 pr-2 py-2.5">
                      <button type="button" onClick={() => onOpenItem(item)} className="flex items-center gap-2.5 min-w-0 max-w-full text-left group">
                        <Favicon domain={domainOf(item.data.urls?.[0]?.value)} name={item.data.service} size={24} />
                        <span className="truncate text-stone-800 dark:text-stone-100 group-hover:text-rose-700 dark:group-hover:text-rose-300 transition-colors" title={item.data.service}>{item.data.service || '未命名'}</span>
                        {item.favorite && <span className="text-amber-500 shrink-0">{I.starFill}</span>}
                      </button>
                    </td>
                    <td className="px-2 py-2.5 text-stone-600 dark:text-stone-300"><span className="block truncate" title={item.data.username}>{item.data.username || item.data.account_id || (item.data.identities || [])[0]?.value || '—'}</span></td>
                    <td className="px-2 py-2.5 whitespace-nowrap"><TypeBadge type={item.data.type} /></td>
                    <td className="px-2 py-2.5 whitespace-nowrap text-sm text-stone-500 dark:text-stone-400">{fmtTime(item.updated_at)}</td>
                    <td className="pl-2 pr-4 py-2.5 text-right whitespace-nowrap">
                      <button type="button" onClick={() => onOpenItem(item)} className={btnView}>查看</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {managerOpen && (
        <CategoryManager
          catalog={catalog} counts={counts} onClose={() => setManagerOpen(false)}
          onAdd={onAddCategory} onRename={onRenameCategory}
          onDelete={(key, count) => {
            const r = onDeleteCategory(key, count)
            if (r.ok && key === active) onActiveChange?.(null)   // 删掉当前选中项 → 回落默认
            return r
          }}
        />
      )}
    </div>
  )
}
