/**
 * 收录 / 编辑表单（覆盖层）：URL + 一键抓取元信息自动填充；标题/摘要/笔记/
 * 分类/状态/星标/标签（自由输入逗号分隔，已有标签可点选）。
 */
import { useEffect, useMemo, useState } from 'react'

import { createItem, getItem, updateItem, fetchMeta } from '../api'
import { flattenCategories, STATUSES } from '../api'
import { Icon, Spinner, inputCls } from '../../todo/kit'

const FMT = 'w-full flex flex-col gap-1'

export default function ItemForm({ itemId, categories, tags, onBack, onSaved, toast }) {
  const editing = !!itemId
  const [loading, setLoading] = useState(editing)
  const [busy, setBusy] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [form, setForm] = useState({
    url: '', title: '', description: '', note: '', site_name: '',
    category_id: '', status: 'unread', starred: false, tag_names: [],
  })
  const [tagInput, setTagInput] = useState('')

  useEffect(() => {
    if (!editing) return
    let alive = true
    getItem(itemId)
      .then(d => { if (alive) {
        setForm({
          url: d.url, title: d.title, description: d.description || '', note: d.note || '',
          site_name: d.site_name || '', category_id: d.category_id || '',
          status: d.status, starred: d.starred, tag_names: (d.tags || []).map(t => t.name),
        })
        setTagInput(((d.tags || []).map(t => t.name)).join(', '))
      } })
      .catch(e => { toast(e.message, 'err'); onBack() })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [itemId]) // eslint-disable-line react-hooks/exhaustive-deps

  const flatCats = useMemo(() => flattenCategories(categories), [categories])
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const doFetchMeta = async () => {
    if (!form.url.trim()) { toast('先填入网址', 'err'); return }
    setFetching(true)
    try {
      const meta = await fetchMeta(form.url.trim())
      setForm(f => ({
        ...f,
        url: meta.url || f.url,
        title: f.title || meta.title || '',
        description: f.description || meta.description || '',
        site_name: f.site_name || meta.site_name || '',
      }))
      toast('已抓取页面信息')
    } catch (e) { toast(e.message, 'err') } finally { setFetching(false) }
  }

  const submit = async () => {
    if (!form.url.trim()) { toast('网址不能为空', 'err'); return }
    if (!form.title.trim()) { toast('标题不能为空（可先抓取）', 'err'); return }
    setBusy(true)
    const tagNames = tagInput.split(/[,，]/).map(s => s.trim()).filter(Boolean)
    try {
      const payload = {
        url: form.url.trim(), title: form.title.trim(),
        description: form.description.trim() || null,
        note: form.note.trim() || null,
        site_name: form.site_name.trim() || null,
        status: form.status, starred: form.starred,
        category_id: form.category_id || null,
        tag_names: tagNames,
      }
      const saved = editing
        ? await updateItem(itemId, payload)
        : await createItem(payload)
      toast(editing ? '已保存' : '已收录')
      onSaved(saved.id)
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  if (loading) return <Spinner />

  return (
    <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-6 space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">{Icon.back}</button>
        <h2 className="text-base font-semibold">{editing ? '编辑书签' : '收录网址'}</h2>
      </div>

      <div className={FMT}>
        <label className="text-xs font-medium text-stone-500 dark:text-stone-400">网址 *</label>
        <div className="flex gap-2">
          <input value={form.url} onChange={e => set('url', e.target.value)}
            placeholder="https://…（裸域名自动补 https）" className={inputCls + ' font-mono flex-1'} />
          <button type="button" onClick={doFetchMeta} disabled={fetching}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors disabled:opacity-50 whitespace-nowrap">
            {fetching ? '抓取中…' : '抓取信息'}</button>
        </div>
      </div>

      <div className={FMT}>
        <label className="text-xs font-medium text-stone-500 dark:text-stone-400">标题 *</label>
        <input value={form.title} onChange={e => set('title', e.target.value)} className={inputCls} placeholder="页面标题" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className={FMT}>
          <label className="text-xs font-medium text-stone-500 dark:text-stone-400">分类</label>
          <select value={form.category_id} onChange={e => set('category_id', e.target.value)} className={inputCls}>
            <option value="">（未分类）</option>
            {flatCats.map(c => <option key={c.id} value={c.id}>{'　'.repeat(c.depth)}{c.name}</option>)}
          </select>
        </div>
        <div className={FMT}>
          <label className="text-xs font-medium text-stone-500 dark:text-stone-400">状态</label>
          <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div className={FMT}>
        <label className="text-xs font-medium text-stone-500 dark:text-stone-400">标签（逗号分隔，输入即建）</label>
        <input value={tagInput} onChange={e => setTagInput(e.target.value)}
          className={inputCls} placeholder="如：go, 文档, 待细读" />
        {tags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap pt-1">
            {tags.slice(0, 16).map(t => {
              const active = tagInput.split(/[,，]/).map(s => s.trim()).includes(t.name)
              return (
                <button key={t.id} type="button"
                  onClick={() => {
                    const cur = tagInput.split(/[,，]/).map(s => s.trim()).filter(Boolean)
                    const next = active ? cur.filter(n => n !== t.name) : [...cur, t.name]
                    setTagInput(next.join(', '))
                  }}
                  className={'px-2 py-0.5 rounded-md text-[11px] transition-colors ' +
                    (active ? 'bg-orange-500/15 text-orange-700 dark:text-orange-400'
                      : 'bg-black/[0.04] dark:bg-white/[0.06] text-stone-500 dark:text-stone-400 hover:bg-black/10 dark:hover:bg-white/[0.12]')}>
                  {t.name}</button>
              )
            })}
          </div>
        )}
      </div>

      <div className={FMT}>
        <label className="text-xs font-medium text-stone-500 dark:text-stone-400">摘要（页面描述）</label>
        <textarea value={form.description} onChange={e => set('description', e.target.value)}
          rows={2} className={inputCls + ' resize-y'} />
      </div>

      <div className={FMT}>
        <label className="text-xs font-medium text-stone-500 dark:text-stone-400">笔记（为什么收藏 / 读后感）</label>
        <textarea value={form.note} onChange={e => set('note', e.target.value)}
          rows={3} className={inputCls + ' resize-y'} />
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input type="checkbox" checked={form.starred} onChange={e => set('starred', e.target.checked)}
          className="w-4 h-4 accent-orange-500" />
        星标 <span className="text-amber-500">★</span>
      </label>

      <div className="flex items-center justify-end gap-2 pt-2">
        <button type="button" onClick={onBack}
          className="px-4 py-2 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">取消</button>
        <button type="button" onClick={submit} disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors disabled:opacity-50">
          {busy ? '保存中…' : editing ? '保存' : '收录'}</button>
      </div>
    </div>
  )
}
