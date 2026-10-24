import test from 'node:test'
import assert from 'node:assert/strict'
import { apiFetch, apiJson, ApiError } from '../src/shared/client.js'
import { getDataEpoch, advanceDataEpoch, getDataIdentity, setDataContext, isDataContextStale } from '../src/shared/dataEpoch.js'
import { argon2id } from '@noble/hashes/argon2.js'
import { unlockVault, decryptBlob, encryptBlob, DEFAULT_KDF, toB64 } from '../src/vault/components/crypto.js'
import { pwnedCount, clearPwnedCache } from '../src/vault/components/hibp.js'
import { createPositionWriter } from '../src/gamemap/board/positionWriter.js'
import { makeClipboardCopier, clearVaultClipboard } from '../src/vault/components/clipboard.js'

test('API preserves Headers and status/trace details; only 401 redirects', async () => {
  const original = globalThis.fetch, oldWindow = globalThis.window
  globalThis.window = { location: { pathname: '/private', search: '?view=2', href: '' } }
  try {
    let options
    globalThis.fetch = async (_url, init) => { options = init; return new Response(JSON.stringify({ success: false, code: 'BAD', message: 'invalid', details: { x: 1 } }), { status: 503, headers: { 'X-Trace-Id': 'trace' } }) }
    await assert.rejects(apiJson('/api/x', { method: 'POST', headers: new Headers({ 'content-type': 'custom/type', 'X-Example': 'x' }), body: '{}' }), error => error instanceof ApiError && error.status === 503 && error.code === 'BAD' && error.traceId === 'trace')
    assert.equal(options.headers.get('content-type'), 'custom/type'); assert.equal(options.headers.get('X-Example'), 'x'); assert.equal(window.location.href, '')
    globalThis.fetch = async () => new Response('{}', { status: 401 })
    await (await apiFetch('/api/x')).json(); assert.equal(window.location.href, '/login?next=%2Fprivate%3Fview%3D2')
  } finally { globalThis.fetch = original; globalThis.window = oldWindow }
})
test('database epoch rejects old response bodies and external cancellation remains bound after headers', async () => {
  const original = globalThis.fetch
  try {
    let signal
    globalThis.fetch = async (_url, options) => {
      signal = options.signal
      const read = () => new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException('cancelled','AbortError'))
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
      })
      return { status: 200, ok: true, headers: new Headers(), body: {}, json: read, text: read, blob: read, arrayBuffer: read }
    }
    const controller = new AbortController(), response = await apiFetch('/api/slow', { signal: controller.signal })
    const body = response.json(); controller.abort(); await assert.rejects(body, { name: 'AbortError' }); assert.equal(signal.aborted, true)
    const next = await apiFetch('/api/slow'), oldEpoch = getDataEpoch(); const pending = next.json(); advanceDataEpoch('other-db'); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(getDataEpoch(), oldEpoch + 1)
    setDataContext('a','db'); const identity = getDataIdentity(), epoch = getDataEpoch(); setDataContext('a','db'); assert.equal(getDataEpoch(),epoch); assert.equal(getDataIdentity(),identity)
    setDataContext('a','db2'); assert.notEqual(getDataIdentity(),identity)
  } finally { globalThis.fetch = original }
})
test('invalid success JSON rejects and nested backend conflict details survive', async () => {
  const original=globalThis.fetch
  try {
    globalThis.fetch=async()=>new Response('<html>unavailable</html>',{headers:{'X-Trace-Id':'broken-body'}})
    await assert.rejects(apiJson('/api/x'),error=>error.code==='INVALID_RESPONSE'&&error.cause instanceof SyntaxError&&error.traceId==='broken-body')
    globalThis.fetch=async()=>new Response(JSON.stringify({success:false,message:'conflict',data:{error_code:'REVISION_CONFLICT',details:{revision:9}}}),{status:409})
    await assert.rejects(apiJson('/api/x'),error=>error.code==='REVISION_CONFLICT'&&error.details.revision===9)
    globalThis.fetch=async()=>new Response('bad gateway',{status:502})
    await assert.rejects(apiJson('/api/x'),error=>error.status===502)
  }finally{globalThis.fetch=original}
})
test('cross-tab database changes keep the old epoch, reject foreign bodies and block subsequent business requests',async()=>{
  const original=globalThis.fetch;let calls=0
  setDataContext('local','expected-db');const epoch=getDataEpoch()
  try{
    globalThis.fetch=async(_url,options)=>{calls++;assert.equal(options.headers.get('X-Expected-Database-Identity'),'expected-db');return new Response('{"success":true,"data":{"secret":"foreign"}}',{headers:{'X-Database-Identity':'foreign-db'}})}
    await assert.rejects(apiJson('/api/items'),error=>error.code==='DATABASE_CHANGED')
    assert.equal(getDataEpoch(),epoch);assert.equal(isDataContextStale(),true)
    await assert.rejects(apiJson('/api/items',{method:'PUT',body:'{}'}),error=>error.code==='DATABASE_CHANGED');assert.equal(calls,1)
    await apiJson('/api/admin/database');assert.equal(calls,2)
  }finally{setDataContext('local','restored-db');globalThis.fetch=original}
})
test('legacy Argon2id account and ciphertext unlock identically, key remains non-exportable, wrong password rejects', async () => {
  const password = 'local-only-test-password', params = { ...DEFAULT_KDF }, salt = new Uint8Array(16).fill(3), vek = new Uint8Array(32).fill(7), nonce = new Uint8Array(12).fill(1)
  const derived = argon2id(new TextEncoder().encode(password), salt, { ...params, dkLen: 32 })
  const kek = await crypto.subtle.importKey('raw', derived, 'AES-GCM', false, ['encrypt','decrypt'])
  const wrapped = await crypto.subtle.encrypt({ name:'AES-GCM', iv:nonce }, kek, vek)
  const account = { kdf_params:params, kdf_salt:toB64(salt), wrapped_vault_key:{ n:toB64(nonce),ct:toB64(wrapped) } }
  const key = await unlockVault(account,password), record={password:{value:'never-server-plaintext'},note:'中文😀'}
  assert.equal(key.extractable,false); await assert.rejects(crypto.subtle.exportKey('raw',key))
  const encrypted = await encryptBlob(key,record); assert.deepEqual(await decryptBlob(key,encrypted),record)
  await assert.rejects(unlockVault(account,'wrong-password')); derived.fill(0); vek.fill(0)
})
test('HIBP never persists complete hashes, sends only prefix, cache resets on lock', async () => {
  const original = globalThis.fetch, oldStorage = globalThis.localStorage
  const writes=[],removed=[]; globalThis.localStorage={setItem:(...args)=>writes.push(args),removeItem:key=>removed.push(key)}
  let calls=0
  try {
    const hash=Buffer.from(await crypto.subtle.digest('SHA-1',new TextEncoder().encode('fixture-only'))).toString('hex').toUpperCase()
    globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,`https://api.pwnedpasswords.com/range/${hash.slice(0,5)}`);assert.equal(options.credentials,'omit');assert.equal(options.headers['Add-Padding'],'true');return new Response(`${hash.slice(5)}:42\nFAKE:0`)}
    clearPwnedCache(); assert.equal(await pwnedCount('fixture-only'),42); assert.equal(await pwnedCount('fixture-only'),42); assert.equal(calls,1); assert.deepEqual(writes,[])
    clearPwnedCache(); assert.equal(await pwnedCount('fixture-only'),42); assert.equal(calls,2); assert.ok(removed.includes('doublog.hibp.v1'))
  } finally { clearPwnedCache(); globalThis.fetch=original; globalThis.localStorage=oldStorage }
})
test('batched positions serialize chapter CAS and preserve other-board versions', async () => {
  let revisions={1:3,2:7}; const requests=[]
  const writer=createPositionWriter({getRevisions:()=>revisions,save:async payload=>{ requests.push(payload); return {boards:payload.boards.map(board=>({chapter_id:board.chapter_id,revision:board.revision+1}))} },onSaved:result=>{revisions={...revisions,...result.revision}}})
  await writer.setMany([{chapter_id:1,character_id:2,x:1,y:2},{chapter_id:1,character_id:3,x:2,y:3},{chapter_id:2,character_id:4,x:3,y:4}])
  assert.equal(requests.length,1); assert.equal(requests[0].boards.length,2); assert.equal(requests[0].boards[0].positions.length,2)
  await writer.set({chapter_id:1,character_id:2,x:4,y:5}); assert.equal(requests[1].boards[0].revision,4); writer.dispose()
})
test('clipboard policy changes cancel old clear timer and locking preserves unrelated clipboard content',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator'),oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout,timers=new Map()
  let value='',counter=0
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>{value=text},readText:async()=>value}}})
  globalThis.setTimeout=callback=>{timers.set(++counter,callback);return counter};globalThis.clearTimeout=id=>timers.delete(id)
  try{
    await makeClipboardCopier(1000)('same');assert.equal(timers.size,1)
    await makeClipboardCopier(0)('same');assert.equal(timers.size,0)
    value='user copied something else';await clearVaultClipboard();assert.equal(value,'user copied something else')
    await makeClipboardCopier(1000)('owned');await clearVaultClipboard();assert.equal(value,'');assert.equal(timers.size,0)
  }finally{globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator}
})
