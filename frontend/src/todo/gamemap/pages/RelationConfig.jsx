/* 关系类型配置页（全局默认类型，只读展示）。
 * 适配 DouBlog：去源 AppShell 外壳；glassPanel 随 Doublog 明暗。 */
import { useQuery } from '@tanstack/react-query'
import { Badge, Card, Col, Row, Space, Table, Tag, Typography } from 'antd'
import { api } from '../api'
import { glassPanel } from '../theme'

export default function RelationConfig({ dark = true }) {
  const types = useQuery({ queryKey: ['globalTypes'], queryFn: () => api('/relation-types') })
  const list = types.data || []
  const panel = glassPanel(dark)

  return (
    <div className="mx-auto max-w-[1700px] px-4 sm:px-6 xl:px-10 py-6">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <h1 className="text-lg font-semibold tracking-tight">关系配置 · <span className="gm-gradient-text">全局默认类型</span></h1>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>游戏可在工作区中覆盖样式或新增自定义类型</Typography.Text>
      </div>
      <Row gutter={[16, 16]}>
        {list.map((t) => (
          <Col xs={24} sm={12} md={8} lg={6} key={t.id}>
            <Card style={panel} className="gm-card-hover"
              title={<Space><span style={{ display: 'inline-block', width: 26, height: 4, borderRadius: 2, background: t.color }} />{t.name}</Space>}
              extra={<Badge status={t.enabled ? 'success' : 'default'} text={t.enabled ? '可用' : '已停用'} />}
              styles={{ body: { paddingTop: 12 } }}>
              <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>标识：{t.key}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>默认说明：{t.default_description || '—'}</Typography.Text>
                <Space size={6} style={{ marginTop: 6 }}>
                  <Tag style={{ borderColor: 'transparent', color: t.color, background: `${t.color}22` }}>{t.color}</Tag>
                  {t.line_style === 'dashed' ? <Tag>虚线</Tag> : <Tag>实线</Tag>}
                  {t.directional ? <Tag color="purple">有向</Tag> : <Tag>无向</Tag>}
                </Space>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Card title="📋 类型总览" style={{ ...panel, marginTop: 18 }}>
        <Table rowKey="id" dataSource={list} pagination={false}
          columns={[
            { title: '排序', dataIndex: 'order_index', width: 70 },
            { title: '名称', render: (_, t) => <span style={{ color: t.color, fontWeight: 600 }}>{t.name}</span> },
            { title: '标识', dataIndex: 'key' },
            { title: '线型', render: (_, t) => (t.line_style === 'dashed' ? '虚线' : '实线') },
            { title: '方向', render: (_, t) => (t.directional ? '有向' : '无向') },
            { title: '状态', render: (_, t) => <Badge status={t.enabled ? 'success' : 'default'} text={t.enabled ? '可用' : '停用'} /> },
          ]} />
      </Card>
    </div>
  )
}
