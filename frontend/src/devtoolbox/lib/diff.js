/**
 * Diff 算法：行级 LCS（公共前后缀裁剪 + DP 上限保护）与行内 token 级 diff，
 * 供「文本对比」与「JSON Diff」共用。输出为渲染友好的行描述数组。
 */

const DP_CELL_LIMIT = 16_000_000   // (n+1)*(m+1) 上限——超过走逐行兜底（罕见超大输入）

/**
 * 行级 diff。
 * @returns {{rows: Array<{type:'eq'|'add'|'del', a?:number, b?:number, at?:string, bt?:string}>,
 *            stats:{added:number, removed:number, unchanged:number}}}
 */
export function lineDiff(aText, bText, opts = {}) {
  const a = normalize(aText)
  const b = normalize(bText)
  const ops = diffSeq(a, b, opts.key || (s => s))   // [op, aIdx, bIdx]
  const rows = []
  for (let i = 0; i < ops.length; i++) {
    const [op, ai, bi] = ops[i]
    if (op === 'eq') rows.push({ type: 'eq', a: ai + 1, b: bi + 1, at: a[ai], bt: b[bi] })
    else if (op === 'del') rows.push({ type: 'del', a: ai + 1, at: a[ai] })
    else rows.push({ type: 'add', b: bi + 1, bt: b[bi] })
  }
  const added = rows.filter(r => r.type === 'add').length
  const removed = rows.filter(r => r.type === 'del').length
  return { rows, stats: { added, removed, unchanged: rows.length - added - removed } }
}

function normalize(text, { ignoreCase = false, ignoreWs = false } = {}) {
  let lines = text.split(/\r\n|\r|\n/)
  if (ignoreWs) lines = lines.map(l => l.trim().replace(/\s+/g, ' '))
  if (ignoreCase) lines = lines.map(l => l.toLowerCase())
  return lines
}

/** 序列 diff：公共前后缀裁剪 → LCS DP → 还原为 [op, aIdx, bIdx] 列表 */
export function diffSeq(a, b, key = (s => s)) {
  const ka = a.map(key), kb = b.map(key)
  // 前缀
  let pre = 0
  while (pre < ka.length && pre < kb.length && ka[pre] === kb[pre]) pre++
  // 后缀
  let sufA = ka.length, sufB = kb.length, suf = 0
  while (sufA > pre && sufB > pre && ka[sufA - 1] === kb[sufB - 1]) { sufA--; sufB--; suf++ }

  const midA = ka.slice(pre, sufA), midB = kb.slice(pre, sufB)
  const ops = []
  for (let i = 0; i < pre; i++) ops.push(['eq', i, i])
  ops.push(...diffMiddle(midA, midB, pre))
  for (let i = 0; i < suf; i++) ops.push(['eq', sufA + i, sufB + i])
  return ops
}

function diffMiddle(a, b, offset) {
  const n = a.length, m = b.length
  if (n === 0 && m === 0) return []
  if (n === 0) return b.map((_, j) => ['add', offset, offset + j])
  if (m === 0) return a.map((_, i) => ['del', offset + i, offset])
  if ((n + 1) * (m + 1) > DP_CELL_LIMIT) {
    // 兜底：全部标记删除+新增（保序，不丢内容）
    return [...a.map((_, i) => ['del', offset + i, offset]),
            ...b.map((_, j) => ['add', offset, offset + j])]
  }
  // LCS 长度表（滚动两行）+ 方向回溯需要全表 → 直接全表 Int32Array
  const w = m + 1
  const dp = new Int32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j]
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }
  const ops = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push(['eq', offset + i, offset + j]); i++; j++ }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { ops.push(['del', offset + i, offset + j]); i++ }
    else { ops.push(['add', offset + i, offset + j]); j++ }
  }
  while (i < n) { ops.push(['del', offset + i, offset + j]); i++ }
  while (j < m) { ops.push(['add', offset + i, offset + j]); j++ }
  return ops
}

/**
 * 行内 token diff：把一对「删除/新增」文本切成 token（词/空白），标记两侧各自的
 * 命中与缺失片段。返回 {left:[{t,s,hit}], right:[...]}（s=hunk 序号，用于着色配对）。
 */
export function inlineDiff(aText, bText) {
  const ta = tokenize(aText), tb = tokenize(bText)
  const ops = diffSeq(ta, tb)
  const left = [], right = []
  let hunk = 0
  let openDel = false, openAdd = false
  const closeL = () => { openDel = false }, closeR = () => { openAdd = false }
  for (const [op, ai, bi] of ops) {
    if (op === 'eq') { closeL(); closeR(); left.push({ t: ta[ai], h: 0 }); right.push({ t: tb[bi], h: 0 }) }
    else if (op === 'del') {
      if (!openDel && !openAdd) hunk++
      openDel = true; closeR()
      left.push({ t: ta[ai], h: hunk })
    } else {
      if (!openDel && !openAdd) hunk++
      openAdd = true; closeL()
      right.push({ t: tb[bi], h: hunk })
    }
  }
  return { left, right }
}

function tokenize(s) {
  return s.split(/(\s+|[()[\]{}.,;:!?'"`])/).filter(t => t !== '')
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
