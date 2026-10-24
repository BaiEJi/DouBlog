import { createEditor } from '../src/mindmap/adapter.js'
import { benchmarkDocument, encodeExport, parseImport, outlineNodes } from '../src/mindmap/data.js'

let editor, observer, result, sampling
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const memory = () => performance.memory ? {
  usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize,
  jsHeapSizeLimit: performance.memory.jsHeapSizeLimit, sampledAtMs: performance.now(),
} : null
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return { samples: values.length, median: sorted[Math.floor(sorted.length / 2)] || 0,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] || 0, max: sorted.at(-1) || 0 }
}
function frameStats(frames, start, end) {
  const timestamps = frames.filter(time => time >= start && time <= end)
  const intervals = timestamps.slice(1).map((time, index) => time - timestamps[index])
  return { durationMs: end - start, frameCount: timestamps.length,
    achievedFps: timestamps.length * 1000 / Math.max(1, end - start),
    intervalFps: intervals.length * 1000 / Math.max(1, intervals.reduce((sum, value) => sum + value, 0)),
    firstFrameDelayMs: timestamps.length ? timestamps[0] - start : end - start,
    intervals: stats(intervals), framesOver33ms: intervals.filter(value => value > 33.34).length,
    estimatedDroppedFramesAt60Hz: intervals.reduce((sum, value) => sum + Math.max(0, Math.round(value / (1000 / 60)) - 1), 0),
    rawFrameTimestampsMs: timestamps, rawIntervalsMs: intervals }
}
function topology(id) {
  const stack = [[editor.getDocument().root, null, 0]]
  while (stack.length) {
    const [node, parent, index] = stack.pop()
    if (node.data.uid === id) return { uid: id, parentUid: parent?.data.uid || null, index, text: node.data.text }
    for (let i = (node.children?.length || 0) - 1; i >= 0; i--) stack.push([node.children[i], node, i])
  }
  return null
}
function textBox(text) {
  const element = [...document.querySelectorAll('.smm-text-node-wrap')].find(node => node.textContent === text)
  if (!element) throw new Error(`DOM text not found: ${text}`)
  // Group bounds include expansion/interaction placeholders. The semantic
  // shape center is a reliable Drag-plugin hit point; the runner independently
  // checks that actual text remains inside the same shape.
  const box = element.getBoundingClientRect(), group = element.closest('.smm-node').getBoundingClientRect()
  const shape = element.closest('.smm-node').querySelector('.smm-node-shape').getBoundingClientRect()
  return { x: box.x, y: box.y, width: box.width, height: box.height, cx: shape.x + shape.width / 2, cy: shape.y + shape.height / 2,
    groupBounds: { x: group.x, y: group.y, width: group.width, height: group.height },
    shapeBounds: { x: shape.x, y: shape.y, width: shape.width, height: shape.height } }
}
const ready = () => editor.whenReady()
async function reportProgress(phase) {
  result.phase = phase
  if (typeof window.reportMindmapBenchmarkProgress === 'function') await window.reportMindmapBenchmarkProgress(structuredClone(result))
}

window.runMindmapBenchmark = async count => {
  editor?.destroy(); observer?.disconnect()
  document.querySelector('#canvas').replaceChildren()
  let minimap = document.querySelector('#benchmark-mini')
  if (!minimap) {
    minimap = document.createElement('div'); minimap.id = 'benchmark-mini'
    Object.assign(minimap.style, { position: 'absolute', right: '16px', bottom: '16px', width: '200px', height: '120px', border: '1px solid #94a3b8' })
    document.body.appendChild(minimap)
  }
  result = { nodeCount: count, startedAt: new Date().toISOString(), phase: 'initializing',
    monotonicTimeOrigin: performance.timeOrigin, clock: 'performance.now() milliseconds; ISO timestamps are UTC',
    initialMemory: memory(), operations: [], gestures: [], longTasks: [], errors: [] }
  observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) result.longTasks.push({ start: entry.startTime, duration: entry.duration })
  })
  observer.observe({ type: 'longtask', buffered: false })
  const documentData = benchmarkDocument(count)
  result.allNodesExpandedInitially = outlineNodes(documentData.root).every(node => node.expanded)
  const started = performance.now()
  editor = await createEditor({ el: document.querySelector('#canvas'), minimapEl: minimap, document: documentData, dark: false, readOnly: false,
    onChange: () => {}, onSelect: () => {}, onScale: () => {}, onError: error => result.errors.push(error.message) })
  // createEditor already waits for first full render and two rAF paints.
  result.initializationMs = performance.now() - started
  result.initialMetrics = editor.getMetrics()
  result.afterInitializationMemory = memory()
  await reportProgress('initialized')
  async function measure(name, callback) {
    const start = performance.now(), value = await callback(), callEnd = performance.now()
    await ready()
    result.operations.push({ name, startMs: start, callMs: callEnd - start, feedbackMs: performance.now() - start })
    return value
  }
  const target = `bench-${count - 1}`
  const matches = await measure('search', () => editor.search(`节点 ${count - 1} ·`))
  result.searchMatchedTarget = matches.some(node => node.uid === target)
  await measure('locate', () => editor.locate(target))
  await measure('edit', () => editor.setNodeData({ text: '编辑后的节点 · 性能测试' }))
  await editor.locate('bench-1'); await ready()
  await measure('collapse', () => editor.command('collapse'))
  await measure('expand', () => editor.command('expand'))
  const native = await measure('serialize-document', () => editor.commit())
  const json = await measure('export-json', () => JSON.stringify(encodeExport({ id: 'benchmark', name: `${count} nodes`, revision: 1 }, native)))
  const roundtrip = await measure('import-json', () => parseImport(json))
  await measure('render-import', () => editor.setDocument(roundtrip.document))
  result.exportBytes = new TextEncoder().encode(json).byteLength
  result.roundtripNodes = outlineNodes(roundtrip.document.root).length
  result.afterOperationsMemory = memory()
  result.beforeGestureMetrics = editor.getMetrics()
  await reportProgress('api-operations-complete')
  return structuredClone(result)
}

