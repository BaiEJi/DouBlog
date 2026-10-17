/**
 * 统计：指标卡（总题数/已解/复习中/已掌握）+ 难度分布环形 + 来源分布环形 + 语言分布横向条
 * + 近 30 天做题趋势双线 + 标签掌握度横向堆叠条（已解/总数）+ 复习完成率卡片。
 * 图表复用 todo/charts.jsx（DualLine / DonutPie），颜色暗色下经 kit.adjustForDark 提亮。
 */
import { useEffect, useMemo, useState } from 'react'

import { statsOverview, DIFFICULTIES, SOURCES, langMeta } from '../api'
import { DualLine, DonutPie } from '../../todo/charts'
import { Card, Empty, Spinner, StatTile } from '../../todo/kit'
import { adjustForDark } from '../../todo/kit'

const SOURCE_COLORS = {
  leetcode: '#6366f1', luogu: '#0ea5e9', nowcoder: '#14b8a6', sword: '#f97316', other: '#a8a29e',
}
const LANG_COLOR = '#818cf8'

/** 分布对象（{键: 数}）或数组（[{name,value}]）→ 图表 data（value 全 0 时返回 [] 走空态） */
function distData(raw, labels, colors, dark) {
  if (!raw) return []
  const entries = Array.isArray(raw)
    ? raw.map(d => [d.source || d.language || d.key || d.name, d.value ?? d.count ?? 0])
    : Object.entries(raw)
  return entries
    .map(([k, v]) => ({
      name: labels[k] || k,
      value: Number(v) || 0,
      color: dark ? adjustForDark(colors[k] || '#a8a29e') : (colors[k] || '#a8a29e'),
    }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value)
}

/** 横向条（语言分布） */
function HBar({ label, value, max, dark, color }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  const bg = dark ? adjustForDark(color) : color
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12.5px] font-medium truncate">{label}</span>
        <span className="text-[11.5px] text-stone-400 tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: bg }} />
      </div>
    </div>
  )
}

/** 标签掌握度堆叠条（已解 / 总数） */
function MasteryBar({ tag, dark }) {
  const total = tag.total ?? 0
  const solved = Math.min(tag.solved ?? 0, total)
  const pct = total > 0 ? Math.round((solved / total) * 100) : 0
  const color = dark ? adjustForDark(tag.color || '#6366f1') : (tag.color || '#6366f1')
  const solvedPct = total > 0 ? (solved / total) * 100 : 0
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12.5px] font-medium truncate flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
          {tag.name}
        </span>
        <span className="text-[11.5px] text-stone-400 tabular-nums">{solved}/{total} · {pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-black/[0.05] dark:bg-white/[0.08] overflow-hidden flex">
        <div className="h-full transition-all" style={{ width: `${solvedPct}%`, background: color }} />
      </div>
    </div>
  )
}

