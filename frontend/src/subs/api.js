// 订阅管理 API（CrownFlow 迁移）：会员/订阅/分类/统计/提醒/备份
import { apiFetch } from '@/shared/client'

const j = r => r.json()

// ── 分类 ──
export const subsCategories = () => apiFetch('/api/subs/categories').then(j)
export const subsCreateCategory = payload => apiFetch('/api/subs/categories', { method: 'POST', body: JSON.stringify(payload) }).then(j)
export const subsUpdateCategory = (id, payload) => apiFetch(`/api/subs/categories/${id}`, { method: 'PUT', body: JSON.stringify(payload) }).then(j)
export const subsDeleteCategory = id => apiFetch(`/api/subs/categories/${id}`, { method: 'DELETE' }).then(j)

// ── 会员 ──
export const subsMembers = (params = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null))
  ).toString()
  return apiFetch(`/api/subs/members?${qs}`).then(j)
}
export const subsMember = id => apiFetch(`/api/subs/members/${id}`).then(j)
export const subsCreateMember = payload => apiFetch('/api/subs/members', { method: 'POST', body: JSON.stringify(payload) }).then(j)
export const subsUpdateMember = (id, payload) => apiFetch(`/api/subs/members/${id}`, { method: 'PUT', body: JSON.stringify(payload) }).then(j)
export const subsDeleteMember = id => apiFetch(`/api/subs/members/${id}`, { method: 'DELETE' }).then(j)

// ── 订阅记录 ──
export const subsMemberSubscriptions = (memberId, params = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null))
  ).toString()
  return apiFetch(`/api/subs/members/${memberId}/subscriptions?${qs}`).then(j)
}
export const subsSubscription = id => apiFetch(`/api/subs/subscriptions/${id}`).then(j)
export const subsCreateSubscription = (memberId, payload) =>
  apiFetch(`/api/subs/members/${memberId}/subscriptions`, { method: 'POST', body: JSON.stringify(payload) }).then(j)
export const subsUpdateSubscription = (id, payload) =>
  apiFetch(`/api/subs/subscriptions/${id}`, { method: 'PUT', body: JSON.stringify(payload) }).then(j)
export const subsDeleteSubscription = id => apiFetch(`/api/subs/subscriptions/${id}`, { method: 'DELETE' }).then(j)

// ── 统计 ──
export const subsStatsOverview = () => apiFetch('/api/subs/stats/overview').then(j)
export const subsStatsCategorySummary = () => apiFetch('/api/subs/stats/category-summary').then(j)
export const subsStatsSpending = (startDate, endDate) =>
  apiFetch(`/api/subs/stats/spending?start_date=${startDate}&end_date=${endDate}`).then(j)
export const subsStatsByCategory = (startDate, endDate) =>
  apiFetch(`/api/subs/stats/by-category?start_date=${startDate}&end_date=${endDate}`).then(j)
export const subsStatsTrend = (startDate, endDate, granularity) =>
  apiFetch(`/api/subs/stats/trend?start_date=${startDate}&end_date=${endDate}&granularity=${granularity}`).then(j)

// ── 提醒 ──
export const subsRemindersUpcoming = () => apiFetch('/api/subs/reminders/upcoming').then(j)
export const subsRemindersAll = () => apiFetch('/api/subs/reminders/all').then(j)

// ── 备份 ──
export const subsBackupRun = () => apiFetch('/api/subs/backup/run', { method: 'POST' }).then(j)
export const subsBackupStats = () => apiFetch('/api/subs/backup').then(j)
