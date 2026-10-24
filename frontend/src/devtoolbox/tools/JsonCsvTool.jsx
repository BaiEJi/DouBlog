/** JSON ⇄ CSV：数组对象 ↔ CSV（RFC 4180 引号规则；分隔符可选；嵌套字段点路径扁平化） */
import { useState } from 'react'
import { ToolHead, TwoPane, CopyBtn, Segmented, Check, StatusLine, selectCls } from '../kit'
import useComputation from '../../shared/useComputation'
import CodeEditor from '../../shared/CodeEditor'

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

  const computation = useComputation('jsonCsv', { input, direction, delim, flattenNested })
  const { output = '', info = '' } = computation.result || {}
  const error = computation.error

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
        left={<CodeEditor value={input} onChange={setInput} language={direction === 'json2csv' ? 'json' : 'text'} height={350} ariaLabel="转换输入" />}
        right={<CodeEditor readOnly value={output} language={direction === 'csv2json' ? 'json' : 'text'} height={350} ariaLabel="转换结果" />}
        rightActions={<CopyBtn text={output} disabled={!output} />} />
      <div className="mt-2"><StatusLine ok={!error && !!input.trim() && !!output} err={error} okText="转换完成" /></div>
    </div>
  )
}

