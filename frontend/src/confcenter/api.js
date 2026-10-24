// 配置中心能力包 API 层：统一走 shared/client.js 的 apiFetch（会话 Cookie 认证）。
// 端点契约见 docs/confcenter-spec.md 第 3 节：namespace 聚合 / KV 浏览与 CRUD / Redis 缓存管理。

import { apiFetch } from '../shared/client.js'

async function json(path, options = {}) {
  const r = await apiFetch(path, options)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.message || `请求失败(${r.status})`)
  return body.data
}

/** namespace/key 均限 [A-Za-z0-9_.:-]，路径段编码防意外 */
const seg = s => encodeURIComponent(s)

// ── KV 条目 ──────────────────────────────────────────────

/** namespace 列表（包含空空间）+ 每个 ns 的条目数 */
export const confNamespaces = () => json('/api/confcenter/namespaces')

export const confCreateNamespace = namespace =>
  json('/api/confcenter/namespaces', { method: 'POST', body: JSON.stringify({ namespace }) })

/** 浏览（q 模糊匹配 key；省略 namespace = 全部；分页；可选排序）。
 *  sortBy：key|type|data|updated_at（白名单，后端 400 校验）；sortOrder：asc|desc。
 *  未传排序参数时后端保留旧 namespace+key 顺序。 */
export const confEntries = ({ namespace = '', q = '', page = 1, pageSize = 50,
  sortBy = '', sortOrder = '' } = {}) => {
  const params = new URLSearchParams()
  if (namespace) params.set('namespace', namespace)
  if (q) params.set('q', q)
  params.set('page', page)
  params.set('page_size', pageSize)
  if (sortBy) params.set('sort_by', sortBy)
  if (sortOrder) params.set('sort_order', sortOrder)
  return json(`/api/confcenter/entries?${params}`)
}

/** 读单条（str → 字符串；json → 解析后的结构） */
export const confGetEntry = (namespace, key) =>
  json(`/api/confcenter/${seg(namespace)}/${seg(key)}`)

/** upsert 整体覆盖 {type:'str'|'json', data}（type=json 时 data 必须是合法 JSON 文本） */
export const confPutEntry = (namespace, key, payload) =>
  json(`/api/confcenter/${seg(namespace)}/${seg(key)}`, { method: 'PUT', body: JSON.stringify(payload) })

export const confDeleteEntry = (namespace, key, updatedAt) =>
  json(`/api/confcenter/${seg(namespace)}/${seg(key)}${updatedAt ? `?${new URLSearchParams({ if_updated_at: updatedAt })}` : ''}`, { method: 'DELETE' })

/** 同空间重命名 key（单事务迁移，值/时间戳原样保留）；新 key 已存在抛 409 */
export const confRenameEntry = (namespace, oldKey, newKey, payload = {}) =>
  json('/api/confcenter/rename', {
    method: 'PUT',
    body: JSON.stringify({ namespace, old_key: oldKey, new_key: newKey, ...payload }),
  })

// ── Redis 缓存管理 ───────────────────────────────────────

/** {enabled, reachable, url_masked, hits, misses}（不可达时 enabled=false 不报错） */
export const confCacheStatus = () => json('/api/confcenter/cache/status')

/** 当前缓存配置（配置 Modal 回显；单用户管理端原样返回，含密码） */
export const confCacheConfig = () => json('/api/confcenter/cache/config')

/** {enabled, host, port, db, password, ttl_seconds} → 写入 data/redis_config.json */
export const confCacheSave = (cfg) =>
  json('/api/confcenter/cache/config', { method: 'PUT', body: JSON.stringify(cfg) })

/** 测试连通（PING），返回 {ok, message} */
export const confCacheTest = (cfg) =>
  json('/api/confcenter/cache/test', { method: 'POST', body: JSON.stringify(cfg) })

/** 清空本模块缓存键（confcenter:* 前缀 SCAN+DEL，非整库 FLUSHDB），管理用 */
export const confCacheFlush = () =>
  json('/api/confcenter/cache/flush', { method: 'POST' })

// ── namespace 限流管理 ──────────────────────────────────

/** {enabled, mode: off|local|redis, limit, window_seconds, overrides, allowed, rejected, tracked, redis} */
export const confRatelimitStatus = () => json('/api/confcenter/ratelimit/status')

/** 当前限流配置回显 {enabled, limit, window_seconds, overrides} */
export const confRatelimitConfig = () => json('/api/confcenter/ratelimit/config')

/** 保存限流配置（overrides 整体替换；覆盖行 limit=0 表示该空间豁免） */
export const confRatelimitSave = (cfg) =>
  json('/api/confcenter/ratelimit/config', { method: 'PUT', body: JSON.stringify(cfg) })

/** 清零某 namespace 的限流窗口计数（本地 + Redis 双路径） */
export const confRatelimitReset = (namespace) =>
  json('/api/confcenter/ratelimit/reset', { method: 'POST', body: JSON.stringify({ namespace }) })
