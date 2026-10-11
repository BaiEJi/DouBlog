/**
 * 订阅模块图表（纯 SVG，无依赖）：面积趋势图（可交互 hover 提示）+ 分类环形饼图。
 * 宽度监听复用日记 StatsView 的三重兜底方案。
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

/**
 * 面积趋势图
 * data: [{ x: 标签, v: 金额, details?: 趋势明细（Tooltip 展示） }]
 * renderTip: 自定义提示内容（接收数据点）
 */
export function AreaTrend({ data, height = 300, color = '#d97706', renderTip }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)   // 索引
  const H = height, PAD_T = 14, PAD_B = 26, PAD_L = 6, PAD_R = 6
  if (!data.length || w <= 0) return <div ref={ref} className="h-[100px] flex items-center justify-center text-[12px] text-stone-400">暂无数据</div>

  const plotW = w - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B
  const max = Math.max(...data.map(d => d.v)) || 1
  const step = plotW / data.length
  const px = i => PAD_L + i * step + step / 2
  const py = v => PAD_T + plotH - (v / max) * (plotH - 6)

  const pts = data.map((d, i) => [px(i), py(d.v)])
  const line = pts.map(p => p.join(',')).join(' ')
  const area = `${PAD_L},${PAD_T + plotH} ${line} ${PAD_L + plotW},${PAD_T + plotH}`
  // x 轴标签抽稀步长：每点像素宽 ≥38 全显、≥19 隔一个、更密则保证约 52px 一个标签
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
        {/* 网格 */}
        {[0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1={PAD_L} x2={w - PAD_R}
            y1={PAD_T + plotH - f * (plotH - 6)} y2={PAD_T + plotH - f * (plotH - 6)}
            className="stroke-black/[0.05] dark:stroke-white/[0.07]" strokeWidth={1} />
        ))}
        {/* 面积 + 折线 */}
        <polygon points={area} fill={color} opacity={0.12} />
        <polyline points={line} fill="none" stroke={color} strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 4.5 : 2.5}
            fill={color} className="transition-all" />
        ))}
        {/* hover 竖线 */}
        {hover != null && (
          <line x1={px(hover)} x2={px(hover)} y1={PAD_T} y2={PAD_T + plotH}
            stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
        )}
        {/* x 轴标签 */}
        {data.map((d, i) => i % labelEvery === 0 && (
          <text key={i} x={px(i)} y={H - 8} textAnchor="middle" className="fill-stone-400" fontSize="9.5">
            {d.x.length > 9 ? d.x.slice(-5) : d.x}
          </text>
        ))}
      </svg>
      {hover != null && renderTip && (
        <div className="absolute top-2 pointer-events-none"
          style={{ left: Math.min(Math.max(px(hover) - 90, 4), Math.max(w - 190, 4)) }}>
          <div className="w-[180px] max-h-[260px] overflow-y-auto rounded-xl border border-black/[0.08] dark:border-white/[0.1] bg-white/95 dark:bg-[#262524]/95 backdrop-blur shadow-lg px-3 py-2.5 text-[11.5px]">
            {renderTip(data[hover])}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 分类环形饼图
 * data: [{ name, value, percentage, color, details }]
 * renderTip: 自定义提示（接收扇区数据）
 */
export function DonutPie({ data, size = 240, thickness = 34, centerLabel, centerValue, renderTip }) {
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
          <div className="text-lg font-semibold tabular-nums">{centerValue}</div>
          <div className="text-[10.5px] text-stone-400 mt-0.5">{centerLabel}</div>
        </div>
      </div>
      {/* 图例 */}
      <div className="mt-3 w-full flex flex-wrap gap-x-4 gap-y-1.5 justify-center max-h-[92px] overflow-y-auto">
        {data.map((d, i) => (
          <span key={i}
            className={'inline-flex items-center gap-1.5 text-[11.5px] cursor-pointer ' +
              (hover === i ? 'text-stone-800 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400')}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
            {d.name}（{d.percentage}%）
          </span>
        ))}
      </div>
      {hover != null && renderTip && (
        <div className="mt-2 w-full max-h-[180px] overflow-y-auto rounded-xl border border-black/[0.08] dark:border-white/[0.1] bg-black/[0.02] dark:bg-white/[0.04] px-3 py-2 text-[11.5px]">
          {renderTip(data[hover])}
        </div>
      )}
    </div>
  )
}
