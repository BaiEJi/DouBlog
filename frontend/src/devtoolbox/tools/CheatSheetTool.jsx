/** 速查表：HTTP 状态码 / MIME 类型 / ASCII 码表（搜索过滤，纯静态数据） */
import { useMemo, useState } from 'react'
import { ToolHead, Segmented, inputCls, card, CopyBtn } from '../kit'
import { HTTP_CODES, HTTP_CODE_GROUPS, MIME_TYPES, ASCII_CONTROL } from '../data'

const codeCls = code =>
  code < 300 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    : code < 400 ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
      : code < 500 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
        : 'bg-red-500/10 text-red-600 dark:text-red-400'

export default function CheatSheetTool() {
  const [tab, setTab] = useState('http')
  const [q, setQ] = useState('')

  const query = q.trim().toLowerCase()

  const httpRows = useMemo(() =>
    HTTP_CODES.filter(c => !query || String(c.c).includes(query) || c.t.toLowerCase().includes(query)),
    [query])
  const mimeRows = useMemo(() =>
    MIME_TYPES.filter(m => !query || m[0].includes(query) || m[1].toLowerCase().includes(query) || m[2].includes(query)),
    [query])
  const asciiRows = useMemo(() => {
    const rows = []
    for (let i = 32; i <= 126; i++) {
      rows.push({ dec: i, hex: '0x' + i.toString(16).toUpperCase().padStart(2, '0'), oct: '0o' + i.toString(8), ch: String.fromCharCode(i), name: '' })
    }
    for (const [dec, name] of Object.entries(ASCII_CONTROL)) {
      rows.unshift({ dec: +dec, hex: '0x' + (+dec).toString(16).toUpperCase().padStart(2, '0'), oct: '0o' + (+dec).toString(8), ch: +dec === 0 ? 'NUL' : String.fromCharCode(+dec), name, control: true })
    }
    return rows.filter(r => !query || String(r.dec) === query || r.hex.toLowerCase().includes(query) || r.ch.toLowerCase() === query || (r.name || '').toLowerCase().includes(query))
  }, [query])

  return (
    <div>
      <ToolHead title="速查表" desc="HTTP 状态码 / MIME 类型 / ASCII 码表——开发中最常翻的三张表"
        right={<Segmented value={tab} onChange={setTab} options={[
          { key: 'http', label: `HTTP ${httpRows.length}` },
          { key: 'mime', label: `MIME ${mimeRows.length}` },
          { key: 'ascii', label: `ASCII ${asciiRows.length}` },
        ]} />} />
      <input className={inputCls + ' w-full max-w-md mb-4'} value={q} spellCheck={false}
        onChange={e => setQ(e.target.value)} placeholder={tab === 'http' ? '搜状态码或含义，如 429 / 限流' : tab === 'mime' ? '搜扩展名或类型，如 json' : '搜十进制/十六进制/字符，如 65 / 0x41 / A'} aria-label="搜索" />

      {tab === 'http' && (
        <div className="space-y-5">
          {HTTP_CODE_GROUPS.map(g => {
            const rows = httpRows.filter(c => g.test(c.c))
            if (!rows.length) return null
            return (
              <div key={g.label}>
                <p className="text-sm font-semibold mb-2">{g.label}</p>
                <div className={'divide-y divide-black/[0.04] dark:divide-white/[0.05] ' + card}>
                  {rows.map(c => (
                    <div key={c.c} className="flex items-center gap-3 px-4 py-2">
                      <span className={'px-2 py-0.5 rounded-md font-mono text-[12.5px] font-medium tabular-nums w-11 text-center shrink-0 ' + codeCls(c.c)}>{c.c}</span>
                      <span className="text-[13px] text-stone-700 dark:text-stone-200">{c.t}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          {!httpRows.length && <p className="text-[13px] text-stone-400">没有匹配的状态码。</p>}
        </div>
      )}

      {tab === 'mime' && (
        <div className={'divide-y divide-black/[0.04] dark:divide-white/[0.05] ' + card}>
          {mimeRows.map(([ext, type, desc]) => (
            <div key={ext + type} className="flex items-center gap-3 px-4 py-2 flex-wrap">
              <code className="w-20 shrink-0 font-mono text-[13px] text-stone-800 dark:text-stone-100">{ext}</code>
              <code className="flex-1 min-w-40 font-mono text-[12.5px] text-lime-700 dark:text-lime-400 break-all">{type}</code>
              <span className="text-xs text-stone-500 dark:text-stone-400">{desc}</span>
              <CopyBtn text={type} />
            </div>
          ))}
          {!mimeRows.length && <p className="px-4 py-3 text-[13px] text-stone-400">没有匹配的 MIME 类型。</p>}
        </div>
      )}

      {tab === 'ascii' && (
        <div className={'overflow-x-auto ' + card}>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-xs text-stone-500 dark:text-stone-400 border-b border-black/[0.06] dark:border-white/[0.07]">
                <th className="px-4 py-2 font-medium">十进制</th>
                <th className="px-4 py-2 font-medium">十六进制</th>
                <th className="px-4 py-2 font-medium">八进制</th>
                <th className="px-4 py-2 font-medium">字符</th>
                <th className="px-4 py-2 font-medium">名称</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.05] font-mono">
              {asciiRows.map(r => (
                <tr key={r.dec} className={r.control ? 'text-stone-500 dark:text-stone-400' : ''}>
                  <td className="px-4 py-1.5 tabular-nums">{r.dec}</td>
                  <td className="px-4 py-1.5">{r.hex}</td>
                  <td className="px-4 py-1.5">{r.oct}</td>
                  <td className="px-4 py-1.5 text-base text-stone-800 dark:text-stone-100">{r.ch}</td>
                  <td className="px-4 py-1.5 font-sans">{r.name || (/[A-Za-z0-9]/.test(r.ch) ? '' : '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!asciiRows.length && <p className="px-4 py-3 text-[13px] text-stone-400">没有匹配的条目。</p>}
        </div>
      )}
    </div>
  )
}
