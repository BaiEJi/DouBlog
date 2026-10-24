/** JSON 格式化 / 压缩 / 校验：缩进可选、键排序、统计（节点数/深度/字节数） */
import { useState } from 'react'
import useComputation from '../../shared/useComputation'
import CodeEditor from '../../shared/CodeEditor'
import { ToolHead, TwoPane, CopyBtn, StatusLine, LBL, selectCls, Check } from '../kit'

const SAMPLE = `{"name":"DouBlog","modules":14,"tags":["fastapi","react"],"db":{"backend":"postgres","pool":5}}`

export default function JsonFormatTool() {
  const [text, setText] = useState(SAMPLE)
  const [indent, setIndent] = useState('2')
  const [sortKeys, setSortKeys] = useState(false)

  const computation = useComputation('jsonFormat', { text, indent, sortKeys })
  const { result = '', stats = null } = computation.result || {}
  const error = computation.error

  return (
    <div>
      <ToolHead title="JSON 格式化" desc="格式化 / 压缩 / 校验 JSON，支持键排序与节点统计"
        right={<>
          <Check checked={sortKeys} onChange={setSortKeys} label="键排序" />
          <select className={selectCls} value={indent} onChange={e => setIndent(e.target.value)} aria-label="缩进">
            <option value="2">缩进 2 空格</option>
            <option value="4">缩进 4 空格</option>
            <option value="tab">缩进 Tab</option>
            <option value="min">压缩（单行）</option>
          </select>
        </>} />
      <TwoPane
        leftTitle={`输入${stats ? ` · ${stats.inBytes} B` : ''}`}
        rightTitle={`输出${stats ? ` · ${stats.outBytes} B · ${stats.nodes} 节点 · 深度 ${stats.depth}` : ''}`}
        left={<CodeEditor value={text} onChange={setText} language="json" height={400} ariaLabel="输入 JSON" />}
        right={<CodeEditor readOnly value={result} language="json" height={400} ariaLabel="格式化结果" />}
        rightActions={<CopyBtn text={result} disabled={!result} />} />
      <div className="mt-2">{computation.pending && <p className="text-xs text-stone-500 dark:text-stone-400">计算中…</p>}<StatusLine ok={!error && !!text.trim()} err={error} okText="JSON 格式正确" /></div>
      <p className={'mt-1 ' + LBL}>提示：错误定位基于 V8 的 position 信息；压缩模式即 minify。</p>
    </div>
  )
}
