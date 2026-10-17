/**
 * 规则视图：runtime 规则链浏览（类型徽章 + 匹配目标 + 出站策略），搜索 + 手动刷新。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { clashCtlRules } from './api'
import { card, btn, inputCls, LBL } from './kit'

export default function RulesView({ toast, unavailable }) {
  const [data, setData] = useState(null)
  const [q, setQ] = useState('')

  const refresh = useCallback(async () => {
    try {
      setData(await clashCtlRules())
    } catch (e) {
      toast({ msg: e.message, kind: 'error' })
    }
  }, [toast])

  useEffect(() => { if (!unavailable) refresh() }, [unavailable, refresh])

  const rows = useMemo(() => {
    const all = data?.rules || []
    const kw = q.trim().toLowerCase()
    if (!kw) return all
    return all.filter(r => (`${r.type} ${r.payload} ${r.proxy}`).toLowerCase().includes(kw))
  }, [data, q])

  if (unavailable) return null
  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.06]">
        <div>
          <h3 className="text-sm font-semibold">规则链</h3>
          <p className={LBL + ' mt-0.5'}>{data ? `${rows.length} / ${data.total} 条（自上而下首条命中生效）` : '加载中…'}</p>
        </div>
        <div className="flex items-center gap-2">
          <input className={inputCls + ' w-64'} placeholder="搜索类型 / 目标 / 策略" value={q}
            onChange={e => setQ(e.target.value)} />
          <button className={btn} onClick={refresh}>刷新</button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-[13px] text-stone-400">{data == null ? '加载中…' : '无匹配规则'}</div>
      ) : (
        <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-black/[0.015] dark:hover:bg-white/[0.02]">
                  <td className="w-14 px-5 py-2 font-mono text-[11px] text-stone-400 dark:text-stone-500 tabular-nums">{i + 1}</td>
                  <td className="w-44 py-2 pr-3">
                    <span className="px-1.5 py-0.5 rounded-md text-[11px] font-mono bg-stone-500/10 text-stone-600 dark:text-stone-300">{r.type}</span>
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-stone-700 dark:text-stone-200 break-all">{r.payload || '—'}</td>
                  <td className="w-32 py-2 px-5 text-right truncate text-[13px] font-medium text-stone-600 dark:text-stone-300" title={r.proxy}>{r.proxy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
