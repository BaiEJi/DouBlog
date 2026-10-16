/**
 * 书签详情覆盖层：元信息卡 + 笔记 + 离线快照（Markdown 渲染，复用 shared/md.js 管线）
 * + 操作（打开原文 / 编辑 / 已读切换 / 星标 / 抓取快照 / 删除快照 / 检测链接 / 移入回收站）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import md from '@/shared/md'

import { getItem, updateItem, deleteItem, createSnapshot, deleteSnapshot, checkLinks } from '../api'
import { statusMeta, linkMeta } from '../api'
import { Icon, Spinner, inputCls } from '../../todo/kit'
import { Favicon } from './ItemRow'

function fmt(iso) {
  if (!iso) return '—'
  return iso.slice(0, 10) + ' ' + iso.slice(11, 16)
}

export default function ItemDetail({ id, categories, onBack, onEdit, onChanged, onDeleted, toast }) {
  const [item, setItem] = useState(null)
  const [busy, setBusy] = useState(false)
  const [snapBusy, setSnapBusy] = useState(false)

  const reload = useCallback(() => {
    getItem(id).then(setItem).catch(e => { toast(e.message, 'err'); onBack() })
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { reload() }, [reload])

  const catName = useMemo(() => {
    if (!item) return '未分类'
    const walk = (nodes) => {
      for (const c of nodes || []) {
        if (c.id === item.category_id) return c.name
        const hit = walk(c.children)
        if (hit) return hit
      }
      return null
    }
    return walk(categories) || '未分类'
  }, [item, categories])

  const snapshotHtml = useMemo(
    () => (item?.snapshot_md ? md.render(item.snapshot_md) : ''),
    [item?.snapshot_md])

  const act = async (fn, okMsg) => {
    setBusy(true)
    try { await fn(); if (okMsg) toast(okMsg); reload(); onChanged() }
    catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  if (!item) return <Spinner />

  const st = statusMeta(item.status)
  const lk = linkMeta(item.link_status)

  return (
    <div className="space-y-4">
      {/* ── 头部 ── */}
      <div className="flex items-start gap-3">
        <button type="button" onClick={onBack}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0">{Icon.back}</button>
        <Favicon item={item} size={28} />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-6 break-words">{item.title}</h2>
          <a href={item.url} target="_blank" rel="noreferrer"
            className="text-xs font-mono text-orange-600 dark:text-orange-400 hover:underline break-all">{item.url}</a>
        </div>
      </div>

      {/* ── 元信息与操作 ── */}
      <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5">
        <div className="flex items-center gap-2 flex-wrap text-xs text-stone-500 dark:text-stone-400">
          <span className={'px-1.5 py-0.5 rounded text-[11px] font-medium ' + st.cls}>{st.label}</span>
          {item.starred && <span className="text-amber-500">★ 已星标</span>}
          <span>{catName}</span>
          <span className={'inline-flex items-center gap-1 ' + lk.cls}>
            <span className={'w-1.5 h-1.5 rounded-full ' + lk.dot} />{lk.label}{item.link_code ? ` · HTTP ${item.link_code}` : ''}
          </span>
          <span>收录于 {fmt(item.created_at)}</span>
          {item.read_at && <span>读完于 {fmt(item.read_at)}</span>}
          {item.last_checked_at && <span>检测于 {fmt(item.last_checked_at)}</span>}
        </div>
        {item.tags?.length > 0 && (
          <div className="mt-2 flex gap-1.5 flex-wrap">
            {item.tags.map(t => (
              <span key={t.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-black/[0.04] dark:bg-white/[0.06] text-stone-500 dark:text-stone-400">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />{t.name}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <a href={item.url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors">打开原文</a>
          <button type="button" onClick={onEdit}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">{Icon.edit}编辑</button>
          <button type="button" disabled={busy}
            onClick={() => act(() => updateItem(id, { status: item.status === 'read' ? 'unread' : 'read' }), item.status === 'read' ? '已标为未读' : '已标为已读')}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50">
            {Icon.checkCircle}{item.status === 'read' ? '标为未读' : '标为已读'}</button>
          <button type="button" disabled={busy}
            onClick={() => act(() => updateItem(id, { starred: !item.starred }), item.starred ? '已取消星标' : '已加星标')}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50">
            <span className={item.starred ? 'text-amber-500' : ''}>★</span>{item.starred ? '取消星标' : '星标'}</button>
          <button type="button" disabled={busy}
            onClick={() => act(() => checkLinks([id]), '检测完成')}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50">
            {Icon.refresh}检测链接</button>
          <span className="flex-1" />
          <button type="button" disabled={busy}
            onClick={() => { if (window.confirm('移入回收站？')) act(() => deleteItem(id), '已移入回收站').then(() => onDeleted()) }}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-sm text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-50">
            {Icon.trash}移入回收站</button>
        </div>
      </div>

      {/* ── 摘要 / 笔记 ── */}
      {(item.description || item.note) && (
        <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5 space-y-3">
          {item.description && (
            <div>
              <div className="text-xs font-medium text-stone-400 dark:text-stone-500 mb-1">摘要</div>
              <p className="text-sm leading-6 text-stone-600 dark:text-stone-300">{item.description}</p>
            </div>
          )}
          {item.note && (
            <div>
              <div className="text-xs font-medium text-stone-400 dark:text-stone-500 mb-1">笔记</div>
              <p className="text-sm leading-6 text-stone-600 dark:text-stone-300 whitespace-pre-wrap">{item.note}</p>
            </div>
          )}
        </div>
      )}

      {/* ── 离线快照 ── */}
      <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5">
        <div className="flex items-center gap-3 mb-3">
          <h3 className="text-sm font-semibold">离线快照</h3>
          {item.snapshot_at && (
            <span className="text-[11.5px] text-stone-400 dark:text-stone-500">
              {fmt(item.snapshot_at)} · {item.snapshot_words} 字
            </span>
          )}
          <span className="flex-1" />
          <button type="button" disabled={snapBusy}
            onClick={async () => {
              setSnapBusy(true)
              try {
                await createSnapshot(id)
                toast('快照已保存'); reload(); onChanged()
              } catch (e) { toast(e.message, 'err') } finally { setSnapBusy(false) }
            }}
            className="inline-flex items-center gap-1 px-3 h-8 rounded-lg text-xs font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors disabled:opacity-50">
            {snapBusy ? '抓取中…（最长 30 秒）' : item.snapshot_at ? '重新抓取' : '抓取正文'}</button>
          {item.snapshot_at && (
            <button type="button" disabled={snapBusy}
              onClick={async () => {
                setSnapBusy(true)
                try { await deleteSnapshot(id); toast('快照已删除'); reload(); onChanged() }
                catch (e) { toast(e.message, 'err') } finally { setSnapBusy(false) }
              }}
              className="inline-flex items-center gap-1 px-3 h-8 rounded-lg text-xs text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-50">删除快照</button>
          )}
        </div>
        {item.snapshot_md ? (
          <div className="prose-content max-w-none"
            dangerouslySetInnerHTML={{ __html: snapshotHtml }} />
        ) : (
          <p className="text-xs text-stone-400 dark:text-stone-500 py-4 text-center">
            还没有快照——抓取正文后可离线阅读，不怕原文删帖
          </p>
        )}
      </div>
    </div>
  )
}
