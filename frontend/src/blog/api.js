import { apiFetch } from '@/shared/client'
import { getDataIdentity } from '@/shared/dataEpoch'

export { apiFetch, API_BASE } from '@/shared/client'

// 博客/知识库 API（文章/知识库/图片/最近浏览/反链）。

export async function fetchPosts(params = {}, options = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  const response = await apiFetch(`/api/posts?${query}`, options)
  const body = await response.json()
  if (!response.ok || !body.success) throw new Error(body.message || '加载文章失败')
  return body.data
}

export async function fetchAllPosts({ pageSize = 100, maxPosts = Infinity } = {}) {
  const items = []
  let page = 1
  let total = Infinity
  while (items.length < total && items.length < maxPosts) {
    const res = await apiFetch(`/api/posts?page=${page}&page_size=${pageSize}`)
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    const d = await res.json()
    if (!d.success) throw new Error(d.message || '加载文章失败')
    total = d.data.total
    if (!d.data.items || d.data.items.length === 0) break
    items.push(...d.data.items)
    page += 1
  }
  return items
}

/**
 * 知识库（Workspace）管理，均返回统一信封 {success, code, message, data}
 */

export async function fetchWorkspaces() {
  const res = await apiFetch('/api/workspaces')
  return res.json()
}

export async function createWorkspace(name) {
  const res = await apiFetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ name }) })
  return res.json()
}

/**
 * 全文关键词搜索（服务端匹配 标题/摘要/英文名/正文；不带 workspace_id = 跨所有库）
 */

export async function searchPosts(keyword, workspaceId) {
  const params = new URLSearchParams({ keyword, page_size: '100' })
  if (workspaceId) params.set('workspace_id', workspaceId)
  const res = await apiFetch(`/api/posts?${params}`)
  return res.json()
}

/**
 * 拉取指定知识库的文章树（不传 workspace_id = 默认知识库）
 */

export async function fetchPostTree(workspaceId) {
  const q = workspaceId ? `?workspace_id=${workspaceId}` : ''
  const res = await apiFetch(`/api/posts/tree${q}`)
  return res.json()
}

/**
 * 文章详情预取缓存（SWR 语义）：
 * - prefetchPost(id)：列表/侧栏链接 hover、focus 时调用，提前发起请求
 * - takeCachedPost(id)：详情页挂载时读取，命中则立即渲染
 * - 详情页仍会后台重新拉取覆盖（stale-while-revalidate），编辑保存后调 invalidatePost 失效
 */
const postCache = new Map()   // id -> { promise, data }（promise 去重并发；resolved 后 data 可同步读）
const POST_CACHE_MAX = 50
const cacheKey = id => JSON.stringify([getDataIdentity(), String(id)])

export function prefetchPost(id) {
  const key = cacheKey(id)
  if (!postCache.has(key)) {
    const entry = { data: undefined }
    entry.promise = apiFetch(`/api/posts/id/${encodeURIComponent(String(id))}?no_view=1`)
      .then(r => r.json())
      .then(d => { entry.data = d && d.success ? d.data : null; return entry.data })
      .catch(() => { entry.data = null })
    postCache.set(key, entry)
    if (postCache.size > POST_CACHE_MAX) {
      postCache.delete(postCache.keys().next().value)
    }
  }
  return postCache.get(key).promise
}

/** 同步读取已解析完成的缓存（未决或不存在返回 null，不阻塞） */

export function takeCachedPost(id) {
  const e = postCache.get(cacheKey(id))
  return e && e.data !== undefined ? e.data : null
}

/** 详情页正常拉取（计浏览）后回填缓存，供后续 takeCachedPost 命中 */

export function setCachedPost(id, data) {
  postCache.set(cacheKey(id), { promise: Promise.resolve(data), data })
}

export function invalidatePost(id) {
  postCache.delete(cacheKey(id))
}

/**
 * 图片上传（编辑器粘贴/拖拽/按钮）
 * @param {File} file
 * @returns {Promise<{success, data: {url}}>}  url 可直接写入 Markdown
 */

export async function uploadImage(file) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await apiFetch('/api/images/upload', { method: 'POST', body: fd })
  return res.json()
}

/** 最近浏览的文章（跨知识库） */

export async function fetchRecentPosts(limit = 10) {
  const res = await apiFetch(`/api/posts/recent?limit=${limit}`)
  return res.json()
}

/** 某篇文章的反向链接（同库内用 [[双链]] 指向它的文章） */

export async function fetchBacklinks(id) {
  const res = await apiFetch(`/api/posts/id/${id}/backlinks`)
  return res.json()
}
