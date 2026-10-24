/** Dedicated workers are terminated on timeout/cancel: even catastrophic regex can stop. */
export function createWorkerTask(workerFactory) {
  let sequence = 0
  const active = new Map()
  function run(type, payload, { timeoutMs = 5000, signal, transfer = [] } = {}) {
    const id = ++sequence
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException('任务已取消', 'AbortError')); return }
      const worker = workerFactory()
      const finish = (error, value) => {
        if (!active.has(id)) return
        clearTimeout(timer); signal?.removeEventListener('abort', abort)
        active.delete(id); worker.terminate()
        if (error) reject(error); else resolve(value)
      }
      const abort = () => finish(new DOMException('任务已取消', 'AbortError'))
      const timer = setTimeout(() => finish(new DOMException('计算超时，请缩小输入或调整表达式', 'TimeoutError')), timeoutMs)
      active.set(id, abort)
      signal?.addEventListener('abort', abort, { once: true })
      worker.onmessage = ({ data }) => {
        if (data.id !== id) return
        if (data.error) { const error = new Error(data.error.message); error.name = data.error.name || 'Error'; finish(error) }
        else finish(null, data.result)
      }
      worker.onerror = event => finish(new Error(event.message || 'Worker 计算失败'))
      try { worker.postMessage({ id, type, payload }, transfer) } catch (error) { finish(error) }
    })
  }
  return { run, dispose() { for (const abort of [...active.values()]) abort() }, get activeCount() { return active.size } }
}
