import { apiFetch } from '@/shared/client'

const PREFIX = '/api/mindmap'

async function request(path, options = {}) {
  const response = await apiFetch(`${PREFIX}${path}`, options)
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.success === false) {
    const error = new Error(body.message || body.detail || `请求失败 (${response.status})`)
    error.status = response.status
    error.code = body.code || body.data?.error_code
    error.details = body.data?.details || body.details || {}
    error.currentRevision = error.details.current_revision
    throw error
  }
  return body.data
}

const mutation = () => crypto.randomUUID()
const json = (method, body) => ({ method, body: JSON.stringify(body) })
const query = values => {
  const search = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => { if (value !== '' && value != null) search.set(key, String(value)) })
  return search.size ? `?${search}` : ''
}

export const listMaps = filters => request(`/maps${query(filters || {})}`)
export const getMap = id => request(`/maps/${id}`)
export const createMap = body => request('/maps', json('POST', { ...body, mutation_id: mutation() }))
export const updateMap = (id, body) => request(`/maps/${id}`, json('PATCH', { ...body, mutation_id: mutation() }))
export const saveDocument = (id, body) => request(`/maps/${id}/document`, json('PUT', body))
export const deleteMap = (id, revision) => request(`/maps/${id}`, json('DELETE', { revision, mutation_id: mutation() }))
export const duplicateMap = (id, revision, name) => request(`/maps/${id}/duplicate`, json('POST', { revision, name, mutation_id: mutation() }))
export const exportMap = id => request(`/maps/${id}/export`)
export const importMap = body => request('/import', json('POST', { ...body, mutation_id: mutation() }))
export const listVersions = (id, page = 1) => request(`/maps/${id}/versions${query({ page, page_size: 30 })}`)
export const getVersion = (id, revision) => request(`/maps/${id}/versions/${revision}`)
export const restoreVersion = (id, revision, version) => request(`/maps/${id}/restore`, json('POST', { revision, version, mutation_id: mutation() }))

async function blogRequest(path) {
  const response = await apiFetch(path)
  const body = await response.json()
  if (!response.ok || !body.success) throw new Error(body.message || '知识库加载失败')
  return body.data
}
export const listWorkspaces = () => blogRequest('/api/workspaces')
export async function listPosts(workspaceId) {
  const items = []
  let page = 1
  while (true) {
    const result = await blogRequest(`/api/posts${query({ workspace_id: workspaceId, page, page_size: 100 })}`)
    const next = Array.isArray(result) ? result : result.items || []
    items.push(...next)
    if (Array.isArray(result) || !next.length || items.length >= (result.total ?? Infinity) || next.length < 100) break
    page += 1
  }
  return { items }
}
export async function uploadImage(file) {
  const body = new FormData()
  body.append('file', file)
  const response = await apiFetch('/api/images/upload', { method: 'POST', body })
  const result = await response.json()
  if (!response.ok || !result.success) throw new Error(result.message || '图片上传失败')
  return result.data
}

export function download(name, value, mime = 'application/json') {
  const blob = value instanceof Blob ? value : new Blob([typeof value === 'string' ? value : JSON.stringify(value)], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
