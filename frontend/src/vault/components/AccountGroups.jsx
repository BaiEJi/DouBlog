import { useEffect, useMemo, useRef, useState } from 'react'
import Select from '@/shared/ui/Select'
import { accountGroupId, GROUP_NAME_LIMIT, UNGROUPED } from './groups.js'
import { I } from './ui'

function GroupDialog({ entry, onCommit, onClose, onSaved }) {
  const dialog = useRef(null)
  const [id] = useState(() => entry?.id || crypto.randomUUID())
  const [name, setName] = useState(entry?.name || '')
  const [deleting, setDeleting] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => element.close()
  }, [])

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const action = deleting ? 'delete' : entry ? 'rename' : 'create'
      await onCommit({ action, id, name })
      onSaved(deleting ? null : id)
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || '分组保存失败')
    } finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="vault-dialog vault-group-dialog" aria-labelledby="vault-group-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <form onSubmit={submit}>
      <h3 id="vault-group-title">{deleting ? '删除分组？' : entry ? '管理分组' : '新建分组'}</h3>
      {deleting ? <p>「{entry.name}」中的账号会归入未分组。</p> :
        <label className="vault-field mt-4">分组名称
          <input autoFocus autoComplete="off" className="vault-input" maxLength={GROUP_NAME_LIMIT} value={name} disabled={busy}
            onChange={event => { setName(event.target.value); setError('') }} />
        </label>}
      {error && <p role="alert" className="vault-danger">{error}</p>}
      <div className="vault-actions">
        {entry && !deleting && <button type="button" className="vault-button vault-danger mr-auto" disabled={busy}
          onClick={() => { setDeleting(true); setError('') }}>删除分组</button>}
        <button type="button" className="vault-button" disabled={busy} onClick={onClose}>取消</button>
        <button type="submit" className={'vault-button ' + (deleting ? 'vault-danger' : 'vault-primary')}
          disabled={busy || (!deleting && !name.trim())}>{busy ? '保存中…' : deleting ? '确认删除分组' : '保存分组'}</button>
      </div>
    </form>
  </dialog>
}

export function GroupRail({ groups, names, items, active, onSelect, onCommit, onRetry }) {
  const [dialog, setDialog] = useState(null), [error, setError] = useState('')
  const counts = useMemo(() => {
    const result = new Map()
    for (const item of items) {
      const id = accountGroupId(item.data, names)
      result.set(id, (result.get(id) || 0) + 1)
    }
    return result
  }, [items, names])
  const selected = groups?.find(group => group.id === active)
  function row(id, label, count) {
    return <button type="button" key={id === null ? 'all' : 'group:' + id} className="vault-group-row" aria-pressed={active === id}
      onClick={() => onSelect(id)} title={label}>
      {I.folder}<span className="truncate">{label}</span><small>{count}</small>
    </button>
  }
  return <aside className="vault-group-rail" aria-label="账号分组">
    <div className="vault-group-header"><h2>分组</h2>
      <button type="button" title="新建分组" aria-label="新建分组" disabled={!groups} onClick={() => setDialog('create')}>{I.plus}</button>
    </div>
    <nav className="vault-group-links" aria-label="按分组查看账号">
      {row(null, '全部分组', items.length)}
      {groups && row('', UNGROUPED, counts.get('') || 0)}
      {groups?.map(g => row(g.id, g.name, counts.get(g.id) || 0))}
    </nav>
    {selected && <button type="button" className="vault-group-manage" onClick={() => setDialog(selected)}>{I.edit} 管理分组</button>}
    {!groups && <div className="vault-group-error" role="alert">{error || '分组目录无法读取'}
      <button type="button" className="vault-back" onClick={() => onRetry().catch(e => setError(e.message))}>重新读取</button></div>}
    {dialog && <GroupDialog entry={dialog === 'create' ? null : dialog} onCommit={onCommit} onClose={() => setDialog(null)}
      onSaved={id => { setDialog(null); onSelect(id) }} />}
  </aside>
}

export function GroupPicker({ groups, value, onChange, onCommit }) {
  const [creating, setCreating] = useState(false)
  const selected = groups?.some(g => g.id === value) ? value : ''
  return <div className="vault-field"><span>所属分组</span>
    <div className="vault-group-picker">
      <Select aria-label="所属分组" className="min-w-0 flex-1" disabled={!groups} value={selected} onChange={onChange}
        options={[{ value: '', label: groups ? UNGROUPED : '分组目录无法读取' }, ...(groups || []).map(g => ({ value: g.id, label: g.name }))]} />
      <button type="button" className="vault-button" disabled={!groups} onClick={() => setCreating(true)}>{I.plus} 新建分组</button>
    </div>
    {creating && <GroupDialog onCommit={onCommit} onClose={() => setCreating(false)}
      onSaved={id => { setCreating(false); onChange(id) }} />}
  </div>
}
