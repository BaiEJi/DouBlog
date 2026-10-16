/**
 * 通用工具：剪贴板/下载、UTF-8 安全的 Base64、字节格式化、HTML 转义、随机生成器。
 */

export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;left:-9999px'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ─── Base64（UTF-8 安全：经 TextEncoder/TextDecoder，不走 btoa 直转字符串）───

export function b64Encode(text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin)
}

export function b64Decode(b64) {
  const bin = atob(b64.replace(/\s+/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export const toB64Url = s => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const fromB64Url = s => s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '')

export function formatBytes(n) {
  if (n == null || isNaN(n)) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function utf8Len(text) {
  return new TextEncoder().encode(text).length
}

export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // 引号不转：本仓场景内联文本节点足够
}

// ─── 随机生成 ─────────────────────────────────────────────

const CRYPTO = typeof crypto !== 'undefined' ? crypto : null

/** 随机字节（优先 crypto；非安全上下文回退 Math.random，仅展示用途） */
function randomBytes(n) {
  const bytes = new Uint8Array(n)
  if (CRYPTO?.getRandomValues) CRYPTO.getRandomValues(bytes)
  else for (let i = 0; i < n; i++) bytes[i] = Math.random() * 256 | 0
  return bytes
}

export function uuidV4() {
  if (CRYPTO?.randomUUID) return CRYPTO.randomUUID()
  // 回退：RFC 4122 v4 手搓（非安全上下文）
  const h = randomBytes(16)
  h[6] = (h[6] & 0x0f) | 0x40
  h[8] = (h[8] & 0x3f) | 0x80
  const hex = [...h].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** UUID v7：毫秒时间戳 + 随机（可排序，日志/数据库主键友好） */
export function uuidV7() {
  const ts = Date.now()
  const h = randomBytes(16)
  const view = new DataView(h.buffer)
  view.setUint32(0, ts / 2 ** 16 | 0)     // unix_ts_ms 高 32 位
  view.setUint16(4, ts & 0xffff)          // 低 16 位
  h[6] = (h[6] & 0x0f) | 0x70             // version 7
  h[8] = (h[8] & 0x3f) | 0x80             // variant
  const hex = [...h].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function nanoId(size = 21, alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  const bytes = randomBytes(size * 4)
  // 拒绝采样避免模偏差（alphabet 长度非 2 的幂时保证均匀）
  const max = 256 - (256 % alphabet.length)
  let out = ''
  for (let i = 0; out.length < size && i < bytes.length;) {
    const b = bytes[i++]
    if (b < max) out += alphabet[b % alphabet.length]
  }
  return out.slice(0, size)
}

/** 密码字符集（排除易混淆字符可选） */
export const PW_SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digit: '0123456789',
  symbol: '!@#$%^&*()-_=+[]{};:,.<>?/~',
}
export const PW_CONFUSING = 'il1Lo0O'

export function randomPassword(length, sets, excludeConfusing) {
  let pool = ''
  const required = []
  for (const s of sets) {
    let chars = PW_SETS[s]
    if (excludeConfusing) chars = [...chars].filter(c => !PW_CONFUSING.includes(c)).join('')
    if (chars) { pool += chars; required.push(chars) }
  }
  if (!pool) return ''
  const bytes = randomBytes(length * 2)
  const max = 256 - (256 % pool.length)
  const pick = () => {
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] < max) { const c = pool[bytes[i] % pool.length]; bytes[i] = 255; return c }
    }
    return pool[Math.random() * pool.length | 0]
  }
  const chars = Array.from({ length }, pick)
  // 每类至少一位（Fisher-Yates 洗回）
  required.forEach((charsPool, i) => {
    if (i < length && !charsPool.split('').some(c => chars.includes(c))) {
      chars[i] = charsPool[Math.random() * charsPool.length | 0]
    }
  })
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.random() * (i + 1) | 0
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

/** 熵（比特）= log2(poolSize) * length */
export function entropyBits(length, poolSize) {
  return length > 0 && poolSize > 1 ? +(length * Math.log2(poolSize)).toFixed(1) : 0
}
