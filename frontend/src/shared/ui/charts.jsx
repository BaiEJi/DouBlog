/**
 * 共享图表（纯 SVG，无 recharts）：双线趋势 / 分组柱图 / 环形饼图。
 * 宽度监听沿用 subs/charts.jsx 的三重兜底方案。
 */
import { useEffect, useRef, useState } from 'react'

export function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setW(Math.round(el.getBoundingClientRect().width))
    measure()
    window.addEventListener('resize', measure)
    let ro
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure)
      ro.observe(el)
    }
    return () => { window.removeEventListener('resize', measure); ro?.disconnect() }
  }, [])
  return [ref, w]
}

const gridLine = 'stroke-black/[0.05] dark:stroke-white/[0.07]'

/**
 * 双序列折线趋势图
 * data: [{ x: 标签, a: 数值1, b: 数值2 }]
 * a/b: { label, color }
 */
export function DualLine({ data, a, b, height = 240 }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const H = height, PAD_T = 12, PAD_B = 24, PAD_L = 6, PAD_R = 6
  if (!data.length || w <= 0) return <div ref={ref} className="h-[100px] flex items-center justify-center text-[12px] text-stone-400">暂无数据</div>

  const plotW = w - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B
  const max = Math.max(1, ...data.map(d => Math.max(d.a, d.b)))
  const step = plotW / data.length
  const px = i => PAD_L + i * step + step / 2
  const py = v => PAD_T + plotH - (v / max) * (plotH - 6)
  const lineOf = key => data.map((d, i) => `${px(i)},${py(d[key])}`).join(' ')
  const labelEvery = step >= 38 ? 1 : step >= 19 ? 2 : Math.ceil(52 / step)

  return (
    <div ref={ref} className="relative">
      <svg width={w} height={H}
        onMouseLeave={() => setHover(null)}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - rect.left - PAD_L
          const idx = Math.floor(x / step)
          setHover(idx >= 0 && idx < data.length ? idx : null)
        }}>
        {[0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1={PAD_L} x2={w - PAD_R}
            y1={PAD_T + plotH - f * (plotH - 6)} y2={PAD_T + plotH - f * (plotH - 6)}
            className={gridLine} strokeWidth={1} />
        ))}
        {(['a', 'b']).map(key => (
          <polyline key={key} points={lineOf(key)} fill="none"
            stroke={key === 'a' ? a.color : b.color} strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hover != null && (
          <line x1={px(hover)} x2={px(hover)} y1={PAD_T} y2={PAD_T + plotH}
            stroke="#a8a29e" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
        )}
        {data.map((d, i) => (
          <circle key={i} cx={px(i)} cy={py(d.a)} r={hover === i ? 4 : 2.2}
            fill={a.color} className="transition-all" />
        ))}
        {data.map((d, i) => (
          <circle key={'b' + i} cx={px(i)} cy={py(d.b)} r={hover === i ? 4 : 2.2}
            fill={b.color} className="transition-all" />
        ))}
        {data.map((d, i) => i % labelEvery === 0 && (
          <text key={i} x={px(i)} y={H - 7} textAnchor="middle" className="fill-stone-400" fontSize="9.5">
            {d.x.length > 9 ? d.x.slice(-5) : d.x}
          </text>
        ))}
      </svg>
      <div className="flex items-center gap-4 justify-center mt-1 text-[11px] text-stone-500 dark:text-stone-400">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-[2.5px] rounded-full" style={{ background: a.color }} />{a.label}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-[2.5px] rounded-full" style={{ background: b.color }} />{b.label}</span>
      </div>
      {hover != null && (
        <div className="absolute top-2 pointer-events-none rounded-xl border border-black/[0.08] dark:border-white/[0.1] bg-white/95 dark:bg-[#262524]/95 backdrop-blur shadow-lg px-3 py-2 text-[11.5px]"
          style={{ left: Math.min(Math.max(px(hover) - 70, 4), Math.max(w - 150, 4)) }}>
          <div className="text-stone-400 tabular-nums mb-1">{data[hover].xFull || data[hover].x}</div>
          <div className="flex items-center gap-1.5 tabular-nums"><span className="w-2 h-2 rounded-full" style={{ background: a.color }} />{a.label} {data[hover].a}</div>
          <div className="flex items-center gap-1.5 tabular-nums mt-0.5"><span className="w-2 h-2 rounded-full" style={{ background: b.color }} />{b.label} {data[hover].b}</div>
        </div>
      )}
    </div>
  )
}

/**
 * 分组柱状图（回顾页：创建 vs 完成）
 * data: [{ x: 标签, a, b }]；a/b: { label, color }
 */
