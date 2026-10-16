/** HTML 实体编解码：命名实体（&amp; &lt; …）+ 数字实体（&#x4F60;）；非 ASCII 可选转数字实体 */
import { useMemo, useState } from 'react'
import { ToolHead, TwoPane, CopyBtn, Segmented, Check, StatusLine, areaCls } from '../kit'

const NAMED = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

export default function HtmlEntityTool() {
  const [mode, setMode] = useState('encode')
  const [nonAscii, setNonAscii] = useState(true)
  const [text, setText] = useState('<div class="hi">你好 & 欢迎使用 DouBlog</div>')

  const { output, error } = useMemo(() => {
    if (!text) return { output: '', error: null }
    try {
      if (mode === 'decode') {
        // 浏览器原生实体解析（含全部命名实体）：借道 DOMParser
        const doc = new DOMParser().parseFromString(text, 'text/html')
        return { output: doc.documentElement.textContent, error: null }
      }
      let s = text.replace(/[&<>"']/g, c => NAMED[c])
      if (nonAscii) {
        s = s.replace(/[\u0080-\uFFFF]/gu, c => `&#x${c.codePointAt(0).toString(16)};`)
      }
      return { output: s, error: null }
    } catch (e) {
      return { output: '', error: e.message }
    }
  }, [text, mode, nonAscii])

  return (
    <div>
      <ToolHead title="HTML 实体" desc="编码（命名实体 + 非 ASCII 数字实体）/ 解码（浏览器级命名实体支持）"
        right={<>
          <Segmented value={mode} onChange={setMode} options={[
            { key: 'encode', label: '编码' },
            { key: 'decode', label: '解码' },
          ]} />
          {mode === 'encode' && <Check checked={nonAscii} onChange={setNonAscii} label="非 ASCII 转数字实体" />}
        </>} />
      <TwoPane
        leftTitle={mode === 'encode' ? '原文' : '已编码 HTML'}
        rightTitle={mode === 'encode' ? '实体编码' : '解码原文'}
        left={<textarea className={areaCls} rows={10} value={text} spellCheck={false} onChange={e => setText(e.target.value)} />}
        right={<textarea className={'font-mono text-[13px] leading-relaxed p-3 rounded-lg border border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03] text-stone-700 dark:text-stone-200 whitespace-pre-wrap break-all'} rows={10} readOnly value={output} />}
        rightActions={<CopyBtn text={output} disabled={!output} />} />
      <div className="mt-2"><StatusLine ok={!error && output !== ''} err={error} okText="完成" /></div>
    </div>
  )
}
