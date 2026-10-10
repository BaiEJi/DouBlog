/**
 * 今日/特定日期四象限看板（照搬 MyTodo TodayPage 交互）：
 * 20s 静默自动刷新 + 指纹去抖（不打断拖拽/勾选）、快速新增、
 * 完成（可填备注）/重开、改期、待迁移弹窗。
 * URL：?v=today（固定今日）或 ?v=today&view=day&date=YYYY-MM-DD（特定日期）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  todoDay, todoDeleteTask, todoCompleteTask, todoReopenTask, todoMoveTask, todoReorderTask, todoUpdateTask,
} from '../api'
import QuadrantBoard from './QuadrantBoard'
import TaskFormModal from './TaskFormModal'
import MigrationModal from './MigrationPanel'
import {
  Icon, Modal, Segmented, Spinner, btn, inputCls,
  fmtDate, parseDate, todayStr, isValidDateStr, useTodoCategories,
} from '../kit'

/** 数据指纹：内容没变就不 setState，后台静默刷新不会打断拖拽/勾选等交互 */
function todayFingerprint(d) {
  return JSON.stringify([
    d.quadrants.map(q => q.tasks.map(t => [t.id, t.status, t.revision, t.position])),
    d.pending_migrations.map(m => [m.id, m.status, m.revision]),
  ])
}

/** 自动刷新间隔（毫秒）：其他页面/外部新建或完成后，今日页随之同步 */
const AUTO_REFRESH_MS = 20_000

const textAreaCls = 'w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors resize-y'

