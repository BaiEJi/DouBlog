/**
 * 设置（对照 MyTodo SettingsPage 的 Todo 设置部分移植；系统类设置归 DouBlog 统一页面）：
 * 基本偏好（时区/象限文案/自动迁移/迁移干预阈值/象限软上限/一天开始小时）
 * + 类别管理（CRUD/归档）+ 消息推送（email 渠道配置 + 测试发送；其余渠道预留）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  todoSettings, todoSaveSettings, todoTestNotification,
  todoCategories, todoCreateCategory, todoUpdateCategory, todoDeleteCategory,
} from '../api'
import {
  Card, Confirm, Modal, Switch, btn, inputCls, Field, Dot,
  QUADRANT_META, adjustForDark, invalidateQuadrantText,
} from '../kit'

const COLOR_PRESETS = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#ec4899', '#8b5cf6', '#94a3b8']

/** 推送渠道总览（email 已支持，其余预留待发送端接入） */
const CHANNEL_LIST = [
  { key: 'email', label: '邮件推送' },
  { key: 'apk', label: 'APK 推送' },
  { key: 'chrome', label: 'Chrome 浏览器推送' },
  { key: 'chatbot', label: 'Chatbot 推送' },
]

const TIMEZONES = [
  'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul',
  'Asia/Bangkok', 'Asia/Dubai', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney', 'UTC',
]

const numInput = inputCls + ' w-24'

function ColorSwatches({ value, onChange, dark }) {
  const shown = dark && value ? adjustForDark(value) : value
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {COLOR_PRESETS.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)} title={c}
          className={'w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ' +
            (value?.toLowerCase() === c ? 'border-stone-800 dark:border-white scale-110' : 'border-transparent')}
          style={{ background: dark ? adjustForDark(c) : c }} />
      ))}
      <input type="color" value={value || '#6366f1'} onChange={e => onChange(e.target.value)} title="自定义颜色"
        className="w-7 h-7 rounded-lg cursor-pointer bg-transparent border border-black/10 dark:border-white/10" />
      <span className="text-[11px] text-stone-400 font-mono">{shown}</span>
    </div>
  )
}

