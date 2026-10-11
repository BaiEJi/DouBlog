// 配置中心能力包 API 层：统一走 shared/client.js 的 apiFetch（会话 Cookie 认证）。
// 端点契约见 docs/confcenter-spec.md 第 3 节：namespace 聚合 / KV 浏览与 CRUD / Redis 缓存管理。

import { apiFetch } from '../shared/client'

async function json(path, options = {}) {
  const r = await apiFetch(path, options)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.message || `请求失败(${r.status})`)
  return body.data
}

/** namespace/key 均限 [A-Za-z0-9_.:-]，路径段编码防意外 */
const seg = s => encodeURIComponent(s)

// ── KV 条目 ──────────────────────────────────────────────

/** distinct namespace 列表 + 每个 ns 的条目数 */
export const confNamespaces = () => json('/api/confcenter/namespaces')

/** 浏览（q 模糊匹配 key；省略 namespace = 全部；分页） */
export const confEntries = ({ namespace = '', q = '', page = 1, pageSize = 50 } = {}) => {
  const params = new URLSearchParams()
  if (namespace) params.set('namespace', namespace)
  if (q) params.set('q', q)
  params.set('page', page)
  params.set('page_size', pageSize)
  return json(`/api/confcenter/entries?${params}`)
}

/** 读单条（str → 字符串；json → 解析后的结构） */
export const confGetEntry = (namespace, key) =>
  json(`/api/confcenter/${seg(namespace)}/${seg(key)}`)

/** upsert 整体覆盖 {type:'str'|'json', data}（type=json 时 data 必须是合法 JSON 文本） */
export const confPutEntry = (namespace, key, payload) =>
  json(`/api/confcenter/${seg(namespace)}/${seg(key)}`, { method: 'PUT', body: JSON.stringify(payload) })

export const confDeleteEntry = (namespace, key) =>
  json(`/api/confcenter/${seg(namespace)}/${seg(key)}`, { method: 'DELETE' })

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
