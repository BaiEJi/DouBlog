import { lineDiff, inlineDiff, jsonDiff } from './diff.js'
import { generate } from './jsonToCode.js'
import { jsonToCsv, csvToJson, csvStringify, csvParse, textStats, wordFrequency, lineTransform } from './text.js'
const MAX_BYTES = 10 * 1024 * 1024
function budget(text) { if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new RangeError('输入超过 10 MiB 计算上限') }
export function regexTask({ pattern, flags, text, matchLimit = 500 }) {
  budget(text); if (pattern.length > 10000) throw new RangeError('正则表达式过长')
  if (!pattern) return { error: null, segments: text ? [{ text, m: false }] : [], matches: [], limited: false }
  const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g')
  const segments = [], matches = []; let last = 0, limited = false
  for (const match of text.matchAll(re)) {
    if (matches.length >= matchLimit) { limited = true; break }
    if (match.index > last) segments.push({ text: text.slice(last, match.index), m: false })
    segments.push({ text: match[0], m: true })
    matches.push({ value: match[0], index: match.index, groups: match.slice(1), named: match.groups ? Object.entries(match.groups) : null })
    last = match.index + match[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last), m: false })
  return { error: null, segments, matches, limited }
}
export function jsonFormatTask({ text, indent = '2', sortKeys = false }) {
  budget(text)
  if (!text.trim()) return { result: '', error: null, stats: null }
  const root = JSON.parse(text), stack = [[root, 1]], padding = indent === 'min' ? 0 : indent === 'tab' ? 1 : Math.min(10, Number(indent) || 0)
  let nodes = 0, depth = 0, formattingBudget = new TextEncoder().encode(text).byteLength
  while (stack.length) {
    const [value, d] = stack.pop(); nodes += 1; depth = Math.max(depth, d)
    formattingBudget += padding * d * 2 + 2
    if (formattingBudget > 50 * 1024 * 1024) throw new RangeError('格式化输出超过 50 MiB 处理预算，请用压缩模式或缩小输入')
    if (value && typeof value === 'object') for (const child of Object.values(value)) stack.push([child, d + 1])
    if (nodes > 1000000 || depth > 2048) throw new RangeError('JSON 超过 100 万节点或 2048 层处理预算')
  }
  // A replacer sorts plain-object keys without mutating values or filtering arbitrary JSON keys.
  const replacer = sortKeys ? (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value : null
  const result = JSON.stringify(root, replacer, indent === 'min' ? 0 : indent === 'tab' ? '\t' : Number(indent))
  return { result, error: null, stats: { nodes, depth, inBytes: new TextEncoder().encode(text).byteLength, outBytes: new TextEncoder().encode(result).byteLength } }
}
export function textDiffTask({ a, b, ignoreCase, ignoreWs, inline = true }) {
  budget(a); budget(b)
  const result = lineDiff(a, b, { ignoreCase, ignoreWs }), pairs = []
  let i = 0
  while (i < result.rows.length) {
    const rows = result.rows
    if (rows[i].type === 'eq') { pairs.push({ left: rows[i], right: rows[i], kind: 'eq' }); i += 1; continue }
    const dels = [], adds = []
    while (rows[i]?.type === 'del') dels.push(rows[i++])
    while (rows[i]?.type === 'add') adds.push(rows[i++])
    for (let n = 0; n < Math.max(dels.length, adds.length); n++) {
      const left = dels[n], right = adds[n], kind = left && right ? 'chg' : left ? 'del' : 'add'
      pairs.push({ left, right, kind, segs: inline && kind === 'chg' ? inlineDiff(left.at, right.bt) : null })
    }
  }
  return { ...result, pairs, unifiedText: result.rows.map(row => `${row.type === 'add' ? '+ ' : row.type === 'del' ? '- ' : '  '}${row.at ?? row.bt}`).join('\n') }
}
export function runComputation(type, payload) {
  if (type === 'regex') return regexTask(payload)
  if (type === 'jsonFormat') return jsonFormatTask(payload)
  if (type === 'textDiff') return textDiffTask(payload)
  if (type === 'jsonDiff') { budget(payload.a); budget(payload.b); return jsonDiff(JSON.parse(payload.a), JSON.parse(payload.b), payload) }
  if (type === 'jsonCode') { budget(payload.text); return { output: payload.text.trim() ? generate(JSON.parse(payload.text), 'Root', payload.lang) : '' } }
  if (type === 'jsonEscape') {
    budget(payload.input)
    return { output: !payload.input ? '' : payload.direction === 'escape' ? JSON.stringify(payload.input).slice(1, -1)
      : JSON.parse(payload.input.startsWith('"') && payload.input.endsWith('"') ? payload.input : '"' + payload.input.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"') }
  }
  if (type === 'jsonCsv') {
    const { input, direction, delim, flattenNested } = payload; budget(input)
    if (!input.trim()) return { output: '', info: '' }
    if (direction === 'json2csv') {
      const value = JSON.parse(input)
      if (!Array.isArray(value)) throw new TypeError('JSON 顶层必须是数组')
      const table = jsonToCsv(value, { flattenNested })
      return { output: csvStringify(table, delim), info: `${table.length - 1} 行 × ${table[0].length} 列` }
    }
    const rows = csvParse(input, delim), objects = csvToJson(rows)
    return { output: JSON.stringify(objects, null, 2), info: `${objects.length} 个对象 × ${rows[0]?.length || 0} 列` }
  }
  if (type === 'textStats') { budget(payload.text); return { stats: textStats(payload.text), freq: payload.text.trim() ? wordFrequency(payload.text, 12) : [] } }
  if (type === 'textLines') { budget(payload.text); const output = payload.text ? lineTransform(payload.text, payload) : ''; return { output, linesIn: payload.text ? payload.text.split(/\r\n|\r|\n/).length : 0, linesOut: output ? output.split(/\r\n|\r|\n/).length : 0 } }
  if (type === 'base64') {
    budget(payload.text)
    if (payload.mode === 'decode') {
      const binary = atob(payload.text.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, ''))
      return { output: new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0))) }
    }
    const bytes = new TextEncoder().encode(payload.text), parts = []
    for (let offset = 0; offset < bytes.length; offset += 32768) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)))
    const output = btoa(parts.join(''))
    return { output: payload.urlSafe ? output.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') : output }
  }
  if (type === 'unicode') {
    budget(payload.text)
    const { text, mode } = payload, codepoints = [], outputParts = []; let count = 0
    for (const char of text) {
      const cp = char.codePointAt(0); count++
      if (codepoints.length < 200) codepoints.push({ ch: char, hex: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'), dec: cp, bytes: [...new TextEncoder().encode(char)].map(byte => byte.toString(16).padStart(2,'0')).join(' ') })
      if (mode === 'escape') outputParts.push(cp > 0xffff ? '\\u{' + cp.toString(16) + '}' : /[ -~]/.test(char) ? char : '\\u' + cp.toString(16).padStart(4, '0'))
    }
    const output = mode === 'escape' ? outputParts.join('') : text.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (_match, braced, quad) => String.fromCodePoint(parseInt(braced || quad,16)))
    return { output, codepoints, limited: count > 200 }
  }
  throw new Error('未知计算类型')
}
