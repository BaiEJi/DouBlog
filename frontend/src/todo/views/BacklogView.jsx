/**
 * 待办池（照搬 MyTodo BacklogPage 交互）：
 * 收件箱（inbox=true 未排期任务，排期/编辑/删除）+ 迁移池（复用 MigrationList）
 * + 搁置计划（迁移到今天/恢复催办/删除）。
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  todoTasks, todoDeleteTask, todoUpdateTask, todoMigrateTask,
  todoMigrationsDecide, todoMigrationsPending, todoMigrationsShelved,
} from '../api'
import TaskFormModal from './TaskFormModal'
import { MigrationList } from './MigrationPanel'
import {
  Icon, Confirm, Empty, Spinner, btn, inputCls,
  Dot, QuadrantBadge, CategoryBadge, mdhmOf, quadrantMeta, todayStr, useTodoCategories, useQuadrantText,
} from '../kit'

/** 搁置计划列表 */
function ShelvedList({ items, onChanged, toast }) {
  const [confirmTask, setConfirmTask] = useState(null)
  const today = todayStr()

  const act = async (task, decision) => {
    try {
      await todoMigrationsDecide({ task_id: task.id, decision })
      toast(decision === 'unshelve' ? '已恢复催办' : '任务已删除')
      onChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error')
    }
  }

  const migrateToToday = async task => {
    try {
      await todoMigrateTask(task.id, { to_date: today, reason: 'shelved-plan' })
      toast('已迁移到今天')
      onChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : '迁移失败', 'error')
    }
  }

  if (items.length === 0) return <Empty text="没有搁置的任务" />

  return (
    <div>
      <div className="mb-3 text-xs text-stone-500 dark:text-stone-400">
        被你有意搁置的逾期任务，不再催办；随时可以迁移回来或恢复催办
      </div>
      <div className="flex flex-col gap-2.5">
        {items.map(t => (
          <div key={t.id}
            className="rounded-xl border border-black/[0.07] dark:border-white/[0.08] bg-white dark:bg-white/[0.025] px-3.5 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Dot color={quadrantMeta(t.quadrant).color} />
              <span className="text-sm font-medium flex-1 min-w-0 truncate">{t.title}</span>
              {t.shelved_at && <span className="text-[11px] text-stone-400 tabular-nums">搁置于 {mdhmOf(t.shelved_at)}</span>}
            </div>
            <div className="mt-1.5">
              <span className="inline-flex items-center rounded-md px-2 h-5 text-[10.5px] bg-orange-500/10 text-orange-700 dark:text-orange-300 tabular-nums">
                ⟲ 来自 {t.original_date || '?'}
                {t.days_procrastinated != null ? ` · 拖延 ${t.days_procrastinated} 天` : ''} · 迁移×{t.migrated_count}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
              <button onClick={() => migrateToToday(t)} className={btn.miniPrimary}>迁移到今天</button>
              <button onClick={() => act(t, 'unshelve')} className={btn.mini}>恢复催办</button>
              <button onClick={() => setConfirmTask(t)} className={btn.miniDanger}>删除</button>
            </div>
          </div>
        ))}
      </div>
      {confirmTask && (
        <Confirm text="确认删除该任务？" danger
          onCancel={() => setConfirmTask(null)}
          onOk={() => { const t = confirmTask; setConfirmTask(null); act(t, 'delete') }} />
      )}
    </div>
  )
}

