/**
 * MyTodo 能力包公共小件：象限元信息与文案 / 日期工具（原生 Date，无 dayjs）/
 * 弹层（Modal/Confirm/Toast）/ 徽章 / 表单档位 / 类别 Hook / 图标。
 * 个性色 indigo——只用于图标底、徽章、主按钮、选中态；其余一律中性 stone。
 */
import { useCallback, useEffect, useState } from 'react'

import { todoCategories, todoSettings } from './api'
import { getDataIdentity } from '@/shared/dataEpoch'

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
const quadrantTextCache = new Map()
export function invalidateQuadrantText() { quadrantTextCache.delete(getDataIdentity()) }
export function useQuadrantText() {
  const identity = getDataIdentity()
  const [text, setText] = useState(() => quadrantTextCache.get(identity))
  useEffect(() => {
    if (quadrantTextCache.has(identity)) return
    let alive = true
    todoSettings()
      .then(s => {
        const value = { labels: s.quadrant_labels || {}, subtitles: s.quadrant_subtitles || {} }
        quadrantTextCache.set(identity, value)
        if (alive) setText(value)
      })
      .catch(() => { /* 读取失败用默认文案 */ })
    return () => { alive = false }
  }, [identity])
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

export { Modal, Confirm, Toast, Field, inputCls, btn, Spinner, Empty, StatTile, Card, Segmented, Switch } from '@/shared/ui/kit'

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

export { Icon } from '@/shared/ui/icons'
