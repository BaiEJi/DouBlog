import { decryptBlob } from './crypto.js'

export const GROUP_NAME_LIMIT = 40
export const UNGROUPED = '未分组'

function cleanName(value) {
  return typeof value === 'string' ? value.trim().normalize('NFC') : ''
}

export function validateGroups(entries) {
  if (!Array.isArray(entries)) throw new Error('分组目录格式错误')
  const ids = new Set(), names = new Set()
  return entries.map(entry => {
    const id = entry?.id, name = cleanName(entry?.name)
    if (typeof id !== 'string' || !id || ids.has(id)) throw new Error('分组标识无效或重复')
    if (!name || name.length > GROUP_NAME_LIMIT) throw new Error('分组名称需为 1 到 ' + GROUP_NAME_LIMIT + ' 个字符')
    if (name === UNGROUPED || name === '全部分组') throw new Error('这个名称用于系统筛选，请换一个名称')
    if (names.has(name.toLowerCase())) throw new Error('已有同名分组')
    ids.add(id); names.add(name.toLowerCase())
    return { id, name }
  })
}

export async function readGroups(key, box) {
  return box ? validateGroups(await decryptBlob(key, box)) : []
}

export function changeGroups(entries, { action, id, name }) {
  const current = entries.find(group => group.id === id)
  if (action === 'delete') return current ? entries.filter(group => group.id !== id) : entries
  if (action === 'create' || action === 'rename') {
    if (current && current.name === cleanName(name)) return entries
    if (action === 'create') return validateGroups([...entries, { id, name }])
    if (!current) throw new Error('该分组已被删除')
    return validateGroups(entries.map(group => group.id === id ? { id, name } : group))
  }
  throw new Error('未知分组操作')
}

// Old accounts and accounts whose folder was deleted are both shown under 未分组.
export function accountGroupId(data, names) {
  return names.has(data.group_id) ? data.group_id : ''
}
