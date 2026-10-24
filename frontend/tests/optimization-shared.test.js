import test from 'node:test'
import assert from 'node:assert/strict'
import { createSaveCoordinator } from '../src/shared/saveCoordinator.js'
import { createWorkerTask } from '../src/shared/workerTask.js'
import { lineDiff, inlineDiff, jsonDiff } from '../src/shared/diff.js'
import { regexTask, jsonFormatTask, textDiffTask, runComputation } from '../src/shared/compute.js'
import { generate } from '../src/shared/jsonToCode.js'
import { csvParse, csvStringify, jsonToCsv, flatten } from '../src/shared/text.js'
import { createVaultSession, createVaultTaskScope, runVaultTasks, decryptBatches } from '../src/vault/components/session.js'
import { createGeometryCache } from '../src/gamemap/board/geometry.js'
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

test('serial saves coalesce edits, advance revision, and never report unsent edits saved', async () => {
  const gates = [], requests = [], states = []
  const c = createSaveCoordinator({ revision: 3, debounceMs: 10000, onState: state => states.push(state), save: (value, options) => {
    requests.push({ value, ...options }); const gate = deferred(); gates.push(gate); return gate.promise
  } })
  c.change({ value: 'a' }); const flush = c.flush()
  c.change({ value: 'b' }); c.change({ value: 'c' }); assert.equal(requests.length, 1)
  gates[0].resolve({ revision: 4 }); await tick()
  assert.equal(requests.length, 2); assert.equal(requests[1].revision, 4); assert.equal(requests[1].value.value, 'c')
  assert.equal(states.some(state => state.status === 'saved'), false)
  gates[1].resolve({ revision: 5 }); await flush
  assert.deepEqual(c.getState(), { status: 'saved', dirty: false, error: null, revision: 5 }); c.dispose()
})
test('ambiguous result retries exactly the same mutation and snapshot before newer edits', async () => {
  const calls = []
  const c = createSaveCoordinator({ revision: 1, idempotent: true, retryDelays: [0], debounceMs: 10000, save: async (value, options) => {
    calls.push({ value, ...options }); if (calls.length === 1) throw new TypeError('network'); return { revision: calls.length }
  } })
  c.change({ body: 'first' }); await c.flush()
  assert.equal(calls.length, 2); assert.equal(calls[0].mutationId, calls[1].mutationId); assert.deepEqual(calls[0].value, calls[1].value); c.dispose()
})
test('non-idempotent writes never retry automatically; definite 400 can be corrected', async () => {
  let calls = 0
  const c = createSaveCoordinator({ debounceMs: 10000, save: async value => { calls++; if (!value.ok) throw Object.assign(new Error('bad'), { status: 400 }); return { revision: 2 } } })
  c.change({ ok: false }); await assert.rejects(c.flush()); assert.equal(calls, 1)
  c.change({ ok: true }); await c.flush(); assert.equal(calls, 2); c.dispose()
  const d = createSaveCoordinator({ save: async () => { calls++; throw new TypeError('offline') }, retryDelays: [0] })
  d.change('x'); await assert.rejects(d.flush()); assert.equal(calls, 3); d.dispose()
})
test('409 stops writes and preserves the latest draft', async () => {
  let draft, calls = 0
  const c = createSaveCoordinator({ idempotent: true, debounceMs: 10000, draft: { write: value => { draft = value } }, save: async () => { calls++; throw Object.assign(new Error('conflict'), { status: 409 }) } })
  c.change('a'); await assert.rejects(c.flush()); c.change('b'); await assert.rejects(c.flush())
  assert.equal(calls, 1); assert.equal(c.getState().status, 'conflict'); assert.equal(draft.snapshot, 'b'); c.dispose()
})
test('a crash draft contains the unknown in-flight mutation for replay after restart', async () => {
  let draft, mutation
  const c = createSaveCoordinator({ revision: 7, idempotent: true, debounceMs: 10000, retryDelays: [], draft: { write: value => { draft = structuredClone(value) } }, save: async (_value, options) => { mutation = options.mutationId; throw new TypeError('lost response') } })
  c.change('old'); await assert.rejects(c.flush()); c.change('new'); c.dispose()
  const calls = []
  const next = createSaveCoordinator({ revision: 8, initialDraft: draft, idempotent: true, save: async (value, options) => { calls.push({ value, ...options }); return { revision: calls.length + 7 } } })
  await next.flush(); assert.equal(calls[0].mutationId, mutation); assert.equal(calls[0].revision, 7); assert.equal(calls[0].value, 'old'); assert.equal(calls[1].value, 'new'); assert.equal(calls[1].revision, 8); next.dispose()
})
test('dispose during retry backoff terminates without sending another request', async () => {
  let calls = 0
  const c = createSaveCoordinator({ idempotent: true, retryDelays: [100], save: async () => { calls++; throw new TypeError('offline') } })
  c.change('x'); const pending = c.flush(); await tick(); c.dispose(); await pending; assert.equal(calls, 1)
})
test('quota failure is visible without preventing server saving, and a corrected queued 400 proceeds', async () => {
  let failure
  const gate=deferred(),requests=[]
  const c=createSaveCoordinator({debounceMs:10000,onDraftError:error=>{failure=error},draft:{write(){throw new DOMException('full','QuotaExceededError')}},save:async value=>{requests.push(value);if(requests.length===1)return gate.promise;return{revision:2}}})
  c.change('invalid');const flush=c.flush();c.change('corrected');assert.equal(c.getState().draftError.name,'QuotaExceededError');assert.equal(failure.name,'QuotaExceededError')
  gate.reject(Object.assign(new Error('invalid'),{status:400}));await flush;assert.deepEqual(requests,['invalid','corrected']);assert.equal(c.getState().status,'saved');c.dispose()
})
test('worker timeout/cancel terminates execution and rejects late/wrong messages', async () => {
  const workers = []
  const tasks = createWorkerTask(() => { const worker = { postMessage(data) { this.id = data.id }, terminate() { this.stopped = true } }; workers.push(worker); return worker })
  const timeout = tasks.run('regex', {}, { timeoutMs: 10 }); await assert.rejects(timeout, { name: 'TimeoutError' }); assert.equal(workers[0].stopped, true)
  const controller = new AbortController(), pending = tasks.run('x', {}, { signal: controller.signal }); controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(tasks.activeCount, 0)
  const result = tasks.run('x', {}); const worker = workers.at(-1); worker.onmessage({ data: { id: -1, result: 'bad' } }); worker.onmessage({ data: { id: worker.id, result: 'ok' } }); assert.equal(await result, 'ok')
})
test('diff keeps original text while ignore options affect matching; CJK/emoji/CRLF round-trip', () => {
  const same = lineDiff('HELLO  世界😀\r\n end ', 'hello 世界😀\nend', { ignoreCase: true, ignoreWs: true })
  assert.equal(same.stats.unchanged, 2); assert.equal(same.rows[0].at, 'HELLO  世界😀')
  const changed = lineDiff('甲\n乙\n', '甲\n丙\n')
  assert.equal(changed.rows.filter(row => row.type !== 'add').map(row => row.at).join('\n'), '甲\n乙\n')
  assert.equal(changed.rows.filter(row => row.type !== 'del').map(row => row.bt).join('\n'), '甲\n丙\n')
  const inline = inlineDiff('你好😀 foo', '你好😀 bar'); assert.equal(inline.left.map(s => s.t).join(''), '你好😀 foo'); assert.equal(inline.right.map(s => s.t).join(''), '你好😀 bar')
})
test('large diff is complete, and input exceeding explicit budgets fails visibly', () => {
  const a = Array.from({ length: 10000 }, (_, i) => `line ${i}`).join('\n'), b = a + '\nlast'
  const result = textDiffTask({ a, b }); assert.equal(result.stats.added, 1); assert.equal(result.rows.length, 10001); assert.equal(result.pairs.length, 10001)
  assert.throws(() => lineDiff('\n'.repeat(200001), ''), /200000/)
})
test('generic JSON preserves arbitrary keys, primitives, duplicate array counts and reports actual bytes', () => {
  const result = jsonFormatTask({ text: '{"__proto__":{"x":1},"constructor":2,"零":"😀"}', sortKeys: true })
  assert.equal(JSON.parse(result.result).__proto__.x, 1); assert.equal({}.x, undefined)
  assert.equal(result.stats.outBytes, new TextEncoder().encode(result.result).length)
  assert.equal(jsonFormatTask({ text: 'false', indent: 'min' }).result, 'false')
  const diff = jsonDiff([1, 1, 2], [1, 2], { ignoreArrayOrder: true }); assert.equal(diff.stats.removed, 1)
  const large = jsonFormatTask({ text: JSON.stringify({ value: '中'.repeat(1700000) }) }); assert.ok(large.stats.inBytes > 5000000)
})
test('regex limits are explicit and zero-width unicode matches terminate', () => {
  const result = regexTask({ pattern: '(?<a>a)', flags: 'g', text: 'aaa', matchLimit: 2 }); assert.equal(result.limited, true); assert.equal(result.matches.length, 2); assert.deepEqual(result.matches[0].named, [['a','a']])
  assert.equal(regexTask({ pattern: '(?:)', flags: 'gu', text: '😀' }).matches.length, 2)
  assert.throws(() => regexTask({ pattern: '[', flags: '', text: '' }))
})
test('worker transforms preserve Unicode/escaped quotes, indexed arrays and arbitrary CSV keys', () => {
  const text='中文😀 "quotes"\r\n\ttail'
  for(const urlSafe of[false,true])assert.equal(runComputation('base64',{text:runComputation('base64',{text,mode:'encode',urlSafe}).output,mode:'decode'}).output,text)
  assert.throws(()=>runComputation('base64',{text:'/w==',mode:'decode'}),TypeError)
  const escaped=runComputation('jsonEscape',{input:text,direction:'escape'}).output
  assert.equal(runComputation('jsonEscape',{input:escaped,direction:'unescape'}).output,text)
  assert.equal(runComputation('jsonEscape',{input:JSON.stringify(text),direction:'unescape'}).output,text)
  const unicode=runComputation('unicode',{text:'中😀',mode:'escape'}).output
  assert.equal(runComputation('unicode',{text:unicode,mode:'unescape'}).output,'中😀')
  const table=[['列','quoted','multi'],['😀','"a",b','line\r\nnext']]
  assert.deepEqual(csvParse(csvStringify(table)),table)
  assert.deepEqual({...flatten({items:[1,2],empty:[]})},{'items[0]':1,'items[1]':2,empty:'[]'})
  assert.deepEqual(jsonToCsv([JSON.parse('{"constructor":2,"__proto__":1}'),{normal:'x'}],{flattenNested:false}),[['constructor','__proto__','normal'],[2,1,''],['','','x']])
})
test('type generation samples every array object and emits syntactically valid TypeScript/Python', async () => {
  const input=[{name:'中',first:1,nested:{'invalid-key':true}},{name:'a',second:null,nested:{'invalid-key':false}}]
  const ts=generate(input,'Root','ts')
  assert.match(ts,/"first"\?: number/);assert.match(ts,/"second"\?: null/);assert.match(ts,/type Root = RootItem\[\]/)
  const compiler=await import('@babel/parser')
  assert.doesNotThrow(()=>compiler.parse(ts,{sourceType:'module',plugins:['typescript']}))
  const python=generate(input,'Root','python')
  const{spawnSync}=await import('node:child_process')
  const run=spawnSync(process.env.OPTIMIZATION_PYTHON||'D:/ProgramData/miniconda3/python.exe',['-c','import sys; exec(sys.stdin.read())'],{input:python,encoding:'utf8'})
  assert.equal(run.status,0,run.stderr)
})
test('lock invalidates deferred decryption, bounded batches preserve order without later publishing plaintext', async () => {
  const session = createVaultSession(), token = session.begin(); let active = 0, max = 0, batches = 0
  const result = await decryptBatches(Array.from({ length: 21 }, (_, i) => i), async i => { max = Math.max(max, ++active); await tick(); active--; return i + 1 }, { concurrency: 3, batchSize: 10, onBatch: () => batches++ })
  assert.equal(max, 3); assert.equal(batches, 3); assert.deepEqual(result, Array.from({ length: 21 }, (_, i) => i + 1))
  const gate = deferred(); let published = false
  const stale = decryptBatches([1,2], async () => { await gate.promise; return 'secret' }, { isCurrent: () => session.isCurrent(token), onBatch: () => { published = true } })
  session.invalidate(); gate.resolve(); assert.equal(await stale, null); assert.equal(published, false); assert.throws(() => session.assert(token), { name: 'AbortError' })
})
test('geometry cache does no recomputation on pan and invalidates incident edges on movement', () => {
  const cache = createGeometryCache(), nodes = new Map([['a',{x:0,y:0,w:100,h:80}],['b',{x:400,y:0,w:100,h:80}],['c',{x:0,y:500,w:100,h:80}]])
  const edges = [{id:'ab',source:'a',target:'b',data:{relation:{relation_type_id:1}}}], types = new Map([[1,{name:'朋友',color:'#fff'}]])
  const first = cache.update(nodes,edges,types); assert.equal(cache.getMetrics().calculations, 1)
  const pan = cache.update(nodes,edges,types); assert.equal(pan[0], first[0]); assert.equal(cache.getMetrics().calculations, 1)
  nodes.set('a',{x:20,y:20,w:100,h:80}); const moved = cache.update(nodes,edges,types); assert.notEqual(moved[0], first[0]); assert.equal(cache.getMetrics().calculations, 2)
  const g = moved[0]; nodes.set('c',{x:g.mx-10,y:g.my-10,w:100,h:80}); assert.notEqual(cache.update(nodes,edges,types)[0],g)
  nodes.delete('b'); assert.equal(cache.update(nodes,edges,types).length,0)
})
test('session lock and child unmount stop queued password checks and reject deferred attachment writes', async () => {
  const session=createVaultSession();session.begin();const scope=createVaultTaskScope(session),gate=deferred();let started=0,published=0,writes=0
  const tasks=runVaultTasks(Array.from({length:10},(_,i)=>i),async()=>{started++;await gate.promise;return 'old result'},{signal:scope.signal,isCurrent:scope.isCurrent,onResult:()=>published++})
  assert.equal(started,3);session.invalidate();gate.resolve();assert.equal(await tasks,false);assert.equal(started,3);assert.equal(published,0);assert.equal(scope.signal.aborted,true);scope.dispose()
  session.begin();const child=createVaultTaskScope(session),read=deferred()
  const upload=(async()=>{await read.promise;child.assert();writes++})()
  child.dispose();read.resolve();await assert.rejects(upload,{name:'AbortError'});assert.equal(writes,0)
})
