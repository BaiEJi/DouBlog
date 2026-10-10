// 系统配置能力包 API 层：统一走 shared/client.js 的 apiFetch（Basic Auth 唯一持有处）。
// 覆盖：数据库后端（SQLite/PostgreSQL 一键切换）+ 日志上报配置。

import { apiFetch } from '../shared/client'

async function json(path, options = {}) {
  const r = await apiFetch(path, options)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.message || `请求失败(${r.status})`)
  return body.data
}

// ── 数据库 ──────────────────────────────────────────────
export const fetchDbStatus = () => json('/api/admin/database')

export const testDbConnection = (payload) =>
  json('/api/admin/database/test', { method: 'POST', body: JSON.stringify(payload) })

export const switchDatabase = (payload) =>
  json('/api/admin/database/switch', { method: 'POST', body: JSON.stringify(payload) })

// ── 日志上报 ────────────────────────────────────────────
export const fetchLoggingConfig = () => json('/api/admin/logging')

export const saveLoggingConfig = (payload) =>
  json('/api/admin/logging', { method: 'PUT', body: JSON.stringify(payload) })

export const testLoggingSend = () =>
  json('/api/admin/logging/test', { method: 'POST' })
