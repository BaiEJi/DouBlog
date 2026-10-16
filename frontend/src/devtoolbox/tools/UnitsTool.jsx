/** 单位换算：长度/重量/数据量/速度/面积/时间/温度——一次输入全单位列表 */
import { useMemo, useState } from 'react'
import { ToolHead, CopyBtn, LBL, inputCls, selectCls, card } from '../kit'
import { UNIT_TABLES, TEMP_TABLE } from '../data'

const fmt = n => {
  if (!isFinite(n)) return '—'
  if (n === 0) return '0'
  const abs = Math.abs(n)
  const digits = abs >= 1e6 ? 3 : abs >= 1000 ? 2 : abs >= 1 ? 6 : abs >= 1e-6 ? 9 : 3
  const s = n.toPrecision(12)
  const num = +s
  return num.toLocaleString('zh-CN', { maximumFractionDigits: digits })
}

export default function UnitsTool() {
  const [category, setCategory] = useState('length')
  const [value, setValue] = useState('1')
  const [unit, setUnit] = useState('m')

  const isTemp = category === 'temp'
  const table = isTemp ? TEMP_TABLE : UNIT_TABLES[category]
  const unitKeys = Object.keys(table.units)

  const results = useMemo(() => {
    const v = parseFloat(value)
    if (isNaN(v)) return []
    if (isTemp) {
      const toK = table.units[unit]?.[1]
      if (!toK) return []
      return unitKeys.map(k => [k, table.units[k][0], table.units[k][2](toK(v))])
    }
    const factor = table.units[unit]?.[1]
    if (!factor) return []
    const base = v * factor
    return unitKeys.map(k => [k, table.units[k][0], base / table.units[k][1]])
  }, [value, unit, table, unitKeys, isTemp])

  return (
    <div>
      <ToolHead title="单位换算" desc="长度 / 重量 / 数据量（十进制与二进制）/ 速度 / 面积 / 时间 / 温度" />
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <select className={selectCls} value={category}
          onChange={e => {
            setCategory(e.target.value)
            const first = Object.keys((e.target.value === 'temp' ? TEMP_TABLE : UNIT_TABLES[e.target.value]).units)[0]
            setUnit(first)
          }} aria-label="单位类别">
          {Object.entries(UNIT_TABLES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          <option value="temp">{TEMP_TABLE.label}</option>
        </select>
        <input className={inputCls + ' w-32 font-mono'} value={value} spellCheck={false}
          onChange={e => setValue(e.target.value)} placeholder="数值" aria-label="数值" />
        <select className={selectCls} value={unit} onChange={e => setUnit(e.target.value)} aria-label="源单位">
          {unitKeys.map(k => <option key={k} value={k}>{table.units[k][0]}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {results.map(([k, label, v]) => (
          <div key={k} className={'flex items-center gap-3 p-4 ' + card + (k === unit ? ' ring-1 ring-lime-500/40' : '')}>
            <div className="flex-1 min-w-0">
              <p className="text-lg font-semibold tabular-nums break-all">{fmt(v)}</p>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{label}</p>
            </div>
            <CopyBtn text={String(+v.toPrecision(12))} />
          </div>
        ))}
        {!results.length && <p className="text-[13px] text-stone-400">输入有效数值后显示全部单位换算。</p>}
      </div>
      <p className={'mt-3 ' + LBL}>数据量类别同时给出十进制（KB=10³，硬盘厂商口径）与二进制（KiB=2¹⁰，内存/系统口径）。</p>
    </div>
  )
}
