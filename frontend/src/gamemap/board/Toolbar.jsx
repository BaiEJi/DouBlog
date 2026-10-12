/* 顶栏（#1 收纳分组）：视图切换 | 时间范围（#8 与 URL 同步）| 高频操作常驻，
 * 低频操作（导出/对比/批量/备份）收进「操作 ▾」。
 * 适配 DouBlog：去掉源版右侧 DbSwitcherCompact（数据库切换由 Doublog /config 统一）。 */
import { Button, Dropdown, Segmented, Select, Space, Tag } from 'antd'
import {
  AppstoreOutlined, CameraOutlined, DownOutlined, DiffOutlined, DownloadOutlined,
  TeamOutlined, UserAddOutlined,
} from '@ant-design/icons'
import { chapterLabel } from './shared'

export function Toolbar(p) {
  const chOpts = p.chapterList.map((c) => ({ value: c.id, label: chapterLabel(c) }))

  return (
    <div style={{ padding: '8px 18px', borderBottom: '1px solid #1e2433', display: 'flex', alignItems: 'center', gap: 12, background: '#0f121b', flexWrap: 'wrap' }}>
      <Segmented value={p.view} onChange={(v) => p.setView(v)} options={[
        { value: 'board', label: '🕸️ 看板' }, { value: 'characters', label: '👥 人物' },
        { value: 'relations', label: '🔗 关系' }, { value: 'events', label: '📜 剧情' },
        { value: 'stats', label: '📊 统计' },
      ]} />
      {p.view === 'board' && (
        <>
          <Space.Compact>
            <Select size="small" style={{ minWidth: 138 }} value={p.scopeMode}
              onChange={(v) => p.setScopeMode(v)}
              options={[
                { value: 'chapter', label: '📄 当前章节' },
                { value: 'upto', label: '⬅️ 第N章及之前' },
                { value: 'from', label: '第N章及之后 ➡️' },
                { value: 'custom', label: '📑 指定章节' },
              ]} />
            {(p.scopeMode === 'upto' || p.scopeMode === 'from') && (
              <Select size="small" style={{ minWidth: 150 }} value={p.scopeBoundaryId ?? p.activeChapterId ?? undefined}
                onChange={p.setScopeBoundaryId} options={chOpts} />
            )}
            {p.scopeMode === 'custom' && (
              <Select mode="multiple" size="small" style={{ minWidth: 220, maxWidth: 420 }} maxTagCount="responsive"
                placeholder="选择要查看的章节（可多选）" value={p.scopeIds} onChange={p.setScopeIds} options={chOpts.map((o) => ({ ...o, label: '🔖 ' + o.label }))} />
            )}
          </Space.Compact>
          {p.scopeMode !== 'chapter' && (
            <Tag color="geekblue" style={{ marginInlineEnd: 0, fontSize: 12 }}>🕐 {p.mergedCount} 章聚合{p.anchorText}</Tag>
          )}
          <Button size="small" icon={<UserAddOutlined />} onClick={p.onAddChar}>添加人物</Button>
          <Button size="small" icon={<AppstoreOutlined />} onClick={p.onScatter}>打散布局</Button>
          <Dropdown menu={{
            items: [
              { key: 'export', icon: <CameraOutlined />, label: '导出图片 PNG' },
              { key: 'diff', icon: <DiffOutlined />, label: '演变对比' },
              { type: 'divider', key: 'd1' },
              { key: 'batch', icon: <TeamOutlined />, label: '批量导入人物' },
              { key: 'backup', icon: <DownloadOutlined />, label: '备份 JSON' },
            ],
            onClick: ({ key }) => {
              if (key === 'export') p.onExport()
              else if (key === 'diff') p.onDiff()
              else if (key === 'batch') p.onBatch()
              else if (key === 'backup') p.onBackup()
            },
          }}>
            <Button size="small">操作 <DownOutlined style={{ fontSize: 10 }} /></Button>
          </Dropdown>
          {p.saveBadge}
        </>
      )}
    </div>
  )
}
