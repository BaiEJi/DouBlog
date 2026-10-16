/** Unicode 转换：文本 ⇄ \uXXXX 转义；码点明细表（U+XXXX / 十进制 / UTF-8 字节） */
import { useMemo, useState } from 'react'
import { ToolHead, TwoPane, CopyBtn, Segmented, areaCls, card } from '../kit'

export default function UnicodeTool() {
  const [mode, setMode] = useState('escape')
  const [text, setText] = useState('开发者 DevToolbox 🛠️')

  const { output } = useMemo(() => {
    if (!text) return { output: '', error: null }
    try {
      if (mode === 'escape') {
        return { output: [...text].map(ch => {
          const cp = ch.codePointAt(0)
          return cp > 0xffff
            ? '\\u{' + cp.toString(16) + '}'
            : /[ -~]/.test(ch) ? ch : '\\u' + cp.toString(16).padStart(4, '0')
        }).join('') }
      }
      return { output: text.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (_, br, quad) =>
        String.fromCodePoint(parseInt(br || quad, 16))) }
    } catch (e) {
      return { output: '', error: e.message }
    }
  }, [text, mode])

  const codepoints = useMemo(() => {
    if (!text.trim()) return []
    return [...text].slice(0, 200).map(ch => {
      const cp = ch.codePointAt(0)
      const bytes = [...new TextEncoder().encode(ch)].map(b => b.toString(16).padStart(2, '0')).join(' ')
      return { ch, hex: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'), dec: cp, bytes }
    })
  }, [text])

  return (
    <div>
      <ToolHead title="Unicode 转换" desc={'文本 ⇄ \\uXXXX / \\u{...} 转义（支持代理对外的增补平面字符）'}
        right={<Segmented value={mode} onChange={setMode} options={[
          { key: 'escape', label: '转义' },
          { key: 'unescape', label: '去转义' },
        ]} />} />
      <TwoPane
        leftTitle={mode === 'escape' ? '原文' : '已转义'}
        rightTitle={mode === 'escape' ? '\\u 转义' : '还原原文'}
        left={<textarea className={areaCls} rows={8} value={text} spellCheck={false} onChange={e => setText(e.target.value)} />}
        right={<textarea className={'font-mono text-[13px] leading-relaxed p-3 rounded-lg border border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03] text-stone-700 dark:text-stone-200 whitespace-pre-wrap break-all'} rows={8} readOnly value={output} />}
        rightActions={<CopyBtn text={output} disabled={!output} />} />
      {codepoints.length > 0 && (
        <div className={'mt-4 overflow-x-auto ' + card}>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-xs text-stone-500 dark:text-stone-400 border-b border-black/[0.06] dark:border-white/[0.07]">
                <th className="px-4 py-2 font-medium">字符</th>
                <th className="px-4 py-2 font-medium">码点</th>
                <th className="px-4 py-2 font-medium">十进制</th>
                <th className="px-4 py-2 font-medium">UTF-8 字节</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.05] font-mono">
              {codepoints.map((c, i) => (
                <tr key={i}>
                  <td className="px-4 py-1.5 text-base">{c.ch}</td>
                  <td className="px-4 py-1.5">{c.hex}</td>
                  <td className="px-4 py-1.5 tabular-nums">{c.dec}</td>
                  <td className="px-4 py-1.5">{c.bytes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {text.length > 200 && <p className="px-4 py-2 text-[11.5px] text-stone-400">仅展示前 200 个码点。</p>}
        </div>
      )}
    </div>
  )
}
