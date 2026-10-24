/**
 * Vault 共享 UI 原子组件：密文字段（默认隐藏/Reveal 自动隐藏/复制自动清理）、
 * 复制按钮、favicon、通用小图标。风格参照 1Password/Linear：克制、信息密度、留白。
 */
import { useState, useEffect, useRef, useCallback } from 'react'

export { CLIPBOARD_OPTIONS, makeClipboardCopier } from './clipboard'

// ─── 复制按钮 ────────────────────────────────────────────
export function CopyButton({ value, copier, label = '复制', done = '已复制' }) {
  const [ok, setOk] = useState(false)
  const t = useRef(0)
  const onClick = async () => {
    if (!value) return
    const r = await copier(value)
    if (r) {
      setOk(true)
      clearTimeout(t.current)
      t.current = setTimeout(() => setOk(false), 1500)
    }
  }
  return (
    <button
      onClick={onClick}
      title={label}
      className={'shrink-0 px-1.5 h-6 rounded-md text-[11px] font-medium transition-colors ' + (ok
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/10')}
    >
      {ok ? done : label}
    </button>
  )
}

// ─── 密文字段：默认隐藏，Reveal 15s 后自动隐藏 ────────────
export function SecretField({ label, value, copier, mono = true, extra }) {
  const [show, setShow] = useState(false)
  const timer = useRef(0)
  useEffect(() => {
    return () => clearTimeout(timer.current)   // 卸载（切页/锁定重挂）即隐藏
  }, [])
  const reveal = () => {
    setShow(s => {
      const next = !s
      clearTimeout(timer.current)
      if (next) timer.current = setTimeout(() => setShow(false), 15000)
      return next
    })
  }
  if (value === undefined || value === null || value === '') return null
  return (
    <FieldRow label={label} extra={extra}>
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <span
          onClick={reveal}
          title={show ? '点击隐藏' : '点击显示（15 秒后自动隐藏）'}
          className={'min-w-0 truncate cursor-pointer select-none text-sm ' + (mono ? 'font-mono' : '') + ' ' + (show ? 'text-stone-800 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400 tracking-widest')}
        >
          {show ? value : '••••••••••••'}
        </span>
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          <button
            onClick={reveal}
            className="px-1.5 h-6 rounded-md text-[11px] font-medium text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >{show ? '隐藏' : '显示'}</button>
          <CopyButton value={value} copier={copier} />
        </div>
      </div>
    </FieldRow>
  )
}

// ─── 统一样式下拉框（替代原生 select：菜单走应用 stone 配色 + 暗色适配）──
const SELECT_TRIGGER = 'w-full h-9 px-3 text-sm rounded-lg border flex items-center justify-between gap-2 text-left transition-colors ' +
  'bg-white dark:bg-white/[0.04] border-black/10 dark:border-white/10 ' +
  'text-stone-800 dark:text-stone-100 hover:border-black/20 dark:hover:border-white/20 ' +
  'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/30 dark:focus-visible:outline-white/30'
const SELECT_MENU = 'absolute z-50 mt-1 w-full min-w-[7rem] max-h-60 overflow-y-auto py-1 rounded-lg border shadow-xl ' +
  'bg-white dark:bg-[#1c1b1a] border-black/[0.08] dark:border-white/[0.1] animate-dropdown'
const SELECT_OPTION = 'w-full px-3 h-8 text-sm text-left flex items-center text-stone-600 dark:text-stone-300 ' +
  'hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors cursor-pointer'
const SELECT_OPTION_ACTIVE = 'bg-black/[0.055] dark:bg-white/[0.08] font-medium text-stone-900 dark:text-stone-100'

function Chevron({ open }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" className={'shrink-0 text-stone-400 transition-transform ' + (open ? 'rotate-180' : '')}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/**
 * 统一样式下拉框。options 接受 [{value,label}] 或字符串数组；
 * value/onChange 与原生 select 同构，直接替换 <select> 使用。
 */
export function Select({ value, onChange, options, className = '', title }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const norm = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o))
  const current = norm.find(o => o.value === value)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={ref} className={'relative ' + className}>
      <button type="button" title={title} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={SELECT_TRIGGER}>
        <span className="truncate">{current ? current.label : '…'}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div role="listbox" className={SELECT_MENU}>
          {norm.map(o => (
            <button key={o.value} type="button" role="option" aria-selected={o.value === value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={SELECT_OPTION + ' ' + (o.value === value ? SELECT_OPTION_ACTIVE : '')}>
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function FieldRow({ label, extra, children }) {
  return (
    <div className="flex items-start gap-4 py-1.5 group">
      <div className="w-28 shrink-0 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">
        {label}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
      {extra && <div className="shrink-0">{extra}</div>}
    </div>
  )
}

// ─── Favicon（DDG icons + 字母回退）─────────────────────
export function Favicon({ domain, name, size = 32 }) {
  const [failedDomain, setFailedDomain] = useState(null)
  const [allowed, setAllowed] = useState(() => { try { return localStorage.getItem('vault_external_icons') === 'true' } catch { return false } })
  useEffect(() => {
    const changed = () => { try { setAllowed(localStorage.getItem('vault_external_icons') === 'true') } catch { setAllowed(false) } }
    window.addEventListener('vault-icon-preference', changed)
    return () => window.removeEventListener('vault-icon-preference', changed)
  }, [])
  const letter = (name || domain || '?').trim().charAt(0).toUpperCase()
  if (!domain || failedDomain === domain || !allowed) {
    return (
      <div
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        className="rounded-lg bg-stone-200/80 dark:bg-stone-700/60 text-stone-600 dark:text-stone-300 flex items-center justify-center font-semibold select-none shrink-0"
      >{letter}</div>
    )
  }
  return (
    <img
      src={`https://icons.duckduckgo.com/ip3/${domain}.ico`}
      onError={() => setFailedDomain(domain)}
      alt=""
      referrerPolicy="no-referrer" loading="lazy"
      style={{ width: size, height: size }}
      className="rounded-lg bg-stone-100 dark:bg-stone-800 object-contain shrink-0"
    />
  )
}

// ─── 小图标集 ────────────────────────────────────────────
export const I = {
  search: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>,
  star: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>,
  starFill: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>,
  clock: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>,
  edit: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>,
  plus: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>,
  shield: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>,
  lock: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  key: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>,
  open: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></svg>,
  back: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>,
  refresh: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>,
  sun: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>,
  moon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  dice: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/></svg>,
  paperclip: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>,
  alert: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>,
  folder: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>,
  sliders: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>,
}
