/** Unicode 转换：文本 ⇄ \uXXXX 转义；码点明细表（U+XXXX / 十进制 / UTF-8 字节） */
import { useState } from 'react'
import useComputation from '../../shared/useComputation'
import CodeEditor from '../../shared/CodeEditor'
import { ToolHead, TwoPane, CopyBtn, Segmented, card } from '../kit'

export default function UnicodeTool() {
  const [mode, setMode] = useState('escape')
  const [text, setText] = useState('开发者 DevToolbox 🛠️')

  const computation = useComputation('unicode', { text, mode })
  const { output = '', codepoints = [], limited = false } = computation.result || {}

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
        left={<CodeEditor value={text} onChange={setText} height={220} ariaLabel="Unicode 输入" />}
        right={<CodeEditor readOnly value={output} height={220} ariaLabel="Unicode 结果" />}
        rightActions={<CopyBtn text={output} disabled={!output} />} />
      {computation.error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{computation.error}</p>}
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
          {limited && <p className="px-4 py-2 text-[11.5px] text-stone-400">仅展示前 200 个码点。</p>}
        </div>
      )}
    </div>
  )
}
