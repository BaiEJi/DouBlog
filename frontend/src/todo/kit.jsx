/**
 * MyTodo 能力包公共小件：象限元信息与文案 / 日期工具（原生 Date，无 dayjs）/
 * 弹层（Modal/Confirm/Toast）/ 徽章 / 表单档位 / 类别 Hook / 图标。
 * 个性色 indigo——只用于图标底、徽章、主按钮、选中态；其余一律中性 stone。
 */
import { useCallback, useEffect, useState } from 'react'

import { todoCategories, todoSettings } from './api'

// ─── 象限 ───────────────────────────────────────────────────

/** 默认文案可被 设置→象限文案 覆盖（label=主文案，subtitle=行动建议） */
export const QUADRANT_META = [
  { quadrant: 1, color: '#ef4444', text: 'text-red-600 dark:text-red-400', short: 'Q1', label: '重要紧急', subtitle: '立即做', icon: '🔥' },
  { quadrant: 2, color: '#6366f1', text: 'text-indigo-600 dark:text-indigo-400', short: 'Q2', label: '重要不紧急', subtitle: '计划做', icon: '🌱' },
  { quadrant: 3, color: '#f59e0b', text: 'text-amber-600 dark:text-amber-400', short: 'Q3', label: '紧急不重要', subtitle: '委派·批量', icon: '⚡' },
  { quadrant: 4, color: '#94a3b8', text: 'text-stone-500 dark:text-stone-400', short: 'Q4', label: '不紧急不重要', subtitle: '考虑删除', icon: '💭' },
]

/** 看板/选择器的视觉排列：右上最重要(Q1)，左下最不重要(Q4) */
export const QUADRANT_DISPLAY_ORDER = [2, 1, 4, 3]

export const quadrantMeta = q => QUADRANT_META.find(m => m.quadrant === Number(q)) || QUADRANT_META[3]

export const flagsForQuadrant = q => ({
  is_important: Number(q) === 1 || Number(q) === 2,
  is_urgent: Number(q) === 1 || Number(q) === 3,
})

/** 拉取设置中的象限文案覆盖（模块级缓存，全页只请求一次；设置保存后调 invalidateQuadrantText 失效） */
let quadrantTextCache = null
export function invalidateQuadrantText() { quadrantTextCache = null }
export function useQuadrantText() {
  const [text, setText] = useState(quadrantTextCache)
  useEffect(() => {
    if (quadrantTextCache) return
    let alive = true
    todoSettings()
      .then(s => {
        quadrantTextCache = { labels: s.quadrant_labels || {}, subtitles: s.quadrant_subtitles || {} }
        if (alive) setText(quadrantTextCache)
      })
      .catch(() => { /* 读取失败用默认文案 */ })
    return () => { alive = false }
  }, [])
  const labelOf = q => text?.labels?.[`q${q}`] || quadrantMeta(q).label
  const subtitleOf = q => text?.subtitles?.[`q${q}`] || quadrantMeta(q).subtitle
  return { labels: labelOf, subtitles: subtitleOf }
}

// ─── 日期工具（原生 Date，格式一律 YYYY-MM-DD 字符串） ─────

export const pad2 = n => String(n).padStart(2, '0')
export const fmtDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
export const todayStr = () => fmtDate(new Date())
export const parseDate = s => {
  const [y, m, d] = String(s).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
export const isValidDateStr = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1)
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()
/** 周一=0 … 周日=6 */
export const weekdayIndex = d => (d.getDay() + 6) % 7
export const startOfWeek = d => addDays(d, -weekdayIndex(d))
export const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
export const WEEKDAY_OPTIONS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
export const WEEKDAY_CN = d => '周' + '日一二三四五六'[d.getDay()]

/** 以周一为一周开始的月网格矩阵（6 行 × 7 列，月外为 null） */
export function monthMatrix(anchor) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const offset = weekdayIndex(first)
  const total = daysInMonth(anchor.getFullYear(), anchor.getMonth())
  const cells = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = 1; d <= total; d++) cells.push(new Date(anchor.getFullYear(), anchor.getMonth(), d))
  while (cells.length % 7 !== 0) cells.push(null)
  const rows = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  return rows
}

/** 后端 ISO 时间串（本地时间）→ "HH:MM" / "MM-DD HH:MM" */
export const hmOf = iso => (iso && iso.length >= 16 ? iso.slice(11, 16) : '--')
export const mdhmOf = iso => (iso && iso.length >= 16 ? `${iso.slice(5, 10).replace('-', '/')} ${iso.slice(11, 16)}` : '--')

// ─── 暗色下自配颜色提亮（类别 hex 色在深底上的可读性） ──────

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

// ─── 徽章 ───────────────────────────────────────────────────

