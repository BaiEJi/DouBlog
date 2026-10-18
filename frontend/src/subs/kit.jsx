/**
 * 订阅模块公共小件：格式化（价格/剩余天数/周期） / 状态与分类标签 /
 * 弹层（Modal/Confirm）/ 日期输入 / 图标 / 暗色下用户自配颜色的提亮。
 */
import { useCallback, useEffect, useRef } from 'react'

// ─── 格式化 ───────────────────────────────────────────────

const CURRENCY_SYMBOLS = { CNY: '¥', USD: '$', EUR: '€', GBP: '£', JPY: '¥' }

export const fmtPrice = (price, currency = 'CNY') =>
  `${CURRENCY_SYMBOLS[currency] || (currency ? currency + ' ' : '¥')}${Number(price ?? 0).toFixed(2)}`

export const daysRemaining = end => {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const e = new Date(end + 'T00:00:00')
  return Math.round((e - today) / 86400000)
}

export const cycleLabel = (cycle, customDays) => ({
  monthly: '月付', quarterly: '季付', yearly: '年付', custom: customDays ? `${customDays}天` : '自定义',
}[cycle] || cycle)

export const fmtDuration = days => {
  if (days >= 365) {
    const y = Math.floor(days / 365), r = days % 365
    return r > 0 ? `${y}年${r}天` : `${y}年`
  }
  if (days >= 30) {
    const m = Math.floor(days / 30), r = days % 30
    return r > 0 ? `${m}个月${r}天` : `${m}个月`
  }
  return `${days}天`
}

export const BILLING_CYCLE_OPTIONS = [
  { value: 'monthly', label: '月付' },
  { value: 'quarterly', label: '季付' },
  { value: 'yearly', label: '年付' },
  { value: 'custom', label: '自定义' },
]

