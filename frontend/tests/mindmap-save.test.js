import test from 'node:test'
import assert from 'node:assert/strict'
import { createSaveController } from '../src/mindmap/saveController.js'
import { newDocument } from '../src/mindmap/data.js'
const storage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key,value) => data.set(key,value), removeItem: key => data.delete(key) } }
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
function setup(save, options = {}) { return createSaveController({ id:'map', revision:1, document:newDocument(), save, storage:storage(), debounceMs:60000, retryDelays:[], ...options }) }

test('an edit during save is queued and never reported saved prematurely; parallel flush is single-flight', async () => {
  const gate = deferred(), requests = [], statuses = []
  const c = setup(async request => { requests.push(request); if (requests.length === 1) await gate.promise; return { revision:request.revision+1 } }, { onState: s => statuses.push(s) })
  const first = newDocument('第一版'), second = newDocument('第二版')
  c.change(first)
  const a = c.flush(), b = c.flush()
  await Promise.resolve()
  c.change(second)
  gate.resolve()
  await Promise.all([a,b])
  assert.equal(requests.length,2)
  assert.equal(requests[1].revision,2)
  assert.equal(requests[1].document.root.data.text,'第二版')
  assert.deepEqual(c.getState(), { status:'saved', revision:3, error:null, pending:false })
  assert.equal(statuses.find(s => s.status==='saved' && s.revision===2),undefined)
  c.dispose()
})
test('network retry reuses the identical mutation id and preserves newer edits', async () => {
  const requests = []
  let fail = true
  const c = setup(async request => { requests.push(request); if(fail) { fail=false; throw new Error('offline') }; return { revision:request.revision+1 } })
  c.change(newDocument('待保存'))
  await assert.rejects(c.flush(),/offline/)
  assert.equal(c.getState().status,'offline')
  c.change(newDocument('更新内容'))
  await c.retry()
  assert.equal(requests[0].mutation_id,requests[1].mutation_id)
  assert.equal(requests[1].document.root.data.text,'待保存')
  assert.equal(requests[2].document.root.data.text,'更新内容')
  c.dispose()
})
test('conflict stops automatic writes and keeps recoverable draft after disposal', async () => {
  const disk = storage()
  const error = Object.assign(new Error('conflict'),{status:409})
  let calls=0
  const c = setup(async () => { calls++; throw error }, { storage:disk })
  c.change(newDocument('本地草稿'))
  await assert.rejects(c.flush(),/conflict/)
  await assert.rejects(c.retry(),/conflict/)
  assert.equal(calls,1)
  c.dispose()
  const reopened = setup(async () => {}, {storage:disk})
  assert.equal(reopened.recover().document.root.data.text,'本地草稿')
  assert.equal(reopened.getState().pending,false)
  reopened.discardDraft()
  assert.equal(reopened.recover(),null)
  reopened.dispose()
})
test('late completion from a closed editor cannot delete a reopened editor draft', async () => {
  const disk=storage(), gate=deferred()
  const old=setup(() => gate.promise,{storage:disk})
  old.change(newDocument('旧草稿'))
  const pending=old.flush()
  old.dispose()
  const next=setup(async()=>({revision:2}),{storage:disk})
  next.change(newDocument('新草稿'))
  gate.resolve({revision:2})
  await pending
  assert.equal(next.recover().document.root.data.text,'新草稿')
  next.dispose()
})
test('a definitely rejected invalid document can be corrected and saved', async () => {
  const requests=[]
  const c=setup(async request=>{requests.push(request);if(requests.length===1)throw Object.assign(new Error('invalid'),{status:400});return {revision:2}})
  c.change(newDocument('格式错误'))
  await assert.rejects(c.flush(),/invalid/)
  c.change(newDocument('已修正'))
  await c.flush()
  assert.notEqual(requests[0].mutation_id,requests[1].mutation_id)
  assert.equal(requests[1].document.root.data.text,'已修正')
  c.dispose()
})
test('an ambiguous timeout is retried using the same idempotent request', async () => {
  const requests=[]
  const c=setup(async request=>{requests.push(request);if(requests.length===1)return new Promise(()=>{});return {revision:2}},{timeoutMs:10})
  c.change(newDocument('超时恢复'))
  await assert.rejects(c.flush(),/超时/)
  await c.retry()
  assert.equal(requests[0].mutation_id,requests[1].mutation_id)
  assert.equal(c.getState().status,'saved')
  c.dispose()
})
test('explicit discard is not undone by navigation cleanup', async () => {
  const disk=storage()
  const c=setup(async()=>{throw Object.assign(new Error('conflict'),{status:409})},{storage:disk})
  c.change(newDocument('已决定放弃的本地内容'))
  await assert.rejects(c.flush(),/conflict/)
  c.discardDraft()
  c.dispose()
  const next=setup(async()=>({revision:2}),{storage:disk})
  assert.equal(next.recover(),null)
  next.dispose()
})
