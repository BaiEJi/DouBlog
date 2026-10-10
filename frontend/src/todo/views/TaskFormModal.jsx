/**
 * 任务新增/编辑弹窗（照搬 MyTodo TaskFormModal 交互）：
 * 标题 + 象限四选卡（文案可被设置覆盖）+ 类别 + 日期（清空→收件箱）+
 * 备注 + 任务级通知（当天 notify_time 未完成时推送所选渠道）。
 */
import { useEffect, useState } from 'react'

import { todoCreateTask, todoUpdateTask } from '../api'
import {
  QUADRANT_DISPLAY_ORDER, quadrantMeta, flagsForQuadrant, useQuadrantText,
  Modal, btn, inputCls, Field, todayStr,
} from '../kit'

/** 任务级通知可选渠道（key 与后端 settings.notifications.channels 对齐） */
const NOTIFY_CHANNEL_OPTIONS = [
  { value: 'email', label: '📧 邮件' },
  { value: 'chrome', label: '🌐 浏览器' },
  { value: 'apk', label: '📱 APK' },
  { value: 'chatbot', label: '🤖 Chatbot' },
]

const textAreaCls = 'w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors resize-y'

export default function TaskFormModal({
  open, categories, initialTask = null, initialQuadrant = 2,
  /** 'YYYY-MM-DD'；null 表示默认不排期（收件箱）；undefined 表示默认今天 */
  defaultDate,
  onClose, onSuccess, toast,
}) {
  const { labels, subtitles } = useQuadrantText()
  const [saving, setSaving] = useState(false)
  const [quadrantSel, setQuadrantSel] = useState(initialQuadrant)
  const [notifyOn, setNotifyOn] = useState(false)
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [dateVal, setDateVal] = useState('')     // '' = 不排期（收件箱）
  const [description, setDescription] = useState('')
  const [notifyTime, setNotifyTime] = useState('09:00')
  const [notifyChannels, setNotifyChannels] = useState(['email'])
  const isEdit = initialTask != null

  useEffect(() => {
    if (!open) return
    setQuadrantSel(initialTask ? initialTask.quadrant : initialQuadrant)
    if (initialTask) {
      setNotifyOn(initialTask.notify_enabled)
      setTitle(initialTask.title)
      setCategoryId(initialTask.category_id || '')
      setDateVal(initialTask.task_date || '')
      setDescription(initialTask.description || '')
      setNotifyTime(initialTask.notify_time || '09:00')
      const valid = (initialTask.notify_channels || []).filter(c => NOTIFY_CHANNEL_OPTIONS.some(o => o.value === c))
      setNotifyChannels(valid.length ? valid : ['email'])
    } else {
      setNotifyOn(false)
      setTitle('')
      setCategoryId('')
      setDateVal(defaultDate === undefined ? todayStr() : (defaultDate || ''))
      setDescription('')
      setNotifyTime('09:00')
      setNotifyChannels(['email'])
    }
  }, [open, initialTask, initialQuadrant, defaultDate])

  const toggleChannel = v => {
    const next = notifyChannels.includes(v)
      ? notifyChannels.filter(c => c !== v)
      : [...notifyChannels, v]
    setNotifyChannels(next.length ? next : [v])
  }

  const submit = async () => {
    if (!title.trim()) { toast('请输入任务标题', 'error'); return }
    if (!categoryId) { toast('请选择类别', 'error'); return }
    if (notifyOn && !notifyTime) { toast('请选择通知时间', 'error'); return }
    const base = {
      title: title.trim(),
      description: description.trim() || null,
      category_id: categoryId,
      ...flagsForQuadrant(quadrantSel),
      task_date: dateVal || null,
      notify_enabled: notifyOn,
      notify_time: notifyOn && notifyTime ? notifyTime : null,
      notify_channels: notifyOn ? notifyChannels : [],
    }
    setSaving(true)
    try {
      if (initialTask) {
        await todoUpdateTask(initialTask.id, { ...base, revision: initialTask.revision })
        toast('任务已更新')
      } else {
        await todoCreateTask(base)
        toast('任务已创建')
      }
      onSuccess()
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? '编辑任务' : '新增任务'}
      footer={<>
        <button onClick={onClose} className={btn.plain}>取消</button>
        <button onClick={submit} disabled={saving} className={btn.primary}>{saving ? '保存中…' : '保存'}</button>
      </>}>
      <div className="space-y-4">
        <Field label="标题">
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)} maxLength={500}
            placeholder="要做一件什么事？" className={inputCls} />
        </Field>

        <div>
          <div className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">象限</div>
          <div className="grid grid-cols-2 gap-2">
            {QUADRANT_DISPLAY_ORDER.map(q => quadrantMeta(q)).map(m => {
              const active = quadrantSel === m.quadrant
              return (
                <button key={m.quadrant} type="button" onClick={() => setQuadrantSel(m.quadrant)}
                  className={'flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl border text-left transition-colors ' +
                    (active ? '' : 'border-black/[0.08] dark:border-white/[0.1] hover:border-black/20 dark:hover:border-white/25')}
                  style={active ? { borderColor: m.color, background: m.color + '14' } : undefined}>
                  <span className="flex items-center gap-1.5 text-[13px] font-medium">
                    <span className="w-2 h-2 rounded-full" style={{ background: m.color }} />
                    {m.icon} {subtitles(m.quadrant)}
                  </span>
                  <span className="text-[11px] text-stone-400">{labels(m.quadrant)}</span>
                </button>
              )
            })}
          </div>
        </div>

        <Field label="类别">
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className={inputCls}>
            <option value="">选择类别…</option>
            {categories.filter(c => !c.is_archived).map(c => (
              <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>
            ))}
          </select>
        </Field>

        <Field label="日期" hint="清空后任务进入待办池（收件箱）">
          <div className="flex gap-2">
            <input type="date" value={dateVal} onChange={e => setDateVal(e.target.value)} className={inputCls} />
            {dateVal && (
              <button type="button" onClick={() => setDateVal('')}
                className="px-3 h-9 rounded-lg text-xs text-stone-500 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">
                清空
              </button>
            )}
          </div>
        </Field>

        <Field label="备注（可选）">
          <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)}
            placeholder="补充说明…" className={textAreaCls} />
        </Field>

        <div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={notifyOn} onChange={e => setNotifyOn(e.target.checked)}
              className="w-4 h-4 accent-indigo-500" />
            <span className="text-sm">到期提醒</span>
            <span className="text-[11.5px] text-stone-400">当天未完成时通知我</span>
          </label>
          {notifyOn && (
            <div className="mt-3 space-y-3 pl-6 border-l-2 border-black/[0.06] dark:border-white/[0.08]">
              <Field label="通知时间">
                <input type="time" step={300} value={notifyTime} onChange={e => setNotifyTime(e.target.value)} className={inputCls} />
              </Field>
              <div>
                <div className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">通知渠道（点击选择，可多选）</div>
                <div className="flex flex-wrap gap-1.5">
                  {NOTIFY_CHANNEL_OPTIONS.map(o => {
                    const on = notifyChannels.includes(o.value)
                    return (
                      <button key={o.value} type="button" onClick={() => toggleChannel(o.value)}
                        className={'px-2.5 h-7 rounded-full text-xs transition-colors border ' +
                          (on
                            ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-600 dark:text-indigo-400 font-medium'
                            : 'border-black/10 dark:border-white/10 text-stone-500 hover:border-black/25 dark:hover:border-white/25')}>
                        {o.label}
                      </button>
                    )
                  })}
                </div>
                <div className="text-[11px] text-stone-400 mt-1.5">渠道参数在 设置 → 消息推送 中配置</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
