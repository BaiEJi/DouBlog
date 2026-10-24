/** JSON 转义 / 去转义：字符串 ↔ 含 \\n \\" \\u 转义序列的形式（嵌日志/拼 SQL 场景） */
import { useState } from 'react'
import useComputation from '../../shared/useComputation'
import CodeEditor from '../../shared/CodeEditor'
import { ToolHead, TwoPane, CopyBtn, Segmented, StatusLine } from '../kit'

const SAMPLE = `{"query": "SELECT * FROM posts\\nWHERE id = 1", "note": "包含 \\"引号\\" 与中文"}`

export default function JsonEscapeTool() {
  const [direction, setDirection] = useState('escape')
  const [input, setInput] = useState(SAMPLE)

  const computation = useComputation('jsonEscape', { input, direction })
  const output = computation.result?.output || '', error = computation.error

  return (
    <div>
      <ToolHead title="JSON 转义 / 去转义" desc={'字符串 ⇄ \\n \\t \\" \\uXXXX 转义形式（嵌入日志、配置、代码字符串场景）'}
        right={<Segmented value={direction} onChange={setDirection} options={[
          { key: 'escape', label: '转义' },
          { key: 'unescape', label: '去转义' },
        ]} />} />
      <TwoPane
        leftTitle={direction === 'escape' ? '原文' : '已转义文本'}
        rightTitle={direction === 'escape' ? '转义结果' : '还原原文'}
        left={<CodeEditor value={input} onChange={setInput} height={320} ariaLabel="转义输入" />}
        right={<CodeEditor readOnly value={output} height={320} ariaLabel="转义结果" />}
        rightActions={<CopyBtn text={output} disabled={!output} />} />
      <div className="mt-2"><StatusLine ok={!error && !!input && output !== ''} err={error} okText="完成" /></div>
    </div>
  )
}
