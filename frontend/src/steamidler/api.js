// Steam 挂机（steam-idler）子模块 API 层：源版 api.js 逻辑照搬。
// 走 shared/client.js 的 apiFetch（会话 Cookie 认证），端点前缀 /api/steamidler；
// 后端响应为 Doublog 信封 { success, code, message, data }——本层统一 unwrap 出 .data，
// 失败（HTTP 非 2xx 或 success=false）抛 Error(message)。
import { apiFetch } from '@/shared/client'

const PREFIX = '/api/steamidler'

async function request(path, options = {}) {
  const resp = await apiFetch(PREFIX + path, options)
  const body = await resp.json().catch(() => ({}))
  if (!resp.ok || body.success === false) {
    throw new Error(body.message || `请求失败 (${resp.status})`)
  }
  return body.data
}

export const api = {
  loginBegin: (username, password) =>
    request('/login/begin', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  loginCode: (attemptId, code, codeType = null) =>
    request('/login/code', {
      method: 'POST',
      body: JSON.stringify({ attempt_id: attemptId, code, code_type: codeType }),
    }),
  loginStatus: (attemptId, options) =>
    request(`/login/status?attempt_id=${encodeURIComponent(attemptId)}`, options),
  accounts: options => request('/accounts', options),
  accountGames: (steamid, force = false, options) =>
    request(`/accounts/${steamid}/games${force ? '?force=true' : ''}`, options),
  accountLog: (steamid, options) => request(`/accounts/${steamid}/log`, options),
  startIdle: (steamid, appids) =>
    request(`/accounts/${steamid}/idle`, {
      method: 'POST',
      body: JSON.stringify({ appids }),
    }),
  stopIdle: (steamid) => request(`/accounts/${steamid}/stop`, { method: 'POST' }),
  removeAccount: (steamid) => request(`/accounts/${steamid}`, { method: 'DELETE' }),
  setSharedSecret: (steamid, shared_secret) =>
    request(`/accounts/${steamid}/shared_secret`, {
      method: 'POST',
      body: JSON.stringify({ shared_secret }),
    }),
  setAutoResume: (steamid, enabled) =>
    request(`/accounts/${steamid}/auto_resume`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  meta: () => request('/meta'),
}

export function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h >= 24) {
    const d = Math.floor(h / 24)
    return `${d} 天 ${h % 24} 小时`
  }
  if (h > 0) return `${h} 小时 ${m} 分`
  if (m > 0) return `${m} 分 ${s % 60} 秒`
  return `${s} 秒`
}

export function fmtMinutes(minutes) {
  const m = Math.floor(minutes || 0)
  if (m < 60) return `${m} 分钟`
  return `${(m / 60).toFixed(1)} 小时`
}