export default function SettingsView({ toast, dark }) {
  // 基本偏好
  const [prefs, setPrefs] = useState(null)
  const [saving, setSaving] = useState(false)
  // 类别
  const [categories, setCategories] = useState([])
  const [catModal, setCatModal] = useState(null)      // 编辑中的类别
  const [catForm, setCatForm] = useState({ name: '', icon: '', sort_order: 0 })
  const [catColor, setCatColor] = useState('#6366f1')
  const [newCat, setNewCat] = useState({ name: '', icon: '', sort_order: null })
  const [newCatColor, setNewCatColor] = useState('#6366f1')
  const [catSaving, setCatSaving] = useState(false)
  const [confirmCat, setConfirmCat] = useState(null)
  // 消息推送
  const notifChannelsRef = useRef({})
  const [notif, setNotif] = useState(null)
  const [notifSaving, setNotifSaving] = useState(false)
  const [notifTesting, setNotifTesting] = useState(false)
  const [emailConfigured, setEmailConfigured] = useState(false)

  const loadSettings = useCallback(() => {
    todoSettings()
      .then(s => {
        setPrefs({
          timezone: s.timezone || 'Asia/Shanghai',
          quadrant_labels: s.quadrant_labels || { q1: '', q2: '', q3: '', q4: '' },
          quadrant_subtitles: s.quadrant_subtitles || { q1: '', q2: '', q3: '', q4: '' },
          auto_migrate: !!s.auto_migrate,
          auto_urgent_days: s.auto_urgent_days ?? 3,
          migration_intervene_threshold: s.migration_intervene_threshold ?? 3,
          quadrant_soft_limit: s.quadrant_soft_limit ?? 8,
          day_start_hour: s.day_start_hour ?? 0,
        })
        const channels = s.notifications?.channels ?? {}
        notifChannelsRef.current = channels
        const email = channels.email ?? {}
        setEmailConfigured(Boolean(email.smtp_host && email.username && email.password && email.recipient))
        setNotif({
          smtp_host: email.smtp_host ?? '',
          smtp_port: email.smtp_port ?? 465,
          smtp_ssl: email.smtp_ssl ?? true,
          username: email.username ?? '',
          password: email.password ?? '',
          sender: email.sender ?? '',
          recipient: email.recipient ?? '',
        })
      })
      .catch(err => toast(err instanceof Error ? err.message : '加载设置失败', 'error'))
  }, [toast])

  const loadCategories = useCallback(() => {
    todoCategories(true).then(setCategories).catch(() => {})
  }, [])

  useEffect(() => {
    loadSettings()
    loadCategories()
  }, [loadSettings, loadCategories])

  const savePrefs = async () => {
    if (!prefs) return
    setSaving(true)
    try {
      const labels = {}, subtitles = {}
      for (const q of [1, 2, 3, 4]) {
        const l = (prefs.quadrant_labels[`q${q}`] || '').trim()
        const sub = (prefs.quadrant_subtitles[`q${q}`] || '').trim()
        if (l) labels[`q${q}`] = l
        if (sub) subtitles[`q${q}`] = sub
      }
      await todoSaveSettings({
        timezone: prefs.timezone,
        quadrant_labels: labels,
        quadrant_subtitles: subtitles,
        auto_migrate: prefs.auto_migrate,
        auto_urgent_days: Number(prefs.auto_urgent_days) || 0,
        migration_intervene_threshold: Number(prefs.migration_intervene_threshold) || 3,
        quadrant_soft_limit: Number(prefs.quadrant_soft_limit) || 8,
        day_start_hour: Number(prefs.day_start_hour) || 0,
      })
      toast('设置已保存')
      invalidateQuadrantText()   // 象限文案缓存失效，表单/看板下次取数重拉
      loadSettings()
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── 类别 ──
  const openCatModal = c => {
    setCatModal(c)
    setCatColor(c.color)
    setCatForm({ name: c.name, icon: c.icon || '', sort_order: c.sort_order })
  }

  const submitCatEdit = async () => {
    if (!catModal || !catForm.name.trim()) { toast('请输入类别名称', 'error'); return }
    setCatSaving(true)
    try {
      await todoUpdateCategory(catModal.id, {
        name: catForm.name.trim(),
        color: catColor,
        icon: catForm.icon.trim() || null,
        sort_order: catForm.sort_order ?? catModal.sort_order,
      })
      toast('类别已更新')
      setCatModal(null)
      loadCategories()
    } catch (err) {
      toast(err instanceof Error ? err.message : '更新失败', 'error')
    } finally {
      setCatSaving(false)
    }
  }

  const addCategory = async () => {
    if (!newCat.name.trim()) { toast('请输入类别名称', 'error'); return }
    setCatSaving(true)
    try {
      await todoCreateCategory({
        name: newCat.name.trim(),
        color: newCatColor,
        icon: newCat.icon.trim() || null,
        sort_order: newCat.sort_order ?? categories.length,
      })
      toast('类别已添加')
      setNewCat({ name: '', icon: '', sort_order: null })
      loadCategories()
    } catch (err) {
      toast(err instanceof Error ? err.message : '添加失败', 'error')
    } finally {
      setCatSaving(false)
    }
  }

  const toggleArchive = async c => {
    try {
      await todoUpdateCategory(c.id, { is_archived: !c.is_archived })
      loadCategories()
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error')
    }
  }

  const removeCategory = async c => {
    try {
      const res = await todoDeleteCategory(c.id)
      toast(`类别已删除，${res?.moved_to_uncategorized ?? 0} 个任务变为未分类`)
      loadCategories()
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'error')
    }
  }

  // ── 消息推送 ──
  const saveNotifications = async () => {
    if (!notif) return false
    if (!notif.smtp_host || !notif.username || !notif.password || !notif.recipient) {
      toast('请完整填写 SMTP 服务器、登录账号、授权密钥与收件邮箱', 'error')
      return false
    }
    setNotifSaving(true)
    try {
      // 保留其它渠道（apk/chrome/chatbot）的既有配置，只覆盖 email
      const channels = { ...notifChannelsRef.current, email: { ...notif, enabled: true } }
      await todoSaveSettings({ notifications: { channels } })
      notifChannelsRef.current = channels
      setEmailConfigured(true)
      toast('推送配置已保存')
      return true
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'error')
      return false
    } finally {
      setNotifSaving(false)
    }
  }

  const testNotification = async () => {
    if (!(await saveNotifications())) return
    setNotifTesting(true)
    try {
      const res = await todoTestNotification({ channel: 'email' })
      toast(res?.message || '测试消息已发送')
    } catch (err) {
      toast(err instanceof Error ? err.message : '发送失败', 'error')
    } finally {
      setNotifTesting(false)
    }
  }

  const setPref = (k, v) => setPrefs(p => (p ? { ...p, [k]: v } : p))
  const setPrefLabel = (q, key, v) =>
    setPrefs(p => (p ? { ...p, [key]: { ...p[key], [`q${q}`]: v } } : p))

  return (
    <div className="space-y-4 max-w-[900px]">
      {/* 基本偏好 */}
      <Card title="基本偏好">
        {!prefs ? (
          <div className="text-xs text-stone-400 py-4">加载中…</div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="时区" hint="决定「今天」的划分与统计口径">
                <select value={prefs.timezone} onChange={e => setPref('timezone', e.target.value)} className={inputCls + ' appearance-none pr-8 bg-no-repeat'} style={{ backgroundImage: 'linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)', backgroundPosition: 'calc(100% - 14px) calc(50% - 2px), calc(100% - 9px) calc(50% - 2px)', backgroundSize: '5px 5px, 5px 5px' }}>
                  {TIMEZONES.includes(prefs.timezone)
                    ? TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)
                    : [<option key={prefs.timezone} value={prefs.timezone}>{prefs.timezone}</option>]
                      .concat(TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>))}
                </select>
              </Field>
              <Field label="一天开始于" hint="0-23 点，跨午夜作息用">
                <input type="number" min={0} max={23} value={prefs.day_start_hour}
                  onChange={e => setPref('day_start_hour', e.target.value)} className={numInput} />
              </Field>
              <Field label="迁移干预阈值" hint="迁移超过 N 次需人工确认">
                <input type="number" min={1} max={20} value={prefs.migration_intervene_threshold}
                  onChange={e => setPref('migration_intervene_threshold', e.target.value)} className={numInput} />
              </Field>
              <Field label="象限软上限" hint="每象限建议待办数，超出提示迁移">
                <input type="number" min={1} max={100} value={prefs.quadrant_soft_limit}
                  onChange={e => setPref('quadrant_soft_limit', e.target.value)} className={numInput} />
              </Field>
              <Field label="自动迁移" hint="开启后逾期任务按规则自动迁到今天">
                <div className="flex items-center h-9">
                  <Switch checked={prefs.auto_migrate} onChange={v => setPref('auto_migrate', v)} />
                  <span className="ml-2.5 text-xs text-stone-400">{prefs.auto_migrate ? '已开启' : '已关闭'}</span>
                </div>
              </Field>
              <Field label="自动加急天数" hint="拖延超过 N 天自动标记紧急">
                <input type="number" min={0} max={365} value={prefs.auto_urgent_days}
                  onChange={e => setPref('auto_urgent_days', e.target.value)} className={numInput} />
              </Field>
            </div>

            {/* 象限文案 */}
            <div>
              <div className="text-xs text-stone-500 dark:text-stone-400 mb-2">象限文案（留空使用默认）</div>
              <div className="hidden sm:grid grid-cols-[150px_1fr_1fr] gap-3 mb-1.5 text-[11px] text-stone-400 px-1">
                <span>象限</span><span>名称</span><span>行动建议</span>
              </div>
              <div className="space-y-2">
                {QUADRANT_META.map(m => (
                  <div key={m.quadrant} className="grid grid-cols-1 sm:grid-cols-[150px_1fr_1fr] gap-2 sm:gap-3 items-center">
                    <span className={'text-[12.5px] font-medium flex items-center gap-1.5 ' + m.text}>
                      <Dot color={m.color} />Q{m.quadrant} · {m.subtitle}
                    </span>
                    <input value={prefs.quadrant_labels[`q${m.quadrant}`] || ''} placeholder={`如：${m.label}`}
                      onChange={e => setPrefLabel(m.quadrant, 'quadrant_labels', e.target.value)} className={inputCls} />
                    <input value={prefs.quadrant_subtitles[`q${m.quadrant}`] || ''} placeholder={`如：${m.subtitle}`}
                      onChange={e => setPrefLabel(m.quadrant, 'quadrant_subtitles', e.target.value)} className={inputCls} />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <button onClick={savePrefs} disabled={saving} className={btn.primary}>{saving ? '保存中…' : '保存设置'}</button>
            </div>
          </div>
        )}
      </Card>

      {/* 类别管理 */}
      <Card title="类别管理">
        {categories.length === 0 && <div className="text-xs text-stone-400 mb-3">还没有类别，先在下面添加一个</div>}
        <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06] rounded-xl border border-black/[0.06] dark:border-white/[0.07] mb-4">
          {categories.map(c => (
            <div key={c.id} className="flex items-center gap-2.5 px-3.5 py-2.5 flex-wrap">
              <Dot color={dark ? adjustForDark(c.color) : c.color} size={9} />
              <span className="text-sm font-medium">{c.name}</span>
              {c.icon && <span className="text-sm">{c.icon}</span>}
              <span className="rounded-md px-1.5 h-5 text-[10.5px] inline-flex items-center bg-black/[0.04] dark:bg-white/[0.06] text-stone-500 dark:text-stone-400 tabular-nums">{c.task_count} 个任务</span>
              {c.is_archived && (
                <span className="rounded-md px-1.5 h-5 text-[10.5px] inline-flex items-center bg-stone-500/10 text-stone-500 dark:text-stone-400">已归档</span>
              )}
              <span className="ml-auto flex items-center gap-1.5">
                <button onClick={() => openCatModal(c)} className={btn.mini}>编辑</button>
                <button onClick={() => toggleArchive(c)} className={btn.mini}>{c.is_archived ? '取消归档' : '归档'}</button>
                <button onClick={() => setConfirmCat(c)} className={btn.miniDanger}>删除</button>
              </span>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-dashed border-black/[0.12] dark:border-white/[0.14] p-4">
          <div className="text-[13px] font-medium mb-3">新增类别</div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={newCat.name} onChange={e => setNewCat(v => ({ ...v, name: e.target.value }))}
              placeholder="类别名称" className={inputCls + ' w-40'} />
            <ColorSwatches value={newCatColor} onChange={setNewCatColor} dark={dark} />
            <input value={newCat.icon} onChange={e => setNewCat(v => ({ ...v, icon: e.target.value }))}
              placeholder="图标（可选）" className={inputCls + ' w-28'} />
            <input type="number" min={0} value={newCat.sort_order ?? ''} placeholder="排序"
              onChange={e => setNewCat(v => ({ ...v, sort_order: e.target.value === '' ? null : Number(e.target.value) }))}
              className={inputCls + ' w-20'} />
            <button onClick={addCategory} disabled={catSaving} className={btn.primary}>添加</button>
          </div>
        </div>
      </Card>

      {/* 消息推送 */}
      <Card title="消息推送">
        <div className="mb-3 text-xs text-stone-500 dark:text-stone-400">
          任务在指定时间仍未完成时，向已启用的渠道推送提醒；各渠道共享同一配置接口，新渠道接入后在此统一配置。
        </div>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {CHANNEL_LIST.map(c => c.key === 'email' ? (
            <span key={c.key}
              className={'rounded-md px-2 h-6 text-[11px] inline-flex items-center ' +
                (emailConfigured
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-black/[0.04] dark:bg-white/[0.06] text-stone-400')}>
              {c.label} · {emailConfigured ? '已启用' : '未启用'}
            </span>
          ) : (
            <span key={c.key} className="rounded-md px-2 h-6 text-[11px] inline-flex items-center bg-black/[0.04] dark:bg-white/[0.06] text-stone-400">
              {c.label} · 预留
            </span>
          ))}
        </div>
        {notif && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="SMTP 服务器">
              <input value={notif.smtp_host} onChange={e => setNotif(n => ({ ...n, smtp_host: e.target.value }))}
                placeholder="如 smtp.qq.com" className={inputCls} />
            </Field>
            <div className="grid grid-cols-[1fr_auto] gap-4">
              <Field label="端口">
                <input type="number" min={1} max={65535} value={notif.smtp_port}
                  onChange={e => setNotif(n => ({ ...n, smtp_port: Number(e.target.value) || 465 }))} className={inputCls} />
              </Field>
              <Field label="SSL 直连" hint="开=465，关=587">
                <div className="flex items-center h-9">
                  <Switch checked={notif.smtp_ssl} onChange={v => setNotif(n => ({ ...n, smtp_ssl: v }))} />
                </div>
              </Field>
            </div>
            <Field label="登录账号">
              <input value={notif.username} onChange={e => setNotif(n => ({ ...n, username: e.target.value }))}
                placeholder="SMTP 登录邮箱" className={inputCls} />
            </Field>
            <Field label="授权密钥">
              <input type="password" autoComplete="new-password" value={notif.password}
                onChange={e => setNotif(n => ({ ...n, password: e.target.value }))}
                placeholder="QQ/163 需使用授权码，而非登录密码" className={inputCls} />
            </Field>
            <Field label="发件人地址（可选）">
              <input value={notif.sender} onChange={e => setNotif(n => ({ ...n, sender: e.target.value }))}
                placeholder="默认同登录账号" className={inputCls} />
            </Field>
            <Field label="提醒收件邮箱">
              <input value={notif.recipient} onChange={e => setNotif(n => ({ ...n, recipient: e.target.value }))}
                placeholder="接收提醒的邮箱" className={inputCls} />
            </Field>
          </div>
        )}
        <div className="flex items-center gap-2 mt-4">
          <button onClick={saveNotifications} disabled={notifSaving} className={btn.primary}>{notifSaving ? '保存中…' : '保存配置'}</button>
          <button onClick={testNotification} disabled={notifTesting} className={btn.plain}>{notifTesting ? '发送中…' : '测试发送'}</button>
        </div>
        <div className="text-[11px] text-stone-400 mt-3">
          授权密钥仅保存在本机数据库；「测试发送」会先保存当前配置，再向该邮箱推送一条测试消息。
        </div>
      </Card>

      {/* 编辑类别弹窗 */}
      <Modal open={catModal != null} title="编辑类别" onClose={() => setCatModal(null)}
        footer={<>
          <button onClick={() => setCatModal(null)} className={btn.plain}>取消</button>
          <button onClick={submitCatEdit} disabled={catSaving} className={btn.primary}>{catSaving ? '保存中…' : '保存'}</button>
        </>}>
        <div className="space-y-4">
          <Field label="名称">
            <input value={catForm.name} onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="颜色">
            <ColorSwatches value={catColor} onChange={setCatColor} dark={dark} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="图标（可选，emoji 或文字）">
              <input value={catForm.icon} onChange={e => setCatForm(f => ({ ...f, icon: e.target.value }))}
                placeholder="如 💼" className={inputCls} />
            </Field>
            <Field label="排序">
              <input type="number" min={0} value={catForm.sort_order}
                onChange={e => setCatForm(f => ({ ...f, sort_order: Number(e.target.value) || 0 }))} className={inputCls} />
            </Field>
          </div>
        </div>
      </Modal>

      {confirmCat && (
        <Confirm text={`删除后 ${confirmCat.task_count} 个任务将变为未分类，确认删除？`} danger
          onCancel={() => setConfirmCat(null)}
          onOk={() => { const c = confirmCat; setConfirmCat(null); removeCategory(c) }} />
      )}
    </div>
  )
}
