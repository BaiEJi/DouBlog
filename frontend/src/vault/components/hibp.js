/**
 * HIBP（Have I Been Pwned）泄露检查 —— k-anonymity 模式：
 * 只发送密码 SHA-1 的**前 5 个十六进制字符**查询范围接口，
 * 密码本体与其余哈希永不离开本设备（零知识性质不破坏）。
 *
 * 结果只保存在当前解锁会话内存中。完整密码哈希不得持久化。
 * 网络不可达/接口异常返回 -1（语义：未知，而非安全）。
 */

const CACHE_KEY = 'doublog.hibp.v1'
let cache = Object.create(null)
let generation = 0
const requests = new Set()

function loadCache() {
  // Remove legacy complete SHA-1 cache without reading it into memory.
  try { localStorage.removeItem(CACHE_KEY) } catch { /* private mode */ }
  return cache
}

async function sha1Hex(text) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/**
 * 查询密码泄露次数。
 * @returns {Promise<number>} ≥1 已泄露；0 未收录；-1 网络不可达/接口异常
 */
export async function pwnedCount(password, { signal } = {}) {
  const token = generation
  try {
    if (signal?.aborted) return -1
    const hash = await sha1Hex(password)
    if (token !== generation || signal?.aborted) return -1
    const c = loadCache()
    if (hash in c) return c[hash]
    const prefix = hash.slice(0, 5)
    const suffix = hash.slice(5)
    // 外部 k-anonymity 查询：刻意用原生 fetch 而非 apiFetch——
    // 这是第三方接口，不得携带本站会话凭据/前缀
    const controller = new AbortController(); requests.add(controller)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const timer = setTimeout(() => controller.abort(), 8000)
    let res, body
    try {
      res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' }, credentials: 'omit', cache: 'no-store', signal: controller.signal,
      })
      if (!res.ok) return -1
      body = await res.text()
    } finally { clearTimeout(timer); requests.delete(controller); signal?.removeEventListener('abort', abort) }
    if (token !== generation || signal?.aborted) return -1
    if (!res.ok) return -1
    for (const line of body.split('\n')) {
      const [suf, count] = line.trim().split(':')
      if (suf === suffix) {
        const n = parseInt(count, 10) || 0
        if (token === generation) c[hash] = n
        return n
      }
    }
    if (token === generation) c[hash] = 0
    return 0
  } catch {
    return -1
  }
}

/** 清空泄露检查缓存（设置/调试用） */
export function clearPwnedCache() {
  for (const controller of requests) controller.abort()
  requests.clear()
  generation += 1; cache = Object.create(null)
  try { localStorage.removeItem(CACHE_KEY) } catch { /* 忽略 */ }
}
clearPwnedCache()
