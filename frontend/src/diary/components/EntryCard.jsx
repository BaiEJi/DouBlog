/**
 * 时间线条目卡：日期头 + 日记本徽章/心情/天气/位置元信息 + Markdown 正文 + 操作行。
 * 点正文进入编辑；置顶卡带 rose 左边条；有总结时随记缩进并带连接线挂在总结之后。
 */
import { useMemo, useState } from 'react'
import md from '@/shared/md'
import { Icon, moodOf, weatherIcon, Confirm } from '../kit'

export default function EntryCard({ entry, onEdit, onAction, onDelete, onShare, journal, attached }) {
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const mood = moodOf(entry.mood)
  const html = useMemo(() => {
    const props = { __html: md.render(entry.content || '') }
    return props
  }, [entry.content])
  const d = new Date(entry.entry_date + 'T00:00:00')
  const dateStr = entry.entry_date.slice(5)

  const jname = journal ? `${journal.emoji || ''} ${journal.name}`.trim() : ''

  return (
    <article className={'group relative rounded-2xl border bg-white dark:bg-white/[0.025] transition-all ' + (attached ? 'ml-4 ' : '') +
      (entry.pinned
        ? 'border-rose-500/30 shadow-[0_2px_12px_rgba(244,63,94,0.06)]'
        : 'border-black/[0.07] dark:border-white/[0.07] hover:border-black/[0.12] dark:hover:border-white/[0.14]')}>
      {entry.pinned && <span className="absolute left-0 top-4 bottom-4 w-[3px] rounded-full bg-rose-400/70" />}
      {attached && <span className="absolute -left-4 top-6 bottom-6 w-px bg-rose-500/50" aria-hidden />}
      <div className="p-4 sm:p-5">
        {/* 元信息行 */}
        <div className="flex flex-wrap items-center gap-2 mb-2.5 text-[11.5px] text-stone-400">
          <span className="font-medium text-stone-500 dark:text-stone-400 tabular-nums">{dateStr}</span>
          {jname && (
            <span className="px-1.5 py-px rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[11px]">{jname}</span>
          )}
          {mood && (
            <span className="inline-flex items-center gap-1" style={{ color: mood.color }}>
              {mood.emoji}<span className="opacity-80">{mood.label}</span>
            </span>
          )}
          {entry.weather && (
            <span className="inline-flex items-center gap-1" title={entry.weather.text || ''}>
              {weatherIcon(entry.weather.code)}{entry.weather.temp != null && `${Math.round(entry.weather.temp)}°C`}
            </span>
          )}
          {entry.location?.place && (
            <span className="inline-flex items-center gap-0.5">{Icon.location}{entry.location.place}</span>
          )}
          <span className="ml-auto">{entry.word_count || 0} 字</span>
          {entry.share && <span className="text-rose-500" title="已分享">●已分享</span>}
        </div>
        {/* 正文 */}
        <div onClick={() => onEdit(entry)} className="diary-prose prose-content text-sm text-stone-700 dark:text-stone-200 cursor-pointer"
          dangerouslySetInnerHTML={html} />
        {/* 操作行 */}
        <div className="flex items-center gap-1 mt-3 -mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <ActBtn onClick={() => onAction(entry.id, entry.pinned ? 'unpin' : 'pin')} title={entry.pinned ? '取消置顶' : '置顶'}
            active={entry.pinned}>{Icon.pin}</ActBtn>
          <ActBtn onClick={() => onEdit(entry)} title="编辑">{Icon.edit}</ActBtn>
          <ActBtn onClick={() => onShare(entry)} title="分享">{Icon.share}</ActBtn>
          <ActBtn onClick={() => onAction(entry.id, 'archive')} title="归档">{Icon.archive}</ActBtn>
          <ActBtn onClick={() => setConfirm(true)} title="移入回收站" danger>{Icon.trash}</ActBtn>
        </div>
      </div>
      {confirm && (
        <Confirm text="移入回收站？（回收站内可恢复或彻底删除）" danger
          onCancel={() => setConfirm(false)}
          onOk={() => { setConfirm(false); onDelete(entry.id) }} />
      )}
    </article>
  )
}

function ActBtn({ children, onClick, title, danger, active }) {
  return (
    <button onClick={onClick} title={title}
      className={'w-7 h-7 rounded-lg flex items-center justify-center transition-colors ' +
        (active ? 'text-rose-500 bg-rose-500/10'
          : danger ? 'text-stone-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10'
            : 'text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/10')}>
      {children}
    </button>
  )
}
