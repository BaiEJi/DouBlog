import { validateDocument } from './data.js'

const clone = value => structuredClone(value)
export function createSaveController({ id, revision, document, save, onState = () => {}, onSaved = () => {},
  storage = globalThis.localStorage, debounceMs = 900, retryDelays = [1500, 4000, 12000], timeoutMs = 20000 }) {
  const key = `doublog.mindmap.draft.${id}`
  let current = document, generation = 0, confirmed = 0, timer, retryTimer, flight = null
  let request = null, disposed = false, retries = 0, discarded = false
  let state = { status: 'saved', revision, error: null, pending: false }
  const emit = (status, error = null) => {
    state = { status, revision, error, pending: generation > confirmed }
    if (!disposed) onState({ ...state })
  }
  const persist = () => {
    if (discarded || generation <= confirmed) return
    try { storage?.setItem(key, JSON.stringify({ schema_version: 1, id, revision, timestamp: Date.now(), document: current })) }
    catch { emit(state.status, new Error('浏览器草稿空间不足；请立即手动保存或导出 JSON')) }
  }
  const clearTimers = () => { clearTimeout(timer); clearTimeout(retryTimer) }
  const removeDraft = () => { try { storage?.removeItem(key) } catch { /* saving to the server remains authoritative */ } }
  const schedule = () => {
    clearTimeout(timer)
    if (!disposed && state.status !== 'conflict') timer = setTimeout(() => { flush().catch(() => {}) }, debounceMs)
  }
  function change(doc) {
    if (disposed) return
    current = doc
    discarded = false
    generation++
    emit(state.status === 'conflict' ? 'conflict' : 'dirty', state.status === 'conflict' ? state.error : null)
    persist()
    schedule()
  }
  async function attempt() {
    if (!request) request = { document: clone(current), revision, mutation_id: crypto.randomUUID(), generation }
    const active = request
    emit('saving')
    let timeout
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => save({ document: active.document, revision: active.revision, mutation_id: active.mutation_id })),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('保存超时，请重试；未保存内容已留在浏览器草稿中')), timeoutMs) }),
      ])
      if (!Number.isInteger(response?.revision) || response.revision <= active.revision) throw new Error('保存响应缺少有效版本号')
      if (disposed) return response
      revision = response.revision
      confirmed = active.generation
      request = null
      retries = 0
      if (generation === confirmed) removeDraft()
      else persist()
      emit(generation > confirmed ? 'dirty' : 'saved')
      if (!disposed) onSaved(response)
      return response
    } catch (error) {
      const conflict = error.status === 409
      const permanent = error.status >= 400 && error.status < 500 && ![408,429].includes(error.status)
      if (permanent && !conflict) request = null
      emit(conflict ? 'conflict' : permanent ? 'error' : 'offline', error)
      if (!disposed) persist()
      if (!disposed && !conflict && !permanent && retries < retryDelays.length) {
        retryTimer = setTimeout(() => { retry().catch(() => {}) }, retryDelays[retries++])
      }
      throw error
    } finally { clearTimeout(timeout) }
  }
  async function flush() {
    clearTimeout(timer)
    if (disposed) throw new Error('编辑器已关闭，修改保存在本地草稿中')
    if (state.status === 'conflict') throw state.error
    let result = state
    while (generation > confirmed) {
      if (state.status === 'conflict') throw state.error
      if (flight) { await flight; continue }
      const task = attempt()
      flight = task
      try { result = await task }
      finally { if (flight === task) flight = null }
      if (disposed) return result
    }
    return result
  }
  function retry() {
    clearTimers()
    if (state.status === 'conflict') return Promise.reject(state.error)
    return flush()
  }
  function recover() {
    try {
      const draft = JSON.parse(storage?.getItem(key) || 'null')
      if (draft?.schema_version !== 1 || draft.id !== id) return null
      validateDocument(draft.document)
      return { document: draft.document, revision: draft.revision, timestamp: draft.timestamp }
    } catch { return null }
  }
  function setRevision(next) {
    if (flight || generation > confirmed) throw new Error('请先完成当前内容的保存')
    revision = next
    emit('saved')
  }
  function dispose() { persist(); disposed = true; clearTimers() }
  function discardDraft() { discarded = true; removeDraft() }
  emit('saved')
  return { change, flush, retry, recover, setRevision, dispose, getState: () => ({ ...state }), discardDraft }
}
