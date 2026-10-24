import { useEffect, useRef, useState } from 'react'
import CodeEditor from '../shared/CodeEditor'

/**
 * confcenter 值编辑器：CodeMirror 6（行号 gutter / 虚拟化 / 明暗主题 / 撤销）。
 * language 支持 'json' 与 'text'（str 原样文本，同样带行号；软换行只对逻辑行编号）。
 * 兼容旧调用：缺省 language='json'，保留 value/onChange/onBlur/onSave/rows/invalid 契约。
 *
 * CodeMirror 动态模块**真实加载失败**（CodeEditor onLoadFailure）时进入降级：
 * - fallback textarea 可见、可输入并应用同一 fontSize；
 * - text 模式渲染轻量行号栏：与编辑器外框等高、内部滚动同步、横向不折行
 *   （wrap=off，逻辑行与行号一一对应）；不引入第二套编辑器；
 * - 正常 CodeMirror 路径不计算任何降级行号数据。
 */
export default function JsonEditor({ value, onChange, onBlur, onSave, rows = 10, invalid, id,
  ariaLabel = 'JSON 值编辑器', language = 'json', fontSize = 13, editorRef }) {
  const height = Math.max(160, rows * 24 + 24)
  const wrap = useRef(null)
  const rail = useRef(null)
  const [degraded, setDegraded] = useState(false)

  // 行号栏与 fallback textarea 滚动同步（只在降级 text 模式挂监听）
  useEffect(() => {
    if (!degraded || language !== 'text' || !wrap.current) return
    const textarea = wrap.current.querySelector('textarea')
    const node = rail.current
    if (!textarea || !node) return
    const sync = () => { node.scrollTop = textarea.scrollTop }
    textarea.addEventListener('scroll', sync)
    return () => textarea.removeEventListener('scroll', sync)
  }, [degraded, language])

  const showRail = degraded && language === 'text'
  // 降级行号只在渲染行号栏时计算（正常 CodeMirror 路径零开销）
  const lineCount = showRail && typeof value === 'string' ? value.split('\n').length : 0

  return (
    <div ref={wrap} className={invalid ? 'rounded-lg ring-1 ring-red-500' : ''}>
      <div className="relative flex">
        {showRail && (
          <div ref={rail} aria-hidden="true"
            className="w-10 shrink-0 overflow-hidden rounded-l-lg border-r border-black/10 dark:border-white/10 bg-stone-50 dark:bg-black/20 text-right select-none"
            style={{ height, fontSize: `${fontSize}px`, lineHeight: `${fontSize * 1.5}px`, padding: '8px 0' }}>
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="px-1.5 font-mono text-stone-400 dark:text-stone-500">{i + 1}</div>
            ))}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <CodeEditor id={id} value={value} onChange={onChange} onBlur={onBlur} onSave={onSave}
            language={language} height={height} ariaLabel={ariaLabel} fontSize={fontSize}
            editorRef={editorRef} keepViewportOnExternalChange
            onReady={() => setDegraded(false)}
            onLoadFailure={() => setDegraded(true)}
            fallbackWrap={showRail ? 'off' : 'soft'}
            className={showRail ? 'rounded-l-none' : ''} />
        </div>
      </div>
    </div>
  )
}

/** str/json 共用的值编辑器别名（语义化命名；实现同 JsonEditor） */
export const ValueEditor = JsonEditor

export function JsonHighlightedView({ text }) {
  return <CodeEditor value={text || ''} readOnly language="json" height={400} ariaLabel="完整值" />
}
