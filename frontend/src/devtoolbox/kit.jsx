/**
 * 开发者工具箱共享 UI 原子：容器/按钮/输入/等宽编辑器档位（docs/ui-baseline.md 对齐）、
 * 复制按钮、分段控件、Toast。个性色 lime——只用于徽章、主按钮、选中态。
 */
import { useState } from 'react'
import { copyText } from './lib/misc'


export const card = 'rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]'
export const inputCls = 'px-3 py-2 text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-lg text-stone-800 dark:text-stone-100 placeholder:text-stone-400 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors'
export const selectCls = 'px-2.5 py-2 text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-lg text-stone-800 dark:text-stone-100 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors'
export const areaCls = 'w-full font-mono text-[13px] leading-relaxed p-3 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.04] text-stone-800 dark:text-stone-100 placeholder:text-stone-400 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors resize-y'
export const outCls = 'w-full font-mono text-[13px] leading-relaxed p-3 rounded-lg border border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03] text-stone-700 dark:text-stone-200 whitespace-pre-wrap break-all'
export const btn = 'px-4 py-2 text-sm font-medium rounded-lg bg-black/[0.06] dark:bg-white/[0.08] text-stone-700 dark:text-stone-200 hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
export const btnPri = 'px-4 py-2 text-sm font-medium rounded-lg bg-lime-600 hover:bg-lime-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
export const btnSm = 'px-2.5 py-1.5 text-[13px] font-medium rounded-lg bg-black/[0.06] dark:bg-white/[0.08] text-stone-700 dark:text-stone-200 hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
export const LBL = 'text-xs text-stone-500 dark:text-stone-400'

/** 工具页头：标题 + 描述 + 右侧动作区（right 为主入口；children 为兼容别名） */
export function ToolHead({ title, desc, right, children }) {
  const actions = right ?? children
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {desc && <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

/** 复制按钮：复制成功后 1.5s 内显示「已复制」 */
export function CopyBtn({ text, label = '复制', disabled, cls = btnSm, title }) {
  const [ok, setOk] = useState(false)
  const doCopy = async () => {
    try {
      await copyText(text)
      setOk(true)
      setTimeout(() => setOk(false), 1500)
    } catch { /* 剪贴板不可用（非安全上下文）时静默 */ }
  }
  return (
    <button type="button" className={cls} disabled={disabled || !text} onClick={doCopy}
      title={title || '复制到剪贴板'}>
      {ok ? '已复制 ✓' : label}
    </button>
  )
}

/** 分段控件（紧凑单选） */
export function Segmented({ options, value, onChange, className = '' }) {
  return (
    <div className={'inline-flex p-0.5 rounded-lg bg-black/[0.05] dark:bg-white/[0.07] ' + className}>
      {options.map(o => (
        <button key={o.key} type="button"
          className={'px-2.5 py-1 rounded-md text-[12.5px] transition-colors whitespace-nowrap ' +
            (value === o.key
              ? 'bg-white dark:bg-white/[0.14] text-stone-900 dark:text-stone-100 font-medium shadow-sm'
              : 'text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200')}
          onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** 复选框 + 标签（紧凑档） */
export function Check({ checked, onChange, label, disabled }) {
  return (
    <label className={'inline-flex items-center gap-1.5 text-[13px] text-stone-600 dark:text-stone-300 select-none ' + (disabled ? 'opacity-50' : 'cursor-pointer')}>
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="w-3.5 h-3.5 rounded accent-lime-600 dark:accent-lime-500" />
      {label}
    </label>
  )
}

/** 轻提示（约 3.2s 自动消失；error=红底，其余 stone 反色） */
export function Toast({ t }) {
  if (!t?.msg) return null
  return (
    <div className={'fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] rounded-lg px-3 py-2 text-[13px] shadow-lg max-w-[90vw] break-all ' +
      (t.kind === 'error'
        ? 'bg-red-500 text-white'
        : 'bg-stone-800 dark:bg-stone-100 dark:text-stone-900 text-white')}
      onClick={() => t.onDismiss?.()}>
      {t.msg}
    </div>
  )
}


/** 结果状态行：ok=绿 / err=红（diff/解析类工具底部状态条） */
export function StatusLine({ ok, err, okText = '格式正确' }) {
  if (err) return <p className="text-[13px] text-red-600 dark:text-red-400 break-all">✗ {err}</p>
  if (ok) return <p className="text-[13px] text-emerald-600 dark:text-emerald-400">✓ {okText}</p>
  return null
}

/** 双栏编辑器布局（对比/转换类工具共用）：左输入右输出，移动端上下 */
export function TwoPane({ leftTitle, rightTitle, left, right, leftActions, rightActions }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className={LBL}>{leftTitle}</span>
          <div className="flex items-center gap-1.5">{leftActions}</div>
        </div>
        {left}
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className={LBL}>{rightTitle}</span>
          <div className="flex items-center gap-1.5">{rightActions}</div>
        </div>
        {right}
      </div>
    </div>
  )
}
