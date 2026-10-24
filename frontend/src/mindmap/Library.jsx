import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useModuleNavigation } from '@/shared/module-navigation'
import { createMap, deleteMap, duplicateMap, importMap, listMaps, listWorkspaces, updateMap } from './api'
import { MAX_BYTES, MAX_ENVELOPE_BYTES, nameWithSuffix, newDocument, parseImport } from './data'
import { AssociationFields, MapIcon, Modal } from './ui'
import { formatDate } from './format'

const PAGE_SIZE = 18

export default function Library() {
  const navigate = useNavigate()
  const file = useRef(null)
  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [workspaces, setWorkspaces] = useState([])
  const [sort, setSort] = useState('updated_desc')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [form, setForm] = useState({ name: '', workspace_id: null, post_id: null })
  const [formError, setFormError] = useState('')

  useModuleNavigation({ title: '思维导图', accent: 'teal', items: [{ key: 'library', label: '我的导图', to: '/mindmap' }], activeKey: 'library', sidebar: <div className="mm-sidebar-note">把想法连成结构。<br />修改自动保存，历史可恢复。</div> })

  useEffect(() => { const timer = setTimeout(() => { setQuery(keyword); setPage(1) }, 250); return () => clearTimeout(timer) }, [keyword])
  useEffect(() => { let alive = true; listWorkspaces().then(result => { if (alive) setWorkspaces(Array.isArray(result) ? result : result.items || []) }).catch(() => {}); return () => { alive = false } }, [])
  useEffect(() => {
    let alive = true
    listMaps({ keyword: query, workspace_id: workspace, sort, page, page_size: PAGE_SIZE }).then(result => { if (alive) { setData(result); setError('') } }).catch(error => { if (alive) setError(error.message) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [query, workspace, sort, page, refresh])

  function openDialog(kind, item) {
    setForm({ name: item?.name || '', workspace_id: item?.workspace_id || null, post_id: item?.post_id || null })
    setFormError('')
    setDialog({ kind, item })
  }

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    if (dialog.kind !== 'delete' && !form.name.trim()) { setFormError('请输入导图名称'); return }
    setBusy(true); setFormError('')
    try {
      if (dialog.kind === 'create') {
        const map = await createMap({ ...form, name: form.name.trim(), document: newDocument(form.name.trim()) })
        navigate(`/mindmap/${map.id}`)
      } else if (dialog.kind === 'rename') {
        await updateMap(dialog.item.id, { ...form, name: form.name.trim(), revision: dialog.item.revision })
        setDialog(null); setRefresh(value => value + 1)
      } else if (dialog.kind === 'delete') {
        await deleteMap(dialog.item.id, dialog.item.revision)
        setDialog(null); setRefresh(value => value + 1)
      }
    } catch (error) { setFormError(error.status === 409 ? '这张导图已在其他页面更新。请关闭窗口并刷新列表后重试。' : error.message) }
    finally { setBusy(false) }
  }

  async function duplicate(item) {
    setBusy(true); setError('')
    try { const copy = await duplicateMap(item.id, item.revision, nameWithSuffix(item.name, ' · 副本')); navigate(`/mindmap/${copy.id}`) }
    catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  async function importFile(event) {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (!selected) return
    const limit = /\.json$/i.test(selected.name) ? MAX_ENVELOPE_BYTES : MAX_BYTES
    if (selected.size > limit) { setError('文件过大：导图内容上限为 10 MiB，JSON 元数据另留 16 KiB。'); return }
    setBusy(true); setError('')
    try {
      let payload
      if (/\.json$/i.test(selected.name)) payload = parseImport(await selected.text())
      else {
        const { parseExternalFile } = await import('./adapter')
        const document = await parseExternalFile(selected)
        payload = { format: 'doublog.mindmap', schema_version: 1, name: selected.name.replace(/\.[^.]+$/, ''), document }
      }
      const map = await importMap({ payload, ...(workspace ? { workspace_id: Number(workspace) } : {}) })
      navigate(`/mindmap/${map.id}`)
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  const names = Object.fromEntries(workspaces.map(item => [item.id, item.name]))
  return <>
    <header className="mm-library-header"><div><div className="mm-eyebrow"><MapIcon size={16} /> MIND MAPS</div><h1>思维导图</h1><p>整理知识、连接灵感，从一个中心主题开始。</p></div><div className="mm-actions"><input ref={file} type="file" accept=".json,.xmind,.md,.markdown" hidden onChange={importFile} /><button className="mm-button" disabled={busy} onClick={() => file.current?.click()}>导入文件</button><button className="mm-button mm-primary" disabled={busy} onClick={() => openDialog('create')}><span aria-hidden="true">＋</span> 新建导图</button></div></header>
    <div className="mm-library-filters"><div className="mm-search"><span aria-hidden="true">⌕</span><input aria-label="搜索导图" placeholder="搜索导图名称…" value={keyword} onChange={event => setKeyword(event.target.value)} />{keyword && <button aria-label="清空搜索" onClick={() => setKeyword('')}>×</button>}</div><select aria-label="按知识库筛选" value={workspace} onChange={event => { setWorkspace(event.target.value); setPage(1); setLoading(true) }}><option value="">全部知识库</option>{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="导图排序" value={sort} onChange={event => { setSort(event.target.value); setPage(1) }}><option value="updated_desc">最近更新</option><option value="created_desc">最近创建</option><option value="name_asc">名称 A–Z</option></select><span className="mm-list-count">{data?.total ?? '—'} 张导图</span><button className="mm-icon-button" aria-label="刷新导图列表" title="刷新" onClick={() => { setLoading(true); setRefresh(value => value + 1) }}>↻</button></div>
    {error && <div className="mm-banner mm-danger" role="alert">{error}<button onClick={() => setRefresh(value => value + 1)}>重试</button></div>}
    {busy && !dialog && <div className="mm-banner" role="status">正在处理导图…</div>}
    {loading ? <div className="mm-loading" role="status">正在加载导图…</div> : data?.items?.length ? <div className="mm-map-grid">{data.items.map(item => <article key={item.id} className="mm-map-card"><Link className="mm-card-open" to={`/mindmap/${item.id}`}><div className="mm-map-preview" aria-hidden="true"><span className="mm-preview-center"><MapIcon size={24} /></span><span className="mm-preview-branch mm-preview-one" /><span className="mm-preview-branch mm-preview-two" /><span className="mm-preview-branch mm-preview-three" /><span className="mm-preview-branch mm-preview-four" /></div><div className="mm-card-content"><h2 title={item.name}>{item.name}</h2><p>{item.workspace_id ? names[item.workspace_id] || '关联知识库' : '独立导图'}{item.post_id ? ' · 已关联文章' : ''}</p><div className="mm-card-meta"><span>{item.node_count || 1} 个节点</span><span>v{item.revision}</span><span>{formatDate(item.updated_at)}</span></div></div></Link><div className="mm-card-actions"><Link to={`/mindmap/${item.id}?mode=read`}>只读打开</Link><div><button disabled={busy} onClick={() => duplicate(item)} title="复制导图">复制</button><button disabled={busy} onClick={() => openDialog('rename', item)} title="重命名或关联文章">设置</button><button className="mm-danger-text" disabled={busy} onClick={() => openDialog('delete', item)}>删除</button></div></div></article>)}</div> : <div className="mm-empty"><div className="mm-empty-icon"><MapIcon size={34} /></div><h2>{query || workspace ? '没有找到匹配的导图' : '让第一个想法开始生长'}</h2><p>{query || workspace ? '试试其他关键词，或切换知识库筛选。' : '新建思维导图，或导入 JSON、XMind、Markdown 文件。'}</p>{!query && !workspace && <button className="mm-button mm-primary" onClick={() => openDialog('create')}>新建第一张导图</button>}</div>}
    {data?.total_pages > 1 && <footer className="mm-pagination"><span>第 {page} / {data.total_pages} 页</span><button className="mm-button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><button className="mm-button" disabled={page >= data.total_pages} onClick={() => setPage(value => value + 1)}>下一页</button></footer>}
    {dialog && <Modal title={dialog.kind === 'create' ? '新建思维导图' : dialog.kind === 'rename' ? '导图设置' : '删除思维导图'} onClose={() => { if (!busy) setDialog(null) }}><form onSubmit={submit}>{dialog.kind === 'delete' ? <p className="mm-dialog-copy">确定删除「{dialog.item.name}」？此操作无法撤销。</p> : <><label className="mm-field">导图名称<input autoFocus maxLength={200} value={form.name} placeholder="例如：产品规划" onChange={event => setForm({ ...form, name: event.target.value })} /></label><AssociationFields workspaceId={form.workspace_id} postId={form.post_id} onChange={values => setForm({ ...form, ...values })} disabled={busy} /></>}{formError && <p role="alert" className="mm-error">{formError}</p>}<div className="mm-dialog-actions"><button type="button" className="mm-button" disabled={busy} onClick={() => setDialog(null)}>取消</button><button className={`mm-button ${dialog.kind === 'delete' ? 'mm-delete-button' : 'mm-primary'}`} disabled={busy}>{busy ? '处理中…' : dialog.kind === 'delete' ? '确认删除' : dialog.kind === 'create' ? '创建并开始编辑' : '保存设置'}</button></div></form></Modal>}
  </>
}
