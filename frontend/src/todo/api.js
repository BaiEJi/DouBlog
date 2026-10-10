// MyTodo 能力包 API 层：统一走 shared/client.js 的 apiFetch（会话 Cookie 认证）。
// 后端响应为 Doublog 信封 { success, code, message, data }——本层统一 unwrap 出 .data，
// 失败（HTTP 非 2xx 或 success=false）抛 Error(message)。
// 端点前缀 /api/todo/*，与 backend/app/todo/routes.py 一一对应。
import { apiFetch } from '@/shared/client'

async function json(path, options = {}) {
  const r = await apiFetch(path, options)
  const body = await r.json().catch(() => ({}))
  if (!r.ok || body.success === false) throw new Error(body.message || `请求失败(${r.status})`)
  return body.data
}

function qs(params = {}) {
  const usp = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  )
  const s = usp.toString()
  return s ? `?${s}` : ''
}

// ── 任务 tasks ─────────────────────────────────────────────
/** 全部过滤参数：date / from / to / inbox / overdue / status / category_id / quadrant / q / sort / plan_only / exclude_plans */
export const todoTasks = (params = {}) => json(`/api/todo/tasks${qs(params)}`)
export const todoTask = id => json(`/api/todo/tasks/${id}`)
export const todoCreateTask = payload =>
  json('/api/todo/tasks', { method: 'POST', body: JSON.stringify(payload) })
export const todoUpdateTask = (id, payload) =>
  json(`/api/todo/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
export const todoDeleteTask = id => json(`/api/todo/tasks/${id}`, { method: 'DELETE' })
export const todoRestoreTask = id => json(`/api/todo/tasks/${id}/restore`, { method: 'POST' })
/** 完成任务；note 为可选完成备注 */
export const todoCompleteTask = (id, payload = {}) =>
  json(`/api/todo/tasks/${id}/complete`, { method: 'POST', body: JSON.stringify(payload) })
export const todoReopenTask = id => json(`/api/todo/tasks/${id}/reopen`, { method: 'POST' })
/** payload: { is_important, is_urgent, before_task_id? } */
export const todoMoveTask = (id, payload) =>
  json(`/api/todo/tasks/${id}/move`, { method: 'POST', body: JSON.stringify(payload) })
/** payload: { before_task_id } —— null 表示移到象限尾部 */
export const todoReorderTask = (id, payload) =>
  json(`/api/todo/tasks/${id}/reorder`, { method: 'POST', body: JSON.stringify(payload) })

// ── 类别 categories ────────────────────────────────────────
export const todoCategories = (includeArchived = false) =>
  json(`/api/todo/categories${includeArchived ? '?include_archived=true' : ''}`)
export const todoCreateCategory = payload =>
  json('/api/todo/categories', { method: 'POST', body: JSON.stringify(payload) })
export const todoUpdateCategory = (id, payload) =>
  json(`/api/todo/categories/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
export const todoDeleteCategory = id => json(`/api/todo/categories/${id}`, { method: 'DELETE' })

// ── 规律生活计划 plans ─────────────────────────────────────
export const todoPlans = () => json('/api/todo/plans')
export const todoCreatePlan = payload =>
  json('/api/todo/plans', { method: 'POST', body: JSON.stringify(payload) })
/** 生活打卡：某日计划实例清单（date 缺省 = 今天） */
export const todoPlanToday = (date) => json(`/api/todo/plans/today${qs({ date })}`)
/** 打卡报告：{ days, start, end, plans[], trend[] } */
export const todoPlanReport = (days = 30) => json(`/api/todo/plans/report?days=${days}`)
export const todoUpdatePlan = (id, payload) =>
  json(`/api/todo/plans/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
export const todoDeletePlan = id => json(`/api/todo/plans/${id}`, { method: 'DELETE' })

// ── 今日聚合 day ───────────────────────────────────────────
/** 四象限分组 + 待迁移 + 昨日概况 + streak（date 缺省 = 今天） */
export const todoDay = (date) => json(`/api/todo/today${qs({ date })}`)

// ── 迁移 migrations ────────────────────────────────────────
export const todoMigrationsPending = () => json('/api/todo/migrations/pending')
export const todoMigrationsShelved = () => json('/api/todo/migrations/shelved')
/** payload: { to_date, reason? } */
export const todoMigrateTask = (id, payload) =>
  json(`/api/todo/tasks/${id}/migrate`, { method: 'POST', body: JSON.stringify(payload) })
/** payload: { task_ids: [...], to_date, reason? } → { migrated } */
export const todoMigrationsBulk = payload =>
  json('/api/todo/migrations/bulk', { method: 'POST', body: JSON.stringify(payload) })
/** payload: { task_id, decision: 'keep' | 'delete' | 'unshelve' } */
export const todoMigrationsDecide = payload =>
  json('/api/todo/migrations/decide', { method: 'POST', body: JSON.stringify(payload) })
/** 按设置自动迁移 → { migrated } */
export const todoMigrationsAuto = () =>
  json('/api/todo/migrations/auto', { method: 'POST' })

// ── 统计 stats ─────────────────────────────────────────────
export const todoStatsDaily = (date) => json(`/api/todo/stats/daily${qs({ date })}`)
export const todoStatsRange = (from, to) => json(`/api/todo/stats/range?from=${from}&to=${to}`)
export const todoStatsHeatmap = (year) => json(`/api/todo/stats/heatmap?year=${year}`)
export const todoStatsStreak = () => json('/api/todo/stats/streak')

// ── 设置 settings ──────────────────────────────────────────
export const todoSettings = () => json('/api/todo/settings')
/** 字段级增量 PUT（只传要改的字段） */
export const todoSaveSettings = payload =>
  json('/api/todo/settings', { method: 'PUT', body: JSON.stringify(payload) })

// ── 通知 notifications ─────────────────────────────────────
/** payload: { channel: 'email' } → { ok, message }；发送端先落库当前配置再实测发送 */
export const todoTestNotification = (payload) =>
  json('/api/todo/notifications/test', { method: 'POST', body: JSON.stringify(payload) })
