import { useEffect, useMemo, useState } from 'react'
import { createWorkerTask } from '../shared/workerTask'
import { jsonValidate } from './jsonTools'

/** Small drafts validate once per value; large drafts never parse on the UI thread. */
export default function useJsonValue(value, enabled) {
  const [tasks] = useState(() => createWorkerTask(() => new Worker(new URL('./json.worker.js', import.meta.url), { type: 'module' })))
  const [state, setState] = useState({ source: null, error: null })
  const large = enabled && value.length > 64 * 1024
  const smallError = useMemo(() => enabled && !large ? jsonValidate(value) : null, [value, enabled, large])
  useEffect(() => {
    if (!large) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      tasks.run('validate', { text: value }, { signal: controller.signal, timeoutMs: 5000 })
        .then(() => { if (!controller.signal.aborted) setState({ source: value, error: null }) })
        .catch(error => { if (!controller.signal.aborted) setState({ source: value, error: error.message }) })
    }, 180)
    return () => { clearTimeout(timer); controller.abort() }
  }, [large, value, tasks])
  useEffect(() => () => tasks.dispose(), [tasks])
  const pending = large && state.source !== value
  const error = large ? pending ? null : state.error : smallError
  return { valid: !enabled || (!pending && !error), error, pending,
    format: (text, minify) => tasks.run('format', { text, minify }, { timeoutMs: 5000 }) }
}
