/** JSON Diff：深度对比两个 JSON，按路径列出 增/删/改；数组 LCS 对齐、可忽略数组顺序 */
import { useMemo, useState } from 'react'
import { ToolHead, Check, CopyBtn, LBL, btnSm, card } from '../kit'
import { shortValue } from '../lib/diff'
import useComputation from '../../shared/useComputation'
import CodeEditor from '../../shared/CodeEditor'
import VirtualList from '../../shared/VirtualList'

const SAMPLE_A = `{
  "name": "deploy-config",
  "replicas": 2,
  "image": "app:1.2.0",
  "env": { "DEBUG": false, "PORT": 8080 },
  "ports": [80, 443]
}`
const SAMPLE_B = `{
  "name": "deploy-config",
  "replicas": 4,
  "image": "app:1.3.0",
  "env": { "DEBUG": false, "PORT": 8080, "TZ": "Asia/Shanghai" },
  "ports": [80, 443, 8443]
}`

const TYPE_BADGE = {
  added: { label: '新增', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  removed: { label: '删除', cls: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  changed: { label: '修改', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
}

export default function JsonDiffTool() {
  const [a, setA] = useState(SAMPLE_A)
  const [b, setB] = useState(SAMPLE_B)
  const [ignoreArrayOrder, setIgnoreArrayOrder] = useState(false)

  const computation = useComputation('jsonDiff', { a, b, ignoreArrayOrder })
  const diff = computation.result, error = computation.error

  const stats = diff?.stats
  const report = useMemo(() => {
    if (!diff) return ''
    return diff.changes.map(c => {
      const where = c.path === '$' ? '$（根）' : c.path.slice(1)
      if (c.type === 'added') return `+ ${where} = ${shortValue(c.b, 400)}`
      if (c.type === 'removed') return `- ${where}${c.a !== undefined ? ' = ' + shortValue(c.a, 400) : ''}`
      return `~ ${where}: ${shortValue(c.a, 200)} → ${shortValue(c.b, 200)}`
    }).join('\n') || '（无差异）'
  }, [diff])

  return (
    <div>
      <ToolHead title="JSON Diff" desc="深度对比：对象按键、数组按 LCS 对齐，按路径列出差异"
        right={<Check checked={ignoreArrayOrder} onChange={setIgnoreArrayOrder} label="忽略数组顺序" />} />
      <div className="grid grid-cols-2 gap-4">
        <CodeEditor value={a} onChange={setA} language="json" height={300} ariaLabel="JSON A" />
        <CodeEditor value={b} onChange={setB} language="json" height={300} ariaLabel="JSON B" />
      </div>
      {computation.pending && <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">计算中…</p>}
      {error && <p className="mt-2 text-[13px] text-red-600 dark:text-red-400">✗ {error}</p>}
      {stats && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {stats.same ? (
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">✓ 两个 JSON 完全一致</span>
          ) : (
            <>
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">新增 {stats.added}</span>
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-600 dark:text-red-400">删除 {stats.removed}</span>
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400">修改 {stats.changed}</span>
            </>
          )}
          <CopyBtn text={report} label="复制差异报告" cls={btnSm} />
        </div>
      )}
      {diff && !stats.same && (
        <div className={'mt-3 divide-y divide-black/[0.05] dark:divide-white/[0.06] ' + card}>
          <VirtualList items={diff.changes} height={500} estimateSize={90} renderItem={(c, i) => {
            const badge = TYPE_BADGE[c.type]
            return (
              <div key={i} className="px-4 py-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={'px-1.5 py-0.5 rounded-md text-[11px] font-medium ' + badge.cls}>{badge.label}</span>
                  <code className="font-mono text-[12.5px] text-stone-700 dark:text-stone-200 break-all">{c.path.slice(1) || '$（根）'}</code>
                  {c.note && <span className="text-[11.5px] text-stone-400">{c.note}</span>}
                </div>
                {c.type === 'added' && <pre className="mt-1.5 font-mono text-[12px] text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap break-all">+ {shortValue(c.b, 400)}</pre>}
                {c.type === 'removed' && <pre className="mt-1.5 font-mono text-[12px] text-red-700 dark:text-red-300 whitespace-pre-wrap break-all">- {shortValue(c.a, 400)}</pre>}
                {c.type === 'changed' && (
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    <pre className="font-mono text-[12px] text-red-700 dark:text-red-300 whitespace-pre-wrap break-all">- {shortValue(c.a, 400)}</pre>
                    <pre className="font-mono text-[12px] text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap break-all">+ {shortValue(c.b, 400)}</pre>
                  </div>
                )}
              </div>
            )
          }} />
        </div>
      )}
      {!diff && !error && <p className={'mt-3 ' + LBL}>两侧输入 JSON 后自动对比。</p>}
    </div>
  )
}
