/* 看板画布基础件：类型 / 人物卡片节点 / 自绘边层 / 防重叠 / FPS 徽标
 * 从 GameWorkspace 拆出（巨石组件重构 #7）。
 * 适配 DouBlog：去 TS 类型（JSX 项目）；画布样式 canvas.css 与 xyflow 样式在此统一引入。 */
import * as React from 'react'
import { createPortal } from 'react-dom'
import * as RF from '@xyflow/react'
import { createGeometryCache } from './geometry'
import '@xyflow/react/dist/style.css'

/* ---------- 类型（JSDoc） ----------
 * ScopeMode: "chapter" | "upto" | "from" | "custom"
 * Density:   "compact" | "standard" | "detailed"
 * DisplayBoard: { merged, anchorChapterId, nodes[{character_id,x,y,chapter_id?}],
 *   relations[{...RelationT, chapter_id?, chapter_title?}], characters[], states[] } */

/* ---------- 人物节点：风格 8 的色块盒子 ----------
 * 节点位置完全自由：无物理引擎、无自动布局，拖动只影响被拖的节点，位置实时保存。
 * 8 个附着点（4 边中点 + 4 角），配合 ConnectionMode.Loose 任意附着点都可起连和落连。
 * 密度三档（#4）：compact 只剩头像+名字；standard 现状；detailed 展开简介不截断。 */
const ANCHORS = [
  { id: 'l', pos: RF.Position.Left, style: { left: -7, top: '50%', transform: 'translateY(-50%)' } },
  { id: 'r', pos: RF.Position.Right, style: { right: -7, top: '50%', transform: 'translateY(-50%)' } },
  { id: 't', pos: RF.Position.Top, style: { top: -7, left: '50%', transform: 'translateX(-50%)' } },
  { id: 'b', pos: RF.Position.Bottom, style: { bottom: -7, left: '50%', transform: 'translateX(-50%)' } },
  // 角点：RF 的 handle-top/bottom 类自带 left:50%，必须显式置 auto，否则 right 失效、
  // 点会被拽到边中点（表现为"正上/正下各两个点，右上/右下消失"）
  { id: 'tl', pos: RF.Position.Top, style: { top: -7, left: -7, right: 'auto', bottom: 'auto', transform: 'none' } },
  { id: 'tr', pos: RF.Position.Top, style: { top: -7, right: -7, left: 'auto', bottom: 'auto', transform: 'none' } },
  { id: 'bl', pos: RF.Position.Bottom, style: { bottom: -7, left: -7, right: 'auto', top: 'auto', transform: 'none' } },
  { id: 'br', pos: RF.Position.Bottom, style: { bottom: -7, right: -7, left: 'auto', top: 'auto', transform: 'none' } },
]

export const CARD_WIDTH = { compact: 150, standard: 208, detailed: 208 }

