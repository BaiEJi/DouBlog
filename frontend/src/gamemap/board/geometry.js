const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
const inflate = (rect, padding) => ({ x: rect.x - padding, y: rect.y - padding, w: rect.w + padding * 2, h: rect.h + padding * 2 })
const sameRect = (a, b) => a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
class SpatialGrid {
  constructor(size = 256) { this.size = size; this.cells = new Map(); this.entries = new Map() }
  keys(rect) {
    const keys = []
    for (let x = Math.floor(rect.x / this.size); x <= Math.floor((rect.x + rect.w) / this.size); x++)
      for (let y = Math.floor(rect.y / this.size); y <= Math.floor((rect.y + rect.h) / this.size); y++) keys.push(`${x},${y}`)
    return keys
  }
  remove(id) {
    const old = this.entries.get(id)
    if (!old) return
    for (const key of old.keys) { const bucket = this.cells.get(key); bucket?.delete(id); if (!bucket?.size) this.cells.delete(key) }
    this.entries.delete(id)
  }
  put(id, rect) {
    this.remove(id); const keys = this.keys(rect); this.entries.set(id, { keys, rect })
    for (const key of keys) { if (!this.cells.has(key)) this.cells.set(key, new Set()); this.cells.get(key).add(id) }
  }
  query(rect) {
    const ids = new Set()
    for (const key of this.keys(rect)) for (const id of this.cells.get(key) || []) if (intersects(this.entries.get(id).rect, rect)) ids.add(id)
    return ids
  }
}
export function rectBoundaryPoint(cx, cy, w, h, tx, ty) {
  const dx = tx - cx, dy = ty - cy
  if (!dx && !dy) return [cx, cy - h / 2]
  const t = Math.min((w / 2 + 8) / Math.abs(dx || 1e-9), (h / 2 + 8) / Math.abs(dy || 1e-9))
  return [cx + dx * t, cy + dy * t]
}
export function createGeometryCache() {
  const nodes = new Map(), cache = new Map(), adjacency = new Map(), nodesGrid = new SpatialGrid(), labelsGrid = new SpatialGrid()
  let previousEdges, previousTypes, calculations = 0
  return {
    update(nextNodes, edges, types) {
      const invalid = new Set(), changedRects = []
      for (const [id, old] of nodes) if (!nextNodes.has(id)) { changedRects.push(old); nodes.delete(id); nodesGrid.remove(id); for (const edge of adjacency.get(id) || []) invalid.add(edge) }
      for (const [id, rect] of nextNodes) if (!sameRect(nodes.get(id), rect)) {
        if (nodes.has(id)) changedRects.push(nodes.get(id))
        changedRects.push(rect); nodes.set(id, rect); nodesGrid.put(id, inflate(rect, 4))
        for (const edge of adjacency.get(id) || []) invalid.add(edge)
      }
      if (previousEdges !== edges || previousTypes !== types) {
        adjacency.clear(); previousEdges = edges; previousTypes = types
        const active = new Set(edges.map(edge => edge.id))
        for (const id of cache.keys()) if (!active.has(id)) { cache.delete(id); labelsGrid.remove(id) }
        for (const edge of edges) {
          invalid.add(edge.id)
          for (const id of [edge.source, edge.target]) { if (!adjacency.has(id)) adjacency.set(id, new Set()); adjacency.get(id).add(edge.id) }
        }
      }
      // Moving a third node can invalidate a cached label, even if it is not an endpoint.
      for (const rect of changedRects) for (const id of labelsGrid.query(inflate(rect, 4))) invalid.add(id)
      return edges.map(edge => {
        if (!invalid.has(edge.id) && cache.has(edge.id)) return cache.get(edge.id)
        const a = nodes.get(edge.source), b = nodes.get(edge.target)
        if (!a || !b) { cache.delete(edge.id); labelsGrid.remove(edge.id); return null }
        calculations += 1
        const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2
        const [x1, y1] = rectBoundaryPoint(acx, acy, a.w, a.h, bcx, bcy), [x2, y2] = rectBoundaryPoint(bcx, bcy, b.w, b.h, acx, acy)
        const type = types.get(edge.data.relation.relation_type_id), labelW = String(type?.name || '').length * 6 + 14 + (edge.data.relation.description ? 12 : 0)
        let mt = 0.5
        for (const candidate of [0.5, 0.36, 0.64, 0.28, 0.72, 0.2, 0.8, 0.12, 0.88, 0.06, 0.94]) {
          const rect = { x: x1 + (x2 - x1) * candidate - labelW / 2, y: y1 + (y2 - y1) * candidate - 10, w: labelW, h: 20 }
          if (!nodesGrid.query(rect).size) { mt = candidate; break }
        }
        const mx = x1 + (x2 - x1) * mt, my = y1 + (y2 - y1) * mt, angle = Math.atan2(y2 - y1, x2 - x1)
        const geometry = { edge, type, x1, y1, x2, y2, mx, my, angle, labelW, ax: x2 - Math.cos(angle) * 10, ay: y2 - Math.sin(angle) * 10 }
        cache.set(edge.id, geometry); labelsGrid.put(edge.id, { x: mx - labelW / 2, y: my - 10, w: labelW, h: 20 })
        return geometry
      }).filter(Boolean)
    },
    getMetrics: () => ({ calculations, cached: cache.size, nodes: nodes.size }),
  }
}
