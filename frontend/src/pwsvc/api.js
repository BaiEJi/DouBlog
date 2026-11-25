import { apiFetch } from '@/shared/client'


// 独立密码服务管理 API。

export async function pwsvcCreateProject(payload) {
  const res = await apiFetch('/api/pwsvc/projects', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function pwsvcListProjects(options) {
  const res = await apiFetch('/api/pwsvc/projects', options)
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

export async function pwsvcListTypes(pid, options) {
  const res = await apiFetch(`/api/pwsvc/projects/${pid}/types`, options)
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

export async function pwsvcListUsers(pid, options) {
  const res = await apiFetch(`/api/pwsvc/projects/${pid}/users`, options)
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

export async function pwsvcCurrentPassword(uid, options) {
  const res = await apiFetch(`/api/pwsvc/users/${uid}/current`, options)
  return res.json()
}
/** 校验日志（倒序分页）+ 失败统计（近 1h/24h 成败计数、失败 TOP5 用户名） */

export async function pwsvcListLogs(pid, page = 1, perPage = 50, options) {
  const res = await apiFetch(`/api/pwsvc/projects/${pid}/logs?page=${page}&per_page=${perPage}`, options)
  return res.json()
}
