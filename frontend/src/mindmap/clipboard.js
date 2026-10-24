// Pure document operations. The canvas adapter decides when to apply the result
// so a paste/delete and its relation cleanup remain one undoable command.
const clone = value => structuredClone(value)
const relationArrays = ['associativeLinePoint', 'associativeLineTargetControlOffsets']
const relationMaps = ['associativeLineText', 'associativeLineStyle']

function asForest(value) {
  return Array.isArray(value) ? value : [value]
}

function walk(roots, visit) {
  const seen = new WeakSet(), stack = [...roots].reverse()
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || !node.data || typeof node.data !== 'object') throw new Error('剪贴板节点缺少 data 对象')
    if (seen.has(node)) throw new Error('剪贴板存在循环引用或重复节点')
    seen.add(node)
    if (node.children !== undefined && !Array.isArray(node.children)) throw new Error('剪贴板节点 children 必须是数组')
    visit(node)
    for (let index = (node.children?.length || 0) - 1; index >= 0; index--) stack.push(node.children[index])
  }
}

function summaries(data) {
  if (data.generalization == null) return []
  const list = Array.isArray(data.generalization) ? data.generalization : [data.generalization]
  if (list.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('剪贴板概要格式错误')
  return list
}

/** Keep only selected top-level subtrees, even when a nested selection was serialized separately. */
export function topLevelClipboardRoots(rootOrRoots) {
  const roots = asForest(rootOrRoots), descendants = new WeakSet(), descendantIds = new Set()
  for (const root of roots) {
    const ids = new Set()
    walk([root], node => {
      const uid = node.data.uid
      if (uid && ids.has(uid)) throw new Error(`剪贴板节点 UID 重复：${uid}`)
      if (uid) ids.add(uid)
      if (node !== root) {
        descendants.add(node)
        if (typeof uid === 'string' && uid) descendantIds.add(uid)
      }
    })
  }
  const included = new WeakSet()
  const result = roots.filter(root => {
    if (included.has(root) || descendants.has(root) || (root.data.uid && descendantIds.has(root.data.uid))) return false
    included.add(root)
    return true
  })
  if (roots.length && !result.length) throw new Error('剪贴板子树 ID 存在循环归属')
  return result
}

/** Collect normal tree-node IDs; summary IDs cannot be relation targets. */
export function collectNodeUids(rootOrRoots) {
  const ids = new Set()
  walk(asForest(rootOrRoots), node => {
    if (typeof node.data.uid === 'string' && node.data.uid) ids.add(node.data.uid)
  })
  return ids
}

function rewriteRelations(data, uidMap, validUids) {
  const hasRelations = ['associativeLineTargets', ...relationArrays, ...relationMaps].some(key => key in data)
  if (!hasRelations) return
  const targets = data.associativeLineTargets || []
  if (!Array.isArray(targets) || targets.some(target => typeof target !== 'string')) throw new Error('关联线目标必须是 UID 字符串数组')
  const retained = [], seen = new Set()
  targets.forEach((oldUid, index) => {
    const target = uidMap.get(oldUid) || oldUid
    if (!validUids.has(target) || target === data.uid || seen.has(target)) return
    seen.add(target)
    retained.push({ oldUid, target, index })
  })
  data.associativeLineTargets = retained.map(item => item.target)
  for (const key of relationArrays) {
    if (!(key in data)) continue
    if (!Array.isArray(data[key])) throw new Error(`${key} 必须是数组`)
    const previous = data[key]
    data[key] = retained.map(item => previous[item.index] ?? null)
  }
  for (const key of relationMaps) {
    if (!(key in data)) continue
    const previous = data[key]
    if (!previous || typeof previous !== 'object' || Array.isArray(previous)) throw new Error(`${key} 必须是对象`)
    data[key] = Object.fromEntries(retained.filter(item => Object.hasOwn(previous, item.oldUid)).map(item => [item.target, previous[item.oldUid]]))
  }
}

/**
 * Clone a forest for one paste. The clipboard must retain its original UIDs;
 * stripping IDs before calling this function loses internal relation identity.
 * Every normal node and summary receives a fresh UID. Internal edges follow the
 * clone; external edges survive only when their target exists in the destination.
 * Returns { nodes, uidMap, summaryUidMap }, without changing the clipboard or
 * destination. uidMap maps normal nodes; summaryUidMap exposes summary identity
 * changes separately, because normal relation targets cannot point to summaries.
 */
export function cloneClipboardSubtrees(rootOrRoots, { existingUids = [], createUid = () => globalThis.crypto.randomUUID() } = {}) {
  const source = topLevelClipboardRoots(rootOrRoots)
  // Validate object identity before cloning, including cycles and shared nodes.
  walk(source, () => {})
  const destinationIds = new Set(existingUids)
  const nodes = clone(source), uidMap = new Map(), summaryUidMap = new Map(), reserved = new Set(destinationIds)
  walk(nodes, node => {
    const oldUid = node.data.uid
    if (oldUid !== undefined && (typeof oldUid !== 'string' || !oldUid)) throw new Error('剪贴板节点 UID 必须是非空字符串')
    if (oldUid && uidMap.has(oldUid)) throw new Error(`剪贴板节点 UID 重复：${oldUid}`)
    if (oldUid) { uidMap.set(oldUid, null); reserved.add(oldUid) }
    for (const summary of summaries(node.data)) if (typeof summary.uid === 'string') reserved.add(summary.uid)
  })
  function freshUid() {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const value = createUid()
      if (typeof value !== 'string' || !value || value.length > 128) throw new Error('生成的节点 UID 无效')
      if (!reserved.has(value)) { reserved.add(value); return value }
    }
    throw new Error('无法生成唯一节点 UID')
  }
  walk(nodes, node => {
    const oldUid = node.data.uid
    node.data.uid = freshUid()
    if (oldUid) uidMap.set(oldUid, node.data.uid)
    delete node.data.isActive
    for (const summary of summaries(node.data)) {
      const oldSummaryUid = summary.uid
      summary.uid = freshUid()
      if (typeof oldSummaryUid === 'string') summaryUidMap.set(oldSummaryUid, summary.uid)
      delete summary.isActive
    }
  })
  const validUids = new Set([...destinationIds, ...collectNodeUids(nodes)])
  walk(nodes, node => rewriteRelations(node.data, uidMap, validUids))
  return { nodes, uidMap, summaryUidMap }
}

/** Return a copy with dangling/self/duplicate edges and aligned metadata removed. */
export function pruneDanglingRelations(rootOrRoots, { existingUids = [], inPlace = false } = {}) {
  const arrayInput = Array.isArray(rootOrRoots)
  walk(asForest(rootOrRoots), () => {})
  // The adapter may own an already-cloned export snapshot and avoid a second
  // full-tree allocation. The default remains immutable for normal callers.
  const nodes = inPlace ? asForest(rootOrRoots) : clone(asForest(rootOrRoots))
  const validUids = new Set([...existingUids, ...collectNodeUids(nodes)])
  const identityMap = new Map()
  walk(nodes, node => rewriteRelations(node.data, identityMap, validUids))
  return arrayInput ? nodes : nodes[0]
}
