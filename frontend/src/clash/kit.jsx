/**
 * Clash 模块共享 UI 原子：容器/按钮/输入档位（docs/ui-baseline.md 对齐）、
 * Toast、状态徽章、字节与延迟格式化。个性色 sky——只用于徽章、主按钮、选中态。
 */

export const card = 'rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]'
export const inputCls = 'px-3 py-2 text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-lg text-stone-800 dark:text-stone-100 placeholder:text-stone-400 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors'
export const btn = 'px-4 py-2 text-sm font-medium rounded-lg bg-black/[0.06] dark:bg-white/[0.08] text-stone-700 dark:text-stone-200 hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
export const btnPri = 'px-4 py-2 text-sm font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
export const btnDanger = 'px-4 py-2 text-sm font-medium rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
export const LBL = 'text-xs text-stone-500 dark:text-stone-400'
export const MONO_BLOCK = 'font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all text-stone-600 dark:text-stone-300 bg-black/[0.02] dark:bg-white/[0.03] rounded-lg p-3 border border-black/[0.05] dark:border-white/[0.06] max-h-72 overflow-y-auto'

/** 轻提示（约 3.2s 自动消失；error=红底，其余 stone 反色） */
export function Toast({ t }) {
  if (!t?.msg) return null
  return (
    <div className={'fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] rounded-lg px-3 py-2 text-[13px] shadow-lg animate-fade-in max-w-[90vw] break-all ' +
      (t.kind === 'error'
        ? 'bg-red-500 text-white'
        : 'bg-stone-800 dark:bg-stone-100 dark:text-stone-900 text-white')}
      onClick={() => t.onDismiss?.()}>
      {t.msg}
    </div>
  )
}

/** 状态徽章：on=绿点启用 / off=灰点关闭 / wait=琥珀加载中 */
export function StateBadge({ on, loading, onText = '运行中', offText = '已停止' }) {
  if (loading) return <span className="inline-flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400"><span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />检测中…</span>
  return on
    ? <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{onText}</span>
    : <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-stone-500/10 text-stone-500 dark:text-stone-400"><span className="w-1.5 h-1.5 rounded-full bg-stone-400 dark:bg-stone-500" />{offText}</span>
}

/** 字节格式化：B → KB/MB/GB（保留 1 位小数） */
export function fmtBytes(n) {
  if (n == null || isNaN(n)) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

/** 延迟徽章颜色档：<200 绿 / <500 琥珀 / ≥500 红 / 0=失败 / null=未测（灰） */
export function delayCls(delay) {
  if (delay == null) return 'bg-stone-500/10 text-stone-400 dark:text-stone-500'
  if (delay === 0) return 'bg-red-500/10 text-red-600 dark:text-red-400'
  if (delay < 200) return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  if (delay < 500) return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
  return 'bg-red-500/10 text-red-600 dark:text-red-400'
}

export function DelayBadge({ delay, testing }) {
  if (testing) return <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[10.5px] font-mono font-medium bg-sky-500/10 text-sky-600 dark:text-sky-300 animate-pulse">测速中</span>
  const text = delay == null ? '未测' : delay === 0 ? '超时' : `${delay}ms`
  return <span className={'shrink-0 px-1.5 py-0.5 rounded-md text-[10.5px] font-mono font-medium tabular-nums ' + delayCls(delay)}>{text}</span>
}

/** 连接开始时间 → 相对时长（x 秒/分/时前） */
export function fmtSince(iso) {
  if (!iso) return '-'
  const t = Date.parse(iso)
  if (isNaN(t)) return '-'
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}
