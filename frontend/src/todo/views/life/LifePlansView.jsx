/**
 * 规律生活 · 计划（照搬 MyTodo LifePlansPage 交互）：
 * 左侧总览侧栏（按类别分组）+ 右侧详情（启停/编辑/删除 + 总体看板三桶：
 * 历史待完成/历史已完成/未来）+ 计划表单（四种循环规则）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { todoPlans, todoCreatePlan, todoUpdatePlan, todoDeletePlan, todoTasks, todoCategories } from '../../api'
import { Confirm, Modal, Segmented, Switch, btn, inputCls, Field, Empty, Dot, WEEKDAY_OPTIONS, adjustForDark, addDays, fmtDate, todayStr } from '../../kit'

const RULE_TYPE_OPTIONS = [
  { label: '每周固定', value: 'weekly' },
  { label: '每隔几天', value: 'interval' },
  { label: '每周几次', value: 'weekly_times' },
  { label: '每月几次', value: 'monthly_times' },
]

/** 每周 N 次自动均摊到的周几（与后端 weekdays_for_weekly_times 一致） */
function weekdaysForTimes(times) {
  return [...new Set(Array.from({ length: times }, (_, i) => Math.floor((i * 7) / times)))].sort((a, b) => a - b)
}

const textAreaCls = 'w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors resize-y'

