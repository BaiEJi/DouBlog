// Never put account secrets in this identity. It is only a cache namespace.
let epoch = 0
let identity = 'session'
let databaseIdentity = ''
let staleContext = false
const listeners = new Set()
const contextListeners = new Set()
export const getDataEpoch = () => epoch
export const getDataIdentity = () => identity
export const getDatabaseIdentity = () => databaseIdentity
export const isDataContextStale = () => staleContext
export function subscribeDataContext(listener) { contextListeners.add(listener); return () => contextListeners.delete(listener) }
export function markDataContextStale() {
  if (staleContext) return
  staleContext = true
  for (const listener of contextListeners) listener()
}
export function setDataContext(username, databaseIdentity) {
  const next = JSON.stringify([String(username || ''), String(databaseIdentity || '')])
  setDatabaseIdentity(String(databaseIdentity || ''))
  if (next !== identity) advanceDataEpoch(next)
  return identity
}
function setDatabaseIdentity(next) {
  databaseIdentity = next
  if (staleContext) { staleContext = false; for (const listener of contextListeners) listener() }
}
export function subscribeDataEpoch(listener) { listeners.add(listener); return () => listeners.delete(listener) }
export function advanceDataEpoch(nextIdentity = identity) {
  identity = String(nextIdentity)
  epoch += 1
  for (const listener of listeners) listener(epoch)
  return epoch
}
export function assertDataEpoch(expected) {
  if (expected !== epoch) throw new DOMException('数据库或会话已经切换', 'AbortError')
}
