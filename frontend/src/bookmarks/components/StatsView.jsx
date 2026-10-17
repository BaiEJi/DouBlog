/**
 * 统计：指标卡（总数/未读/已读/星标/死链/快照字数/回收站）+ 状态分布环形
 * + 近 30 天收录趋势 + 分类 / 标签 / 站点 TOP 横向条。图表复用 todo/charts。
 */
import { useEffect, useState } from 'react'

import { statsOverview, statusMeta } from '../api'
import { Card, Empty, Spinner, StatTile } from '../../todo/kit'
import { adjustForDark } from '../../todo/kit'
import { DonutPie } from '../../todo/charts'

const STATUS_COLORS = { unread: '#f97316', reading: '#3b82f6', read: '#10b981', archived: '#a8a29e' }

function HBar({ label, value, max, color, dark, suffix }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  const bg = dark ? adjustForDark(color) : color
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[12.5px] font-medium truncate">{label}</span>
        <span className="text-[11.5px] text-stone-400 tabular-nums shrink-0">{value}{suffix || ''}</span>
      </div>
      <div className="h-1.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: bg }} />
      </div>
    </div>
  )
}

/** 近 30 天趋势：纯 div 柱状（单序列，不必动用 DualLine） */
function TrendBars({ data, dark }) {
  const max = Math.max(1, ...data.map(d => d.count))
  const color = dark ? adjustForDark('#f97316') : '#f97316'
  return (
    <div className="flex items-end gap-[3px] h-32">
      {data.map(d => (
        <div key={d.date} className="flex-1 group relative" title={`${d.date}：收录 ${d.count} 条`}>
          <div className="w-full rounded-t-[3px] transition-all"
            style={{ height: Math.max(2, (d.count / max) * 118), background: d.count ? color : 'rgba(120,113,108,0.18)' }} />
        </div>
      ))}
    </div>
  )
}

export default function StatsView({ toast, dark, refreshSignal }) {
  const [s, setS] = useState(null)
  useEffect(() => {
    statsOverview().then(setS).catch(e => toast(e.message, 'err'))
  }, [refreshSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return <Spinner />

  const donut = Object.entries(s.by_status || {}).map(([k, v]) => ({
    name: statusMeta(k).label, value: v,
    color: dark ? adjustForDark(STATUS_COLORS[k] || '#a8a29e') : (STATUS_COLORS[k] || '#a8a29e'),
  })).filter(d => d.value > 0)
  const readRate = s.total ? Math.round(((s.by_status?.read || 0) / s.total) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-7 gap-3">
        <StatTile title="总书签" value={s.total} />
        <StatTile title="待读" value={s.by_status?.unread || 0} tone="text-orange-600 dark:text-orange-400" />
        <StatTile title="已读" value={s.by_status?.read || 0} tone="text-emerald-600 dark:text-emerald-400" />
        <StatTile title="已读率" value={readRate} suffix="%" />
        <StatTile title="星标" value={s.starred} tone="text-amber-600 dark:text-amber-400" />
        <StatTile title="疑似死链" value={s.dead} tone={s.dead ? 'text-red-600 dark:text-red-400' : ''} />
        <StatTile title="快照字数" value={s.snapshot_words?.toLocaleString?.() || s.snapshot_words} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="状态分布">
          {donut.length ? (
            <div className="flex items-center justify-center gap-6 flex-wrap">
              <DonutPie data={donut} centerLabel="总数" centerValue={s.total} />
              <div className="space-y-2">
                {donut.map(d => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                    <span className="text-stone-500 dark:text-stone-400">{d.name}</span>
                    <span className="font-semibold tabular-nums">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <Empty text="暂无数据" />}
        </Card>

        <Card title="近 30 天收录">
          <TrendBars data={s.trend || []} dark={dark} />
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card title="分类分布">
          {(s.by_category || []).length ? (
            <div className="space-y-3">
              {s.by_category.slice(0, 8).map(c => (
                <HBar key={c.id || 'none'} label={c.name} value={c.value}
                  max={Math.max(...s.by_category.map(x => x.value))}
                  color={c.id ? '#f97316' : '#a8a29e'} dark={dark} suffix=" 条" />
              ))}
            </div>
          ) : <Empty text="暂无分类数据" />}
        </Card>
        <Card title="标签 TOP">
          {(s.by_tag || []).length ? (
            <div className="space-y-3">
              {s.by_tag.slice(0, 8).map(t => (
                <HBar key={t.id} label={t.name} value={t.value}
                  max={Math.max(...s.by_tag.map(x => x.value))}
                  color={t.color || '#6366f1'} dark={dark} suffix=" 条" />
              ))}
            </div>
          ) : <Empty text="暂无标签数据" />}
        </Card>
        <Card title="站点 TOP">
          {(s.domains || []).length ? (
            <div className="space-y-3">
              {s.domains.slice(0, 8).map(d => (
                <HBar key={d.name} label={d.name} value={d.value}
                  max={Math.max(...s.domains.map(x => x.value))}
                  color="#0ea5e9" dark={dark} suffix=" 条" />
              ))}
            </div>
          ) : <Empty text="暂无站点数据" />}
        </Card>
      </div>
    </div>
  )
}
