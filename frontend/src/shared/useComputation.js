import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createWorkerTask } from './workerTask'
export default function useComputation(type, payload, { debounceMs = 180, timeoutMs = 5000 } = {}) {
  const [tasks] = useState(() => createWorkerTask(() => new Worker(new URL('./compute.worker.js', import.meta.url), { type: 'module' })))
  const [state, setState] = useState({ result: null, error: null, pending: true, key: null })
  const cancellation = useRef(() => {})
  const payloadRef = useRef(payload)
  useLayoutEffect(() => { payloadRef.current = payload })
  const key = JSON.stringify(payload)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setState({ result: null, pending: true, error: null, key })
      tasks.run(type, payloadRef.current, { signal: controller.signal, timeoutMs }).then(result => {
        if (!controller.signal.aborted) setState({ result, pending: false, error: null, key })
      }).catch(error => { if (!controller.signal.aborted) setState({ result: null, pending: false, error: error.message, key }) })
    }, debounceMs)
    const cancel = () => { clearTimeout(timer); controller.abort() }
    cancellation.current = cancel
    return cancel
  }, [type, key, debounceMs, timeoutMs, tasks])
  useEffect(() => () => tasks.dispose(), [tasks])
  const stale = state.key !== key
  return { ...state, pending: state.pending || stale, result: stale ? null : state.result, error: stale ? null : state.error,
    cancel: () => { cancellation.current(); setState({ key, result: null, pending: false, error: '计算已取消' }) } }
}
