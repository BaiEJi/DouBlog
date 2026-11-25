import Select from '@/shared/ui/Select'
import { useEffect, useId, useRef } from 'react'
import { API_BASE } from '@/shared/client'
import { uploadImage } from './api'
import { formatDate } from './format'

const SHAPES = [['roundedRectangle', '圆角矩形'], ['rectangle', '矩形'], ['ellipse', '椭圆'], ['diamond', '菱形'], ['parallelogram', '平行四边形'], ['octagonalRectangle', '八边形']]

function Field({ label, value, onCommit, disabled, textarea, ...props }) {
  const id = useId()
  const control = useRef(null)
  const Tag = textarea ? 'textarea' : 'input'
  useEffect(() => {
    const blurCurrent = () => {
      const input = control.current
      if (input && window.document.activeElement === input) input.blur()
    }
    const beforePointer = event => {
      if (control.current && !control.current.contains(event.target)) blurCurrent()
    }
    // Commit before an SVG mousedown changes the editor selection, and before
    // the editor's bubble-phase unload handler snapshots its recovery draft.
    window.document.addEventListener('mousedown', beforePointer, true)
    window.addEventListener('beforeunload', blurCurrent, true)
    window.addEventListener('popstate', blurCurrent, true)
    return () => {
      window.document.removeEventListener('mousedown', beforePointer, true)
      window.removeEventListener('beforeunload', blurCurrent, true)
      window.removeEventListener('popstate', blurCurrent, true)
    }
  }, [])
  return <label className="mm-field" htmlFor={id}>{label}<Tag ref={control} id={id} aria-label={label} key={`${label}-${value ?? ''}`} defaultValue={value || ''} disabled={disabled} onBlur={event => { if (!disabled && event.target.value !== String(value || '')) onCommit(event.target.value) }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.currentTarget.blur(); else if (!textarea && event.key === 'Enter') event.currentTarget.blur() }} {...props} /></label>
}

