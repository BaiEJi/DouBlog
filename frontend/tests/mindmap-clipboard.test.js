import test from 'node:test'
import assert from 'node:assert/strict'
import { cloneClipboardSubtrees, collectNodeUids, pruneDanglingRelations, topLevelClipboardRoots } from '../src/mindmap/clipboard.js'

const node = (uid, data = {}, children = []) => ({ data: { uid, text: uid, ...data }, children })
const ids = prefix => { let index = 0; return () => `${prefix}-${++index}` }

test('copied subtrees remap internal edges and keyed labels/styles, preserving valid external edges', () => {
  const original = node('branch', {}, [node('a', {
    associativeLineTargets: ['b', 'external', 'missing'],
    associativeLinePoint: [{ endPoint: 'b' }, { endPoint: 'external' }, { endPoint: 'missing' }],
    associativeLineTargetControlOffsets: [['b'], ['external'], ['missing']],
    associativeLineText: { b: '内部关系', external: '外部关系', missing: '悬挂关系' },
    associativeLineStyle: { b: { color: 'red' }, external: { color: 'blue' }, missing: {} },
  }), node('b')])
  const snapshot = structuredClone(original)
  const { nodes, uidMap } = cloneClipboardSubtrees(original, { existingUids: ['external'], createUid: ids('copy') })
  const copied = nodes[0].children[0].data
  assert.deepEqual(copied.associativeLineTargets, [uidMap.get('b'), 'external'])
  assert.deepEqual(copied.associativeLineText, { [uidMap.get('b')]: '内部关系', external: '外部关系' })
  assert.deepEqual(copied.associativeLineStyle, { [uidMap.get('b')]: { color: 'red' }, external: { color: 'blue' } })
  assert.deepEqual(copied.associativeLinePoint, [{ endPoint: 'b' }, { endPoint: 'external' }])
  assert.deepEqual(copied.associativeLineTargetControlOffsets, [['b'], ['external']])
  assert.deepEqual(original, snapshot)
  assert.equal(collectNodeUids(nodes).size, 3)
  for (const old of ['branch', 'a', 'b']) assert.notEqual(uidMap.get(old), old)
})

test('multi-root copy maps cross-root edges and creates new summary IDs on every paste', () => {
  const forest = [node('a', { associativeLineTargets: ['b'], generalization: [{ uid: 'summary-a', text: '总结', range: [0, 1] }] }), node('b', { generalization: { uid: 'summary-b', text: '另一概要' } })]
  const createUid = ids('paste')
  const first = cloneClipboardSubtrees(forest, { createUid })
  const second = cloneClipboardSubtrees(forest, { createUid })
  assert.deepEqual(first.nodes[0].data.associativeLineTargets, [first.uidMap.get('b')])
  assert.notEqual(first.nodes[0].data.uid, second.nodes[0].data.uid)
  assert.notEqual(first.nodes[0].data.generalization[0].uid, second.nodes[0].data.generalization[0].uid)
  assert.notEqual(first.nodes[1].data.generalization.uid, 'summary-b')
  assert.equal(first.summaryUidMap.get('summary-a'), first.nodes[0].data.generalization[0].uid)
  assert.equal(first.summaryUidMap.get('summary-b'), first.nodes[1].data.generalization.uid)
  assert.deepEqual(first.nodes[0].data.generalization[0].range, [0, 1])
})

test('nested multi-selection copies only top ancestors, preserving relationships among their descendants', () => {
  const nested = node('parent', {}, [node('a', { associativeLineTargets: ['b'] }), node('b')])
  const selected = [nested.children[0], nested, structuredClone(nested.children[1]), nested]
  assert.deepEqual(topLevelClipboardRoots(selected), [nested])
  const { nodes, uidMap } = cloneClipboardSubtrees(selected, { createUid: ids('nested') })
  assert.equal(nodes.length, 1)
  assert.equal(collectNodeUids(nodes).size, 3)
  assert.deepEqual(nodes[0].children[0].data.associativeLineTargets, [uidMap.get('b')])
})

test('pruning after deletion removes incoming dangling edges and parallel metadata together', () => {
  const root = node('root', {}, [node('a', {
    associativeLineTargets: ['deleted', 'b', 'a', 'b'],
    associativeLinePoint: ['deleted-point', 'b-point', 'self-point', 'duplicate-point'],
    associativeLineTargetControlOffsets: ['deleted-offset', 'b-offset', 'self-offset', 'duplicate-offset'],
    associativeLineText: { deleted: 'removed', b: 'kept', a: 'self' },
    associativeLineStyle: { deleted: { width: 1 }, b: { width: 2 }, a: {} },
  }), node('b')])
  const result = pruneDanglingRelations(root)
  const data = result.children[0].data
  assert.deepEqual(data.associativeLineTargets, ['b'])
  assert.deepEqual(data.associativeLinePoint, ['b-point'])
  assert.deepEqual(data.associativeLineTargetControlOffsets, ['b-offset'])
  assert.deepEqual(data.associativeLineText, { b: 'kept' })
  assert.deepEqual(data.associativeLineStyle, { b: { width: 2 } })
  assert.equal(root.children[0].data.associativeLineTargets.length, 4)
})

test('copy to another map removes unavailable external targets while an internal target wins over old destination IDs', () => {
  const forest = [node('a', { associativeLineTargets: ['b', 'outside'] }), node('b')]
  const { nodes, uidMap } = cloneClipboardSubtrees(forest, { existingUids: ['a', 'b'], createUid: ids('new') })
  assert.deepEqual(nodes[0].data.associativeLineTargets, [uidMap.get('b')])
  const empty = pruneDanglingRelations(node('a', { associativeLineTargets: ['missing'], associativeLinePoint: [1], associativeLineText: { missing: 'x' } }))
  assert.deepEqual(empty.data.associativeLineTargets, [])
  assert.deepEqual(empty.data.associativeLinePoint, [])
  assert.deepEqual(empty.data.associativeLineText, {})
})

test('new IDs avoid destination/source/summary collisions and missing native clipboard IDs are filled', () => {
  const sequence = ['a', 'outside', 'summary', 'fresh-a', 'fresh-summary', 'fresh-child']
  const source = node('a', { isActive: true, generalization: [{ uid: 'summary', text: 'x', isActive: true }] }, [{ data: { text: 'missing UID' }, children: [] }])
  const { nodes } = cloneClipboardSubtrees(source, { existingUids: ['outside'], createUid: () => sequence.shift() })
  assert.equal(nodes[0].data.uid, 'fresh-a')
  assert.equal(nodes[0].data.generalization[0].uid, 'fresh-summary')
  assert.equal(nodes[0].children[0].data.uid, 'fresh-child')
  assert.equal('isActive' in nodes[0].data, false)
  assert.equal('isActive' in nodes[0].data.generalization[0], false)
})

test('clipboard cycles, duplicate IDs and malformed relation metadata are rejected', () => {
  const cyclic = node('cycle'); cyclic.children.push(cyclic)
  assert.throws(() => cloneClipboardSubtrees(cyclic), /循环引用/)
  assert.throws(() => cloneClipboardSubtrees([node('a'), node('a')]), /UID 重复/)
  assert.throws(() => cloneClipboardSubtrees(node('a', { associativeLineTargets: 'a' })), /字符串数组/)
  assert.throws(() => cloneClipboardSubtrees(node('a', { associativeLineTargets: ['b'], associativeLineText: [] })), /必须是对象/)
})