export default function TodayView({ toast, dark }) {
  const [sp, setSp] = useSearchParams()
  const [viewMode, setViewMode] = useState(() => (sp.get('view') === 'day' ? 'date' : 'today'))
  const [date, setDate] = useState(() => {
    const p = sp.get('date')
    return p && isValidDateStr(p) ? parseDate(p) : new Date()
  })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [presetQuadrant, setPresetQuadrant] = useState(2)
  const [focusedId, setFocusedId] = useState(null)
  const [rescheduleTask, setRescheduleTask] = useState(null)
  const [rescheduleDate, setRescheduleDate] = useState(todayStr())
  // 完成备注弹窗：待办 → 完成时弹出（可留空）；已完成 → 重开，不弹
  const [completing, setCompleting] = useState(null)
  const [completeNote, setCompleteNote] = useState('')
  const { categories } = useTodoCategories()

  const today = todayStr()
  const dateStr = viewMode === 'today' ? today : fmtDate(date)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const result = await todoDay(dateStr)
      setData(prev => (prev && todayFingerprint(prev) === todayFingerprint(result) ? prev : result))
    } catch (err) {
      if (!silent) toast(err instanceof Error ? err.message : '加载今日数据失败', 'error')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [dateStr, toast])

  useEffect(() => { load() }, [load])

  // 自动同步：页面可见时定时静默刷新；窗口重新聚焦/切回时立即刷新
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(true)
    }, AUTO_REFRESH_MS)
    const onFocus = () => {
      if (document.visibilityState === 'visible') load(true)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [load])

  // 响应 URL 参数变化（日历页跳转： ?v=today&view=day&date=X）
  useEffect(() => {
    const wantDate = sp.get('view') === 'day'
    const p = sp.get('date')
    if (wantDate && p && isValidDateStr(p) && p !== fmtDate(date)) {
      setDate(parseDate(p))
      setFocusedId(null)
    }
    setViewMode(wantDate ? 'date' : 'today')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp])

  const switchView = v => {
    setViewMode(v)
    setFocusedId(null)
    if (v === 'today') {
      setDate(new Date())
      setSp({ v: 'today' }, { replace: true })
    } else {
      setSp({ v: 'today', view: 'day', date: fmtDate(date) }, { replace: true })
    }
  }

  const toggleTask = useCallback(async (task, note) => {
    try {
      if (task.status === 'done') await todoReopenTask(task.id)
      else await todoCompleteTask(task.id, note ? { note } : {})
      await load(true)
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error')
    }
  }, [load, toast])

  const moveQuadrant = useCallback(async (task, quadrant) => {
    const q = Number(quadrant)
    try {
      await todoMoveTask(task.id, {
        is_important: q === 1 || q === 2,
        is_urgent: q === 1 || q === 3,
      })
      await load(true)
    } catch (err) {
      toast(err instanceof Error ? err.message : '移动失败', 'error')
    }
  }, [load, toast])

  const deleteTask = useCallback(async task => {
    try {
      await todoDeleteTask(task.id)
      toast('任务已删除')
      await load(true)
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'error')
    }
  }, [load, toast])

  const openQuickAdd = quadrant => {
    setEditingTask(null)
    setPresetQuadrant(quadrant)
    setFormOpen(true)
  }

  // 稳定的 handler 引用：配合 TaskCard 的 memo，避免弹窗/抽屉等无关状态变化触发全部任务卡重渲染
  const cardHandlers = useMemo(
    () => ({
      onToggle: task => {
        if (task.status === 'done') toggleTask(task)
        else {
          setCompleteNote('')
          setCompleting(task)
        }
      },
      onEdit: task => {
        setEditingTask(task)
        setFormOpen(true)
      },
      onDelete: task => deleteTask(task),
      onMoveQuadrant: (task, quadrant) => moveQuadrant(task, quadrant),
      onReschedule: task => {
        setRescheduleDate(task.task_date || todayStr())
        setRescheduleTask(task)
      },
    }),
    [toggleTask, deleteTask, moveQuadrant],
  )

  const confirmReschedule = async () => {
    if (!rescheduleTask) return
    try {
      await todoUpdateTask(rescheduleTask.id, { task_date: rescheduleDate, revision: rescheduleTask.revision })
      toast(`已改期到 ${rescheduleDate}`)
      setRescheduleTask(null)
      await load(true)
    } catch (err) {
      toast(err instanceof Error ? err.message : '改期失败', 'error')
    }
  }

  const pendingCount = data?.pending_migrations?.length || 0

  return (
    <div>
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Segmented value={viewMode} onChange={switchView}
          options={[{ label: '今日', value: 'today' }, { label: '特定日期', value: 'date' }]} />
        {viewMode === 'date' && (
          <input type="date" value={fmtDate(date)}
            onChange={e => {
              if (e.target.value) {
                setDate(parseDate(e.target.value))
                setFocusedId(null)
                setSp({ v: 'today', view: 'day', date: e.target.value }, { replace: true })
              }
            }}
            className={inputCls + ' w-auto'} />
        )}
        <button onClick={() => openQuickAdd(2)} className={btn.primary}>
          {Icon.plus}新增任务
        </button>
        <button onClick={() => setDrawerOpen(true)} className={btn.plain + ' relative'}>
          {Icon.migrate}待迁移
          {pendingCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] flex items-center justify-center tabular-nums">
              {pendingCount}
            </span>
          )}
        </button>
        {data && (
          <span className="ml-auto text-xs text-stone-400 dark:text-stone-500 tabular-nums whitespace-nowrap">
            昨日新建 {data.yesterday.created} · 昨日完成 {data.yesterday.completed} · 连续活跃 {data.streak.current} 天
          </span>
        )}
      </div>

      {/* 看板 */}
      {loading && !data ? (
        <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]">
          <Spinner />
        </div>
      ) : data ? (
        <QuadrantBoard
          data={data}
          focusedId={focusedId}
          cardHandlers={cardHandlers}
          onAddFirst={openQuickAdd}
          onRefresh={() => load(true)}
          onMove={(id, payload) => todoMoveTask(id, payload)}
          onReorder={(id, payload) => todoReorderTask(id, payload)}
          toast={toast}
          dark={dark}
        />
      ) : null}

      <TaskFormModal
        open={formOpen}
        categories={categories}
        initialTask={editingTask}
        initialQuadrant={presetQuadrant}
        defaultDate={dateStr}
        onClose={() => setFormOpen(false)}
        onSuccess={() => load(true)}
        toast={toast}
      />

      <MigrationModal
        open={drawerOpen}
        items={data?.pending_migrations ?? []}
        today={today}
        onClose={() => setDrawerOpen(false)}
        onChanged={() => load(true)}
        toast={toast}
      />

      {/* 改期 */}
      <Modal open={rescheduleTask != null} title="改期" onClose={() => setRescheduleTask(null)}
        footer={<>
          <button onClick={() => setRescheduleTask(null)} className={btn.plain}>取消</button>
          <button onClick={confirmReschedule} className={btn.primary}>确定</button>
        </>}>
        <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} className={inputCls} />
      </Modal>

      {/* 完成备注 */}
      <Modal open={completing != null} title={completing ? `完成「${completing.title}」` : '完成任务'}
        onClose={() => setCompleting(null)}
        footer={<>
          <button onClick={() => setCompleting(null)} className={btn.plain}>取消</button>
          <button onClick={() => {
            const task = completing
            const note = completeNote.trim() || undefined
            setCompleting(null)
            if (task) toggleTask(task, note)
          }} className={btn.primary}>完成</button>
        </>}>
        <textarea rows={3} autoFocus maxLength={500} value={completeNote}
          onChange={e => setCompleteNote(e.target.value)}
          placeholder="完成备注（可选）：产出、耗时、遗留事项…" className={textAreaCls} />
      </Modal>
    </div>
  )
}
