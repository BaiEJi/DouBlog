import { useSyncExternalStore } from 'react'
let now = Date.now(), timer
const listeners = new Set()
function tick() { now = Date.now(); for (const listener of listeners) listener() }
function visibility() { clearInterval(timer); if (document.visibilityState !== 'hidden') { tick(); timer = setInterval(tick, 1000) } }
function subscribe(listener) {
  listeners.add(listener)
  if (listeners.size === 1) { document.addEventListener('visibilitychange', visibility); visibility() }
  return () => { listeners.delete(listener); if (!listeners.size) { clearInterval(timer); document.removeEventListener('visibilitychange', visibility) } }
}
export default function useClock() { return useSyncExternalStore(subscribe, () => now, () => now) }
