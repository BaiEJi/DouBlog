// Product JSON stays independent of the canvas implementation.
export const FORMAT = 'doublog.mindmap'
export const SCHEMA_VERSION = 1
export const MAX_BYTES = 10 * 1024 * 1024
// Product metadata is bounded separately from the 10 MiB document payload.
export const MAX_ENVELOPE_BYTES = MAX_BYTES + 16 * 1024
export const MAX_NODES = 10000
export const MAX_SUMMARIES = 1000
export const MAX_DEPTH = 128
export const LAYOUTS = [
  ['mindMap', '思维导图'], ['logicalStructure', '向右逻辑图'],
  ['logicalStructureLeft', '向左逻辑图'], ['organizationStructure', '组织结构图'],
  ['catalogOrganization', '目录组织图'], ['fishbone', '鱼骨图'],
  ['timeline', '时间轴'], ['timeline2', '横向时间轴'], ['verticalTimeline', '垂直时间轴'],
]

export function newDocument(name = '中心主题') {
  return { root: { data: { uid: crypto.randomUUID(), text: name, expand: true }, children: [] },
    layout: 'mindMap', theme: { template: 'default', config: {} } }
}

export function nameWithSuffix(name, suffix) {
  const tail = [...suffix]
  return [...String(name)].slice(0, Math.max(0, 200 - tail.length)).join('') + suffix
}

export function safeUrl(value, image = false) {
  if (typeof value !== 'string') return false
  if (!value) return true
  if (value.includes('\\') || [...value].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return false
  if (image && /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(value)) return true
  if (image) {
    try { if (/\.svgz?$/i.test(decodeURIComponent(new URL(value, 'https://doublog.local').pathname))) return false } catch { return false }
  }
  if (/^\/(?!\/)/.test(value) || value.startsWith('#')) return true
  try { return (image ? ['http:', 'https:'] : ['http:', 'https:', 'mailto:']).includes(new URL(value).protocol) }
  catch { return false }
}

export function validateDocument(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !doc.root) throw new Error('导图必须包含根节点 root')
  if (!LAYOUTS.some(([key]) => key === doc.layout)) throw new Error('不支持的布局类型')
  const seen = new WeakSet(), ids = new Set(), summaryIds = new Set(), stack = [[doc.root, 1]]
  let summaryCount = 0
  while (stack.length) {
    const [node, depth] = stack.pop()
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('节点必须是对象')
    if (seen.has(node)) throw new Error('导图存在循环引用或重复节点')
    seen.add(node)
    if (depth > MAX_DEPTH) throw new Error(`节点层级超过 ${MAX_DEPTH} 层`)
    const data = node.data
    if (!data || typeof data.uid !== 'string' || !data.uid.trim() || [...data.uid].length > 128) throw new Error('节点必须有唯一的 uid')
    if (ids.has(data.uid)) throw new Error(`节点 ID 重复：${data.uid}`)
    ids.add(data.uid)
    if (ids.size > MAX_NODES) throw new Error(`导图最多包含 ${MAX_NODES} 个节点`)
    if (typeof data.text !== 'string') throw new Error('节点文本必须是字符串')
    if (data.hyperlink && !safeUrl(data.hyperlink)) throw new Error('节点链接仅支持 HTTP、HTTPS、邮件或站内路径')
    if (data.image && !safeUrl(data.image, true)) throw new Error('图片必须使用 HTTP、HTTPS 或 PNG/JPEG/GIF/WebP 数据')
    if (node.children !== undefined && !Array.isArray(node.children)) throw new Error('节点 children 必须是数组')
    const generalizations = data.generalization == null ? [] : Array.isArray(data.generalization) ? data.generalization : [data.generalization]
    for (const summary of generalizations) {
      if (++summaryCount > MAX_SUMMARIES) throw new Error(`导图最多包含 ${MAX_SUMMARIES} 个概要`)
      if (!summary || typeof summary !== 'object' || Array.isArray(summary) || typeof summary.text !== 'string') throw new Error('概要必须是包含 text 的对象')
      if (summary.uid !== undefined) {
        if (typeof summary.uid !== 'string' || !summary.uid.trim() || [...summary.uid].length > 128) throw new Error('概要 uid 必须是 1–128 个字符的字符串')
        if (summaryIds.has(summary.uid)) throw new Error('概要 ID 重复')
        summaryIds.add(summary.uid)
      }
      if (summary.range != null && (!Array.isArray(summary.range) || summary.range.length !== 2 ||
        !summary.range.every(Number.isInteger) || summary.range[0] < 0 || summary.range[0] > summary.range[1] || summary.range[1] >= (node.children?.length || 0))) throw new Error('概要范围必须引用有效的连续子节点')
    }
    for (const child of node.children || []) stack.push([child, depth + 1])
  }
  if ([...summaryIds].some(id => ids.has(id))) throw new Error('概要与节点 ID 重复')
  let text
  try { text = JSON.stringify(doc) } catch { throw new Error('导图必须是无循环引用的 JSON 数据') }
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('导图超过 10 MB 上限')
  // Reject prototype keys at any nesting level, including plugin configuration.
  const objects = [doc], visited = new WeakSet()
  while (objects.length) {
    const object = objects.pop()
    if (!object || typeof object !== 'object' || visited.has(object)) continue
    visited.add(object)
    for (const key of Object.keys(object)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('JSON 包含不安全的属性名')
      if (typeof object[key] === 'number' && !Number.isFinite(object[key])) throw new Error('JSON 不能包含非有限数值')
      if (key === 'richText' && object[key]) throw new Error('本版支持基础文本格式，请移除 HTML 富文本节点后导入')
      if (['hyperlinkTitle', 'imageTitle', 'attachmentName'].includes(key) && typeof object[key] === 'string' && /[<>]/.test(object[key])) throw new Error('链接、图片或附件标题不能包含尖括号')
      if (key === 'hyperlink' && object[key] && !safeUrl(object[key])) throw new Error('链接地址不安全')
      if (key === 'attachmentUrl' && object[key] && !safeUrl(object[key])) throw new Error('附件链接地址不安全')
      if (['image', 'backgroundImage'].includes(key) && object[key] && object[key] !== 'none' && !safeUrl(object[key], true)) throw new Error('图片地址或格式不安全')
      if (key === 'imgMap' && object[key] && (typeof object[key] !== 'object' || Object.values(object[key]).some(url => !safeUrl(url, true)))) throw new Error('图片映射包含不安全的地址')
      if (typeof object[key] === 'object') objects.push(object[key])
    }
  }
  return doc
}

