/** 文本行处理：去重 / 排序 / 去空行 / trim / 编号 / 前后缀 / 连接 */
import { useMemo, useState } from 'react'
import { ToolHead, TwoPane, CopyBtn, Check, LBL, selectCls, inputCls, areaCls } from '../kit'
import { lineTransform } from '../lib/text'

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

  const output = useMemo(() => {
    if (!text) return ''
    return lineTransform(text, { trim, dropEmpty, dedupe, sort, number, prefix, suffix, join })
  }, [text, trim, dropEmpty, dedupe, sort, number, prefix, suffix, join])

  const linesIn = text ? text.split(/\r\n|\r|\n/).length : 0
  const linesOut = output ? output.split(/\r\n|\r|\n/).length : 0

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
        left={<textarea className={areaCls} rows={14} value={text} spellCheck={false} onChange={e => setText(e.target.value)} />}
        right={<textarea className={'font-mono text-[13px] leading-relaxed p-3 rounded-lg border border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03] text-stone-700 dark:text-stone-200 whitespace-pre'} rows={14} readOnly value={output} />}
        rightActions={<CopyBtn text={output} disabled={!output} />} />
      <p className={'mt-2 ' + LBL}>连接符填入任意字符串（如 ", " 或 " | "）时输出单行；留空则保持每行一条。</p>
    </div>
  )
}