export function GroupedBars({ data, a, b, height = 190 }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const H = height, PAD_T = 10, PAD_B = 24, PAD_L = 6, PAD_R = 6
  if (!data.length || w <= 0) return <div ref={ref} className="h-[100px] flex items-center justify-center text-[12px] text-stone-400">暂无数据</div>

  const plotW = w - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B
  const max = Math.max(1, ...data.map(d => Math.max(d.a, d.b)))
  const step = plotW / data.length
  const barW = Math.min(12, step / 3)
  const px = i => PAD_L + i * step + step / 2
  const py = v => PAD_T + plotH - (v / max) * (plotH - 4)
  const labelEvery = step >= 38 ? 1 : step >= 19 ? 2 : Math.ceil(52 / step)

  return (
    <div ref={ref} className="relative">
      <svg width={w} height={H} onMouseLeave={() => setHover(null)}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const idx = Math.floor((e.clientX - rect.left - PAD_L) / step)
          setHover(idx >= 0 && idx < data.length ? idx : null)
        }}>
        {[0.5, 1].map(f => (
          <line key={f} x1={PAD_L} x2={w - PAD_R}
            y1={PAD_T + plotH - f * (plotH - 4)} y2={PAD_T + plotH - f * (plotH - 4)}
            className={gridLine} strokeWidth={1} />
        ))}
        {data.map((d, i) => (
          <g key={i} opacity={hover == null || hover === i ? 1 : 0.45} className="transition-opacity">
            <rect x={px(i) - barW - 1} y={py(d.a)} width={barW} height={Math.max(1, PAD_T + plotH - py(d.a))}
              rx={2.5} fill={a.color} />
            <rect x={px(i) + 1} y={py(d.b)} width={barW} height={Math.max(1, PAD_T + plotH - py(d.b))}
              rx={2.5} fill={b.color} />
          </g>
        ))}
        {data.map((d, i) => i % labelEvery === 0 && (
          <text key={i} x={px(i)} y={H - 7} textAnchor="middle" className="fill-stone-400" fontSize="9.5">
            {d.x.length > 9 ? d.x.slice(-5) : d.x}
          </text>
        ))}
      </svg>
      <div className="flex items-center gap-4 justify-center mt-1 text-[11px] text-stone-500 dark:text-stone-400">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: a.color }} />{a.label}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: b.color }} />{b.label}</span>
      </div>
    </div>
  )
}

/**
 * 环形饼图（类别完成占比）
 * data: [{ name, value, color }]；返回含图例与中心数字
 */
export function DonutPie({ data, size = 220, thickness = 30, centerLabel, centerValue }) {
  const [hover, setHover] = useState(null)
  if (!data.length) return <div className="h-[140px] flex items-center justify-center text-[12px] text-stone-400">暂无数据</div>
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const R = size / 2, r = R - thickness
  let angle = -Math.PI / 2
  const arcs = data.map((d, i) => {
    const sweep = (d.value / total) * Math.PI * 2
    const a0 = angle, a1 = angle + sweep
    angle = a1
    const grow = hover === i ? 3 : 0
    const big = sweep > Math.PI ? 1 : 0
    const outer = R - 1 + grow
    const p = [
      `M ${R + outer * Math.cos(a0)} ${R + outer * Math.sin(a0)}`,
      `A ${outer} ${outer} 0 ${big} 1 ${R + outer * Math.cos(a1)} ${R + outer * Math.sin(a1)}`,
      `L ${R + r * Math.cos(a1)} ${R + r * Math.sin(a1)}`,
      `A ${r} ${r} 0 ${big} 0 ${R + r * Math.cos(a0)} ${R + r * Math.sin(a0)}`,
      'Z',
    ].join(' ')
    return { path: p, d, i }
  })
  const pct = v => Math.round((v / total) * 100)
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width={size} height={size}>
          {arcs.map(({ path, d, i }) => (
            <path key={i} d={path} fill={d.color} opacity={hover == null || hover === i ? 1 : 0.35}
              className="transition-all cursor-pointer"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-lg font-semibold tabular-nums">{hover != null ? `${data[hover].value}` : centerValue}</div>
          <div className="text-[10.5px] text-stone-400 mt-0.5">{hover != null ? data[hover].name : centerLabel}</div>
        </div>
      </div>
      <div className="mt-3 w-full flex flex-wrap gap-x-4 gap-y-1.5 justify-center max-h-[92px] overflow-y-auto">
        {data.map((d, i) => (
          <span key={i}
            className={'inline-flex items-center gap-1.5 text-[11.5px] cursor-pointer ' +
              (hover === i ? 'text-stone-800 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400')}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
            {d.name}（{pct(d.value)}%）
          </span>
        ))}
      </div>
    </div>
  )
}
