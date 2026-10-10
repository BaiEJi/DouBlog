/* 人物/关系详情抽屉（#3 重构）：Tab 分区（档案 / 本章状态 / 章节绑定），
 * 底部统一保存栏：保存当前分区，未保存更改显示小圆点，支持 Ctrl+S。
 * 聚合模式下"本章状态"只读提示（写回语义见时间范围文档）。 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  App as AntApp, AutoComplete, Avatar, Button, Divider, Drawer, Form, Input,
  Popconfirm, Select, Space, Switch, Tabs, Tag, Typography, Upload,
} from 'antd'
import { BookOutlined, DeleteOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons'
import { api, apiUpload, assetUrl } from '../api'
import { avatarGradient, factionColor } from '../theme'

/** DrawerState: { kind: "node", characterId } | { kind: "edge", index } | null */

export function DetailDrawer(props) {
  if (!props.drawer) return <Drawer open={false} onClose={props.onClose} />
  return props.drawer.kind === 'node'
    ? <NodeDrawer {...props} drawer={props.drawer} />
    : <EdgeDrawer {...props} drawer={props.drawer} />
}

/* ---------- 人物抽屉 ---------- */
function NodeDrawer(p) {
  const { drawer, onClose, gid, chapterId, board, allCharMap, isMerged, onSaved, onRemoveNode, onOpenCodex } = p
  const [archForm] = Form.useForm()
  const [stateForm] = Form.useForm()
  const { message } = AntApp.useApp()
  const [tab, setTab] = useState('profile')
  const [dirty, setDirty] = useState(false)   // 当前分区有未保存更改
  const binding = useQuery({
    queryKey: ['charChapters', gid, drawer.characterId],
    queryFn: () => api(`/games/${gid}/characters/${drawer.characterId}/chapters`),
  })
  useEffect(() => { archForm.resetFields(); stateForm.resetFields(); setDirty(false) }, [drawer])
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && dirty) {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const c = (board?.characters || []).find((x) => x.id === drawer.characterId)
    || allCharMap.get(drawer.characterId)
  const st = (board?.states || []).find((s) => s.character_id === drawer.characterId)

  async function save() {
    try {
      if (tab === 'profile') {
        const v = await archForm.validateFields()
        await api(`/games/${gid}/characters/${drawer.characterId}`, { method: 'PATCH', body: JSON.stringify(v) })
        message.success('档案已保存')
      } else if (tab === 'state') {
        const v = await stateForm.validateFields()
        await api(`/games/${gid}/characters/${drawer.characterId}/chapters/${chapterId}/state`, {
          method: 'PUT',
          body: JSON.stringify({
            alias: v.alias, role: v.role, status: v.status, notes: v.notes,
            alive_override: v.alive_mode === 'alive' ? true : v.alive_mode === 'dead' ? false : null,
            faction_override: (v.faction_chapter || '').trim() || null,
          }),
        })
        message.success('本章状态已保存')
      } else return
      setDirty(false)
      onSaved()
    } catch (e) {
      if (e?.errorFields) return // 表单校验错误已由 Form 展示
      message.error(e.message)
    }
  }

  const tabs = [
    {
      key: 'profile', forceRender: true, label: <span>{dirty && tab === 'profile' && <span style={{ color: '#7c5cff', marginRight: 5 }}>●</span>}档案</span>,
      children: (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <Avatar size={64} style={{ background: avatarGradient(drawer.characterId), fontSize: 26, border: '2px solid #2a3040' }}
              src={c?.avatar_url ? assetUrl(c.avatar_url) : undefined}>{c?.name?.[0] || '?'}</Avatar>
            <Upload accept="image/*" showUploadList={false}
              customRequest={async (opt) => {
                try {
                  const res = await apiUpload(opt.file)
                  await api(`/games/${gid}/characters/${drawer.characterId}`, {
                    method: 'PATCH', body: JSON.stringify({ avatar_url: res.url }),
                  })
                  message.success('头像已更新')
                  onSaved()
                } catch (e) { message.error(e.message) }
              }}>
              <Button icon={<UploadOutlined />}>上传头像</Button>
            </Upload>
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>档案信息（姓名/阵营/生死）在所有章节共享。</Typography.Text>
          <Form form={archForm} layout="vertical" style={{ marginTop: 12 }} onValuesChange={() => setDirty(true)}>
            <Form.Item name="name" label="姓名" initialValue={c?.name} rules={[{ required: true, message: '姓名不能为空' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="description" label="简介" initialValue={c?.description}>
              <Input.TextArea rows={3} placeholder="外貌、性格、背景……会显示在卡片上" />
            </Form.Item>
            <Form.Item name="faction" label="阵营" initialValue={c?.faction || undefined}>
              <AutoComplete
                allowClear placeholder="如：王国军 / 魔族（同名阵营自动同色）"
                options={[...new Set([...allCharMap.values()].map((x) => x.faction).filter(Boolean))].map((f) => ({
                  value: f, label: <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: factionColor(f), marginRight: 6 }} />{f}</span>,
                }))}
              />
            </Form.Item>
            <Form.Item name="alive" label="生死状态（档案默认值）" initialValue={c?.alive !== false} valuePropName="checked">
              <Switch checkedChildren="存活" unCheckedChildren="死亡" />
            </Form.Item>
          </Form>
        </>
      ),
    },
    {
      key: 'state', forceRender: true, label: <span>{dirty && tab === 'state' && <span style={{ color: '#7c5cff', marginRight: 5 }}>●</span>}本章状态</span>,
      disabled: isMerged,
      children: (
        <>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            阶段性信息（称呼/身份/生死/阵营）只影响本章；时间范围视图按所选章节回放。
            {isMerged ? '' : ''}
          </Typography.Text>
          <Form form={stateForm} layout="vertical" style={{ marginTop: 12 }} onValuesChange={() => setDirty(true)}>
            <Form.Item name="alias" label="本章称呼" initialValue={st?.alias}>
              <Input placeholder="如：神秘旅人" /></Form.Item>
            <Form.Item name="role" label="本章身份" initialValue={st?.role}>
              <Input placeholder="如：佣兵团长" /></Form.Item>
            <Form.Item name="status" label="状态" initialValue={st?.status}>
              <Input placeholder="如：下落不明" /></Form.Item>
            <Form.Item name="alive_mode" label="本章生死"
              initialValue={st == null || st.alive == null ? 'inherit' : st.alive ? 'alive' : 'dead'}>
              <Select options={[
                { value: 'inherit', label: '跟随档案（默认）' },
                { value: 'alive', label: '本章存活' },
                { value: 'dead', label: '本章死亡 💀' },
              ]} /></Form.Item>
            <Form.Item name="faction_chapter" label="本章阵营（留空跟随档案）" initialValue={st?.faction || undefined}>
              <AutoComplete allowClear
                placeholder={c?.faction ? `档案：${c.faction}` : '如：帝国（留空=跟随档案）'}
                options={[...new Set([...allCharMap.values()].map((x) => x.faction).filter(Boolean))].map((f) => ({ value: f }))} />
            </Form.Item>
            <Form.Item name="notes" label="本章备注" initialValue={st?.notes ?? ''}>
              <Input.TextArea rows={4} /></Form.Item>
          </Form>
        </>
      ),
    },
    {
      key: 'binding', forceRender: true, label: '章节绑定',
      children: (
        <>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>该人物出现在哪些章节的看板上。</Typography.Text>
          <div style={{ marginTop: 12 }}>
            {binding.isLoading ? <Typography.Text type="secondary">加载中…</Typography.Text> : (
              (binding.data || []).length ? (
                <Space size={6} wrap>
                  {(binding.data || []).map((ch) => (
                    <Tag key={ch.id} style={{ borderColor: 'transparent', background: avatarGradient(ch.id), color: '#fff' }}>
                      第{ch.order_index}章 · {ch.title}
                    </Tag>
                  ))}
                </Space>
              ) : <Typography.Text type="secondary">尚未加入任何章节</Typography.Text>
            )}
          </div>
        </>
      ),
    },
  ]

  return (
    <Drawer title={<span style={{ fontFamily: 'Orbitron, sans-serif', letterSpacing: '.12em', color: '#39dbff' }}>CHARACTER · {c?.name}</span>}
      open onClose={onClose}
      extra={
        <Space size={6}>
          <Button size="small" icon={<BookOutlined />} onClick={() => onOpenCodex(drawer.characterId)}>图鉴</Button>
          {!isMerged && (
            <Popconfirm title="从本章看板移除？（不影响人物档案）" onConfirm={() => onRemoveNode(drawer.characterId)}>
              <Button danger icon={<DeleteOutlined />} size="small">移出本章</Button></Popconfirm>
          )}
        </Space>
      }>
      <Tabs activeKey={tab} onChange={(t) => { setTab(t); setDirty(false) }} items={tabs}
        style={{ minHeight: 300 }} />
      <Divider style={{ margin: '8px 0 12px' }} />
      <Button type="primary" block icon={<SaveOutlined />} disabled={!dirty || tab === 'binding'}
        onClick={save} title="Ctrl+S">
        保存{tab === 'profile' ? '档案' : tab === 'state' ? '本章状态' : ''}
      </Button>
    </Drawer>
  )
}

/* ---------- 关系抽屉 ---------- */
function EdgeDrawer(p) {
  const { drawer, onClose, gid, chapterId, board, allCharMap, typeMap, isMerged, onSaved, onDeleteRelation } = p
  const [form] = Form.useForm()
  const { message } = AntApp.useApp()
  const r = (board?.relations || [])[drawer.index]
  if (!r) return <Drawer open={false} onClose={onClose} />
  const t = typeMap.get(r.relation_type_id)
  const rChapterId = isMerged ? r.chapter_id : chapterId
  return (
    <Drawer title={<span style={{ fontFamily: 'Orbitron, sans-serif', letterSpacing: '.12em', color: '#39dbff' }}>RELATION · 关系详情</span>}
      open onClose={onClose}
      extra={
        <Popconfirm title="删除这条关系？" onConfirm={() => onDeleteRelation(r)}>
          <Button danger icon={<DeleteOutlined />} size="small">删除关系</Button>
        </Popconfirm>
      }>
      <Space orientation="vertical" size={6} style={{ marginBottom: 18 }}>
        <Space size={12}>
          <Avatar style={{ background: avatarGradient(r.from_character_id) }}>{allCharMap.get(r.from_character_id)?.name?.[0]}</Avatar>
          <Tag color={t?.color} style={{ fontSize: 13, padding: '2px 12px' }}>{t?.name}</Tag>
          <Avatar style={{ background: avatarGradient(r.to_character_id) }}>{allCharMap.get(r.to_character_id)?.name?.[0]}</Avatar>
        </Space>
        <Space size={8} wrap>
          <Typography.Text type="secondary">{allCharMap.get(r.from_character_id)?.name} 与 {allCharMap.get(r.to_character_id)?.name}
            {t?.directional ? '（有向）' : ''} · {t?.default_description}</Typography.Text>
          {isMerged && r.chapter_title && <Tag color="geekblue">来源：{r.chapter_title}</Tag>}
        </Space>
      </Space>
      <Form form={form} layout="vertical" onFinish={(v) => {
        api(`/games/${gid}/boards/chapters/${rChapterId}/relations/${r.id}`, {
          method: 'PATCH', body: JSON.stringify({ description: v.description }),
        })
          .then(() => { message.success('关系说明已保存'); onSaved() })
          .catch((e) => message.error(e.message))
      }}>
        <Form.Item name="description" label="关系说明（发生了什么、为什么）" initialValue={r.description}>
          <Input.TextArea rows={5} placeholder="如：第二章共同逃出监狱，自此相互信任" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block>保存说明</Button>
      </Form>
    </Drawer>
  )
}
