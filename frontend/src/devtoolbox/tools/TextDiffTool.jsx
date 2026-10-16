/** 文本对比：行级 diff（LCS），并排 / 统一两种视图，行内词级高亮，忽略大小写/空白可选 */
import { useMemo, useState } from 'react'
import { ToolHead, Check, Segmented, CopyBtn, LBL, btnSm, areaCls, card } from '../kit'
import { lineDiff, inlineDiff } from '../lib/diff'

const SAMPLE_A = `server:
  port: 60100
  workers: 1
  timeout: 30
  debug: true
logging:
  level: INFO
  file: data/logs/doublog.log`
const SAMPLE_B = `server:
  port: 60100
  workers: 2
  timeout: 60
  debug: false
logging:
  level: WARNING
  file: data/logs/doublog.log
  rotate: daily`

const ROW_BG = {
  add: 'bg-emerald-500/[0.08] dark:bg-emerald-400/[0.09]',
  del: 'bg-red-500/[0.08] dark:bg-red-400/[0.09]',
  eq: '',
}

function InlineMarked({ segs }) {
  return <>{segs.map((s, i) =>
    s.h
      ? <mark key={i} className={'rounded px-0.5 ' + (s.h % 2 ? 'bg-amber-300/40 dark:bg-amber-400/25' : 'bg-sky-300/40 dark:bg-sky-400/25')}>{s.t}</mark>
      : <span key={i}>{s.t}</span>)}</>
}

export default function TextDiffTool() {
  const [a, setA] = useState(SAMPLE_A)
  const [b, setB] = useState(SAMPLE_B)
  const [view, setView] = useState('side')
  const [ignoreCase, setIgnoreCase] = useState(false)
  const [ignoreWs, setIgnoreWs] = useState(false)
  const [inline, setInline] = useState(true)

  const { rows, stats } = useMemo(
    () => lineDiff(a, b, { ignoreCase, ignoreWs }), [a, b, ignoreCase, ignoreWs])

  /** 并排视图行配对：相邻 del 块与 add 块按序对齐到同一视觉行（类似 git --side-by-side） */
  const pairs = useMemo(() => {
    const out = []
    let i = 0
    while (i < rows.length) {
      if (rows[i].type === 'eq') { out.push({ left: rows[i], right: rows[i], kind: 'eq' }); i++; continue }
      const dels = [], adds = []
      while (i < rows.length && rows[i].type === 'del') dels.push(rows[i++])
      while (i < rows.length && rows[i].type === 'add') adds.push(rows[i++])
      const n = Math.max(dels.length, adds.length)
      for (let k = 0; k < n; k++) {
        const l = dels[k] || null, r = adds[k] || null
        out.push({ left: l, right: r, kind: l && r ? 'chg' : (l ? 'del' : 'add') })
      }
    }
    return out
  }, [rows])

  const unifiedText = useMemo(() =>
    rows.map(r => r.type === 'add' ? `+ ${r.bt}` : r.type === 'del' ? `- ${r.at}` : `  ${r.at ?? r.bt}`).join('\n'),
    [rows])

  return (
    <div>
      <ToolHead title="文本对比" desc="行级 LCS diff + 行内词级高亮（纯本地计算）"
        right={<>
          <Segmented value={view} onChange={setView} options={[
            { key: 'side', label: '并排' },
            { key: 'unified', label: '统一' },
          ]} />
          <Check checked={ignoreCase} onChange={setIgnoreCase} label="忽略大小写" />
          <Check checked={ignoreWs} onChange={setIgnoreWs} label="忽略空白" />
          <Check checked={inline} onChange={setInline} label="行内高亮" />
        </>} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <textarea className={areaCls} rows={12} value={a} spellCheck={false} onChange={e => setA(e.target.value)} aria-label="原文本" placeholder="原文本" />
        <textarea className={areaCls} rows={12} value={b} spellCheck={false} onChange={e => setB(e.target.value)} aria-label="新文本" placeholder="新文本" />
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">+{stats.added}</span>
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-600 dark:text-red-400">-{stats.removed}</span>
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-stone-500/10 text-stone-500 dark:text-stone-400">={stats.unchanged}</span>
        <CopyBtn text={unifiedText} label="复制补丁" cls={btnSm} />
      </div>
      {view === 'side' ? (
        <div className={'mt-3 overflow-x-auto ' + card}>
          <div className="grid grid-cols-[3rem_1fr_3rem_1fr] text-[12.5px] font-mono">
            {pairs.map((p, i) => {
              const segs = inline && p.kind === 'chg' ? inlineDiff(p.left.at, p.right.bt) : null
              return (
                <div key={i} className="contents">
                  <div className={'px-1.5 py-0.5 text-right text-stone-400 select-none border-r border-black/[0.04] dark:border-white/[0.05] ' + (p.left ? (p.kind === 'chg' || p.kind === 'del' ? ROW_BG.del : '') : '')}>{p.left ? p.left.a : ''}</div>
                  <div className={'px-2 py-0.5 whitespace-pre-wrap break-all ' + (p.left ? (p.kind === 'chg' || p.kind === 'del' ? ROW_BG.del : '') : '')}>
                    {p.left ? (segs ? <InlineMarked segs={segs.left} /> : <span className={p.kind === 'del' ? 'text-red-700/90 dark:text-red-300/90' : ''}>{p.left.at}</span>) : ''}
                  </div>
                  <div className={'px-1.5 py-0.5 text-right text-stone-400 select-none border-r border-l border-black/[0.04] dark:border-white/[0.05] ' + (p.right ? (p.kind === 'chg' || p.kind === 'add' ? ROW_BG.add : '') : '')}>{p.right ? p.right.b : ''}</div>
                  <div className={'px-2 py-0.5 whitespace-pre-wrap break-all ' + (p.right ? (p.kind === 'chg' || p.kind === 'add' ? ROW_BG.add : '') : '')}>
                    {p.right ? (segs ? <InlineMarked segs={segs.right} /> : <span className={p.kind === 'add' ? 'text-emerald-700/90 dark:text-emerald-300/90' : ''}>{p.right.bt}</span>) : ''}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className={'mt-3 overflow-x-auto ' + card}>
          <div className="text-[12.5px] font-mono">
            {rows.map((r, i) => (
              <div key={i} className={'flex gap-2 px-3 py-0.5 whitespace-pre-wrap break-all ' + ROW_BG[r.type]}>
                <span className="select-none text-stone-400 w-8 text-right shrink-0">{r.a ?? r.b ?? ''}</span>
                <span className="select-none w-3 shrink-0">{r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' '}</span>
                <span>{r.at ?? r.bt}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className={'mt-2 ' + LBL}>行内高亮只对「一行删除 + 一行新增」的配对生效；忽略空白 = 行首尾 trim + 连续空白折叠后比较。</p>
    </div>
  )
}
