/* 游戏库页：卡片墙（渐变封面/上传封面）+ 搜索过滤 + 创建/导入备份。
 * 适配 DouBlog：去源 AppShell 外壳；nav 挂 /gamemap 前缀；上传走 apiUpload。 */
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { App as AntApp, Button, Card, Col, Empty, Input, Modal, Row, Segmented, Select, Space, Typography, Upload } from 'antd'
import { PlusOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons'
import { motion } from 'framer-motion'
import { api, apiUpload, assetUrl } from '../api'

const GM = '/gamemap'

const COVERS = [
  'linear-gradient(135deg,#7c5cff 0%,#38b6ff 100%)',
  'linear-gradient(135deg,#ff6b9d 0%,#ff9f43 100%)',
  'linear-gradient(135deg,#2ed573 0%,#1e90ff 100%)',
  'linear-gradient(135deg,#f368e0 0%,#845ef7 100%)',
  'linear-gradient(135deg,#ffa502 0%,#ff6348 100%)',
  'linear-gradient(135deg,#00d2d3 0%,#3d8bfd 100%)',
]
const STATUS = {
  playing: { label: '游玩中', color: '#7c5cff' }, finished: { label: '已通关', color: '#2ed573' }, planned: { label: '想玩', color: '#6b7488' },
}

export default function GameLibrary() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { message } = AntApp.useApp()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', play_status: 'playing' })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const fileRef = useRef(null)
  const [importing, setImporting] = useState(false)

  const games = useQuery({ queryKey: ['games'], queryFn: () => api('/games') })
  const create = useMutation({
    mutationFn: () => api('/games', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: (g) => { qc.invalidateQueries({ queryKey: ['games'] }); setOpen(false); setForm({ name: '', description: '', play_status: 'playing' }); message.success('创建成功'); nav(`${GM}/games/${g.id}`) },
  })

  /** 导入备份 JSON：创建一个全新游戏并跳转 */
  const importBackup = async (file) => {
    setImporting(true)
    try {
      const data = JSON.parse(await file.text())
      const g = await api('/games/import', { method: 'POST', body: JSON.stringify(data) })
      qc.invalidateQueries({ queryKey: ['games'] })
      message.success(`已导入「${g.name}」`)
      nav(`${GM}/games/${g.id}`)
    } catch (e) {
      message.error(`导入失败：${e.message}`)
    } finally {
      setImporting(false)
    }
  }

  const filtered = (games.data || []).filter((g) =>
    g.name.includes(search) && (filter === 'all' || g.play_status === filter))

  return (
    <div className="mx-auto max-w-[1700px] px-4 sm:px-6 xl:px-10 py-6">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <h1 className="text-lg font-semibold tracking-tight">游戏库 · <span className="gm-gradient-text">{filtered.length} 个世界</span></h1>
        <div className="ml-auto flex items-center gap-2">
          <Button icon={<UploadOutlined />} loading={importing} onClick={() => fileRef.current?.click()}>导入备份</Button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importBackup(f); e.target.value = '' }} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>创建游戏</Button>
        </div>
      </div>

      <Space style={{ marginBottom: 18 }} size={14}>
        <Input size="large" prefix={<SearchOutlined style={{ color: '#6b7488' }} />} placeholder="搜索游戏…" allowClear
          value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 280 }} />
        <Segmented value={filter} onChange={(v) => setFilter(v)}
          options={[{ value: 'all', label: '全部' }, { value: 'playing', label: '游玩中' }, { value: 'finished', label: '已通关' }, { value: 'planned', label: '想玩' }]} />
      </Space>

      {filtered.length === 0 && <Empty style={{ marginTop: 60 }} description="暂无游戏" />}

      <Row gutter={[18, 18]}>
        <Col xs={24} sm={12} lg={8} xl={6}>
          <motion.div whileHover={{ scale: 1.02 }} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
            <Card hoverable className="gm-card-hover" onClick={() => setOpen(true)}
              style={{ height: 252, border: '1px dashed #3a4256' }}
              styles={{ body: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, height: '100%' } }}>
              <div style={{ width: 64, height: 64, borderRadius: 20, background: 'rgba(124,92,255,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: '#7c5cff' }}><PlusOutlined /></div>
              <Typography.Text strong>创建新游戏</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>开始记录一段新的旅程</Typography.Text>
            </Card>
          </motion.div>
        </Col>
        {filtered.map((g, i) => (
          <Col xs={24} sm={12} lg={8} xl={6} key={g.id}>
            <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              whileHover={{ y: -6 }}>
              <Card hoverable className="gm-card-hover" onClick={() => nav(`${GM}/games/${g.id}`)}
                style={{ overflow: 'hidden' }} styles={{ body: { padding: 0 } }}>
                <div style={{ height: 118, background: g.cover_url ? '#000' : COVERS[g.id % COVERS.length], position: 'relative', display: 'flex', alignItems: 'flex-end', padding: 12 }}>
                  {g.cover_url
                    ? <img src={assetUrl(g.cover_url)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                    : null}
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,transparent 30%,rgba(11,13,20,.75))' }} />
                  <Upload accept="image/*" showUploadList={false} style={{ position: 'absolute', top: 8, right: 8, zIndex: 3 }}
                    customRequest={async (opt) => {
                      try {
                        const res = await apiUpload(opt.file)
                        await api(`/games/${g.id}`, { method: 'PATCH', body: JSON.stringify({ cover_attachment_id: res.attachment_id }) })
                        qc.invalidateQueries({ queryKey: ['games'] })
                        message.success('封面已更新')
                      } catch (e) { message.error(e.message) }
                    }}>
                    <Button size="small" icon={<UploadOutlined />} onClick={(e) => e.stopPropagation()}
                      style={{ background: 'rgba(11,13,20,.7)', border: '1px solid #2a3040' }}>封面</Button>
                  </Upload>
                  {!g.cover_url && <span style={{ fontSize: 34, marginRight: 'auto', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.4))' }}>🎮</span>}
                  <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, background: `${STATUS[g.play_status]?.color}33`, color: STATUS[g.play_status]?.color, border: `1px solid ${STATUS[g.play_status]?.color}66`, zIndex: 2 }}>
                    {STATUS[g.play_status]?.label || g.play_status}
                  </span>
                </div>
                <div style={{ padding: '12px 16px 16px' }}>
                  <Typography.Text strong style={{ fontSize: 16 }}>{g.name}</Typography.Text>
                  <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 0, marginTop: 6, minHeight: 40, fontSize: 12 }}>
                    {g.description || '暂无简介'}
                  </Typography.Paragraph>
                </div>
              </Card>
            </motion.div>
          </Col>
        ))}
      </Row>

      <Modal title="🎮 创建游戏" open={open} onCancel={() => setOpen(false)} onOk={() => create.mutate()}
        confirmLoading={create.isPending} okText="创建" okButtonProps={{ disabled: !form.name.trim() }}>
        <Space orientation="vertical" size={14} style={{ width: '100%', marginTop: 8 }}>
          <Input size="large" placeholder="游戏名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input.TextArea placeholder="一句话简介（可选）" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Select value={form.play_status} onChange={(v) => setForm({ ...form, play_status: v })} style={{ width: '100%' }}
            options={[{ value: 'playing', label: '🎮 游玩中' }, { value: 'finished', label: '✅ 已通关' }, { value: 'planned', label: '📌 想玩' }]} />
        </Space>
      </Modal>
    </div>
  )
}
