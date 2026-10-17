/**
 * 规律生活 · 今日打卡（照搬 MyTodo LifeTodayPage 交互）：
 * 日期导航英雄卡（环形进度 SVG）+ 打卡清单；完成走 /tasks/{id}/complete（可填备注）、重开走 reopen。
 * URL：?v=life&lsub=today&date=YYYY-MM-DD。
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { todoPlanToday, todoCompleteTask, todoReopenTask } from '../../api'
import { Modal, btn, adjustForDark, isValidDateStr, parseDate, fmtDate, todayStr, WEEKDAY_CN, useTodoCategories } from '../../kit'

const textAreaCls = 'w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors resize-y'

function ProgressRing({ size = 92, pct, done, total }) {
  const r = (size - 10) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="7"
          className="stroke-black/[0.07] dark:stroke-white/[0.1]" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="7" strokeLinecap="round"
          stroke="#6366f1" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: 'stroke-dashoffset .4s' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-extrabold tabular-nums">{done}/{total}</span>
      </div>
    </div>
  )
}

export default function LifeTodayView({ toast, dark }) {
  const [sp, setSp] = useSearchParams()
  const [date, setDate] = useState(() => {
    const p = sp.get('date')
    return p && isValidDateStr(p) ? parseDate(p) : new Date()
  })
  const [data, setData] = useState(null)
  const { categories } = useTodoCategories(true)
  // 打卡备注弹窗
  const [completing, setCompleting] = useState(null)   // task id
  const [note, setNote] = useState('')
  const [noteTitle, setNoteTitle] = useState('')

  const dateStr = fmtDate(date)

  const load = useCallback(async () => {
    try {
      setData(await todoPlanToday(dateStr))
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载失败', 'error')
    }
  }, [dateStr, toast])

  useEffect(() => { load() }, [load])

  // 日历跳转：响应 ?date= 变化
  useEffect(() => {
    const p = sp.get('date')
    if (p && isValidDateStr(p) && p !== fmtDate(date)) setDate(parseDate(p))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp])

  const changeDate = d => {
    setDate(d)
    const ds = fmtDate(d)
    setSp(ds === todayStr() ? { v: 'life', lsub: 'today' } : { v: 'life', lsub: 'today', date: ds }, { replace: true })
  }

  const toggle = async (taskId, withNote) => {
    try {
      await todoCompleteTask(taskId, withNote ? { note: withNote } : {})
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error')
    }
  }

  const reopen = async taskId => {
    try {
      await todoReopenTask(taskId)
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error')
    }
  }

  const items = data?.items ?? []
  const doneCount = items.filter(i => i.task?.status === 'done').length
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0
  const isToday = dateStr === todayStr()
  const catOf = id => categories.find(c => c.id === id)

  return (
    <div className="max-w-[860px]">
      {/* 英雄卡：日期导航 + 环形进度 */}
      <div className="rounded-3xl border border-indigo-500/20 bg-gradient-to-r from-indigo-500/[0.10] to-transparent p-6 mb-4">
        <div className="flex items-center gap-5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-2.5">
              <button onClick={() => changeDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1))}
                title="前一天"
                className="w-8 h-8 rounded-lg border border-black/[0.08] dark:border-white/[0.1] text-stone-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center justify-center transition-colors">
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4l-5 6 5 6" /></svg>
              </button>
              <button onClick={() => changeDate(new Date())} disabled={isToday}
                className="px-2.5 h-8 rounded-lg text-xs border border-black/[0.08] dark:border-white/[0.1] text-stone-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] disabled:opacity-40 transition-colors">
                今天
              </button>
              <button onClick={() => changeDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1))} disabled={isToday}
                title="后一天"
                className="w-8 h-8 rounded-lg border border-black/[0.08] dark:border-white/[0.1] text-stone-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] disabled:opacity-40 flex items-center justify-center transition-colors">
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4l5 6-5 6" /></svg>
              </button>
            </div>
            <div className="text-xl font-semibold tracking-tight">
              {date.getMonth() + 1}月{date.getDate()}日 {WEEKDAY_CN(date)}
            </div>
            <div className="text-xs text-stone-500 dark:text-stone-400 mt-1">
              {isToday ? '今天的打卡安排' : '这一天的安排'} · 已完成 {doneCount}/{items.length}
            </div>
            {pct === 100 && items.length > 0 && (
              <div className="mt-2">
                <span className="inline-flex items-center rounded-full px-2.5 h-6 text-[11px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">🎉 全部完成，干得漂亮！</span>
              </div>
            )}
          </div>
          <ProgressRing pct={pct} done={doneCount} total={items.length} />
        </div>
      </div>

      {/* 打卡清单 */}
      {data == null ? (
        <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] py-10 text-center text-xs text-stone-400">加载中…</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] py-14 text-center">
          <div className="text-3xl mb-2">{isToday ? '🌱' : '📅'}</div>
          <div className="text-xs text-stone-400 max-w-[420px] mx-auto leading-relaxed">
            {isToday ? '今天没有安排。去 生活 → 计划 新建一个计划，开始规律生活吧。' : '这一天没有计划安排。'}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] divide-y divide-black/[0.06] dark:divide-white/[0.06]">
          {items.map(it => {
            const plan = it.plan
            const task = it.task
            const cat = catOf(plan?.category_id ?? null)
            const done = task?.status === 'done'
            const accent = cat?.color ?? '#94a3b8'
            const accentDark = dark ? adjustForDark(accent) : accent
            return (
              <div key={task?.id ?? it.title}
                className={'flex items-center gap-3 px-4 py-3 flex-wrap transition-opacity ' + (done ? 'opacity-60' : '')}>
                <button onClick={() => {
                  if (!task) return
                  if (done) reopen(task.id)
                  else { setNote(''); setNoteTitle(it.title); setCompleting(task.id) }
                }} disabled={!task} aria-label={`打卡 ${it.title}`}
                  className={'w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0 transition-colors disabled:opacity-30 ' +
                    (done ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-black/25 dark:border-white/30 hover:border-indigo-400')}>
                  {done && (
                    <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.5l4 4 8-9" /></svg>
                  )}
                </button>
                <span className={'text-sm flex-1 min-w-0 truncate ' + (done ? 'line-through text-stone-400' : '') + (!plan && !done ? ' opacity-70' : '')}>
                  {it.title}
                </span>
                {plan ? (
                  <span className="text-[11px] text-stone-400">🔁 {plan.rule_text}</span>
                ) : (
                  <span className="text-[11px] text-stone-400">已删除的计划</span>
                )}
                {done && task?.completion_note && (
                  <span className="text-[11px] text-stone-400 dark:text-stone-500 truncate max-w-[220px]">📝 {task.completion_note}</span>
                )}
                {plan && cat && (
                  <span className="rounded-full px-2 h-6 text-[11px] inline-flex items-center whitespace-nowrap"
                    style={{ color: accentDark, borderColor: accentDark + '55', background: accentDark + '14' }}>
                    {cat.icon ? `${cat.icon} ` : ''}{cat.name}
                  </span>
                )}
                {!task && (
                  <span className="rounded-md px-1.5 h-5 text-[10.5px] inline-flex items-center bg-orange-500/10 text-orange-700 dark:text-orange-300">未生成</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 打卡备注 */}
      <Modal open={completing != null} title={completing != null ? `打卡「${noteTitle}」` : '打卡'}
        onClose={() => setCompleting(null)}
        footer={<>
          <button onClick={() => setCompleting(null)} className={btn.plain}>取消</button>
          <button onClick={() => {
            const id = completing
            const n = note.trim() || undefined
            setCompleting(null)
            if (id) toggle(id, n)
          }} className={btn.primary}>完成</button>
        </>}>
        <textarea rows={3} autoFocus maxLength={500} value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="打卡备注（可选）：感受、数据、坚持天数…" className={textAreaCls} />
      </Modal>
    </div>
  )
}
