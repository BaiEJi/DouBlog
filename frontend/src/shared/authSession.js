import { API_BASE } from './client.js'
import { getDataEpoch, isDataContextStale, setDataContext, subscribeDataEpoch } from './dataEpoch.js'

// 认证检查总截止时间：覆盖响应头与响应体解析全过程。
// 超时/网络失败/5xx/坏 JSON 一律归为 unavailable（服务状态暂不可确认 + 重试），
// 只有真实的 401 才是未登录——绝不能把临时故障当成未登录清态跳登录。
export const AUTH_CHECK_TIMEOUT_MS = 10000

let request, checkedAt = 0, result
subscribeDataEpoch(() => { checkedAt = 0; result = undefined; request = undefined })

export function checkSession({ force = false, timeoutMs = AUTH_CHECK_TIMEOUT_MS } = {}) {
  if (isDataContextStale()) return Promise.resolve('ok')
  if (!force && result === 'ok' && Date.now() - checkedAt < 10000) return Promise.resolve(result)
  if (request) return request
  const epoch = getDataEpoch()
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DOMException('认证检查超时', 'TimeoutError'))
  }, timeoutMs)
  const active = fetch(`${API_BASE}/api/auth/check`, {
    credentials: 'include', cache: 'no-store', signal: controller.signal,
  }).then(async response => {
    // 坏 JSON：成功状态码但响应体不可解析 → unavailable，不得视为已认证
    const envelope = await response.json().catch(() => null)
    if (epoch !== getDataEpoch()) return 'unavailable'
    // 结构校验：统一成功信封 {success, data}，data 为非数组对象且
    // authenticated===true、username/database_identity 为非空字符串——
    // "JSON 能解析"不等于合法认证结果；任何畸形都归 unavailable，
    // 不把缺失身份送进数据上下文、不污染已确认身份/成功缓存。
    const data = envelope && typeof envelope === 'object' && !Array.isArray(envelope)
      && typeof envelope.data === 'object' && envelope.data !== null && !Array.isArray(envelope.data)
      ? envelope.data : null
    const identityValid = data
      && data.authenticated === true
      && typeof data.username === 'string' && data.username.length > 0
      && typeof data.database_identity === 'string' && data.database_identity.length > 0
    if (identityValid) {
      setDataContext(data.username, data.database_identity)
      result = 'ok'
    } else {
      result = response.status === 401 ? 'out' : 'unavailable'
    }
    checkedAt = Date.now()
    return result
  }).catch(() => 'unavailable').finally(() => {
    clearTimeout(timer)
    // 旧请求的 finally 不得清掉新请求的引用
    if (request === active) request = undefined
  })
  request = active
  return active
}
