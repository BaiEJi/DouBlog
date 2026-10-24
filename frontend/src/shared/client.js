// 统一 API 客户端：后端地址全项目唯一持有处。
// 认证走会话 Cookie——/login 登录一次全站生效（HttpOnly doublog_session，30 天）；
// 401 时统一重定向登录页。各能力包的 api.js 一律从这里引 apiFetch，
// 禁止在组件里写 btoa/裸 fetch/硬编码端口。

import { assertDataEpoch, getDataEpoch, getDatabaseIdentity, isDataContextStale, markDataContextStale, subscribeDataEpoch } from './dataEpoch.js'

const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'

export const API_BASE = (import.meta.env?.VITE_API_BASE ?? `http://${host}:60100`).replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message, { status = 0, code, details, traceId, cause } = {}) {
    super(message, { cause }); this.name = 'ApiError'
    Object.assign(this, { status, code, details, traceId })
  }
}

export async function readEnvelope(response) {
  const body = await response.json().catch(error => {
    if (error.name === 'AbortError') throw error
    if (!response.ok) return {}
    throw new ApiError('服务返回的 JSON 无效', { code: 'INVALID_RESPONSE', cause: error, traceId: response.headers.get('X-Trace-Id') })
  })
  if (!body || typeof body !== 'object') throw new ApiError('服务返回的响应格式无效', { code: 'INVALID_RESPONSE' })
  const code = body.data?.error_code || body.error?.code || body.code
  if (code === 'DATABASE_CHANGED') markDataContextStale()
  if (!response.ok || body.success === false) throw new ApiError(body.message || `请求失败(${response.status})`, {
    status: response.status, code,
    details: body.details || body.error?.details || body.data?.details, traceId: response.headers.get('X-Trace-Id'),
  })
  return body.data
}

export async function apiJson(path, options) { return readEnvelope(await apiFetch(path, options)) }

export async function apiFetch(path, options = {}) {
  const controlRequest = path.startsWith('/api/auth/') || /^\/api\/admin\/(database|runtime)(?:\?|$)/.test(path)
  if (!controlRequest && isDataContextStale()) throw new ApiError('数据库已在其他页面切换，请先复制或下载未保存内容，再重新加载页面', { status: 409, code: 'DATABASE_CHANGED' })
  const epoch = getDataEpoch()
  const expectedIdentity = getDatabaseIdentity()
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  const unsubscribe = subscribeDataEpoch(() => controller.abort(new DOMException('数据源已切换', 'AbortError')))
  const cleanup = () => { unsubscribe(); options.signal?.removeEventListener('abort', abort) }
  controller.signal.addEventListener('abort', cleanup, { once: true })
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, { once: true })
  const headers = new Headers(options.headers)
  if (expectedIdentity) headers.set('X-Expected-Database-Identity', expectedIdentity)
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  let resp
  try {
    resp = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include', signal: controller.signal })
    assertDataEpoch(epoch)
    const actualIdentity = resp.headers.get('X-Database-Identity')
    if (!controlRequest && expectedIdentity && actualIdentity && actualIdentity !== expectedIdentity) {
      markDataContextStale()
      cleanup()
      resp.body?.cancel?.().catch(() => {})
      throw new ApiError('数据库已在其他页面切换，请先复制或下载未保存内容，再重新加载页面', { status: 409, code: 'DATABASE_CHANGED', details: { identity: actualIdentity }, traceId: resp.headers.get('X-Trace-Id') })
    }
    // Guard bodies too: switching can happen after response headers arrive.
    for (const method of ['json', 'text', 'blob', 'arrayBuffer']) {
      const read = resp[method].bind(resp)
      resp[method] = async (...args) => { try { const body = await read(...args); assertDataEpoch(epoch); return body } finally { cleanup() } }
    }
    if (!resp.body) cleanup()
  } catch (error) { cleanup(); throw error }
  // 会话失效 → 统一登录页（登录接口自身除外，避免重定向环）
  if (resp.status === 401 && !path.startsWith('/api/auth/login')
      && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    cleanup()
    const next = encodeURIComponent(window.location.pathname + window.location.search + (window.location.hash || ''))
    window.location.href = `/login?next=${next}`
  }
  return resp
}
