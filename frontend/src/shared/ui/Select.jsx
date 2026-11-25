import { useMemo } from 'react'
import RcSelect from '@rc-component/select'

const arrow = <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 8 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
const check = <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
const cross = <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
const emptyOptions = []
const popupAlign = { htmlRegion: 'visible', overflow: { adjustX: true, adjustY: true, shiftX: true } }

/** options 支持字符串、数字或 { value, label, disabled? }。onChange 返回选项的原始值。 */
export default function Select({
  options = emptyOptions, value, onChange, onOpenChange, placeholder = '请选择', size = 'md',
  className = '', invalid = false, allowClear, mode, showSearch, ...props
}) {
  const { items, values } = useMemo(() => {
    const items = options.map(option => typeof option === 'object' ? option : { value: option, label: String(option) })
    return { items, values: new Set(items.map(item => item.value)) }
  }, [options])
  // 已保存的数字 ID 有时来自 URL 或旧表单，以字符串传入。选择时仍返回原始类型。
  const match = v => {
    if (v == null || values.has(v)) return v
    if (v === '') return null
    const alternate = typeof v === 'number' ? String(v) : Number(v)
    return values.has(alternate) && String(alternate) === String(v) ? alternate : v
  }
  const selection = Array.isArray(value) ? value.map(match) : match(value)
  const longList = items.length > 80
  const search = showSearch ?? (mode === 'combobox' || mode === 'multiple' || items.length >= 10)
  return (
    <RcSelect
      {...props}
      prefixCls="db-select"
      className={`db-select-size-${size} ${className}`}
      mode={mode} options={items} value={selection} placeholder={placeholder}
      onChange={onChange} onPopupVisibleChange={onOpenChange}
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      showSearch={search === true ? { optionFilterProp: 'label' } : search}
      allowClear={allowClear === true ? { clearIcon: cross, label: '清除选择' } : allowClear}
      suffix={arrow} removeIcon={cross} menuItemSelectedIcon={check}
      virtual={longList} popupMatchSelectWidth={longList} popupAlign={popupAlign}
      listHeight={256} listItemHeight={32}
      notFoundContent={mode === 'combobox' ? null : '没有匹配的选项'}
    />
  )
}
