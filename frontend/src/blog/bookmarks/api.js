// 书签与稍后阅读（bookmarks）子模块 API 层：统一走 shared/client.js 的 apiFetch（会话 Cookie 认证）。
// 端点前缀 /api/bookmarks，与 backend/app/bookmarks 路由一一对应（docs/modules/bookmarks.md）。
// 后端响应为 Doublog 信封 { success, code, message, data }——本层统一 unwrap 出 .data，
// 失败（HTTP 非 2xx 或 success=false）抛 Error(message)。所有请求带 30s 超时。
// 末尾附展示元信息（状态/链路状态/排序），供列表、表单、统计共用。
import { apiFetch } from '@/shared/client'

const PREFIX = '/api/bookmarks'
const TIMEOUT_MS = 30_000

function withTimeout(promise, ms = TIMEOUT_MS) {
  let timer
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('请求超时')), ms)
  })
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer))
}

async function json(path, options = {}) {
  const r = await withTimeout(apiFetch(path, options))
  const body = await r.json().catch(() => ({}))
  if (!r.ok || body.success === false) {
    throw new Error(body.message || `请求失败(${r.status})`)
  }
  return body.data
}

function qs(params = {}) {
  const usp = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false))
  )
  const s = usp.toString()
  return s ? `?${s}` : ''
}

// ── 分类 categories ─────────────────────────────────────────
/** → 分类树 [{ id, name, parent_id, sort_order, count, total_count, children }] */
export const listCategories = () => json(`${PREFIX}/categories`)
export const createCategory = payload =>
  json(`${PREFIX}/categories`, { method: 'POST', body: JSON.stringify(payload) })