export default function StatsPanel({ toast, dark }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    statsOverview()
      .then(res => { if (alive) setData(res || {}) })
      .catch(err => { if (alive) toast(err instanceof Error ? err.message : '加载统计数据失败', 'error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const diffData = useMemo(() => {
    const raw = data?.difficulty || {}
    const entries = Array.isArray(raw)
      ? raw.map(d => [d.difficulty ?? d.key, d.value ?? d.count ?? 0])
      : Object.entries(raw)
    const byVal = {}
    entries.forEach(([k, v]) => { byVal[Number(k)] = Number(v) || 0 })
    return DIFFICULTIES.map(d => ({
      name: d.label, value: byVal[d.value] || 0,
      color: dark ? adjustForDark(d.color) : d.color,
    })).filter(d => d.value > 0)
  }, [data, dark])

  const sourceData = useMemo(
    () => distData(data?.source, Object.fromEntries(SOURCES.map(s => [s.value, s.label])), SOURCE_COLORS, dark),
    [data, dark])

  const langRows = useMemo(() => {
    const raw = data?.language || {}
    const entries = Array.isArray(raw)
      ? raw.map(d => [d.language || d.key || d.name, d.value ?? d.count ?? 0])
      : Object.entries(raw)
    return entries
      .map(([k, v]) => ({ label: langMeta(k).label, value: Number(v) || 0 }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [data])

  const trendData = useMemo(
    () => (data?.trend || []).map(d => ({
      x: String(d.date || '').slice(5), xFull: d.date,
      a: Number(d.created) || 0, b: Number(d.solved) || 0,
    })),
    [data])

  const tagRows = useMemo(
    () => (data?.tags || [])
      .map(t => ({ ...t, total: Number(t.total) || 0, solved: Number(t.solved) || 0 }))
      .filter(t => t.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10),
    [data])

  if (loading) return <Spinner text="加载统计数据…" />

  const total = data?.total ?? 0
  if (total === 0) {
    return <Empty text="还没有刷题数据，去题库添加第一道题吧" />
  }

  const review = data?.review || {}
  const rCompleted = review.completed ?? review.done ?? 0
  const rTotal = review.total ?? 0
  const rRate = review.rate != null
    ? (review.rate <= 1 ? Math.round(review.rate * 100) : Math.round(review.rate))
    : (rTotal ? Math.round((rCompleted / rTotal) * 100) : 0)

  const langMax = Math.max(1, ...langRows.map(r => r.value))

  return (
    <div className="space-y-4">
      {/* ── 指标卡 ── */}
      <div className="grid grid-cols-4 gap-3">
        <StatTile title="总题数" value={total} suffix="题" />
        <StatTile title="已解" value={data?.solved ?? 0} suffix="题" tone="text-emerald-600 dark:text-emerald-400" />
        <StatTile title="复习中" value={data?.reviewing ?? 0} suffix="题" tone="text-indigo-600 dark:text-indigo-400" />
        <StatTile title="已掌握" value={data?.mastered ?? 0} suffix="题" tone="text-violet-600 dark:text-violet-400" />
      </div>

      {/* ── 难度 / 来源分布 ── */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="难度分布">
          <DonutPie data={diffData} centerLabel="总题数" centerValue={total} />
        </Card>
        <Card title="来源分布">
          <DonutPie data={sourceData} centerLabel="总题数" centerValue={total} />
        </Card>
      </div>

      {/* ── 语言分布 + 复习完成率 ── */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="语言分布">
          {langRows.length === 0
            ? <Empty text="还没有代码记录" />
            : <div className="space-y-3">{langRows.map(r => (
              <HBar key={r.label} label={r.label} value={r.value} max={langMax} dark={dark} color={LANG_COLOR} />
            ))}</div>}
        </Card>
        <Card title="复习完成率">
          <div className="flex items-center gap-5">
            <div className="flex-1">
              <div className="text-3xl font-semibold tabular-nums">{rRate}<span className="text-sm font-normal text-stone-400 ml-1">%</span></div>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-1.5 leading-relaxed">
                已完成 {rCompleted} / 计划 {rTotal} 次复习打卡
              </p>
              <div className="mt-3 h-1.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] overflow-hidden">
                <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.min(rRate, 100)}%` }} />
              </div>
              {review.due_today != null && (
                <p className="mt-2.5 text-[11.5px] text-stone-400">
                  今日待复习 {review.due_today} 题
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* ── 近 30 天趋势 ── */}
      <Card title="近 30 天做题趋势">
        <DualLine data={trendData}
          a={{ label: '新增', color: '#a8a29e' }}
          b={{ label: '求解', color: dark ? adjustForDark('#6366f1') : '#6366f1' }}
          height={240} />
      </Card>

      {/* ── 标签掌握度 ── */}
      <Card title="标签掌握度（已解 / 总数）">
        {tagRows.length === 0
          ? <Empty text="还没有带标签的题目" />
          : <div className="space-y-3">{tagRows.map(t => (
            <MasteryBar key={t.id || t.name} tag={t} dark={dark} />
          ))}</div>}
      </Card>
    </div>
  )
}