export function outlineNodes(root) {
  const result = [], stack = [[root, 0]]
  while (stack.length) {
    const [node, depth] = stack.pop()
    if (!node?.data) continue
    result.push({ uid: node.data.uid, text: node.data.text, depth, expanded: node.data.expand !== false })
    for (let i = (node.children?.length || 0) - 1; i >= 0; i--) stack.push([node.children[i], depth + 1])
  }
  return result
}

export function encodeExport(map, document = map.document) {
  validateDocument(document)
  return { format: FORMAT, schema_version: SCHEMA_VERSION, id: map.id, name: map.name,
    workspace_id: map.workspace_id ?? null, post_id: map.post_id ?? null,
    revision: map.revision, document: structuredClone(document) }
}

export function parseImport(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_ENVELOPE_BYTES) throw new Error('JSON 文件不能超过 10 MiB + 16 KiB，导图内容上限为 10 MiB')
  let payload
  try { payload = JSON.parse(text) } catch { throw new Error('文件不是合法的 JSON') }
  if (payload?.format !== FORMAT) throw new Error('请选择 DouBlog 导图 JSON 文件')
  if (payload.schema_version !== SCHEMA_VERSION) throw new Error(`不支持的数据版本：${payload.schema_version}`)
  if (typeof payload.name !== 'string' || !payload.name.trim()) throw new Error('导图名称不能为空')
  validateDocument(payload.document)
  return payload
}

export function benchmarkDocument(count) {
  const doc = newDocument('性能测试 · 全部节点展开')
  doc.root.data.uid = 'bench-0'
  const queue = [doc.root]
  for (let i = 1; i < count; i++) {
    const parent = queue[Math.floor((i - 1) / 4)]
    const node = { data: { uid: `bench-${i}`, text: `节点 ${i} · 知识结构`, expand: true }, children: [] }
    parent.children.push(node)
    queue.push(node)
  }
  return doc
}
