/* 全局搜索页：游戏/章节/人物/关系/剧情全文检索。
 * 适配 DouBlog：去源 AppShell 外壳；跳转挂 /gamemap 前缀；glassPanel 随明暗。 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { App as AntApp, Button, Card, Empty, Input, Segmented, Space, Tag, Typography } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { api } from '../api'
import { glassPanel } from '../theme'

const GM = '/gamemap'

/** Hit: { game_id, chapter_id, kind, title, snippet, ref_id } */

const KIND_META = {
  game: { label: '游戏', color: '#7c5cff', icon: '🎮' },
  chapter: { label: '章节', color: '#38b6ff', icon: '📖' },
  character: { label: '人物', color: '#2ed573', icon: '👤' },
  relation: { label: '关系', color: '#ffb020', icon: '🔗' },
  event: { label: '剧情', color: '#f368e0', icon: '📜' },
}

export default function SearchPage({ dark = true }) {
  const nav = useNavigate()
  const { message } = AntApp.useApp()
  const [q, setQ] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [kind, setKind] = useState('all')

  const hits = useQuery({
    queryKey: ['search', submitted], enabled: !!submitted,
    queryFn: () => api(`/search?q=${encodeURIComponent(submitted)}`),
  })

  const list = (hits.data || []).filter((h) => kind === 'all' || h.kind === kind)
  const kinds = ['all', ...new Set((hits.data || []).map((h) => h.kind))]
  const panel = glassPanel(dark)

  return (
    <div className="w-full">
      <h1 className="text-lg font-semibold tracking-tight mb-5">全局搜索 · <span className="gm-gradient-text">找人物、找关系、找剧情</span></h1>
      <Space.Compact style={{ width: '100%', maxWidth: 640, marginBottom: 18 }}>
        <Input size="large" prefix={<SearchOutlined style={{ color: '#6b7488' }} />} placeholder="输入关键词：人物名、称呼、关系说明、剧情…"
          value={q} onChange={(e) => setQ(e.target.value)} onPressEnter={() => setSubmitted(q.trim())}
          allowClear />
        <Button type="primary" size="large" onClick={() => { if (!q.trim()) return message.warning('请输入关键词'); setSubmitted(q.trim()) }}>搜索</Button>
      </Space.Compact>

      {submitted && (
        <>
          <Segmented value={kind} onChange={(v) => setKind(v)} style={{ marginBottom: 14, maxWidth: '100%', overflowX: 'auto' }}
            options={kinds.map((k) => ({ value: k, label: k === 'all' ? `全部 ${hits.data?.length || 0}` : `${KIND_META[k]?.icon || ''} ${KIND_META[k]?.label || k} ${(hits.data || []).filter((h) => h.kind === k).length}` }))} />
          {list.length === 0 && !hits.isLoading ? <Empty description={`没有找到与「${submitted}」相关的内容`} /> : (
            <Card style={panel}>
              {hits.isLoading ? <p role="status" className="py-6 text-center text-sm text-stone-500 dark:text-stone-400">搜索中…</p> : <ul className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
                {list.map((h, index) => {
                  const m = KIND_META[h.kind] || { label: h.kind, color: '#888', icon: '•' }
                  return <li key={`${h.kind}:${h.ref_id}:${index}`}><button type="button" className="w-full flex items-start gap-3.5 py-3 text-left" onClick={() => {
                    if (h.game_id) nav(h.chapter_id ? `${GM}/games/${h.game_id}/chapters/${h.chapter_id}` : `${GM}/games/${h.game_id}`)
                    else message.info('该结果属于看板关系，请到对应章节查看')
                  }}>
                    <span style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 12, background: `${m.color}1e`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{m.icon}</span>
                    <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><Typography.Text strong>{h.title || m.label}</Typography.Text><Tag style={{ borderColor: 'transparent', color: m.color, background: `${m.color}22` }}>{m.label}</Tag></span>
                    <span className="block mt-1 text-xs text-stone-500 dark:text-stone-400 break-words">{h.snippet || '—'}</span></span>
                  </button></li>
                })}
              </ul>}

            </Card>
          )}
        </>
      )}
      {!submitted && (
        <Card style={panel}>
          <Typography.Paragraph type="secondary">
            支持搜索：🎮 游戏名称 · 📖 章节标题与摘要 · 👤 人物名称和章节称呼 · 🔗 关系说明 · 📜 剧情事件标题与正文
          </Typography.Paragraph>
        </Card>
      )}
    </div>
  )
}
