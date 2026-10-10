/* 剧情事件 / 统计 / 演变对比 / 批量导入 / 添加人物目标提示 / 空状态三步引导（#5）
 * —— 从 GameWorkspace 拆出（#7）。 */
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert, App as AntApp, Button, Card, Checkbox, Divider, Empty, Input, Modal,
  Popconfirm, Progress, Select, Space, Statistic, Tag, Timeline, Typography,
} from 'antd'
import { DeleteOutlined, TeamOutlined } from '@ant-design/icons'
import { api } from '../api'
import { factionColor } from '../theme'
import { chapterLabel } from './shared'

/* ---------- 添加人物弹窗的目标章节提示 ---------- */
export function AddTargetAlert({ target, isMerged }) {
  const suffix = isMerged ? '（时间范围最后一章）' : '（当前章节）'
  return (
    <Alert style={{ marginBottom: 14, marginTop: 8 }} showIcon
      type={target ? (isMerged ? 'warning' : 'info') : 'error'}
      title={target
        ? `本次加入：第${target.order_index}章 · ${target.title} ${suffix}`
        : '当前时间范围没有有效章节，请先在上方选择章节'} />
  )
}

/* ---------- 空游戏三步引导（#5） ---------- */
export function EmptyGuide({ onCreateChapter, onAddChar, onFirstRelation }) {
  const steps = [
    { icon: '📖', title: '创建章节', desc: '一章 = 一段游戏进程，后续随时加', action: onCreateChapter },
    { icon: '👤', title: '加入人物', desc: '从人物库添加，或批量导入名单', action: onAddChar },
    { icon: '🔗', title: '连第一条关系', desc: '从卡片边上的附着点拖到另一张卡', action: onFirstRelation },
  ]
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', gap: 16, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
      {steps.map((s, i) => (
        <Card key={s.title} hoverable onClick={s.action}
          style={{ width: 210, background: '#141824', border: '1px solid #232a3c', textAlign: 'center' }}>
          <div style={{ fontSize: 34 }}>{s.icon}</div>
          <Typography.Text strong style={{ display: 'block', marginTop: 8 }}>第 {i + 1} 步 · {s.title}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{s.desc}</Typography.Text>
        </Card>
      ))}
    </div>
  )
}