/** payload: { name?, parent_id?(显式 null=提为顶级), sort_order? } */
export const updateCategory = (id, payload) =>
  json(`${PREFIX}/categories/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
export const deleteCategory = id => json(`${PREFIX}/categories/${id}`, { method: 'DELETE' })

// ── 标签 tags ───────────────────────────────────────────────
/** → [{ id, name, color, item_count }] */
export const listTags = () => json(`${PREFIX}/tags`)
export const createTag = payload =>
  json(`${PREFIX}/tags`, { method: 'POST', body: JSON.stringify(payload) })
export const updateTag = (id, payload) =>
  json(`${PREFIX}/tags/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
export const deleteTag = id => json(`${PREFIX}/tags/${id}`, { method: 'DELETE' })

// ── 条目 items ──────────────────────────────────────────────
/** 列表筛选：q / status / category_id / include_descendants / tag_ids(逗号) / tags_op /
 *  starred / link_status / trash / sort / page / page_size
 *  → { items(不含 note/snapshot_md 大字段), total, page, page_size }；补 pages 供分页 */
export const listItems = (params = {}) =>
  json(`${PREFIX}/items${qs(params)}`).then(res => {
    const items = res?.items || []
    const total = res?.total ?? items.length
    const size = res?.page_size || 20
    return { ...res, items, total, pages: Math.max(1, Math.ceil(total / size)) }
  })
/** 创建（可带 tag_ids/tag_names；409=同链已存在） */
export const createItem = payload =>
  json(`${PREFIX}/items`, { method: 'POST', body: JSON.stringify(payload) })
/** 详情（含 note/snapshot_md） */
export const getItem = id => json(`${PREFIX}/items/${id}`)
/** 部分更新：显式传 category_id: null = 移到未分类；tag_ids/tag_names 整体替换 */
export const updateItem = (id, payload) =>
  json(`${PREFIX}/items/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
/** 软删 → 回收站 */
export const deleteItem = id => json(`${PREFIX}/items/${id}`, { method: 'DELETE' })
export const restoreItem = id =>
  json(`${PREFIX}/items/${id}/restore`, { method: 'POST' })
export const purgeItem = id => json(`${PREFIX}/items/${id}/purge`, { method: 'DELETE' })
/** 批量：action = status|star|unstar|move_category|add_tags|delete|restore */
export const batchItems = (ids, action, extra = {}) =>
  json(`${PREFIX}/items/batch`, { method: 'POST', body: JSON.stringify({ ids, action, ...extra }) })

/** 阅读队列下一篇（最早的未读；可按分类/标签过滤）→ 条目或 null */
export const queueNext = (params = {}) => json(`${PREFIX}/items/queue/next${qs(params)}`)
/** 重复链接分组 → [{ normalized_url, items }] */
export const listDuplicates = () => json(`${PREFIX}/items/duplicates`)

/** 抓页面元信息（不落库）→ { url, title, description, site_name, favicon_url } */
export const fetchMeta = url => json(`${PREFIX}/meta${qs({ url })}`)
/** 抓正文存快照 → 更新后的条目（含 snapshot_md） */
export const createSnapshot = id =>
  json(`${PREFIX}/items/${id}/snapshot`, { method: 'POST' })
export const deleteSnapshot = id =>
  json(`${PREFIX}/items/${id}/snapshot`, { method: 'DELETE' })

/** 死链检测：ids 为空 = 检测全库最久未检的前 50 条 → { checked, ok, dead, error } */
export const checkLinks = (ids = []) =>
  json(`${PREFIX}/check`, { method: 'POST', body: JSON.stringify({ ids }) })

/** 统计总览 → { total, by_status, starred, dead, snapshots, snapshot_words, trash,
 *  by_category, by_tag, domains, trend } */
export const statsOverview = () => json(`${PREFIX}/stats/overview`)

/** 导入书签文件（Netscape HTML / JSON 自动嗅探，multipart file）
 *  → { imported, skipped, invalid, categories_created } */
export const importBookmarks = file => {
  const fd = new FormData()
  fd.append('file', file)
  return json(`${PREFIX}/import`, { method: 'POST', body: fd })
}

/** 导出并触发浏览器下载（format: 'html' | 'json'） */
export async function exportBookmarks(format = 'json') {
  const r = await withTimeout(apiFetch(`${PREFIX}/export${qs({ output_format: format })}`))
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    throw new Error(body.message || `导出失败(${r.status})`)
  }
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `bookmarks-${new Date().toISOString().slice(0, 10)}.${format === 'html' ? 'html' : 'json'}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── 展示元信息 ──────────────────────────────────────────────

export const STATUSES = [
  { value: 'unread', label: '未读', cls: 'bg-orange-500/10 text-orange-700 dark:text-orange-400' },
  { value: 'reading', label: '阅读中', cls: 'bg-blue-500/10 text-blue-700 dark:text-blue-400' },
  { value: 'read', label: '已读', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  { value: 'archived', label: '归档', cls: 'bg-stone-500/10 text-stone-600 dark:text-stone-300' },
]
export const statusMeta = v => STATUSES.find(s => s.value === v) || STATUSES[0]

export const LINK_META = {
  unknown: { label: '未检测', cls: 'text-stone-400', dot: 'bg-stone-300 dark:bg-stone-600' },
  ok: { label: '可达', cls: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
  dead: { label: '失效', cls: 'text-red-600 dark:text-red-400', dot: 'bg-red-500' },
  error: { label: '异常', cls: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' },
}
export const linkMeta = v => LINK_META[v] || LINK_META.unknown

export const SORTS = [
  { value: 'created_desc', label: '最新收录' },
  { value: 'created_asc', label: '最早收录' },
  { value: 'updated_desc', label: '最近改动' },
  { value: 'title_asc', label: '标题 A-Z' },
  { value: 'read_desc', label: '最近读完' },
  { value: 'checked_asc', label: '最久未检' },
]

/** 分类树拍平成带缩进层级的选项列表（选择器用） */
export function flattenCategories(tree, depth = 0, out = []) {
  for (const c of tree || []) {
    out.push({ ...c, depth })
    flattenCategories(c.children, depth + 1, out)
  }
  return out
}
