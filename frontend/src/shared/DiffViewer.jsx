import VirtualList from './VirtualList'
import useComputation from './useComputation'

const BACKGROUND = { add: 'bg-emerald-500/[0.08] dark:bg-emerald-400/[0.09]', del: 'bg-red-500/[0.08] dark:bg-red-400/[0.09]', eq: '' }
const Marked = ({ segments, text }) => segments ? segments.map((segment, index) => segment.h
  ? <mark key={index} className="bg-amber-300/40 dark:bg-amber-400/25 text-inherit rounded">{segment.t}</mark> : <span key={index}>{segment.t}</span>) : text
export default function DiffViewer({ a = '', b = '', view = 'side', ignoreCase = false, ignoreWs = false, inline = true, height = 500 }) {
  const { result, error, pending, cancel } = useComputation('textDiff', { a, b, ignoreCase, ignoreWs, inline }, { timeoutMs: 8000 })
  const rows = result?.rows || [], pairs = result?.pairs || []
  return <div>
    <div className="flex items-center gap-3 text-xs my-3" role="status">
      {pending ? <span className="text-stone-500 dark:text-stone-400">计算中，可继续编辑…<button onClick={cancel} className="ml-3 underline">取消</button></span> : error ? <span className="text-red-600 dark:text-red-400">{error}</span>
        : <><span className="text-emerald-600 dark:text-emerald-400">+{result?.stats.added || 0}</span><span className="text-red-600 dark:text-red-400">−{result?.stats.removed || 0}</span><span className="text-stone-500 dark:text-stone-400">={result?.stats.unchanged || 0}</span></>}
      {result && <button className="ml-auto text-stone-500 dark:text-stone-400 hover:underline" onClick={() => navigator.clipboard.writeText(result.unifiedText).catch(() => {})}>复制完整补丁</button>}
    </div>
    {!error && <div className="rounded-xl overflow-hidden border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] font-mono text-[12.5px]">
      <VirtualList items={view === 'side' ? pairs : rows} height={height} estimateSize={24} renderItem={row => view === 'side' ? <div className="grid grid-cols-2">
        {[['left', 'del'], ['right', 'add']].map(([side, kind]) => <div key={side} className={'flex min-w-0 border-r border-black/[0.04] dark:border-white/[0.05] ' + (row.kind === 'chg' || row.kind === kind ? BACKGROUND[kind] : '')}>
          <span className="w-12 shrink-0 text-right pr-2 py-0.5 text-stone-400 dark:text-stone-500 select-none">{row[side]?.[side === 'left' ? 'a' : 'b']}</span>
          <span className="min-w-0 px-2 py-0.5 whitespace-pre-wrap break-all"><Marked segments={row.segs?.[side]} text={row[side]?.[side === 'left' ? 'at' : 'bt']} /></span>
        </div>)}
      </div> : <div className={'flex gap-2 px-3 py-0.5 whitespace-pre-wrap break-all ' + BACKGROUND[row.type]}><span className="w-10 shrink-0 text-right text-stone-400 dark:text-stone-500 select-none">{row.a ?? row.b}</span><span className="shrink-0 select-none">{row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}</span><span>{row.at ?? row.bt}</span></div>} />
    </div>}
  </div>
}
