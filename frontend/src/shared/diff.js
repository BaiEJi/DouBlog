import { diffArrays, diffWordsWithSpace } from 'diff'

const limits = { timeout: 1500, maxEditLength: 20000 }
const requireResult = result => { if (!result) throw new RangeError('差异超过计算预算，请缩小比较范围'); return result }
export function diffSeq(a, b, key = value => value) {
  if (a.length + b.length > 200000) throw new RangeError('比较最多支持 200000 行或元素')
  const changes = requireResult(diffArrays(a, b, { ...limits, comparator: (x, y) => key(x) === key(y) }))
  const out = []; let ai = 0, bi = 0
  for (const change of changes) for (let i = 0; i < change.count; i++) {
    if (change.removed) out.push(['del', ai++, bi])
    else if (change.added) out.push(['add', ai, bi++])
    else out.push(['eq', ai++, bi++])
  }
  return out
}
export function lineDiff(aText, bText, { ignoreCase = false, ignoreWs = false } = {}) {
  const a = aText.split(/\r\n|\r|\n/), b = bText.split(/\r\n|\r|\n/)
  const key = value => { let out = value; if (ignoreWs) out = out.trim().replace(/\s+/g, ' '); return ignoreCase ? out.toLowerCase() : out }
  const rows = diffSeq(a, b, key).map(([type, ai, bi]) => type === 'eq' ? { type, a: ai + 1, b: bi + 1, at: a[ai], bt: b[bi] }
    : type === 'del' ? { type, a: ai + 1, at: a[ai] } : { type, b: bi + 1, bt: b[bi] })
  const added = rows.filter(row => row.type === 'add').length, removed = rows.filter(row => row.type === 'del').length
  return { rows, stats: { added, removed, unchanged: rows.length - added - removed } }
}
export function inlineDiff(a, b) {
  const changes = requireResult(diffWordsWithSpace(a, b, limits)), left = [], right = []
  let hunk = 0
  for (const change of changes) {
    if (change.added || change.removed) hunk += 1
    const segment = { t: change.value, h: change.added || change.removed ? hunk : 0 }
    if (!change.added) left.push(segment)
    if (!change.removed) right.push(segment)
  }
  return { left, right }
}

// ─── JSON Diff ────────────────────────────────────────────

/**
 * 深度 JSON diff：对象按键比较，数组按 LCS 对齐（可选忽略数组顺序）。
 * @returns {{changes: Array<{path:string, type:'added'|'removed'|'changed', a?:*, b?:*}>,
 *            stats:{added:number, removed:number, changed:number, same:boolean}}}
 */
export function jsonDiff(a, b, { ignoreArrayOrder = false } = {}) {
  const changes = []
  walk(a, b, '$', changes, ignoreArrayOrder)
  return {
    changes,
    stats: {
      added: changes.filter(c => c.type === 'added').length,
      removed: changes.filter(c => c.type === 'removed').length,
      changed: changes.filter(c => c.type === 'changed').length,
      same: changes.length === 0,
    },
  }
}

function stableKey(v, ignoreArrayOrder) {
  if (ignoreArrayOrder && Array.isArray(v)) {
    return '[' + v.map(x => stableKey(x, true)).sort().join(',') + ']'
  }
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).map(([k, x]) => JSON.stringify(k) + ':' + stableKey(x, ignoreArrayOrder))
    return '{' + entries.sort().join(',') + '}'
  }
  return typeof v === 'string' ? JSON.stringify(v) : String(v)
}

function walk(a, b, path, out, ignoreArrayOrder) {
  if (stableKey(a, ignoreArrayOrder) === stableKey(b, ignoreArrayOrder)) return
  const aObj = isPlain(a), bObj = isPlain(b)
  const aArr = Array.isArray(a), bArr = Array.isArray(b)
  if (aArr && bArr) { walkArray(a, b, path, out, ignoreArrayOrder); return }
  if (aObj && bObj) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    for (const k of keys) {
      const inA = k in a, inB = k in b
      const p = `${path}.${k}`
      if (inA && !inB) out.push({ path: p, type: 'removed', a: a[k] })
      else if (!inA && inB) out.push({ path: p, type: 'added', b: b[k] })
      else walk(a[k], b[k], p, out, ignoreArrayOrder)
    }
    return
  }
  out.push({ path, type: 'changed', a, b })
}

function walkArray(a, b, path, out, ignoreArrayOrder) {
  if (ignoreArrayOrder) {
    // 顺序无关：多重集（按稳定键计数）比较，报告元素数量差异
    const count = new Map()
    const keyOf = v => stableKey(v, true)
    a.forEach(v => count.set(keyOf(v), (count.get(keyOf(v)) || 0) + 1))
    b.forEach(v => count.set(keyOf(v), (count.get(keyOf(v)) || 0) - 1))
    for (const [k, n] of count) {
      if (n > 0) out.push({ path, type: 'removed', a: shortValue(k), note: `右侧缺少 ${n} 个` })
      if (n < 0) out.push({ path, type: 'added', b: shortValue(k), note: `右侧多出 ${-n} 个` })
    }
    return
  }
  const ops = diffSeq(a, b, v => stableKey(v, false))
  for (const [op, ai, bi] of ops) {
    if (op === 'del') out.push({ path: `${path}[${ai}]`, type: 'removed', a: a[ai] })
    else if (op === 'add') out.push({ path: `${path}[${bi}]`, type: 'added', b: b[bi] })
  }
}

function isPlain(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

export function shortValue(v, max = 120) {
  let s
  if (typeof v === 'string') s = JSON.stringify(v)
  else { try { s = JSON.stringify(v) } catch { s = String(v) } }
  if (s === undefined) s = String(v)
  return s.length > max ? s.slice(0, max) + '…' : s
}
