/** 正则测试器：实时高亮匹配、捕获分组表、命名分组、常用正则库（纯本地） */
import { useMemo, useState } from 'react'
import { ToolHead, StatusLine, LBL, inputCls, areaCls, card } from '../kit'
import { COMMON_REGEXES } from '../data'

const SAMPLE_TEXT = `联系我：alice@example.com 或 bob@test.cn
个人主页 https://example.com/page?id=42
IP 192.168.1.100，手机 13812345678
时间 2026-10-16，金额 $1,299.00
哈希 5d41402abc4b2a76b9719d911017c592`

export default function RegexTool() {
  const [pattern, setPattern] = useState(String.raw`\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b`)
  const [flags, setFlags] = useState('g')
  const [text, setText] = useState(SAMPLE_TEXT)

  const { error, segments, matches } = useMemo(() => {
    if (!pattern) return { error: null, segments: text ? [{ text, m: false }] : [], matches: [] }
    let re
    try {
      re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g')
    } catch (e) {
      return { error: '正则无效：' + e.message, segments: text ? [{ text, m: false }] : [], matches: [] }
    }
    if (!text) return { error: null, segments: [], matches: [] }
    const segs = []
    const found = []
    let last = 0
    for (const m of text.matchAll(re)) {
      if (m.index > last) segs.push({ text: text.slice(last, m.index), m: false })
      segs.push({ text: m[0], m: true })
      found.push({ value: m[0], index: m.index, groups: m.slice(1), named: m.groups ? Object.entries(m.groups) : null })
      last = m.index + m[0].length
      if (found.length > 500) break   // 防炸渲染
    }
    if (last < text.length) segs.push({ text: text.slice(last), m: false })
    return { error: null, segments: segs, matches: found }
  }, [pattern, flags, text])

  const groupNames = useMemo(() => {
    const names = [...pattern.matchAll(/\(\?<([A-Za-z_$][\w$]*)>/g)].map(m => m[1])
    return names
  }, [pattern])

  return (
    <div>
      <ToolHead title="正则测试" desc="实时匹配高亮、分组捕获（含命名分组）；改一下正则立刻看效果" />
      <div className="flex flex-wrap gap-2 items-center">
        <span className="font-mono text-sm text-stone-400 select-none">/</span>
        <input className={inputCls + ' flex-1 min-w-48 font-mono'} value={pattern} spellCheck={false}
          onChange={e => setPattern(e.target.value)} placeholder="正则表达式" aria-label="正则表达式" />
        <span className="font-mono text-sm text-stone-400 select-none">/</span>
        <input className={inputCls + ' w-20 font-mono'} value={flags} spellCheck={false}
          onChange={e => setFlags(e.target.value.replace(/[^gimsuy]/g, ''))} placeholder="flags" aria-label="标志位" />
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {COMMON_REGEXES.map(r => (
          <button key={r.name} className={'px-2.5 py-1 rounded-full text-[12px] transition-colors border ' +
            (pattern === r.value
              ? 'border-lime-600/40 dark:border-lime-400/40 bg-lime-500/10 text-lime-700 dark:text-lime-400 font-medium'
              : 'border-black/[0.08] dark:border-white/[0.1] text-stone-500 dark:text-stone-400 hover:border-black/20 dark:hover:border-white/25 hover:text-stone-700 dark:hover:text-stone-200')}
            title={r.value} onClick={() => setPattern(r.value)}>{r.name}</button>
        ))}
      </div>
      <div className="mt-3"><StatusLine ok={!error && !!pattern} err={error} okText={matches.length ? `匹配 ${matches.length} 处` : '无匹配'} /></div>
      <div className={'mt-3 p-3 rounded-lg border font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-all min-h-24 ' +
        'border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.04] text-stone-800 dark:text-stone-100'}>
        {segments.map((s, i) =>
          s.m
            ? <mark key={i} className="bg-lime-300/50 dark:bg-lime-400/30 text-stone-900 dark:text-stone-50 rounded-sm">{s.text}</mark>
            : <span key={i}>{s.text}</span>)}
        {!text && <span className="text-stone-400">粘贴测试文本…</span>}
      </div>
      <textarea className={areaCls + ' mt-3'} rows={6} value={text} spellCheck={false}
        onChange={e => setText(e.target.value)} placeholder="测试文本" aria-label="测试文本" />
      {matches.length > 0 && (
        <div className={'mt-4 overflow-x-auto ' + card}>
          <p className="px-4 py-3 text-sm font-semibold border-b border-black/[0.05] dark:border-white/[0.06]">捕获明细（前 {Math.min(matches.length, 100)} 项）</p>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-xs text-stone-500 dark:text-stone-400 border-b border-black/[0.06] dark:border-white/[0.07]">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">位置</th>
                <th className="px-4 py-2 font-medium">完整匹配</th>
                <th className="px-4 py-2 font-medium">分组{groupNames.length ? `（${groupNames.join(', ')}）` : ''}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.05] font-mono">
              {matches.slice(0, 100).map((m, i) => (
                <tr key={i}>
                  <td className="px-4 py-1.5 tabular-nums text-stone-400">{i + 1}</td>
                  <td className="px-4 py-1.5 tabular-nums text-stone-500 dark:text-stone-400">{m.index}</td>
                  <td className="px-4 py-1.5 text-stone-800 dark:text-stone-100 break-all">{m.value}</td>
                  <td className="px-4 py-1.5 text-stone-600 dark:text-stone-300 break-all">
                    {m.groups.length || m.named
                      ? <>
                          {m.groups.map((g, gi) => g != null && <span key={gi} className="mr-2"><span className="text-stone-400">${gi + 1}=</span>{g}</span>)}
                          {m.named?.map(([n, v]) => v != null && <span key={n} className="mr-2"><span className="text-stone-400">{n}=</span>{v}</span>)}
                        </>
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={'mt-2 ' + LBL}>标志位：g 全局 / i 忽略大小写 / m 多行 / s 点号跨行 / u Unicode / y 粘连。</p>
    </div>
  )
}
