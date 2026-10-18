// API Hub 能力包 API 层：统一走 shared/client.js 的 apiFetch（Basic Auth 唯一持有处）。
// 网关调用（平台令牌 sk-）不走 apiFetch——那是给外部调用方的，管理页只需要 admin 接口。
// 分类维度：system → api（系统手动创建，API 路径映射到系统 base_url，鉴权内联在
// API 的 auth_config 明文 JSON——2026-10-17 起无密钥池）。

import { apiFetch } from '../shared/client'

async function json(path, options = {}) {
  const r = await apiFetch(path, options)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.message || `请求失败(${r.status})`)
  return body.data
}

export const apihubOverview = () => json('/api/apihub/stats/overview')
// params 形如 '?system_id=3'：系统详情页只取该系统的 API（省略=全部）
export const apihubApis = (params = '') => json(`/api/apihub/admin/apis${params}`)
export const apihubSystems = () => json('/api/apihub/admin/systems')
export const apihubTokens = () => json('/api/apihub/admin/tokens')
export const apihubRules = () => json('/api/apihub/admin/rules')
export const apihubLogs = (params = '') => json(`/api/apihub/logs${params}`)

export const apihubSaveSystem = (s) => s.id
  ? json(`/api/apihub/admin/systems/${s.id}`, { method: 'PUT', body: JSON.stringify(s) })
  : json('/api/apihub/admin/systems', { method: 'POST', body: JSON.stringify(s) })
export const apihubDeleteSystem = (id) => json(`/api/apihub/admin/systems/${id}`, { method: 'DELETE' })

export const apihubSaveApi = (a) => a.id
  ? json(`/api/apihub/admin/apis/${a.id}`, { method: 'PUT', body: JSON.stringify(a) })
  : json('/api/apihub/admin/apis', { method: 'POST', body: JSON.stringify(a) })
export const apihubToggleApi = (id, enabled) =>
  json(`/api/apihub/admin/apis/${id}/enabled`, { method: 'PUT', body: JSON.stringify({ enabled }) })
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

export const apihubGetProxy = () => json('/api/apihub/admin/proxy')
export const apihubSaveProxy = (cfg) =>
  json('/api/apihub/admin/proxy', { method: 'PUT', body: JSON.stringify(cfg) })
export const apihubTestProxy = () => json('/api/apihub/admin/proxy/test', { method: 'POST' })

export const apihubInvokeApi = (id, payload) =>
  json(`/api/apihub/admin/apis/${id}/invoke`, { method: 'POST', body: JSON.stringify(payload) })

// 调用文档（后端返回 text/markdown，非 api_response 信封）
export async function apihubApiDoc(id) {
  const r = await apiFetch(`/api/apihub/admin/apis/${id}/doc`)
  if (!r.ok) throw new Error(`文档获取失败(${r.status})`)
  return r.text()
}
