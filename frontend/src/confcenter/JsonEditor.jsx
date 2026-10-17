/**
 * 配置中心 JSON 编辑器：textarea 覆层 + highlight.js 着色（零新依赖——
 * highlight.js 已是站点依赖，亮暗 token 色沿用 index.css 的 GitHub 主题）。
 *
 * - 对齐方案与 react-simple-code-editor 同款：编辑层透明文字 + 着色层绝对定位
 *   叠底，两层字体/行高/内距逐字一致，滚动双向同步（textarea wrap="off"，
 *   两层均不折行，长行横向滚动）
 * - Tab 缩进两空格；非法 JSON 也照常着色（hljs json 文法容忍半成品文本）
 * - 校验/错误定位工具在 ./jsonTools（EntryModal 与本组件共用）
 * - 另导出只读 JsonHighlightedView：值预览弹窗的着色渲染（折行展示，无编辑层）
 */
import { useMemo, useRef } from 'react'
import hljs from 'highlight.js/lib/core'
import jsonLang from 'highlight.js/lib/languages/json'

hljs.registerLanguage('json', jsonLang)

/** 两层共用的排版基准——改字号/行高/内距必须两处同步，覆层对齐依赖逐字一致 */
const METRICS = 'font-mono text-[15px] leading-6 p-3 [font-variant-ligatures:none] whitespace-pre tab-size-2'

export default function JsonEditor({ value, onChange, onBlur, rows = 10, invalid, id, ariaLabel = 'JSON 值编辑器' }) {
  const preRef = useRef(null)

  const html = useMemo(
    () => hljs.highlight(value + '\n', { language: 'json' }).value,
    [value])

  /** 编辑层滚动 → 着色层跟随（着色层 pointer-events-none，只被带动） */
  function syncScroll(e) {
    const pre = preRef.current
    if (pre) {
      pre.scrollTop = e.currentTarget.scrollTop
      pre.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  function onKeyDown(e) {
    if (e.key !== 'Tab') return
    e.preventDefault()                       // 阻止焦点逃逸，插入两空格缩进
    const ta = e.currentTarget
    const { selectionStart: s, selectionEnd: en } = ta
    onChange(value.slice(0, s) + '  ' + value.slice(en))
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2 })
  }

  return (
    <div className={'relative overflow-hidden rounded-lg border transition-colors ' +
        (invalid ? '!border-red-400 dark:!border-red-500' : 'border-black/10 dark:border-white/10 focus-within:border-black/30 dark:focus-within:border-white/30') +
        ' bg-stone-50 dark:bg-black/25'}>
      <pre ref={preRef} aria-hidden="true"
        className={METRICS + ' absolute inset-0 m-0 overflow-hidden pointer-events-none text-stone-700 dark:text-stone-200'}>
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      <textarea id={id} value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur}
        onKeyDown={onKeyDown} onScroll={syncScroll} rows={rows} wrap="off" spellCheck={false}
        aria-label={ariaLabel}
        className={METRICS + ' relative z-10 block w-full resize-y overflow-auto bg-transparent text-transparent caret-stone-800 dark:caret-stone-100 outline-none'} />
    </div>
  )
}

/** 只读着色 JSON 视图（值预览弹窗用；折行展示，无编辑层对齐约束） */
export function JsonHighlightedView({ text }) {
  const html = useMemo(() => hljs.highlight(text || '', { language: 'json' }).value, [text])
  return (
    <pre tabIndex={0} aria-label="完整值"
      className="min-h-40 max-h-[55vh] overflow-auto rounded-xl border border-black/[0.06] dark:border-white/[0.08] bg-stone-50 dark:bg-black/25 p-4 font-mono text-[15px] leading-6 whitespace-pre-wrap break-all text-stone-700 dark:text-stone-200 selection:bg-cyan-500/20">
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  )
}
