// 认证会话检查回归：401/ok/unavailable 分类、10s 成功缓存、总截止时间、
// 并发单飞、epoch 竞态（旧结果不得覆盖新状态、旧 finally 不得清新引用）。
// 每个用例用带查询串的动态 import 取全新的模块实例（模块级单飞状态隔离）。
import test from 'node:test'
import assert from 'node:assert/strict'

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
// 与后端契约一致的成功信封：data 为对象且 authenticated===true、
// username/database_identity 均为非空字符串（F04 严格校验）
const envelope = (data, status = 200) => ({ ok: status < 400, status, json: async () => ({ success: status < 400, code: status, data }) })
const authOk = (username = 'qa', identity = 'db-1') => envelope({ authenticated: true, username, database_identity: identity })
const fresh = name => import(`../src/shared/authSession.js?case=${encodeURIComponent(name)}`)

// 模拟真实 fetch 的 abort 语义：signal 触发时以 AbortError 拒绝
function abortAware(handler) {
  return (url, options) => new Promise((resolve, reject) => {
    const signal = options?.signal
    const abort = () => reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    if (signal) {
      if (signal.aborted) return abort()
      signal.addEventListener('abort', abort, { once: true })
    }
    Promise.resolve(handler(url, options)).then(resolve, reject)
  })
}

function installFetch(handler) {
  const calls = []
  globalThis.fetch = abortAware((url, options) => {
    calls.push([url, options])
    return handler({ url, options, call: calls.length })
  })
  return calls
}

test('ok envelope resolves ok and caches success for 10s without refetch', async () => {
  const { checkSession } = await fresh('ok-cache')
  const calls = installFetch(() => authOk())
  assert.equal(await checkSession({ force: true }), 'ok')
  assert.equal(await checkSession(), 'ok')
  assert.equal(calls.length, 1, '成功缓存命中时不得重复请求')
})

// F04：HTTP200 但信封/身份结构不合法 → unavailable，且不改写数据上下文/成功缓存
test('malformed 200 envelopes never count as authenticated', async () => {
  const cases = [
    ['empty object', envelope2 => ({ ok: true, status: 200, json: async () => ({}) })],
    ['array envelope', () => ({ ok: true, status: 200, json: async () => [] })],
    ['missing data', () => ({ ok: true, status: 200, json: async () => ({ success: true }) })],
    ['data array', () => ({ ok: true, status: 200, json: async () => ({ success: true, data: [1] }) })],
    ['authenticated=false', () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { authenticated: false, username: 'qa', database_identity: 'db-1' } }) })],
    ['missing username', () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { authenticated: true, database_identity: 'db-1' } }) })],
    ['missing database_identity', () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { authenticated: true, username: 'qa' } }) })],
    ['non-string username', () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { authenticated: true, username: 42, database_identity: 'db-1' } }) })],
    ['empty identity', () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { authenticated: true, username: 'qa', database_identity: '' } }) })],
  ]
  for (const [label, handler] of cases) {
    const { checkSession } = await fresh(`malformed-${label}`)
    installFetch(handler)
    assert.equal(await checkSession({ force: true }), 'unavailable', label)
    // 失败不得污染成功缓存：后续合法响应仍可成功
    installFetch(() => authOk())
    assert.equal(await checkSession({ force: true }), 'ok', `${label} 后恢复`)
  }
})

test('valid identity updates data context exactly once per check', async () => {
  const { checkSession } = await fresh('identity-ctx')
  const { getDataIdentity, getDatabaseIdentity } = await import('../src/shared/dataEpoch.js')
  installFetch(() => authOk('admin', 'module-db-identity'))
  assert.equal(await checkSession({ force: true }), 'ok')
  assert.equal(getDatabaseIdentity(), 'module-db-identity')
  assert.ok(String(getDataIdentity()).includes('admin'))
})

