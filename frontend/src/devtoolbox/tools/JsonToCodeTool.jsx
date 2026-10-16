/** JSON 转代码：TypeScript interface / Go struct / Python TypedDict（类型推断：合并数组元素类型） */
import { useMemo, useState } from 'react'
import { ToolHead, TwoPane, CopyBtn, Segmented, StatusLine, areaCls } from '../kit'

const SAMPLE = `{
  "id": 1,
  "name": "DouBlog",
  "active": true,
  "score": 92.5,
  "tags": ["fastapi", "react"],
  "db": { "host": "127.0.0.1", "port": 5432, "replicas": [1, 2] },
  "note": null
}`

// ─── 类型推断 ─────────────────────────────────────────────

function inferType(value, name) {
  if (value === null || value === undefined) return { kind: 'null' }
  if (Array.isArray(value)) {
    const elemTypes = [...new Set(value.map(v => inferType(v, name)))]
    const nonNull = elemTypes.filter(t => t.kind !== 'null')
    if (nonNull.length === 0) return { kind: 'unknown' }
    const merged = nonNull.length === 1 ? nonNull[0]
      : nonNull.every(t => t.kind === 'prim' ) && { kind: 'union', types: nonNull }
    return { kind: 'array', elem: merged && merged.kind !== 'union' ? merged : (merged || { kind: 'unknown' }) }
  }
  if (typeof value === 'object') return { kind: 'object', value, name }
  return { kind: 'prim', type: typeof value }
}

const primTs = { string: 'string', number: 'number', boolean: 'boolean' }

function tsTypeName(node, unionOK = true) {
  switch (node.kind) {
    case 'prim': return primTs[node.type] || 'unknown'
    case 'null': return 'null'
    case 'array': return `${tsTypeName(node.elem, unionOK)}[]`
    case 'union': return unionOK ? node.types.map(t => tsTypeName(t, false)).join(' | ') : 'unknown'
    case 'object': return node.name
    default: return 'unknown'
  }
}

function pascal(name) {
  return (name || 'Root').replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c || '').toUpperCase())
    .replace(/^(\d)/, 'T$1') || 'Root'
}

function goTypeName(node) {
  switch (node.kind) {
    case 'prim': return { string: 'string', number: 'float64', boolean: 'bool' }[node.type] || 'any'
    case 'null': return 'any'
    case 'array': return `[]${goTypeName(node.elem)}`
    case 'object': return node.name
    default: return 'any'
  }
}

function pyTypeName(node) {
  switch (node.kind) {
    case 'prim': return { string: 'str', number: 'float', boolean: 'bool' }[node.type] || 'Any'
    case 'null': return 'Any'
    case 'array': return `list[${pyTypeName(node.elem)}]`
    case 'object': return node.name
    default: return 'Any'
  }
}

const goTag = k => '`json:"' + k + '"`'

