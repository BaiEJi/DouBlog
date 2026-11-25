import Select from '@/shared/ui/Select'
import { useEffect, useId, useRef, useState } from 'react'
import { listPosts, listWorkspaces } from './api'

export function MapIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="1.8" y="7.3" width="5.8" height="5.4" rx="1.6" stroke="currentColor" strokeWidth="1.4" /><path d="M7.6 10h3.2m0 0V4.5h2.4m-2.4 5.5v5.5h2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /><rect x="13.2" y="2.5" width="5" height="4" rx="1.1" stroke="currentColor" strokeWidth="1.4" /><rect x="13.2" y="13.5" width="5" height="4" rx="1.1" stroke="currentColor" strokeWidth="1.4" /></svg>
}

export function Modal({ title, children, onClose, wide = false }) {
  const id = useId()
  const element = useRef(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement
    element.current?.focus()
    const keydown = event => {
      if (event.key === 'Escape') closeRef.current()
      if (event.key === 'Tab') {
        const controls = [...element.current.querySelectorAll('button:not([disabled]),input,select,textarea,a[href]')]
        if (!controls.length) return
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus?.() }
  }, [])
  return <div className="mm-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section ref={element} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={id} className={`mm-modal ${wide ? 'mm-modal-wide' : ''}`}><header><h2 id={id}>{title}</h2><button className="mm-icon-button" onClick={onClose} aria-label="关闭弹窗">×</button></header>{children}</section></div>
}

export function AssociationFields({ workspaceId, postId, onChange, disabled = false }) {
  const [workspaces, setWorkspaces] = useState([])
  const [posts, setPosts] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    listWorkspaces().then(data => { if (alive) setWorkspaces(Array.isArray(data) ? data : data.items || []) }).catch(error => { if (alive) setError(error.message) })
    return () => { alive = false }
  }, [])
  useEffect(() => {
    let alive = true
    if (!workspaceId) return () => { alive = false }
    listPosts(workspaceId).then(data => { if (alive) setPosts(Array.isArray(data) ? data : data.items || []) }).catch(error => { if (alive) setError(error.message) })
    return () => { alive = false }
  }, [workspaceId])
  return <><label className="mm-field">所属知识库
    <Select
      aria-label="所属知识库" className="w-full"
      value={workspaceId || ''} disabled={disabled}
      onChange={next => onChange({ workspace_id: next || null, post_id: null })}
      options={[{ value: '', label: '默认知识库' }, ...workspaces.map(item => ({ value: item.id, label: item.name }))]}
    />
  </label><label className="mm-field">关联文章
    <Select
      aria-label="关联文章" className="w-full"
      value={postId || ''} disabled={disabled || !workspaceId}
      onChange={next => onChange({ workspace_id: workspaceId || null, post_id: next || null })}
      options={[{ value: '', label: '不关联文章' }, ...posts.map(item => ({ value: item.id, label: item.title || item.name }))]}
    />
  <span className="mm-hint">导图保存到所选知识库，可选择关联该库内的文章。</span></label>{error && <p className="mm-error" role="alert">{error}</p>}</>
}
