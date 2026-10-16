/**
 * 回收站：软删条目列表，支持单条还原 / 彻底删除 / 一键清空。
 */
import { useEffect, useRef, useState } from 'react'

import { listItems, restoreItem, purgeItem, batchItems } from '../api'
import { Spinner, Empty, Icon } from '../../todo/kit'
import ItemRow from './ItemRow'

export default function TrashView({ toast, refreshSignal, onChanged }) {
  const [list, setList] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [clearing, setClearing] = useState(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    listItems({ trash: true, sort: 'updated_desc', page_size: 100 })
      .then(res => { if (alive.current) setList(res) })
      .catch(() => { if (alive.current) setList({ items: [], total: 0 }) })
  }, [refreshSignal])

  const act = async (item, action) => {
    setBusyId(item.id)
    try {
      if (action === 'restore') { await restoreItem(item.id); toast('已还原') }
      else {
        if (!window.confirm(`彻底删除「${item.title}」？不可恢复`)) { setBusyId(null); return }
        await purgeItem(item.id); toast('已彻底删除')
      }
      onChanged()
    } catch (e) { toast(e.message, 'err') } finally { setBusyId(null) }
  }

  const clearAll = async () => {
    const items = list?.items || []
    if (!items.length) return
    if (!window.confirm(`清空回收站（${items.length} 条）？彻底删除不可恢复`)) return
    setClearing(true)
    try {
      let n = 0
      for (const it of items) { await purgeItem(it.id); n++ }
      toast(`已清空 ${n} 条`)
      onChanged()
    } catch (e) { toast(e.message, 'err') } finally { setClearing(false) }
  }

  const items = list?.items || []
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 px-1">
        <h3 className="text-sm font-semibold">已删除条目</h3>
        {list && <span className="text-xs text-stone-400 dark:text-stone-500 tabular-nums">{list.total} 条</span>}
        <span className="flex-1" />
        {items.length > 0 && (
          <button type="button" onClick={clearAll} disabled={clearing}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-50">
            {Icon.warning}{clearing ? '清空中…' : '清空回收站'}</button>
        )}
      </div>
      {!list ? <Spinner /> : items.length === 0 ? (
        <Empty text="回收站是空的" />
      ) : (
        <div className="space-y-2">
          {items.map(it => (
            <ItemRow key={it.id} item={it} mode="trash" busy={busyId === it.id}
              onOpen={() => {}}
              onAction={(action, item) => act(item, action)} />
          ))}
        </div>
      )}
    </div>
  )
}
