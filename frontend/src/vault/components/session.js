export function createVaultSession() {
  let generation = 0
  let controller = new AbortController()
  return {
    begin() { controller.abort(); controller = new AbortController(); return ++generation },
    invalidate() { generation += 1; controller.abort() },
    current() { return generation },
    signal() { return controller.signal },
    isCurrent(token) { return token === generation },
    assert(token) { if (token !== generation) throw new DOMException('密码库会话已锁定', 'AbortError') },
  }
}

/** A child view owns one scope: session lock, item change and unmount all stop it. */
export function createVaultTaskScope(session) {
  const token = session.current(), parent = session.signal(), controller = new AbortController()
  const abort = () => controller.abort(new DOMException('密码库任务已失效', 'AbortError'))
  if (parent.aborted) abort(); else parent.addEventListener('abort', abort, { once: true })
  const current = () => !controller.signal.aborted && session.isCurrent(token)
  return { signal: controller.signal, isCurrent: current,
    assert() { if (!current()) throw new DOMException('密码库任务已失效', 'AbortError') },
    dispose() { parent.removeEventListener('abort', abort); abort() },
  }
}

/** Bounded queue checks its scope before starting and publishing every job. */
export async function runVaultTasks(entries, task, { signal, isCurrent, concurrency = 3, onResult } = {}) {
  let cursor = 0
  const current = () => !signal.aborted && isCurrent()
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (cursor < entries.length && current()) {
      const index = cursor++, result = await task(entries[index], { signal })
      if (!current()) return
      onResult?.(result, index)
    }
  }))
  return current()
}

export async function decryptBatches(list, decrypt, { isCurrent = () => true, concurrency = 8, batchSize = 100, onBatch } = {}) {
  const result = []
  for (let offset = 0; offset < list.length; offset += batchSize) {
    if (!isCurrent()) return null
    const batch = list.slice(offset, offset + batchSize), out = new Array(batch.length)
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, async () => {
      while (cursor < batch.length && isCurrent()) {
        const index = cursor++
        try { out[index] = await decrypt(batch[index]) } catch { /* a damaged ciphertext does not expose contents */ }
      }
    }))
    if (!isCurrent()) return null
    result.push(...out.filter(Boolean)); onBatch?.([...result])
    // Give input/lock events an opportunity between batches.
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  return isCurrent() ? result : null
}
