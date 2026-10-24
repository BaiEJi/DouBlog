import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CodeEditor from '../src/shared/CodeEditor'
import VirtualList from '../src/shared/VirtualList'
import usePolling from '../src/shared/usePolling'
import { createWorkerTask } from '../src/shared/workerTask'
import { createGeometryCache } from '../src/gamemap/board/geometry'
import * as cryptoApi from '../src/vault/components/crypto'
import { createVaultSession, decryptBatches } from '../src/vault/components/session'
import '../src/index.css'
const tasks = createWorkerTask(() => new Worker(new URL('../src/shared/compute.worker.js', import.meta.url), { type: 'module' }))
window.frontendChecks = { tasks, cryptoApi, createGeometryCache, createVaultSession, decryptBatches }
function Harness() {
  const [value, setValue] = useState('start 中文😀'), [readOnly, setReadOnly] = useState(false)
  const [saved, setSaved] = useState(0), [poll, setPoll] = useState(false)
  usePolling(async ({ signal }) => {
    window.pollMetrics ||= { active: 0, max: 0, starts: 0, cancelled: 0 }
    const metrics = window.pollMetrics; metrics.active++; metrics.max = Math.max(metrics.max, metrics.active); metrics.starts++
    try { await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 150); signal.addEventListener('abort', () => { clearTimeout(timer); metrics.cancelled++; reject(new DOMException('cancelled','AbortError')) }, { once: true }) }) }
    finally { metrics.active-- }
  }, { intervalMs: 20, enabled: poll })
  return <div className="p-8 bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100">
    <button onClick={() => setReadOnly(value => !value)}>只读切换</button><button onClick={() => setPoll(value => !value)}>轮询切换</button><output data-saved>{saved}</output>
    <CodeEditor {...{value,readOnly}} onChange={setValue} onSave={() => setSaved(value => value + 1)} ariaLabel="QA editor" />
    <output data-value>{value}</output>
    <VirtualList items={Array.from({length:10000},(_,index)=>({id:index,text:`row ${index}`+('\nextra'.repeat(index%3))}))} getKey={item=>item.id} estimateSize={45} height={400} renderItem={item=><div className="p-2 whitespace-pre-wrap" data-row={item.id}>{item.text}</div>} />
  </div>
}
createRoot(document.getElementById('root')).render(<Harness />)
