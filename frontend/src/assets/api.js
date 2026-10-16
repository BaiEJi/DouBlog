// 资产库 API：分类/资产 CRUD、版本、批量、使用记录、标签、统计、导入导出
import { apiFetch } from '@/shared/client'

const j = r => r.json()

// ── 分类 ──
export const assetsCategories = () => apiFetch('/api/assets/categories').then(j)
export const assetsCreateCategory = payload =>
  apiFetch('/api/assets/categories', { method: 'POST', body: JSON.stringify(payload) }).then(j)
export const assetsUpdateCategory = (id, payload) =>
  apiFetch(`/api/assets/categories/${id}`, { method: 'PUT', body: JSON.stringify(payload) }).then(j)
export const assetsDeleteCategory = id =>
  apiFetch(`/api/assets/categories/${id}`, { method: 'DELETE' }).then(j)

// ── 资产 ──
export const assetsItems = (params = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null))
  ).toString()
  return apiFetch(`/api/assets/items?${qs}`).then(j)
}
export const assetsItem = id => apiFetch(`/api/assets/items/${id}`).then(j)
export const assetsCreateItem = payload =>
  apiFetch('/api/assets/items', { method: 'POST', body: JSON.stringify(payload) }).then(j)
export const assetsUpdateItem = (id, payload) =>
  apiFetch(`/api/assets/items/${id}`, { method: 'PUT', body: JSON.stringify(payload) }).then(j)
export const assetsDeleteItem = (id, hard = false) =>
  apiFetch(`/api/assets/items/${id}${hard ? '?hard=1' : ''}`, { method: 'DELETE' }).then(j)
export const assetsRestoreItem = id =>
  apiFetch(`/api/assets/items/${id}/restore`, { method: 'POST' }).then(j)
export const assetsDuplicateItem = id =>
  apiFetch(`/api/assets/items/${id}/duplicate`, { method: 'POST' }).then(j)
export const assetsUseItem = (id, action = 'copy') =>
  apiFetch(`/api/assets/items/${id}/use`, { method: 'POST', body: JSON.stringify({ action }) }).then(j)
export const assetsBulkItems = payload =>
  apiFetch('/api/assets/items/bulk', { method: 'POST', body: JSON.stringify(payload) }).then(j)

// ── 版本 ──
export const assetsVersions = itemId => apiFetch(`/api/assets/items/${itemId}/versions`).then(j)
export const assetsVersion = vid => apiFetch(`/api/assets/versions/${vid}`).then(j)
export const assetsRestoreVersion = (itemId, vid) =>
  apiFetch(`/api/assets/items/${itemId}/versions/${vid}/restore`, { method: 'POST' }).then(j)

// ── 标签 / 统计 ──
export const assetsTags = () => apiFetch('/api/assets/tags').then(j)
export const assetsStats = () => apiFetch('/api/assets/stats').then(j)

// ── 导入 / 导出 ──
export const assetsImport = payload =>
  apiFetch('/api/assets/import', { method: 'POST', body: JSON.stringify(payload) }).then(j)

/** 触发浏览器下载（导出接口返回附件流而非信封） */
async function download(path, fallbackName) {
  const resp = await apiFetch(path)
  if (!resp.ok) {
    let message = `导出失败（${resp.status}）`
    try { message = (await resp.json()).message || message } catch { /* 附件流无信封 */ }
    return { success: false, message }
  }
  const blob = await resp.blob()
  const cd = resp.headers.get('content-disposition') || ''
  const star = cd.match(/filename\*=UTF-8''([^;]+)/)
  const name = star ? decodeURIComponent(star[1])
    : (cd.match(/filename="([^"]+)"/)?.[1] || fallbackName)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return { success: true }
}

export const assetsExport = params => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null))
  ).toString()
  return download(`/api/assets/export?${qs}`, 'doulog-assets.json')
}
export const assetsExportItem = (id, format) =>
  download(`/api/assets/items/${id}/export?format=${format}`, `asset.${format}`)

// ── Skill 包（单文件 / zip）──
export const assetsImportSkill = file => {
  const fd = new FormData()
  fd.append('file', file)
  return apiFetch('/api/assets/skills/import', { method: 'POST', body: fd }).then(j)
}
export const assetsItemFiles = itemId => apiFetch(`/api/assets/items/${itemId}/files`).then(j)
export const assetsFile = fileId => apiFetch(`/api/assets/files/${fileId}`).then(j)
export const assetsItemArchive = itemId =>
  download(`/api/assets/items/${itemId}/archive`, 'skill.zip')
