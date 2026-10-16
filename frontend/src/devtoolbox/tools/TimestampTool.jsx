/** 时间戳转换：Unix 秒/毫秒 ⇄ 日期时间（本地+UTC+ISO+相对）；当前时间实时跳动；时间差计算 */
import { useEffect, useMemo, useState } from 'react'
import { ToolHead, CopyBtn, Segmented, LBL, btn, inputCls, card } from '../kit'

function parseAny(input) {
  const s = input.trim()
  if (!s) return null
  if (/^-?\d{10}$/.test(s)) return new Date(+s * 1000)
  if (/^-?\d{13}$/.test(s)) return new Date(+s)
  if (/^-?\d{16,}$/.test(s)) return new Date(+s / 10 ** Math.min(s.length - 13, 6)) // 微秒/纳秒 → 毫秒
  const d = new Date(s.replace(/(\d)年|月|日/g, '$1/').replace(/时|分/g, ':').replace(/秒/g, ''))
  return isNaN(d) ? null : d
}

const fmtPairs = (d, nowMs) => [
  ['Unix 秒', Math.floor(d.getTime() / 1000)],
  ['Unix 毫秒', d.getTime()],
  ['本地时间', d.toLocaleString('zh-CN', { hour12: false })],
  ['UTC', d.toUTCString()],
  ['ISO 8601', d.toISOString()],
  ['日期', d.toLocaleDateString('zh-CN')],
  ['星期', '周' + '日一二三四五六'[d.getDay()]],
  ['相对', relTime(d, nowMs)],
]

function relTime(d, nowMs = d.getTime()) {
  const diff = (d.getTime() - nowMs) / 1000
  const abs = Math.abs(diff)
  const unit = abs < 60 ? [abs, '秒'] : abs < 3600 ? [abs / 60, '分钟'] : abs < 86400 ? [abs / 3600, '小时'] : abs < 86400 * 30 ? [abs / 86400, '天'] : abs < 86400 * 365 ? [abs / 86400 / 30, '个月'] : [abs / 86400 / 365, '年']
  const v = Math.round(unit[0] * 10) / 10
  return diff >= 0 ? `${v} ${unit[1]}后` : `${v} ${unit[1]}前`
}

export default function TimestampTool() {
  const [tab, setTab] = useState('convert')
  const [input, setInput] = useState(() => String(Math.floor(Date.now() / 1000)))
  const [now, setNow] = useState(() => Date.now())
  // 时间差
  const [d1, setD1] = useState('2026-10-01 09:00:00')
  const [d2, setD2] = useState('2026-10-16 18:30:00')

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const parsed = useMemo(() => parseAny(input), [input])
  const rows = parsed ? fmtPairs(parsed, now) : []

  const dur = useMemo(() => {
    const a = parseAny(d1), b = parseAny(d2)
    if (!a || !b) return null
    const ms = Math.abs(b - a)
    const totalSec = Math.floor(ms / 1000)
    const days = Math.floor(totalSec / 86400)
    const hours = Math.floor(totalSec % 86400 / 3600)
    const mins = Math.floor(totalSec % 3600 / 60)
    const secs = totalSec % 60
    return {
      span: `${days} 天 ${hours} 小时 ${mins} 分 ${secs} 秒`,
      totals: [
        ['总毫秒', ms], ['总秒', totalSec], ['总分钟', Math.floor(totalSec / 60)],
        ['总小时', +(totalSec / 3600).toFixed(2)], ['总天', +(totalSec / 86400).toFixed(3)], ['总周', +(totalSec / 86400 / 7).toFixed(3)],
      ],
    }
  }, [d1, d2])

  const nowDate = new Date(now)

  return (
    <div>
      <ToolHead title="时间戳转换" desc="Unix 秒/毫秒 ⇄ 日期时间；支持中文日期、微秒时间戳；附时间差计算"
        right={<Segmented value={tab} onChange={setTab} options={[
          { key: 'convert', label: '转换' },
          { key: 'now', label: '当前时间' },
          { key: 'dur', label: '时间差' },
        ]} />} />
      {tab === 'convert' && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <input className={inputCls + ' flex-1 min-w-64 font-mono'} value={input} spellCheck={false}
              onChange={e => setInput(e.target.value)} placeholder="Unix 秒/毫秒 或 2026-10-16 12:00:00" aria-label="时间输入" />
            <button className={btn} onClick={() => setInput(String(Math.floor(Date.now() / 1000)))}>取当前秒</button>
            <button className={btn} onClick={() => setInput(String(Date.now()))}>取当前毫秒</button>
          </div>
          {parsed ? (
            <div className={'mt-4 divide-y divide-black/[0.05] dark:divide-white/[0.06] ' + card}>
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-28 shrink-0 text-xs text-stone-500 dark:text-stone-400">{k}</span>
                  <code className="flex-1 min-w-0 font-mono text-[13px] text-stone-800 dark:text-stone-100 break-all">{String(v)}</code>
                  <CopyBtn text={String(v)} />
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-red-600 dark:text-red-400">✗ 无法识别的时间格式（支持 10/13 位时间戳、ISO 日期、YYYY-MM-DD HH:mm:ss）</p>
          )}
        </>
      )}
      {tab === 'now' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className={card + ' p-6 text-center'}>
            <p className="text-4xl font-semibold tabular-nums tracking-tight">{nowDate.toLocaleTimeString('zh-CN', { hour12: false })}</p>
            <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">{nowDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
            <div className="mt-4 flex justify-center gap-2 flex-wrap">
              <CopyBtn text={String(Math.floor(now / 1000))} label={`秒 ${Math.floor(now / 1000)}`} />
              <CopyBtn text={String(now)} label={`毫秒 ${now}`} />
            </div>
          </div>
          <div className={card + ' p-6'}>
            {fmtPairs(nowDate).slice(2).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 py-1.5 text-[13px] border-b border-black/[0.04] dark:border-white/[0.05] last:border-0">
                <span className="text-stone-500 dark:text-stone-400">{k}</span>
                <span className="font-mono text-stone-800 dark:text-stone-100 text-right break-all">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === 'dur' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className={LBL + ' mb-1 block'}>时间 A</span>
              <input className={inputCls + ' w-full font-mono'} value={d1} onChange={e => setD1(e.target.value)} spellCheck={false} />
            </label>
            <label className="block">
              <span className={LBL + ' mb-1 block'}>时间 B</span>
              <input className={inputCls + ' w-full font-mono'} value={d2} onChange={e => setD2(e.target.value)} spellCheck={false} />
            </label>
          </div>
          {dur ? (
            <>
              <p className={'mt-4 ' + card + ' p-4 text-base font-semibold'}>时间差：{dur.span}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                {dur.totals.map(([k, v]) => (
                  <div key={k} className={card + ' p-4'}>
                    <p className="text-lg font-semibold tabular-nums">{v.toLocaleString()}</p>
                    <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{k}</p>
                  </div>
                ))}
              </div>
            </>
          ) : <p className="mt-3 text-[13px] text-red-600 dark:text-red-400">✗ 时间格式无法识别</p>}
        </>
      )}
    </div>
  )
}
