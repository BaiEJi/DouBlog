/**
 * 会员详情视图：基础信息卡（分类/订阅数/分币种累计/提醒天数/备注）+
 * 订阅记录（表格视图：级别/周期/状态/覆盖日期筛选 + 增删改）与时间轴视图
 * （3m/6m/12m/全部 + 缩放平移 + 今天标线 + 条形详情弹层）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { subsMember, subsCreateSubscription, subsUpdateSubscription, subsDeleteSubscription } from '../api'
import {
  fmtPrice, daysRemaining, cycleLabel, Icon, CategoryTag, StatusTag, Modal, Confirm,
  Field, inputCls, btn, BILLING_CYCLE_OPTIONS, CURRENCY_OPTIONS, adjustForDark, toDateInput, DateInput,
} from '../kit'

// ─── 订阅表单弹窗 ─────────────────────────────────────────

function SubscriptionModal({ open, sub, onSubmit, onClose, loading }) {
  const isNew = !sub
  const [form, setForm] = useState({
    level: '', price: '', currency: 'CNY', billing_cycle: 'monthly', custom_days: '',
    start_date: toDateInput(new Date()), end_date: '', channel: '', notes: '',
  })
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    setErr('')
    if (sub) {
      setForm({
        level: sub.level || '', price: sub.price ?? '', currency: sub.currency || 'CNY',
        billing_cycle: sub.billing_cycle, custom_days: sub.custom_days ?? '',
        start_date: sub.start_date, end_date: sub.end_date, channel: sub.channel || '', notes: sub.notes || '',
      })
    } else {
      const today = new Date()
      const end = new Date(today); end.setMonth(end.getMonth() + 1)
      setForm({
        level: '', price: '', currency: 'CNY', billing_cycle: 'monthly', custom_days: '',
        start_date: toDateInput(today), end_date: toDateInput(end), channel: '', notes: '',
      })
    }
  }, [open, sub])

  // 开始日期变化时按周期自动推算结束日期（自定义周期除外）
  const onStartDate = v => {
    setForm(f => {
      const start = new Date(v + 'T00:00:00')
      let end = f.end_date
      if (f.billing_cycle !== 'custom') {
        const e = new Date(start)
        if (f.billing_cycle === 'monthly') e.setMonth(e.getMonth() + 1)
        else if (f.billing_cycle === 'quarterly') e.setMonth(e.getMonth() + 3)
        else if (f.billing_cycle === 'yearly') e.setFullYear(e.getFullYear() + 1)
        e.setDate(e.getDate() - 1)   // 覆盖整周期（与 CrownFlow 减一天口径一致）
        end = toDateInput(e)
      }
      return { ...f, start_date: v, end_date: end }
    })
  }

  const submit = () => {
    if (form.price === '' || Number(form.price) < 0) { setErr('请输入有效的价格'); return }
    if (!form.start_date || !form.end_date) { setErr('请选择开始与结束日期'); return }
    if (form.start_date > form.end_date) { setErr('结束日期必须晚于开始日期'); return }
    if (form.billing_cycle === 'custom' && (!form.custom_days || Number(form.custom_days) <= 0)) {
      setErr('自定义周期需提供大于 0 的天数'); return
    }
    onSubmit({
      level: form.level || null,
      price: Number(form.price),
      currency: form.currency,
      billing_cycle: form.billing_cycle,
      custom_days: form.billing_cycle === 'custom' ? Number(form.custom_days) : null,
      start_date: form.start_date,
      end_date: form.end_date,
      channel: form.channel || null,
      notes: form.notes || null,
    })
  }

  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl"
      title={sub ? '编辑订阅' : '添加订阅'}
      footer={
        <>
          <button className={btn.plain} onClick={onClose}>取消</button>
          <button className={btn.primary} disabled={loading} onClick={submit}>{loading ? '提交中…' : '保存'}</button>
        </>
      }>
      {err && <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-[13px] flex items-center">{err}</div>}
      <div className="grid grid-cols-3 gap-3">
        <Field label="会员级别">
          <input className={inputCls} value={form.level} maxLength={50}
            onChange={e => setForm(f => ({ ...f, level: e.target.value }))} placeholder="如: 豪华版、家庭版" />
        </Field>
        <Field label="价格">
          <input type="number" min={0} step="0.01" className={inputCls} value={form.price}
            onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="价格" />
        </Field>
        <Field label="币种">
          <select className={inputCls} value={form.currency}
            onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
            {CURRENCY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="计费周期">
          <select className={inputCls} value={form.billing_cycle}
            onChange={e => setForm(f => ({ ...f, billing_cycle: e.target.value }))}>
            {BILLING_CYCLE_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="订阅渠道">
          <input className={inputCls} value={form.channel} maxLength={50}
            onChange={e => setForm(f => ({ ...f, channel: e.target.value }))} placeholder="如: 官方、淘宝、代充" />
        </Field>
        {form.billing_cycle === 'custom' && (
          <Field label="自定义天数">
            <input type="number" min={1} max={365} className={inputCls} value={form.custom_days}
              onChange={e => setForm(f => ({ ...f, custom_days: e.target.value }))} />
          </Field>
        )}
        <Field label="开始日期">
          <DateInput className={inputCls} value={form.start_date} onChange={e => onStartDate(e.target.value)} />
        </Field>
        <Field label="结束日期">
          <DateInput className={inputCls} value={form.end_date}
            min={form.start_date}
            onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="备注">
          <textarea rows={2} maxLength={1000} className={inputCls + ' h-auto py-2'} value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="备注信息" />
        </Field>
      </div>
    </Modal>
  )
}

// ─── 时间轴视图 ───────────────────────────────────────────

function TimelineView({ subscriptions, reminderDays, dark, onEdit }) {
  const [range, setRange] = useState('12m')     // 3m | 6m | 12m | all
  const [offset, setOffset] = useState(0)
  const [detail, setDetail] = useState(null)

  const sorted = useMemo(() =>
    [...subscriptions].sort((a, b) => a.start_date.localeCompare(b.start_date)), [subscriptions])

  const months = { '3m': 3, '6m': 6, '12m': 12 }[range]
  const today = new Date()

  const base = useMemo(() => {
    const dates = sorted.flatMap(s => [new Date(s.start_date + 'T00:00:00'), new Date(s.end_date + 'T00:00:00')])
    if (range === 'all') {
      if (!dates.length) {
        const s = new Date(today); s.setMonth(s.getMonth() - 1)
        const e = new Date(today); e.setMonth(e.getMonth() + 1)
        return { s, e }
      }
      const s = new Date(Math.min(...dates)); s.setMonth(s.getMonth() - 1)
      const e = new Date(Math.max(...dates)); e.setMonth(e.getMonth() + 1)
      return { s, e }
    }
    const earliest = dates.length ? new Date(Math.min(...dates)) : today
    const half = Math.floor(months / 2)
    let s
    if (earliest < new Date(new Date(today).setMonth(today.getMonth() - half))) {
      s = new Date(earliest); s.setMonth(s.getMonth() - 1)
    } else {
      s = new Date(today); s.setMonth(today.getMonth() - half)
    }
    const e = new Date(s); e.setMonth(e.getMonth() + months)
    return { s, e }
  }, [sorted, range])

  const view = useMemo(() => {
    if (range === 'all' || offset === 0) return base
    const s = new Date(base.s), e = new Date(base.e)
    const shift = offset * Math.max(1, Math.floor(months / 2))
    s.setMonth(s.getMonth() + shift); e.setMonth(e.getMonth() + shift)
    return { s, e }
  }, [base, offset, range, months])

  const totalDays = Math.max(1, (view.e - view.s) / 86400000)
  const pct = d => Math.max(0, Math.min(100, ((d - view.s) / 86400000 / totalDays) * 100))

  const monthLabels = useMemo(() => {
    const out = []
    const c = new Date(view.s.getFullYear(), view.s.getMonth(), 1)
    const end = new Date(view.e.getFullYear(), view.e.getMonth(), 1)
    while (c <= end) { out.push(new Date(c)); c.setMonth(c.getMonth() + 1) }
    return out
  }, [view])

  const barColor = sub => {
    const d = daysRemaining(sub.end_date)
    if (d < 0) return dark ? '#57534e' : '#d6d3d1'
    if (d <= reminderDays) return dark ? adjustForDark('#f59e0b') : '#f59e0b'
    return dark ? adjustForDark('#10b981') : '#10b981'
  }

  const todayPct = pct(today)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        <span className="text-stone-400">时间范围：</span>
        <div className="flex rounded-xl border border-black/[0.08] dark:border-white/[0.1] overflow-hidden">
          {[['3m', '3个月'], ['6m', '6个月'], ['12m', '12个月'], ['all', '全部']].map(([k, label]) => (
            <button key={k} onClick={() => { setRange(k); setOffset(0) }}
              className={'px-2.5 h-7 transition-colors ' + (range === k ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'text-stone-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]')}>
              {label}
            </button>
          ))}
        </div>
        <button className={btn.ghost} disabled={range === '3m'} onClick={() => { setRange(r => ({ '12m': '6m', '6m': '3m', all: '12m' }[r] || r)); setOffset(0) }}>{Icon.zoomIn}</button>
        <button className={btn.ghost} disabled={range === 'all'} onClick={() => { setRange(r => ({ '3m': '6m', '6m': '12m', '12m': 'all' }[r] || r)); setOffset(0) }}>{Icon.zoomOut}</button>
        <button className={btn.ghost} disabled={range === 'all'} onClick={() => setOffset(o => o - 1)}>{Icon.arrowL}</button>
        <button className={btn.ghost} disabled={range === 'all'} onClick={() => setOffset(o => o + 1)}>{Icon.arrowR}</button>
        {offset !== 0 && range !== 'all' && (
          <button className={btn.ghost + ' !h-7'} onClick={() => setOffset(0)}>回到当前</button>
        )}
      </div>

      <div className="relative overflow-hidden pl-[110px]">
        {/* 月份刻度 */}
        <div className="flex border-b border-black/[0.06] dark:border-white/[0.06] mb-2 pb-1">
          {monthLabels.map(m => (
            <div key={m.toISOString().slice(0, 7)}
              className="flex-1 text-center text-[11px] text-stone-400 tabular-nums">
              {m.toISOString().slice(0, 7)}
            </div>
          ))}
        </div>

        {/* 今天标线 */}
        {todayPct >= 0 && todayPct <= 100 && (
          <div className="absolute top-[26px] bottom-0 w-px bg-sky-500 z-10" style={{ left: `calc(110px + ${todayPct}% * ${(1 - 110 / 100).toFixed(3)})` }}>
            <span className="absolute -top-4 -left-4 text-[10px] text-sky-500">今天</span>
          </div>
        )}

        {/* 订阅条 */}
        <div>
          {sorted.map(sub => {
            const sp = pct(new Date(sub.start_date + 'T00:00:00'))
            const ep = pct(new Date(sub.end_date + 'T00:00:00'))
            const width = Math.max(1, ep - sp)
            const color = barColor(sub)
            const d = daysRemaining(sub.end_date)
            return (
              <div key={sub.id} className="relative h-8 mb-0.5">
                <div className="absolute left-[-110px] top-2 w-[104px] text-[12px] text-stone-500 dark:text-stone-400 truncate">
                  {sub.level || '标准版'}
                </div>
                <button className="absolute h-6 rounded-md flex items-center justify-center text-[10px] text-white overflow-hidden hover:brightness-110 transition-all"
                  style={{
                    left: `${sp}%`, width: `${width}%`, minWidth: 18, background: color,
                  }}
                  onClick={() => setDetail(sub)}
                  title={`${sub.start_date} ~ ${sub.end_date}`}>
                  {width > 16 && fmtPrice(sub.price, sub.currency)}
                </button>
                <span className="absolute right-1 top-2 text-[10.5px] text-stone-400 tabular-nums pointer-events-none">
                  {d < 0 ? `已过期${Math.abs(d)}天` : d === 0 ? '今天到期' : `${d}天后到期`}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* 详情弹层 */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title="订阅详情"
        footer={<>
          {detail && <button className={btn.plain} onClick={() => { onEdit(detail); setDetail(null) }}>{Icon.edit} 编辑</button>}
          <button className={btn.plain} onClick={() => setDetail(null)}>关闭</button>
        </>}>
        {detail && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
            <Row k="级别" v={detail.level || '标准版'} />
            <Row k="价格" v={fmtPrice(detail.price, detail.currency)} />
            <Row k="计费周期" v={cycleLabel(detail.billing_cycle, detail.custom_days)} />
            <Row k="订阅渠道" v={detail.channel || '-'} />
            <Row k="有效期" v={`${detail.start_date} ~ ${detail.end_date}`} />
            <Row k="状态" v={daysRemaining(detail.end_date) < 0
              ? `已过期${Math.abs(daysRemaining(detail.end_date))}天`
              : daysRemaining(detail.end_date) === 0 ? '今天到期'
                : `${daysRemaining(detail.end_date)}天后到期`} />
            <Row k="日均价格" v={fmtPrice(detail.price / cycleDays(detail), detail.currency)} />
            {detail.notes && <Row k="备注" v={detail.notes} />}
          </div>
        )}
      </Modal>
    </div>
  )
}

function cycleDays(sub) {
  if (sub.billing_cycle === 'custom') return sub.custom_days || 30
  if (sub.billing_cycle === 'quarterly') return 90
  if (sub.billing_cycle === 'yearly') return 365
  return 30
}

const Row = ({ k, v }) => (
  <div className="flex gap-2">
    <span className="text-stone-400 shrink-0">{k}：</span>
    <span className="text-stone-700 dark:text-stone-200">{v}</span>
  </div>
)

// ─── 主视图 ───────────────────────────────────────────────

export default function MemberDetailView({ dark, toast }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [member, setMember] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState('table')
  const [editing, setEditing] = useState(null)    // null | 'new' | sub
  const [confirmDel, setConfirmDel] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // 筛选
  const [fLevel, setFLevel] = useState('')
  const [fCycle, setFCycle] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fDate, setFDate] = useState('')

  const load = useCallback(() => {
    subsMember(id).then(d => {
      if (d.success) { setMember(d.data); setNotFound(false) }
      else setNotFound(true)
    })
  }, [id])
  useEffect(load, [load])

  const subs = member?.subscriptions || []

  const filtered = useMemo(() => subs.filter(s => {
    if (fLevel && s.level !== fLevel) return false
    if (fCycle && s.billing_cycle !== fCycle) return false
    if (fStatus) {
      const d = daysRemaining(s.end_date)
      const expired = d < 0
      const expiring = !expired && d <= member.reminder_days
      if (fStatus === 'active' && (expired || expiring)) return false
      if (fStatus === 'expiring' && !expiring) return false
      if (fStatus === 'expired' && !expired) return false
    }
    if (fDate && !(s.start_date <= fDate && s.end_date >= fDate)) return false
    return true
  }), [subs, fLevel, fCycle, fStatus, fDate, member])

  const levelOptions = useMemo(() =>
    [...new Set(subs.map(s => s.level).filter(Boolean))], [subs])

  const spendingByCurrency = useMemo(() => {
    const m = {}
    for (const s of subs) m[s.currency || 'CNY'] = (m[s.currency || 'CNY'] || 0) + s.price
    return m
  }, [subs])

  const submitSub = async payload => {
    setSubmitting(true)
    const d = editing === 'new'
      ? await subsCreateSubscription(member.id, payload)
      : await subsUpdateSubscription(editing.id, payload)
    setSubmitting(false)
    if (d.success) { setEditing(null); toast('保存成功'); load() }
    else toast(d.message || '保存失败', 'error')
  }

  const doDelete = async () => {
    const d = await subsDeleteSubscription(confirmDel.id)
    setConfirmDel(null)
    if (d.success) { toast('删除成功'); load() } else toast(d.message || '删除失败', 'error')
  }

  const hasFilters = fLevel || fCycle || fStatus || fDate

  if (notFound) {
    return (
      <div className="py-20 text-center space-y-4">
        <p className="text-sm text-stone-400">会员不存在</p>
        <button className={btn.plain} onClick={() => navigate('/subs/members')}>返回会员列表</button>
      </div>
    )
  }
  if (!member) return <div className="py-20 text-center text-sm text-stone-400">加载中…</div>

  const th = 'px-3 py-2 text-left text-xs font-medium text-stone-400 whitespace-nowrap'
  const td = 'px-3 py-2.5 text-sm'

  return (
    <div className="space-y-4">
      {/* 标题行 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <button className={btn.plain} onClick={() => navigate('/subs/members')}>{Icon.back} 返回</button>
          <h2 className="text-base font-semibold">{member.name}</h2>
          <StatusTag status={member.status} end={member.latest_subscription?.end_date} reminderDays={member.reminder_days} />
        </div>
        <button className={btn.plain} onClick={load}>{Icon.refresh} 刷新</button>
      </div>

      {/* 基础信息卡 */}
      <div className="p-5 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] flex flex-wrap gap-x-8 gap-y-2.5 items-center text-sm">
        <div className="flex items-center gap-2">
          <span className="text-stone-400">分类：</span>
          {member.category ? <CategoryTag category={member.category} dark={dark} /> : <span className="text-stone-400">未分类</span>}
        </div>
        <div><span className="text-stone-400">订阅数：</span><b className="tabular-nums">{member.subscription_count}</b></div>
        <div>
          <span className="text-stone-400">累计花费：</span>
          <b className="text-red-600 dark:text-red-400 tabular-nums">
            {Object.entries(spendingByCurrency).map(([cur, amt]) => fmtPrice(amt, cur)).join(' + ') || '¥0.00'}
          </b>
        </div>
        <div><span className="text-stone-400">提前提醒：</span><b className="tabular-nums">{member.reminder_days} 天</b></div>
        {member.notes && <div className="basis-full"><span className="text-stone-400">备注：</span>{member.notes}</div>}
      </div>

      {/* 订阅记录 */}
      <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] overflow-hidden">
        <div className="flex items-center justify-between px-4 h-12 border-b border-black/[0.05] dark:border-white/[0.06]">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {Icon.clock} 订阅记录
            <span className="text-xs font-normal text-stone-400 tabular-nums">({filtered.length}/{subs.length})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex rounded-xl border border-black/[0.08] dark:border-white/[0.1] overflow-hidden text-xs">
              <button onClick={() => setTab('table')}
                className={'px-2.5 h-7 flex items-center gap-1 transition-colors ' + (tab === 'table' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'text-stone-400 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]')}>
                {Icon.members} 表格
              </button>
              <button onClick={() => setTab('timeline')}
                className={'px-2.5 h-7 flex items-center gap-1 transition-colors ' + (tab === 'timeline' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'text-stone-400 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]')}>
                {Icon.timeline} 时间轴
              </button>
            </div>
            {hasFilters && tab === 'table' && (
              <button className={btn.ghost} onClick={() => { setFLevel(''); setFCycle(''); setFStatus(''); setFDate('') }}>清除筛选</button>
            )}
            <button className={btn.primary} onClick={() => setEditing('new')}>{Icon.plus} 添加订阅</button>
          </div>
        </div>

        <div className="p-4">
          {tab === 'table' ? (
            <>
              {/* 筛选 */}
              <div className="flex flex-wrap gap-2 mb-3">
                <div className="w-28">
                  <select value={fLevel} onChange={e => setFLevel(e.target.value)} className={inputCls + ' h-8'}>
                    <option value="">全部级别</option>
                    {levelOptions.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div className="w-26">
                  <select value={fCycle} onChange={e => setFCycle(e.target.value)} className={inputCls + ' h-8'}>
                    <option value="">全部周期</option>
                    {BILLING_CYCLE_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div className="w-28">
                  <select value={fStatus} onChange={e => setFStatus(e.target.value)} className={inputCls + ' h-8'}>
                    <option value="">全部状态</option>
                    <option value="active">正常</option>
                    <option value="expiring">即将到期</option>
                    <option value="expired">已过期</option>
                  </select>
                </div>
                <div className="w-38">
                  <DateInput value={fDate} onChange={e => setFDate(e.target.value)}
                    title="筛选覆盖该日期的订阅" className={inputCls + ' h-8'} />
                </div>
                {fDate && <button className={btn.ghost} onClick={() => setFDate('')}>✕ 日期</button>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px]">
                  <thead>
                    <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                      <th className={th}>有效期</th>
                      <th className={th}>价格</th>
                      <th className={th}>计费周期</th>
                      <th className={th}>状态</th>
                      <th className={th}>级别</th>
                      <th className={th}>渠道</th>
                      <th className={th}>备注</th>
                      <th className={th + ' text-right'}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(s => (
                      <tr key={s.id} className="border-b border-black/[0.06] dark:border-white/[0.06] hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
                        <td className={td + ' tabular-nums whitespace-nowrap'}>{s.start_date} ~ {s.end_date}</td>
                        <td className={td + ' tabular-nums'}>{fmtPrice(s.price, s.currency)}</td>
                        <td className={td}>{cycleLabel(s.billing_cycle, s.custom_days)}</td>
                        <td className={td}><StatusTag small status="active" end={s.end_date} reminderDays={member.reminder_days} /></td>
                        <td className={td}>{s.level || <span className="text-stone-400">-</span>}</td>
                        <td className={td}>{s.channel || <span className="text-stone-400">-</span>}</td>
                        <td className={td + ' max-w-[160px] truncate'}>{s.notes || <span className="text-stone-400">-</span>}</td>
                        <td className={td}>
                          <div className="flex gap-0.5 justify-end">
                            <button className={btn.ghost} onClick={() => setEditing(s)}>{Icon.edit} 编辑</button>
                            <button className={btn.danger} onClick={() => setConfirmDel(s)}>{Icon.trash}</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!filtered.length && (
                      <tr><td colSpan={8} className="py-12 text-center text-sm text-stone-400">
                        {hasFilters ? '没有符合条件的订阅记录' : '暂无订阅记录，点击「添加订阅」开始'}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            subs.length
              ? <TimelineView subscriptions={subs} reminderDays={member.reminder_days} dark={dark} onEdit={setEditing} />
              : <div className="py-12 text-center text-sm text-stone-400">暂无订阅记录</div>
          )}
        </div>
      </div>

      <SubscriptionModal open={!!editing} sub={editing === 'new' ? null : editing}
        loading={submitting} onSubmit={submitSub} onClose={() => setEditing(null)} />

      {confirmDel && (
        <Confirm danger text="确定删除该订阅记录吗？此操作不可撤销。"
          onOk={doDelete} onCancel={() => setConfirmDel(null)} />
      )}
    </div>
  )
}
