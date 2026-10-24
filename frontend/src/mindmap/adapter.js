import MindMap from 'simple-mind-map'
import Drag from 'simple-mind-map/src/plugins/Drag.js'
import Select from 'simple-mind-map/src/plugins/Select.js'
import KeyboardNavigation from 'simple-mind-map/src/plugins/KeyboardNavigation.js'
import AssociativeLine from 'simple-mind-map/src/plugins/AssociativeLine.js'
import Search from 'simple-mind-map/src/plugins/Search.js'
import MiniMap from 'simple-mind-map/src/plugins/MiniMap.js'
import PlainTextMeasure from './core-text-measure.js'
import { LAYOUTS, MAX_BYTES, MAX_DEPTH, MAX_NODES, newDocument, safeUrl, validateDocument } from './data.js'
import { cloneClipboardSubtrees, collectNodeUids, pruneDanglingRelations, topLevelClipboardRoots } from './clipboard.js'

// This is the only module allowed to depend on the vendor's imperative API.
for (const plugin of [PlainTextMeasure, Drag, Select, KeyboardNavigation, AssociativeLine, Search, MiniMap]) {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Vendor static plugin API, not a React hook.
  MindMap.usePlugin(plugin)
}

const clone = value => structuredClone(value)
const uid = () => crypto.randomUUID()
const validLayouts = new Set(LAYOUTS.map(([key]) => key))
const editableFields = new Set(['text', 'note', 'tag', 'hyperlink', 'hyperlinkTitle', 'image', 'imageSize',
  'imageTitle', 'icon', 'fillColor', 'borderColor', 'borderWidth', 'borderDasharray', 'borderRadius',
  'color', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'textDecoration', 'shape',
  'lineColor', 'lineWidth', 'lineDasharray', 'textAlign'])

function visit(root, callback) {
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    if (!node?.data) continue
    callback(node)
    for (let i = (node.children?.length || 0) - 1; i >= 0; i--) stack.push(node.children[i])
  }
}

function find(root, id) {
  let found
  visit(root, node => { if (node.data.uid === id) found = node })
  return found
}

function plainText(value) {
  const parsed = new DOMParser().parseFromString(String(value || ''), 'text/html')
  return parsed.body.textContent || ''
}

function mergeConfig(base, override = {}) {
  const result = { ...base, ...override }
  for (const key of ['root', 'second', 'node', 'generalization']) result[key] = { ...base[key], ...override[key] }
  return result
}

function appearance(dark) {
  const common = { fontFamily: 'Inter, "Microsoft YaHei", sans-serif', fontSize: 14,
    borderWidth: 1, borderRadius: 7, shape: 'rectangle', paddingX: 14, paddingY: 8 }
  return {
    backgroundColor: dark ? '#111827' : '#fafbfc', lineColor: dark ? '#64748b' : '#94a3b8',
    lineWidth: 2, associativeLineColor: dark ? '#a5b4fc' : '#6366f1',
    associativeLineTextColor: dark ? '#e2e8f0' : '#334155',
    generalizationLineColor: dark ? '#94a3b8' : '#64748b',
    root: { ...common, fillColor: '#4f46e5', color: '#fff', borderColor: '#6366f1', fontWeight: 'bold', fontSize: 18 },
    second: { ...common, fillColor: dark ? '#263449' : '#eef2ff', color: dark ? '#e2e8f0' : '#312e81', borderColor: dark ? '#475569' : '#c7d2fe', marginX: 70, marginY: 24 },
    node: { ...common, fillColor: dark ? '#1e293b' : '#fff', color: dark ? '#e2e8f0' : '#334155', borderColor: dark ? '#475569' : '#e2e8f0', marginX: 45, marginY: 12 },
    generalization: { ...common, fillColor: dark ? '#263449' : '#f1f5f9', color: dark ? '#e2e8f0' : '#334155', borderColor: dark ? '#64748b' : '#cbd5e1' },
  }
}

