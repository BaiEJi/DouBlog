import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const playwrightPath = process.env.PLAYWRIGHT_MODULE_PATH
const { chromium } = await import(playwrightPath ? pathToFileURL(path.resolve(playwrightPath)).href : 'playwright')
const base = process.env.MINDMAP_TEST_BASE || 'http://127.0.0.1:60111'
const output = path.resolve(process.env.MINDMAP_BENCH_OUTPUT || '../docs/mindmap-performance.json')
const sizes = (process.env.MINDMAP_BENCH_SIZES || '100,1000,5000').split(',').map(Number)
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || undefined, args: ['--enable-precise-memory-info'] })
const result = { recordedAt: new Date().toISOString(), baseUrl: base, browser: await browser.version(), node: process.version,
  headless: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
  clock: { wall: 'ISO UTC', userTimezone: 'Asia/Shanghai', latency: 'browser performance.now() monotonic milliseconds' },
  device: { platform: os.platform(), arch: os.arch(), osRelease: os.release(), cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
  method: {
    data: 'Deterministic breadth-first four-child tree with Chinese text; all 100/1000/5000 nodes expanded, viewport clipping disabled, live minimap enabled.',
    initialization: 'createEditor completion includes first full render and two rAF paints; no additional ready wait is added.',
    operations: 'callMs is elapsed API invocation (awaiting its promise if async); feedbackMs additionally waits once for core stability and two rAF. Neither is CPU-only time.',
    drag: 'Actual Playwright mouse events invoke Drag plugin; adjacent end leaves at scale 1. 24 paced movement steps followed by controlled hover to satisfy upstream 300 ms overlap-check throttle. Parent change must verify.',
    panZoom: 'Actual mouse drag on blank canvas and Control+wheel events. RAF sampling covers active input; controlled drag hover is reported separately.',
    frames: 'achievedFps counts rAF callbacks per active wall second; intervalFps is reciprocal mean interval, not idle-inclusive whole-run FPS. Dropped-frame estimates assume 60 Hz.',
    memory: 'Chromium performance.memory JS heap samples; no forced GC, no claim of peak process/GPU memory.',
    export: 'Standard product JSON serialization and actual JSON parse/render roundtrip. Image correctness checked separately by 25-node core integration tests.',
  }, requestedSizes: sizes, runs: [], browserErrors: [], status: 'running' }
const sourcePaths = [
  ...(await fs.readdir(path.resolve('src/mindmap'))).filter(name => /\.(js|jsx)$/.test(name)).map(name => `src/mindmap/${name}`),
  'tools/mindmap-benchmark.js', 'tools/run-mindmap-benchmark.mjs', 'package-lock.json',
]
result.sourceSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async file => [file,
  createHash('sha256').update(await fs.readFile(path.resolve(file))).digest('hex')])))
await fs.mkdir(path.dirname(output), { recursive: true })
const write = () => fs.writeFile(output, JSON.stringify(result, null, 2))
const ensure = (condition, message) => { if (!condition) throw new Error(message) }
await write()

