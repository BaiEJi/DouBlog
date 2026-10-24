import { useEffect, useRef, useState } from 'react'

/**
 * 统一下拉框（apihub 同款）：按钮 + 绝对定位菜单。
 * 原生 <select> 展开的选项列表在暗色下泛白刺眼（color-scheme 各浏览器支持不一），
 * 模块内改用它保持明暗一致；选中项高亮 cyan（confcenter 个性色）。
 * options: [{value, label}]；size='sm' 用于编辑器工具栏等紧凑场景。
 */
export default function Select({ value, onChange, options, placeholder = '选择…', disabled, size = 'md', id, ariaLabel, invalid, className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const selectedRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    // 选中项滚到菜单视口内（长列表打开时不贴边）
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const cur = options.find(o => String(o.value) === String(value))
  const base = size === 'sm'
    ? 'h-7 px-2 text-[13px] rounded-lg'
    : size === 'form'
      ? 'h-8 px-2 text-sm rounded-lg'      // 行内表单档：与 numField 等高同字号
      : 'px-3 py-2 text-base rounded-lg'
  return (
    <div className={'relative ' + className} ref={ref}>
      <button type="button" id={id} disabled={disabled} onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox" aria-expanded={open} {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
        className={`${base} w-full flex items-center justify-between gap-1.5 text-left disabled:opacity-50
          bg-white dark:bg-white/[0.04] ${invalid ? '!border-red-400 dark:!border-red-500' : 'border border-black/10 dark:border-white/10'}
          text-stone-800 dark:text-stone-100 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors`}>
        <span className={'truncate ' + (cur ? '' : 'text-stone-400 dark:text-stone-500')}>{cur ? cur.label : placeholder}</span>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          className={'shrink-0 text-stone-400 transition-transform ' + (size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5') + (open ? ' rotate-180' : '')}>
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>
      {open && (
        <div role="listbox" className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1c1b1a] py-1 shadow-xl">
          {options.map(o => {
            const isSel = String(o.value) === String(value)
            return (
            <button key={String(o.value)} type="button" role="option" aria-selected={isSel}
              ref={isSel ? selectedRef : undefined}
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={'w-full text-left px-3 py-1.5 text-sm transition-colors ' + (
                isSel
                  ? 'text-cyan-700 dark:text-cyan-300 font-medium bg-cyan-500/[0.08]'
                  : 'text-stone-700 dark:text-stone-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.06]')}>
              {o.label}
            </button>)
          })}
        </div>
      )}
    </div>
  )
}
