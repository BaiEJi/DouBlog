import { useState } from 'react'
import Select from '@/shared/ui/Select'

const CREATE = 'create-tag'

export default function TagSelect({ value = [], onChange, tags = [], onCreate, placeholder = '选择标签' }) {
  const [query, setQuery] = useState('')
  const [created, setCreated] = useState([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  // 新建接口先于父级列表刷新返回，期间也要显示新标签及其颜色。
  const known = [...tags, ...created.filter(tag => value.includes(tag.id) && !tags.some(t => t.id === tag.id))]
  const name = query.trim()
  const canCreate = name && !known.some(tag => tag.name.toLowerCase() === name.toLowerCase())
  const options = known.map(tag => ({ value: tag.id, label: tag.name, 'aria-label': tag.name, tag }))
  if (canCreate) options.unshift({ value: CREATE, label: '＋ 新建标签「' + name + '」', disabled: creating })

  const change = async ids => {
    if (!ids.includes(CREATE)) {
      onChange(ids)
      setQuery('')
      setError('')
      return
    }
    if (!onCreate) { setError('暂不支持新建标签'); return }
    if (creating || !canCreate) return
    setCreating(true)
    setError('')
    try {
      const tag = await onCreate(name)
      if (tag?.id) {
        setCreated(list => list.some(t => t.id === tag.id) ? list : [...list, tag])
        onChange([...new Set([...ids.filter(id => id !== CREATE), tag.id])])
      }
      setQuery('')
    } catch (err) {
      setQuery(name)
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <Select mode="multiple" className="w-full" aria-label="标签" placeholder={placeholder} disabled={creating}
        value={value} options={options} onChange={change}
        showSearch={{ searchValue: query, onSearch: setQuery, optionFilterProp: 'label', autoClearSearchValue: false }}
        optionRender={({ data }) => data.tag ? (
          <span className="flex items-center gap-2">
            <i className="size-2 shrink-0 rounded-full" style={{ backgroundColor: data.tag.color || '#94a3b8' }} />
            {data.label}
            {data.tag.problem_count != null && <small className="ml-auto tabular-nums">{data.tag.problem_count}</small>}
          </span>
        ) : data.label}
        tagRender={({ value: id, label, closable, onClose }) => (
          <span className="db-select-selection-item">
            <i className="size-2 shrink-0 rounded-full" style={{ backgroundColor: known.find(t => t.id === id)?.color || '#94a3b8' }} />
            <span className="db-select-selection-item-content">{label}</span>
            {closable && <button type="button" aria-label={'移除' + label} onMouseDown={e => { e.preventDefault(); e.stopPropagation() }} onClick={onClose}>×</button>}
          </span>
        )}
      />
      {error && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </>
  )
}
