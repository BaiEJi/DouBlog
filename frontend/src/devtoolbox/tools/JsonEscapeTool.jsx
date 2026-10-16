/** JSON 转义 / 去转义：字符串 ↔ 含 \\n \\" \\u 转义序列的形式（嵌日志/拼 SQL 场景） */
import { useMemo, useState } from 'react'
import { ToolHead, TwoPane, CopyBtn, Segmented, StatusLine, areaCls } from '../kit'

const SAMPLE = `{"query": "SELECT * FROM posts\\nWHERE id = 1", "note": "包含 \\"引号\\" 与中文"}`

export default function JsonEscapeTool() {
  const [direction, setDirection] = useState('escape')
  const [input, setInput] = useState(SAMPLE)

  const { output, error } = useMemo(() => {
    if (!input) return { output: '', error: null }
    try {
      if (direction === 'escape') {
        // 整段文本视为一个字符串：JSON.stringify 后去掉外层引号 → 可嵌入代码字符串字面量
        return { output: JSON.stringify(input).slice(1, -1), error: null }
      }
      // 去转义：补回外层引号再解析
      return { output: JSON.parse('"' + input.replace(/^"|"$/g, '').replace(/\n/g, '\\n') + '"'), error: null }
    } catch (e) {
      return { output: '', error: '转义序列无效：' + e.message }
    }
  }, [input, direction])

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
        left={<textarea className={areaCls} rows={12} value={input} spellCheck={false} onChange={e => setInput(e.target.value)} />}
        right={<textarea className={'font-mono text-[13px] leading-relaxed p-3 rounded-lg border border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03] text-stone-700 dark:text-stone-200 whitespace-pre-wrap break-all'} rows={12} readOnly value={output} />}
        rightActions={<CopyBtn text={output} disabled={!output} />} />
      <div className="mt-2"><StatusLine ok={!error && !!input && output !== ''} err={error} okText="完成" /></div>
    </div>
  )
}
