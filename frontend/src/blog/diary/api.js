// 日记 API（超集）：条目/分册/视图/热力图/回忆/统计/分享/导出/模板引导
import { apiFetch, API_BASE } from '@/shared/client'

const j = async r => ({ ...(await r.json()), status: r.status })

export const diaryList = (params = {}, options = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null))
  ).toString()
  return apiFetch(`/api/diary/entries?${qs}`, options).then(j)
}
export const diaryEntry = id => apiFetch(`/api/diary/entries/${id}`).then(j)
export const diaryCreate = (payload, options = {}) => apiFetch('/api/diary/entries', { ...options, method: 'POST', body: JSON.stringify(payload) }).then(j)
export const diaryUpdate = (id, payload, options = {}) => apiFetch(`/api/diary/entries/${id}`, { ...options, method: 'PUT', body: JSON.stringify(payload) }).then(j)
export const diaryAction = (id, action) => apiFetch(`/api/diary/entries/${id}?action=${action}`, { method: 'PUT' }).then(j)
export const diaryDelete = (id, hard = false) => apiFetch(`/api/diary/entries/${id}${hard ? '?hard=1' : ''}`, { method: 'DELETE' }).then(j)
export const diaryQuick = payload => apiFetch('/api/diary/quick', { method: 'POST', body: JSON.stringify(payload) }).then(j)
export const diaryUpsertSummary = (payload, options = {}) => apiFetch('/api/diary/summary', { ...options, method: 'POST', body: JSON.stringify(payload) }).then(j)

export const diaryJournals = () => apiFetch('/api/diary/journals').then(j)
export const diaryCreateJournal = payload => apiFetch('/api/diary/journals', { method: 'POST', body: JSON.stringify(payload) }).then(j)
export const diaryUpdateJournal = (id, payload) => apiFetch(`/api/diary/journals/${id}`, { method: 'PUT', body: JSON.stringify(payload) }).then(j)
export const diaryDeleteJournal = id => apiFetch(`/api/diary/journals/${id}`, { method: 'DELETE' }).then(j)

export const diaryDates = (year, month) => apiFetch(`/api/diary/dates?year=${year}&month=${month}`).then(j)
export const diaryHeatmap = year => apiFetch(`/api/diary/heatmap?year=${year}`).then(j)
export const diaryOnThisDay = () => apiFetch('/api/diary/onthisday').then(j)
export const diaryStats = () => apiFetch('/api/diary/stats').then(j)
export const diaryTrends = (months = 12) => apiFetch(`/api/diary/trends?months=${months}`).then(j)
export const diaryYearEnd = year => apiFetch(`/api/diary/yearend?year=${year}`).then(j)

export const diaryShare = (id, hours) => apiFetch(`/api/diary/entries/${id}/share`, { method: 'POST', body: JSON.stringify({ expires_hours: hours }) }).then(j)
export const diaryRevokeShare = id => apiFetch(`/api/diary/entries/${id}/share`, { method: 'DELETE' }).then(j)
/** 免登录公开分享：直连后端（相对路径会打到 Vite），不带 Basic 头 */
export const diaryPublicShare = token => fetch(`${API_BASE}/api/diary/share/${token}`).then(r => r.json())

export const diaryExportZip = async () => {
  const res = await apiFetch('/api/diary/export')
  if (!res.ok) throw new Error('导出失败')
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'diary-export.zip'
  a.click()
  URL.revokeObjectURL(a.href)
}

export const diaryTemplates = () => apiFetch('/api/diary/templates').then(j)
export const diaryPrompt = d => apiFetch(`/api/diary/prompt${d ? `?date=${d}` : ''}`).then(j)
