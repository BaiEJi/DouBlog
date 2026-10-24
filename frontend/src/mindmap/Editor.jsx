import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useModuleNavigation } from '@/shared/module-navigation'
import { createEditor, parseExternalFile } from './adapter'
import { createMap, download, getMap, getVersion, importMap, listVersions, restoreVersion, saveDocument, updateMap } from './api'
import { MAX_BYTES, MAX_ENVELOPE_BYTES, encodeExport, nameWithSuffix, outlineNodes, parseImport } from './data'
import { createSaveController } from './saveController'
import Inspector from './Inspector'
import { AssociationFields, MapIcon, Modal } from './ui'
import { formatDate } from './format'

const SAVE_LABELS = { saved: '已保存', dirty: '等待保存…', saving: '正在保存…', offline: '离线 · 修改保留在本机', conflict: '版本冲突 · 尚未保存', error: '保存失败 · 尚未保存' }
const PALETTES = { teal: ['#0d9488', '#f0fdfa'], indigo: ['#6366f1', '#eef2ff'], amber: ['#d97706', '#fffbeb'], rose: ['#e11d48', '#fff1f2'], mono: ['#57534e', '#f5f5f4'] }

function Tool({ label, title, onClick, disabled, children, active }) {
  return <button className={`mm-tool ${active ? 'active' : ''}`} type="button" title={title || label} aria-label={label} disabled={disabled} onClick={onClick}>{children && <span className="mm-tool-symbol" aria-hidden="true">{children}</span>}<span>{label}</span></button>
}

