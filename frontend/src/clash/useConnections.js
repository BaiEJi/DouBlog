import { useCallback, useEffect, useRef, useState } from 'react'
import usePolling from '../shared/usePolling'
import { subscribeDataEpoch } from '../shared/dataEpoch'
import { clashConnectionsStream, clashCtlConnections } from './api'

/** Native stream via authenticated backend; transport failure falls back to single-flight polling. */
export default function useConnections(onData, enabled = true) {
  const latest = useRef(onData)
  latest.current = onData
  const [fallback, setFallback] = useState(false)
  const [mode, setMode] = useState('connecting')
  const poll = useCallback(async ({ signal }) => {
    const data = await clashCtlConnections({ signal })
    if (!signal.aborted) latest.current(data)
  }, [])
  usePolling(poll, { enabled: enabled && fallback, intervalMs: 2000 })
  useEffect(() => {
    if (!enabled) return
    let close, disposed = false
    const stop = () => { close?.(); close = null }
    const open = () => {
      stop()
      if (document.hidden || disposed) return
      if (typeof EventSource === 'undefined') { setFallback(true); setMode('polling'); return }
      setFallback(false); setMode('connecting')
      close = clashConnectionsStream({
        onData: data => { if (!disposed && !document.hidden) latest.current(data) },
        onMode: value => { if (!disposed) setMode(value) },
        onError: () => { if (!disposed) { setFallback(true); setMode('polling') } },
      })
    }
    const visibility = () => document.hidden ? stop() : open()
    document.addEventListener('visibilitychange', visibility)
    const unsubscribe = subscribeDataEpoch(stop)
    open()
    return () => { disposed = true; stop(); unsubscribe(); document.removeEventListener('visibilitychange', visibility) }
  }, [enabled])
  return mode
}
