/**
 * 稍后阅读队列：置顶「下一篇」英雄卡（最早的未读）+ 队列列表（最早收录在前）。
 * 操作：开始阅读（打开原文并标记阅读中）/ 已读完。
 */
import { useEffect, useRef, useState } from 'react'

import { queueNext, listItems, updateItem } from '../api'
import { Spinner, Empty, Icon } from '../../../todo/kit'
import ItemRow, { Favicon } from './ItemRow'

export default function QueueView({ toast, refreshSignal, onChanged, onOpenDetail }) {
  const [next, setNext] = useState(undefined)   // undefined=加载中 null=队列空
  const [list, setList] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const reload = () => {
    queueNext().then(d => { if (alive.current) setNext(d) })
      .catch(() => { if (alive.current) setNext(null) })
    listItems({ status: 'unread', sort: 'created_asc', page_size: 50 })
      .then(res => { if (alive.current) setList(res) })
      .catch(() => { if (alive.current) setList({ items: [], total: 0 }) })
  }
  useEffect(() => { reload() }, [refreshSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (item, status) => {
    setBusyId(item.id)
    try {
      await updateItem(item.id, { status })
      if (status === 'reading') window.open(item.url, '_blank', 'noreferrer')
      onChanged()
    } catch (e) { toast(e.message, 'err') } finally { setBusyId(null) }
  }

  const items = list?.items || []

  return (
    <div className="space-y-4">
      {/* ── 下一篇英雄卡 ── */}
      {next === undefined ? <Spinner /> : next == null ? (
        <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-10 text-center">
          <div className="text-2xl mb-2">🎉</div>
          <div className="text-sm font-medium">队列清空了</div>
          <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">没有待读文章——去收藏夹收录新的，或者休息一下</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-6">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
            <span className="text-[11.5px] font-medium text-orange-600 dark:text-orange-400 tracking-wide">下一篇待读</span>
          </div>
          <div className="flex items-start gap-4">
            <Favicon item={next} size={36} />
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold leading-7 break-words">{next.title}</h3>
              <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-stone-500 dark:text-stone-400">
                <span className="font-mono">{next.domain}</span>
                <span>· 收录于 {next.created_at?.slice(0, 10)}</span>
                {next.tags?.slice(0, 4).map(t => (
                  <span key={t.id} className="px-1.5 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06]">{t.name}</span>
                ))}
              </div>
              {next.description && (
                <p className="mt-2 text-[13px] leading-6 text-stone-500 dark:text-stone-400 line-clamp-2">{next.description}</p>
              )}
              <div className="mt-4 flex items-center gap-2">
                <button type="button" disabled={busyId === next.id} onClick={() => act(next, 'reading')}
                  className="inline-flex items-center gap-1.5 px-5 h-10 rounded-lg text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors disabled:opacity-50">
                  {Icon.today}开始阅读</button>
                <button type="button" disabled={busyId === next.id} onClick={() => act(next, 'read')}
                  className="inline-flex items-center gap-1.5 px-4 h-10 rounded-lg text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors disabled:opacity-50">
                  {Icon.checkCircle}跳过，已读过</button>
                <button type="button" onClick={() => onOpenDetail(next.id)}
                  className="inline-flex items-center gap-1.5 px-4 h-10 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">
                  查看详情</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 队列列表 ── */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <h3 className="text-sm font-semibold">队列（最早收录在前）</h3>
          {list && <span className="text-xs text-stone-400 dark:text-stone-500 tabular-nums">{list.total} 条待读</span>}
        </div>
        {!list ? <Spinner /> : items.length === 0 ? (
          <Empty text="队列为空" />
        ) : (
          <div className="space-y-2">
            {items.map(it => (
              <ItemRow key={it.id} item={it} mode="queue" busy={busyId === it.id}
                onOpen={item => onOpenDetail(item.id)}
                onAction={(action, item) => act(item, action)} />
            ))}
          </div>
        )}
        {list && list.total > 50 && (
          <p className="pt-2 text-center text-[11.5px] text-stone-400 dark:text-stone-500">仅显示最早的 50 条</p>
        )}
      </div>
    </div>
  )
}
