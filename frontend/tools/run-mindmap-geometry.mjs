import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH })
const results = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`${process.env.MINDMAP_TEST_BASE || 'http://127.0.0.1:60111'}/tools/mindmap-benchmark.html`)
  await page.waitForFunction(() => typeof window.runMindmapBenchmark === 'function')
  if (process.env.GEOMETRY_CORE_CHECKS !== '0') {
    await page.evaluate(() => import('/tools/mindmap-geometry-checks.js'))
    const checks = await page.evaluate(() => window.runGeometryChecks())
    await fs.writeFile(path.resolve('../docs/mindmap-geometry-core-results.json'), JSON.stringify(checks, null, 2))
    if (!checks.passed) throw new Error(`Geometry regression failed: ${JSON.stringify(checks.cases.filter(item => !item.passed).map(item => ({ layout: item.layout, failed: item.failed })))}`)
    console.log(`PASS extreme-zoom geometry ${checks.cases.length} layouts, text/icon/tag/note/link/image combinations`)
  }
  for (const count of (process.env.GEOMETRY_SIZES || '25,100').split(',').map(Number)) {
    const result = await page.evaluate(async count => {
      const { createEditor } = await import('/src/mindmap/adapter.js')
      const { benchmarkDocument } = await import('/src/mindmap/data.js')
      const fixture = benchmarkDocument(count)
      fixture.layout = 'logicalStructureLeft'
      const canvas = document.querySelector('#canvas')
      canvas.replaceChildren()
      const editor = await createEditor({ el: canvas, document: fixture, onChange: () => {}, onSelect: () => {}, onScale: () => {} })
      const uid = `bench-${count - 1}`
      const states = [{ phase: 'initial', geometry: editor.getNodeGeometry(uid) }]
      editor.fit(); await editor.whenReady()
      states.push({ phase: 'fit', geometry: editor.getNodeGeometry(uid) })
      editor.locate(uid); await editor.whenReady()
      editor.setNodeData({ text: '编辑后的节点 · 几何验证' }); await editor.whenReady()
      states.push({ phase: 'edit-while-fit', geometry: editor.getNodeGeometry(uid) })
      await editor.setDocument(editor.getDocument()); await editor.whenReady()
      states.push({ phase: 'import-while-fit', geometry: editor.getNodeGeometry(uid) })
      editor.zoom(1 / editor.getMetrics().scale); await editor.locate(uid); await editor.whenReady()
      states.push({ phase: 'locate', geometry: editor.getNodeGeometry(uid) })
      editor.setNodeData({ text: '编辑后的节点 · 几何验证' }); await editor.whenReady()
      states.push({ phase: 'edit', geometry: editor.getNodeGeometry(uid) })
      return { count, states, metrics: editor.getMetrics(), editor: (window.geometryEditor = editor, undefined) }
    }, count)
    results.push(result)
    await page.screenshot({ path: path.resolve(`../docs/mindmap-geometry-${count}.png`) })
    const restored = result.states.find(state => state.phase === 'locate').geometry
    const { text, shape } = restored
    if (text.x < shape.x - 1 || text.y < shape.y - 1 || text.x + text.width > shape.x + shape.width + 1
      || text.y + text.height > shape.y + shape.height + 1) throw new Error(`Restored text must be contained in its shape: ${JSON.stringify(restored)}`)
    if (result.metrics.nodeCount !== count || result.metrics.renderedNodeCount !== count) throw new Error('Geometry check must retain every expanded node')
    console.log(JSON.stringify({ count, passed: true, restoredText: text, restoredShape: shape, metrics: result.metrics }))
    await page.evaluate(() => window.geometryEditor.destroy())
  }
  await fs.writeFile(path.resolve('../docs/mindmap-geometry.json'), JSON.stringify(results, null, 2))
} finally { await browser.close() }
