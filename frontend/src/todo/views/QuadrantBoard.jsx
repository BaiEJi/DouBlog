/**
 * 四象限看板（dnd-kit）：拖拽跨象限（move）/象限内排序（reorder，float 中点）。
 * 交互逻辑照搬 MyTodo QuadrantBoard.tsx（碰撞检测优先任务卡、稳定高亮、
 * 乐观更新 + 失败回滚刷新），样式换 DouBlog 档位。
 */
import { memo, useEffect, useRef, useState } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  pointerWithin, rectIntersection, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { QUADRANT_DISPLAY_ORDER, Dot, quadrantMeta, flagsForQuadrant, adjustForDark } from '../kit'

// ─── 任务卡 ─────────────────────────────────────────────────

function CardMenu({ task, onEdit, onReschedule, onMoveQuadrant, onDelete, onClose }) {
  const [confirmDel, setConfirmDel] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    // 点击菜单/触发按钮以外区域时收起（parent = 含 ⋯ 按钮的容器）
    const onDoc = e => {
      const scope = ref.current?.parentElement
      if (scope && !scope.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])
  const item = 'flex items-center gap-2 w-full px-3 h-8 text-left text-[13px] rounded-lg transition-colors '
  return (
    <div ref={ref} className="absolute right-0 top-8 z-30 w-40 p-1 rounded-xl border border-black/[0.08] dark:border-white/[0.1] bg-white dark:bg-[#262524] shadow-lg">
      <button className={item + 'text-stone-700 dark:text-stone-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'}
        onClick={() => { onClose(); onEdit(task) }}>编辑</button>
      <button className={item + 'text-stone-700 dark:text-stone-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'}
        onClick={() => { onClose(); onReschedule(task) }}>改期</button>
      <div className="my-1 h-px bg-black/[0.06] dark:bg-white/[0.08]" />
      <div className="px-3 py-1 text-[10.5px] text-stone-400">移动到</div>
      {QUADRANT_DISPLAY_ORDER.map(q => {
        const m = quadrantMeta(q)
        return (
          <button key={q} className={item + 'text-stone-700 dark:text-stone-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'}
            onClick={() => { onClose(); onMoveQuadrant(task, q) }}>
            <Dot color={m.color} /><span className="flex-1">{m.short} {m.label}</span>
          </button>
        )
      })}
      <div className="my-1 h-px bg-black/[0.06] dark:bg-white/[0.08]" />
      {confirmDel ? (
        <div className="px-2 py-1.5 flex items-center gap-1.5">
          <span className="text-[11.5px] text-red-600 dark:text-red-400 flex-1">确认删除？</span>
          <button className="px-2 h-6 rounded-md text-[11px] bg-red-500/10 text-red-600 dark:text-red-400"
            onClick={() => { onClose(); onDelete(task) }}>是</button>
          <button className="px-2 h-6 rounded-md text-[11px] text-stone-400 hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => setConfirmDel(false)}>否</button>
        </div>
      ) : (
        <button className={item + 'text-red-600 dark:text-red-400 hover:bg-red-500/10'}
          onClick={() => setConfirmDel(true)}>删除</button>
      )}
    </div>
  )
}