export function QuadrantBadge({ quadrant, label, small }) {
  const m = quadrantMeta(quadrant)
  return (
    <span className={'inline-flex items-center gap-1 rounded-full border whitespace-nowrap ' +
      (small ? 'px-1.5 h-5 text-[10.5px]' : 'px-2 h-6 text-[11px]') +
      ' border-current/20 ' + m.text}
      style={{ background: m.color + '14', borderColor: m.color + '40' }}>
      {m.short} {label || m.label}
    </span>
  )
}

export function CategoryBadge({ name, color, icon, small }) {
  if (!name) return <span className="text-stone-400 text-xs">—</span>
  return (
    <span className={'inline-flex items-center gap-1 rounded-full border whitespace-nowrap ' +
      (small ? 'px-1.5 h-5 text-[10.5px]' : 'px-2 h-6 text-[11px]')}
      style={{ color: color || '#78716c', borderColor: (color || '#78716c') + '55', background: (color || '#78716c') + '14' }}>
      {icon && <span>{icon}</span>}{name}
    </span>
  )
}

/** 迁移来源小标签（橙）：⟲ 来自 X · 拖延 N 天 · 迁移×N */
export function MigrateTag({ task }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-2 h-5 text-[10.5px] whitespace-nowrap
      bg-orange-500/10 text-orange-700 dark:text-orange-300">
      ⟲ 来自 {task.last_migrated_from || task.original_date || '?'}
      {task.days_procrastinated != null ? ` · 拖延 ${task.days_procrastinated} 天` : ''} · 迁移×{task.migrated_count}
    </span>
  )
}

/** 彩色圆点（象限/类别） */
export const Dot = ({ color, size = 8 }) => (
  <span className="inline-block rounded-full shrink-0" style={{ background: color || '#94a3b8', width: size, height: size }} />
)

