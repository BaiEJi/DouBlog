/** Cron 表达式：标准 5 字段解析 + 中文解释 + 未来运行时间 + 常用预设（纯本地计算） */
import { useMemo, useState } from 'react'
import { ToolHead, CopyBtn, StatusLine, LBL, inputCls, card } from '../kit'
import { parseCron, nextRuns, describeCron, FIELD_DEFS } from '../lib/cron'
import { CRON_PRESETS } from '../data'

export default function CronTool() {
  const [expr, setExpr] = useState('30 9 * * 1-5')

  const parsed = useMemo(() => parseCron(expr), [expr])
  const runs = useMemo(() => {
    if (parsed.error) return null
    return nextRuns(parsed, 5)
  }, [parsed])

  const describe = useMemo(() => (parsed.error ? null : describeAll(parsed)), [parsed])

  return (
    <div>
      <ToolHead title="Cron 表达式" desc="标准 5 字段（分 时 日 月 星期）解析、中文解释与未来 5 次运行时间"
        right={<CopyBtn text={expr} label="复制表达式" />} />
      <div className="flex flex-wrap gap-2 items-center">
        <input className={inputCls + ' flex-1 min-w-64 font-mono text-[13.5px]'} value={expr} spellCheck={false}
          onChange={e => setExpr(e.target.value)} placeholder="*/5 * * * * 或 @daily" aria-label="Cron 表达式" />
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {CRON_PRESETS.map(p => (
          <button key={p.value} className={'px-2.5 py-1 rounded-full text-[12px] transition-colors border ' +
            (expr === p.value
              ? 'border-lime-600/40 dark:border-lime-400/40 bg-lime-500/10 text-lime-700 dark:text-lime-400 font-medium'
              : 'border-black/[0.08] dark:border-white/[0.1] text-stone-500 dark:text-stone-400 hover:border-black/20 dark:hover:border-white/25 hover:text-stone-700 dark:hover:text-stone-200')}
            onClick={() => setExpr(p.value)}>{p.name}</button>
        ))}
      </div>
      <div className="mt-3"><StatusLine ok={!parsed.error && !!expr.trim()} err={parsed.error} okText={describe ? describe.summary : '有效'} /></div>
      {describe && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <div className={card + ' p-4'}>
            <p className="text-sm font-semibold mb-3">字段解释</p>
            <div className="space-y-2">
              {describe.fields.map(f => (
                <div key={f.name} className="flex items-baseline gap-3">
                  <span className="w-10 shrink-0 text-xs text-stone-500 dark:text-stone-400">{f.name}</span>
                  <code className="w-16 shrink-0 font-mono text-[12.5px] text-stone-700 dark:text-stone-200">{f.raw}</code>
                  <span className="text-[13px] text-stone-600 dark:text-stone-300">{f.desc}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 pt-3 border-t border-black/[0.05] dark:border-white/[0.06] text-[13px] text-stone-600 dark:text-stone-300">{describe.summary}</p>
          </div>
          <div className={card + ' p-4'}>
            <p className="text-sm font-semibold mb-3">未来运行时间{runs?.exhausted ? '（5 年内不足 5 次）' : ''}</p>
            {runs && runs.times.length ? (
              <ol className="space-y-1.5">
                {runs.times.map((t, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-[13px]">
                    <span className="w-5 text-right tabular-nums text-stone-400">{i + 1}</span>
                    <code className="font-mono text-stone-800 dark:text-stone-100">{t.toLocaleString('zh-CN', { hour12: false })}</code>
                    <span className="text-[11.5px] text-stone-400">{t.toLocaleDateString('zh-CN', { weekday: 'short' })}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="text-[13px] text-stone-400">5 年内没有匹配的运行时间（表达式可能永不存在，如 2 月 30 日）。</p>}
            <p className={'mt-3 ' + LBL}>推算基于本机时区，每分钟步进。</p>
          </div>
        </div>
      )}
    </div>
  )
}

function describeAll(parsed) {
  const fields = parsed.fields.map((f, i) => ({
    name: f.name, raw: f.raw, values: f.values,
    desc: describeFieldZh(f, i),
  }))
  return { fields, summary: describeCron(parsed) }
}

function describeFieldZh(field, idx) {
  const vs = [...field.values].sort((a, b) => a - b)
  const def = FIELD_DEFS[idx]
  const all = vs.length === def.max - def.min + 1
  const list = vs.length > 8 ? `${vs.slice(0, 8).join(',')}…` : vs.join(',')
  if (all) return `全部（${def.min}-${def.max}）`
  if (vs.length > 1 && vs[1] - vs[0] > 1 && vs.every((v, i) => i === 0 || v - vs[i - 1] === vs[1] - vs[0])) {
    return `从 ${vs[0]} 起每 ${vs[1] - vs[0]}（${list}）`
  }
  return list
}
