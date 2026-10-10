// 统一 API 客户端：后端地址全项目唯一持有处。
// 认证走会话 Cookie——/login 登录一次全站生效（HttpOnly doublog_session，30 天）；
// 401 时统一重定向登录页。各能力包的 api.js 一律从这里引 apiFetch，
// 禁止在组件里写 btoa/裸 fetch/硬编码端口。

const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'

export const API_BASE = `http://${host}:60100`

export async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) }
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  const resp = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' })
  // 会话失效 → 统一登录页（登录接口自身除外，避免重定向环）
  if (resp.status === 401 && !path.startsWith('/api/auth/login')
      && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    const next = encodeURIComponent(window.location.pathname + window.location.search)
    window.location.href = `/login?next=${next}`
  }
  return resp
}