/* ---------- 剧情事件面板：本章编辑 + 全时间线 ---------- */
export function EventsPanel({ gid, chapterId, chapters, allCharMap, onJumpChapter }) {
  const { message } = AntApp.useApp()
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [chars, setChars] = useState([])
  const [editing, setEditing] = useState(null)

  const events = useQuery({
    queryKey: ['events', gid, chapterId],
    queryFn: () => api(`/chapters/${chapterId}/events`),
    enabled: !!chapterId,
  })
  const allEvents = useQuery({
    queryKey: ['eventsAll', gid],
    queryFn: async () => {
      const lists = await Promise.all(chapters.map((c) => api(`/chapters/${c.id}/events`)))
      return chapters.map((c, i) => ({ chapter: c, events: lists[i] })).filter((x) => x.events.length)
    },
    enabled: chapters.length > 0,
  })

  const ch = chapters.find((c) => c.id === chapterId)
  const boardChars = [...allCharMap.values()]

  const submit = async () => {
    if (!title.trim() || !chapterId) return
    try {
      if (editing) {
        await api(`/chapters/${chapterId}/events/${editing.id}`, {
          method: 'PATCH', body: JSON.stringify({ title: title.trim(), content, character_ids: chars }),
        })
        message.success('事件已更新')
      } else {
        await api(`/chapters/${chapterId}/events`, {
          method: 'POST', body: JSON.stringify({ title: title.trim(), content, order_index: (events.data || []).length + 1, character_ids: chars }),
        })
        message.success('事件已记录')
      }
      setEditing(null); setTitle(''); setContent(''); setChars([])
      qc.invalidateQueries({ queryKey: ['events', gid] })
      qc.invalidateQueries({ queryKey: ['eventsAll', gid] })
    } catch (e) {
      message.error(e.message)
    }
  }

  const remove = (ev) => {
    api(`/chapters/${ev.chapter_id}/events/${ev.id}`, { method: 'DELETE' }).then(() => {
      qc.invalidateQueries({ queryKey: ['events', gid] })
      qc.invalidateQueries({ queryKey: ['eventsAll', gid] })
    })
  }

  return (
    <div style={{ padding: 20, display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', overflow: 'auto', height: '100%' }}>
      <Card size="small" style={{ flex: '1 1 340px', maxWidth: 460, background: '#141824', border: '1px solid #232a3c' }}
        title={<span style={{ fontSize: 13 }}>✏️ 记录到：{ch ? chapterLabel(ch) : '—'}</span>}>
        <Space orientation="vertical" size={10} style={{ width: '100%' }}>
          <Input placeholder="事件标题（如：北境之战、主角觉醒）" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input.TextArea placeholder="发生了什么（可选）" rows={3} value={content} onChange={(e) => setContent(e.target.value)} />
          <Select mode="multiple" allowClear placeholder="关联人物（可选）" style={{ width: '100%' }} value={chars} onChange={setChars}
            options={boardChars.map((c) => ({ value: c.id, label: c.name }))} />
          <Space>
            <Button type="primary" disabled={!title.trim()} onClick={submit}>{editing ? '保存修改' : '添加事件'}</Button>
            {editing && <Button onClick={() => { setEditing(null); setTitle(''); setContent(''); setChars([]) }}>取消编辑</Button>}
          </Space>
        </Space>
        <Divider style={{ margin: '12px 0' }} />
        {(events.data || []).length === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>本章还没有记录事件</Typography.Text>
        ) : (
          <Space orientation="vertical" size={8} style={{ width: '100%' }}>
            {(events.data || []).map((ev) => (
              <div key={ev.id} style={{ padding: '8px 10px', background: '#0f121b', borderRadius: 8, border: '1px solid #232a3c' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Typography.Text strong style={{ fontSize: 13, flex: 1 }}>{ev.title}</Typography.Text>
                  <Button size="small" type="text" onClick={() => {
                    setEditing(ev); setTitle(ev.title); setContent(ev.content); setChars(ev.character_ids || [])
                  }}>编辑</Button>
                  <Popconfirm title="删除这个事件？" onConfirm={() => remove(ev)}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </div>
                {ev.content && <Typography.Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 4, fontSize: 12 }} ellipsis={{ rows: 2 }}>{ev.content}</Typography.Paragraph>}
                {!!ev.character_ids?.length && (
                  <div style={{ marginTop: 6 }}>
                    {ev.character_ids.map((cid) => (
                      <Tag key={cid} style={{ fontSize: 11 }}>{allCharMap.get(cid)?.name || `#${cid}`}</Tag>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Space>
        )}
      </Card>

      <Card size="small" style={{ flex: '1 1 360px', background: '#141824', border: '1px solid #232a3c' }}
        title={<span style={{ fontSize: 13 }}>🌐 全时间线（{chapters.length} 章）</span>}>
        {(allEvents.data || []).length === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>所有章节都没有事件，先在左侧记录一条吧</Typography.Text>
        ) : (
          <Timeline style={{ marginTop: 8 }}
            items={(allEvents.data || []).map(({ chapter, events: evs }) => ({
              color: '#7c5cff',
              children: (
                <div key={chapter.id}>
                  <Typography.Text strong style={{ cursor: 'pointer', fontSize: 13 }}
                    onClick={() => onJumpChapter(chapter.id)}>
                    第{chapter.order_index}章 · {chapter.title}
                  </Typography.Text>
                  <div style={{ marginTop: 4 }}>
                    {evs.map((ev) => (
                      <div key={ev.id} style={{ fontSize: 12.5, padding: '3px 0', color: '#c3c9d9' }}>
                        · {ev.title}{ev.character_ids?.length
                          ? <span style={{ color: '#6b7488' }}>（{ev.character_ids.map((cid) => allCharMap.get(cid)?.name || '?').join('、')}）</span>
                          : null}
                      </div>
                    ))}
                  </div>
                </div>
              ),
            }))} />
        )}
      </Card>
    </div>
  )
}

/* ---------- 统计面板 ---------- */
export function StatsPanel({ gid, onJumpChapter }) {
  const stats = useQuery({ queryKey: ['stats', gid], queryFn: () => api(`/games/${gid}/stats`) })
  if (stats.isLoading) return null
  const s = stats.data
  if (!s) return <Empty style={{ marginTop: 100 }} description="暂无数据" />
  const maxCh = Math.max(1, ...s.chapters.map((c) => c.characters))
  const maxDeg = Math.max(1, ...s.top_characters.map((c) => c.degree))
  const maxType = Math.max(1, ...s.type_usage.map((t) => t.count))
  return (
    <div style={{ padding: 20, overflow: 'auto', height: '100%' }}>
      <Space size={16} wrap style={{ marginBottom: 18 }}>
        {[
          { t: '章节', v: s.totals.chapters }, { t: '人物', v: s.totals.characters },
          { t: '关系', v: s.totals.relations }, { t: '事件', v: s.totals.events },
        ].map((x) => (
          <Card key={x.t} size="small" style={{ minWidth: 120, background: '#141824', border: '1px solid #232a3c' }}>
            <Statistic title={x.t} value={x.v} valueStyle={{ color: '#39dbff' }} />
          </Card>
        ))}
      </Space>
      <Space size={16} align="start" wrap>
        <Card size="small" title="📈 各章规模" style={{ minWidth: 320, background: '#141824', border: '1px solid #232a3c' }}>
          {s.chapters.map((c) => (
            <div key={c.id} style={{ marginBottom: 10 }}>
              <Typography.Text style={{ fontSize: 12.5, cursor: 'pointer' }} onClick={() => onJumpChapter(c.id)}>
                第{c.order_index}章 · {c.title}
              </Typography.Text>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 3 }}>
                <Progress percent={Math.round(c.characters / maxCh * 100)} size="small" style={{ flex: 1, marginInlineEnd: 0 }}
                  format={() => `👤${c.characters}`} strokeColor="#7c5cff" trailColor="#1e2433" />
                <span style={{ fontSize: 11.5, color: '#8b93a8' }}>🔗{c.relations}</span>
              </div>
            </div>
          ))}
          {!s.chapters.length && <Typography.Text type="secondary">暂无章节</Typography.Text>}
        </Card>
        <Card size="small" title="🎯 剧情核心人物" style={{ minWidth: 260, background: '#141824', border: '1px solid #232a3c' }}>
          {s.top_characters.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ width: 64, fontSize: 12.5, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{c.name}</span>
              <div style={{ flex: 1, height: 8, background: '#1e2433', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${c.degree / maxDeg * 100}%`, height: '100%', background: 'linear-gradient(90deg,#7c5cff,#38b6ff)' }} />
              </div>
              <span style={{ fontSize: 11.5, color: '#8b93a8', width: 36, textAlign: 'right' }}>{c.degree}</span>
            </div>
          ))}
          {!s.top_characters.length && <Typography.Text type="secondary">暂无关系</Typography.Text>}
        </Card>
        <Card size="small" title="⚔ 阵营" style={{ minWidth: 220, background: '#141824', border: '1px solid #232a3c' }}>
          {s.factions.map((f) => (
            <div key={f.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <Tag style={{ borderColor: 'transparent', background: factionColor(f.name), color: '#fff' }}>{f.name}</Tag>
              <span style={{ fontSize: 12, color: '#8b93a8' }}>{f.count} 人 · 存活 {f.alive}</span>
            </div>
          ))}
          {!s.factions.length && <Typography.Text type="secondary">还没有阵营标记</Typography.Text>}
        </Card>
        <Card size="small" title="🔗 关系类型分布" style={{ minWidth: 260, background: '#141824', border: '1px solid #232a3c' }}>
          {s.type_usage.map((t) => (
            <div key={t.type_id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: t.color }} />
              <span style={{ width: 56, fontSize: 12.5, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{t.name}</span>
              <div style={{ flex: 1, height: 8, background: '#1e2433', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${t.count / maxType * 100}%`, height: '100%', background: t.color }} />
              </div>
              <span style={{ fontSize: 11.5, color: '#8b93a8', width: 28, textAlign: 'right' }}>{t.count}</span>
            </div>
          ))}
          {!s.type_usage.length && <Typography.Text type="secondary">暂无关系</Typography.Text>}
        </Card>
      </Space>
    </div>
  )
}

/* ---------- 关系演变对比（两章 diff） ---------- */
export function DiffModal({ open, onClose, gid, chapters, defaultA, defaultB, allCharMap }) {
  const [aId, setAId] = useState(defaultA)
  const [bId, setBId] = useState(defaultB)
  useEffect(() => { if (open) { setAId(defaultA); setBId(defaultB) } }, [open, defaultA, defaultB])
  const opts = chapters.map((c) => ({ value: c.id, label: chapterLabel(c) }))
  const diff = useQuery({
    queryKey: ['diff', gid, aId, bId],
    enabled: open && !!aId && !!bId && aId !== bId,
    queryFn: async () => {
      const [A, B] = await Promise.all([
        api(`/games/${gid}/boards/chapters/${aId}`),
        api(`/games/${gid}/boards/chapters/${bId}`),
      ])
      const key = (r) => `${r.from_character_id}-${r.to_character_id}-${r.relation_type_id}`
      const mapA = new Map(A.relations.map((r) => [key(r), r]))
      const mapB = new Map(B.relations.map((r) => [key(r), r]))
      const added = [...mapB.values()].filter((r) => !mapA.has(key(r)))
      const removed = [...mapA.values()].filter((r) => !mapB.has(key(r)))
      const changed = [...mapB.values()].filter((r) => mapA.has(key(r)) && (mapA.get(key(r)).description || '') !== (r.description || ''))
      return { added, removed, changed, sameCount: mapB.size - added.length - changed.length }
    },
  })
  const name = (id) => allCharMap.get(id)?.name || `#${id}`
  const Row = ({ r, color, tag }) => (
    <div style={{ padding: '4px 0', fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center' }}>
      <Tag color={color} style={{ marginInlineEnd: 0 }}>{tag}</Tag>
      <span>{name(r.from_character_id)} → {name(r.to_character_id)}</span>
      <span style={{ color: '#8b93a8' }}>{r.description || '—'}</span>
    </div>
  )
  return (
    <Modal title="🔀 关系演变对比" open={open} onCancel={onClose} footer={null} width={640}>
      <Space style={{ marginBottom: 14 }} size={10}>
        <Select style={{ minWidth: 180 }} value={aId} onChange={setAId} options={opts} placeholder="对比起点章" />
        <span style={{ color: '#8b93a8' }}>➡️</span>
        <Select style={{ minWidth: 180 }} value={bId} onChange={setBId} options={opts} placeholder="对比终点章" />
      </Space>
      {aId === bId && <Alert type="warning" showIcon title="请选择两个不同的章节" />}
      {diff.data && (
        <Space orientation="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            不变 {diff.data.sameCount} 条 · 新增 <span style={{ color: '#52c41a' }}>{diff.data.added.length}</span> ·
            消失 <span style={{ color: '#ff4d4f' }}>{diff.data.removed.length}</span> ·
            说明变化 <span style={{ color: '#faad14' }}>{diff.data.changed.length}</span>
          </Typography.Text>
          {diff.data.added.map((r, i) => <Row key={`a${i}`} r={r} color="success" tag="新增" />)}
          {diff.data.removed.map((r, i) => <Row key={`r${i}`} r={r} color="error" tag="消失" />)}
          {diff.data.changed.map((r, i) => (
            <div key={`c${i}`} style={{ padding: '4px 0', fontSize: 12.5 }}>
              <Tag color="warning" style={{ marginInlineEnd: 8 }}>变化</Tag>
              {name(r.from_character_id)} → {name(r.to_character_id)}
              <div style={{ color: '#8b93a8', marginLeft: 52 }}>→ {r.description || '—'}</div>
            </div>
          ))}
        </Space>
      )}
    </Modal>
  )
}

/* ---------- 批量导入人物 ---------- */
export function BatchImportModal({ open, onClose, gid, targetChapterId, onDone }) {
  const { message } = AntApp.useApp()
  const [text, setText] = useState('')
  const [addToBoard, setAddToBoard] = useState(true)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      const created = await api(`/games/${gid}/characters/batch`, {
        method: 'POST',
        body: JSON.stringify({ names: text, add_to_chapter_id: addToBoard ? targetChapterId : null }),
      })
      message.success(`已建档 ${created.length} 人${addToBoard ? '并加入看板' : ''}`)
      setText('')
      onDone()
      onClose()
    } catch (e) {
      message.error(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={<span><TeamOutlined /> 批量导入人物</span>} open={open} onCancel={onClose}
      okText="导入" confirmLoading={busy} onOk={run} okButtonProps={{ disabled: !text.trim() }}>
      <Alert style={{ marginBottom: 12 }} showIcon type="info"
        title="每行一个名字（也支持逗号/顿号分隔），自动跳过已存在的人物" />
      <Input.TextArea rows={6} placeholder={'亚瑟\n约翰·马斯顿\n达奇、哈维尔'} value={text} onChange={(e) => setText(e.target.value)} />
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, cursor: 'pointer' }}>
        <Checkbox checked={addToBoard} onChange={(e) => setAddToBoard(e.target.checked)} />
        <span style={{ color: '#9aa3b8', fontSize: 12.5 }}>同时加入当前看板{targetChapterId ? '（时间范围模式下为范围最后一章）' : ''}</span>
      </label>
    </Modal>
  )
}