function markdownTree(ast, filename) {
  // The upstream converter returns only root.children[0]. Assemble the parsed
  // mdast blocks under one product root so multiple H1 sections are never lost.
  const textOf = node => {
    const pieces = [], pending = [node]
    while (pending.length) {
      const current = pending.pop()
      if (typeof current.value === 'string') pieces.push(current.value)
      else if (current.type === 'image') pieces.push(current.alt || '图片')
      else for (let i = (current.children?.length || 0) - 1; i >= 0; i--) pending.push(current.children[i])
    }
    return pieces.join('')
  }
  let count = 0
  const nodeFor = block => {
    if (++count > MAX_NODES) throw new Error('Markdown 节点数量超过上限')
    return { data: { uid: uid(), text: textOf(block), expand: true }, children: [] }
  }
  const listNodes = (list, depth = 1) => {
    if (depth > MAX_DEPTH) throw new Error('Markdown 列表层级超过上限')
    return list.children.map(item => {
      const content = item.children.filter(child => child.type !== 'list')
      const node = nodeFor({ children: content })
      for (const child of item.children) if (child.type === 'list') node.children.push(...listNodes(child, depth + 1))
      return node
    })
  }
  const roots = [], headings = [{ depth: 0, children: roots }]
  for (const block of ast.children) {
    if (block.type === 'heading') {
      while (headings.length > 1 && headings.at(-1).depth >= block.depth) headings.pop()
      const node = nodeFor(block)
      headings.at(-1).children.push(node)
      headings.push({ depth: block.depth, children: node.children })
    } else if (block.type === 'list') {
      headings.at(-1).children.push(...listNodes(block))
    } else if (block.type !== 'thematicBreak' && block.type !== 'definition') {
      const node = nodeFor(block)
      if (node.data.text.trim()) headings.at(-1).children.push(node)
    }
  }
  if (!roots.length) throw new Error('Markdown 中没有可导入的文本')
  if (roots.length === 1) return roots[0]
  return { data: { uid: uid(), text: filename || 'Markdown 导图', expand: true }, children: roots }
}

