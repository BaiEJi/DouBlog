/** 颜色转换：HEX/RGB/HSL 互转 + 色板预览 + 亮度/WCAG 对比度 + 明暗色阶 */
import { useMemo, useState } from 'react'
import { ToolHead, CopyBtn, StatusLine, LBL, inputCls, card } from '../kit'
import { parseColor, rgbToHex, rgbToHsl, bestTextOn, shades, relLuminance } from '../lib/color'

export default function ColorTool() {
  const [input, setInput] = useState('#65a30d')

  const rgb = useMemo(() => parseColor(input), [input])
  const hex = rgb ? rgbToHex(rgb) : null
  const hsl = rgb ? rgbToHsl(rgb) : null
  const text = rgb ? bestTextOn(rgb) : null
  const scale = rgb ? shades(rgb) : null
  const lum = rgb ? relLuminance(rgb) : null

  const formats = rgb ? [
    ['HEX', hex],
    ['HEX 大写', hex.toUpperCase()],
    ['RGB', `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`],
    ['RGBA', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`],
    ['HSL', `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`],
    ['CSS 变量', `--color: ${hex};`],
    ['整数', (rgb.r << 16) + (rgb.g << 8) + rgb.b],
  ] : []

  return (
    <div>
      <ToolHead title="颜色转换" desc="HEX / RGB / HSL 互转；亮度与 WCAG 对比度分级；明暗色阶生成" />
      <div className="flex flex-wrap gap-3 items-center">
        <input type="color" className="w-11 h-11 rounded-xl border border-black/10 dark:border-white/10 bg-transparent cursor-pointer"
          value={hex || '#000000'} onChange={e => setInput(e.target.value)} aria-label="取色器" />
        <input className={inputCls + ' flex-1 min-w-48 font-mono'} value={input} spellCheck={false}
          onChange={e => setInput(e.target.value)} placeholder="#65a30d / rgb(101,163,13) / hsl(84,82%,35%)" aria-label="颜色值" />
      </div>
      <div className="mt-2"><StatusLine ok={!!rgb} err={input.trim() && !rgb ? '无法识别的颜色格式（支持 HEX 3/6 位、rgb()、hsl()）' : null} okText="已识别" /></div>
      {rgb && (
        <>
          <div className={'mt-4 overflow-hidden ' + card}>
            <div className="h-24 flex items-end justify-between px-5 pb-4" style={{ background: hex, color: text?.prefer === 'black' ? '#111' : '#fff' }}>
              <span className="font-mono text-sm font-medium">{hex.toUpperCase()}</span>
              <span className="text-xs opacity-80">亮度 {(lum * 100).toFixed(1)}%</span>
            </div>
          </div>
          <div className={'mt-4 divide-y divide-black/[0.05] dark:divide-white/[0.06] ' + card}>
            {formats.map(([k, v]) => (
              <div key={k} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-20 shrink-0 text-xs text-stone-500 dark:text-stone-400">{k}</span>
                <code className="flex-1 min-w-0 font-mono text-[13px] text-stone-800 dark:text-stone-100 break-all">{String(v)}</code>
                <CopyBtn text={String(v)} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className={card + ' p-4'}>
              <p className="text-sm font-semibold mb-3">WCAG 对比度</p>
              <div className="space-y-2">
                {[
                  { label: '黑字 (纯黑)', ratio: text?.black.ratio, grade: text?.black.grade, bg: '#000', fg: '#fff' },
                  { label: '白字 (纯白)', ratio: text?.white.ratio, grade: text?.white.grade, bg: '#fff', fg: '#000' },
                ].map(row => (
                  <div key={row.label} className="flex items-center gap-3">
                    <div className="flex-1 flex items-center justify-between gap-2">
                      <span className="text-[13px] text-stone-600 dark:text-stone-300">{row.label}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-[13px] tabular-nums">{row.ratio?.toFixed(2)}</span>
                        <span className={'px-1.5 py-0.5 rounded-md text-[11px] font-medium ' + row.grade?.cls}>{row.grade?.label}</span>
                      </span>
                    </div>
                  </div>
                ))}
                <div className="flex gap-2 pt-2">
                  <div className="flex-1 rounded-lg px-3 py-2 text-center text-[13px]" style={{ background: '#000', color: hex }}>黑底显色</div>
                  <div className="flex-1 rounded-lg px-3 py-2 text-center text-[13px]" style={{ background: '#fff', color: hex }}>白底显色</div>
                </div>
                <p className={'pt-1 ' + LBL}>推荐字色：{text?.prefer === 'black' ? '黑字' : '白字'}（对比度更高）</p>
              </div>
            </div>
            <div className={card + ' p-4'}>
              <p className="text-sm font-semibold mb-3">明暗色阶</p>
              <div className="space-y-1.5">
                {[...scale.darker].reverse().map((s, i) => (
                  <div key={'d' + i} className="h-6 rounded-md flex items-center px-2" style={{ background: s.hex }}>
                    <span className="text-[10px] font-mono" style={{ color: bestTextOn(parseColor(s.hex)).prefer === 'black' ? '#111' : '#fff' }}>{s.hex}</span>
                  </div>
                ))}
                <div className="h-8 rounded-md flex items-center px-2 ring-2 ring-black/10 dark:ring-white/20" style={{ background: hex }}>
                  <span className="text-[11px] font-mono font-medium" style={{ color: text?.prefer === 'black' ? '#111' : '#fff' }}>{hex} · 基准</span>
                </div>
                {scale.lighter.map((s, i) => (
                  <div key={'l' + i} className="h-6 rounded-md flex items-center px-2" style={{ background: s.hex }}>
                    <span className="text-[10px] font-mono" style={{ color: bestTextOn(parseColor(s.hex)).prefer === 'black' ? '#111' : '#fff' }}>{s.hex}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
