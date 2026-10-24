import { API_BASE } from './client.js'
import { getDataEpoch, isDataContextStale, setDataContext, subscribeDataEpoch } from './dataEpoch.js'
let request, checkedAt = 0, result
subscribeDataEpoch(() => { checkedAt = 0; result = undefined; request = undefined })
export function checkSession({ force = false } = {}) {
  if (isDataContextStale()) return Promise.resolve('ok')
  if (!force && result === 'ok' && Date.now() - checkedAt < 10000) return Promise.resolve(result)
  if (request) return request
  const epoch = getDataEpoch()
  const active = fetch(`${API_BASE}/api/auth/check`, { credentials: 'include', cache: 'no-store' }).then(async response => {
    if (epoch !== getDataEpoch()) return 'unavailable'
    if (response.ok) {
      const envelope = await response.json()
      if (epoch !== getDataEpoch()) return 'unavailable'
      setDataContext(envelope.data?.username, envelope.data?.database_identity)
    }
    result = response.status === 401 ? 'out' : response.ok ? 'ok' : 'unavailable'
    checkedAt = Date.now(); return result
  }).catch(() => 'unavailable').finally(() => { if (request === active) request = undefined })
  request = active
  return active
}