// Imported formats provide content, not product identity/revision. JSON envelopes
// are parsed by data.js and the API layer, before the current editor is replaced.
export async function parseExternalFile(file) {
  if (!file || file.size > MAX_BYTES) throw new Error('导入文件不能超过 10 MB')
  const extension = file.name.split('.').pop().toLowerCase()
  let root
  if (extension === 'xmind') {
    // Check archive expansion before the upstream parser allocates image data.
    const { default: JSZip } = await import('jszip')
    const archive = await JSZip.loadAsync(file)
    const entries = Object.values(archive.files)
    let total = 0
    for (const entry of entries) total += entry._data?.uncompressedSize || 0
    if (entries.length > 2000 || total > 30 * 1024 * 1024) throw new Error('XMind 解压后内容过大')
    const { default: parser } = await import('simple-mind-map/src/parse/xmind.js')
    root = await parser.parseXmindFile(file)
  } else if (['md', 'markdown'].includes(extension)) {
    const { fromMarkdown } = await import('mdast-util-from-markdown')
    root = markdownTree(fromMarkdown(await file.text()), file.name.replace(/\.(?:md|markdown)$/i, ''))
  } else {
    throw new Error('请选择 .xmind、.md 或 .markdown 文件；JSON 请通过标准导入入口打开')
  }
  if (!root?.data) throw new Error('文件中没有可导入的主题或标题')
  let count = 0
  const stack = [[root, 0]]
  while (stack.length) {
    const [node, depth] = stack.pop()
    if (++count > MAX_NODES || depth > MAX_DEPTH) throw new Error('导图节点数量或层级超过上限')
    node.data.uid = uid()
    node.data.text = String(node.data.text ?? '')
    node.data.richText = false
    node.data.expand = node.data.expand !== false
    if (node.data.note) node.data.note = plainText(node.data.note)
    if (node.data.image && /\.svgz?(?:[?#]|$)/i.test(node.data.image)) throw new Error('不支持 SVG 节点图片')
    for (const summary of node.data.generalization || []) {
      summary.uid = uid()
      summary.text = String(summary.text ?? '')
      summary.richText = false
    }
    for (const child of node.children || []) stack.push([child, depth + 1])
  }
  const document = { ...newDocument(), root }
  validateDocument(document)
  return document
}

export async function createEditor({ el, document: initialDocument, dark = false, readOnly = false,
  minimapEl, onChange = () => {}, onSelect = () => {}, onScale = () => {}, onError = () => {} }) {
  validateDocument(initialDocument)
  await window.document.fonts.ready
  let completeDocument = clone(initialDocument)
  let storedTheme = clone(initialDocument.theme || { template: 'default', config: {} })
  let isDark = dark, isReadOnly = readOnly, destroyed = false, suppress = true
  let focusId = null, focusExpand = true, normalView = null
  let notifyTimer, miniTimer, miniFrame, lastSelection = [], miniGeometry = null
  const listeners = []
  const pendingRenders = new Set()
  const tooltip = window.document.createElement('div')
  Object.assign(tooltip.style, { position: 'fixed', display: 'none', maxWidth: '360px', whiteSpace: 'pre-wrap',
    background: '#1e293b', color: '#f8fafc', border: '1px solid #64748b', borderRadius: '8px', padding: '10px 12px',
    fontSize: '13px', zIndex: '5000', pointerEvents: 'none' })
  window.document.body.appendChild(tooltip)

  const core = new MindMap({
    el, data: clone(initialDocument.root), layout: initialDocument.layout,
    theme: storedTheme.template || 'default', themeConfig: mergeConfig(appearance(isDark), storedTheme.config),
    viewData: initialDocument.view || null, readonly: isReadOnly, fit: !initialDocument.view,
    textAutoWrapWidth: 280, maxHistoryCount: 80, addHistoryTime: 100,
    maxNodeCacheCount: 10000, openPerformance: false, openRealtimeRenderOnNodeTextEdit: false,
    enableShortcutOnlyWhenMouseInSvg: true, enableDblclickBackToRootNode: false,
    defaultInsertSecondLevelNodeText: '分支主题', defaultInsertBelowSecondLevelNodeText: '子主题',
    beforeTextEdit: () => !isReadOnly,
    customCheckEnableShortcut: event => !isReadOnly && !event.isComposing &&
      (event.target === window.document.body || core.editNodeClassList.some(name => event.target.classList?.contains(name))),
    customHyperlinkJump: link => { if (safeUrl(link) && link) window.open(link, '_blank', 'noopener,noreferrer') },
    customHandleClipboardText: text => {
      let payload
      try { payload = JSON.parse(text) } catch { return text }
      if (!payload?.simpleMindMap) return text
      try {
        const roots = Array.isArray(payload.data) ? payload.data : [payload.data]
        const wrapped = newDocument('剪贴板')
        wrapped.root.children = topLevelClipboardRoots(clone(roots))
        // Upstream copy intentionally removes ids, then regenerates on paste.
        visit(wrapped.root, node => {
          if (!node.data.uid) node.data.uid = uid()
          const summaries = node.data.generalization == null ? [] : Array.isArray(node.data.generalization) ? node.data.generalization : [node.data.generalization]
          for (const summary of summaries) if (!summary.uid) summary.uid = uid()
        })
        validateDocument(wrapped)
        return { ...payload, data: wrapped.root.children }
      } catch (error) {
        onError(error)
        // Returning an empty string stops the vendor's unsafe native fallback.
        return ''
      }
    },
    customNoteContentShow: {
      show: (note, left, top) => {
        tooltip.textContent = String(note)
        Object.assign(tooltip.style, { display: 'block', left: `${Math.max(8, Math.min(left, window.innerWidth - 380))}px`, top: `${Math.max(8, Math.min(top, window.innerHeight - 150))}px` })
      },
      hide: () => { tooltip.style.display = 'none' },
    },
    handleNodePasteImg: async blob => {
      if (!/^image\/(png|jpeg|gif|webp)$/.test(blob.type) || blob.size > MAX_BYTES) throw new Error('仅支持 10 MB 以内的 PNG/JPEG/GIF/WebP 图片')
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      const bitmap = await createImageBitmap(blob)
      const size = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      return { url, size }
    },
    errorHandler: (type, error) => {
      if (type === 'read_clipboard_error' && core.renderer.beingCopyData && !isReadOnly) {
        core.execCommand('PASTE_NODE', clone(core.renderer.beingCopyData))
        return
      }
      onError(error instanceof Error ? error : new Error(String(type)))
    },
  })

  // Imperative vendor commands are also guarded, covering shortcuts and plugins.
  // Navigation may expand branches in read-only mode without authorizing editing.
  const originalExec = core.command.exec.bind(core.command)
  const readonlyCommands = new Set(['SET_NODE_ACTIVE', 'CLEAR_ACTIVE_NODE', 'SELECT_ALL', 'GO_TARGET_NODE', 'SET_NODE_EXPAND'])
  core.command.exec = (name, ...args) => {
    if (['REMOVE_NODE', 'CUT_NODE', 'REMOVE_CURRENT_NODE'].includes(name)) {
      const appointed = Array.isArray(args[0]) ? args[0] : []
      const targets = appointed.length ? appointed : core.renderer.activeNodeList
      // Upstream Del on the root clears every child, which is too destructive
      // for a protected product root and must also be blocked for shortcuts.
      if (targets.some(node => node.isRoot)) { onError(new Error('不能删除或剪切根主题')); return }
    }
    if (isReadOnly && !readonlyCommands.has(name) &&
      !(name === 'SET_NODE_DATA' && Object.keys(args[1] || {}).every(key => ['isActive', 'expand'].includes(key)))) return
    if (name === 'INSERT_MULTI_CHILD_NODE') {
      try { return pasteSubtrees(args[0], args[1]) }
      catch (error) { onError(error); return }
    }
    originalExec(name, ...args)
  }
  function pasteSubtrees(appointed, source) {
    if (!Array.isArray(source) || !source.length) return
    const appointedNodes = Array.isArray(appointed) ? appointed : appointed ? [appointed] : []
    const targets = (appointedNodes.length ? appointedNodes : [...core.renderer.activeNodeList]).filter(node => !node.isGeneralization)
    if (!targets.length) return
    const proposed = getDocument(), existingUids = collectNodeUids(proposed.root), byUid = new Map()
    visit(proposed.root, node => byUid.set(node.data.uid, node))
    const plans = targets.map(target => {
      const destination = byUid.get(target.getData('uid'))
      if (!destination) throw new Error('粘贴目标已不存在')
      const { nodes } = cloneClipboardSubtrees(source, { existingUids })
      destination.children = [...(destination.children || []), ...nodes]
      destination.data.expand = true
      for (const id of collectNodeUids(nodes)) existingUids.add(id)
      return { target, nodes }
    })
    // Reject invalid content, counts, depth or size before touching the canvas.
    validateDocument(proposed)
    const paused = core.command.isPause
    core.command.pause()
    try {
      for (const plan of plans) originalExec('INSERT_MULTI_CHILD_NODE', [plan.target], plan.nodes)
    } finally {
      if (!paused) { core.command.recovery(); core.command.originAddHistory() }
    }
    changed()
  }
  async function writeClipboard(data) {
    if (!data || !navigator.clipboard?.writeText) return
    try { await navigator.clipboard.writeText(JSON.stringify({ simpleMindMap: true, data })) }
    catch { onError(new Error('系统剪贴板不可用，节点已保留在导图内部剪贴板，可继续粘贴')) }
  }
  function captureClipboard() {
    hideEdit()
    const full = getDocument(), selected = new Set(getSelection().map(item => item.uid)), roots = []
    visit(full.root, node => { if (selected.has(node.data.uid)) roots.push(node) })
    return clone(topLevelClipboardRoots(roots))
  }
  core.renderer.copy = () => {
    const data = captureClipboard()
    core.renderer.beingCopyData = data
    return writeClipboard(data)
  }
  core.renderer.cut = () => {
    const data = captureClipboard()
    let copying = Promise.resolve()
    core.execCommand('CUT_NODE', () => {
      core.renderer.beingCopyData = data
      copying = writeClipboard(data)
    })
    return copying
  }

  function listen(name, callback) { core.on(name, callback); listeners.push([name, callback]) }
  function rendered() {
    return new Promise(resolve => {
      if (destroyed) return resolve()
      const done = () => { core.off('node_tree_render_end', done); pendingRenders.delete(done); resolve() }
      pendingRenders.add(done)
      core.on('node_tree_render_end', done)
    })
  }
  function hideEdit() { if (!destroyed) core.renderer.textEdit.hideEditTextBox() }
  function commit() {
    hideEdit()
    emitChanges()
    return getDocument()
  }
  function getRawDocument() {
    const current = core.getData(true)
    visit(current.root, node => {
      delete node.inserting
      delete node.data.needUpdate
      delete node.data.resetRichText
    })
    if (!focusId) return { ...current, theme: clone(storedTheme) }
    const full = clone(completeDocument)
    const original = find(full.root, focusId)
    if (original && current.root) {
      const branch = clone(current.root)
      branch.data.expand = focusExpand
      delete branch.smmVersion
      Object.assign(original, branch)
    }
    full.layout = current.layout
    full.theme = clone(storedTheme)
    full.view = clone(normalView || full.view)
    return full
  }
  function cleanSnapshot(snapshot) {
    snapshot.root = pruneDanglingRelations(snapshot.root, { inPlace: true })
    visit(snapshot.root, node => { if (node.data.generalization == null) delete node.data.generalization })
    return snapshot
  }
  function getDocument() { return cleanSnapshot(getRawDocument()) }
  function signature(doc) { return JSON.stringify([doc.root, doc.layout, doc.theme]) }
  let lastSignature = ''
  function emitChanges() {
    if (suppress || destroyed || isReadOnly) return
    const raw = getRawDocument()
    // Keep out-of-focus incoming references in the private base. A focused
    // deletion removes them from exported data, while undo can restore them.
    const unpruned = focusId ? clone(raw) : null
    const next = cleanSnapshot(raw), nextSignature = signature(next)
    if (nextSignature === lastSignature) return
    lastSignature = nextSignature
    completeDocument = unpruned || clone(next)
    onChange(next)
  }
  function changed() {
    if (suppress || destroyed || isReadOnly) return
    clearTimeout(notifyTimer)
    notifyTimer = setTimeout(() => {
      if (suppress || destroyed || isReadOnly) return
      emitChanges()
    }, 0)
  }
  function getSelection() {
    const nodes = core.renderer.activeNodeList
    return nodes.length ? nodes.map(node => ({ uid: node.getData('uid'), data: clone(node.getData()) })) : clone(lastSelection)
  }
  function selectChanged(_node, nodes = []) {
    lastSelection = nodes.map(node => ({ uid: node.getData('uid'), data: clone(node.getData()) }))
    onSelect(clone(lastSelection))
  }
  listen('node_active', selectChanged)
  listen('node_click', node => {
    if (isReadOnly) { lastSelection = [{ uid: node.getData('uid'), data: clone(node.getData()) }]; onSelect(clone(lastSelection)) }
  })
  listen('data_change', changed)
  listen('layout_change', changed)
  // History/data_change already reports edits. Render completion also fires for
  // selection/theme/layout, and must not serialize a 5000-node tree each time.
  listen('node_tree_render_end', () => scheduleMini(true))
  listen('view_data_change', () => scheduleMini(false))
  listen('scale', value => onScale(value))

  // The native MiniMap API clones the entire SVG. The live overview below caches
  // layout geometry instead, so panning only updates its viewport rectangle.
  let miniCanvas, miniViewport
  if (minimapEl) {
    miniCanvas = window.document.createElement('canvas')
    miniViewport = window.document.createElement('div')
    if (window.getComputedStyle(minimapEl).position === 'static') minimapEl.style.position = 'relative'
    Object.assign(minimapEl.style, { overflow: 'hidden', cursor: 'crosshair' })
    Object.assign(miniCanvas.style, { width: '100%', height: '100%', display: 'block' })
    Object.assign(miniViewport.style, { position: 'absolute', border: '1px solid #818cf8', background: 'rgba(99,102,241,.12)', pointerEvents: 'none' })
    minimapEl.append(miniCanvas, miniViewport)
  }
  function scheduleMini(rebuild) {
    if (!minimapEl || destroyed) return
    if (rebuild) {
      clearTimeout(miniTimer)
      miniTimer = setTimeout(() => { miniGeometry = null; drawMini() }, 120)
    } else if (!miniFrame) {
      miniFrame = requestAnimationFrame(() => { miniFrame = null; drawMini() })
    }
  }
  function drawMini() {
    if (!miniCanvas || destroyed || !core.renderer.root) return
    const width = minimapEl.clientWidth || 200, height = minimapEl.clientHeight || 120
    if (!miniGeometry || miniGeometry.width !== width || miniGeometry.height !== height) {
      const nodes = Object.values(core.renderer.nodeCache).filter(node => Number.isFinite(node.left) && Number.isFinite(node.top))
      if (!nodes.length) return
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const node of nodes) {
        minX = Math.min(minX, node.left); minY = Math.min(minY, node.top)
        maxX = Math.max(maxX, node.left + node.width); maxY = Math.max(maxY, node.top + node.height)
      }
      const scale = Math.min((width - 14) / Math.max(1, maxX - minX), (height - 14) / Math.max(1, maxY - minY))
      const offsetX = (width - (maxX - minX) * scale) / 2 - minX * scale
      const offsetY = (height - (maxY - minY) * scale) / 2 - minY * scale
      miniGeometry = { width, height, scale, offsetX, offsetY }
      const ratio = window.devicePixelRatio || 1
      miniCanvas.width = Math.round(width * ratio); miniCanvas.height = Math.round(height * ratio)
      const context = miniCanvas.getContext('2d')
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.fillStyle = isDark ? '#172033' : '#f8fafc'; context.fillRect(0, 0, width, height)
      context.strokeStyle = isDark ? '#64748b' : '#cbd5e1'; context.lineWidth = .6
      context.beginPath()
      for (const node of nodes) if (node.parent) {
        context.moveTo((node.parent.left + node.parent.width / 2) * scale + offsetX, (node.parent.top + node.parent.height / 2) * scale + offsetY)
        context.lineTo((node.left + node.width / 2) * scale + offsetX, (node.top + node.height / 2) * scale + offsetY)
      }
      context.stroke()
      context.fillStyle = isDark ? '#a5b4fc' : '#6366f1'
      for (const node of nodes) context.fillRect(node.left * scale + offsetX, node.top * scale + offsetY, Math.max(2, node.width * scale), Math.max(2, node.height * scale))
    }
    const { scale, offsetX, offsetY } = miniGeometry
    const transform = core.draw.transform(), viewScale = transform.scaleX || 1
    Object.assign(miniViewport.style, { left: `${(-transform.translateX / viewScale) * scale + offsetX}px`,
      top: `${(-transform.translateY / viewScale) * scale + offsetY}px`,
      width: `${core.width / viewScale * scale}px`, height: `${core.height / viewScale * scale}px` })
  }
  function miniClick(event) {
    if (!miniGeometry) return
    const box = minimapEl.getBoundingClientRect(), { scale, offsetX, offsetY } = miniGeometry
    const x = (event.clientX - box.left - offsetX) / scale, y = (event.clientY - box.top - offsetY) / scale
    core.view.translateXTo(core.width / 2 - x * core.view.scale)
    core.view.translateYTo(core.height / 2 - y * core.view.scale)
  }
  minimapEl?.addEventListener('click', miniClick)
  function readonlyPointer(event) {
    if (isReadOnly && event.target.closest?.('.smm-associative-line-container')) event.stopImmediatePropagation()
  }
  for (const event of ['mousedown', 'dblclick']) el.addEventListener(event, readonlyPointer, true)
  const observer = new ResizeObserver(() => { if (!destroyed && el.clientWidth && el.clientHeight) core.resize() })
  observer.observe(el)

  async function replaceDocument(next) {
    validateDocument(next)
    hideEdit()
    suppress = true
    focusId = null; normalView = null; lastSelection = []
    completeDocument = clone(next); storedTheme = clone(next.theme || { template: 'default', config: {} })
    const ready = rendered()
    core.setFullData({ ...clone(next), theme: { template: storedTheme.template || 'default', config: mergeConfig(appearance(isDark), storedTheme.config) } })
    await ready
    if (!next.view) core.view.fit()
    lastSignature = signature(getDocument())
    suppress = false
    onSelect([])
    scheduleMini(true)
  }
  async function focus(id) {
    hideEdit()
    emitChanges()
    const full = getDocument(), target = find(full.root, id)
    if (!target || target === full.root) return
    suppress = true
    completeDocument = full
    normalView = full.view
    focusId = id; focusExpand = target.data.expand
    const branch = clone(target); branch.data.expand = true
    const ready = rendered()
    core.setData(branch)
    await ready
    core.view.fit()
    lastSignature = signature(getDocument())
    suppress = false
    lastSelection = []; onSelect([])
  }
  async function unfocus() {
    if (!focusId) return
    hideEdit()
    emitChanges()
    const full = getDocument()
    suppress = true
    completeDocument = full; focusId = null
    const ready = rendered()
    core.setData(clone(full.root))
    await ready
    if (normalView) core.view.setTransformData(normalView)
    normalView = null
    lastSignature = signature(getDocument())
    suppress = false
    lastSelection = []; onSelect([])
  }

  const mutable = () => { if (isReadOnly) throw new Error('当前为只读模式') }
  function ensureSelection() {
    if (!core.renderer.activeNodeList.length && core.renderer.root && !isReadOnly) core.renderer.root.active()
    return [...core.renderer.activeNodeList]
  }
  function setNodeData(patch) {
    mutable()
    const clean = {}
    for (const [key, value] of Object.entries(patch)) if (editableFields.has(key)) clean[key] = clone(value)
    if (clean.hyperlink && !safeUrl(clean.hyperlink)) throw new Error('链接地址不安全')
    for (const key of ['hyperlinkTitle', 'imageTitle']) {
      if (typeof clean[key] === 'string' && /[<>]/.test(clean[key])) throw new Error('链接和图片标题不能包含 < 或 >')
    }
    if (clean.image && (!safeUrl(clean.image, true) || /\.svgz?(?:[?#]|$)/i.test(clean.image))) throw new Error('图片地址不安全；不支持 SVG 图片')
    if ('text' in clean) clean.text = String(clean.text ?? '')
    if (clean.image && !clean.imageSize) clean.imageSize = { width: 200, height: 130 }
    const nodes = ensureSelection()
    const proposed = getDocument()
    for (const node of nodes) {
      const selected = find(proposed.root, node.getData('uid'))
      if (selected) Object.assign(selected.data, clean)
    }
    validateDocument(proposed)
    for (const node of nodes) core.execCommand('SET_NODE_STYLES', node, clean)
    changed()
    onSelect(getSelection())
  }
  function command(name, ...args) {
    if (!['copy', 'selectAll', 'collapse', 'expand'].includes(name)) mutable()
    const nodes = isReadOnly ? getSelection().map(node => core.renderer.findNodeByUid(node.uid)).filter(Boolean) : ensureSelection()
    switch (name) {
      case 'addChild': core.execCommand('INSERT_CHILD_NODE'); break
      case 'addSibling':
        if (nodes.some(node => node.isRoot)) throw new Error('根主题没有同级节点，请新增子主题')
        core.execCommand('INSERT_NODE'); break
      case 'edit': if (nodes[0]) core.renderer.textEdit.show({ node: nodes[0] }); break
      case 'delete':
        if (nodes.some(node => node.isRoot)) throw new Error('不能删除根主题')
        core.execCommand('REMOVE_NODE'); break
      case 'copy': return core.renderer.copy()
      case 'cut':
        if (nodes.some(node => node.isRoot)) throw new Error('不能剪切根主题')
        return core.renderer.cut()
      case 'paste': return core.renderer.paste()
      case 'undo': core.execCommand('BACK'); break
      case 'redo': core.execCommand('FORWARD'); break
      case 'collapse': for (const node of nodes) if (!node.isRoot) core.execCommand('SET_NODE_EXPAND', node, false); break
      case 'expand': for (const node of nodes) core.execCommand('SET_NODE_EXPAND', node, true); break
      case 'up': core.execCommand('UP_NODE'); break
      case 'down': core.execCommand('DOWN_NODE'); break
      case 'addRelation':
        if (nodes.length > 1) core.associativeLine.addLine(nodes[0], nodes[1])
        else if (nodes.length) core.associativeLine.createLineFromActiveNode()
        break
      case 'addSummary': core.execCommand('ADD_GENERALIZATION', { text: args[0] || '概要' }, false); break
      case 'selectAll': core.execCommand('SELECT_ALL'); break
      case 'resetLayout': core.execCommand('RESET_LAYOUT'); break
      default: throw new Error(`不支持的编辑操作：${name}`)
    }
    changed()
  }
  async function locate(id) {
    if (focusId && !find(core.renderer.renderTree, id)) await unfocus()
    core.execCommand('GO_TARGET_NODE', id, node => {
      if (isReadOnly) node.highlight()
    })
  }
  function search(query) {
    const text = String(query || '').trim().toLocaleLowerCase(), results = []
    if (!text) { core.search.endSearch(); return results }
    visit(getDocument().root, node => {
      if (node.data.text.toLocaleLowerCase().includes(text)) results.push({ uid: node.data.uid, text: node.data.text })
    })
    return results
  }
  async function exportDocument(type, name = '思维导图') {
    hideEdit()
    emitChanges()
    // Export always means the complete confirmed editing data, including while focused.
    if (focusId) await unfocus()
    const format = type === 'markdown' ? 'md' : type
    if (!['json', 'md', 'svg', 'png', 'xmind'].includes(format)) throw new Error('不支持的导出格式')
    const { default: Export } = await import('simple-mind-map/src/plugins/Export.js')
    if (!core.doExport) core.addPlugin(Export)
    if (format === 'xmind') {
      const { default: ExportXMind } = await import('simple-mind-map/src/plugins/ExportXMind.js')
      if (!core.doExportXMind) core.addPlugin(ExportXMind)
    }
    // Vendor's SVG <title> is constructed from markup, so encode the filename there.
    const safeName = String(name).replace(/[<>"&]/g, '') || '思维导图'
    return core.doExport.export(format, true, safeName)
  }
  function setTheme(template, config = {}) {
    mutable()
    storedTheme = { template: template || 'default', config: clone(config) }
    core.setTheme(storedTheme.template, true)
    core.setThemeConfig(mergeConfig(appearance(isDark), storedTheme.config))
    changed()
  }
  function setDark(value) {
    isDark = Boolean(value)
    core.setThemeConfig(mergeConfig(appearance(isDark), storedTheme.config))
    scheduleMini(true)
  }
  function setReadOnly(value) {
    hideEdit()
    emitChanges()
    isReadOnly = Boolean(value)
    core.setMode(isReadOnly ? 'readonly' : 'edit')
    if (isReadOnly) core.keyCommand.pause()
    else core.keyCommand.recovery()
  }

  async function whenReady() {
    // Let the vendor's setTimeout(0) render queue start, then wait for real paint.
    await new Promise(resolve => setTimeout(resolve, 0))
    if (!destroyed && (core.renderer.isRendering || core.renderer.hasWaitRendering)) await rendered()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }
  async function moveNode(nodeId, parentId, index) {
    mutable()
    if (focusId) await unfocus()
    const data = getDocument()
    const source = find(data.root, nodeId), destination = find(data.root, parentId)
    if (!source || !destination) throw new Error('移动的节点或目标父节点不存在')
    if (source === data.root) throw new Error('不能移动根主题')
    if (find(source, parentId)) throw new Error('不能将节点移动到自身或后代节点下')
    core.execCommand('GO_TARGET_NODE', parentId)
    await whenReady()
    core.execCommand('GO_TARGET_NODE', nodeId)
    await whenReady()
    const node = core.renderer.findNodeByUid(nodeId), parent = core.renderer.findNodeByUid(parentId)
    core.execCommand('MOVE_NODE_TO', node, parent)
    await whenReady()
    const updatedParent = core.renderer.findNodeByUid(parentId)
    const otherChildren = updatedParent.children.filter(child => child.getData('uid') !== nodeId)
    if (Number.isInteger(index) && index >= 0 && index < otherChildren.length) {
      core.execCommand('INSERT_BEFORE', core.renderer.findNodeByUid(nodeId), otherChildren[index])
    }
    changed()
    await whenReady()
  }

  await rendered()
  await whenReady()
  if (destroyed) throw new Error('编辑器已卸载')
  if (isReadOnly) core.keyCommand.pause()
  lastSignature = signature(getDocument())
  suppress = false
  onScale(core.view.scale)
  scheduleMini(true)
  return {
    getDocument, commit, setDocument: replaceDocument, getSelection, command, setNodeData, setTheme, setDark, setReadOnly,
    setLayout: name => { mutable(); if (!validLayouts.has(name)) throw new Error('不支持的布局'); core.setLayout(name); changed() },
    zoom: factor => core.view.setScale(Math.max(.05, Math.min(4, core.view.scale * factor)), core.width / 2, core.height / 2),
    fit: () => core.view.fit(), center: () => core.renderer.setRootNodeCenter(), search, locate, focus, unfocus,
    export: exportDocument, parseExternalFile,
    whenReady, moveNode, pan: (dx, dy) => core.view.translateXY(dx, dy),
    getMetrics: () => {
      let nodeCount = 0
      visit(getDocument().root, () => nodeCount++)
      return { nodeCount, renderedNodeCount: el.querySelectorAll('.smm-node').length, scale: core.view.scale,
        textMeasure: core.doublogTextMeasure.metrics() }
    },
    getNodeGeometry: id => {
      const node = core.renderer.findNodeByUid(id)
      if (!node?.group) return null
      const bounds = element => {
        const box = element?.getBoundingClientRect()
        return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
      }
      return { uid: id, left: node.left, top: node.top, width: node.width, height: node.height, dir: node.dir,
        transform: core.draw.transform(), group: bounds(node.group.node),
        textLocal: node._textData ? { width: node._textData.width, height: node._textData.height,
          rectInfo: { ...node._rectInfo }, bbox: node._textData.node.bbox(), transform: node._textData.node.attr('transform'),
          contentBBox: node._textData.node.parent()?.bbox(), contentTransform: node._textData.node.parent()?.attr('transform') } : null,
        shape: bounds(node.group.node.querySelector('.smm-node-shape')),
        text: bounds(node.group.node.querySelector('.smm-text-node-wrap')) }
    },
    getMiniMap: (width = 200, height = 120) => core.miniMap.calculationMiniMap(width, height),
    getMiniMapData: (width = 200, height = 120) => core.miniMap.calculationMiniMap(width, height),
    destroy: () => {
      if (destroyed) return
      hideEdit()
      emitChanges()
      destroyed = true
      clearTimeout(notifyTimer); clearTimeout(miniTimer); cancelAnimationFrame(miniFrame)
      observer.disconnect()
      minimapEl?.removeEventListener('click', miniClick)
      miniCanvas?.remove(); miniViewport?.remove(); tooltip.remove()
      for (const event of ['mousedown', 'dblclick']) el.removeEventListener(event, readonlyPointer, true)
      for (const [name, callback] of listeners) core.off(name, callback)
      for (const done of pendingRenders) done()
      core.destroy()
    },
  }
}
