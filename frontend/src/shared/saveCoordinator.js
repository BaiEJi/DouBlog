const clone = value => structuredClone(value)
const mutationId = () => globalThis.crypto.randomUUID()

/** Resource-local serial writer. Automatic retries require explicit server idempotency. */
export function createSaveCoordinator({ save, revision, debounceMs = 700, timeoutMs = 20000,
  idempotent = false, retryDelays = [1500, 4000, 12000], onState, onSaved, onDraftError, draft, initialDraft } = {}) {
  if (typeof save !== 'function') throw new TypeError('save is required')
  let state = { status: 'idle', dirty: false, error: null, revision }
  let latest = initialDraft?.snapshot === undefined ? undefined : clone(initialDraft.snapshot)
  let sequence = initialDraft?.sequence || (latest === undefined ? 0 : 1)
  let flight = initialDraft?.flight && idempotent ? clone(initialDraft.flight) : undefined
  let running, timer, disposed = false, blocked = false, controller
  if (latest !== undefined) state = { ...state, status: 'pending', dirty: true, revision: initialDraft.revision ?? revision }
  let backoffTimer, wakeBackoff
  const notify = patch => { state = { ...state, ...patch }; if (!disposed) onState?.({ ...state }) }
  const draftFailed = error => { notify({ draftError: error }); if (!disposed) onDraftError?.(error) }
  const clearDraft = () => { try { draft?.remove?.(); if (state.draftError) notify({ draftError: null }) } catch (error) { draftFailed(error) } }
  const writeDraft = () => { try {
    if (latest !== undefined) draft?.write?.({ revision: state.revision, snapshot: clone(latest), sequence, flight: flight ? clone(flight) : undefined })
    if (state.draftError) notify({ draftError: null })
  } catch (error) { draftFailed(error) } }
  const delay = ms => new Promise(resolve => { wakeBackoff = resolve; backoffTimer = setTimeout(resolve, ms) })
  async function drain() {
    while (!disposed && latest !== undefined && !blocked) {
      if (!flight) { flight = { snapshot: clone(latest), sequence, revision: state.revision, mutationId: mutationId() }; writeDraft() }
      notify({ status: 'saving', error: null })
      let attempt = 0
      for (;;) {
        controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(new DOMException('保存超时', 'TimeoutError')), timeoutMs)
        try {
          const result = await save(clone(flight.snapshot), { revision: flight.revision, mutationId: flight.mutationId, signal: controller.signal })
          clearTimeout(timeout)
          if (disposed) return
          const saved = flight
          flight = undefined
          notify({ revision: result?.revision ?? state.revision })
          if (saved.sequence === sequence) { latest = undefined; clearDraft() }
          else writeDraft()
          try { onSaved?.(result, clone(saved.snapshot)) } catch (error) { notify({ postSaveError: error }) }
          notify({ status: latest === undefined ? 'saved' : 'pending', dirty: latest !== undefined, error: null })
          break
        } catch (error) {
          clearTimeout(timeout)
          if (disposed) return
          const status = Number(error.status || 0)
          if (status === 409) { blocked = true; notify({ status: 'conflict', dirty: true, error }); throw error }
          const retryable = !status || status >= 500 || status === 408 || status === 429
          if (retryable && idempotent && attempt < retryDelays.length) {
            notify({ status: 'pending', dirty: true, error }); await delay(retryDelays[attempt++]); if (disposed) return; continue
          }
          // A definite rejection can be corrected with a new payload/mutation.
          // An uncertain result must retain the same payload/revision/id on retry.
          if (!retryable) {
            const corrected = [400, 413, 422].includes(status) && flight.sequence < sequence
            flight = undefined; writeDraft()
            if (corrected) break
          }
          notify({ status: 'error', dirty: true, error }); throw error
        }
      }
    }
  }
  function flush() {
    clearTimeout(timer)
    if (disposed) return Promise.reject(new DOMException('编辑器已关闭', 'AbortError'))
    if (blocked) return Promise.reject(state.error)
    if (running) return running
    if (latest === undefined) return Promise.resolve()
    running = drain().finally(() => { running = undefined })
    return running
  }
  return {
    change(snapshot) {
      if (disposed) return
      latest = clone(snapshot); sequence += 1; writeDraft()
      if (!blocked) notify({ status: running ? 'saving' : 'pending', dirty: true, error: null })
      clearTimeout(timer)
      if (!blocked) timer = setTimeout(() => { flush().catch(() => {}) }, debounceMs)
    },
    flush,
    retry: flush,
    getState: () => ({ ...state }),
    reset({ revision: nextRevision = state.revision } = {}) {
      if (running) throw new Error('保存进行中，不能重置')
      clearTimeout(timer); latest = undefined; flight = undefined; blocked = false; clearDraft()
      notify({ status: 'idle', dirty: false, error: null, revision: nextRevision })
    },
    dispose() {
      if (disposed) return
      writeDraft(); disposed = true; clearTimeout(timer); clearTimeout(backoffTimer); wakeBackoff?.(); controller?.abort()
    },
  }
}
