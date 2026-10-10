// API Hub 能力包 API 层：统一走 shared/client.js 的 apiFetch（Basic Auth 唯一持有处）。
// 网关调用（平台令牌 sk-）不走 apiFetch——那是给外部调用方的，管理页只需要 admin 接口。

import { apiFetch } from '../shared/client'

async function json(path, options = {}) {
  const r = await apiFetch(path, options)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.message || `请求失败(${r.status})`)
  return body.data
}

export const apihubOverview = () => json('/api/apihub/stats/overview')
export const apihubApis = () => json('/api/apihub/admin/apis')
export const apihubUpstreams = () => json('/api/apihub/admin/upstreams')
export const apihubTokens = () => json('/api/apihub/admin/tokens')
export const apihubRules = () => json('/api/apihub/admin/rules')
export const apihubLogs = (params = '') => json(`/api/apihub/logs${params}`)

export const apihubSaveUpstream = (u) => u.id
  ? json(`/api/apihub/admin/upstreams/${u.id}`, { method: 'PUT', body: JSON.stringify(u) })
  : json('/api/apihub/admin/upstreams', { method: 'POST', body: JSON.stringify(u) })
export const apihubDeleteUpstream = (id) => json(`/api/apihub/admin/upstreams/${id}`, { method: 'DELETE' })
export const apihubKeys = (uid) => json(`/api/apihub/admin/upstreams/${uid}/keys`)
export const apihubAddKey = (uid, credential) =>
  json(`/api/apihub/admin/upstreams/${uid}/keys`, { method: 'POST', body: JSON.stringify({ credential }) })
export const apihubUpdateKey = (kid, payload) =>
  json(`/api/apihub/admin/upstreams/keys/${kid}`, { method: 'PUT', body: JSON.stringify(payload) })
export const apihubDeleteKey = (kid) => json(`/api/apihub/admin/upstreams/keys/${kid}`, { method: 'DELETE' })

export const apihubSaveApi = (a) => a.id
  ? json(`/api/apihub/admin/apis/${a.id}`, { method: 'PUT', body: JSON.stringify(a) })
  : json('/api/apihub/admin/apis', { method: 'POST', body: JSON.stringify(a) })
export const apihubDeleteApi = (id) => json(`/api/apihub/admin/apis/${id}`, { method: 'DELETE' })

export const apihubCreateToken = (t) =>
  json('/api/apihub/admin/tokens', { method: 'POST', body: JSON.stringify(t) })
export const apihubUpdateToken = (id, payload) =>
  json(`/api/apihub/admin/tokens/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
export const apihubDeleteToken = (id) => json(`/api/apihub/admin/tokens/${id}`, { method: 'DELETE' })

export const apihubSaveRule = (r) => r.id
  ? json(`/api/apihub/admin/rules/${r.id}`, { method: 'PUT', body: JSON.stringify(r) })
  : json('/api/apihub/admin/rules', { method: 'POST', body: JSON.stringify(r) })
export const apihubDeleteRule = (id) => json(`/api/apihub/admin/rules/${id}`, { method: 'DELETE' })

export const apihubProbeAll = (apiIds = null) =>
  json('/api/apihub/probes/run', { method: 'POST', body: JSON.stringify(apiIds ? { api_ids: apiIds } : {}) })
