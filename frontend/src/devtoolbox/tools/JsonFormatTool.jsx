/** JSON 格式化 / 压缩 / 校验：缩进可选、键排序、统计（节点数/深度/字节数） */
import { useMemo, useState } from 'react'
import { ToolHead, TwoPane, CopyBtn, StatusLine, LBL, selectCls, areaCls, outCls, Check } from '../kit'
import { utf8Len } from '../lib/misc'

const SAMPLE = `{"name":"DouBlog","modules":14,"tags":["fastapi","react"],"db":{"backend":"postgres","pool":5}}`

function jsonErrorDetail(text, err) {
  const posMatch = /position (\d+)/.exec(err.message)
  if (!posMatch) return err.message.replace(/^JSON\.parse:?\s*/i, '')
  const pos = +posMatch[1]
  const before = text.slice(0, pos)
  const line = before.split('\n').length
  const col = pos - before.lastIndexOf('\n')
  return `${err.message.replace(/ in JSON at position \d+.*/i, '')}（第 ${line} 行第 ${col} 列）`
}

function collectStats(value) {
  let nodes = 0, depth = 0
  const walk = (v, d) => {
    nodes++
    depth = Math.max(depth, d)
    if (Array.isArray(v)) v.forEach(x => walk(x, d + 1))
    else if (v && typeof v === 'object') Object.values(v).forEach(x => walk(x, d + 1))
  }
  walk(value, 1)
  return { nodes, depth }
}

export default function JsonFormatTool() {
  const [text, setText] = useState(SAMPLE)
  const [indent, setIndent] = useState('2')
  const [sortKeys, setSortKeys] = useState(false)

  const { result, error, stats } = useMemo(() => {
    if (!text.trim()) return { result: '', error: null, stats: null }
    try {
      const value = JSON.parse(text)
      const sortValue = v => {
        if (Array.isArray(v)) return v.map(sortValue)
        if (v && typeof v === 'object') {
          return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortValue(v[k])]))
        }
        return v
      }
      const finalValue = sortKeys ? sortValue(value) : value
      const pad = indent === 'tab' ? '\t' : +indent
      return {
        result: indent === 'min' ? JSON.stringify(finalValue) : JSON.stringify(finalValue, null, pad),
        error: null,
        stats: { ...collectStats(finalValue), inBytes: utf8Len(text), outBytes: utf8Len(JSON.stringify(finalValue)) },
      }
    } catch (e) {
      return { result: '', error: jsonErrorDetail(text, e), stats: null }
    }
  }, [text, indent, sortKeys])

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
        left={<textarea className={areaCls} rows={16} value={text} spellCheck={false}
          onChange={e => setText(e.target.value)} placeholder="粘贴 JSON…" />}
        right={<textarea className={outCls} rows={16} readOnly value={result} />}
        rightActions={<CopyBtn text={result} disabled={!result} />} />
      <div className="mt-2"><StatusLine ok={!error && !!text.trim()} err={error} okText="JSON 格式正确" /></div>
      <p className={'mt-1 ' + LBL}>提示：错误定位基于 V8 的 position 信息；压缩模式即 minify。</p>
    </div>
  )
}