export const CURRENCY_OPTIONS = [
  { value: 'CNY', label: 'CNY (¥)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'GBP', label: 'GBP (£)' },
  { value: 'JPY', label: 'JPY (¥)' },
]

export const toDateInput = d => d.toISOString().slice(0, 10)

// ─── 暗色下自配颜色提亮（分类 hex 颜色在深底上的可读性）──

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

function luminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 暗色背景下过暗的颜色按比例向白色混合，达到可读对比度 */
export function adjustForDark(hex) {
  if (!hex || !/^#[0-9a-fA-F]{3,6}$/.test(hex)) return hex
  let rgb = hexToRgb(hex)
  const DARK_BG_L = 0.011   // #100f0e
  let guard = 0
  while (luminance(rgb) < 0.18 && guard++ < 24) {
    rgb = rgb.map(v => v + Math.max(1, Math.round((255 - v) * 0.12)))
  }
  const contrast = (luminance(rgb) + 0.05) / (DARK_BG_L + 0.05)
  if (contrast < 3) rgb = rgb.map(v => v + Math.round((255 - v) * 0.25))
  return '#' + rgb.map(v => Math.min(255, Math.round(v)).toString(16).padStart(2, '0')).join('')
}

// ─── 标签 ────────────────────────────────────────────────

export function StatusTag({ status, end, reminderDays = 7, small }) {
  const days = daysRemaining(end)
  const kind = status === 'expired' || days < 0 ? 'expired'
    : days <= reminderDays ? 'expiring' : 'active'
  const cls = {
    active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    expiring: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/25',
    expired: 'bg-black/[0.04] dark:bg-white/[0.06] text-stone-400 border-black/[0.06] dark:border-white/[0.08]',
  }[kind]
  const label = kind === 'expired' ? `已过期${Math.abs(days)}天`
    : days === 0 ? '今天到期' : `${days}天后到期`
  return (
    <span className={'inline-flex items-center rounded-full border tabular-nums whitespace-nowrap ' +
      (small ? 'px-1.5 h-5 text-[11px]' : 'px-2 h-6 text-xs') + ' ' + cls}>
      {label}
    </span>
  )
}

export function CategoryTag({ category, dark }) {
  if (!category) return <span className="text-stone-400">-</span>
  const color = dark ? (adjustForDark(category.color) || category.color) : (category.color || '#d97706')
  return (
    <span className="inline-flex items-center gap-1 px-2 h-6 rounded-full text-xs whitespace-nowrap border"
      style={{ color, borderColor: color + '55', background: color + '14' }}>
      {category.icon && <span>{category.icon}</span>}{category.name}
    </span>
  )
}

// ─── 弹层 ────────────────────────────────────────────────

export function Modal({ title, open, onClose, children, footer, width = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return
    const onKey = e => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}>
      <div className={`w-full ${width} my-4 max-h-[calc(100vh-32px)] flex flex-col rounded-2xl bg-white dark:bg-[#1c1b1a] shadow-xl animate-dropdown`}
        role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        onClick={e => e.stopPropagation()}>
        <div className="shrink-0 flex items-center justify-between px-5 h-14 border-b border-black/[0.05] dark:border-white/[0.07]">
          <div className="text-base font-semibold">{title}</div>
          <button onClick={onClose} aria-label="关闭弹窗"
            className="w-7 h-7 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="shrink-0 flex gap-2 justify-end px-5 py-3.5 border-t border-black/[0.05] dark:border-white/[0.07]">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function Confirm({ text, onOk, onCancel, danger }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="w-full max-w-xs p-5 rounded-2xl bg-white dark:bg-[#1c1b1a] shadow-xl animate-dropdown"
        onClick={e => e.stopPropagation()}>
        <p className="text-sm leading-relaxed mb-4">{text}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-stone-500 hover:bg-black/5 dark:hover:bg-white/10">取消</button>
          <button onClick={onOk}
            className={'px-4 py-2 rounded-lg text-sm font-medium text-white ' + (danger ? 'bg-red-500 hover:bg-red-600' : 'bg-stone-900 dark:bg-stone-100 dark:text-stone-900')}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}

export function Toast({ msg, kind }) {
  if (!msg) return null
  return (
    <div className={'fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] rounded-lg px-3 py-2 flex items-center text-[13px] shadow-lg animate-fade-in ' +
      (kind === 'error'
        ? 'bg-red-500 text-white'
        : 'bg-stone-800 dark:bg-stone-100 dark:text-stone-900 text-white')}>
      {msg}
    </div>
  )
}

// ─── 表单小件 ────────────────────────────────────────────

export const inputCls = 'w-full px-3 h-9 rounded-lg text-sm bg-white dark:bg-white/[0.04] ' +
  'border border-black/10 dark:border-white/10 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors'

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <div className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">{label}{hint && <span className="ml-1 text-stone-300 dark:text-stone-600">({hint})</span>}</div>
      {children}
    </label>
  )
}

export const btn = {
  primary: 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50',
  plain: 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50',
  ghost: 'inline-flex items-center gap-1 px-2 h-7 rounded-lg text-xs text-stone-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors disabled:opacity-40',
  danger: 'inline-flex items-center gap-1 px-2 h-7 rounded-lg text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors',
}

/**
 * 日期输入：原生 date 控件只有点击右侧日历小图标才会弹选择器（点击日期文本无效），
 * 这里在输入框任意位置被点击时主动 showPicker()，保证整块可点弹出日历。
 * 用捕获阶段调用：showPicker 先于原生图标处理器执行，原生两处「已打开则跳过」的
 * 守卫会挡住重复弹开，点击图标与点击文本都只开一次。
 */
export function DateInput({ value, onChange, className = inputCls, ...rest }) {
  const ref = useRef(null)
  const openPicker = useCallback(() => {
    const el = ref.current
    if (typeof el?.showPicker === 'function') {
      try { el.showPicker() } catch { /* 无用户手势/不可渲染时忽略，交由原生行为兜底 */ }
    }
  }, [])
  return (
    <input ref={ref} type="date" value={value} onChange={onChange}
      onClickCapture={openPicker} className={className} {...rest} />
  )
}

// ─── 图标 ────────────────────────────────────────────────

const I = (paths, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>
)

export const Icon = {
  dashboard: I(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>),
  members: I(<><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" /><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.6M17.5 14.7c1.6.7 2.6 2 3 4.3" /></>),
  stats: I(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>),
  settings: I(<><circle cx="10" cy="10" r="2.2" /><path d="M10 2.8v2.4M10 14.8v2.4M2.8 10h2.4M14.8 10h2.4M4.9 4.9l1.7 1.7M13.4 13.4l1.7 1.7M15.1 4.9l-1.7 1.7M6.6 13.4l-1.7 1.7" /></>),
  calendar: I(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9.5h18M8 3v3M16 3v3" /></>),
  warning: I(<><path d="M12 3L1.8 20h20.4L12 3z" /><path d="M12 10v4M12 17.2v.1" /></>),
  fire: I(<><path d="M12 2s5 4.5 5 9.5a5 5 0 0 1-10 0c0-2 1-3.8 2.2-5.2C9.6 7.7 11 9 11 10.5 11 8 12 4.5 12 2z" /></>, 14),
  trophy: I(<><path d="M7 4h10v5a5 5 0 0 1-10 0V4z" /><path d="M7 5H4v1.5A3.5 3.5 0 0 0 7.5 10M17 5h3v1.5A3.5 3.5 0 0 1 16.5 10" /><path d="M12 14v3M8.5 20h7M10 17h4l1 3H9l1-3z" /></>, 14),
  plus: I(<path d="M12 5v14M5 12h14" />),
  edit: I(<path d="M4 20h4L20 8l-4-4L4 16v4zM13 7l4 4" />, 13),
  trash: I(<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />, 13),
  refresh: I(<path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6" />, 14),
  back: I(<path d="M15 5l-7 7 7 7" />),
  arrowL: I(<path d="M15 5l-7 7 7 7" />, 15),
  arrowR: I(<path d="M9 5l7 7-7 7" />, 15),
  zoomIn: I(<><circle cx="11" cy="11" r="6.5" /><path d="M21 21l-4.8-4.8M11 8.5v5M8.5 11h5" /></>, 13),
  zoomOut: I(<><circle cx="11" cy="11" r="6.5" /><path d="M21 21l-4.8-4.8M8.5 11h5" /></>, 13),
  eye: I(<><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.6" /></>, 13),
  clock: I(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  timeline: I(<path d="M4 6h16M4 12h10M4 18h13" />),
}
