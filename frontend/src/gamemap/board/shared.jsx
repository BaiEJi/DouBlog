/* 看板画布基础件：类型 / 人物卡片节点 / 自绘边层 / 防重叠 / FPS 徽标
 * 从 GameWorkspace 拆出（巨石组件重构 #7）。
 * 适配 DouBlog：去 TS 类型（JSX 项目）；画布样式 canvas.css 与 xyflow 样式在此统一引入。 */
import * as React from 'react'
import * as RF from '@xyflow/react'
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

/** 求中心连线与节点矩形的交点（返回靠近中心的边界点） */
function rectBoundaryPoint(cx, cy, w, h, tx, ty) {
  const dx = tx - cx, dy = ty - cy
  if (dx === 0 && dy === 0) return [cx, cy - h / 2]
  const scaleX = (w / 2 + 8) / Math.abs(dx || 1e-9)
  const scaleY = (h / 2 + 8) / Math.abs(dy || 1e-9)
  const t = Math.min(scaleX, scaleY)
  return [cx + dx * t, cy + dy * t]
}

/** edges: [{id, source, target, data:{relation}}]；typeMap: Map<id, RelationType>；
 *  focusSet: 聚焦时仅高亮圈内边（Set<"c-<id>">），其余淡出 */
export function EdgeLayer({ edges, typeMap, onEdgeClick, focusSet }) {
  // 整店订阅（恒等选择器）：任何节点位置/视口变化都会重渲染。
  // 注意不能用返回新对象的选择器——快照不稳定会导致永不更新。
  const store = RF.useStore((s) => s)
  const transform = store.transform
  const nodesInfo = {}
  store.nodeLookup.forEach((n, id) => {
    nodesInfo[id] = {
      x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y,
      w: n.measured?.width || 208, h: n.measured?.height || 80,
    }
  })
  const zoom = transform[2]
  // 绘制层（zIndex 5，位于节点之下）：穿越第三方卡片的连线不再遮挡卡片文字
  const drawing = (
    <svg className="gm8-edge-layer" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex: 5 }}>
      <g transform={`translate(${transform[0]},${transform[1]}) scale(${zoom})`}>
        {edges.map((e) => {
          const a = nodesInfo[e.source], b = nodesInfo[e.target]
          if (!a || !b) return null
          const acx = a.x + a.w / 2, acy = a.y + a.h / 2
          const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2
          const [x1, y1] = rectBoundaryPoint(acx, acy, a.w, a.h, bcx, bcy)
          const [x2, y2] = rectBoundaryPoint(bcx, bcy, b.w, b.h, acx, acy)
          const t = typeMap.get(e.data.relation.relation_type_id)
          const color = t?.color || '#888'
          const dashed = t?.line_style === 'dashed'
          const dim = focusSet ? !(focusSet.has(e.source) && focusSet.has(e.target)) : false
          // 标签位置：默认边中点；标签外接矩形与任一节点矩形（膨胀 4px）相交则沿线段滑动避让
          const labelW = String(t?.name || '').length * 6 + 14, labelH = 20
          const hitsNode = (lx, ly) =>
            Object.values(nodesInfo).some((n) =>
              lx + labelW / 2 > n.x - 4 && lx - labelW / 2 < n.x + n.w + 4 &&
              ly + labelH / 2 > n.y - 4 && ly - labelH / 2 < n.y + n.h + 4)
          let mt = 0.5
          for (const cand of [0.5, 0.36, 0.64, 0.28, 0.72, 0.2, 0.8, 0.12, 0.88, 0.06, 0.94]) {
            const lx = x1 + (x2 - x1) * cand, ly = y1 + (y2 - y1) * cand
            if (!hitsNode(lx, ly)) { mt = cand; break }
          }
          const mx = x1 + (x2 - x1) * mt, my = y1 + (y2 - y1) * mt
          const angle = Math.atan2(y2 - y1, x2 - x1)
          const ax = x2 - Math.cos(angle) * 10, ay = y2 - Math.sin(angle) * 10 // 箭头尖端前留空
          return (
            <g key={e.id} className="gm8-edge-g" style={{ opacity: dim ? 0.12 : 1, transition: 'opacity .18s ease', pointerEvents: 'none' }}>
              <path d={`M ${x1} ${y1} L ${x2} ${y2}`} fill="none" stroke="transparent" strokeWidth={14} style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                onClick={() => onEdgeClick(e.data.relation)} />
              <path d={`M ${x1} ${y1} L ${ax} ${ay}`} fill="none" stroke={color} strokeWidth={2}
                strokeDasharray={dashed ? '7 5' : undefined} strokeLinecap="round" />
              {t?.directional && (
                <polygon
                  points={`${x2},${y2} ${x2 - Math.cos(angle - 0.45) * 10},${y2 - Math.sin(angle - 0.45) * 10} ${x2 - Math.cos(angle + 0.45) * 10},${y2 - Math.sin(angle + 0.45) * 10}`}
                  fill={color} />
              )}
              <g transform={`translate(${mx},${my})`}>
                <rect x={-(String(t?.name || '').length * 6 + 14 + (e.data.relation.description ? 12 : 0)) / 2} y={-10}
                  width={String(t?.name || '').length * 6 + 14 + (e.data.relation.description ? 12 : 0)} height={20} rx={10} fill={color} />
                <text textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={11}>
                  {t?.name}
                </text>
              </g>
            </g>
          )
        })}
      </g>
    </svg>
  )
  // 命中层（zIndex 30，节点之上）：仅透明宽线接收点击，不绘制任何可见内容
  const hitLayer = (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex: 30 }}>
      <g transform={`translate(${transform[0]},${transform[1]}) scale(${zoom})`}>
        {edges.map((e) => {
          const a = nodesInfo[e.source], b = nodesInfo[e.target]
          if (!a || !b) return null
          const acx = a.x + a.w / 2, acy = a.y + a.h / 2
          const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2
          const [x1, y1] = rectBoundaryPoint(acx, acy, a.w, a.h, bcx, bcy)
          const [x2, y2] = rectBoundaryPoint(bcx, bcy, b.w, b.h, acx, acy)
          const dim = focusSet ? !(focusSet.has(e.source) && focusSet.has(e.target)) : false
          return (
            <path key={`h-${e.id}`} d={`M ${x1} ${y1} L ${x2} ${y2}`} fill="none" stroke="transparent" strokeWidth={14}
              style={{ pointerEvents: dim ? 'none' : 'stroke', cursor: 'pointer' }}
              onClick={() => onEdgeClick(e.data.relation)} />
          )
        })}
      </g>
    </svg>
  )
  return (
    <>
      {drawing}
      {hitLayer}
    </>
  )
}
