/** 二维码生成：文本/URL → SVG（矢量）+ PNG（data URL 预览与下载）；纠错级别/尺寸可调（后端 segno） */
import { useState } from 'react'
import { ToolHead, StatusLine, LBL, selectCls, areaCls, btnPri, card } from '../kit'
import { dtQrcode } from '../api'
import { downloadText } from '../lib/misc'

export default function QrTool() {
  const [content, setContent] = useState('https://github.com/BaiEJi')
  const [scale, setScale] = useState(6)
  const [border, setBorder] = useState(2)
  const [ecc, setEcc] = useState('m')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const generate = async () => {
    if (!content.trim()) { setResult(null); setError(null); return }
    setBusy(true)
    try {
      setResult(await dtQrcode(content, { scale, border, ecc }))
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
      <ToolHead title="二维码生成" desc="文本 / URL → 二维码（后端 segno 生成，≤2000 字符；SVG 矢量可直接内嵌）"
        right={<>
          <select className={selectCls} value={ecc} onChange={e => setEcc(e.target.value)} aria-label="纠错级别">
            <option value="l">纠错 L (7%)</option>
            <option value="m">纠错 M (15%)</option>
            <option value="q">纠错 Q (25%)</option>
            <option value="h">纠错 H (30%)</option>
          </select>
          <select className={selectCls} value={scale} onChange={e => setScale(+e.target.value)} aria-label="尺寸">
            {[2, 4, 6, 8, 12, 16].map(s => <option key={s} value={s}>尺寸 {s}x</option>)}
          </select>
          <select className={selectCls} value={border} onChange={e => setBorder(+e.target.value)} aria-label="边距">
            {[0, 1, 2, 3, 4].map(b => <option key={b} value={b}>边距 {b}</option>)}
          </select>
          <button className={btnPri} disabled={busy || !content.trim()} onClick={generate}>{busy ? '生成中…' : '生成'}</button>
        </>} />
      <textarea className={areaCls} rows={4} value={content} spellCheck={false}
        onChange={e => { setContent(e.target.value); setResult(null); setError(null) }}
        placeholder="输入文本或 URL…" aria-label="二维码内容" />
      <div className="mt-2"><StatusLine ok={!error && !!result} err={error} okText={result ? `生成成功 · 版本 ${result.version} · 纠错 ${result.ecc.toUpperCase()}` : ''} /></div>
      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <div className={card + ' p-5 flex flex-col items-center justify-center gap-3'}>
            <img src={result.png_data_url} alt="二维码预览" className="max-w-56 rounded-lg" />
            <div className="flex gap-2">
              <a href={result.png_data_url} download="qrcode.png"
                className="px-4 py-2 text-sm font-medium rounded-lg bg-black/[0.06] dark:bg-white/[0.08] text-stone-700 dark:text-stone-200 hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">下载 PNG</a>
              <button onClick={() => downloadText('qrcode.svg', result.svg, 'image/svg+xml')}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-black/[0.06] dark:bg-white/[0.08] text-stone-700 dark:text-stone-200 hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">下载 SVG</button>
            </div>
          </div>
          <div className={card + ' p-4 min-w-0'}>
            <p className="text-sm font-semibold mb-2">SVG 源码</p>
            <pre className="font-mono text-[11px] leading-relaxed text-stone-600 dark:text-stone-300 bg-black/[0.02] dark:bg-white/[0.03] rounded-lg p-3 border border-black/[0.05] dark:border-white/[0.06] max-h-64 overflow-auto">{result.svg.slice(0, 2000)}{result.svg.length > 2000 ? '\n…' : ''}</pre>
            <p className={'mt-2 ' + LBL}>纠错级别越高可容纳内容越少、图案越密；微信长按识别建议 M 级以上。</p>
          </div>
        </div>
      )}
    </div>
  )
}
