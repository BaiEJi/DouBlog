/** URL 编解码：encodeURIComponent / encodeURI / decodeURIComponent 三种口径 */
import { useMemo, useState } from 'react'
import { ToolHead, TwoPane, CopyBtn, Segmented, StatusLine, areaCls } from '../kit'

export default function UrlCodecTool() {
  const [mode, setMode] = useState('component')
  const [text, setText] = useState('https://example.com/搜索?q=开发者 工具&lang=zh')

  const { output, error } = useMemo(() => {
    if (!text) return { output: '', error: null }
    try {
      if (mode === 'decode') return { output: decodeURIComponent(text), error: null }
      if (mode === 'uri') return { output: encodeURI(text), error: null }
      return { output: encodeURIComponent(text), error: null }
    } catch {
      return { output: '', error: mode === 'decode' ? '解码失败（% 序列非法或残缺）' : '编码失败（含未配对代理对）' }
    }
  }, [text, mode])

  return (
    <div>
      <ToolHead title="URL 编解码" desc="encodeURIComponent（严格，编码 / ? & =）/ encodeURI（保留 URL 结构符）/ 解码"
        right={<Segmented value={mode} onChange={setMode} options={[
          { key: 'component', label: 'encodeURIComponent' },
          { key: 'uri', label: 'encodeURI' },
          { key: 'decode', label: '解码' },
        ]} />} />
      <TwoPane
        leftTitle="输入"
        rightTitle="输出"
        left={<textarea className={areaCls} rows={10} value={text} spellCheck={false} onChange={e => setText(e.target.value)} />}
        right={<textarea className={'font-mono text-[13px] leading-relaxed p-3 rounded-lg border border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03] text-stone-700 dark:text-stone-200 whitespace-pre-wrap break-all'} rows={10} readOnly value={output} />}
        rightActions={<CopyBtn text={output} disabled={!output} />} />
      <div className="mt-2"><StatusLine ok={!error && !!text && output !== ''} err={error} okText="完成" /></div>
    </div>
  )
}
