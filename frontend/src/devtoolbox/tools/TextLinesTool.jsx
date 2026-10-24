/** 文本行处理：去重 / 排序 / 去空行 / trim / 编号 / 前后缀 / 连接 */
import { useState } from 'react'
import { ToolHead, TwoPane, CopyBtn, Check, LBL, selectCls, inputCls } from '../kit'
import useComputation from '../../shared/useComputation'
import CodeEditor from '../../shared/CodeEditor'

const SAMPLE = `banana
apple
cherry
apple
  date
banana
elderberry`

export default function TextLinesTool() {
  const [text, setText] = useState(SAMPLE)
  const [trim, setTrim] = useState(true)
  const [dropEmpty, setDropEmpty] = useState(true)
  const [dedupe, setDedupe] = useState(true)
  const [sort, setSort] = useState('none')
  const [number, setNumber] = useState(false)
  const [prefix, setPrefix] = useState('')
  const [suffix, setSuffix] = useState('')
  const [join, setJoin] = useState('')

  const computation = useComputation('textLines', { text, trim, dropEmpty, dedupe, sort, number, prefix, suffix, join })
  const { output = '', linesIn = 0, linesOut = 0 } = computation.result || {}

  return (
    <div>
      <ToolHead title="文本行处理" desc="列表清洗流水线：trim → 去空行 → 去重 → 排序 → 编号/前后缀（按此顺序执行）" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        <Check checked={trim} onChange={setTrim} label="去除首尾空白" />
        <Check checked={dropEmpty} onChange={setDropEmpty} label="去空行" />
        <Check checked={dedupe} onChange={setDedupe} label="去重（保留首次）" />
        <Check checked={number} onChange={setNumber} label="加序号" />
        <select className={selectCls} value={sort} onChange={e => setSort(e.target.value)} aria-label="排序方式">
          <option value="none">不排序</option>
          <option value="asc">升序（自然）</option>
          <option value="desc">降序</option>
          <option value="len">按长度</option>
          <option value="shuffle">随机洗牌</option>
          <option value="reverse">反转原序</option>
        </select>
        <input className={inputCls + ' w-24'} value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="前缀" aria-label="行前缀" />
        <input className={inputCls + ' w-24'} value={suffix} onChange={e => setSuffix(e.target.value)} placeholder="后缀" aria-label="行后缀" />
        <input className={inputCls + ' w-24'} value={join} onChange={e => setJoin(e.target.value)} placeholder="连接符（默认换行）" aria-label="行连接符" />
      </div>
      <TwoPane
        leftTitle={`输入 · ${linesIn} 行`}
        rightTitle={`输出 · ${linesOut} 行`}
        left={<CodeEditor value={text} onChange={setText} height={350} ariaLabel="行处理输入" />}
        right={<CodeEditor readOnly value={output} height={350} ariaLabel="行处理结果" />}
        rightActions={<CopyBtn text={output} disabled={!output} />} />
      {computation.error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{computation.error}</p>}
      <p className={'mt-2 ' + LBL}>连接符填入任意字符串（如 ", " 或 " | "）时输出单行；留空则保持每行一条。</p>
    </div>
  )
}
