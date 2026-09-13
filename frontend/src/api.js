// 统一 API 客户端：集中管理后端地址与 Basic Auth 凭据。
// 此前 4 个组件各自硬编码 btoa('admin:...') 与端口，改一处即可全局生效。

const USERNAME = 'admin'
const PASSWORD = 'lizy111A'

const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'

export const API_BASE = `http://${host}:60100`

const AUTH_HEADER = `Basic ${typeof btoa !== 'undefined' ? btoa(`${USERNAME}:${PASSWORD}`) : ''}`

/**
 * 带认证的 fetch 封装
 * @param {string} path 以 / 开头的 API 路径
 * @param {RequestInit} options 原样传给 fetch
 */
export async function apiFetch(path, options = {}) {
  const headers = { 'Authorization': AUTH_HEADER, ...(options.headers || {}) }
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  return fetch(`${API_BASE}${path}`, { ...options, headers })
}

/**
 * 分页拉取全部文章（后端单页上限 100，循环取完，上限 maxPosts 防御）
 * @returns {Promise<Array>} 全部文章条目（列表接口不含正文字段）
 */
export async function fetchAllPosts({ pageSize = 100, maxPosts = 2000 } = {}) {
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
 * 数据库管理（见 api.md 管理端一节）
 * fetchDbStatus()            当前后端/连接配置/数据量
 * testDbConnection(payload)  测试目标后端连通性 {target, postgres?}
 * switchDatabase(payload)    迁移并切换 {target, postgres?, overwrite?}
 * 三者均返回统一信封 {success, code, message, data}
 */
export async function fetchDbStatus() {
  const res = await apiFetch('/api/admin/database')
  return res.json()
}

export async function testDbConnection(payload) {
  const res = await apiFetch('/api/admin/database/test', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
}

export async function switchDatabase(payload) {
  const res = await apiFetch('/api/admin/database/switch', { method: 'POST', body: JSON.stringify(payload) })
  return res.json()
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

export function prefetchPost(id) {
  const key = String(id)
  if (!postCache.has(key)) {
    const entry = { data: undefined }
    entry.promise = apiFetch(`/api/posts/id/${key}?no_view=1`)
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
  const e = postCache.get(String(id))
  return e && e.data !== undefined ? e.data : null
}

/** 详情页正常拉取（计浏览）后回填缓存，供后续 takeCachedPost 命中 */
export function setCachedPost(id, data) {
  postCache.set(String(id), { promise: Promise.resolve(data), data })
}

export function invalidatePost(id) {
  postCache.delete(String(id))
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

/** 导出全部知识库为 Markdown zip，返回 Blob */
export async function fetchExportZip() {
  const res = await apiFetch('/api/export/markdown')
  if (!res.ok) throw new Error(`导出失败 HTTP ${res.status}`)
  return res.blob()
}
