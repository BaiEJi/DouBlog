// Sample-based type inference: arbitrary JSON names and all array samples are preserved.
const identifier = value => {
  const name = String(value).replace(/[^A-Za-z0-9_]+(.)?/g, (_match, next) => (next || '').toUpperCase())
  return (name.replace(/^(.)/, char => char.toUpperCase()).replace(/^(\d)/, 'Field$1') || 'Field')
}
const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
export function generate(value, rootName = 'Root', language = 'ts') {
  const structures = [], names = new Map()
  function allocate(suggestion) { const base = identifier(suggestion), count = (names.get(base) || 0) + 1; names.set(base, count); return base + (count === 1 ? '' : count) }
  function infer(values, suggestion, depth = 0) {
    if (depth > 256) throw new RangeError('类型推断最多支持 256 层')
    if (!values.length) return { kind: 'unknown' }
    const groups = new Map()
    for (const sample of values) { const k = kind(sample); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(sample) }
    const types = [...groups].map(([k, samples]) => {
      if (k === 'array') return { kind: k, elem: infer(samples.flat(), suggestion + 'Item', depth + 1) }
      if (k !== 'object') return { kind: k }
      const name = allocate(suggestion), structure = { name, fields: [] }; structures.push(structure)
      const keys = new Set(samples.flatMap(sample => Object.keys(sample)))
      for (const key of keys) {
        const present = samples.filter(sample => Object.hasOwn(sample, key))
        structure.fields.push({ key, optional: present.length < samples.length, type: infer(present.map(sample => sample[key]), key, depth + 1) })
      }
      return { kind: 'object', name }
    })
    return types.length === 1 ? types[0] : { kind: 'union', types }
  }
  const root = infer([value], rootName), alias = identifier(rootName)
  function ts(node) {
    if (node.kind === 'object') return node.name
    if (node.kind === 'array') return `${node.elem.kind === 'union' ? '(' + ts(node.elem) + ')' : ts(node.elem)}[]`
    if (node.kind === 'union') return node.types.map(ts).join(' | ')
    return { string: 'string', number: 'number', boolean: 'boolean', null: 'null' }[node.kind] || 'unknown'
  }
  function go(node) { return node.kind === 'object' ? node.name : node.kind === 'array' ? `[]${go(node.elem)}` : ({ string: 'string', number: 'float64', boolean: 'bool' }[node.kind] || 'any') }
  function py(node) {
    if (node.kind === 'object') return node.name
    if (node.kind === 'array') return `list[${py(node.elem)}]`
    if (node.kind === 'union') return `Union[${node.types.map(py).join(', ')}]`
    return { string: 'str', number: 'float', boolean: 'bool', null: 'None' }[node.kind] || 'Any'
  }
  if (language === 'ts') {
    const definitions = structures.map(structure => `interface ${structure.name} {\n${structure.fields.map(field => `  ${JSON.stringify(field.key)}${field.optional ? '?' : ''}: ${ts(field.type)};`).join('\n')}\n}`).join('\n\n')
    return definitions + (root.kind === 'object' ? '' : `${definitions ? '\n\n' : ''}type ${alias} = ${ts(root)};`)
  }
  if (language === 'go') {
    const definitions = structures.map(structure => {
      const fields = new Map()
      return `type ${structure.name} struct {\n${structure.fields.map(field => {
        const base = identifier(field.key), count = (fields.get(base) || 0) + 1; fields.set(base, count)
        const tag = 'json:' + JSON.stringify(field.key + (field.optional ? ',omitempty' : ''))
        return `  ${base}${count === 1 ? '' : count} ${go(field.type)} ${JSON.stringify(tag)}`
      }).join('\n')}\n}`
    }).join('\n\n')
    return 'package main\n\n' + definitions + (root.kind === 'object' ? '' : `${definitions ? '\n\n' : ''}type ${alias} ${go(root)}`)
  }
  const definitions = [...structures].reverse().map(structure => `${structure.name} = TypedDict(${JSON.stringify(structure.name)}, {\n${structure.fields.map(field => `    ${JSON.stringify(field.key)}: ${py(field.type)},`).join('\n')}\n}, total=False)`).join('\n\n')
  return 'from typing import TypedDict, Any, Union\n\n' + definitions + (root.kind === 'object' ? '' : `${definitions ? '\n\n' : ''}${alias} = ${py(root)}`)
}
