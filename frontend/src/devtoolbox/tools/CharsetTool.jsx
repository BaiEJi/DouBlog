/** 字符集互转（乱码修复）：经后端 Python codecs——浏览器无法「编码到」GBK/Big5（TextEncoder 仅 UTF-8） */
import { useState } from 'react'
import { ToolHead, TwoPane, CopyBtn, StatusLine, LBL, selectCls, areaCls, btnPri } from '../kit'
import { dtCharsetConvert } from '../api'

const CHARSETS = ['utf-8', 'gbk', 'gb18030', 'big5', 'shift_jis', 'euc-kr', 'latin-1', 'windows-1252', 'utf-16']

export default function CharsetTool() {
  const [text, setText] = useState('ä½ å¥½ï¼ŒDouBlogï¼')
  const [from, setFrom] = useState('latin-1')
  const [to, setTo] = useState('utf-8')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const convert = async () => {
    if (!text) { setResult(null); setError(null); return }
    setBusy(true)
    try {
      setResult(await dtCharsetConvert(text, from, to))
      setError(null)
    } catch (e) {
      setResult(null)
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <ToolHead title="字符集互转 · 乱码修复" desc="text --encode(from)--> 字节 --decode(to)--> 结果；from=错误解码所用的字符集，to=真实字符集"
        right={<>
          <select className={selectCls} value={from} onChange={e => setFrom(e.target.value)} aria-label="来源字符集">
            {CHARSETS.map(c => <option key={c} value={c}>从 {c}</option>)}
          </select>
          <span className="text-stone-400">→</span>
          <select className={selectCls} value={to} onChange={e => setTo(e.target.value)} aria-label="目标字符集">
            {CHARSETS.map(c => <option key={c} value={c}>到 {c}</option>)}
          </select>
          <button className={btnPri} disabled={busy || !text} onClick={convert}>{busy ? '转换中…' : '转换'}</button>
        </>} />
      <TwoPane
        leftTitle="乱码文本"
        rightTitle={result ? `修复结果 · ${result.bytes} 字节` : '结果'}
        left={<textarea className={areaCls} rows={10} value={text} spellCheck={false} onChange={e => { setText(e.target.value); setResult(null); setError(null) }} />}
        right={<textarea className={'font-mono text-[13px] leading-relaxed p-3 rounded-lg border border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03] text-stone-700 dark:text-stone-200 whitespace-pre-wrap break-all'} rows={10} readOnly value={result?.result ?? ''} />}
        rightActions={<CopyBtn text={result?.result} disabled={!result?.result} />} />
      <div className="mt-2 space-y-2">
        <StatusLine ok={!error && !!result} err={error} okText="转换完成" />
        {result && (
          <div>
            <p className={LBL + ' mb-1'}>中间字节（{from} 编码）</p>
            <pre className="font-mono text-[12px] leading-relaxed text-stone-600 dark:text-stone-300 bg-black/[0.02] dark:bg-white/[0.03] rounded-lg p-3 border border-black/[0.05] dark:border-white/[0.06] max-h-40 overflow-y-auto whitespace-pre-wrap break-all">{result.hex}</pre>
          </div>
        )}
        <p className={LBL}>常见修复：UTF-8 内容被按 latin-1 显示（ä½ å¥½）→ 从 latin-1 到 utf-8；GBK 乱码（äã¥å¥½ 类）→ 从 utf-8 到 gbk 反向推导。</p>
      </div>
    </div>
  )
}