export const CharacterNode = React.memo(function CharacterNode({ data, selected }) {
  const d = data
  const density = d.density || 'standard'
  const width = CARD_WIDTH[density]
  return (
    <div className="gm8-node" style={{
      position: 'relative',
      background: d.gradient,
      border: selected ? '2px solid #fff' : '1.5px solid rgba(255,255,255,.9)',
      borderRadius: 12,
      padding: density === 'compact' ? '9px 11px 24px' : '12px 14px 28px',
      width,
      color: '#fff',
      cursor: 'grab',
      filter: d.alive === false ? 'grayscale(.82)' : undefined,
      opacity: d.dim ? 0.28 : d.alive === false ? 0.82 : 1,
      transition: 'opacity .18s ease',
      boxShadow: selected
        ? '0 0 0 5px rgba(255,255,255,.22), 0 8px 26px rgba(0,0,0,.55)'
        : '0 5px 16px rgba(0,0,0,.45)',
    }}>
      {ANCHORS.map((a) => (
        <RF.Handle key={a.id} type="source" position={a.pos} id={a.id} className="gm8-handle" style={a.style} />
      ))}
      {d.alive === false && (
        <span title="已死亡" style={{ position: 'absolute', top: -10, right: -8, fontSize: 16, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.6))' }}>💀</span>
      )}
      <div style={{ display: 'flex', gap: density === 'compact' ? 8 : 10, alignItems: 'center' }}>
        <div style={{
          width: density === 'compact' ? 32 : 40, height: density === 'compact' ? 32 : 40, flex: 'none', borderRadius: 999, overflow: 'hidden',
          border: '2px solid rgba(255,255,255,.95)', boxShadow: '0 2px 8px rgba(0,0,0,.35)',
          background: d.miniColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: density === 'compact' ? 14 : 17, fontWeight: 700,
        }}>
          {d.avatar ? <img src={d.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (d.label?.[0] || '?')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div title={d.label} style={{ fontSize: density === 'compact' ? 13 : 14.5, fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 1px 3px rgba(0,0,0,.45)' }}>
            {d.label || '?'}
          </div>
          {density !== 'compact' && (d.alias || d.role) && (
            <div style={{ fontSize: 11, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.92, textShadow: '0 1px 2px rgba(0,0,0,.4)' }}>
              {[d.alias, d.role].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
      </div>
      {density !== 'compact' && (d.status || d.description) && (
        <div style={{ marginTop: 8, fontSize: 10.5, lineHeight: 1.45, opacity: 0.95, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {d.status && (
            <span style={{ alignSelf: 'flex-start', background: 'rgba(0,0,0,.32)', padding: '1px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>⚑ {d.status}</span>
          )}
          {d.description && (
            <span title={d.description} style={{
              overflow: 'hidden', display: '-webkit-box',
              WebkitLineClamp: density === 'detailed' ? 6 : 2, WebkitBoxOrient: 'vertical',
              textShadow: '0 1px 2px rgba(0,0,0,.4)',
            }}>
              {d.description}
            </span>
          )}
        </div>
      )}
      {density !== 'compact' && (
        <span style={{ position: 'absolute', right: 8, bottom: 7, fontSize: 10, background: 'rgba(0,0,0,.32)', borderRadius: 999, padding: '0 7px', lineHeight: '16px' }} title="关系数">
          🔗 {d.relCount ?? 0}
        </span>
      )}
      {d.faction && (
        <span title={`阵营：${d.faction}`} style={{ position: 'absolute', left: 8, bottom: 7, fontSize: 10, background: d.factionColor, borderRadius: 999, padding: '0 8px', lineHeight: '16px', boxShadow: '0 1px 4px rgba(0,0,0,.4)', maxWidth: density === 'compact' ? 92 : 120, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          ⚔ {d.faction}
        </span>
      )}
    </div>
  )
})
export const nodeTypes = { character: CharacterNode }

/** 章节展示标签：标题已含序号语义（如"第一章 · xxx"）时不再叠加"第N章"前缀 */
export function chapterLabel(ch) {
  return /第[0-9一二两三四五六七八九十百]+\s*章/.test(ch.title) ? ch.title : `第${ch.order_index}章 · ${ch.title}`
}

/* ---------- 实时帧率徽标（并入 HUD） ---------- */
export function FpsBadge() {
  const ref = React.useRef(null)
  React.useEffect(() => {
    let raf = 0, last = performance.now(), acc = 0, n = 0
    const loop = (t) => {
      acc += t - last; last = t; n++
      if (acc >= 500) {
        const fps = Math.round((n * 1000) / acc)
        const el = ref.current
        if (el) {
          el.textContent = `${fps} FPS`
          el.style.color = fps >= 55 ? '#52c41a' : fps >= 30 ? '#faad14' : '#ff4d4f'
        }
        acc = 0; n = 0
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <span ref={ref} className="gm8-fps" title="实时渲染帧率（跟随屏幕刷新率）。拖动时明显低于刷新率 = 主线程繁忙"
    style={{ fontFamily: 'Consolas, monospace', fontSize: 11.5, fontWeight: 700, color: '#8b93a8' }}>-- FPS</span>
}

/* ---------- 拖动防重叠 ----------
 * 松手落点钳制：把"被拖卡片"移到与其它卡片不重叠的最近位置（最小穿透轴分离，多卡迭代收敛）。
 * 只移动被拖卡片，其余卡片位置绝不被改动；卡片间保留 DRAG_GAP 间距。
 * 注意：RF v12 拖动管线独占被拖节点位置，拖动过程中的外部写入会被覆盖，因此钳制在松手时执行。 */
const DRAG_GAP = 12

export function clampDragPosition(drag, others) {
  for (let pass = 0; pass < 4; pass++) {
    let moved = false
    for (const o of others) {
      const l = o.x - DRAG_GAP, r = o.x + o.w + DRAG_GAP
      const t = o.y - DRAG_GAP, b = o.y + o.h + DRAG_GAP
      if (drag.x < r && drag.x + drag.w > l && drag.y < b && drag.y + drag.h > t) {
        const pushes = [
          [r - drag.x, 1, 0],           // 右移
          [drag.x + drag.w - l, -1, 0], // 左移
          [b - drag.y, 0, 1],           // 下移
          [drag.y + drag.h - t, 0, -1], // 上移
        ].sort((p, q) => p[0] - q[0])[0]
        drag.x += pushes[1] * pushes[0]
        drag.y += pushes[2] * pushes[0]
        moved = true
      }
    }
    if (!moved) break
  }
  return drag
}

/* ---------- 自绘边覆盖层 ----------
 * React Flow 12.11.6 + React 19 下 EdgeRenderer 存在不可复现的静默不渲染问题，
 * 因此边不再交给 RF 渲染（edges 传空），改由本组件订阅 store 中的节点位置/实测
 * 尺寸/视口变换，用普通 SVG 自绘：确定性 100%，且随拖动/缩放实时更新。 */

const EdgeShape = React.memo(function EdgeShape({ geometry: g, hit, dim, onEdgeClick }) {
  const pointer = React.useRef(null)
  const { edge, type, x1, y1, x2, y2, mx, my, angle, ax, ay, labelW } = g
  const color = type?.color || '#888'
  if (hit) return <path d={`M ${x1} ${y1} L ${x2} ${y2}`} fill="none" stroke="transparent" strokeWidth={14}
    style={{ pointerEvents: dim ? 'none' : 'stroke', cursor: 'pointer' }} onPointerDown={event => { pointer.current = { x: event.clientX, y: event.clientY } }}
    onClick={event => { const start = pointer.current; if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) onEdgeClick(edge.data.relation) }} />
  return <g className="gm8-edge-g" style={{ opacity: dim ? 0.12 : 1, transition: 'opacity .18s ease', pointerEvents: 'none' }}>
    <path d={`M ${x1} ${y1} L ${ax} ${ay}`} fill="none" stroke={color} strokeWidth={2} strokeDasharray={type?.line_style === 'dashed' ? '7 5' : undefined} strokeLinecap="round" />
    {type?.directional && <polygon points={`${x2},${y2} ${x2 - Math.cos(angle - 0.45) * 10},${y2 - Math.sin(angle - 0.45) * 10} ${x2 - Math.cos(angle + 0.45) * 10},${y2 - Math.sin(angle + 0.45) * 10}`} fill={color} />}
    <g transform={`translate(${mx},${my})`}><rect x={-labelW / 2} y={-10} width={labelW} height={20} rx={10} fill={color} /><text textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={11}>{type?.name}</text></g>
  </g>
})
const EdgeShapes = React.memo(function EdgeShapes({ geometries, focusSet, onEdgeClick, hit }) {
  return geometries.map(geometry => <EdgeShape key={geometry.edge.id} {...{geometry,hit,onEdgeClick}} dim={focusSet ? !(focusSet.has(geometry.edge.source) && focusSet.has(geometry.edge.target)) : false} />)
})
function TransformedEdges({ children, hit }) {
  const transform = RF.useStore(state => state.transform)
  const flowRoot = RF.useStore(state => state.domNode)
  const layer = <svg className={hit ? 'gm8-edge-hit-layer' : 'gm8-edge-layer'} style={{ position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',overflow:'visible',zIndex:hit ? 30 : 5 }}>
    <g transform={`translate(${transform[0]},${transform[1]}) scale(${transform[2]})`}>{children}</g>
  </svg>
  const renderer = hit ? flowRoot?.querySelector('.react-flow__renderer') : null
  // Keep native wheel/pan events inside React Flow's ZoomPane while retaining custom edges.
  return renderer ? createPortal(layer, renderer) : layer
}
export function EdgeLayer({ edges, typeMap, onEdgeClick, focusSet }) {
  const nodeList = RF.useStore(state => state.nodes)
  const initialized = RF.useNodesInitialized()
  const store = RF.useStoreApi()
  const [cache] = React.useState(createGeometryCache)
  const geometries = React.useMemo(() => {
    const nodes = new Map()
    store.getState().nodeLookup.forEach((node,id) => nodes.set(id, { x:node.internals.positionAbsolute.x,y:node.internals.positionAbsolute.y,w:node.measured?.width || 208,h:node.measured?.height || 80 }))
    return cache.update(nodes, edges, typeMap)
    // nodeList/initialized invalidate this imperative nodeLookup snapshot on
    // drag and measured-size changes; geometry reads values via nodeLookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeList, initialized, edges, typeMap, store, cache])
  return <><TransformedEdges><EdgeShapes {...{geometries,focusSet,onEdgeClick}} /></TransformedEdges><TransformedEdges hit><EdgeShapes hit {...{geometries,focusSet,onEdgeClick}} /></TransformedEdges></>
}
