/**
 * 统计视图：总量卡片 + 30 天使用趋势（CSS 柱图）+ 分类分布 + 最常用 / 最近使用。
 */
import { useEffect, useState } from 'react'
import { assetsStats } from '../api'
import { KIND_META } from '../kit'

function StatCard({ label, value, hint }) {
  return (
    <div className="px-4 py-3.5 rounded-2xl border border-black/[0.07] dark:border-white/[0.09] bg-white dark:bg-white/[0.025]">
      <div className="text-[22px] font-semibold tabular-nums leading-none">{value}</div>
      <div className="mt-1.5 text-[12px] text-stone-500">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-stone-400">{hint}</div>}
    </div>
  )
}

export default function StatsView({ onOpenItem, toast }) {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    assetsStats().then(r => {
      if (r.success) setStats(r.data)
      else toast(r.message || '统计加载失败', 'error')
    })
  }, [toast])

  if (!stats) return <p className="text-[13px] text-stone-400 py-10 text-center">统计加载中…</p>

  const t = stats.totals
  const trendMax = Math.max(1, ...stats.usage_trend.map(d => d.count))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Prompt" value={t.prompts} />
        <StatCard label="Skill" value={t.skills} />
        <StatCard label="收藏" value={t.favorites} />
        <StatCard label="标签" value={t.tags} />
        <StatCard label="版本快照" value={t.versions} />
        <StatCard label="累计使用" value={t.total_usage} hint={`归档 ${t.archived} · 回收站 ${t.trash}`} />
      </div>

      <section>
        <h3 className="text-[13.5px] font-semibold mb-3">近 30 天使用趋势</h3>
        <div className="px-4 py-4 rounded-2xl border border-black/[0.07] dark:border-white/[0.09] bg-white dark:bg-white/[0.025]">
          <div className="flex items-end gap-[3px] h-28" role="img" aria-label="近30天使用趋势柱状图">
            {stats.usage_trend.map(d => (
              <div key={d.date} className="flex-1 h-full flex items-end group relative"
                title={`${d.date} · ${d.count} 次`}>
                <div className="w-full rounded-t-[3px] bg-fuchsia-500/60 dark:bg-fuchsia-400/50 group-hover:bg-fuchsia-600 transition-colors"
                  style={{ height: `${Math.max(d.count ? 6 : 2, (d.count / trendMax) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-[10.5px] text-stone-400 tabular-nums">
            <span>{stats.usage_trend[0]?.date.slice(5)}</span>
            <span>今天</span>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section>
          <h3 className="text-[13.5px] font-semibold mb-3">分类分布</h3>
          <div className="px-4 py-3 rounded-2xl border border-black/[0.07] dark:border-white/[0.09] bg-white dark:bg-white/[0.025] divide-y divide-black/[0.05] dark:divide-white/[0.06]">
            {stats.by_category.filter(c => c.count > 0).map(c => {
              const pct = t.prompts + t.skills ? Math.round(c.count / (t.prompts + t.skills) * 100) : 0
              return (
                <div key={c.name} className="flex items-center gap-3 py-2.5">
                  <span className="w-5 text-center">{c.icon || '·'}</span>
                  <span className="w-24 truncate text-[13px]">{c.name}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-black/[0.05] dark:bg-white/[0.07] overflow-hidden">
                    <div className="h-full rounded-full bg-fuchsia-500/70 dark:bg-fuchsia-400/60" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[11.5px] text-stone-400 tabular-nums w-24 text-right">
                    {c.count} 项（P{c.prompt_count}/S{c.skill_count}）
                  </span>
                </div>
              )
            })}
            {stats.by_category.every(c => c.count === 0) && (
              <p className="py-4 text-[12.5px] text-stone-400">暂无资产</p>
            )}
          </div>
        </section>

        <div className="space-y-6">
          <section>
            <h3 className="text-[13.5px] font-semibold mb-3">最常用 TOP5</h3>
            <div className="px-4 py-2.5 rounded-2xl border border-black/[0.07] dark:border-white/[0.09] bg-white dark:bg-white/[0.025] divide-y divide-black/[0.05] dark:divide-white/[0.06]">
              {stats.top_used.length === 0 && <p className="py-3 text-[12.5px] text-stone-400">还没有使用记录</p>}
              {stats.top_used.map((i, idx) => (
                <button key={i.id} type="button" onClick={() => onOpenItem(i.id)}
                  className="w-full flex items-center gap-3 py-2.5 text-left hover:opacity-80 transition-opacity">
                  <span className="w-4 text-[12px] text-stone-400 tabular-nums">{idx + 1}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10.5px] ${KIND_META[i.kind]?.chip}`}>{KIND_META[i.kind]?.label}</span>
                  <span className="flex-1 min-w-0 truncate text-[13px]">{i.title}</span>
                  <span className="text-[11.5px] text-stone-400 tabular-nums">{i.usage_count} 次</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-[13.5px] font-semibold mb-3">最近使用</h3>
            <div className="px-4 py-2.5 rounded-2xl border border-black/[0.07] dark:border-white/[0.09] bg-white dark:bg-white/[0.025] divide-y divide-black/[0.05] dark:divide-white/[0.06]">
              {stats.recent_used.length === 0 && <p className="py-3 text-[12.5px] text-stone-400">暂无记录</p>}
              {stats.recent_used.map(i => (
                <button key={i.id} type="button" onClick={() => onOpenItem(i.id)}
                  className="w-full flex items-center gap-3 py-2.5 text-left hover:opacity-80 transition-opacity">
                  <span className={`px-1.5 py-0.5 rounded text-[10.5px] ${KIND_META[i.kind]?.chip}`}>{KIND_META[i.kind]?.label}</span>
                  <span className="flex-1 min-w-0 truncate text-[13px]">{i.title}</span>
                  <span className="text-[11.5px] text-stone-400">{(i.last_used_at || '').replace('T', ' ').slice(5, 16)}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
