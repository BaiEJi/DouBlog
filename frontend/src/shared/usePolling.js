import { useEffect, useLayoutEffect, useRef } from 'react'

/** One request at a time. Interval starts after completion, never overlaps. */
export default function usePolling(task, { intervalMs = 5000, enabled = true, hiddenPause = true, onError, immediate = true } = {}) {
  const latest = useRef({ task, onError })
  useLayoutEffect(() => { latest.current = { task, onError } })
  useEffect(() => {
    if (!enabled) return
    let stopped = false, timer, controller, running = false, rerun = false
    const visible = () => !hiddenPause || document.visibilityState !== 'hidden'
    const schedule = () => { clearTimeout(timer); if (!stopped && visible()) timer = setTimeout(run, intervalMs) }
    async function run() {
      clearTimeout(timer)
      if (stopped || !visible()) return
      if (running) { rerun = true; return }
      running = true; controller = new AbortController()
      try { await latest.current.task({ signal: controller.signal }) }
      catch (error) { if (error.name !== 'AbortError' && !stopped) latest.current.onError?.(error) }
      finally { running = false; if (rerun && !stopped && visible()) { rerun = false; run() } else schedule() }
    }
    const visibility = () => { clearTimeout(timer); if (!visible()) controller?.abort(); else run() }
    document.addEventListener('visibilitychange', visibility)
    if (immediate) run(); else schedule()
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', visibility) }
  }, [enabled, hiddenPause, immediate, intervalMs])
}
