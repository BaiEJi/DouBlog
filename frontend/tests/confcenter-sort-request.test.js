/**
 * confEntries 排序参数序列化与请求身份行为测试：
 * - 未传排序参数时不携带 sort_by/sort_order（后端保留旧顺序，客户端不强制升级）
 * - sortBy/sortOrder 非空时按 URLSearchParams 序列化
 * - namespace/q 空值省略；page/page_size 总是携带
 * - 信封解包：成功返回 data；失败抛出后端 message（400 排序参数错误可被 UI 捕获）
 * - URL 快速切换排序时每个请求身份独立（不同参数 → 不同 URL → 服务端排序语义不同）
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const calls = []
globalThis.window = { location: { hostname: '127.0.0.1', pathname: '/confcenter', search: '', href: '' } }
globalThis.fetch = async (url, options) => {
  calls.push({ url: String(url), options })
  const last = state.stack[state.stack.length - 1] ?? { ok: true, body: { success: true, data: {} } }
  const resp = { ok: last.ok, status: last.status ?? 200, headers: { get: () => null } }
  // client.js 会给 json/text/blob/arrayBuffer 全部做 epoch 绑定，mock 必须齐
  for (const method of ['json', 'text', 'blob', 'arrayBuffer'])
    resp[method] = async () => method === 'json' ? last.body : ''
  resp.body = null
  return resp
}
const state = { stack: [] }

const { confEntries } = await import('../src/confcenter/api.js')

function lastParams() {
  const url = new URL(calls.at(-1).url, 'http://x')
  return url.searchParams
}

test('no sort args: request omits sort_by/sort_order entirely', async () => {
  calls.length = 0
  await confEntries({ namespace: 'app', q: 'flag', page: 2 })
  const p = lastParams()
  assert.equal(p.get('sort_by'), null)
  assert.equal(p.get('sort_order'), null)
  assert.equal(p.get('namespace'), 'app')
  assert.equal(p.get('q'), 'flag')
  assert.equal(p.get('page'), '2')
  assert.equal(p.get('page_size'), '50')
})

test('sort args serialize to sort_by/sort_order', async () => {
  calls.length = 0
  await confEntries({ namespace: 'app', sortBy: 'data', sortOrder: 'desc', page: 3 })
  const p = lastParams()
  assert.equal(p.get('sort_by'), 'data')
  assert.equal(p.get('sort_order'), 'desc')
  assert.equal(p.get('page'), '3')
})

test('each column/direction pair maps to a distinct request identity', async () => {
  calls.length = 0
  const combos = []
  for (const sortBy of ['key', 'type', 'data', 'updated_at'])
    for (const sortOrder of ['asc', 'desc'])
      combos.push([sortBy, sortOrder])
  for (const [sortBy, sortOrder] of combos) await confEntries({ namespace: 'app', sortBy, sortOrder })
  const urls = calls.map(c => c.url)
  assert.equal(new Set(urls).size, combos.length)   // 8 个组合 → 8 个不同 URL
  const byKeyDesc = new URL(urls[1], 'http://x').searchParams
  assert.equal(byKeyDesc.get('sort_by'), 'key')
  assert.equal(byKeyDesc.get('sort_order'), 'desc')
})

test('q with URL metacharacters is percent-encoded once, not double-encoded', async () => {
  calls.length = 0
  await confEntries({ q: 'feature%one_2' })
  const p = lastParams()
  assert.equal(p.get('q'), 'feature%one_2')
})

test('envelope success returns data; server 400 for bad sort surfaces message', async () => {
  state.stack = [{ ok: true, status: 200, body: { success: true, code: 200,
    data: { items: [{ key: 'k' }], total: 1, page: 1, page_size: 50, pages: 1 } } }]
  const d = await confEntries({ namespace: 'app', sortBy: 'type' })
  assert.equal(d.items[0].key, 'k')

  state.stack = [{ ok: false, status: 400, body: { success: false, code: 400,
    message: 'sort_by 仅允许 key / type / data / updated_at',
    data: { error_code: 'PARAM', details: null } } }]
  await assert.rejects(
    () => confEntries({ namespace: 'app', sortBy: 'namespace' }),
    error => error.message.includes('sort_by'))
})

test('fetch failure (network) rejects instead of resolving stale list data', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  try {
    await assert.rejects(() => confEntries({ namespace: 'app', sortBy: 'key' }), TypeError)
  } finally {
    globalThis.fetch = original
  }
})
