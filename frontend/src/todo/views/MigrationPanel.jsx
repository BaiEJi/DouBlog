/**
 * 待迁移列表（可复用）：今日页弹窗与待办池「迁移池」Tab 共用。
 * 交互照搬 MyTodo MigrationDrawer.tsx：单条迁移到今天（干预阈值弹三选）/
 * 改期 / 搁置 / 删除；顶部一键迁移全部（不含需人工确认的）。
 */
import { useState } from 'react'

import { todoMigrateTask, todoMigrationsBulk, todoMigrationsDecide, todoUpdateTask } from '../api'
import { Dot, quadrantMeta, btn, inputCls, Empty, todayStr } from '../kit'

/** 改期行内展开：日期 + 确定 */
function RescheduleRow({ onConfirm, onCancel }) {
  const [date, setDate] = useState(todayStr())
  return (
    <div className="flex items-center gap-2 mt-2">
      <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls + ' h-8 flex-1 min-w-0'} />
      <button onClick={() => date && onConfirm(date)} className="inline-flex items-center px-2.5 h-8 rounded-lg text-xs shrink-0 bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">确定</button>
      <button onClick={onCancel} className="inline-flex items-center px-2.5 h-8 rounded-lg text-xs shrink-0 bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">取消</button>
    </div>
  )
}

export function MigrationList({ items, today, onChanged, toast }) {
  const [busyId, setBusyId] = useState(null)
  const [intervene, setIntervene] = useState(null)
  const [rescheduleId, setRescheduleId] = useState(null)

  const bulkIds = items.filter(t => !t.intervention_required).map(t => t.id)

  const doMigrate = async (task, toDate) => {
    setBusyId(task.id)
    try {
      await todoMigrateTask(task.id, { to_date: toDate, reason: 'manual' })
      toast(`已迁移「${task.title}」到 ${toDate}`)
      onChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : '迁移失败', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const migrateToToday = task => {
    if (task.intervention_required) {
      setIntervene(task)
      return
    }
    doMigrate(task, today)
  }

  const decideDelete = async task => {
    try {
      await todoMigrationsDecide({ task_id: task.id, decision: 'delete' })
      toast('该任务已删除')
      onChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'error')
    }
  }

  const sendToBacklog = async task => {
    try {
      await todoUpdateTask(task.id, { task_date: null, revision: task.revision })
      toast('该任务已降入待办池')
      onChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error')
    }
  }

  const shelve = async task => {
    try {
      await todoMigrationsDecide({ task_id: task.id, decision: 'keep' })
      toast(`已搁置「${task.title}」，可在待办池 · 搁置计划 查看`)
      onChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : '搁置失败', 'error')
    }
  }

  const bulkMigrate = async () => {
    if (bulkIds.length === 0) return
    try {
      const res = await todoMigrationsBulk({ task_ids: bulkIds, to_date: today, reason: 'bulk' })
      toast(`已迁移 ${res?.migrated ?? 0} 个任务到今天`)
      onChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : '批量迁移失败', 'error')
    }
  }

  return (
    <>
      <button onClick={bulkMigrate} disabled={bulkIds.length === 0} className={btn.primary + ' w-full mb-3'}>
        一键迁移全部（{bulkIds.length}）
      </button>
      {items.length === 0 ? (
        <Empty text="没有待迁移的任务 🎉" />
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map(task => (
            <div key={task.id}
              className="rounded-xl border border-black/[0.07] dark:border-white/[0.08] bg-white dark:bg-white/[0.025] px-3.5 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Dot color={quadrantMeta(task.quadrant).color} />
                <span className="text-sm font-medium flex-1 min-w-0 truncate">{task.title}</span>
                {task.intervention_required && (
                  <span className="rounded-md px-1.5 h-5 text-[10.5px] inline-flex items-center bg-red-500/10 text-red-600 dark:text-red-400">需人工确认</span>
                )}
              </div>
              <div className="mt-1.5">
                <span className="inline-flex items-center rounded-md px-2 h-5 text-[10.5px] bg-orange-500/10 text-orange-700 dark:text-orange-300 tabular-nums">
                  ⟲ 来自 {task.last_migrated_from || task.original_date || '?'}
                  {task.days_procrastinated != null ? ` · 拖延 ${task.days_procrastinated} 天` : ''} · 迁移×{task.migrated_count}
                </span>
              </div>
              {rescheduleId === task.id ? (
                <RescheduleRow
                  onConfirm={date => { setRescheduleId(null); doMigrate(task, date) }}
                  onCancel={() => setRescheduleId(null)} />
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
                  <button disabled={busyId === task.id} onClick={() => migrateToToday(task)} className={btn.miniPrimary}>
                    {busyId === task.id ? '迁移中…' : '迁移到今天'}
                  </button>
                  <button onClick={() => setRescheduleId(task.id)} className={btn.mini}>改期</button>
                  <button onClick={() => shelve(task)} className={btn.mini}>搁置</button>
                  <button onClick={() => decideDelete(task)} className={btn.miniDanger}>删除</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 干预弹窗：迁移次数较多时的三选 */}
      {intervene && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setIntervene(null)}>
          <div className="w-full max-w-sm p-5 rounded-2xl bg-white dark:bg-[#1c1b1a] shadow-xl"
            onClick={e => e.stopPropagation()}>
            <div className="text-base font-semibold mb-2">该任务迁移次数较多</div>
            <p className="text-sm leading-relaxed text-stone-500 dark:text-stone-400">
              该任务已迁移 {intervene.migrated_count} 次（最初属于 {intervene.original_date || '未知日期'}），确定还要继续吗？
            </p>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => { sendToBacklog(intervene); setIntervene(null) }} className={btn.plain}>降入待办池</button>
              <button onClick={() => { decideDelete(intervene); setIntervene(null) }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors">删除它</button>
              <button onClick={() => { const t = intervene; setIntervene(null); doMigrate(t, today) }} className={btn.primary}>继续迁移</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** 今日页的「待迁移」居中弹窗 */
export default function MigrationModal({ open, items, today, onClose, onChanged, toast }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-xl my-8 rounded-2xl bg-white dark:bg-[#1c1b1a] shadow-xl animate-dropdown"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 h-14 border-b border-black/[0.05] dark:border-white/[0.07]">
          <div className="text-base font-semibold">待迁移任务</div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="px-5 py-4">
          <MigrationList items={items} today={today} onChanged={onChanged} toast={toast} />
        </div>
      </div>
    </div>
  )
}