window.mindmapBenchmark = {
  async prepareDrag() {
    const count = result.nodeCount, sourceUid = `bench-${count - 1}`, targetUid = `bench-${count - 2}`
    editor.zoom(1 / editor.getMetrics().scale)
    await editor.locate(sourceUid); await ready()
    const source = topology(sourceUid), target = topology(targetUid)
    return { source, target, sourceBox: textBox(source.text), targetBox: textBox(target.text), metrics: editor.getMetrics(),
      geometry: { source: editor.getNodeGeometry(sourceUid), target: editor.getNodeGeometry(targetUid) } }
  },
  async prepareView() {
    editor.zoom(1 / editor.getMetrics().scale); await ready()
    const box = document.querySelector('#canvas').getBoundingClientRect()
    for (const [dx, dy] of [[70, 70], [120, 80], [70, 200], [box.width - 80, 70], [box.width - 80, box.height - 100]]) {
      const x = box.x + dx, y = box.y + dy, element = document.elementFromPoint(x, y)
      if (element && box.x <= x && box.y <= y && !element.closest('.smm-node')) return { x, y, view: editor.getDocument().view, metrics: editor.getMetrics() }
    }
    throw new Error('No empty canvas point available for pan gesture')
  },
  beginGesture(kind) {
    const before = editor.getDocument(), metricsBefore = editor.getMetrics()
    sampling = { kind, start: performance.now(), frames: [], running: true, before, metricsBefore }
    const session = sampling
    session.onMouseup = () => { session.release = performance.now() }
    window.addEventListener('mouseup', session.onMouseup, true)
    const frame = time => {
      if (sampling !== session || !session.running) return
      if (session.frames.at(-1) !== time) session.frames.push(time)
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    return { startMs: sampling.start }
  },
  markMovementEnd() { sampling.movementEnd = performance.now() },
  markRelease() { sampling.release = performance.now() },
  dragDiagnostics(x, y) {
    const element = document.elementFromPoint(x, y)
    return { pointerTargetTag: element?.tagName, pointerTargetClass: element?.getAttribute('class'),
      pointerTargetText: element?.closest('.smm-node')?.textContent,
      draggingNodes: [...document.querySelectorAll('.smm-node-dragging')].map(node => ({ text: node.textContent, opacity: node.getAttribute('opacity') })) }
  },
  async endGesture(extra = {}) {
    await ready()
    const ended = performance.now()
    sampling.running = false
    window.removeEventListener('mouseup', sampling.onMouseup, true)
    const after = editor.getDocument(), { start, release = start, movementEnd = release, frames } = sampling
    const gesture = { kind: sampling.kind, ...extra, startMs: start, durationMs: ended - start,
      pointerMovementMs: movementEnd - start, controlledHoverMs: Math.max(0, release - movementEnd),
      mouseupFeedbackMs: ended - release, movingFrames: frameStats(frames, start, movementEnd),
      fullGestureFrames: frameStats(frames, start, ended), metricsBefore: sampling.metricsBefore,
      metricsAfter: editor.getMetrics(), viewBefore: sampling.before.view, viewAfter: after.view,
      longTasks: result.longTasks.filter(task => task.start >= start && task.start <= ended) }
    if (extra.sourceUid) gesture.topologyAfter = topology(extra.sourceUid)
    result.gestures.push(gesture); sampling = null
    await reportProgress(`${gesture.kind}-complete`)
    return gesture
  },
  async finish() {
    await ready(); await delay(150); observer.disconnect()
    result.finalMetrics = editor.getMetrics(); result.finalMemory = memory()
    result.totalLongTaskMs = result.longTasks.reduce((sum, task) => sum + task.duration, 0)
    result.finishedAt = new Date().toISOString()
    await reportProgress('complete')
    return structuredClone(result)
  },
}
