import { apiFetch } from '@/shared/client'

export { API_BASE } from '@/shared/client'   // PwsvcView 展示 curl 示例用

// 密码库与密码服务 API。

export async function pwsvcCreateProject(payload) {
  const res = await apiFetch('/api/pwsvc/projects', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function pwsvcListProjects() {
  const res = await apiFetch('/api/pwsvc/projects')
  return res.json()
}

export async function pwsvcUpdateProject(id, payload) {
  const res = await apiFetch(`/api/pwsvc/projects/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function pwsvcDeleteProject(id) {
  const res = await apiFetch(`/api/pwsvc/projects/${id}`, { method: 'DELETE' })
  return res.json()
}

export async function pwsvcResetApiKey(id) {
  const res = await apiFetch(`/api/pwsvc/projects/${id}/api-key`, { method: 'POST' })
  return res.json()
}

export async function pwsvcCreateType(pid, payload) {
  const res = await apiFetch(`/api/pwsvc/projects/${pid}/types`, { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function pwsvcListTypes(pid) {
  const res = await apiFetch(`/api/pwsvc/projects/${pid}/types`)
  return res.json()
}

export async function pwsvcUpdateType(tid, payload) {
  const res = await apiFetch(`/api/pwsvc/types/${tid}`, { method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function pwsvcDeleteType(tid) {
  const res = await apiFetch(`/api/pwsvc/types/${tid}`, { method: 'DELETE' })
  return res.json()
}

export async function pwsvcCreateUser(pid, payload) {
  const res = await apiFetch(`/api/pwsvc/projects/${pid}/users`, { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function pwsvcListUsers(pid) {
  const res = await apiFetch(`/api/pwsvc/projects/${pid}/users`)
  return res.json()
}

export async function pwsvcUpdateUser(uid, payload) {
  const res = await apiFetch(`/api/pwsvc/users/${uid}`, { method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function pwsvcDeleteUser(uid) {
  const res = await apiFetch(`/api/pwsvc/users/${uid}`, { method: 'DELETE' })
  return res.json()
}

export async function pwsvcCurrentPassword(uid) {
  const res = await apiFetch(`/api/pwsvc/users/${uid}/current`)
  return res.json()
}
/** 校验日志（倒序分页）+ 失败统计（近 1h/24h 成败计数、失败 TOP5 用户名） */

export async function pwsvcListLogs(pid, page = 1, perPage = 50) {
  const res = await apiFetch(`/api/pwsvc/projects/${pid}/logs?page=${page}&per_page=${perPage}`)
  return res.json()
}

/** ─── Vault（零知识密码库，见 docs/vault-design.md）─────────
 * 所有载荷均为客户端加密后的密文；本文件不出现任何明文口令参数 */

export async function vaultGetAccount() {
  const res = await apiFetch('/api/vault/account')
  return { status: res.status, data: await res.json() }
}

export async function vaultInitAccount(account) {
  const res = await apiFetch('/api/vault/account', { method: 'POST', body: JSON.stringify(account) })
  return res.json()
}

export async function vaultRotateKeys(payload) {
  const res = await apiFetch('/api/vault/account/keys', { method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function vaultListItems(trash = false) {
  const res = await apiFetch(`/api/vault/items?trash=${trash ? 1 : 0}`)
  return res.json()
}

export async function vaultCreateItem(payload) {
  const res = await apiFetch('/api/vault/items', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function vaultUpdateItem(id, payload) {
  const res = await apiFetch(`/api/vault/items/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
  return res.json()
}

export async function vaultMarkUsed(id) {
  const res = await apiFetch(`/api/vault/items/${id}/use`, { method: 'POST' })
  return res.json()
}

export async function vaultTrashItem(id) {
  const res = await apiFetch(`/api/vault/items/${id}`, { method: 'DELETE' })
  return res.json()
}

export async function vaultRestoreItem(id) {
  const res = await apiFetch(`/api/vault/items/${id}/restore`, { method: 'POST' })
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

export async function vaultExport() {
  const res = await apiFetch('/api/vault/export')
  return res.json()
}

export async function vaultImport(backup) {
  const res = await apiFetch('/api/vault/import', { method: 'POST', body: JSON.stringify(backup) })
  return res.json()
}

// ─── 安全附件（零知识：前端 VEK 加密后上传，服务端只见密文）──

export async function vaultListAttachments(itemId) {
  const res = await apiFetch(`/api/vault/items/${itemId}/attachments`)
  return res.json()
}

export async function vaultAddAttachment(itemId, { blob, size }) {
  const res = await apiFetch(`/api/vault/items/${itemId}/attachments`, {
    method: 'POST', body: JSON.stringify({ blob, size }),
  })
  return res.json()
}

export async function vaultGetAttachment(aid) {
  const res = await apiFetch(`/api/vault/attachments/${aid}`)
  return res.json()
}

export async function vaultDeleteAttachment(aid) {
  const res = await apiFetch(`/api/vault/attachments/${aid}`, { method: 'DELETE' })
  return res.json()
}
