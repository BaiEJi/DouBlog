import { useEffect } from 'react'

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
          <div className="text-base font-semibold truncate">{title}</div>
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

/** 段选器（antd Segmented 的平替）——档位对齐 UI 基线：控件文字 text-sm */
export function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex p-0.5 rounded-lg bg-black/[0.05] dark:bg-white/[0.06]">
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={'px-3 h-9 rounded-md text-sm transition-colors whitespace-nowrap ' +
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


export { Icon } from './icons'