export const TaskCardContent = memo(function TaskCardContent({
  task, focused, onToggle, onEdit, onDelete, onMoveQuadrant, onReschedule, className = '', style, dark,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const done = task.status === 'done'
  const catColor = task.category_color
  // 类别背景色：标题色 + 低透明度，深浅色主题下均可读
  const tintStyle = catColor
    ? { background: (dark ? adjustForDark(catColor) : catColor) + '1f', borderColor: (dark ? adjustForDark(catColor) : catColor) + '45' }
    : {}

  return (
    <div className={'relative flex items-start gap-2 rounded-xl border px-2.5 py-2 transition-colors ' +
        (className) +
        (done ? ' opacity-60 ' : '') +
        (focused ? ' ring-2 ring-indigo-400/70 ' : '') +
        ' border-black/[0.07] dark:border-white/[0.08] bg-white dark:bg-white/[0.03]'}
      style={{ ...tintStyle, ...style }}>
      <button onClick={() => onToggle(task)} aria-label="完成/重开任务" title={done ? '重开任务' : '完成任务'}
        className={'mt-[1px] w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center shrink-0 transition-colors ' +
          (done
            ? 'bg-indigo-500 border-indigo-500 text-white'
            : 'border-black/25 dark:border-white/30 hover:border-indigo-400 dark:hover:border-indigo-400')}>
        {done && (
          <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.5l4 4 8-9" /></svg>
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={'text-sm leading-5 break-words ' + (done ? 'line-through text-stone-400' : '')}>{task.title}</span>
        </div>
        {task.description && (
          <div className="text-[11.5px] text-stone-400 dark:text-stone-500 mt-0.5 line-clamp-1">{task.description}</div>
        )}
        {done && task.completion_note && (
          <div className="text-[11.5px] text-stone-400 dark:text-stone-500 mt-0.5 line-clamp-1">📝 {task.completion_note}</div>
        )}
        {(task.migrated_count > 0 || task.category_name || task.plan_id) && (
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            {task.plan_id && (
              <span className="inline-flex items-center rounded-md px-1.5 h-4.5 text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">生活</span>
            )}
            {task.migrated_count > 0 && task.days_procrastinated != null && (
              <span title={`已迁移 ${task.migrated_count} 次，最初属于 ${task.original_date ?? '?'}`}
                className="inline-flex items-center rounded-md px-1.5 h-[18px] text-[10.5px] bg-orange-500/10 text-orange-700 dark:text-orange-300 tabular-nums">
                拖{task.days_procrastinated}天
              </span>
            )}
            {task.category_name && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-stone-500 dark:text-stone-400">
                <Dot color={task.category_color ?? '#94a3b8'} size={7} />{task.category_name}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="relative shrink-0">
        <button onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }} aria-label="任务操作"
          className={'w-6 h-6 rounded-lg flex items-center justify-center transition-colors ' +
            (menuOpen ? 'bg-black/[0.07] dark:bg-white/[0.12] text-stone-700 dark:text-stone-200' : 'text-stone-400 hover:bg-black/[0.05] dark:hover:bg-white/10')}>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><circle cx="4.5" cy="10" r="1.4" /><circle cx="10" cy="10" r="1.4" /><circle cx="15.5" cy="10" r="1.4" /></svg>
        </button>
        {menuOpen && (
          <CardMenu task={task}
            onEdit={onEdit} onReschedule={onReschedule} onMoveQuadrant={onMoveQuadrant} onDelete={onDelete}
            onClose={() => setMenuOpen(false)} />
        )}
      </div>
    </div>
  )
})

function SortableTaskCard(props) {
  const { quadrant, task, focused, ...rest } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', quadrant },
  })
  return (
    <div ref={setNodeRef}
      id={`task-${task.id}`}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      {...attributes}
      {...listeners}>
      <TaskCardContent task={task} focused={focused} {...rest} />
    </div>
  )
}

// ─── 象限列 ─────────────────────────────────────────────────

function QuadrantColumn({ block, tasks, softLimit, focusedId, cardHandlers, onAddFirst, dragOver, dark }) {
  const { setNodeRef } = useDroppable({
    id: `quadrant-${block.quadrant}`,
    data: { type: 'container', quadrant: block.quadrant },
  })
  const m = quadrantMeta(block.quadrant)
  const pendingCount = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length
  const overLimit = softLimit > 0 && pendingCount > softLimit

  return (
    <div className={'rounded-2xl border p-4 transition-all bg-white dark:bg-white/[0.025] ' +
      (dragOver
        ? 'border-indigo-400/70 ring-2 ring-indigo-400/30'
        : 'border-black/[0.07] dark:border-white/[0.07]')}>
      <div className="h-[3px] rounded-full mb-3" style={{ background: m.color }} />
      <div className="flex items-center gap-2 mb-3">
        <span className={'text-sm font-semibold ' + m.text}>{block.label}</span>
        <span className="text-[11px] text-stone-400">{block.subtitle}</span>
        <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full text-[11px] flex items-center justify-center tabular-nums text-white"
          style={{ background: overLimit ? '#ef4444' : m.color }}>
          {pendingCount}
        </span>
      </div>
      {overLimit && (
        <div className="mb-2.5 rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed bg-orange-500/10 text-orange-700 dark:text-orange-300">
          该象限已有 {pendingCount} 个待办，超过建议上限 {softLimit}，考虑迁移或委派部分任务
        </div>
      )}
      <div ref={setNodeRef} className="flex flex-col gap-2 min-h-[76px]">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(t => (
            <SortableTaskCard key={t.id} task={t} quadrant={block.quadrant} focused={focusedId === t.id} dark={dark} {...cardHandlers} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="flex flex-col items-center gap-2.5 py-5 rounded-xl border border-dashed border-black/[0.1] dark:border-white/[0.12]">
            <span className="text-[11.5px] text-stone-400">这个象限还是空的</span>
            <button onClick={() => onAddFirst(block.quadrant)}
              className="px-3 h-7 rounded-lg text-xs text-indigo-600 dark:text-indigo-400 border border-dashed border-indigo-500/40 hover:bg-indigo-500/10 transition-colors">
              添加第一个任务
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 看板 ───────────────────────────────────────────────────

function buildMap(data) {
  const map = { 1: [], 2: [], 3: [], 4: [] }
  for (const block of data.quadrants) {
    map[block.quadrant] = [...block.tasks].sort((a, b) => a.position - b.position)
  }
  return map
}

/** 碰撞检测：优先命中任务卡片，空象限容器作为低优先级落点 */
function collisionDetection(args) {
  const pointer = pointerWithin(args)
  const collisions = pointer.length > 0 ? pointer : rectIntersection(args)
  for (const collision of collisions) {
    const data = collision.data?.droppableContainer?.data?.current
    if (data?.type === 'task') return [collision]
  }
  return collisions
}

export default function QuadrantBoard({ data, focusedId, cardHandlers, onAddFirst, onRefresh, onMove, onReorder, toast, dark }) {
  const [map, setMap] = useState(() => buildMap(data))
  const mapRef = useRef(map)
  const [activeId, setActiveId] = useState(null)
  const [overQuadrant, setOverQuadrant] = useState(null)
  const startQuadrantRef = useRef(null)

  useEffect(() => {
    const next = buildMap(data)
    mapRef.current = next
    setMap(next)
  }, [data])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const findQuadrant = id => {
    const current = mapRef.current
    for (const q of [1, 2, 3, 4]) {
      if (current[q].some(t => t.id === id)) return q
    }
    return null
  }

  const updateMap = next => {
    mapRef.current = next
    setMap(next)
  }

  const handleDragStart = event => {
    const id = String(event.active.id)
    setActiveId(id)
    startQuadrantRef.current = findQuadrant(id)
    setOverQuadrant(findQuadrant(id))
  }

  const handleDragOver = event => {
    const { active, over } = event
    if (!over) return
    const activeTaskId = String(active.id)
    const overId = String(over.id)
    // 稳定的高亮象限：任务卡所在象限，或空容器本身（避免逐格 isOver 造成的闪烁）
    const containerQ = overId.startsWith('quadrant-') ? Number(overId.slice('quadrant-'.length)) : null
    const overQ = containerQ ?? findQuadrant(overId)
    if (overQ != null) setOverQuadrant(overQ)
    const activeQ = findQuadrant(activeTaskId)
    if (activeQ == null || overQ == null || activeQ === overQ) return
    const current = mapRef.current
    const moving = current[activeQ].find(t => t.id === activeTaskId)
    if (!moving) return
    const target = [...current[overQ]]
    const overIndex = target.findIndex(t => t.id === overId)
    target.splice(overIndex >= 0 ? overIndex : target.length, 0, moving)
    updateMap({
      ...current,
      [activeQ]: current[activeQ].filter(t => t.id !== activeTaskId),
      [overQ]: target,
    })
  }

  const handleDragEnd = async event => {
    const { active, over } = event
    const activeTaskId = String(active.id)
    setActiveId(null)
    setOverQuadrant(null)
    const startQ = startQuadrantRef.current
    startQuadrantRef.current = null
    if (!over) {
      updateMap(buildMap(data))
      return
    }
    const current = mapRef.current
    const targetQ = findQuadrant(activeTaskId)
    if (targetQ == null) return

    let list = current[targetQ]
    const overId = String(over.id)
    if (findQuadrant(overId) === targetQ) {
      const oldIndex = list.findIndex(t => t.id === activeTaskId)
      const newIndex = list.findIndex(t => t.id === overId)
      if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
        list = arrayMove(list, oldIndex, newIndex)
        updateMap({ ...current, [targetQ]: list })
      }
    }

    const index = list.findIndex(t => t.id === activeTaskId)
    const beforeTaskId = index >= 0 && index + 1 < list.length ? list[index + 1].id : null

    try {
      if (startQ != null && startQ !== targetQ) {
        await onMove(activeTaskId, { ...flagsForQuadrant(targetQ), before_task_id: beforeTaskId })
        await onRefresh()
      } else if (list !== current[targetQ]) {
        await onReorder(activeTaskId, { before_task_id: beforeTaskId })
        await onRefresh()
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : '移动任务失败', 'error')
      await onRefresh()
    }
  }

  const handleDragCancel = () => {
    setActiveId(null)
    setOverQuadrant(null)
    startQuadrantRef.current = null
    updateMap(buildMap(data))
  }

  const activeTask = activeId != null
    ? [1, 2, 3, 4].flatMap(q => map[q]).find(t => t.id === activeId) ?? null
    : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="grid grid-cols-2 gap-3">
        {QUADRANT_DISPLAY_ORDER
          .map(q => data.quadrants.find(b => b.quadrant === q))
          .filter(Boolean)
          .map(block => (
            <QuadrantColumn
              key={block.quadrant}
              block={block}
              tasks={map[block.quadrant]}
              softLimit={data.quadrant_soft_limit}
              focusedId={focusedId}
              cardHandlers={cardHandlers}
              onAddFirst={onAddFirst}
              dragOver={activeId != null && overQuadrant === block.quadrant}
              dark={dark}
            />
          ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <TaskCardContent task={activeTask} dark={dark} {...cardHandlers}
            className="shadow-xl rotate-[1.5deg] scale-[1.02] " />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
