export function formatDate(value) {
  if (!value) return '—'
  const normalized = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}
