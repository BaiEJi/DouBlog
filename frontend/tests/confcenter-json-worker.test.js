import assert from 'node:assert/strict'
import test from 'node:test'

const replies = []
globalThis.self = { postMessage: message => replies.push(message) }
await import('../src/confcenter/json.worker.js')
function run(type, text, minify = false) {
  self.onmessage({ data: { id: 7, type, payload: { text, minify } } })
  const result = replies.pop()
  assert.equal(result.id, 7)
  return result
}

test('large JSON validation sends a small acknowledgement and formatting preserves values', () => {
  const value = { 中文: '原文', rows: Array.from({ length: 4000 }, (_, id) => ({ id, value: `值-${id}` })) }
  const source = JSON.stringify(value, null, 2)
  assert.ok(source.length > 64 * 1024)
  assert.deepEqual(run('validate', source), { id: 7, result: true })
  const compact = run('format', source, true)
  assert.deepEqual(JSON.parse(compact.result), value)
  assert.ok(compact.result.length < source.length)
})

test('invalid JSON retains error location, scalars remain exact valid JSON', () => {
  const invalid = run('validate', '{\n  "value": nope\n}')
  assert.equal(invalid.error.name, 'SyntaxError')
  assert.match(invalid.error.message, /JSON|Unexpected/)
  for (const source of ['null', 'false', '0', '"中文"', '[1,null,false]']) {
    assert.deepEqual(run('validate', source), { id: 7, result: true })
    assert.deepEqual(JSON.parse(run('format', source).result), JSON.parse(source))
  }
})
