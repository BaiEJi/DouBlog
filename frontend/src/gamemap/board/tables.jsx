/* 人物 / 关系 表格（#6 增强）：搜索、排序、阵营/来源章节筛选、行内快捷操作。 */
import { useMemo, useState } from 'react'
import { App as AntApp, Avatar, Button, Empty, Input, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from 'antd'
import { BookOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons'
import { api } from '../api'
import { avatarGradient, factionColor } from '../theme'

export function CharactersTable({ board, gid, onOpen, onChanged, onCodex }) {
  const { message } = AntApp.useApp()
  const [q, setQ] = useState('')
  const [faction, setFaction] = useState(null)
  const chars = board?.characters || []
  const relations = board?.relations || []

  const factions = useMemo(() => [...new Set(chars.map((c) => c.faction).filter(Boolean))], [chars])
  const relCount = (cid) => relations.filter((r) => r.from_character_id === cid || r.to_character_id === cid).length
  const filtered = chars.filter((c) =>
    (!q || c.name.includes(q) || c.description?.includes(q)) && (!faction || c.faction === faction))

  return (
    <div style={{ padding: 20 }}>
      <Space style={{ marginBottom: 14 }}>
        <Input allowClear prefix={<SearchOutlined style={{ color: '#6b7488' }} />} placeholder="搜索姓名/简介…"
          style={{ width: 220 }} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear placeholder="阵营筛选" style={{ minWidth: 140 }} value={faction}
          onChange={setFaction} options={factions.map((f) => ({ value: f, label: f }))} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{filtered.length} / {chars.length} 人</Typography.Text>
      </Space>
      <Table rowKey="id" dataSource={filtered} pagination={false} size="middle"
        locale={{ emptyText: <Empty description="本章暂无人物" /> }}
        onRow={(r) => ({ onClick: () => onOpen(r.id), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: '人物', sorter: (a, b) => a.name.localeCompare(b.name),
            render: (_, r) => (<Space>
              <Avatar style={{ background: avatarGradient(r.id), filter: r.alive === false ? 'grayscale(1)' : undefined }}>{r.name[0]}</Avatar>
              <Space orientation="vertical" size={0}>
                <span style={{ fontWeight: 600 }}>{r.name}{r.alive === false && <span style={{ marginLeft: 6, fontSize: 12 }}>💀</span>}</span>
                <span style={{ fontSize: 12, color: '#8b93a8' }}>{r.description?.slice(0, 30) || '暂无介绍'}</span>
              </Space></Space>),
          },
          {
            title: '阵营', width: 120, filters: factions.map((f) => ({ text: f, value: f })),
            onFilter: (v, r) => r.faction === v,
            render: (_, r) => r.faction ? <Tag style={{ borderColor: 'transparent', background: factionColor(r.faction), color: '#fff' }}>{r.faction}</Tag> : <span style={{ color: '#5a6275' }}>—</span>,
          },
          { title: '关系数', width: 90, align: 'center', sorter: (a, b) => relCount(a.id) - relCount(b.id), render: (_, r) => <Tag color="purple">{relCount(r.id)}</Tag> },
          {
            title: '图鉴', width: 70, render: (_, r) => (
              <Button size="small" type="text" icon={<BookOutlined />} title="角色图鉴（按章节保存照片）"
                onClick={(e) => { e.stopPropagation(); onCodex(r.id) }} />
            ),
          },
          {
            title: '存活', width: 90,
            render: (_, r) => (
              <Switch size="small" checkedChildren="活" unCheckedChildren="亡" checked={r.alive !== false}
                onClick={(_, e) => e.stopPropagation()}
                onChange={(checked) => {
                  api(`/games/${gid}/characters/${r.id}`, { method: 'PATCH', body: JSON.stringify({ alive: checked }) })
                    .then(onChanged)
                    .catch((e) => message.error(e.message))
                }} />
            ),
          },
        ]} />
    </div>
  )
}

export function RelationsTable({ board, allCharMap, typeMap, activeChapterTitle, onOpen, onDelete }) {
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState(null)
  const relations = board?.relations || []
  const types = useMemo(() => [...new Map(relations.map((r) => [r.relation_type_id, typeMap.get(r.relation_type_id)])).entries()]
    .filter(([, t]) => t), [relations, typeMap])
  const name = (id) => allCharMap.get(id)?.name || '?'
  const filtered = relations.map((r, i) => ({ ...r, _i: i })).filter((r) =>
    (!q || name(r.from_character_id).includes(q) || name(r.to_character_id).includes(q) || (r.description || '').includes(q)) &&
    (!typeFilter || r.relation_type_id === typeFilter))

  return (
    <div style={{ padding: 20 }}>
      <Space style={{ marginBottom: 14 }}>
        <Input allowClear prefix={<SearchOutlined style={{ color: '#6b7488' }} />} placeholder="搜索人物/说明…"
          style={{ width: 220 }} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear placeholder="关系类型" style={{ minWidth: 130 }} value={typeFilter}
          onChange={setTypeFilter} options={types.map(([id, t]) => ({ value: id, label: t.name }))} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{filtered.length} / {relations.length} 条</Typography.Text>
      </Space>
      <Table rowKey={(r) => String(r.id ?? r._i)} dataSource={filtered} pagination={false} size="middle"
        locale={{ emptyText: <Empty description="暂无关系" /> }}
        onRow={(r) => ({ onClick: () => onOpen(r._i), style: { cursor: 'pointer' } })}
        columns={[
          { title: '人物 A', render: (_, r) => name(r.from_character_id) },
          { title: '关系', render: (_, r) => { const t = typeMap.get(r.relation_type_id); return <Tag color={t?.color} style={{ borderColor: 'transparent' }}>{t?.name || '?'}</Tag> } },
          { title: '人物 B', render: (_, r) => name(r.to_character_id) },
          { title: '说明', render: (_, r) => <span style={{ color: '#9aa3b8' }}>{r.description || '—'}</span>, ellipsis: true },
          { title: '来源章节', width: 140, render: (_, r) => r.chapter_title ? <Tag color="geekblue">{r.chapter_title}</Tag> : <span style={{ color: '#5a6275' }}>{activeChapterTitle || '本章'}</span> },
          {
            title: '', width: 60, render: (_, r) => (
              <Popconfirm title="删除这条关系？" onConfirm={(e) => { e?.stopPropagation(); onDelete(r) }}>
                <Button className="gm-row-del" size="small" type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
              </Popconfirm>
            ),
          },
        ]} />
    </div>
  )
}