export default function Inspector({ tab, setTab, selection, onPatch, command, outline, locate, focus, focused, readOnly, map, document, onLayout, onTheme, onMetadata, versions, onVersions, onRestore, onVersionPreview, onError }) {
  const imageInput = useRef(null)
  const node = selection[0]
  const data = node?.data || {}
  const patch = next => { if (!readOnly) onPatch(next) }
  async function imageFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) { onError('请选择 10 MB 以内的 PNG、JPEG、GIF 或 WebP 图片。'); return }
    try {
      const result = await uploadImage(file)
      const url = result.url || result.path
      patch({ image: url?.startsWith('/') ? API_BASE + url : url, imageTitle: file.name.replace(/[<>]/g, '') })
    } catch (error) { onError(error.message) }
  }
  const tabs = [['node', '节点'], ['outline', '大纲'], ['design', '设计'], ['history', '历史']]
  return <aside className="mm-inspector" aria-label="导图属性"><div className="mm-inspector-tabs" role="tablist" aria-label="导图面板">{tabs.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => { setTab(key); if (key === 'history') onVersions() }} className={tab === key ? 'active' : ''}>{label}</button>)}</div><div className="mm-inspector-body" role="tabpanel">
    {tab === 'node' && (node ? <>
      <div className="mm-panel-heading">{selection.length > 1 && <span>已选择 {selection.length} 个节点</span>}<span className="mm-mono">{node.uid?.slice(0, 10)}</span></div>
      {readOnly && <p className="mm-hint">只读模式下可查看节点属性。</p>}
      {selection.length === 1 && <Field label="节点内容" textarea rows={3} value={data.text} onCommit={text => { if (!text.trim()) onError('节点内容不能为空。'); else patch({ text, richText: false }) }} disabled={readOnly} maxLength={10000} />}
      <div className="mm-format-row"><button disabled={readOnly} aria-pressed={data.fontWeight === 'bold'} className={data.fontWeight === 'bold' ? 'active' : ''} title="加粗" onClick={() => patch({ fontWeight: data.fontWeight === 'bold' ? 'normal' : 'bold' })}><strong>B</strong></button><button disabled={readOnly} aria-pressed={data.fontStyle === 'italic'} className={data.fontStyle === 'italic' ? 'active' : ''} title="斜体" onClick={() => patch({ fontStyle: data.fontStyle === 'italic' ? 'normal' : 'italic' })}><em>I</em></button><button disabled={readOnly} aria-pressed={data.textDecoration === 'underline'} className={data.textDecoration === 'underline' ? 'active' : ''} title="下划线" onClick={() => patch({ textDecoration: data.textDecoration === 'underline' ? 'none' : 'underline' })}><u>U</u></button>
        <Select
          aria-label="节点字号" className="ml-auto w-24" size="sm"
          value={data.fontSize || ''} disabled={readOnly}
          onChange={next => patch({ fontSize: next })}
          options={[{ value: '', label: '主题字号', disabled: true }, ...[12, 14, 16, 18, 20, 24, 28, 32, 40].map(size => ({ value: size, label: size + ' px' }))]}
        />
      </div>
      <div className="mm-field-grid"><label className="mm-color-field">文字<input type="color" aria-label="节点文字颜色" value={/^#[0-9a-f]{6}$/i.test(data.color || '') ? data.color : '#292524'} disabled={readOnly} onChange={event => patch({ color: event.target.value })} /></label><label className="mm-color-field">填充<input type="color" aria-label="节点背景颜色" value={/^#[0-9a-f]{6}$/i.test(data.fillColor || '') ? data.fillColor : '#ffffff'} disabled={readOnly} onChange={event => patch({ fillColor: event.target.value })} /></label><label className="mm-color-field">边框<input type="color" aria-label="节点边框颜色" value={/^#[0-9a-f]{6}$/i.test(data.borderColor || '') ? data.borderColor : '#d6d3d1'} disabled={readOnly} onChange={event => patch({ borderColor: event.target.value })} /></label><label className="mm-color-field">分支<input type="color" aria-label="分支线颜色" value={/^#[0-9a-f]{6}$/i.test(data.lineColor || '') ? data.lineColor : '#0d9488'} disabled={readOnly} onChange={event => patch({ lineColor: event.target.value })} /></label></div>
      <div className="mm-field-grid"><label className="mm-field">形状
        <Select
          aria-label="形状" className="w-full" size="sm"
          value={data.shape || 'rectangle'} disabled={readOnly}
          onChange={next => patch({ shape: next })}
          options={SHAPES.map(([value, label]) => ({ value, label }))}
        />
      </label><label className="mm-field">边框宽度
        <Select
          aria-label="边框宽度" className="w-full" size="sm"
          value={data.borderWidth ?? 1} disabled={readOnly}
          onChange={next => patch({ borderWidth: next })}
          options={[0, 1, 2, 3, 4].map(n => ({ value: n, label: n + ' px' }))}
        />
      </label><label className="mm-field">分支宽度
        <Select
          aria-label="连线宽度" className="w-full" size="sm"
          value={data.lineWidth || 2} disabled={readOnly}
          onChange={next => patch({ lineWidth: next })}
          options={[1, 2, 3, 4, 6].map(n => ({ value: n, label: n + ' px' }))}
        />
      </label><label className="mm-field">分支样式
        <Select
          aria-label="线型" className="w-full" size="sm"
          value={data.lineDasharray || 'none'} disabled={readOnly}
          onChange={next => patch({ lineDasharray: next === 'none' ? '' : next })}
          options={[
            { value: 'none', label: '实线' },
            { value: '5,5', label: '虚线' },
            { value: '2,3', label: '点线' }
          ]}
        />
      </label></div>
      <div className="mm-panel-divider" />
      <Field label="备注" textarea rows={4} value={data.note} onCommit={note => patch({ note })} disabled={readOnly} placeholder="补充说明与细节…" maxLength={100000} />
      <Field label="标签" value={(data.tag || []).join('，')} onCommit={text => patch({ tag: [...new Set(text.split(/[,，]/).map(item => item.trim()).filter(Boolean))].slice(0, 30) })} disabled={readOnly} placeholder="用逗号分隔多个标签" maxLength={1000} />
      <Field label="超链接" type="url" value={data.hyperlink} onCommit={hyperlink => { if (hyperlink && !/^(https?:\/\/|mailto:)/i.test(hyperlink)) onError('链接需以 https://、http:// 或 mailto: 开头。'); else patch({ hyperlink, hyperlinkTitle: data.hyperlinkTitle || hyperlink }) }} disabled={readOnly} placeholder="https://…" maxLength={2000} />
      {data.hyperlink && <a className="mm-inline-link" href={data.hyperlink} target="_blank" rel="noopener noreferrer">打开链接 ↗</a>}
      <Field label="图片地址" type="url" value={data.image} onCommit={image => { if (image && !/^https?:\/\//i.test(image)) onError('图片地址需以 http:// 或 https:// 开头。'); else patch({ image }) }} disabled={readOnly} placeholder="https://…" maxLength={2000} />
      {data.image && <img className="mm-node-image" src={data.image} alt={data.imageTitle || '节点图片'} />}
      <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={imageFile} /><button className="mm-button mm-small" disabled={readOnly} onClick={() => imageInput.current?.click()}>上传节点图片</button>
      <label className="mm-field">标记图标
        <Select
          aria-label="标记图标" className="w-full" size="sm"
          value={data.icon?.[0] || ''} disabled={readOnly}
          onChange={next => patch({ icon: next ? [next] : [] })}
          options={[
            { value: '', label: '无标记' },
            { value: 'priority_1', label: '优先级 1' },
            { value: 'priority_2', label: '优先级 2' },
            { value: 'priority_3', label: '优先级 3' },
            { value: 'progress_1', label: '进行中' },
            { value: 'progress_8', label: '已完成' }
          ]}
        />
      </label>
      <div className="mm-panel-divider" /><div className="mm-panel-button-grid"><button className="mm-button mm-small" disabled={readOnly} onClick={() => command('up')}>↑ 同级上移</button><button className="mm-button mm-small" disabled={readOnly} onClick={() => command('down')}>↓ 同级下移</button><button className="mm-button mm-small" onClick={() => command('collapse')}>折叠分支</button><button className="mm-button mm-small" onClick={() => command('expand')}>展开分支</button><button className="mm-button mm-small" onClick={() => focus(node.uid)}>{focused ? '切换聚焦' : '聚焦分支'}</button></div>
    </> : <div className="mm-panel-empty"><span>◇</span><h2>选择一个节点</h2><p>在画布中点击节点，编辑文字、样式和内容。按住 Ctrl 可选择多个节点。</p></div>)}
    {tab === 'outline' && <><div className="mm-panel-heading"><span>{outline.length} 个节点</span></div><p className="mm-hint">点击节点定位到画布，自动展开父级路径。</p><div className="mm-outline" role="tree" aria-label="节点大纲">{outline.map(item => <button key={item.uid} role="treeitem" aria-level={item.depth + 1} aria-selected={selection.some(node => node.uid === item.uid)} className={selection.some(node => node.uid === item.uid) ? 'active' : ''} style={{ paddingLeft: 10 + Math.min(item.depth, 10) * 14 }} onClick={() => locate(item.uid)}><span aria-hidden="true">{item.depth ? '·' : '◇'}</span><span>{item.text || '未命名节点'}</span></button>)}</div></>}
    {tab === 'design' && <><label className="mm-field">导图结构
      <Select
        aria-label="导图结构" className="w-full" size="sm"
        value={document?.layout || 'mindMap'} disabled={readOnly}
        onChange={onLayout}
        options={[
          { value: 'mindMap', label: '标准思维导图' },
          { value: 'logicalStructure', label: '向右逻辑图' },
          { value: 'logicalStructureLeft', label: '向左逻辑图' },
          { value: 'organizationStructure', label: '组织结构图' },
          { value: 'catalogOrganization', label: '目录组织图' },
          { value: 'fishbone', label: '鱼骨图' },
          { value: 'timeline', label: '时间轴' },
          { value: 'verticalTimeline', label: '垂直时间轴' }
        ]}
      />
    </label><p className="mm-hint">切换布局保留节点、备注和关联关系。</p><label className="mm-field">主题配色
      <Select
        aria-label="主题配色" className="w-full" size="sm"
        value={document?.theme?.config?.doublogPalette || 'default'} disabled={readOnly}
        onChange={onTheme}
        options={[
          { value: 'default', label: '默认 · 靛蓝', disabled: true },
          { value: 'custom', label: '自定义配色', disabled: true },
          { value: 'teal', label: '湖绿 · 清晰' },
          { value: 'indigo', label: '靛蓝 · 沉静' },
          { value: 'amber', label: '琥珀 · 温暖' },
          { value: 'rose', label: '玫红 · 灵感' },
          { value: 'mono', label: '中性 · 专注' }
        ]}
      />
    </label><label className="mm-color-field">自定义分支主色<input type="color" aria-label="自定义主题颜色" disabled={readOnly} value={document?.theme?.config?.lineColor?.match(/^#[0-9a-f]{6}$/i)?.[0] || '#0d9488'} onChange={event => onTheme('custom', event.target.value)} /></label><div className="mm-panel-divider" /><div className="mm-panel-heading"><h2>导图信息</h2></div><dl className="mm-map-info"><div><dt>名称</dt><dd>{map.name}</dd></div><div><dt>数据版本</dt><dd>v{map.revision}</dd></div><div><dt>更新于</dt><dd>{formatDate(map.updated_at)}</dd></div><div><dt>创建者</dt><dd>{map.created_by || '当前账号'}</dd></div><div><dt>知识库</dt><dd>{map.workspace_id ? `#${map.workspace_id}` : '独立导图'}</dd></div>{map.post_id && <div><dt>关联文章</dt><dd><a className="mm-inline-link" href={`/post/${map.post_id}`}>查看文章 ↗</a></dd></div>}</dl><button className="mm-button" disabled={readOnly} onClick={onMetadata}>编辑名称与关联</button><div className="mm-panel-divider" /><h3>键盘快捷键</h3><dl className="mm-shortcuts"><div><dt>新增子节点</dt><dd>Tab</dd></div><div><dt>新增同级</dt><dd>Enter</dd></div><div><dt>编辑节点</dt><dd>F2 / 双击</dd></div><div><dt>撤销 / 重做</dt><dd>Ctrl Z / Y</dd></div><div><dt>多选节点</dt><dd>Ctrl 点击</dd></div><div><dt>保存</dt><dd>Ctrl S</dd></div><div><dt>搜索</dt><dd>Ctrl F</dd></div></dl></>}
    {tab === 'history' && <><div className="mm-panel-heading"><button className="mm-text-button" onClick={() => onVersions()}>刷新</button></div><p className="mm-hint">每次服务端保存保留一个版本。恢复会生成新版本，当前历史仍会保留。</p>{versions.loading ? <p className="mm-hint" role="status">正在读取历史…</p> : versions.error ? <p className="mm-error">{versions.error}</p> : versions.items?.length ? <div className="mm-version-list">{versions.items.map(item => <div className="mm-version" key={item.revision}><div><strong>v{item.revision}</strong>{item.revision === map.revision && <span className="mm-chip">当前</span>}<time>{formatDate(item.created_at)}</time></div><p>{item.name} · {item.node_count} 节点</p><small>{item.actor || '当前账号'} · {({ create: '创建', save: '保存内容', update: '更新信息', import: '导入', restore: '恢复版本', duplicate: '复制' })[item.action] || item.action}</small><div className="mm-version-actions"><button className="mm-text-button" onClick={() => onVersionPreview(item.revision)}>预览 / 导出</button><button className="mm-text-button" disabled={readOnly || item.revision === map.revision} onClick={() => onRestore(item.revision)}>恢复此版本</button></div></div>)}{versions.hasMore && <button className="mm-button mm-small" onClick={() => onVersions(true)}>加载更早版本</button>}</div> : <p className="mm-hint">暂无历史版本。</p>}</>}
  </div></aside>
}
