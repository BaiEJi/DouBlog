import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_BYTES, MAX_ENVELOPE_BYTES, newDocument, validateDocument, parseImport, encodeExport, outlineNodes, benchmarkDocument, safeUrl, nameWithSuffix } from '../src/mindmap/data.js'

test('JSON roundtrip preserves all native and business data', () => {
  const document = newDocument('中心')
  document.root.children.push({ data: { uid: 'child', text: '', expand: false, note: '备注', tag: ['重要'],
    hyperlink: '/post/12', color: '#f00', fontSize: 20, generalization: [{ text: '概要', uid: 'summary' }] }, children: [] })
  document.root.data.associativeLineTargets = ['child']
  document.view = { transform: { scaleX: 1, scaleY: 1, translateX: 20, translateY: 30 } }
  const map = { id: 'one', name: '复习', revision: 7, workspace_id: 3, post_id: 12, document }
  assert.deepEqual(parseImport(JSON.stringify(encodeExport(map))).document, document)
})
test('invalid JSON/version, duplicate ids, cycles, unsafe links and excessive depth are rejected', () => {
  assert.throws(() => parseImport('{'), /JSON/)
  assert.throws(() => parseImport(JSON.stringify({ format: 'doublog.mindmap', schema_version: 99 })), /版本/)
  const doc = newDocument()
  doc.root.children.push({ data: { ...doc.root.data } })
  assert.throws(() => validateDocument(doc), /重复/)
  doc.root.children = [doc.root]
  assert.throws(() => validateDocument(doc), /循环/)
  doc.root.children = []
  doc.root.data.hyperlink = 'javascript:alert(1)'
  assert.throws(() => validateDocument(doc), /链接/)
  delete doc.root.data.hyperlink
  let parent = doc.root
  for (let i = 0; i < 130; i++) { const node = { data: { uid: `depth-${i}`, text: 'x' }, children: [] }; parent.children = [node]; parent = node }
  assert.throws(() => validateDocument(doc), /层级/)
})
test('prototype pollution keys and unsupported image data are rejected', () => {
  const doc = newDocument()
  doc.theme.config = JSON.parse('{"__proto__":{"polluted":true}}')
  assert.throws(() => validateDocument(doc), /不安全/)
  assert.equal(safeUrl('data:image/svg+xml,<svg/>', true), false)
  assert.equal(safeUrl('https://example.com/evil.svg?x=1', true), false)
  assert.equal(safeUrl('data:image/png;base64,YQ==', true), true)
  doc.theme.config = {}
  doc.root.data.generalization = [{ text:'<img src=x onerror=alert(1)>', richText:true }]
  assert.throws(() => validateDocument(doc), /富文本/)
})
test('fixed 5000 node fixture remains fully expanded and outline is in child order', () => {
  const doc = benchmarkDocument(5000)
  validateDocument(doc)
  const outline = outlineNodes(doc.root)
  assert.equal(outline.length, 5000)
  assert.ok(outline.every(node => node.expanded))
  assert.deepEqual(outline.slice(0,3).map(node => node.uid), ['bench-0','bench-1','bench-5'])
})
test('recovery copies keep the suffix within 200 Unicode codepoints without breaking emoji', () => {
  const name=nameWithSuffix('😀'.repeat(200),' · 恢复草稿')
  assert.equal([...name].length,200)
  assert.ok(name.endsWith(' · 恢复草稿'))
  assert.ok(!name.includes('\ufffd'))
})
test('numerical overflow in otherwise valid JSON is rejected before import', () => {
  const payload=encodeExport({id:1,name:'overflow',revision:1,document:newDocument()})
  const text=JSON.stringify(payload).replace('"config":{}','"config":{"fontSize":1e999}')
  assert.throws(()=>parseImport(text),/非有限/)
})

test('a document at the exact capacity still exports and imports with its bounded envelope', () => {
  const document = newDocument('容量边界')
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength
  document.root.data.note = ''
  document.root.data.note = 'x'.repeat(MAX_BYTES - bytes(document))
  assert.equal(bytes(document), MAX_BYTES)
  const payload = encodeExport({ id: 2147483647, name: '😀'.repeat(200), revision: 2147483647,
    workspace_id: 2147483647, post_id: 2147483647, document })
  const exported = JSON.stringify(payload)
  assert.ok(bytes(payload) > MAX_BYTES)
  assert.ok(bytes(payload) < MAX_ENVELOPE_BYTES)
  assert.equal(parseImport(exported).document.root.data.note, document.root.data.note)
  document.root.data.note += 'x'
  assert.throws(() => encodeExport({ id: 1, name: '过大', revision: 1, document }), /10 MB/)
})

test('summary ranges, global identity and separate render capacity are validated', () => {
  const doc = newDocument()
  doc.root.children = [{ data: { uid: 'child', text: '' }, children: [] }]
  doc.root.data.generalization = [{ text: '范围概要', uid: 'summary', range: [0, 0] }]
  validateDocument(doc)
  for (const range of [[-1, -1], [0, 1], [1, 0], [true, true], [0], '0,0']) {
    doc.root.data.generalization[0].range = range
    assert.throws(() => validateDocument(doc), /概要范围/)
  }
  doc.root.data.generalization = [{ text: '旧版无ID概要', range: null }]
  validateDocument(doc)
  doc.root.data.generalization[0].uid = 'child'
  assert.throws(() => validateDocument(doc), /ID 重复/)
  doc.root.data.generalization = Array.from({ length: 1001 }, () => ({ text: '概要' }))
  assert.throws(() => validateDocument(doc), /1000.*概要/)
})

test('Unicode UIDs use the same codepoint budget as the API validator', () => {
  const document = newDocument()
  document.root.data.uid = '😀'.repeat(128)
  document.root.data.generalization = [{ uid: '😁'.repeat(128), text: '概要', range: null }]
  const exported = encodeExport({ id: 1, name: 'Unicode', revision: 1, workspace_id: 1, document })
  assert.deepEqual(parseImport(JSON.stringify(exported)).document, document)
  document.root.data.uid += '😀'
  assert.throws(() => validateDocument(document), /uid/)
})
