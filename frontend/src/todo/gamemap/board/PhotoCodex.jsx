/* 角色图鉴：全屏抽屉——档案头 + 按章节分组的照片墙。
 * 每章组可上传（复用 /api/todo/gamemap/uploads → 关联 character_photos），照片支持
 * 点击放大预览、改备注/换章、删除；未分章照片归入末尾「通用」组。 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App as AntApp, Avatar, Button, Drawer, Image, Input, Modal,
  Popconfirm, Select, Space, Tag, Typography, Upload,
} from 'antd'
import { CameraOutlined, DeleteOutlined, EditOutlined, FileImageOutlined, UploadOutlined } from '@ant-design/icons'
import { api, apiUpload, assetUrl } from '../api'
import { avatarGradient, factionColor } from '../theme'
import { chapterLabel } from './shared'

export function PhotoCodex({ characterId, character, chapters, onClose, onChanged }) {
  const { message } = AntApp.useApp()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)
  const [editCaption, setEditCaption] = useState('')
  const [editChapter, setEditChapter] = useState(undefined)

  const photos = useQuery({
    queryKey: ['photos', characterId],
    queryFn: () => api(`/games/${character?.game_id}/characters/${characterId}/photos`),
    enabled: !!characterId && !!character,
  })

  useEffect(() => { if (!characterId) { setEditing(null) } }, [characterId])

  // 按章分组：有章的按 order，无章的「通用」置底
  const groups = useMemo(() => {
    const byChapter = new Map()
    for (const p of photos.data || []) {
      const k = p.chapter_id
      byChapter.set(k, [...(byChapter.get(k) || []), p])
    }
    const result = []
    for (const ch of chapters) {
      const items = byChapter.get(ch.id) || []
      if (items.length) result.push({ key: ch.id, title: chapterLabel(ch), items })
    }
    const loose = byChapter.get(null) || []
    if (loose.length) result.push({ key: null, title: '通用（未分章）', items: loose })
    return result
  }, [photos.data, chapters])

  const upload = async (file, chapterId) => {
    if (!character) return
    try {
      const res = await apiUpload(file)
      await api(`/games/${character.game_id}/characters/${character.id}/photos`, {
        method: 'POST',
        body: JSON.stringify({ attachment_id: res.attachment_id, chapter_id: chapterId, caption: '' }),
      })
      qc.invalidateQueries({ queryKey: ['photos', character.id] })
      onChanged()
      message.success(chapterId ? '照片已存入该章' : '照片已存入通用')
    } catch (e) {
      message.error(e.message)
    }
  }

  const saveEdit = async () => {
    if (!editing || !character) return
    try {
      await api(`/games/${character.game_id}/characters/${character.id}/photos/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ caption: editCaption, chapter_id: editChapter }),
      })
      qc.invalidateQueries({ queryKey: ['photos', character.id] })
      onChanged()
      setEditing(null)
      message.success('照片信息已更新')
    } catch (e) {
      message.error(e.message)
    }
  }

  const remove = async (p) => {
    if (!character) return
    await api(`/games/${character.game_id}/characters/${character.id}/photos/${p.id}`, { method: 'DELETE' })
    qc.invalidateQueries({ queryKey: ['photos', character.id] })
    onChanged()
    message.success('照片已删除')
  }

  const chOpts = [
    ...chapters.map((c) => ({ value: c.id, label: chapterLabel(c) })),
    { value: -1, label: '通用（不归属章节）' },
  ]

  return (
    <Drawer title={<span style={{ letterSpacing: '.06em' }}>📖 图鉴 · {character?.name ?? ''}</span>}
      open={!!characterId} onClose={onClose} size="large">
      {character && (
        <>
          {/* 档案头 */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 18 }}>
            <Avatar size={72} style={{ background: avatarGradient(character.id), fontSize: 30, border: '2px solid #2a3040', flex: 'none' }}
              src={character.avatar_url ? assetUrl(character.avatar_url) : undefined}>{character.name?.[0] || '?'}</Avatar>
            <div style={{ minWidth: 0 }}>
              <Space size={8} wrap>
                <Typography.Text strong style={{ fontSize: 18 }}>{character.name}</Typography.Text>
                {character.faction && <Tag style={{ borderColor: 'transparent', background: factionColor(character.faction), color: '#fff' }}>⚔ {character.faction}</Tag>}
                {character.alive === false && <Tag color="default">💀 已死亡</Tag>}
              </Space>
              <Typography.Paragraph style={{ marginBottom: 0, marginTop: 4, fontSize: 12.5, color: '#9aa3b8' }} ellipsis={{ rows: 2 }}>
                {character.description || '暂无简介'}
              </Typography.Paragraph>
            </div>
            <Upload accept="image/*" showUploadList={false}
              customRequest={(opt) => upload(opt.file, null)}>
              <Button icon={<CameraOutlined />} style={{ marginLeft: 'auto', flex: 'none' }}>存入通用</Button>
            </Upload>
          </div>

          {/* 照片墙：按章分组 */}
          {(photos.data || []).length === 0 ? (
            <div style={{
              background: '#141824', border: '1px dashed #3a4256', borderRadius: 12,
              padding: '34px 16px', textAlign: 'center',
            }}>
              <FileImageOutlined style={{ fontSize: 34, color: '#7c5cff', marginBottom: 8 }} />
              <div style={{ fontSize: 13.5, color: '#c3c9d9', marginBottom: 4 }}>
                记录 TA 的高光时刻
              </div>
              <div style={{ fontSize: 12, color: '#9aa3b8', marginBottom: 16 }}>
                按章节存入游戏截图——上传后可随时调整所属章节与备注
              </div>
              <Upload accept="image/*" showUploadList={false}
                customRequest={(opt) => upload(opt.file, null)}>
                <Button type="primary" icon={<CameraOutlined />}>上传第一张照片</Button>
              </Upload>
              <div style={{ fontSize: 11.5, color: '#6b7488', marginTop: 10 }}>
                上传后进入「通用」，可在照片卡上改归章节
              </div>
            </div>
          ) : (
            <Image.PreviewGroup>
              {groups.map((g) => (
                <div key={String(g.key)} style={{ marginBottom: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Typography.Text strong style={{ fontSize: 13.5 }}>{g.title}</Typography.Text>
                    <Tag style={{ fontSize: 11 }}>{g.items.length} 张</Tag>
                    {g.key !== null && (
                      <span style={{ marginLeft: 'auto' }}>
                        <Upload accept="image/*" showUploadList={false}
                          customRequest={(opt) => upload(opt.file, g.key)}>
                          <Button size="small" type="text" icon={<UploadOutlined />} style={{ color: '#39dbff' }}>上传到此章</Button>
                        </Upload>
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 10 }}>
                    {g.items.map((p) => (
                      <div key={p.id} className="gm-photo-card" style={{
                        background: '#141824', border: '1px solid #232a3c', borderRadius: 10, overflow: 'hidden',
                      }}>
                        <Image src={assetUrl(p.url)} alt={p.caption || '角色照片'}
                          style={{ width: '100%', height: 128, objectFit: 'cover', display: 'block' }}
                          fallback="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=" />
                        <div style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span title={p.caption} style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: p.caption ? '#c3c9d9' : '#5a6275',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {p.caption || '无备注'}
                          </span>
                          <Button size="small" type="text" icon={<EditOutlined />} title="编辑备注/章节"
                            onClick={() => { setEditing(p); setEditCaption(p.caption); setEditChapter(p.chapter_id ?? -1) }} />
                          <span style={{ width: 1, height: 14, background: '#232a3c', flex: 'none' }} />
                          <Popconfirm title="删除这张照片？" okText="删 除" okButtonProps={{ danger: true }} onConfirm={() => remove(p)}>
                            <Button className="gm-row-del" size="small" type="text" danger icon={<DeleteOutlined />} title="删除" />
                          </Popconfirm>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </Image.PreviewGroup>
          )}

          {/* 编辑照片信息 */}
          <Modal title="编辑照片" open={!!editing} onCancel={() => setEditing(null)} onOk={saveEdit} okText="保 存" cancelText="取 消">
            <Space orientation="vertical" size={12} style={{ width: '100%', marginTop: 8 }}>
              {editing && <img src={assetUrl(editing.url)} alt="" style={{ width: 220, height: 128, objectFit: 'cover', borderRadius: 8, display: 'block' }} />}
              <div>
                <div style={{ fontSize: 12.5, color: '#9aa3b8', marginBottom: 4 }}>备注</div>
                <Input placeholder="如：决战前夜、初见名场面" value={editCaption}
                  onChange={(e) => setEditCaption(e.target.value)} maxLength={100} showCount />
              </div>
              <div>
                <div style={{ fontSize: 12.5, color: '#9aa3b8', marginBottom: 4 }}>所属章节</div>
                <Select style={{ width: '100%' }} value={editChapter} onChange={setEditChapter} options={chOpts} />
              </div>
            </Space>
          </Modal>
        </>
      )}
    </Drawer>
  )
}
