/**
 * Digital Vault 加密核心（独立模块，未来浏览器扩展/移动端可直接复用）
 *
 * 零知识架构：
 *   Master Password ─Argon2id(salt₁)→ KEK₁ ─AES-GCM wrap→ VEK(256bit)
 *   Recovery Key(256bit) ─Argon2id(salt₂)→ KEK₂ ─wrap→ 同一 VEK
 *   条目数据：VEK + AES-256-GCM（每次全新 12-byte nonce）
 *
 * 不发明密码学：Argon2id 用 @noble/hashes（审计维护），AEAD 用原生 Web Crypto。
 * VEK 以不可导出 CryptoKey 只存内存；本模块任何函数都不会 console 输出密钥/明文。
 */
import { argon2id } from '@noble/hashes/argon2.js'

const te = new TextEncoder()
const td = new TextDecoder()

// ─── base64 工具 ────────────────────────────────────────
export function toB64(bytes) {
  let s = ''
  const arr = new Uint8Array(bytes)
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i])
  return btoa(s)
}
export function fromB64(b64) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
function rand(n) { return crypto.getRandomValues(new Uint8Array(n)) }

// ─── KDF ────────────────────────────────────────────────
// 默认参数（初始化时使用；解锁时以服务端存储的账号参数为准）
export const DEFAULT_KDF = { t: 2, m: 32768, p: 1 }

/** Argon2id 派生 KEK，导入为 AES-GCM CryptoKey（不可导出） */
async function deriveKEK(password, salt, params) {
  const dk = argon2id(te.encode(password), salt, {
    t: params.t, m: params.m, p: params.p, dkLen: 32,
  })
  return crypto.subtle.importKey('raw', dk, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

// ─── AEAD ───────────────────────────────────────────────
/** AES-256-GCM 加密 Uint8Array → { n, ct }（base64） */
async function aeadEncrypt(key, plaintextBytes) {
  const nonce = rand(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintextBytes)
  return { n: toB64(nonce), ct: toB64(ct) }
}

/** AES-256-GCM 解密 { n, ct } → Uint8Array（失败抛错 = 密码错误或数据损坏） */
async function aeadDecrypt(key, box) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(box.n) }, key, fromB64(box.ct))
  return new Uint8Array(pt)
}

// ─── VEK wrap / unwrap ──────────────────────────────────
/**
 * 初始化 Vault：生成随机 VEK，分别用主密码与 Recovery Key 包裹
 * @returns {account, recoveryKey}  account 提交给 POST /api/vault/account；recoveryKey 仅展示一次
 */
export async function createVaultMaterial(masterPassword) {
  const vekBytes = rand(32)
  const kdfSalt = rand(16)
  const recoverySalt = rand(16)
  const params = { ...DEFAULT_KDF }

  const kek = await deriveKEK(masterPassword, kdfSalt, params)
  const wrapped_vault_key = await aeadEncrypt(kek, vekBytes)

  const recoveryKey = generateRecoveryKey()
  const rkek = await deriveKEK(normalizeRecoveryKey(recoveryKey), recoverySalt, params)
  const recovery_wrapped_vault_key = await aeadEncrypt(rkek, vekBytes)

  return {
    account: {
      kdf_algo: 'argon2id',
      kdf_params: params,
      kdf_salt: toB64(kdfSalt),
      recovery_salt: toB64(recoverySalt),
      wrapped_vault_key,
      recovery_wrapped_vault_key,
    },
    recoveryKey,
  }
}

/**
 * 用主密码或 Recovery Key 解包 VEK
 * @param {object} account GET /api/vault/account 的 data
 * @param {string} secret 主密码或 Recovery Key
 * @param {boolean} isRecovery 走恢复密钥通道
 * @returns {Promise<CryptoKey>} VEK（不可导出，仅内存）
 */
export async function unlockVault(account, secret, isRecovery = false) {
  const params = account.kdf_params
  const salt = fromB64(isRecovery ? account.recovery_salt : account.kdf_salt)
  const kek = await deriveKEK(isRecovery ? normalizeRecoveryKey(secret) : secret, salt, params)
  const box = isRecovery ? account.recovery_wrapped_vault_key : account.wrapped_vault_key
  const vekBytes = await aeadDecrypt(kek, box)   // 错误密码 → GCM 校验失败 → 抛错
  return crypto.subtle.importKey('raw', vekBytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/**
 * 重包裹 VEK（修改主密码 / 轮换 Recovery Key；不重加密任何条目）
 * @param {object} account 当前账号材料（GET /api/vault/account）
 * @param {string} currentSecret 当前口令（主密码或 Recovery Key）
 * @param {boolean} isRecovery currentSecret 是否为 Recovery Key
 * @param {string} newSecret 新口令
 * @param {boolean} newIsRecovery 新口令是否为 Recovery Key
 * @returns {Promise<{box, salt, params}>} 提交 PUT /api/vault/account/keys 的对应字段
 */
export async function rewrapVaultKey(account, currentSecret, isRecovery, newSecret, newIsRecovery) {
  const params = { ...DEFAULT_KDF }
  // 用旧通道解出 VEK 字节（仅在本函数作用域内瞬时存在）
  const oldParams = account.kdf_params
  const oldSalt = fromB64(isRecovery ? account.recovery_salt : account.kdf_salt)
  const oldKek = await deriveKEK(isRecovery ? normalizeRecoveryKey(currentSecret) : currentSecret, oldSalt, oldParams)
  const oldBox = isRecovery ? account.recovery_wrapped_vault_key : account.wrapped_vault_key
  const vekBytes = await aeadDecrypt(oldKek, oldBox)

  // 新口令侧重新包裹
  const newSalt = rand(16)
  const newKek = await deriveKEK(newIsRecovery ? normalizeRecoveryKey(newSecret) : newSecret, newSalt, params)
  const newBox = await aeadEncrypt(newKek, vekBytes)
  return { box: newBox, salt: toB64(newSalt), params }
}

// ─── 条目加解密 ─────────────────────────────────────────
/** 加密任意可 JSON 化对象 → blob {n, ct} */
export async function encryptBlob(vek, obj) {
  return aeadEncrypt(vek, te.encode(JSON.stringify(obj)))
}

/** 解密 blob → 对象 */
export async function decryptBlob(vek, blob) {
  return JSON.parse(td.decode(await aeadDecrypt(vek, blob)))
}

// ─── Recovery Key ───────────────────────────────────────
/** 生成 256-bit 恢复密钥：64 hex，4 位一组展示 */
export function generateRecoveryKey() {
  const bytes = rand(32)
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  return (hex.match(/.{4}/g) || []).join('-')
}

/** 用户输入容错：大小写、分隔符 */
export function normalizeRecoveryKey(input) {
  return (input || '').toLowerCase().replace(/[^0-9a-f]/g, '')
}