test('401 is the only path to out; 503 / bad json / network failure are unavailable', async () => {
  {
    const { checkSession } = await fresh('401')
    installFetch(() => envelope({ authenticated: false }, 401))
    assert.equal(await checkSession({ force: true }), 'out')
  }
  {
    const { checkSession } = await fresh('503')
    installFetch(() => envelope({ error_code: 'UNAVAILABLE' }, 503))
    assert.equal(await checkSession({ force: true }), 'unavailable')
  }
  {
    const { checkSession } = await fresh('bad-json')
    installFetch(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad') } }))
    assert.equal(await checkSession({ force: true }), 'unavailable')
  }
  {
    const { checkSession } = await fresh('net-error')
    installFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    assert.equal(await checkSession({ force: true }), 'unavailable')
  }
})
test('never-completing check hits the deadline and reports unavailable (timeout covers body)', async () => {
  const { checkSession } = await fresh('timeout')
  installFetch(() => new Promise(() => {/* 永不完成 */}))
  const started = Date.now()
  assert.equal(await checkSession({ force: true, timeoutMs: 60 }), 'unavailable')
  assert.ok(Date.now() - started >= 50, '总截止时间必须真实生效')
})

test('timeout during slow body parse also lands on unavailable', async () => {
  const { checkSession } = await fresh('timeout-body')
  // 真实 fetch 中 abort 会取消 body 流；桩对齐该语义：json() 挂起并在 abort 时拒绝
  installFetch(({ options }) => ({
    ok: true, status: 200,
    json: () => new Promise((_, reject) => {
      const signal = options?.signal
      const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'))
      if (signal) {
        if (signal.aborted) return abort()
        signal.addEventListener('abort', abort, { once: true })
      }
    }),
  }))
  assert.equal(await checkSession({ force: true, timeoutMs: 60 }), 'unavailable')
})

test('concurrent calls single-flight to one fetch', async () => {
  const { checkSession } = await fresh('single-flight')
  const calls = installFetch(() => authOk())
  const [a, b, c] = await Promise.all([checkSession({ force: true }), checkSession({ force: true }), checkSession({ force: true })])
  assert.deepEqual([a, b, c], ['ok', 'ok', 'ok'])
  assert.equal(calls.length, 1, '单飞：并发调用只发出一次 fetch')
})

test('rejected request is not reused: retry after failure issues a fresh fetch', async () => {
  const { checkSession } = await fresh('retry-fresh')
  let attempts = 0
  installFetch(() => { attempts += 1; return attempts === 1 ? Promise.reject(new TypeError('offline')) : authOk() })
  assert.equal(await checkSession({ force: true }), 'unavailable')
  assert.equal(await checkSession({ force: true }), 'ok')
  assert.equal(attempts, 2)
})

test('dataEpoch change during flight: late old result becomes unavailable and does not clobber the new request slot', async () => {
  const { checkSession } = await fresh('epoch-race')
  // dataEpoch 必须用规范导入：authSession 内部依赖的是同一实例，查询串会拿到另一个副本
  const { advanceDataEpoch } = await import('../src/shared/dataEpoch.js')
  const first = deferred()
  const second = deferred()
  const calls = installFetch(({ call }) => (call === 1 ? first.promise.then(() => authOk('qa', 'db-old')) : second.promise.then(() => authOk('qa', 'db-new'))))
  const p1 = checkSession({ force: true })
  advanceDataEpoch() // 登录/切库导致 epoch 变化
  const p2 = checkSession({ force: true })
  assert.equal(calls.length, 2, 'epoch 变化后必须有新请求')
  second.resolve()
  first.resolve()
  assert.equal(await p1, 'unavailable', '旧请求晚到不得当成成功')
  assert.equal(await p2, 'ok', '新请求不受旧请求污染')
  // 旧 finally 不得清掉新请求引用：第三次调用若仍在途中应继续单飞
  const third = deferred()
  installFetch(() => third.promise.then(() => authOk('qa', 'db-third')))
  const p3a = checkSession({ force: true })
  const p3b = checkSession({ force: true })
  third.resolve()
  assert.deepEqual(await Promise.all([p3a, p3b]), ['ok', 'ok'])
})

test('stale data context short-circuits to ok without fetching', async () => {
  const { checkSession } = await fresh('stale-ctx')
  const { markDataContextStale } = await import('../src/shared/dataEpoch.js')
  const calls = installFetch(() => authOk())
  markDataContextStale()
  assert.equal(await checkSession({ force: true }), 'ok')
  assert.equal(calls.length, 0)
})
