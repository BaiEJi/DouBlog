// 资产库页面小部件：Toast / Modal / Confirm / 图标（对齐全站 stone 视觉档位）

export function Toast({ msg, kind }) {
  if (!msg) return null
  const tone = kind === 'error'
    ? 'bg-red-600/95 text-white'
    : kind === 'warn'
      ? 'bg-amber-500/95 text-white'
      : 'bg-stone-800/95 text-white dark:bg-stone-200/95 dark:text-stone-900'
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] px-4 py-2.5 rounded-xl text-sm shadow-lg ${tone}`}
      role="status">{msg}</div>
  )
}

export function Modal({ title, onClose, children, footer, wide }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[86vh] flex flex-col rounded-2xl border border-black/[0.08] dark:border-white/[0.1] bg-white dark:bg-[#1c1b1a] shadow-2xl`}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.08]">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="关闭"
            className="w-8 h-8 rounded-lg text-stone-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]">✕</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t border-black/[0.06] dark:border-white/[0.08] flex items-center justify-end gap-2.5">{footer}</div>}
      </div>
    </div>
  )
}

export const BTN_PRIMARY = 'px-4 py-2 rounded-xl text-sm font-medium bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed'
export const BTN_GHOST = 'px-4 py-2 rounded-xl text-sm font-medium border border-black/[0.1] dark:border-white/[0.12] bg-white dark:bg-white/[0.04] hover:bg-black/[0.04] dark:hover:bg-white/[0.08] transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
export const BTN_DANGER = 'px-4 py-2 rounded-xl text-sm font-medium bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

export const INPUT = 'w-full px-3 py-2 rounded-xl border border-black/[0.1] dark:border-white/[0.12] bg-white dark:bg-white/[0.04] text-sm text-stone-900 dark:text-stone-100 outline-none focus:border-black/30 dark:focus:border-white/30 placeholder:text-stone-400'

/** 行级 LCS diff：返回 [{type: 'same'|'add'|'del', text}]；超长内容退化为整体替换 */
export function diffLines(aText, bText, cap = 1500) {
  const a = (aText || '').split('\n')
  const b = (bText || '').split('\n')
  if (a.length > cap || b.length > cap) {
    return [...a.map(t => ({ type: 'del', text: t })), ...b.map(t => ({ type: 'add', text: t }))]
  }
  const n = a.length, m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i++ }
    else { out.push({ type: 'add', text: b[j] }); j++ }
  }
  while (i < n) { out.push({ type: 'del', text: a[i] }); i++ }
  while (j < m) { out.push({ type: 'add', text: b[j] }); j++ }
  return out
}

/** 复制到剪贴板（带降级），返回是否成功 */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* 走降级 */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;left:-9999px'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    return true
  } catch {
    return false
  }
}

export const KIND_META = {
  prompt: { label: 'Prompt', icon: '◈', chip: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400' },
  skill: { label: 'Skill', icon: '⚙', chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
}