try {
  const page = await browser.newPage({ viewport: result.viewport, deviceScaleFactor: 1 })
  page.on('pageerror', error => result.browserErrors.push(error.message))
  await page.exposeFunction('reportMindmapBenchmarkProgress', async progress => {
    result.phase = progress.phase
    const index = result.runs.findIndex(run => run.nodeCount === progress.nodeCount)
    if (index < 0) result.runs.push(progress)
    else result.runs[index] = progress
    await write()
  })
  for (const count of sizes) {
    console.log(`START ${count} nodes ${new Date().toISOString()}`)
    result.currentNodeCount = count; result.phase = 'initializing'; await write()
    await page.goto(`${base}/tools/mindmap-benchmark.html`)
    await page.waitForFunction(() => typeof window.runMindmapBenchmark === 'function')
    const prepared = await page.evaluate(count => window.runMindmapBenchmark(count), count)
    ensure(prepared.initialMetrics.textMeasure.svgMeasurements >= count, 'Pure-text optimization must actually measure every initial node')
    ensure(prepared.initialMetrics.textMeasure.layoutCorrections >= count, 'Stable unscaled content layout must actually cover every initial node')
    const drag = await page.evaluate(() => window.mindmapBenchmark.prepareDrag())
    const textInsideShape = ({ text, shape }) => text.x >= shape.x - 1 && text.y >= shape.y - 1
      && text.x + text.width <= shape.x + shape.width + 1 && text.y + text.height <= shape.y + shape.height + 1
    ensure(textInsideShape(drag.geometry.source) && textInsideShape(drag.geometry.target), 'Visible source/target text must remain inside its actual shape')
    if (process.env.MINDMAP_BENCH_DEBUG === '1') {
      await page.screenshot({ path: path.join(path.dirname(output), `mindmap-${count}-before-drag.png`) })
      result.dragDiagnostic = drag; await write()
    }
    const inside = point => point.cx > 5 && point.cy > 5 && point.cx < result.viewport.width - 5 && point.cy < result.viewport.height - 5
    ensure(inside(drag.sourceBox) && inside(drag.targetBox), 'Drag source/target must be genuinely visible at scale 1')
    ensure(drag.metrics.nodeCount === count && drag.metrics.renderedNodeCount === count, 'Expanded DOM count must equal requested count before drag')
    const source = drag.sourceBox, target = drag.targetBox
    const pointerBefore = await page.evaluate(({ cx, cy }) => window.mindmapBenchmark.dragDiagnostics(cx, cy), source)
    await page.mouse.move(source.cx, source.cy)
    await page.evaluate(() => window.mindmapBenchmark.beginGesture('node-drag'))
    await page.mouse.down()
    for (let step = 1; step <= 24; step++) {
      const fraction = step / 24
      await page.mouse.move(source.cx + (target.cx - source.cx) * fraction + Math.sin(Math.PI * fraction) * 38,
        source.cy + (target.cy - source.cy) * fraction)
      await page.waitForTimeout(16)
    }
    await page.evaluate(() => window.mindmapBenchmark.markMovementEnd())
    await page.waitForTimeout(340); await page.mouse.move(target.cx, target.cy); await page.waitForTimeout(340)
    const pointerAtTarget = await page.evaluate(({ cx, cy }) => window.mindmapBenchmark.dragDiagnostics(cx, cy), target)
    await page.evaluate(() => window.mindmapBenchmark.markRelease())
    await page.mouse.up()
    const dragged = await page.evaluate(extra => window.mindmapBenchmark.endGesture(extra), {
      sourceUid: drag.source.uid, targetUid: drag.target.uid, topologyBefore: drag.source,
      movementSteps: 24, inputPaceMs: 16, configuredHoverMs: 680,
      sourceBox: source, targetBox: target, pointerBefore, pointerAtTarget,
      geometryBefore: drag.geometry,
    })
    ensure(dragged.topologyAfter.parentUid === drag.target.uid && dragged.topologyAfter.parentUid !== drag.source.parentUid,
      `Drag must change source parent; observed ${JSON.stringify(dragged.topologyAfter)}`)
    ensure(dragged.metricsAfter.nodeCount === count && dragged.metricsAfter.renderedNodeCount === count, 'Drag must preserve all expanded nodes')
    const pan = await page.evaluate(() => window.mindmapBenchmark.prepareView())
    await page.mouse.move(pan.x, pan.y)
    await page.evaluate(() => window.mindmapBenchmark.beginGesture('canvas-pan'))
    await page.mouse.down()
    for (let step = 1; step <= 24; step++) {
      await page.mouse.move(pan.x + step * 5, pan.y + step * 3); await page.waitForTimeout(16)
    }
    await page.evaluate(() => { window.mindmapBenchmark.markMovementEnd(); window.mindmapBenchmark.markRelease() })
    await page.mouse.up()
    const panned = await page.evaluate(() => window.mindmapBenchmark.endGesture({ movementSteps: 24, inputPaceMs: 16 }))
    ensure(Math.abs(panned.viewAfter.state.x - panned.viewBefore.state.x) > 20 || Math.abs(panned.viewAfter.state.y - panned.viewBefore.state.y) > 20,
      'Blank-canvas drag must change view translation')
    ensure(panned.metricsAfter.renderedNodeCount === count, 'Panning must not discard offscreen nodes')
    await page.mouse.move(result.viewport.width / 2, result.viewport.height / 2)
    await page.evaluate(() => window.mindmapBenchmark.beginGesture('wheel-zoom'))
    await page.keyboard.down('Control')
    for (let step = 0; step < 12; step++) { await page.mouse.wheel(0, -80); await page.waitForTimeout(32) }
    await page.keyboard.up('Control')
    await page.evaluate(() => { window.mindmapBenchmark.markMovementEnd(); window.mindmapBenchmark.markRelease() })
    const zoomed = await page.evaluate(() => window.mindmapBenchmark.endGesture({ wheelEvents: 12, deltaY: -80, inputPaceMs: 32 }))
    ensure(zoomed.metricsAfter.scale > zoomed.metricsBefore.scale, 'Control+wheel must change zoom scale')
    ensure(zoomed.metricsAfter.renderedNodeCount === count, 'Zoom must not discard offscreen nodes')
    const completed = await page.evaluate(() => window.mindmapBenchmark.finish())
    ensure(completed.initialMetrics.renderedNodeCount === count && completed.roundtripNodes === count && completed.finalMetrics.renderedNodeCount === count,
      'Full-node render and roundtrip fidelity audit failed')
    ensure(completed.searchMatchedTarget && !completed.errors.length, 'Search/error audit failed')
    console.log(JSON.stringify({ nodes: count, initializationMs: completed.initializationMs,
      operations: completed.operations.map(({ name, callMs, feedbackMs }) => ({ name, callMs, feedbackMs })),
      gestures: completed.gestures.map(item => ({ kind: item.kind, movingFps: item.movingFrames.achievedFps,
        dropped: item.movingFrames.estimatedDroppedFramesAt60Hz, mouseupFeedbackMs: item.mouseupFeedbackMs })), longTasks: completed.longTasks.length }))
  }
  result.sourceUnchanged = (await Promise.all(sourcePaths.map(async file =>
    createHash('sha256').update(await fs.readFile(path.resolve(file))).digest('hex') === result.sourceSha256[file]))).every(Boolean)
  ensure(result.sourceUnchanged, 'Source changed during the benchmark; rerun with frozen source')
  result.targetAssessment = {
    requestedFeedbackMs: 100, requestedFps: 60,
    runs: result.runs.map(run => ({ nodeCount: run.nodeCount,
      initializationExceeds100Ms: run.initializationMs > 100,
      operationsExceeding100Ms: run.operations.filter(item => item.feedbackMs > 100).map(item => ({ name: item.name, feedbackMs: item.feedbackMs })),
      gestures: run.gestures.map(item => ({ kind: item.kind, activeRafFps: item.movingFrames.achievedFps,
        mouseupFeedbackExceeds100Ms: item.mouseupFeedbackMs > 100,
        estimatedDroppedFramesAt60Hz: item.movingFrames.estimatedDroppedFramesAt60Hz })),
    })),
  }
  result.status = 'complete'; result.finishedAt = new Date().toISOString(); await write()
  if (result.browserErrors.length) throw new Error(`Browser errors: ${result.browserErrors.join('; ')}`)
  console.log(`Saved ${output}`)
} catch (error) {
  result.status = 'failed'; result.failure = error.stack || String(error); result.finishedAt = new Date().toISOString()
  await write(); throw error
} finally { await browser.close() }
