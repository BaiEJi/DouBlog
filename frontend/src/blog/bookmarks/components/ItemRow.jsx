/**
 * 书签行卡片：favicon / 标题（点击打开原文）/ 域名 / 摘要 / 标签 / 状态徽章 /
 * 链路状态点 / 行内操作。列表、队列、回收站共用（mode 差异只换操作组）。
 */
import { useState } from 'react'
import { Icon } from '@/shared/ui/kit'
import { statusMeta, linkMeta } from '../api'

/** favicon：字母块常驻底层（bg-orange-500/10 兜底，永不空白），img 成功加载则覆盖其上；
 * img 自身不带背景（请求慢/失败期间底层字母透出，不出现空白框）；
 * 加载失败 / naturalWidth=0（透明或空图）时移除 img 露出字母块 */
export function Favicon({ item, size = 20 }) {
  const [err, setErr] = useState(false)
  const src = item.favicon_url || `https://${item.domain}/favicon.ico`
  return (
    <span className="relative shrink-0 rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400 "
      style={{ width: size, height: size }}>
      <span className="absolute inset-0 flex items-center justify-center font-semibold"
        style={{ fontSize: size * 0.5 }}>
        {(item.domain || '?')[0].toUpperCase()}
      </span>
      {src && !err && (
        <img src={src} alt="" loading="lazy"
          className="absolute inset-0 w-full h-full object-contain rounded-md"
          onError={() => setErr(true)}
          onLoad={e => { if (e.currentTarget.naturalWidth === 0) setErr(true) }} />
      )}
    </span>
  )
}

function TagChip({ tag }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-black/[0.04] dark:bg-white/[0.06] text-stone-500 dark:text-stone-400">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: tag.color }} />
      {tag.name}
    </span>
  )
}

/**
 * mode: 'list'（详情/编辑/快照/星标/删除）| 'queue'（打开/开始阅读/已读）| 'trash'（还原/彻底删除）
 */
export default function ItemRow({ item, mode = 'list', selected, onToggleSelect, onOpen, onAction, busy }) {
  const st = statusMeta(item.status)
  const lk = linkMeta(item.link_status)
  return (
    <div className={'group flex gap-3 p-3.5 rounded-xl border transition-colors ' +
      (selected
        ? 'border-orange-400/60 dark:border-orange-400/40 bg-orange-500/[0.04]'
        : 'border-black/[0.06] dark:border-white/[0.06] bg-white dark:bg-white/[0.025] hover:border-black/[0.14] dark:hover:border-white/[0.16]')}>
      {mode === 'list' && (
        <input type="checkbox" checked={!!selected} onChange={onToggleSelect}
          className="mt-1 w-4 h-4 accent-orange-500 shrink-0 cursor-pointer dark:[color-scheme:dark]" aria-label="选择" />
      )}
      <Favicon item={item} size={22} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <button type="button" onClick={() => onOpen(item)}
            className="text-left text-sm font-medium leading-5 text-stone-900 dark:text-stone-100 hover:text-orange-600 dark:hover:text-orange-400 transition-colors truncate">
            {item.title}
          </button>
          {item.starred && (
            <span className="text-amber-500 text-[11px] shrink-0 mt-1 px-1 rounded bg-amber-500/10" title="星标">★</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <a href={item.url} target="_blank" rel="noreferrer"
            className="text-[11.5px] text-stone-400 dark:text-stone-500 hover:text-orange-500 dark:hover:text-orange-400 font-mono truncate max-w-[280px]"
            onClick={e => e.stopPropagation()}>{item.domain}</a>
          <span className={'px-1.5 py-0.5 rounded text-[11px] font-medium ' + st.cls}>{st.label}</span>
          {item.link_status !== 'unknown' && (
            <span className={'inline-flex items-center gap-1 text-[11px] ' + lk.cls} title={lk.label + (item.link_code ? ` (HTTP ${item.link_code})` : '')}>
              <span className={'w-1.5 h-1.5 rounded-full ' + lk.dot} />{lk.label}
            </span>
          )}
          {item.snapshot_at && (
            <span className="inline-flex items-center gap-1 text-[11px] text-stone-400 dark:text-stone-500" title="已存离线快照">
              {Icon.clock}快照 {item.snapshot_words ? `${item.snapshot_words}字` : ''}
            </span>
          )}
          {item.description && (
            <span className="text-[11.5px] text-stone-400 dark:text-stone-500 truncate max-w-[420px]">{item.description}</span>
          )}
        </div>
        {item.tags?.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            {item.tags.map(t => <TagChip key={t.id} tag={t} />)}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
        {mode === 'list' && (
          <>
            <button type="button" title={item.starred ? '取消星标' : '星标'}
              onClick={() => onAction('star', item)}
              className={'w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-colors ' +
                (item.starred ? 'text-amber-500 bg-amber-500/10' : 'text-stone-400 hover:bg-black/5 dark:hover:bg-white/10')}>
              ★</button>
            <button type="button" title="详情" onClick={() => onAction('detail', item)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">{Icon.review}</button>
            <button type="button" title="编辑" onClick={() => onAction('edit', item)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">{Icon.edit}</button>
            <button type="button" title={item.status === 'read' ? '标为未读' : '标为已读'}
              onClick={() => onAction(item.status === 'read' ? 'unread' : 'read', item)}
              className={'w-7 h-7 rounded-lg flex items-center justify-center transition-colors ' +
                (item.status === 'read' ? 'text-stone-400 hover:bg-black/5 dark:hover:bg-white/10' : 'text-emerald-500 hover:bg-emerald-500/10')}>
              {Icon.checkCircle}</button>
            <button type="button" title="移入回收站" onClick={() => onAction('delete', item)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-stone-400 hover:bg-red-500/10 hover:text-red-500 transition-colors">{Icon.trash}</button>
          </>
        )}
        {mode === 'queue' && (
          <>
            <button type="button" disabled={busy} onClick={() => onAction('reading', item)}
              className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-xs font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors disabled:opacity-50">
              开始阅读</button>
            <a href={item.url} target="_blank" rel="noreferrer"
              className="inline-flex items-center px-2.5 h-7 rounded-lg text-xs bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">打开</a>
            <button type="button" disabled={busy} onClick={() => onAction('read', item)}
              className="inline-flex items-center px-2.5 h-7 rounded-lg text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors disabled:opacity-50">
              已读完</button>
          </>
        )}
        {mode === 'trash' && (
          <>
            <button type="button" disabled={busy} onClick={() => onAction('restore', item)}
              className="inline-flex items-center px-2.5 h-7 rounded-lg text-xs bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50">还原</button>
            <button type="button" disabled={busy} onClick={() => onAction('purge', item)}
              className="inline-flex items-center px-2.5 h-7 rounded-lg text-xs text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-50">彻底删除</button>
          </>
        )}
      </div>
    </div>
  )
}
