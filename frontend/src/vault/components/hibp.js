/**
 * HIBP（Have I Been Pwned）泄露检查 —— k-anonymity 模式：
 * 只发送密码 SHA-1 的**前 5 个十六进制字符**查询范围接口，
 * 密码本体与其余哈希永不离开本设备（零知识性质不破坏）。
 *
 * 结果缓存到 localStorage（键为完整 SHA-1，单向不可逆，可安全落盘）。
 * 网络不可达/接口异常返回 -1（语义：未知，而非安全）。
 */

const CACHE_KEY = 'doublog.hibp.v1'
let cache = null

function loadCache() {
  if (cache) return cache
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {} }
  catch { cache = {} }
  return cache
}

function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)) } catch { /* 满/隐私模式则放弃持久化 */ }
}

async function sha1Hex(text) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/**
 * 查询密码泄露次数。
 * @returns {Promise<number>} ≥1 已泄露；0 未收录；-1 网络不可达/接口异常
 */
export async function pwnedCount(password) {
  try {
    const hash = await sha1Hex(password)
    const c = loadCache()
    if (hash in c) return c[hash]
    const prefix = hash.slice(0, 5)
    const suffix = hash.slice(5)
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },   // 全部后缀都返回，掩蔽真实查询
    })
    if (!res.ok) return -1
    const body = await res.text()
    for (const line of body.split('\n')) {
      const [suf, count] = line.trim().split(':')
      if (suf === suffix) {
        const n = parseInt(count, 10) || 0
        c[hash] = n
        saveCache()
        return n
      }
    }
    c[hash] = 0
    saveCache()
    return 0
  } catch {
    return -1
  }
}

/** 清空泄露检查缓存（设置/调试用） */
export function clearPwnedCache() {
  cache = {}
  try { localStorage.removeItem(CACHE_KEY) } catch { /* 忽略 */ }
}
