import { argon2id } from '@noble/hashes/argon2.js'
self.onmessage = async ({ data: { id, payload } }) => {
  let derived
  try {
    const { password, salt, params } = payload
    derived = argon2id(new TextEncoder().encode(password), salt, { t: params.t, m: params.m, p: params.p, dkLen: 32 })
    const result = await crypto.subtle.importKey('raw', derived, 'AES-GCM', false, ['encrypt', 'decrypt'])
    self.postMessage({ id, result })
  } catch (error) { self.postMessage({ id, error: { name: error.name, message: error.message } }) }
  finally { derived?.fill(0) }
}
