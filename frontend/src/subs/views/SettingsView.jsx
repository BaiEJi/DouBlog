/**
 * 设置视图：分类管理（CRUD / 16 色预设 / emoji 图标 / 搜索）、
 * 会员分类分布卡片（点击跳转筛选列表）、数据库备份（手动备份 + 保留策略 + 备份列表）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { subsCategories, subsCreateCategory, subsUpdateCategory, subsDeleteCategory, subsMembers, subsBackupRun, subsBackupStats } from '../api'
import { Icon, Modal, Confirm, Toast, Field, inputCls, btn, adjustForDark } from '../kit'

const PRESET_COLORS = [
  '#f5222d', '#fa541c', '#fa8c16', '#faad14', '#fadb14',
  '#a0d911', '#52c41a', '#13c2c2', '#1890ff', '#2f54eb',
  '#722ed1', '#eb2f96', '#64748b', '#84a860', '#d8849c', '#0f766e',
]

// ─── 分类管理 ─────────────────────────────────────────────

function CategoryTab({ dark, toast }) {
  const [cats, setCats] = useState(null)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)   // null | 'new' | cat
  const [confirmDel, setConfirmDel] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ name: '', icon: '', color: '#1890ff' })

  const load = useCallback(() => {
    subsCategories().then(d => d.success && setCats(d.data))
  }, [])
  useEffect(load, [load])

  const filtered = useMemo(() => {
    if (!cats) return []
    const kw = search.trim().toLowerCase()
    return kw ? cats.filter(c => c.name.toLowerCase().includes(kw)) : cats
  }, [cats, search])

  const openCreate = () => { setEditing('new'); setForm({ name: '', icon: '', color: '#1890ff' }) }
  const openEdit = c => { setEditing(c); setForm({ name: c.name, icon: c.icon || '', color: c.color || '#1890ff' }) }

  const submit = async () => {
    if (!form.name.trim()) { toast('请输入分类名称', 'error'); return }
    setSubmitting(true)
    const payload = { name: form.name.trim(), icon: form.icon || null, color: form.color }
    const d = editing === 'new' ? await subsCreateCategory(payload) : await subsUpdateCategory(editing.id, payload)
    setSubmitting(false)
    if (d.success) { setEditing(null); toast('保存成功'); load() }
    else toast(d.message || '保存失败', 'error')
  }

  const doDelete = async () => {
    const d = await subsDeleteCategory(confirmDel.id)
    setConfirmDel(null)
    if (d.success) { toast('删除成功'); load() } else toast(d.message || '删除失败', 'error')
  }

  const th = 'px-3 py-2 text-left text-xs font-medium text-stone-400'
  const td = 'px-3 py-2.5 text-sm'

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-3">
          <span className="text-xs text-stone-500 dark:text-stone-400">管理会员订阅的分类，如视频、音乐、工具等</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索分类名称"
            className={inputCls + ' w-40 h-8'} />
        </div>
        <button className={btn.primary} onClick={openCreate}>{Icon.plus} 添加分类</button>
      </div>

      <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
              <th className={th + ' w-14 text-center'}>图标</th>
              <th className={th}>名称</th>
              <th className={th}>颜色</th>
              <th className={th}>创建时间</th>
              <th className={th + ' text-right'}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} className="border-b border-black/[0.06] dark:border-white/[0.06] hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
                <td className={td + ' text-center text-[17px]'}>{c.icon || '📦'}</td>
                <td className={td + ' font-medium'}>{c.name}</td>
                <td className={td}>
                  {c.color ? (
                    <span className="inline-flex items-center gap-2">
                      <i className="w-5 h-5 rounded-full border border-white/25 shadow-sm inline-block"
                        style={{ background: dark ? adjustForDark(c.color) : c.color }} />
                      <code className="text-xs text-stone-400">{c.color}</code>
                    </span>
                  ) : <span className="text-stone-400">-</span>}
                </td>
                <td className={td + ' text-stone-400 tabular-nums text-xs'}>
                  {c.created_at ? c.created_at.slice(0, 16).replace('T', ' ') : '-'}
                </td>
                <td className={td}>
                  <div className="flex gap-0.5 justify-end">
                    <button className={btn.ghost} onClick={() => openEdit(c)}>{Icon.edit} 编辑</button>
                    <button className={btn.danger} onClick={() => setConfirmDel(c)}>{Icon.trash}</button>
                  </div>
                </td>
              </tr>
            ))}
            {cats !== null && !filtered.length && (
              <tr><td colSpan={5} className="py-12 text-center text-sm text-stone-400">
                {search ? '未找到匹配的分类' : '暂无分类数据'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)}
        title={editing === 'new' ? '添加分类' : '编辑分类'}
        footer={<>
          <button className={btn.plain} onClick={() => setEditing(null)}>取消</button>
          <button className={btn.primary} disabled={submitting} onClick={submit}>{submitting ? '保存中…' : '保存'}</button>
        </>}>
        <div className="space-y-3">
          <Field label="分类名称">
            <input className={inputCls} maxLength={50} value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="分类名称" />
          </Field>
          <Field label="图标（emoji）">
            <input className={inputCls} maxLength={10} value={form.icon}
              onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} placeholder="如: 🎬, 🎵, 💻" />
          </Field>
          <div>
            <div className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">颜色</div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                  className={'w-7 h-7 rounded-full transition-transform ' + (form.color?.toLowerCase() === c ? 'ring-2 ring-offset-2 ring-amber-500 dark:ring-offset-[#1c1b1a] scale-110' : 'hover:scale-110')}
                  style={{ background: dark ? adjustForDark(c) : c }} title={c} />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : '#1890ff'}
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                className="w-9 h-9 rounded-lg border border-black/[0.08] dark:border-white/[0.1] bg-transparent cursor-pointer" />
              <input className={inputCls + ' w-28 font-mono'} value={form.color}
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />
            </div>
          </div>
        </div>
      </Modal>

      {confirmDel && (
        <Confirm danger text={`确定删除分类「${confirmDel.name}」吗？若该分类下仍有会员则无法删除。`}
          onOk={doDelete} onCancel={() => setConfirmDel(null)} />
      )}
    </div>
  )
}

// ─── 会员分布 ─────────────────────────────────────────────

function DistributionTab({ dark, toast }) {
  const navigate = useNavigate()
  const [cats, setCats] = useState([])
  const [members, setMembers] = useState(null)

  useEffect(() => {
    subsCategories().then(d => d.success && setCats(d.data))
    subsMembers({ page: 1, page_size: 1000 }).then(d => d.success && setMembers(d.data.items))
  }, [])

  const counts = useMemo(() => {
    const m = new Map()
    let uncategorized = 0
    for (const mem of members || []) {
      if (mem.category_id) m.set(mem.category_id, (m.get(mem.category_id) || 0) + 1)
      else uncategorized++
    }
    return { m, uncategorized }
  }, [members])

  const cards = [
    ...cats.map(c => ({ ...c, count: counts.m.get(c.id) || 0 })),
    { id: -1, name: '未分类', icon: '📦', color: '#78716c', count: counts.uncategorized },
  ]

  return (
    <div>
      <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">查看各分类下的会员分布情况（点击进入对应筛选）</p>
      <div className="grid grid-cols-4 gap-3">
        {cards.map(c => {
          const color = dark ? adjustForDark(c.color) : (c.color || '#d97706')
          return (
            <button key={c.id} onClick={() => navigate(c.id === -1 ? '/subs/members' : `/subs/members?category_id=${c.id}`)}
              className="p-5 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] hover:shadow-md hover:-translate-y-0.5 transition-all text-center">
              <div className="text-[32px] mb-1.5">{c.icon || '📦'}</div>
              <div className="text-[15px] font-medium mb-2">{c.name}</div>
              <span className="inline-flex min-w-[26px] h-6 px-2 rounded-full text-xs text-white items-center justify-center tabular-nums"
                style={{ background: color }}>
                {c.count}
              </span>
              <div className="mt-1.5 text-[11.5px] text-stone-400">个会员</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── 备份 ─────────────────────────────────────────────────

function BackupTab({ toast }) {
  const [stats, setStats] = useState(null)
  const [running, setRunning] = useState(false)

  const load = useCallback(() => {
    subsBackupStats().then(d => d.success && setStats(d.data))
  }, [])
  useEffect(load, [load])

  const run = async () => {
    setRunning(true)
    const d = await subsBackupRun()
    setRunning(false)
    if (d.success) { toast(d.data.status === 'ok' ? `备份完成：${d.data.path}` : d.data.reason || '已跳过') ; load() }
    else toast(d.message || '备份失败', 'error')
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <p className="text-xs text-stone-500 dark:text-stone-400">
          订阅模块每日 02:00 自动备份当前 SQLite 数据库（保留 {stats?.retention_days ?? 90} 天），也可手动触发。
        </p>
        <button className={btn.primary} disabled={running} onClick={run}>
          {Icon.backup} {running ? '备份中…' : '立即备份'}
        </button>
      </div>
      <div className="grid grid-cols-4 gap-3 mb-3">
        <Stat label="备份数" value={stats?.total_count ?? '—'} />
        <Stat label="总大小" value={stats ? `${stats.total_size_mb} MB` : '—'} />
        <Stat label="最新备份" value={stats?.newest_backup?.slice(5, 16) ?? '—'} />
        <Stat label="最旧备份" value={stats?.oldest_backup?.slice(5, 16) ?? '—'} />
      </div>
      <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] overflow-hidden max-h-[320px] overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-white dark:bg-[#171615]">
            <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
              <th className="px-3 py-2 text-left text-xs font-medium text-stone-400">文件</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-stone-400">大小</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-stone-400">时间</th>
            </tr>
          </thead>
          <tbody>
            {(stats?.backups || []).map(b => (
              <tr key={b.name} className="border-b border-black/[0.06] dark:border-white/[0.06] text-sm tabular-nums">
                <td className="px-3 py-2 font-mono text-xs">{b.name}</td>
                <td className="px-3 py-2 text-right">{b.size_mb >= 1 ? `${b.size_mb} MB` : `${(b.size / 1024).toFixed(1)} KB`}</td>
                <td className="px-3 py-2 text-right text-stone-400">{b.created_at}</td>
              </tr>
            ))}
            {stats !== null && !stats.backups.length && (
              <tr><td colSpan={3} className="py-10 text-center text-sm text-stone-400">暂无备份</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const Stat = ({ label, value }) => (
  <div className="p-3 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] text-center">
    <div className="text-lg font-semibold tabular-nums">{value}</div>
    <div className="text-[11.5px] text-stone-400 mt-0.5">{label}</div>
  </div>
)

// ─── 主视图 ───────────────────────────────────────────────

const TABS = [
  { key: 'category', label: '分类管理', icon: Icon.settings },
  { key: 'distribution', label: '会员分布', icon: Icon.members },
  { key: 'backup', label: '备份', icon: Icon.backup },
]

export default function SettingsView({ dark }) {
  const [sp] = useSearchParams()
  const tab = TABS.some(t => t.key === sp.get('panel')) ? sp.get('panel') : 'category'
  const [toastMsg, setToastMsg] = useState(null)
  const [toastKind, setToastKind] = useState('')

  const toast = useCallback((msg, kind) => {
    setToastMsg(msg); setToastKind(kind || '')
    setTimeout(() => setToastMsg(null), 2200)
  }, [])

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">设置</h2>
      <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5">
        <h2 className="text-base font-semibold mb-6">{TABS.find(t => t.key === tab)?.label}</h2>
        {tab === 'category' && <CategoryTab dark={dark} toast={toast} />}
        {tab === 'distribution' && <DistributionTab dark={dark} toast={toast} />}
        {tab === 'backup' && <BackupTab toast={toast} />}
      </div>
      <Toast msg={toastMsg} kind={toastKind} />
    </div>
  )
}
