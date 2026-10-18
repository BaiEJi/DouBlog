/**
 * 会员列表视图：搜索（防抖）/ 分类 / 状态筛选 + 表格与卡片双视图（本地记忆）+
 * 分页 + 新建/编辑会员弹窗 + 删除确认。点击会员进详情页。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { subsMembers, subsCreateMember, subsUpdateMember, subsDeleteMember, subsCategories } from '../api'
import {
  fmtPrice, daysRemaining, Icon, CategoryTag, StatusTag, Modal, Confirm,
  Field, inputCls, btn, adjustForDark,
} from '../kit'

function MemberCardItem({ m, dark, onGo, onEdit, onDelete }) {
  const sub = m.latest_subscription
  return (
    <div className="p-5 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer flex flex-col"
      onClick={() => onGo(m.id)}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[15px] font-semibold truncate">{m.name}</span>
        </div>
        <StatusTag small status={m.status} end={sub?.end_date} reminderDays={m.reminder_days} />
      </div>
      <div className="mb-2"><CategoryTag category={m.category} dark={dark} /></div>
      {sub ? (
        <div className="text-xs text-stone-500 dark:text-stone-400 tabular-nums">
          {sub.level || '标准版'} · {fmtPrice(sub.price, sub.currency)} · {daysRemaining(sub.end_date) < 0
            ? `已过期${Math.abs(daysRemaining(sub.end_date))}天` : `${daysRemaining(sub.end_date)}天后到期`}
        </div>
      ) : (
        <div className="text-xs text-stone-400">无订阅记录</div>
      )}
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-black/[0.05] dark:border-white/[0.06]">
        <div className="text-xs text-stone-400 tabular-nums">
          {m.subscription_count} 次订阅 · 累计 {fmtPrice(m.total_spending)}
        </div>
        <div className="flex gap-0.5" onClick={e => e.stopPropagation()}>
          <button className={btn.ghost} onClick={() => onEdit(m)}>{Icon.edit} 编辑</button>
          <button className={btn.danger} onClick={() => onDelete(m)}>{Icon.trash}</button>
        </div>
      </div>
    </div>
  )
}

export default function MembersView({ dark, toast }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [items, setItems] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(Number(localStorage.getItem('subs-members-page-size')) || 10)
  const [viewMode, setViewMode] = useState(localStorage.getItem('subs-members-view') || 'table')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filters, setFilters] = useState(() => {
    const cid = searchParams.get('category_id')
    return { category_id: cid ? Number(cid) : undefined, status: 'active' }
  })
  const [categories, setCategories] = useState([])

  const [editing, setEditing] = useState(null)        // null | 'new' | member
  const [confirmDel, setConfirmDel] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // 搜索防抖
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(() => {
    const params = { page, page_size: pageSize, ...filters }
    if (debouncedSearch) params.keyword = debouncedSearch
    subsMembers(params).then(d => {
      if (d.success) { setItems(d.data.items); setTotal(d.data.total) }
    })
  }, [page, pageSize, filters, debouncedSearch])
  useEffect(load, [load])

  useEffect(() => {
    subsCategories().then(d => d.success && setCategories(d.data))
  }, [])

  const setView = v => { setViewMode(v); localStorage.setItem('subs-members-view', v) }
  const setPsz = v => { setPageSize(v); localStorage.setItem('subs-members-page-size', v); setPage(1) }

  const hasFilters = Object.values(filters).some(Boolean) || search.length > 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // ── 表单 ──
  const [form, setForm] = useState({ name: '', category_id: '', reminder_days: 7, notes: '' })
  const openCreate = () => { setEditing('new'); setForm({ name: '', category_id: '', reminder_days: 7, notes: '' }) }
  const openEdit = m => {
    setEditing(m)
    setForm({ name: m.name, category_id: m.category_id || '', reminder_days: m.reminder_days ?? 7, notes: m.notes || '' })
  }

  const submit = async () => {
    if (!form.name.trim()) { toast('请输入会员名称', 'error'); return }
    setSubmitting(true)
    const payload = {
      name: form.name.trim(),
      category_id: form.category_id || null,
      reminder_days: Number(form.reminder_days) || 0,
      notes: form.notes || null,
    }
    const d = editing === 'new'
      ? await subsCreateMember(payload)
      : await subsUpdateMember(editing.id, payload)
    setSubmitting(false)
    if (d.success) { setEditing(null); toast(editing === 'new' ? '创建成功' : '更新成功'); load() }
    else toast(d.message || '操作失败', 'error')
  }

  const doDelete = async m => {
    const d = await subsDeleteMember(m.id)
    setConfirmDel(null)
    if (d.success) { toast('删除成功'); load() } else toast(d.message || '删除失败', 'error')
  }

  const th = 'px-3 py-2 text-left text-xs font-medium text-stone-400 whitespace-nowrap'
  const td = 'px-3 py-2.5 text-sm'

  const rowsEl = useMemo(() => (items || []).map(m => {
    const sub = m.latest_subscription
    return (
      <tr key={m.id} className="border-b border-black/[0.06] dark:border-white/[0.06] hover:bg-black/[0.02] dark:hover:bg-white/[0.03] cursor-pointer transition-colors"
        onClick={() => navigate(`/subs/members/${m.id}`)}>
        <td className={td}>
          <span className="font-medium hover:text-amber-600 dark:hover:text-amber-400 transition-colors">{m.name}</span>
        </td>
        <td className={td}><CategoryTag category={m.category} dark={dark} /></td>
        <td className={td}>
          {sub ? (
            <div className="leading-tight">
              <div>{sub.level || '标准版'}</div>
              <div className="text-xs text-stone-400 tabular-nums">
                {fmtPrice(sub.price, sub.currency)} · {daysRemaining(sub.end_date) < 0
                  ? `已过期${Math.abs(daysRemaining(sub.end_date))}天`
                  : `${daysRemaining(sub.end_date)}天后到期`}
              </div>
            </div>
          ) : <span className="text-stone-400">无订阅</span>}
        </td>
        <td className={td + ' text-center tabular-nums'}>{m.subscription_count}</td>
        <td className={td + ' tabular-nums'}>{fmtPrice(m.total_spending)}</td>
        <td className={td}><StatusTag small status={m.status} end={sub?.end_date} reminderDays={m.reminder_days} /></td>
        <td className={td}>
          <div className="flex gap-0.5" onClick={e => e.stopPropagation()}>
            <button className={btn.ghost} onClick={() => navigate(`/subs/members/${m.id}`)}>{Icon.eye} 详情</button>
            <button className={btn.ghost} onClick={() => openEdit(m)}>{Icon.edit} 编辑</button>
            <button className={btn.danger} onClick={() => setConfirmDel(m)}>{Icon.trash}</button>
          </div>
        </td>
      </tr>
    )
  }), [items, dark, navigate])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold">会员管理</h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-black/[0.08] dark:border-white/[0.1] overflow-hidden">
            <button onClick={() => setView('table')}
              className={'px-2.5 h-8 text-[12px] flex items-center gap-1 transition-colors ' + (viewMode === 'table' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'text-stone-400 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]')}>
              {Icon.members} 表格
            </button>
            <button onClick={() => setView('card')}
              className={'px-2.5 h-8 text-[12px] flex items-center gap-1 transition-colors ' + (viewMode === 'card' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'text-stone-400 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.5" opacity=".9" /><rect x="13" y="3" width="8" height="8" rx="1.5" opacity=".55" /><rect x="3" y="13" width="8" height="8" rx="1.5" opacity=".55" /><rect x="13" y="13" width="8" height="8" rx="1.5" opacity=".9" /></svg> 卡片
            </button>
          </div>
          <button className={btn.plain} onClick={load}>{Icon.refresh} 刷新</button>
          {hasFilters && (
            <button className={btn.plain} onClick={() => { setFilters({}); setSearch(''); setPage(1) }}>清除筛选</button>
          )}
          <button className={btn.primary} onClick={openCreate}>{Icon.plus} 添加会员</button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative w-48">
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="搜索会员名称…"
            className={inputCls + ' pl-7'} />
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="6.5" /><path d="M21 21l-4.8-4.8" strokeLinecap="round" /></svg>
        </div>
        <div className="w-32">
          <select value={filters.category_id ?? ''} className={inputCls}
            onChange={e => { setFilters(f => ({ ...f, category_id: e.target.value ? Number(e.target.value) : undefined })); setPage(1) }}>
            <option value="">全部分类</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>
        <div className="w-28">
          <select value={filters.status ?? ''} className={inputCls}
            onChange={e => { setFilters(f => ({ ...f, status: e.target.value || undefined })); setPage(1) }}>
            <option value="">全部状态</option>
            <option value="active">有效</option>
            <option value="expired">已过期</option>
          </select>
        </div>
        <span className="text-xs text-stone-400 tabular-nums">共 {total} 条</span>
      </div>

      {/* 列表 */}
      {items === null ? (
        <div className="py-16 text-center text-sm text-stone-400">加载中…</div>
      ) : viewMode === 'card' ? (
        items.length ? (
          <div className="grid grid-cols-4 gap-3">
            {items.map(m => (
              <MemberCardItem key={m.id} m={m} dark={dark}
                onGo={id => navigate(`/subs/members/${id}`)}
                onEdit={openEdit} onDelete={setConfirmDel} />
            ))}
          </div>
        ) : (
          <div className="py-16 text-center text-sm text-stone-400 border border-dashed border-black/10 dark:border-white/10 rounded-2xl">
            {hasFilters ? '没有符合条件的会员' : '暂无会员数据，点击右上角「添加会员」开始'}
          </div>
        )
      ) : (
        <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] overflow-x-auto">
          <table className="w-full min-w-[880px]">
            <thead>
              <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                <th className={th}>名称</th>
                <th className={th}>分类</th>
                <th className={th}>最新订阅</th>
                <th className={th + ' text-center'}>总订阅数</th>
                <th className={th}>累计花费</th>
                <th className={th}>状态</th>
                <th className={th + ' text-right'}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rowsEl}
              {!items.length && (
                <tr><td colSpan={7} className="py-14 text-center text-sm text-stone-400">
                  {hasFilters ? '没有符合条件的会员' : '暂无会员数据'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页 */}
      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-stone-400">
          <div className="flex items-center gap-2">
            每页
            <select value={pageSize} onChange={e => setPsz(Number(e.target.value))} className="h-7 rounded-lg bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.1] px-1">
              {[10, 20, 50].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            条
          </div>
          <div className="flex items-center gap-1.5">
            <button className={btn.ghost} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
            <span className="tabular-nums px-1">{page} / {totalPages}</span>
            <button className={btn.ghost} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
          </div>
        </div>
      )}

      {/* 会员编辑弹窗 */}
      <Modal open={!!editing} onClose={() => setEditing(null)}
        title={editing === 'new' ? '添加会员' : '编辑会员'}
        footer={
          <>
            <button className={btn.plain} onClick={() => setEditing(null)}>取消</button>
            <button className={btn.primary} disabled={submitting} onClick={submit}>
              {submitting ? '提交中…' : '保存'}
            </button>
          </>
        }>
        <div className="grid grid-cols-2 gap-3">
          <Field label="会员名称">
            <input className={inputCls} value={form.name} maxLength={100}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="如: QQ音乐、Netflix" />
          </Field>
          <Field label="分类">
            <select className={inputCls} value={form.category_id}
              onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
              <option value="">未分类</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </Field>
          <Field label="提前提醒天数" hint="到期前 N 天开始提醒">
            <input type="number" min={0} max={365} className={inputCls} value={form.reminder_days}
              onChange={e => setForm(f => ({ ...f, reminder_days: e.target.value }))} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="备注">
            <textarea rows={2} maxLength={1000} className={inputCls + ' h-auto py-2'} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="备注信息" />
          </Field>
        </div>
      </Modal>

      {confirmDel && (
        <Confirm danger text={`确定删除会员「${confirmDel.name}」吗？将同时删除其所有订阅记录。`}
          onOk={() => doDelete(confirmDel)} onCancel={() => setConfirmDel(null)} />
      )}
    </div>
  )
}
