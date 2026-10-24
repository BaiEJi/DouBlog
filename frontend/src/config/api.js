// 系统配置能力包 API 层：统一走 shared/client.js 的 apiFetch（会话 Cookie 认证）。
// 覆盖：数据库后端（SQLite/PostgreSQL 一键切换）+ 日志上报配置。

import { apiJson } from '../shared/client'

async function json(path, options = {}) {
  return apiJson(path, options)
}

// ── 数据库 ──────────────────────────────────────────────
export const fetchDbStatus = (options) => json('/api/admin/database', options)

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

// ── 登录账号（system_accounts 表）───────────────────────
export const fetchAccount = () => json('/api/admin/account')

export const updateAccount = (payload) =>
  json('/api/admin/account', { method: 'PUT', body: JSON.stringify(payload) })