export default function BacklogView({ toast }) {
  const [sp] = useSearchParams()
  const tab = ['inbox', 'migrate', 'shelved'].includes(sp.get('bsub')) ? sp.get('bsub') : 'inbox'
  const [tasks, setTasks] = useState(null)
  const [migrations, setMigrations] = useState([])
  const [shelved, setShelved] = useState([])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [scheduleTask, setScheduleTask] = useState(null)
  const [scheduleDate, setScheduleDate] = useState(todayStr())
  const [confirmTask, setConfirmTask] = useState(null)
  const { categories } = useTodoCategories()
  const { labels } = useQuadrantText()

  const load = useCallback(async () => {
    try {
      setTasks(await todoTasks({ inbox: true }))
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载待办池失败', 'error')
    }
  }, [toast])

  // 迁移池/搁置计划计数与内容共用一份数据，供标签展示
  const loadMigrations = useCallback(() => {
    todoMigrationsPending().then(setMigrations).catch(() => {})
  }, [])
  const loadShelved = useCallback(() => {
    todoMigrationsShelved().then(setShelved).catch(() => {})
  }, [])

  useEffect(() => {
    load()
    loadMigrations()
    loadShelved()
  }, [load, loadMigrations, loadShelved])

  const removeTask = async task => {
    try {
      await todoDeleteTask(task.id)
      toast('任务已删除')
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'error')
    }
  }

  const submitSchedule = async () => {
    if (!scheduleTask || !scheduleDate) return
    try {
      await todoUpdateTask(scheduleTask.id, { task_date: scheduleDate, revision: scheduleTask.revision })
      toast(`已排期到 ${scheduleDate}`)
      setScheduleTask(null)
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : '排期失败', 'error')
    }
  }

  const TABS = [
    { key: 'inbox', label: `待办池（${tasks?.length ?? 0}）` },
    { key: 'migrate', label: `迁移池（${migrations.length}）` },
    { key: 'shelved', label: `搁置计划（${shelved.length}）` },
  ]

  return (
    <div>
      {/* Tab 行 + 快速添加 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h2 className="text-sm font-medium">{TABS.find(t => t.key === tab)?.label}</h2>
        {tab === 'inbox' && (
          <button onClick={() => { setEditing(null); setFormOpen(true) }} className={btn.primary + ' ml-auto'}>
            {Icon.plus}快速添加
          </button>
        )}
      </div>

      {tab === 'inbox' && (
        <>
          <div className="mb-3 text-xs text-stone-500 dark:text-stone-400">未排期的任务收件箱，给它们安排一个日子</div>
          {!tasks ? (
            <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]"><Spinner /></div>
          ) : tasks.length === 0 ? (
            <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]">
              <Empty text="待办池是空的，点击右上角「快速添加」创建一个" />
            </div>
          ) : (
            <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] overflow-hidden">
              <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
                {tasks.map(t => (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-black/[0.015] dark:hover:bg-white/[0.02] transition-colors">
                    <Dot color={quadrantMeta(t.quadrant).color} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{t.title}</div>
                      <div className="text-[11px] text-stone-400 tabular-nums">{mdhmOf(t.created_at)}</div>
                    </div>
                    <span className="inline-flex"><QuadrantBadge quadrant={t.quadrant} label={labels(t.quadrant)} small /></span>
                    <span className="inline-flex"><CategoryBadge name={t.category_name} color={t.category_color} small /></span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => { setScheduleDate(todayStr()); setScheduleTask(t) }} className={btn.mini}>排期</button>
                      <button onClick={() => { setEditing(t); setFormOpen(true) }} className={btn.mini}>编辑</button>
                      <button onClick={() => setConfirmTask(t)} className={btn.miniDanger}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'migrate' && (
        <MigrationList items={migrations} today={todayStr()} onChanged={loadMigrations} toast={toast} />
      )}

      {tab === 'shelved' && (
        <ShelvedList items={shelved} onChanged={loadShelved} toast={toast} />
      )}

      <TaskFormModal
        open={formOpen}
        categories={categories}
        initialTask={editing}
        initialQuadrant={2}
        defaultDate={null}
        onClose={() => setFormOpen(false)}
        onSuccess={load}
        toast={toast}
      />

      {/* 排期弹窗 */}
      {scheduleTask && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setScheduleTask(null)}>
          <div className="w-full max-w-xs p-5 rounded-2xl bg-white dark:bg-[#1c1b1a] shadow-xl animate-dropdown"
            onClick={e => e.stopPropagation()}>
            <div className="text-base font-semibold mb-1">排期</div>
            <div className="text-xs text-stone-400 mb-3 truncate">「{scheduleTask.title}」</div>
            <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className={inputCls} />
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setScheduleTask(null)} className={btn.plain}>取消</button>
              <button onClick={submitSchedule} className={btn.primary}>确定</button>
            </div>
          </div>
        </div>
      )}

      {confirmTask && (
        <Confirm text="确认删除该任务？" danger
          onCancel={() => setConfirmTask(null)}
          onOk={() => { const t = confirmTask; setConfirmTask(null); removeTask(t) }} />
      )}
    </div>
  )
}
