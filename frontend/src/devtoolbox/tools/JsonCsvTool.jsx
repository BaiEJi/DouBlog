/** JSON ⇄ CSV：数组对象 ↔ CSV（RFC 4180 引号规则；分隔符可选；嵌套字段点路径扁平化） */
import { useMemo, useState } from 'react'
import { ToolHead, TwoPane, CopyBtn, Segmented, Check, StatusLine, selectCls, areaCls } from '../kit'
import { jsonToCsv, csvToJson, csvStringify, csvParse } from '../lib/text'

const SAMPLE = `[
  {"id": 1, "name": "博客", "tags": "fastapi"},
  {"id": 2, "name": "日记", "tags": "react"},
  {"id": 3, "name": "密码库", "tags": "crypto"}
]`

export default function JsonCsvTool() {
  const [direction, setDirection] = useState('json2csv')
  const [input, setInput] = useState(SAMPLE)
  const [delim, setDelim] = useState(',')
  const [flattenNested, setFlattenNested] = useState(true)

  const { output, error, info } = useMemo(() => {
    if (!input.trim()) return { output: '', error: null, info: '' }
    try {
      if (direction === 'json2csv') {
        const data = JSON.parse(input)
        if (!Array.isArray(data)) return { output: '', error: 'JSON 顶层必须是数组（对象数组 → CSV）', info: '' }
        const table = jsonToCsv(data, { flattenNested })
        return { output: csvStringify(table, delim), error: null, info: `${table.length - 1} 行 × ${table[0].length} 列` }
      }
      const rows = csvParse(input, delim)
      if (rows.length < 1) return { output: '', error: 'CSV 为空', info: '' }
      const objs = csvToJson(rows)
      return { output: JSON.stringify(objs, null, 2), error: null, info: `${objs.length} 个对象 × ${rows[0].length} 列` }
    } catch (e) {
      return { output: '', error: e.message, info: '' }
    }
  }, [input, direction, delim, flattenNested])

  return (
    <div>
      <ToolHead title="JSON ⇄ CSV" desc="纯本地转换：RFC 4180 引号规则，嵌套对象按点路径扁平化为列"
        right={<>
          <Segmented value={direction} onChange={setDirection} options={[
            { key: 'json2csv', label: 'JSON → CSV' },
            { key: 'csv2json', label: 'CSV → JSON' },
          ]} />
          <select className={selectCls} value={delim} onChange={e => setDelim(e.target.value)} aria-label="分隔符">
            <option value=",">逗号 ,</option>
            <option value=";">分号 ;</option>
            <option value={'\t'}>Tab</option>
          </select>
          {direction === 'json2csv' && <Check checked={flattenNested} onChange={setFlattenNested} label="扁平化嵌套" />}
        </>} />
      <TwoPane
        leftTitle={direction === 'json2csv' ? 'JSON 数组' : 'CSV'}
        rightTitle={`输出${info ? ` · ${info}` : ''}`}
        left={<textarea className={areaCls} rows={14} value={input} spellCheck={false} onChange={e => setInput(e.target.value)} />}
        right={<textarea className={'font-mono text-[13px] leading-relaxed p-3 rounded-lg border border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03] text-stone-700 dark:text-stone-200 whitespace-pre'} rows={14} readOnly value={output} />}
        rightActions={<CopyBtn text={output} disabled={!output} />} />
      <div className="mt-2"><StatusLine ok={!error && !!input.trim() && !!output} err={error} okText="转换完成" /></div>
    </div>
  )
}

