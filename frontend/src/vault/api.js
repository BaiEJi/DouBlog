import { apiFetch } from '@/shared/client'

/** ─── Vault（零知识密码库，见 docs/vault-design.md）─────────
 * 所有载荷均为客户端加密后的密文；本文件不出现任何明文口令参数 */

export async function vaultGetAccount(options) {
  const res = await apiFetch('/api/vault/account', options)
  return { status: res.status, data: await res.json() }
}

export async function vaultInitAccount(account, options) {
  const res = await apiFetch('/api/vault/account', { ...options, method: 'POST', body: JSON.stringify(account) })
  return res.json()
}

export async function vaultRotateKeys(payload, options) {
  const res = await apiFetch('/api/vault/account/keys', { ...options, method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function vaultSaveGroups(payload, options) {
  const res = await apiFetch('/api/vault/account/groups', { ...options, method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function vaultListItems(trash = false, options) {
  const res = await apiFetch(`/api/vault/items?trash=${trash ? 1 : 0}`, options)
  return res.json()
}

export async function vaultCreateItem(payload, options) {
  const res = await apiFetch('/api/vault/items', { ...options, method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function vaultUpdateItem(id, payload, options) {
  const res = await apiFetch(`/api/vault/items/${id}`, { ...options, method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function vaultMarkUsed(id, options) {
  const res = await apiFetch(`/api/vault/items/${id}/use`, { ...options, method: 'POST' })
  return res.json()
}

export async function vaultTrashItem(id, options) {
  const res = await apiFetch(`/api/vault/items/${id}`, { ...options, method: 'DELETE' })
  return res.json()
}

export async function vaultRestoreItem(id, options) {
  const res = await apiFetch(`/api/vault/items/${id}/restore`, { ...options, method: 'POST' })
  return res.json()
}

export async function vaultPurgeItem(id) {
  const res = await apiFetch(`/api/vault/items/${id}/purge`, { method: 'DELETE' })
  return res.json()
}

export async function vaultAudit(page = 1) {
  const res = await apiFetch(`/api/vault/audit?page=${page}`)
  return res.json()
}

export async function vaultExport(options) {
  const res = await apiFetch('/api/vault/export', options)
  return res.json()
}

export async function vaultImport(backup, options) {
  const res = await apiFetch('/api/vault/import', { ...options, method: 'POST', body: JSON.stringify(backup) })
  return res.json()
}

export async function vaultAppendItems(payload, options) {
  const res = await apiFetch('/api/vault/items/append', { ...options, method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

// ─── 安全附件（零知识：前端 VEK 加密后上传，服务端只见密文）──

export async function vaultListAttachments(itemId, options) {
  const res = await apiFetch(`/api/vault/items/${itemId}/attachments`, options)
  return res.json()
}

export async function vaultAddAttachment(itemId, { blob, size }, options) {
  const res = await apiFetch(`/api/vault/items/${itemId}/attachments`, {
    ...options, method: 'POST', body: JSON.stringify({ blob, size }),
  })
  return res.json()
}

export async function vaultGetAttachment(aid) {
  const res = await apiFetch(`/api/vault/attachments/${aid}`)
  return res.json()
}

export async function vaultDeleteAttachment(aid, options) {
  const res = await apiFetch(`/api/vault/attachments/${aid}`, { ...options, method: 'DELETE' })
  return res.json()
}
