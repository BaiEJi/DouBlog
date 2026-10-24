import { G, Text } from '@svgdotjs/svg.js'
import MindMapNode from 'simple-mind-map/src/core/render/node/MindMapNode.js'
import nodeContents from 'simple-mind-map/src/core/render/node/nodeCreateContents.js'
import nodeLayout from 'simple-mind-map/src/core/render/node/nodeLayout.js'

// Version-scoped vendor extension: 0.14.0-fix.3 measures an SVG bbox for every
// character while wrapping plain text. Canvas predicts line breaks; SVG still
// measures the final rendered group, preserving actual glyph dimensions.
// Upstream lazily copies this methods object onto the prototype in its first
// node constructor. Patch the source object too, otherwise that copy silently
// replaces a prototype-only extension before any node has used it.
const originalCreateTextNode = nodeContents.createTextNode
const originalLayout = nodeLayout.layout
const mapState = new WeakMap()

// Chromium's SVG text bbox becomes scale-dependent at tiny zoom levels (for
// example, 154 CSS px can be reported as >800 local units at scale .004).
// Upstream reads that bbox after attaching content to the scaled drawing and
// stores its resulting negative centering offset. Use the same unscaled sizes
// that constructed the node instead, so importing/editing while fitted cannot
// permanently move text outside its shape when the user zooms back in.
function wrapLine(line, maxWidth, state) {
  if (!line) return [line]
  state.canvasMeasurements++
  if (state.context.measureText(line).width <= maxWidth) return [line]
  const characters = Array.from(line), lines = []
  let start = 0
  while (start < characters.length) {
    let low = 1, high = characters.length - start, best = 1
    while (low <= high) {
      const middle = (low + high) >> 1
      state.canvasMeasurements++
      if (state.context.measureText(characters.slice(start, start + middle).join('')).width <= maxWidth) {
        best = middle; low = middle + 1
      } else high = middle - 1
    }
    lines.push(characters.slice(start, start + best).join(''))
    start += best
  }
  return lines
}

function createMeasuredPlainText(specifyText) {
  const state = mapState.get(this.mindMap)
  if (!state || this.getData('richText')) return originalCreateTextNode.call(this, specifyText)
  delete this.nodeData.data.needUpdate
  delete this.nodeData.data.resetRichText
  const text = String(typeof specifyText === 'string' ? specifyText : this.getData('text') ?? '')
  const fontSize = this.getStyle('fontSize', false)
  const font = `${this.getStyle('fontStyle', false)} ${this.getStyle('fontWeight', false)} ${fontSize}px ${this.getStyle('fontFamily', false)}`
  const maxWidth = this.mindMap.opt.textAutoWrapWidth
  const key = `${font}\u0000${maxWidth}\u0000${text}`
  let lines = state.wrapCache.get(key)
  if (!lines) {
    state.context.font = font
    lines = text.split(/\n/g).flatMap(line => wrapLine(line, maxWidth, state))
    if (lines.length > 1 && lines.at(-1) === '') lines.pop()
    if (state.wrapCache.size > 20000) state.wrapCache.clear()
    state.wrapCache.set(key, lines)
  } else state.cacheHits++
  const group = new G()
  const textAlign = this.getStyle('textAlign', false)
  const anchor = { left: 'start', center: 'middle', right: 'end' }[textAlign] || 'start'
  lines.forEach((line, index) => {
    const node = new Text().text(line || '\ufeff')
    node.addClass('smm-text-node-wrap')
    node.attr('text-anchor', anchor)
    this.style.text(node)
    node.y(fontSize * 1.2 * index + .1 * fontSize)
    group.add(node)
  })
  state.svgMeasurements++
  let { width, height } = group.bbox()
  // Canvas uses text advance, while SVG bbox uses actual glyph extents. Rare
  // font/italic overhangs fall back to the upstream exact wrapping algorithm.
  if (width > maxWidth + .5) {
    group.remove()
    state.fallbacks++
    return originalCreateTextNode.call(this, specifyText)
  }
  if (height <= 0) {
    const sample = new Text().text(this.mindMap.opt.emptyTextMeasureHeightText)
    this.style.text(sample)
    height = sample.bbox().height
    sample.remove()
  }
  width = Math.min(Math.ceil(width), maxWidth)
  height = Math.ceil(height)
  group.attr('data-width', width)
  group.attr('data-height', height)
  group.attr('data-ismultiLine', lines.length > 1)
  return { node: group, width, height }
}

nodeContents.createTextNode = createMeasuredPlainText
MindMapNode.prototype.createTextNode = createMeasuredPlainText

function layoutMeasuredContent(...args) {
  const state = mapState.get(this.mindMap)
  if (!state || !this.group || !this._textData || this.isUseCustomNodeContent()) return originalLayout.apply(this, args)
  const group = this.group, originalAdd = group.add, ownedAdd = Object.hasOwn(group, 'add')
  const restores = [], node = this
  group.add = function (element, ...rest) {
    const value = originalAdd.call(this, element, ...rest)
    if (element?.node === node._textData.node.node.parentNode) {
      const originalBox = element.bbox, ownedBox = Object.hasOwn(element, 'bbox')
      // Only this synchronous layout's centering read receives canonical sizes.
      // Export, browser geometry diagnostics and every later bbox stay native.
      const restore = () => { if (ownedBox) element.bbox = originalBox; else delete element.bbox }
      element.bbox = () => {
        restore()
        state.layoutCorrections++
        return { x: 0, y: 0, width: node._rectInfo.textContentWidth, height: node._rectInfo.textContentHeight }
      }
      restores.push(restore)
    }
    return value
  }
  try { return originalLayout.apply(this, args) }
  finally {
    for (const restore of restores) restore()
    if (ownedAdd) group.add = originalAdd; else delete group.add
  }
}
nodeLayout.layout = layoutMeasuredContent
MindMapNode.prototype.layout = layoutMeasuredContent

export default class PlainTextMeasure {
  constructor({ mindMap }) {
    this.mindMap = mindMap
    const context = document.createElement('canvas').getContext('2d')
    this.state = { context, wrapCache: new Map(), canvasMeasurements: 0, svgMeasurements: 0, cacheHits: 0, fallbacks: 0, layoutCorrections: 0 }
    if (context) mapState.set(mindMap, this.state)
  }
  metrics() {
    const { canvasMeasurements, svgMeasurements, cacheHits, fallbacks, layoutCorrections } = this.state
    return { canvasMeasurements, svgMeasurements, cacheHits, fallbacks, layoutCorrections }
  }
  beforePluginDestroy() {
    this.state.wrapCache.clear()
    mapState.delete(this.mindMap)
  }
}

PlainTextMeasure.instanceName = 'doublogTextMeasure'
PlainTextMeasure.preload = true
