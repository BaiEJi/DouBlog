// 门户能力包 API 层：统一走 shared/client.js 的 apiFetch（会话 Cookie 认证）。
// 工作台布局（分组/顺序/标题描述覆盖）持久化在服务端 system_home_* 表。

import { apiFetch } from '../shared/client'

async function json(path, options = {}) {
  const r = await apiFetch(path, options)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.message || `请求失败(${r.status})`)
  return body.data
}

// ── 工作台布局 ──────────────────────────────────────────
// fetch: {groups: [{id, name, cards: [{key, title, desc}]}]}（空库 → groups: []）
export const fetchHomeLayout = () => json('/api/home/layout')

// save: 整体替换；返回服务端规整后的布局（分组带 id）
export const saveHomeLayout = (payload) =>
  json('/api/home/layout', { method: 'PUT', body: JSON.stringify(payload) })

// reset: 清空布局（恢复默认分组与默认文案）
export const resetHomeLayout = () =>
  json('/api/home/layout', { method: 'DELETE' })
