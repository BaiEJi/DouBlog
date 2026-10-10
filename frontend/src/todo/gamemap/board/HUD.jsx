/* 看板 HUD（#2 收敛画布悬浮元素）：左上单一可折叠条，聚合
 * 图例过滤（含数量/全部显示）、聚焦提示、FPS 徽标、密度三档切换（#4）与保存状态。
 * 缩放控件与小地图保持 React Flow 右下默认位置成组。 */
import { DownOutlined } from '@ant-design/icons'
import { FpsBadge } from './shared'
import { useBoardUI } from './ui-store'

export function BoardHUD({ relations, typeMap }) {
  const { density, setDensity, hudOpen, toggleHud, hiddenTypes, setHiddenTypes, focusId, setFocusId } = useBoardUI()

  const counts = new Map()
  for (const r of relations) counts.set(r.relation_type_id, (counts.get(r.relation_type_id) || 0) + 1)
  const items = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const anyHidden = items.some(([tid]) => hiddenTypes.has(tid))

  return (
    <div style={{
      position: 'absolute', left: 12, top: 10, zIndex: 20, maxWidth: 460,
      background: 'rgba(15,18,27,.85)', border: '1px solid #2a3040', borderRadius: 10,
      padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 6,
      pointerEvents: 'none',
    }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 20 }}>
        <span onClick={toggleHud} title={hudOpen ? '收起看板信息' : '展开看板信息'}
          style={{ cursor: 'pointer', color: '#8b93a8', fontSize: 11, userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, pointerEvents: 'auto' }}>
          {hudOpen ? null : '图例 '}<DownOutlined rotate={hudOpen ? 0 : 180} style={{ fontSize: 9 }} />
        </span>
        <span title="卡片信息密度：简洁 / 标准 / 详细"
          style={{ display: 'inline-flex', background: 'rgba(255,255,255,.06)', borderRadius: 8, padding: 1 }}>
          {[['compact', '简'], ['standard', '标'], ['detailed', '详']].map(([v, label]) => (
            <span key={v} onClick={() => setDensity(v)}
              style={{
                cursor: 'pointer', fontSize: 11, padding: '1px 8px', borderRadius: 7, userSelect: 'none', pointerEvents: 'auto',
                background: density === v ? '#7c5cff' : 'transparent', color: density === v ? '#fff' : '#8b93a8',
                transition: 'all .15s ease',
              }}>{label}</span>
          ))}
        </span>
        {focusId != null && (
          <span onClick={() => setFocusId(null)} title="清除聚焦"
            style={{ fontSize: 11.5, color: '#ffd666', cursor: 'pointer', pointerEvents: 'auto' }}>
            🎯 聚焦中 · 点击清除
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <FpsBadge />
        </span>
      </div>
      {hudOpen && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {items.length === 0 && <span style={{ fontSize: 11.5, color: '#6b7488' }}>暂无关系</span>}
          {items.map(([tid, n]) => {
            const t = typeMap.get(tid)
            if (!t) return null
            const off = hiddenTypes.has(tid)
            return (
              <span key={tid} title={off ? '点击显示这类关系' : '点击隐藏这类关系'}
                onClick={() => {
                  const next = new Set(hiddenTypes)
                  if (off) next.delete(tid); else next.add(tid)
                  setHiddenTypes(next)
                }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', pointerEvents: 'auto',
                  fontSize: 11.5, padding: '2px 9px', borderRadius: 999,
                  background: off ? 'rgba(255,255,255,.04)' : `${t.color}2e`,
                  border: `1px solid ${off ? '#2a3040' : t.color + '88'}`,
                  color: off ? '#6b7488' : '#e8eaf2',
                  textDecoration: off ? 'line-through' : 'none',
                }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: t.color, opacity: off ? 0.4 : 1 }} />
                {t.name} <span style={{ opacity: 0.55 }}>{n}</span>
              </span>
            )
          })}
          {anyHidden && (
            <span onClick={() => setHiddenTypes(new Set())} style={{ fontSize: 11.5, color: '#39dbff', cursor: 'pointer', padding: '2px 6px', pointerEvents: 'auto' }}>全部显示</span>
          )}
        </div>
      )}
    </div>
  )
}