export default function Editor({ dark }) {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const readOnly = searchParams.get('mode') === 'read'
  const canvas = useRef(null)
  const minimap = useRef(null)
  const fullscreenElement = useRef(null)
  const adapter = useRef(null)
  const saver = useRef(null)
  const documentRef = useRef(null)
  const mapRef = useRef(null)
  const importInput = useRef(null)
  const searchInput = useRef(null)
  const darkRef = useRef(dark)
  const readOnlyRef = useRef(readOnly)
  const [map, setMap] = useState(null)
  const [document, setDocument] = useState(null)
  const [selection, setSelection] = useState([])
  const [saveState, setSaveState] = useState({ status: 'saved', revision: 1, pending: false })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loadKey, setLoadKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('node')
  const [showPanel, setShowPanel] = useState(true)
  const [showMinimap, setShowMinimap] = useState(true)
  const [scale, setScale] = useState(1)
  const [draft, setDraft] = useState(null)
  const [focused, setFocused] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [resultIndex, setResultIndex] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [form, setForm] = useState({ name: '', workspace_id: null, post_id: null })
  const [versions, setVersions] = useState({ items: [], page: 0, loading: false, error: '' })
  const [exportType, setExportType] = useState('json')

  useModuleNavigation({ title: '思维导图', accent: 'teal', items: [{ key: 'library', label: '我的导图', to: '/mindmap' }, { key: 'editor', label: map?.name || '导图编辑器', children: [{ key: 'node', label: '节点属性' }, { key: 'outline', label: '导图大纲' }, { key: 'design', label: '布局与主题' }, { key: 'history', label: '版本历史' }] }], activeKey: tab, onSelect: key => { if (key === 'editor') return; setTab(key); setShowPanel(true); if (key === 'history') void loadVersions() }, sidebar: <div className="mm-sidebar-note"><span className={`mm-save-dot ${saveState.status}`} />{readOnly ? '只读查看' : SAVE_LABELS[saveState.status]}<br /><span className="mm-hint">{map ? `版本 v${saveState.revision} · ${map.node_count || 1} 个节点` : '正在加载'}</span></div> })

  function setMapValue(next) { mapRef.current = next; setMap(next) }
  function setDocumentValue(next) { documentRef.current = next; setDocument(next) }

  useEffect(() => { darkRef.current = dark; adapter.current?.setDark(dark) }, [dark])
  useEffect(() => { readOnlyRef.current = readOnly; adapter.current?.setReadOnly(readOnly) }, [readOnly])

  useEffect(() => {
    let alive = true
    let instance = null
    let controller = null
    setLoading(true); setLoadError(''); setSelection([]); setDraft(null); setFocused(null); setQuery(''); setResults([])
    ;(async () => {
      try {
        const next = await getMap(id)
        if (!alive) return
        setMapValue(next); setDocumentValue(next.document)
        controller = createSaveController({ id: next.id, revision: next.revision, document: next.document,
          save: body => saveDocument(next.id, body),
          onState: state => { if (alive) setSaveState(state) },
          onSaved: saved => { if (alive) setMapValue({ ...mapRef.current, ...saved, document: documentRef.current }) },
        })
        saver.current = controller
        const local = controller.recover()
        if (local && alive) setDraft(local)
        instance = await createEditor({ el: canvas.current, minimapEl: minimap.current, document: next.document, dark: darkRef.current, readOnly: readOnlyRef.current,
          onChange: nextDocument => {
            if (!alive) return
            setDocumentValue(nextDocument)
            if (!readOnlyRef.current) controller.change(nextDocument)
          },
          onSelect: nextSelection => { if (alive) setSelection(nextSelection || []) },
          onScale: value => { if (alive) setScale(typeof value === 'number' ? value : value?.scale || 1) },
          onError: error => { if (alive) setError(error.message || String(error)) },
        })
        if (!alive) { instance.destroy(); return }
        adapter.current = instance
        setLoading(false)
      } catch (error) { if (alive) { setLoadError(error.message); setLoading(false) } }
    })()
    return () => {
      instance?.commit?.()
      controller?.dispose()
      alive = false
      instance?.destroy()
      if (adapter.current === instance) adapter.current = null
      if (saver.current === controller) saver.current = null
    }
  }, [id, loadKey])

  useEffect(() => {
    const beforeUnload = event => {
      adapter.current?.commit?.()
      if (saver.current?.getState().pending) { event.preventDefault(); event.returnValue = '' }
    }
    const saveShortcut = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!readOnlyRef.current) {
          adapter.current?.commit?.()
          saver.current?.flush().then(() => { setNotice('导图已保存到服务器。'); setError('') }).catch(error => setError(error.message))
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); searchInput.current?.focus() }
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('keydown', saveShortcut)
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('keydown', saveShortcut) }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!adapter.current) return
      try {
        const found = adapter.current.search(query.trim()) || []
        setResults(found); setResultIndex(0)
        if (found.length && query.trim()) void locate(found[0].uid)
      } catch (error) { setError(error.message) }
    }, 220)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer) }, [notice])

  function flushEditor() {
    adapter.current?.commit?.()
    return saver.current?.flush()
  }

  async function manualSave() {
    if (!saver.current || readOnlyRef.current) return
    try { await flushEditor(); setNotice('导图已保存到服务器。'); setError('') }
    catch (error) { setError(error.message) }
  }

  async function command(name, ...args) {
    try { await adapter.current?.command(name, ...args) }
    catch (error) { setError(error.message) }
  }

  function patch(data) {
    try { adapter.current?.setNodeData(data) }
    catch (error) { setError(error.message) }
  }

  async function loadVersions(more = false) {
    if (!mapRef.current) return
    const page = more ? versions.page + 1 : 1
    setVersions(current => ({ ...current, loading: true, error: '' }))
    try {
      const data = await listVersions(id, page)
      setVersions(current => ({ items: more ? [...current.items, ...data.items] : data.items, page, loading: false, error: '', hasMore: page < data.total_pages }))
    } catch (error) { setVersions(current => ({ ...current, loading: false, error: error.message })) }
  }

  async function changeMode() {
    if (!readOnly && saver.current?.getState().pending) {
      try { await flushEditor() } catch (error) { setError(error.message); return }
    }
    const next = new URLSearchParams(searchParams)
    if (readOnly) next.delete('mode'); else next.set('mode', 'read')
    setSearchParams(next, { replace: true })
  }

  async function locate(uid) {
    try { await adapter.current?.locate(uid) }
    catch (error) { setError(error.message) }
  }

  function navigateResults(delta) {
    if (!results.length) return
    const index = (resultIndex + delta + results.length) % results.length
    setResultIndex(index); void locate(results[index].uid)
  }

  function changeTheme(palette, custom) {
    const [color] = PALETTES[palette] || [custom]
    try { adapter.current?.setTheme('default', { ...(documentRef.current?.theme?.config || {}), doublogPalette: palette, lineColor: color, root: { fillColor: color, color: '#ffffff', borderColor: color }, second: { borderColor: color }, node: { borderColor: color } }) }
    catch (error) { setError(error.message) }
  }

  async function focus(uid) {
    try { await adapter.current?.focus(uid); setFocused(uid) }
    catch (error) { setError(error.message) }
  }

  async function exportCurrent() {
    if (!adapter.current || !mapRef.current) return
    setBusy(true); setError('')
    try {
      adapter.current.commit?.()
      if (exportType === 'json') download(`${mapRef.current.name}.json`, encodeExport({ ...mapRef.current, revision: saver.current?.getState().revision || mapRef.current.revision }, adapter.current.getDocument()))
      else await adapter.current.export(exportType, mapRef.current.name)
      setNotice(saveState.pending ? '已导出当前编辑内容，服务器仍有待保存修改。' : '导出完成。')
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  async function selectImport(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const limit = /\.json$/i.test(file.name) ? MAX_ENVELOPE_BYTES : MAX_BYTES
    if (file.size > limit) { setError('文件过大：导图内容上限为 10 MiB，JSON 元数据另留 16 KiB。'); return }
    setBusy(true); setError('')
    try {
      const payload = /\.json$/i.test(file.name) ? parseImport(await file.text()) : { format: 'doublog.mindmap', schema_version: 1, name: file.name.replace(/\.[^.]+$/, ''), document: await parseExternalFile(file) }
      setDialog({ kind: 'import', payload })
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  async function applyImport(asNew) {
    setBusy(true); setError('')
    try {
      if (asNew) {
        const created = await importMap({ payload: dialog.payload, workspace_id: map.workspace_id, post_id: map.post_id })
        setDialog(null); navigate(`/mindmap/${created.id}`)
      } else {
        await flushEditor()
        await importMap({ payload: dialog.payload, target_id: Number(id), revision: saver.current.getState().revision, workspace_id: map.workspace_id, post_id: map.post_id })
        setDialog(null); setLoadKey(value => value + 1); setNotice('导图已导入；导入前的版本保留在历史中。')
      }
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  async function saveMetadata(event) {
    event.preventDefault()
    if (!form.name.trim()) { setError('导图名称不能为空。'); return }
    setBusy(true); setError('')
    try {
      await flushEditor()
      const next = await updateMap(id, { ...form, name: form.name.trim(), revision: saver.current.getState().revision })
      saver.current.setRevision(next.revision)
      setMapValue({ ...mapRef.current, ...next }); setDialog(null); setNotice('导图信息已更新。')
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  async function restore(revision) {
    setBusy(true); setError('')
    try {
      await flushEditor()
      await restoreVersion(id, saver.current.getState().revision, revision)
      setDialog(null); setLoadKey(value => value + 1); setNotice(`已恢复 v${revision}，并创建了一个新版本。`)
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  async function previewVersion(revision) {
    setBusy(true); setError('')
    try { const version = await getVersion(id, revision); setDialog({ kind: 'version', version }) }
    catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  async function saveAsNew() {
    setBusy(true); setError('')
    try {
      const created = await createMap({ name: nameWithSuffix(mapRef.current.name, ' · 本地副本'), workspace_id: mapRef.current.workspace_id, post_id: mapRef.current.post_id, document: adapter.current?.getDocument() || documentRef.current })
      saver.current.discardDraft(); setDialog(null); navigate(`/mindmap/${created.id}`)
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  async function recoverDraft() {
    try {
      await adapter.current.setDocument(draft.document)
      setDocumentValue(draft.document)
      saver.current.change(draft.document)
      setDraft(null); setNotice('本机草稿已恢复到画布，将自动保存。')
    } catch (error) { setError(error.message) }
  }

  async function saveDraftAsNew() {
    setBusy(true); setError('')
    try {
      const created = await createMap({ name: nameWithSuffix(mapRef.current.name, ' · 恢复草稿'), workspace_id: mapRef.current.workspace_id, post_id: mapRef.current.post_id, document: draft.document })
      saver.current.discardDraft(); setDraft(null); navigate(`/mindmap/${created.id}`)
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  function reloadServer() {
    saver.current?.discardDraft()
    setDialog(null); setLoadKey(value => value + 1)
  }

  async function toggleFullscreen() {
    try {
      if (window.document.fullscreenElement) await window.document.exitFullscreen()
      else await fullscreenElement.current?.requestFullscreen()
    } catch (error) { setError(error.message || '浏览器暂不支持全屏。') }
  }

  const outline = document?.root ? outlineNodes(document.root) : []
  const blocked = readOnly || loading || busy
  const metadata = () => { setForm({ name: map.name, workspace_id: map.workspace_id, post_id: map.post_id }); setDialog({ kind: 'metadata' }); setError('') }
  return <div className="mm-editor" ref={fullscreenElement}>
    <header className="mm-editor-header"><div className="mm-editor-title"><Link to="/mindmap" className="mm-icon-button" title="返回导图库" aria-label="返回导图库">←</Link><div className="mm-title-icon"><MapIcon size={22} /></div><div className="mm-title-block"><h1><button disabled={blocked || !map} onClick={metadata} title="编辑导图名称">{map?.name || '思维导图'}</button></h1><div className="mm-save-state" role="status"><span className={`mm-save-dot ${saveState.status}`} />{readOnly ? '只读模式' : SAVE_LABELS[saveState.status]}{map && <span>· v{saveState.revision} · {outline.length || map.node_count} 个节点</span>}</div></div></div><div className="mm-actions"><button className="mm-button" onClick={changeMode} disabled={loading || busy}>{readOnly ? '进入编辑' : '只读查看'}</button><button className="mm-button mm-primary" disabled={blocked || saveState.status === 'saving' || saveState.status === 'conflict'} onClick={manualSave}>{saveState.status === 'saving' ? '正在保存…' : '保存'}</button></div></header>
    {loadError && <div className="mm-banner mm-danger" role="alert">加载失败：{loadError}<button onClick={() => setLoadKey(value => value + 1)}>重新加载</button><Link to="/mindmap">返回列表</Link></div>}
    {error && <div className="mm-banner mm-danger" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="关闭错误提示">×</button></div>}
    {notice && <div className="mm-banner mm-success" role="status">{notice}</div>}
    {draft && !readOnly && <div className="mm-banner mm-warning"><span>发现 {formatDate(new Date(draft.timestamp).toISOString())} 的本机草稿{draft.revision !== map?.revision ? '，其基础版本与服务器不同。恢复前请先另存副本以便对比。' : '。上次关闭前的修改尚未确认保存。'}</span><button onClick={draft.revision === map?.revision ? recoverDraft : saveDraftAsNew} disabled={loading || busy}>{draft.revision === map?.revision ? '恢复草稿' : '将草稿另存为新图'}</button><button onClick={() => { saver.current.discardDraft(); setDraft(null) }}>放弃草稿</button></div>}
    {saveState.status === 'conflict' && <div className="mm-banner mm-warning" role="alert"><span>服务器上已有新版本。本机修改仍保留，自动保存已暂停。</span><button disabled={busy} onClick={saveAsNew}>将本机修改另存为新图</button><button onClick={() => setDialog({ kind: 'reload' })}>加载服务器版本</button></div>}
    {['error', 'offline'].includes(saveState.status) && <div className="mm-banner mm-warning" role="alert"><span>{saveState.error?.message || '修改尚未保存到服务器。本机草稿可在此浏览器中恢复。'}</span><button disabled={busy} onClick={() => saver.current.retry().catch(error => setError(error.message))}>重试保存</button><button disabled={busy} onClick={saveAsNew}>另存副本</button></div>}
    <div className="mm-toolbar" role="toolbar" aria-label="思维导图工具栏"><div className="mm-tool-group"><Tool label="子节点" title="新增子节点 (Tab)" disabled={blocked} onClick={() => command('addChild')}>＋</Tool><Tool label="同级" title="新增同级节点 (Enter)" disabled={blocked || !selection.length} onClick={() => command('addSibling')}>↳</Tool><Tool label="编辑" title="编辑节点 (F2)" disabled={blocked || !selection.length} onClick={() => command('edit')}>✎</Tool></div><div className="mm-tool-group"><Tool label="撤销" title="撤销 (Ctrl Z)" disabled={blocked} onClick={() => command('undo')}>↶</Tool><Tool label="重做" title="重做 (Ctrl Y)" disabled={blocked} onClick={() => command('redo')}>↷</Tool></div><div className="mm-tool-group"><Tool label="复制" title="复制节点 (Ctrl C)" disabled={loading || !selection.length} onClick={() => command('copy')}>⧉</Tool><Tool label="剪切" title="剪切节点 (Ctrl X)" disabled={blocked || !selection.length} onClick={() => command('cut')}>✂</Tool><Tool label="粘贴" title="粘贴节点 (Ctrl V)" disabled={blocked} onClick={() => command('paste')}>▣</Tool><Tool label="删除" title="删除节点 (Delete)" disabled={blocked || !selection.length} onClick={() => command('delete')}>×</Tool></div><div className="mm-tool-group"><Tool label="关联线" disabled={blocked || !selection.length} onClick={() => command('addRelation')}>↔</Tool><Tool label="概要" disabled={blocked || !selection.length} onClick={() => command('addSummary')}>{'}'}</Tool></div><div className="mm-toolbar-end"><Tool label="设计" active={showPanel && tab === 'design'} onClick={() => { setShowPanel(true); setTab('design') }}>◈</Tool><Tool label={showPanel ? '收起面板' : '展开面板'} onClick={() => setShowPanel(value => !value)}>☷</Tool></div></div>
    <div className="mm-canvas-shell"><div className="mm-canvas-main"><div className="mm-search-bar"><div className="mm-search mm-node-search"><span aria-hidden="true">⌕</span><input ref={searchInput} aria-label="搜索节点" value={query} placeholder="搜索节点… Ctrl F" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') navigateResults(event.shiftKey ? -1 : 1); if (event.key === 'Escape') setQuery('') }} />{query && <><span className="mm-search-counter">{results.length ? resultIndex + 1 : 0}/{results.length}</span><button disabled={!results.length} aria-label="上一个结果" onClick={() => navigateResults(-1)}>↑</button><button disabled={!results.length} aria-label="下一个结果" onClick={() => navigateResults(1)}>↓</button><button aria-label="清空节点搜索" onClick={() => setQuery('')}>×</button></>}</div>{focused && <button className="mm-button mm-small" onClick={async () => { try { await adapter.current?.unfocus(); setFocused(null) } catch (error) { setError(error.message) } }}>退出分支聚焦</button>}{readOnly && <span className="mm-chip">只读</span>}</div><div className="mm-canvas" ref={canvas} data-testid="mindmap-canvas" />{loading && <div className="mm-canvas-loading" role="status"><span className="mm-spinner" />正在加载导图…</div>}<div ref={minimap} className={`mm-minimap ${showMinimap ? '' : 'mm-hidden'}`} aria-label="导图小地图" /><div className="mm-canvas-bottom"><div className="mm-canvas-help">{readOnly ? '拖动画布平移 · 滚轮缩放' : '双击编辑 · Tab 子节点 · Enter 同级 · Ctrl 多选'}</div><div className="mm-view-controls"><button title="缩小" aria-label="缩小画布" onClick={() => adapter.current?.zoom(0.85)}>−</button><span>{Math.round(scale * 100)}%</span><button title="放大" aria-label="放大画布" onClick={() => adapter.current?.zoom(1.15)}>＋</button><span className="mm-control-divider" /><button title="适应屏幕" aria-label="适应屏幕" onClick={() => adapter.current?.fit()}>⛶</button><button title="回到中心" aria-label="回到中心" onClick={() => adapter.current?.center()}>◎</button><button title="切换小地图" aria-label="切换小地图" aria-pressed={showMinimap} onClick={() => setShowMinimap(value => !value)}>▧</button><button title="全屏" aria-label="全屏编辑" onClick={toggleFullscreen}>↗</button></div></div></div>
    {showPanel && map && <Inspector tab={tab} setTab={setTab} selection={selection} onPatch={patch} command={command} outline={outline} locate={locate} focus={focus} focused={focused} readOnly={readOnly} map={{ ...map, revision: saveState.revision }} document={document} onLayout={layout => adapter.current?.setLayout(layout)} onTheme={changeTheme} onMetadata={metadata} versions={versions} onVersions={loadVersions} onRestore={revision => setDialog({ kind: 'restore', revision })} onVersionPreview={previewVersion} onError={setError} />}</div>
    <footer className="mm-editor-footer"><span>{saveState.pending ? '修改尚未确认保存到服务器' : map ? `最近更新 ${formatDate(map.updated_at)}` : '加载中…'}</span><div className="mm-export-actions"><input ref={importInput} hidden type="file" accept=".json,.md,.markdown,.xmind" onChange={selectImport} /><button className="mm-text-button" disabled={blocked} onClick={() => importInput.current?.click()}>导入</button><select aria-label="导出格式" value={exportType} onChange={event => setExportType(event.target.value)}><option value="json">JSON 完整数据</option><option value="markdown">Markdown</option><option value="svg">SVG 矢量图</option><option value="png">PNG 图片</option><option value="xmind">XMind 文件</option></select><button className="mm-button mm-small" disabled={loading || busy || !map} onClick={exportCurrent}>导出</button></div></footer>
    {dialog && <Modal title={({ metadata: '导图设置', import: '导入思维导图', restore: '恢复历史版本', version: `版本 v${dialog.version?.revision}`, reload: '加载服务器版本' })[dialog.kind]} onClose={() => { if (!busy) setDialog(null) }} wide={dialog.kind === 'version'}>
      {dialog.kind === 'metadata' && <form onSubmit={saveMetadata}><label className="mm-field">导图名称<input autoFocus maxLength={200} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><AssociationFields workspaceId={form.workspace_id} postId={form.post_id} onChange={values => setForm({ ...form, ...values })} disabled={busy} /><div className="mm-dialog-actions"><button type="button" className="mm-button" onClick={() => setDialog(null)} disabled={busy}>取消</button><button className="mm-button mm-primary" disabled={busy}>{busy ? '保存中…' : '保存设置'}</button></div></form>}
      {dialog.kind === 'import' && <><p className="mm-dialog-copy">「{dialog.payload.name || '导入文件'}」已通过格式校验。可以创建一张新导图，或将内容替换到当前导图。替换前会先保存当前修改，历史版本仍可恢复。</p><div className="mm-dialog-actions"><button className="mm-button" disabled={busy} onClick={() => setDialog(null)}>取消</button><button className="mm-button" disabled={busy} onClick={() => applyImport(false)}>替换当前导图</button><button className="mm-button mm-primary" disabled={busy} onClick={() => applyImport(true)}>创建新导图</button></div></>}
      {dialog.kind === 'restore' && <><p className="mm-dialog-copy">将导图内容和基本信息恢复到 v{dialog.revision}。当前修改会先保存，恢复操作会新增一个版本。</p><div className="mm-dialog-actions"><button className="mm-button" disabled={busy} onClick={() => setDialog(null)}>取消</button><button className="mm-button mm-primary" disabled={busy} onClick={() => restore(dialog.revision)}>{busy ? '恢复中…' : '确认恢复'}</button></div></>}
      {dialog.kind === 'reload' && <><p className="mm-dialog-copy">加载服务器版本将放弃当前画布的本机修改。可以先将本机修改另存为新图，再查看服务器版本。</p><div className="mm-dialog-actions"><button className="mm-button" disabled={busy} onClick={saveAsNew}>另存本机修改</button><button className="mm-button mm-delete-button" disabled={busy} onClick={reloadServer}>放弃本机修改并加载</button></div></>}
      {dialog.kind === 'version' && <><div className="mm-version-preview-meta"><span>{dialog.version.name}</span><span>{dialog.version.node_count} 节点</span><span>{formatDate(dialog.version.created_at)}</span></div><div className="mm-version-preview">{outlineNodes(dialog.version.document.root).map(item => <div key={item.uid} style={{ paddingLeft: 14 + Math.min(item.depth, 16) * 18 }}>{item.depth ? '· ' : '◇ '}{item.text}</div>)}</div><div className="mm-dialog-actions"><button className="mm-button" onClick={() => download(`${dialog.version.name}-v${dialog.version.revision}.json`, encodeExport({ ...map, ...dialog.version }, dialog.version.document))}>导出此版本 JSON</button><button className="mm-button mm-primary" disabled={readOnly || busy || dialog.version.revision === map.revision} onClick={() => setDialog({ kind: 'restore', revision: dialog.version.revision })}>恢复此版本</button></div></>}
      {error && <p className="mm-error" role="alert">{error}</p>}
    </Modal>}
  </div>
}
