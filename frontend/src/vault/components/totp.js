/**
 * TOTP（RFC 6238）客户端实现 —— WebCrypto HMAC-SHA1，零第三方依赖。
 * 零知识：密钥只在内存中参与运算，不出本设备。
 *
 * 支持：
 * - Base32 密钥（Google Authenticator 兼容，忽略空格/连字符/填充）
 * - otpauth:// URI 解析（totp/htop，取 secret/issuer/label/digits/period）
 */

const te = new TextEncoder()

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Base32 解码 → Uint8Array；非法字符抛错 */
export function base32Decode(input) {
  const s = String(input || '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')
  let bits = 0
  let value = 0
  const out = []
  for (const ch of s) {
    const idx = B32.indexOf(ch)
    if (idx === -1) throw new Error(`非法 Base32 字符: ${ch}`)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/** otpauth://totp/Label?secret=…&issuer=…&digits=6&period=30 → 参数对象；非本格式返回 null */
export function parseOtpauth(uri) {
  if (typeof uri !== 'string' || !uri.toLowerCase().startsWith('otpauth://')) return null
  try {
    const u = new URL(uri)
    const type = (u.host || '').toLowerCase()
    if (type !== 'totp' && type !== 'hotp') return null
    const secret = u.searchParams.get('secret')
    if (!secret) return null
    const label = decodeURIComponent(u.pathname.replace(/^\/+/, ''))
    const digits = parseInt(u.searchParams.get('digits') || '6', 10)
    const period = parseInt(u.searchParams.get('period') || '30', 10)
    return {
      type,
      secret,
      label: label.split(':').pop() || label,
      issuer: u.searchParams.get('issuer') || label.split(':')[0] || '',
      digits: digits >= 6 && digits <= 8 ? digits : 6,
      period: period >= 15 && period <= 300 ? period : 30,
    }
  } catch {
    return null
  }
}

/** 是否“看起来像”TOTP 材料（Base32 且长度合理）——用于自动识别 2FA 字段 */
export function looksLikeBase32Secret(v) {
  const s = String(v || '').replace(/[\s-]/g, '')
  return s.length >= 8 && s.length <= 128 && /^[A-Za-z2-7]+=*$/.test(s)
}

/**
 * 计算当前 TOTP 码。
 * @returns {Promise<{code: string, remaining: number, period: number}>}
 *          remaining = 本周期剩余秒数（UI 环形倒计时用）
 */
export async function totpNow(secretB32, { digits = 6, period = 30, atMs = Date.now() } = {}) {
  const keyBytes = base32Decode(secretB32)
  if (!keyBytes.length) throw new Error('空密钥')
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const counter = Math.floor(atMs / 1000 / period)
  const msg = new Uint8Array(8)
  let c = counter
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256) }
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  // RFC 4226 动态截断
  const offset = mac[mac.length - 1] & 0x0f
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]
  const code = String(bin % (10 ** digits)).padStart(digits, '0')
  return { code, remaining: period - Math.floor(atMs / 1000) % period, period }
}