/** 总体看板三桶列表（历史待完成/已完成/未来） */
function Bucket({ title, tone, list, strike, note }) {
  return (
    <div>
      <div className={'text-[13px] font-semibold mb-2.5 ' + tone}>{title}</div>
      {list.length === 0 ? (
        <div className="text-xs text-stone-400 py-3">{note}</div>
      ) : (
        <div className="divide-y divide-black/[0.05] dark:divide-white/[0.06] rounded-xl border border-black/[0.06] dark:border-white/[0.07] max-h-[340px] overflow-y-auto">
          {list.map(t => (
            <div key={t.id} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
              <span className="text-[11px] text-stone-400 tabular-nums w-11 shrink-0">{(t.task_date ?? '').slice(5)}</span>
              <span className={'truncate ' + (strike ? 'line-through text-stone-400' : '')}>{t.title}</span>
              {strike && t.completion_note && (
                <span className="text-[11px] text-stone-400 truncate max-w-[140px]">📝 {t.completion_note}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PlanForm({ open, editing, categories, onClose, onSaved, toast }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [startDate, setStartDate] = useState(todayStr())
  const [endDate, setEndDate] = useState('')
  const [ruleType, setRuleType] = useState('weekly')
  const [weekdays, setWeekdays] = useState([0])
  const [intervalDays, setIntervalDays] = useState(2)
  const [times, setTimes] = useState(3)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (editing) {
      setTitle(editing.title)
      setDescription(editing.description || '')
      setCategoryId(editing.category_id || '')
      setStartDate(editing.start_date)
      setEndDate(editing.end_date || '')
      setRuleType(editing.rule_type)
      setWeekdays(editing.rule?.weekdays ?? [0])
      setIntervalDays(editing.rule?.interval_days ?? 2)
      setTimes(editing.rule?.times ?? 3)
    } else {
      setTitle(''); setDescription(''); setCategoryId('')
      setStartDate(todayStr()); setEndDate('')
      setRuleType('weekly'); setWeekdays([0]); setIntervalDays(2); setTimes(3)
    }
  }, [open, editing])

  const toggleWeekday = w => {
    setWeekdays(prev => (prev.includes(w) ? prev.filter(x => x !== w) : [...prev, w].sort((a, b) => a - b)))
  }

  const submit = async () => {
    if (!title.trim()) { toast('请输入计划名称', 'error'); return }
    if (!categoryId) { toast('请选择类型', 'error'); return }
    if (!startDate) { toast('请选择开始时间', 'error'); return }
    let rule
    if (ruleType === 'weekly') {
      if (!weekdays.length) { toast('每周固定至少选一天', 'error'); return }
      rule = { type: 'weekly', weekdays }
    } else if (ruleType === 'interval') {
      if (!intervalDays || intervalDays < 1) { toast('请输入间隔天数', 'error'); return }
      rule = { type: 'interval', interval_days: intervalDays }
    } else {
      if (!times || times < 1) { toast('请输入次数', 'error'); return }
      rule = { type: ruleType, times }
    }
    if (endDate && endDate < startDate) { toast('结束时间不能早于开始时间', 'error'); return }
    setSaving(true)
    try {
      const body = {
        title: title.trim(),
        description: description.trim() || null,
        category_id: categoryId,
        start_date: startDate,
        end_date: endDate || null,
        rule,
      }
      let created = null
      if (editing) await todoUpdatePlan(editing.id, body)
      else created = await todoCreatePlan(body)
      toast(editing ? '计划已更新，未来实例已重新生成' : '计划已创建，任务实例已生成')
      onSaved(created?.id)
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? '编辑计划' : '新增计划'} width="max-w-xl"
      footer={<>
        <button onClick={onClose} className={btn.plain}>取消</button>
        <button onClick={submit} disabled={saving} className={btn.primary}>{saving ? '保存中…' : '保存'}</button>
      </>}>
      <div className="space-y-4">
        <Field label="名称">
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
            placeholder="如：晨跑 5 公里" className={inputCls} />
        </Field>
        <Field label="类型">
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className={inputCls}>
            <option value="">选择计划类型…</option>
            {categories.filter(c => !c.is_archived).map(c => (
              <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="起止时间" hint="结束时间留空 = 长期坚持">
          <div className="flex items-center gap-2">
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} />
            <span className="text-stone-400 text-xs shrink-0">至</span>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputCls} />
          </div>
        </Field>
        <div>
          <div className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">重复规则</div>
          <Segmented value={ruleType} onChange={setRuleType} options={RULE_TYPE_OPTIONS} />
        </div>
        {ruleType === 'weekly' && (
          <div>
            <div className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">每周的哪几天</div>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_OPTIONS.map((w, i) => {
                const on = weekdays.includes(i)
                return (
                  <button key={i} type="button" onClick={() => toggleWeekday(i)}
                    className={'px-2.5 h-7 rounded-lg text-xs border transition-colors ' +
                      (on
                        ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-600 dark:text-indigo-400 font-medium'
                        : 'border-black/10 dark:border-white/10 text-stone-500 hover:border-black/25 dark:hover:border-white/25')}>
                    {w.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {ruleType === 'interval' && (
          <Field label="每隔几天">
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={366} value={intervalDays}
                onChange={e => setIntervalDays(Number(e.target.value) || 1)} className={inputCls + ' w-28'} />
              <span className="text-xs text-stone-400">天一次</span>
            </div>
          </Field>
        )}
        {(ruleType === 'weekly_times' || ruleType === 'monthly_times') && (
          <Field label={ruleType === 'weekly_times' ? '每周几次' : '每月几次'}>
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={ruleType === 'weekly_times' ? 7 : 31} value={times}
                onChange={e => setTimes(Number(e.target.value) || 1)} className={inputCls + ' w-28'} />
              <span className="text-xs text-stone-400">次</span>
            </div>
            {ruleType === 'weekly_times' && times >= 1 && (
              <div className="text-[11px] text-stone-400 mt-1.5">
                自动安排在 {weekdaysForTimes(times).map(w => WEEKDAY_OPTIONS[w].label).join('、')}
              </div>
            )}
            {ruleType === 'monthly_times' && (
              <div className="text-[11px] text-stone-400 mt-1.5">
                按当月天数自动均摊到固定日期（如每月 2 次 → 15 日、月末）
              </div>
            )}
          </Field>
        )}
        <Field label="备注（可选）">
          <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)}
            placeholder="补充说明…" className={textAreaCls} />
        </Field>
        <div className="text-[11.5px] text-stone-400">
          保存后{editing ? '未来未完成的实例将按新规则重新生成' : '从开始时间起（未来约 90 天内）自动生成任务实例'}。
        </div>
      </div>
    </Modal>
  )
}

export default function LifePlansView({ toast, dark }) {
  const [plans, setPlans] = useState(null)
  const [categories, setCategories] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [instances, setInstances] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = useCallback(async () => {
    try {
      const [ps, cs] = await Promise.all([todoPlans(), todoCategories(true)])
      setPlans(ps)
      setCategories(cs)
      setSelectedId(prev => (prev && ps.some(p => p.id === prev) ? prev : (ps[0]?.id ?? null)))
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载计划失败', 'error')
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  // 选中计划的全量实例（计划开始日 ~ 未来窗口），用于总体看板三桶
  useEffect(() => {
    if (!selectedId) { setInstances([]); return }
    let cancelled = false
    const plan = plans?.find(p => p.id === selectedId)
    const from = plan?.start_date || fmtDate(addDays(new Date(), -30))
    const to = fmtDate(addDays(new Date(), 120))
    todoTasks({ from, to, status: 'all', plan_only: true })
      .then(rows => { if (!cancelled) setInstances(rows) })
      .catch(() => { if (!cancelled) setInstances([]) })
    return () => { cancelled = true }
  }, [selectedId, plans])

  const selected = plans?.find(p => p.id === selectedId) ?? null
  const catOf = id => categories.find(c => c.id === id)

  /** 侧栏按类别分组展示（类别顺序跟随类别排序，无类别归「未分类」） */
  const groupedPlans = useMemo(() => {
    const groups = []
    for (const cat of [...categories].sort((a, b) => a.sort_order - b.sort_order)) {
      const ps = (plans || []).filter(p => p.category_id === cat.id)
      if (ps.length) groups.push({ key: cat.id, name: `${cat.icon ? `${cat.icon} ` : ''}${cat.name}`, color: cat.color, plans: ps })
    }
    const none = (plans || []).filter(p => !p.category_id || !catOf(p.category_id))
    if (none.length) groups.push({ key: 'none', name: '未分类', color: '#94a3b8', plans: none })
    return groups
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, categories])

  const myInstances = useMemo(
    () => (instances || [])
      .filter(t => t.plan_id === selectedId)
      .sort((a, b) => ((a.task_date ?? '') < (b.task_date ?? '') ? 1 : -1)),
    [instances, selectedId]
  )
  const today = todayStr()
  /** 总体看板三桶：历史待完成 / 历史已完成 / 未来（今日未完成 + 未来） */
  const todoHistory = myInstances.filter(t => (t.task_date ?? '') < today && t.status !== 'done')
  const doneHistory = myInstances.filter(t => t.status === 'done')
  const future = myInstances.filter(t => (t.task_date ?? '') >= today && t.status !== 'done')

  const toggleEnabled = async p => {
    try {
      await todoUpdatePlan(p.id, { enabled: !p.enabled })
      toast(p.enabled ? '已停用，未来实例已清理' : '已启用，任务实例已重新生成')
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error')
    }
  }

  const remove = async p => {
    try {
      await todoDeletePlan(p.id)
      toast('计划已删除，未来实例已清理')
      if (selectedId === p.id) setSelectedId(null)
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'error')
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      {/* 左：总览侧栏 */}
      <div className="w-full lg:w-[260px] shrink-0 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold">计划（{plans?.length ?? 0}）</span>
          <button onClick={() => { setEditing(null); setFormOpen(true) }} className={btn.miniPrimary}>
            + 新增
          </button>
        </div>
        {plans == null ? (
          <Empty text="加载中…" />
        ) : plans.length === 0 ? (
          <Empty text="还没有计划" />
        ) : (
          <div className="space-y-3 max-h-[560px] overflow-y-auto">
            {groupedPlans.map(g => (
              <div key={g.key}>
                <div className="flex items-center gap-1.5 px-1.5 mb-1 text-[11px] text-stone-400">
                  <Dot color={dark ? adjustForDark(g.color) : g.color} size={7} />
                  {g.name}
                  <span className="tabular-nums">{g.plans.length}</span>
                </div>
                {g.plans.map(p => (
                  <button key={p.id} onClick={() => setSelectedId(p.id)}
                    className={'w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left transition-colors ' +
                      (p.id === selectedId
                        ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                        : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05]')}>
                    <div className="flex-1 min-w-0">
                      <div className={'text-[13px] font-medium truncate ' + (p.enabled ? '' : 'opacity-55')}>{p.title}</div>
                      <div className="text-[10.5px] text-stone-400 truncate">
                        {p.rule_text}{!p.enabled && ' · 已停用'}
                      </div>
                    </div>
                    {p.next_occurrence && (
                      <span className="text-[10.5px] text-stone-400 tabular-nums shrink-0">{p.next_occurrence.slice(5)}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 右：详情 */}
      <div className="flex-1 min-w-0 w-full space-y-4">
        {!selected ? (
          <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5">
            <Empty text="选择左侧计划查看详情，或点击「新增」创建第一个计划" />
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5">
              <div className="flex items-center gap-2 flex-wrap">
                <Dot color={catOf(selected.category_id)?.color ?? '#94a3b8'} />
                <span className={'text-base font-semibold ' + (selected.enabled ? '' : 'opacity-60')}>{selected.title}</span>
                {(() => {
                  const cat = catOf(selected.category_id)
                  return cat ? (
                    <span className="rounded-full px-2 h-6 text-[11px] inline-flex items-center bg-black/[0.04] dark:bg-white/[0.06] text-stone-500 dark:text-stone-400">
                      {cat.icon ? `${cat.icon} ` : ''}{cat.name}
                    </span>
                  ) : null
                })()}
                {!selected.enabled && (
                  <span className="rounded-md px-1.5 h-5 text-[10.5px] inline-flex items-center bg-stone-500/10 text-stone-500 dark:text-stone-400">已停用</span>
                )}
                <span className="ml-auto flex items-center gap-2.5">
                  <span className="flex items-center gap-1.5" title={selected.enabled ? '停用后将清理未来实例，可随时再启用' : '已停用，开启后继续生成'}>
                    <Switch size="sm" checked={selected.enabled} onChange={() => toggleEnabled(selected)} />
                  </span>
                  <button onClick={() => { setEditing(selected); setFormOpen(true) }} className={btn.mini}>编辑</button>
                  <button onClick={() => setConfirmDel(selected)} className={btn.miniDanger}>删除</button>
                </span>
              </div>
              <div className="flex items-center gap-x-5 gap-y-1.5 flex-wrap mt-3 text-xs text-stone-500 dark:text-stone-400">
                <span>🔁 {selected.rule_text}</span>
                <span>📅 {selected.start_date}{selected.end_date ? ` ~ ${selected.end_date}` : ' ~ 长期'}</span>
                <span>✅ 已生成 {selected.generated_count} 个</span>
                {selected.next_occurrence && <span>⏭ 下次 {selected.next_occurrence}</span>}
              </div>
              {selected.description && (
                <div className="mt-2.5 text-[13px] text-stone-500 dark:text-stone-400">{selected.description}</div>
              )}
              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.07] p-3">
                  <div className="text-[11px] text-stone-400 mb-1">历史待完成</div>
                  <div className={'text-lg font-semibold tabular-nums ' + (todoHistory.length ? 'text-orange-600 dark:text-orange-400' : '')}>{todoHistory.length}<span className="text-[11px] font-normal text-stone-400 ml-0.5">次</span></div>
                </div>
                <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.07] p-3">
                  <div className="text-[11px] text-stone-400 mb-1">历史已完成</div>
                  <div className={'text-lg font-semibold tabular-nums ' + (doneHistory.length ? 'text-emerald-600 dark:text-emerald-400' : '')}>{doneHistory.length}<span className="text-[11px] font-normal text-stone-400 ml-0.5">次</span></div>
                </div>
                <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.07] p-3">
                  <div className="text-[11px] text-stone-400 mb-1">未来安排</div>
                  <div className="text-lg font-semibold tabular-nums">{future.length}<span className="text-[11px] font-normal text-stone-400 ml-0.5">次</span></div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold">总体看板</h3>
                <button onClick={load} className={btn.mini}>↻ 刷新</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <Bucket title={`历史待完成（${todoHistory.length}）`} tone="text-orange-600 dark:text-orange-400" list={todoHistory} note="没有欠账" />
                <Bucket title={`历史已完成（${doneHistory.length}）`} tone="text-emerald-600 dark:text-emerald-400" list={doneHistory} strike note="还没有完成记录" />
                <Bucket title={`未来（${future.length}）`} tone="" list={future} note="没有未来的安排" />
              </div>
            </div>
          </>
        )}
      </div>

      <PlanForm open={formOpen} editing={editing} categories={categories}
        onClose={() => setFormOpen(false)}
        onSaved={id => { load().then(() => { if (id) setSelectedId(id) }) }}
        toast={toast} />

      {confirmDel && (
        <Confirm text="删除该计划？未来未完成的实例会一并清理，已完成记录保留" danger
          onCancel={() => setConfirmDel(null)}
          onOk={() => { const p = confirmDel; setConfirmDel(null); remove(p) }} />
      )}
    </div>
  )
}
