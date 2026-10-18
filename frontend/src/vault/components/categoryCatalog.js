/**
 * Vault 类别目录：内置 9 项枚举 + 用户自定义类别（增 / 改名 / 删）。
 *
 * 零知识约束下的取舍：服务端不存任何 vault 元数据，条目密文 blob 内的 category
 * 本就是自由字符串——因此自定义类别只存浏览器 localStorage（与自动锁定/剪贴板
 * 等本地偏好同源），key 为稳定生成 id（改名不牵连条目），label 为用户可见名称。
 * 导出/导入备份时经 custom_categories 字段随文件往返，换机恢复不丢目录。
 * 兜底：条目里出现目录外的 key（如本地数据被清）时按孤儿类别照常展示。
 */
import { useCallback, useMemo, useState } from 'react'
import { CATEGORIES, CATEGORY_LABELS } from './core'

const LS_KEY = 'vault_custom_categories'
const MAX_LABEL = 12

export function loadCustomCategories() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter(c => c && typeof c.key === 'string' && typeof c.label === 'string')
      .map(c => ({ key: c.key, label: c.label }))
  } catch { return [] }
}

export function saveCustomCategories(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)) } catch { /* 忽略：隐私模式/存储满等写入失败 */ }
}

export function newCategoryKey() {
  return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** 合并目录：内置 → 自定义 → 条目中的孤儿 key（保序，内置在前） */
export function buildCatalog(custom, items) {
  const list = CATEGORIES.map(k => ({ key: k, label: CATEGORY_LABELS[k] || k, builtin: true }))
  const seen = new Set(list.map(c => c.key))
  for (const c of custom || []) {
    if (!seen.has(c.key)) { seen.add(c.key); list.push({ key: c.key, label: c.label, builtin: false }) }
  }
  for (const it of items || []) {
    const k = it.data?.category
    if (k && !seen.has(k)) { seen.add(k); list.push({ key: k, label: k, builtin: false, orphan: true }) }
  }
  return list
}

export function useCategoryCatalog(items) {
  const [custom, setCustom] = useState(loadCustomCategories)
  const persist = useCallback(next => { setCustom(next); saveCustomCategories(next) }, [])
  const catalog = useMemo(() => buildCatalog(custom, items), [custom, items])

  /** 整体替换自定义目录（导入备份时恢复文件内的 custom_categories） */
  const replaceCustom = useCallback(list => {
    persist((list || []).filter(c => c && typeof c.key === 'string' && typeof c.label === 'string').map(c => ({ key: c.key, label: c.label })))
  }, [persist])

  const validateLabel = useCallback((label, excludeKey) => {
    const t = String(label || '').trim()
    if (!t) return { ok: false, err: '名称不能为空' }
    if (t.length > MAX_LABEL) return { ok: false, err: `名称不超过 ${MAX_LABEL} 个字符` }
    if (catalog.some(c => c.label === t && c.key !== excludeKey)) return { ok: false, err: '已存在同名类别' }
    return { ok: true, label: t }
  }, [catalog])

  const addCategory = useCallback(label => {
    const v = validateLabel(label)
    if (!v.ok) return v
    persist([...custom, { key: newCategoryKey(), label: v.label }])
    return { ok: true }
  }, [custom, validateLabel, persist])

  const renameCategory = useCallback((key, label) => {
    const v = validateLabel(label, key)
    if (!v.ok) return v
    persist(custom.map(c => c.key === key ? { ...c, label: v.label } : c))
    return { ok: true }
  }, [custom, validateLabel, persist])

  /** 删除自定义类别；count>0 拒绝——条目需先改到其他类别，避免密码条目失去归属 */
  const deleteCategory = useCallback((key, count = 0) => {
    if (count > 0) return { ok: false, err: `该类别下还有 ${count} 个条目，请先将它们改到其他类别` }
    persist(custom.filter(c => c.key !== key))
    return { ok: true }
  }, [custom, persist])

  const labelOf = useCallback(key => {
    const hit = catalog.find(c => c.key === key)
    return hit ? hit.label : key
  }, [catalog])

  return { catalog, custom, replaceCustom, addCategory, renameCategory, deleteCategory, labelOf }
}
