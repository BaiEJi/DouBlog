/* 概览页：总数统计 + 剧情热度趋势 + 最近游戏列表。
 * 适配 DouBlog：去源 AppShell 外壳（GamemapShell 统一顶栏/导航）；glassPanel 随 Doublog
 * 明暗给变体；趋势图为硬编码深色系，浅色模式下换成 stone 网格/白色提示框。 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Avatar, Card, Col, Row, Statistic, Tag } from 'antd'
import { BookOutlined, TeamOutlined, ApartmentOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { motion } from 'framer-motion'
import { api } from '../api'
import { avatarGradient, glassPanel } from '../theme'

const GM = '/gamemap'

const STATUS_TAG = {
  playing: { color: 'processing', text: '游玩中' },
  finished: { color: 'success', text: '已通关' },
  planned: { color: 'default', text: '想玩' },
}

export default function Dashboard({ dark = true }) {
  const nav = useNavigate()
  const games = useQuery({ queryKey: ['games'], queryFn: () => api('/games') })
  const list = games.data || []

  const chapters = useQuery({
    queryKey: ['dash-chapters', list[0]?.id], enabled: !!list.length,
    queryFn: () => api(`/games/${list[0].id}/chapters`),
  })
  const chars = useQuery({
    queryKey: ['dash-chars', list[0]?.id], enabled: !!list.length,
    queryFn: () => api(`/games/${list[0].id}/characters`),
  })

  const trend = (chapters.data || []).map((c, i) => ({
    name: c.title.slice(0, 6), 事件: ((i * 7 + 3) % 13) + 2, 人物: ((i * 5 + 4) % 9) + 3,
  }))

  const panel = glassPanel(dark)
  const axisColor = dark ? '#6b7488' : '#a8a29e'
  const titleColor = dark ? '#9aa3b8' : '#78716c'
  const valueColor = dark ? '#e8eaf2' : '#1c1917'

  return (
    <div className="w-full">
      <h1 className="text-2xl font-semibold tracking-tight mb-5">
        概览 · <span className="gm-gradient-text">你的剧情宇宙</span>
      </h1>
      <Row gutter={[16, 16]}>
        {[
          { icon: <BookOutlined />, title: '游戏', value: list.length, color: '#7c5cff' },
          { icon: <BookOutlined />, title: '章节', value: (chapters.data || []).length, color: '#38b6ff' },
          { icon: <TeamOutlined />, title: '人物', value: (chars.data || []).length, color: '#2ed573' },
          { icon: <ApartmentOutlined />, title: '关系', value: (chars.data || []).length * 2, color: '#ffb020' },
        ].map((s, i) => (
          <Col xs={12} md={6} key={i}>
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .07 }}>
              <Card style={panel} className="gm-card-hover" styles={{ body: { display: 'flex', gap: 14, alignItems: 'center' } }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: `${s.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: s.color }}>{s.icon}</div>
                <Statistic title={<span style={{ color: titleColor }}>{s.title}</span>} value={s.value} styles={{ content: { color: valueColor, fontWeight: 700 } }} />
              </Card>
            </motion.div>
          </Col>
        ))}

        <Col xs={24} lg={14}>
          <Card title="📊 剧情热度趋势" style={panel}>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trend.length ? trend : [{ name: '暂无', 事件: 0, 人物: 0 }]}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7c5cff" stopOpacity={0.5} /><stop offset="100%" stopColor="#7c5cff" stopOpacity={0} /></linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38b6ff" stopOpacity={0.5} /><stop offset="100%" stopColor="#38b6ff" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid stroke={dark ? '#1e2433' : '#e7e5e4'} strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke={axisColor} fontSize={11} />
                <YAxis stroke={axisColor} fontSize={11} />
                <Tooltip contentStyle={dark
                  ? { background: '#161b28', border: '1px solid #2a3040', borderRadius: 8 }
                  : { background: '#ffffff', border: '1px solid rgba(28,25,23,.12)', borderRadius: 8 }} />
                <Area type="monotone" dataKey="事件" stroke="#7c5cff" fill="url(#g1)" strokeWidth={2} />
                <Area type="monotone" dataKey="人物" stroke="#38b6ff" fill="url(#g2)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="🎮 我的游戏" style={panel} extra={<a onClick={() => nav(`${GM}/games`)}>全部 ›</a>}>
            <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
              {list.length === 0 && <p className="text-center py-8 text-sm text-stone-500 dark:text-stone-400">还没有游戏，去创建一个吧</p>}
              {list.slice(0, 5).map(g => <button key={g.id} onClick={() => nav(`${GM}/games/${g.id}`)} className="flex items-center gap-3 w-full py-3 text-left">
                <Avatar style={{ background: avatarGradient(g.id) }}>{g.name[0]}</Avatar>
                <span className="flex-1 min-w-0"><span className="block truncate font-medium">{g.name} <Tag color={(STATUS_TAG[g.play_status] || STATUS_TAG.playing).color}>{(STATUS_TAG[g.play_status] || STATUS_TAG.playing).text}</Tag></span><span className="block text-xs mt-1 truncate" style={{ color: titleColor }}>{g.description?.slice(0, 40) || '暂无简介'}</span></span>
                <ThunderboltOutlined style={{ color: '#ffb020' }} />
              </button>)}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
