import { createEditor } from '../src/mindmap/adapter.js'
import { benchmarkDocument, outlineNodes, LAYOUTS } from '../src/mindmap/data.js'

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
window.runGeometryChecks = async () => {
  const cases = [], errors = []
  const canvas = document.querySelector('#canvas')
  const contains = ({ text, shape }) => text.x >= shape.x - 1 && text.y >= shape.y - 1
    && text.x + text.width <= shape.x + shape.width + 1 && text.y + text.height <= shape.y + shape.height + 1
  for (const [layout] of LAYOUTS) {
    const fixture = benchmarkDocument(25)
    fixture.layout = layout
    const nodes = []
    const collect = node => { nodes.push(node); node.children.forEach(collect) }
    collect(fixture.root)
    for (const [index, placement] of ['top', 'bottom', 'left', 'right'].entries()) {
      Object.assign(nodes.at(-1 - index).data, { text: `图标标签组合${index}\n第二行文本`, note: '几何回归备注',
        icon: ['emote_1'], tag: ['标签一', '标签二'], hyperlink: 'https://example.com', hyperlinkTitle: '示例',
        image: pixel, imageSize: { width: 48, height: 32, custom: true }, imgPlacement: placement,
        tagPlacement: index % 2 ? 'bottom' : 'right' })
    }
    const editor = await createEditor({ el: canvas, document: fixture, onChange: () => {}, onSelect: () => {}, onError: error => errors.push(error.message) })
    editor.zoom(.004 / editor.getMetrics().scale)
    await editor.locate('bench-24'); await editor.whenReady()
    editor.setNodeData({ text: '极小缩放编辑后\n第二行✓' }); await editor.whenReady()
    await editor.setDocument(editor.getDocument()); await editor.whenReady()
    editor.zoom(1 / editor.getMetrics().scale); await editor.locate('bench-24'); await editor.whenReady()
    const geometry = outlineNodes(editor.getDocument().root).map(node => editor.getNodeGeometry(node.uid))
    const escaped = geometry.filter(node => !contains(node))
    cases.push({ layout, nodes: geometry.length, failed: escaped, passed: escaped.length === 0,
      sample: geometry.find(node => node.uid === 'bench-24'), metrics: editor.getMetrics() })
    editor.destroy()
  }
  return { cases, errors, passed: cases.every(item => item.passed) && errors.length === 0 }
}