function generate(value, rootName, lang) {
  const structs = []          // [{name, fields: [[key, typeNameNode, optional]]}]（对象按出现顺序）
  const seen = new Set()

  function emitObject(obj, name) {
    if (seen.has(name)) return
    seen.add(name)
    const fields = []
    const struct = { name, fields }
    structs.push(struct)
    for (const [k, v] of Object.entries(obj)) {
      let node = inferType(v, pascal(k))
      if (node.kind === 'null') { node = { kind: 'unknown' } ; struct.fields.push([k, node, true]); continue }
      if (node.kind === 'array' && node.elem.kind === 'object') {
        emitObject(node.elem.value, node.elem.name = pascal(k))
      } else if (node.kind === 'object') {
        emitObject(node.value, node.name = pascal(k))
      }
      struct.fields.push([k, node, false])
    }
  }

  let root = inferType(value, rootName)
  if (root.kind === 'object') {
    emitObject(value, rootName)
  } else if (root.kind === 'array' && root.elem.kind === 'object') {
    // 顶层数组：对元素做合并类型
    const merged = mergeObjects(value)
    emitObject(merged, rootName + 'Item')
    root = { kind: 'array', elem: { kind: 'object', name: rootName + 'Item' } }
  }

  if (lang === 'ts') {
    return structs.map(s =>
      `interface ${s.name} {\n` +
      s.fields.map(([k, node, opt]) => `  ${/^[\w$]+$/.test(k) ? k : JSON.stringify(k)}${opt || node.kind === 'unknown' ? '?' : ''}: ${tsTypeName(node)};`).join('\n') +
      `\n}` + (s === structs[0] && root.kind === 'array' ? `\n\n// 顶层数组：${rootName}[]` : '')
    ).join('\n\n')
  }
  if (lang === 'go') {
    return 'package main\n\n' + structs.map(s =>
      `type ${s.name} struct {\n` +
      s.fields.map(([k, node]) => `  ${pascal(k).replace(/^(.)/, c => c.toUpperCase())} ${goTypeName(node)} ${goTag(k)}`).join('\n') +
      `\n}`
    ).join('\n\n') + (root.kind === 'array' ? `\n\n// 顶层数组：[]${rootName}Item` : '')
  }
  // python
  return 'from typing import TypedDict, Any, list\n\n' + structs.map(s =>
    `class ${s.name}(TypedDict, total=False):\n` +
    (s.fields.length
      ? s.fields.map(([k, node]) => `    ${/^[\w$]+$/.test(k) ? k : JSON.stringify(k)}: ${pyTypeName(node)}`).join('\n')
      : '    pass')
  ).join('\n\n') + (root.kind === 'array' ? `\n\n# 顶层数组：list[${rootName}Item]` : '')
}

/** 数组对象合并：键并集，冲突类型 → unknown（可选键） */
function mergeObjects(arr) {
  const out = {}
  const allKeys = [...new Set(arr.flatMap(o => Object.keys(o || {})))]
  for (const k of allKeys) {
    const vals = arr.map(o => o?.[k]).filter(v => v !== undefined && v !== null)
    if (!vals.length) { out[k] = null; continue }
    const types = new Set(vals.map(v => Array.isArray(v) ? 'array' : typeof v === 'object' && v ? 'object' : typeof v))
    if (types.size > 1) { out[k] = vals.find(v => typeof v === 'string') ?? vals[0]; continue }  // 类型冲突：取第一个样本
    if (types.has('object')) out[k] = mergeObjects(vals)
    else out[k] = vals[0]
  }
  return out
}

export default function JsonToCodeTool() {
  const [text, setText] = useState(SAMPLE)
  const [lang, setLang] = useState('ts')

  const { output, error } = useMemo(() => {
    if (!text.trim()) return { output: '', error: null }
    try {
      const value = JSON.parse(text)
      return { output: generate(value, 'Root', lang), error: null }
    } catch (e) {
      return { output: '', error: 'JSON 解析失败：' + e.message }
    }
  }, [text, lang])

  return (
    <div>
      <ToolHead title="JSON 转代码" desc="推断类型并生成 TypeScript / Go / Python 类型定义（数组元素类型自动合并）"
        right={<Segmented value={lang} onChange={setLang} options={[
          { key: 'ts', label: 'TypeScript' },
          { key: 'go', label: 'Go' },
          { key: 'py', label: 'Python' },
        ]} />} />
      <TwoPane
        leftTitle="JSON"
        rightTitle="类型定义"
        left={<textarea className={areaCls} rows={16} value={text} spellCheck={false} onChange={e => setText(e.target.value)} />}
        right={<textarea className={'font-mono text-[13px] leading-relaxed p-3 rounded-lg border border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03] text-stone-700 dark:text-stone-200 whitespace-pre'} rows={16} readOnly value={output} />}
        rightActions={<CopyBtn text={output} disabled={!output} />} />
      <div className="mt-2"><StatusLine ok={!error && !!output} err={error} okText="生成完成" /></div>
    </div>
  )
}