// ─── 弹层 ───────────────────────────────────────────────────

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
      <div className={`w-full ${width} my-8 rounded-2xl bg-white dark:bg-[#1c1b1a] shadow-xl animate-dropdown`}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 h-14 border-b border-black/[0.05] dark:border-white/[0.07]">
          <div className="text-base font-semibold truncate">{title}</div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex gap-2 justify-end px-5 py-3.5 border-t border-black/[0.05] dark:border-white/[0.07]">
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
            className={'px-4 py-2 rounded-lg text-sm font-medium text-white ' + (danger ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-500 hover:bg-indigo-600')}>
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

// ─── 表单档位 ───────────────────────────────────────────────

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
  primary: 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50',
  plain: 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50',
  ghost: 'inline-flex items-center gap-1 px-2 h-7 rounded-lg text-xs text-stone-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors disabled:opacity-40',
  danger: 'inline-flex items-center gap-1 px-2 h-7 rounded-lg text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors',
  /** 看板/列表内的小操作按钮 */
  mini: 'inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-xs bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50',
  miniPrimary: 'inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-xs font-medium bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50',
  miniDanger: 'inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-xs text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors',
}

// ─── 通用小件 ───────────────────────────────────────────────

export function Spinner({ text = '加载中…' }) {
  return (
    <div className="py-14 flex items-center justify-center gap-2 text-xs text-stone-400">
      <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>{text}
    </div>
  )
}

export function Empty({ text }) {
  return <div className="py-10 text-center text-xs text-stone-400">{text}</div>
}

/** 数字统计卡（基线：text-lg~xl font-semibold tabular-nums） */
export function StatTile({ title, value, suffix, tone }) {
  return (
    <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-4">
      <div className="text-xs text-stone-500 dark:text-stone-400 mb-1">{title}</div>
      <div className={'text-xl font-semibold tabular-nums ' + (tone || '')}>
        {value}{suffix && <span className="text-xs font-normal text-stone-400 ml-1">{suffix}</span>}
      </div>
    </div>
  )
}

/** 区块卡片 */
export function Card({ title, extra, children, className = '' }) {
  return (
    <section className={'rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5 ' + className}>
      {(title || extra) && (
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-sm font-semibold">{title}</h3>
          {extra}
        </div>
      )}
      {children}
    </section>
  )
}

/** 段选器（antd Segmented 的平替） */
export function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex p-0.5 rounded-lg bg-black/[0.05] dark:bg-white/[0.06]">
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={'px-3 h-7 rounded-md text-xs transition-colors whitespace-nowrap ' +
            (value === o.value
              ? 'bg-white dark:bg-white/[0.12] text-stone-900 dark:text-stone-100 shadow-sm font-medium'
              : 'text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** 开关（antd Switch 平替） */
export function Switch({ checked, onChange, size = 'md' }) {
  const w = size === 'sm' ? 'w-8 h-[18px]' : 'w-10 h-[22px]'
  const k = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4.5 h-4.5'
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={'relative rounded-full transition-colors shrink-0 ' + w + ' ' +
        (checked ? 'bg-indigo-500' : 'bg-black/[0.15] dark:bg-white/[0.2]')}>
      <span className={'absolute top-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-all ' + k +
        ' ' + (size === 'sm'
          ? (checked ? 'left-[16px]' : 'left-[3px]')
          : (checked ? 'left-[18px]' : 'left-[4px]'))} />
    </button>
  )
}

// ─── 类别 Hook（useCategories 平替） ────────────────────────

export function useTodoCategories(includeArchived = false) {
  const [categories, setCategories] = useState([])
  const reload = useCallback(() => {
    todoCategories(includeArchived)
      .then(setCategories)
      .catch(() => { /* 后端不可用时保持空列表，表单中类别选择退化为空 */ })
  }, [includeArchived])
  useEffect(() => { reload() }, [reload])
  return { categories, reload }
}

// ─── 图标（viewBox 0 0 20 20，stroke 1.5） ─────────────────

const I = (children, size = 16, sw = 1.5) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)

export const Icon = {
  today: I(<><rect x="3" y="3" width="6.2" height="6.2" rx="1.5" /><rect x="10.8" y="3" width="6.2" height="6.2" rx="1.5" /><rect x="10.8" y="10.8" width="6.2" height="6.2" rx="1.5" /><rect x="3" y="10.8" width="6.2" height="6.2" rx="1.5" /></>),
  inbox: I(<><path d="M3 10.5 5 4h10l2 6.5V15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15v-4.5z" /><path d="M3 10.5h4l1 2h4l1-2h4" /></>),
  calendar: I(<><rect x="3" y="4.5" width="14" height="12" rx="2" /><path d="M3 8.5h14M7 3v3M13 3v3" /></>),
  review: I(<><rect x="4" y="3" width="12" height="14" rx="2" /><path d="M7 7.5h6M7 10.5h6M7 13.5h3.5" /></>),
  stats: I(<><path d="M4.5 16.5v-6M10 16.5v-11M15.5 16.5v-8M2.5 16.5h15" /></>),
  life: I(<path d="M10 16.5s-6-3.6-6-7.8A3.3 3.3 0 0 1 10 6.6a3.3 3.3 0 0 1 6 2.1c0 4.2-6 7.8-6 7.8z" />),
  settings: I(<><circle cx="10" cy="10" r="2.2" /><path d="M10 2.8v2.4M10 14.8v2.4M2.8 10h2.4M14.8 10h2.4M4.9 4.9l1.7 1.7M13.4 13.4l1.7 1.7M15.1 4.9l-1.7 1.7M6.6 13.4l-1.7 1.7" /></>),
  plus: I(<path d="M10 4.5v11M4.5 10h11" />),
  chevL: I(<path d="M12 4l-5 6 5 6" />),
  chevR: I(<path d="M8 4l5 6-5 6" />),
  dots: I(<><circle cx="4.5" cy="10" r="1.1" fill="currentColor" stroke="none" /><circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none" /><circle cx="15.5" cy="10" r="1.1" fill="currentColor" stroke="none" /></>, 15),
  check: I(<path d="M4 10.5l4 4 8-9" />),
  trash: I(<><path d="M3.5 5.5h13M8 5.5V3.5h4v2M5.5 5.5l.8 11h7.4l.8-11" /></>, 13),
  edit: I(<path d="M13.5 3.5l3 3L7 16l-4 1 1-4 9.5-9.5z" />, 13),
  refresh: I(<><path d="M16 8A6.5 6.5 0 1 0 16 12.5" /><path d="M16 3.5V8h-4.5" /></>, 14),
  clock: I(<><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.8 1.8" /></>, 13),
  fire: I(<path d="M10 2.5c.4 2.2 3.5 3.6 3.5 7a3.5 3.5 0 1 1-7 0c0-1.5.8-2.8 1.9-3.8.2 1.2.9 2 1.6 2.5-.1-1.9-.4-4 0-5.7z" />, 14),
  migrate: I(<><path d="M4.2 10a6 6 0 0 1 10.2-4.3M15.8 10a6 6 0 0 1-10.2 4.3" /><path d="M14.6 2.6v3.2h-3.2M5.4 17.4v-3.2h3.2" /></>, 14),
  warning: I(<><path d="M10 3 1.8 17h16.4L10 3z" /><path d="M10 9v4M10 15.6v.1" /></>, 14),
  checkCircle: I(<><circle cx="10" cy="10" r="7" /><path d="M6.5 10.2l2.4 2.4 4.6-5.2" /></>, 14),
  sun: I(<><circle cx="10" cy="10" r="3.4" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" /></>),
  moon: I(<path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5 6.8 6.8 0 1 0 15.5 12.6Z" />),
  back: I(<path d="M15 5l-7 7 7 7" />, 15),
}
