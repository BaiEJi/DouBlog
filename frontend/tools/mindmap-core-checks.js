import { createEditor, parseExternalFile } from '../src/mindmap/adapter.js'
import { benchmarkDocument, outlineNodes, validateDocument } from '../src/mindmap/data.js'

let editor, changes = [], selections = [], errors = []
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function fixture() {
  const data = benchmarkDocument(25)
  const stack = [data.root]
  while (stack.length) {
    const node = stack.pop()
    const number = Number(node.data.uid.slice('bench-'.length))
    node.data.uid = `check-${number}`
    node.data.text = `主题${number}`
    stack.push(...node.children)
  }
  return data
}
function projection(node) {
  return { text: node.data.text, children: (node.children || []).map(projection) }
}
function nodeById(root, id) {
  if (root.data.uid === id) return root
  for (const child of root.children || []) {
    const found = nodeById(child, id)
    if (found) return found
  }
}
async function ready() {
  await editor.whenReady()
  await delay(150) // Upstream history collection is throttled at 100 ms.
  await editor.whenReady()
}
function resources() {
  return {
    svg: document.querySelectorAll('#canvas > svg').length,
    editBoxes: document.querySelectorAll('.smm-node-edit-wrap').length,
    tooltips: [...document.body.children].filter(el => el.style.position === 'fixed' && el.style.zIndex === '5000' && el.style.pointerEvents === 'none').length,
    styles: document.head.querySelectorAll('style').length,
  }
}

window.coreChecks = {
  async reset() {
    editor?.destroy()
    document.querySelector('#canvas').replaceChildren()
    document.querySelector('#minimap').replaceChildren()
    changes = []; selections = []; errors = []
    editor = await createEditor({ el: document.querySelector('#canvas'), minimapEl: document.querySelector('#minimap'),
      document: fixture(), onChange: data => changes.push(structuredClone(data)),
      onSelect: data => selections.push(data), onError: error => errors.push(error.message) })
    await ready()
    return this.snapshot()
  },
  ready,
  async load(document) { await editor.setDocument(document); await ready(); return this.snapshot() },
  validate() { validateDocument(editor.getDocument()); return true },
  snapshot() {
    const document = editor.getDocument()
    return { document, projection: projection(document.root), nodes: outlineNodes(document.root),
      selected: editor.getSelection(), metrics: editor.getMetrics(), changes: changes.length,
      lastChange: changes.at(-1), errors: [...errors], selections: selections.length, resources: resources() }
  },
  node(id) { return structuredClone(nodeById(editor.getDocument().root, id)) },
  async select(id) { await editor.locate(id); await ready(); return editor.getSelection() },
  async command(name, ...args) { await editor.command(name, ...args); await ready(); return this.snapshot() },
  async patch(patch) { editor.setNodeData(patch); await ready(); return this.snapshot() },
  async move(id, parent, index) { await editor.moveNode(id, parent, index); await ready(); return this.snapshot() },
  async focus(id) { await editor.focus(id); await ready(); return this.snapshot() },
  async unfocus() { await editor.unfocus(); await ready(); return this.snapshot() },
  async dark(value) { editor.setDark(value); await ready(); return this.snapshot() },
  async readonly(value) { editor.setReadOnly(value); await ready(); return this.snapshot() },
  async view() { editor.pan(70, 35); editor.zoom(1.2); editor.zoom(1 / 1.2); await ready(); return this.snapshot() },
  commit() { return editor.commit() },
  async export(type) { await editor.export(type, 'mindmap-core-25'); await ready() },
  async importText(text, name) { return parseExternalFile(new File([text], name, { type: 'text/markdown' })) },
  async importBase64(base64, name) {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
    const document = await parseExternalFile(new File([bytes], name))
    return { count: outlineNodes(document.root).length, projection: projection(document.root), document }
  },
  destroy() { editor.destroy(); return resources() },
}
