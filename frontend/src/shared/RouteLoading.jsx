/** 内容区路由懒加载占位：公共壳保持可见，只在内容画布内显示可读加载状态。 */
export default function RouteLoading({ label = '正在加载页面…' }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4" role="status" aria-live="polite">
      <div className="w-40 h-2 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden" aria-hidden="true">
        <div className="h-full w-1/2 rounded-full bg-black/15 dark:bg-white/20 animate-pulse" />
      </div>
      <p className="text-sm text-stone-500 dark:text-stone-400">{label}</p>
    </div>
  )
}
