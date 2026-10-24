// Frozen pre-optimization EdgeLayer, used only by the comparison harness.
import * as RF from '@xyflow/react'
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
