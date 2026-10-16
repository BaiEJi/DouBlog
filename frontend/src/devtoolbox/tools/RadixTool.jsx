/** 进制转换：任意进制互转（BigInt 大数安全）+ 位分组视图（字节/十六进制/二进制） */
import { useMemo, useState } from 'react'
import { ToolHead, CopyBtn, StatusLine, LBL, inputCls, selectCls, card } from '../kit'

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

function parseInBase(text, base) {
  const s = text.trim().toLowerCase().replace(/^0[xbo]/, '')
  if (!s) return null
  if (![...s].every(c => DIGITS.indexOf(c) >= 0 && DIGITS.indexOf(c) < base)) return null
  try {
    return BigInt(base === 10 ? (s || '0') : [...s].reduce((acc, c) => acc * BigInt(base) + BigInt(DIGITS.indexOf(c)), 0n))
  } catch { return null }
}

function toBase(n, base) {
  if (n === 0n) return '0'
  let s = ''
  while (n > 0n) { s = DIGITS[Number(n % BigInt(base))] + s; n /= BigInt(base) }
  return s
}

export default function RadixTool() {
  const [text, setText] = useState('4396')
  const [from, setFrom] = useState(10)

  const value = useMemo(() => parseInBase(text, from), [text, from])
  const targets = [2, 8, 10, 16, 26, 32, 36]
  const rows = targets.filter(b => b !== from).map(b => ({
    base: b, label: { 2: '二进制 BIN', 8: '八进制 OCT', 10: '十进制 DEC', 16: '十六进制 HEX', 26: 'Base26', 32: 'Base32', 36: 'Base36' }[b],
    value: value == null ? '' : toBase(value, b),
  }))

  const bytes = useMemo(() => {
    if (value == null || value < 0n) return null
    let v = value
    const out = []
    do { out.unshift(Number(v & 0xffn)); v >>= 8n } while (v > 0n && out.length < 64)
    return out
  }, [value])

  return (
    <div>
      <ToolHead title="进制转换" desc="BigInt 大数安全；一次输入，常用进制全部给出 + 字节位视图" />
      <div className="flex flex-wrap gap-2 items-center">
        <input className={inputCls + ' flex-1 min-w-56 font-mono'} value={text} spellCheck={false}
          onChange={e => setText(e.target.value)} placeholder="输入数值" aria-label="数值输入" />
        <select className={selectCls} value={from} onChange={e => setFrom(+e.target.value)} aria-label="源进制">
          {targets.map(b => <option key={b} value={b}>{b} 进制</option>)}
          <option value={3}>3 进制</option><option value={4}>4 进制</option>
          <option value={5}>5 进制</option><option value={6}>6 进制</option>
          <option value={7}>7 进制</option><option value={9}>9 进制</option>
          <option value={11}>11 进制</option><option value={12}>12 进制</option>
          <option value={20}>20 进制</option><option value={60}>60 进制</option>
        </select>
      </div>
      <div className="mt-2"><StatusLine ok={value != null && !!text.trim()} err={text.trim() && value == null ? `输入含 ${from} 进制以外的字符` : null} okText="有效数值" /></div>
      <div className={'mt-3 divide-y divide-black/[0.05] dark:divide-white/[0.06] ' + card}>
        {rows.map(r => (
          <div key={r.base} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-24 shrink-0 text-xs text-stone-500 dark:text-stone-400">{r.label}</span>
            <code className="flex-1 min-w-0 font-mono text-[13px] text-stone-800 dark:text-stone-100 break-all">{r.value || '—'}</code>
            <CopyBtn text={r.value} disabled={!r.value} />
          </div>
        ))}
      </div>
      {bytes && (
        <div className={'mt-4 p-4 ' + card}>
          <p className="text-sm font-semibold mb-2">字节视图 <span className={LBL + ' font-normal ml-1'}>{bytes.length} 字节（大端）</span></p>
          <div className="flex flex-wrap gap-2">
            {bytes.map((b, i) => (
              <div key={i} className="px-2 py-1 rounded-lg bg-black/[0.03] dark:bg-white/[0.05] font-mono text-[12px] text-center">
                <div className="text-stone-700 dark:text-stone-200">{b.toString(16).padStart(2, '0').toUpperCase()}</div>
                <div className="text-[10px] text-stone-400 tabular-nums">{b.toString(2).padStart(8, '0')}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
