/**
 * 连接视图：当前活跃连接（host/规则/链路/上下行/时长）+ 实时总速率 + 单条/全部断开。
 * 2s 轮询 /connections（上传下载总量差分出速率）；关闭单条/全部即席生效。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { clashCtlConnections, clashCtlCloseConn, clashCtlCloseAll } from './api'
import { card, btn, btnDanger, inputCls, fmtBytes, fmtSince, LBL } from './kit'

export default function ConnectionsView({ toast, unavailable }) {
  const [data, setData] = useState(null)
  const [speed, setSpeed] = useState({ up: 0, down: 0 })
  const [q, setQ] = useState('')
  const [auto, setAuto] = useState(true)
  const [closing, setClosing] = useState('')
  const prevTotals = useRef(null)
  const timer = useRef(null)

  const refresh = useCallback(async (quiet = false) => {
    try {
      const d = await clashCtlConnections()
      // 差分速率（两次轮询间总量增量 / 间隔）
      const now = Date.now()
      if (prevTotals.current) {
        const dt = (now - prevTotals.current.t) / 1000
        if (dt > 0) setSpeed({
          up: Math.max(0, (d.uploadTotal - prevTotals.current.up) / dt),
          down: Math.max(0, (d.downloadTotal - prevTotals.current.down) / dt),
        })
      }
      prevTotals.current = { t: now, up: d.uploadTotal, down: d.downloadTotal }
      setData(d)
    } catch (e) {
      if (!quiet) toast({ msg: e.message, kind: 'error' })
    }
  }, [toast])

  useEffect(() => { if (!unavailable) refresh() }, [unavailable])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (auto && !unavailable) timer.current = setInterval(() => refresh(true), 2000)
    return () => clearInterval(timer.current)
  }, [auto, unavailable, refresh])

  const closeConn = async id => {
    setClosing(id)
    try {
      await clashCtlCloseConn(id)
      await refresh(true)
    } catch (e) {
      toast({ msg: e.message, kind: 'error' })
    } finally {
      setClosing('')
    }
  }

  const closeAll = async () => {
    setClosing('all')
    try {
      await clashCtlCloseAll()
      toast({ msg: '已断开全部连接' })
      await refresh(true)
    } catch (e) {
      toast({ msg: e.message, kind: 'error' })
    } finally {
      setClosing('')
    }
  }

  if (unavailable) return null
  const conns = data?.connections || []
  const kw = q.trim().toLowerCase()
  const rows = kw
    ? conns.filter(c => (c.host + c.rule + c.rulePayload + c.chains.join('›')).toLowerCase().includes(kw))
    : conns
  rows.sort((a, b) => (b.start || '').localeCompare(a.start || ''))

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.06]">
        <div>
          <h3 className="text-sm font-semibold">活跃连接</h3>
          <p className={'mt-0.5 flex flex-wrap items-center gap-x-3 ' + LBL}>
            <span>{rows.length} 条</span>
            <span>↑ {fmtBytes(speed.up)}/s</span>
            <span>↓ {fmtBytes(speed.down)}/s</span>
            <span>累计 ↑{fmtBytes(data?.uploadTotal)} ↓{fmtBytes(data?.downloadTotal)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input className={inputCls + ' w-64'} placeholder="搜索 host / 规则 / 链路" value={q}
            onChange={e => setQ(e.target.value)} />
          <label className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 cursor-pointer">
            <input type="checkbox" className="accent-sky-600" checked={auto}
              onChange={e => setAuto(e.target.checked)} />
            2s 自动刷新
          </label>
          <button className={btn} onClick={() => refresh()}>刷新</button>
          <button className={btnDanger} disabled={!!closing || !rows.length} onClick={closeAll}>
            {closing === 'all' ? '断开中…' : '断开全部'}
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-[13px] text-stone-400">
          {data == null ? '加载中…' : '暂无活跃连接'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11.5px] text-stone-400 dark:text-stone-500 border-b border-black/[0.06] dark:border-white/[0.06]">
                <th className="px-5 py-2.5 font-medium">Host</th>
                <th className="px-3 py-2.5 font-medium">规则</th>
                <th className="px-3 py-2.5 font-medium">链路</th>
                <th className="px-3 py-2.5 font-medium text-right">↑ / ↓</th>
                <th className="px-3 py-2.5 font-medium text-right">时长</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
              {rows.map(c => (
                <tr key={c.id} className="hover:bg-black/[0.015] dark:hover:bg-white/[0.02]">
                  <td className="px-5 py-2.5 max-w-64">
                    <div className="truncate font-medium" title={c.host}>{c.host}</div>
                    <div className="text-[11px] text-stone-400">{c.network} · {c.type} · {c.source}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="px-1.5 py-0.5 rounded-md text-[11px] font-mono bg-stone-500/10 text-stone-600 dark:text-stone-300">{c.rule}</span>
                    <span className="ml-1.5 text-xs text-stone-500 dark:text-stone-400">{c.rulePayload}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-xs text-stone-500 dark:text-stone-400" title={c.chains.join(' › ')}>
                      {c.chains.slice().reverse().join(' › ')}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-stone-500 dark:text-stone-400 whitespace-nowrap">
                    {fmtBytes(c.upload)} / {fmtBytes(c.download)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-stone-500 dark:text-stone-400">{fmtSince(c.start)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button className="w-7 h-7 rounded-lg text-stone-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm"
                      title="断开此连接" disabled={!!closing}
                      onClick={() => closeConn(c.id)}>{closing === c.id ? '…' : '✕'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
