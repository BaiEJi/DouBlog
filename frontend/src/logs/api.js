import { apiFetch } from '@/shared/client'

// 日志查询 API（sdklogs 模块）。

export async function sdklogSearch(params, options = {}) {
  const qs = new URLSearchParams(params).toString()
  const res = await apiFetch(`/api/v1/logs?${qs}`, options)
  return res.json()
}

export async function sdklogSysnames() {
  const res = await apiFetch('/api/v1/logs/sysnames')
  return res.json()
}

/** 时间直方图（桶 × 级别计数） */
export async function sdklogHistogram(params, options = {}) {
  const qs = new URLSearchParams(params).toString()
  const res = await apiFetch(`/api/v1/logs/histogram?${qs}`, options)
  return res.json()
}

/** 日志上下文（前后 N 条） */
export async function sdklogContext(id, before = 10, after = 10) {
  const res = await apiFetch(`/api/v1/logs/context?id=${id}&before=${before}&after=${after}`)
  return res.json()
}

/** 模式分组（相似消息归并） */
export async function sdklogPatterns(params) {
  const qs = new URLSearchParams(params).toString()
  const res = await apiFetch(`/api/v1/logs/patterns?${qs}`)
  return res.json()
}

/** trace 时间线 */
export async function sdklogTrace(id) {
  const res = await apiFetch(`/api/v1/logs/trace?id=${encodeURIComponent(id)}`)
  return res.json()
}

/** 导出（blob → 前端触发下载，便于携带 Basic Auth 头） */
export async function sdklogExport(params, format = 'csv') {
  const qs = new URLSearchParams({ ...params, format }).toString()
  const res = await apiFetch(`/api/v1/logs/export?${qs}`)
  if (!res.ok) throw new Error(`导出失败 HTTP ${res.status}`)
  return res.blob()
}

/** 告警：状态 / 配置 / 立即检查 / 确认 */
export async function sdklogAlerts() {
  const res = await apiFetch('/api/v1/alerts')
  return res.json()
}
export async function sdklogAlertConfig(cfg) {
  const res = await apiFetch('/api/v1/alerts/config', { method: 'PUT', body: JSON.stringify(cfg) })
  return res.json()
}
export async function sdklogAlertCheck() {
  const res = await apiFetch('/api/v1/alerts/check', { method: 'POST' })
  return res.json()
}
export async function sdklogAlertAck(payload) {
  const res = await apiFetch('/api/v1/alerts/ack', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}
