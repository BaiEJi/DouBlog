import { useEffect, useMemo, useState } from 'react'
import VirtualList from '@/shared/VirtualList'
import Select from '@/shared/ui/Select'
import CopyButton from '@/shared/ui/CopyButton'
import { vaultListItems, vaultPurgeItem } from '../api'
import { accountOrder, accountIdentities, accountSiteName, loginName, matchesSite, primaryWebsite } from './accountBook.js'
import { accountGroupId, UNGROUPED } from './groups.js'
import { domainOf, itemMatches } from './core'
import { decryptBlob } from './crypto'
import { createVaultTaskScope, decryptBatches } from './session'
import { Favicon, I } from './ui'

export function AccountList({ items, query, catalog, category, setCategory, tag, setTag, identity, setIdentity, mode, setMode,
  groupFilter, groupNames, groupsAvailable, siteFilter, setSiteFilter, siteOptions, selectedId, onSelect, onManage, onUsed, copier, compact, loading }) {
  const [filtersOpen, setFiltersOpen] = useState(Boolean(category || tag || identity || siteFilter))
  const tags = useMemo(() => [...new Set(items.flatMap(i => i.data.tags || []))].sort(), [items])
  const identities = useMemo(() => [...new Set(items.flatMap(i => accountIdentities(i.data)))].sort(), [items])
  const rows = useMemo(() => items.filter(i => (
    (mode !== 'favorites' || i.favorite) && (mode !== 'recent' || i.last_used_at)
    && (!category || i.data.category === category) && (!tag || i.data.tags?.includes(tag))
    && (!identity || accountIdentities(i.data).includes(identity))
    && (groupFilter === null || accountGroupId(i.data, groupNames) === groupFilter)
    && matchesSite(i.data, siteFilter)
    && itemMatches(i, query, groupsAvailable ? groupNames.get(i.data.group_id) || UNGROUPED : '')
  )).sort(mode === 'recent' ? (a, b) => b.last_used_at.localeCompare(a.last_used_at) || b.id - a.id : accountOrder),
  [items, query, category, tag, identity, mode, groupFilter, groupNames, groupsAvailable, siteFilter])
  const short = !compact && rows.length <= 7
  return <section className={'vault-account-list' + (compact ? ' is-compact' : short ? ' is-short' : '')} aria-label="账号列表">
    <div className="vault-filters">
      <div role="group" aria-label="账号范围" className="vault-tabs">
        {[['all', '全部'], ['favorites', '收藏'], ['recent', '最近使用']].map(([key, name]) =>
          <button key={key} aria-pressed={mode === key} onClick={() => setMode(key)}>{name}</button>)}
      </div>
      <span className="vault-list-count">{rows.length} 个账号</span>
      <button className="vault-button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>筛选{category || tag || identity || siteFilter ? ' ·' : ''}</button>
    </div>
    {filtersOpen && <div className="vault-filters">
      <Select aria-label="筛选所属网站" size="sm" value={siteFilter} onChange={setSiteFilter} options={siteOptions} />
      <Select aria-label="账号分类" size="sm" value={category} onChange={setCategory}
        options={[{ value: '', label: '全部分类' }, ...catalog.map(c => ({ value: c.key, label: c.label }))]} />
      <Select aria-label="账号标签" size="sm" value={tag} onChange={setTag} options={[{ value: '', label: '全部标签' }, ...tags]} />
      <Select aria-label="绑定账号或身份" size="sm" value={identity} onChange={setIdentity}
        options={[{ value: '', label: '全部身份' }, ...identities]} />
      <button className="vault-button" onClick={onManage}>管理类别</button>
    </div>}
    {rows.length > 0 && <div className="vault-column-head" aria-hidden="true"><span>账号名称</span><span className="vault-site-head">所属网站</span><span>登录账号</span><span>所属分组</span><span>快捷操作</span></div>}
    <div className="vault-scroll">
      {rows.length ? <VirtualList items={rows} getKey={i => i.id} estimateSize={64} height={short ? 'auto' : '100%'} renderItem={item => {
        const d = item.data, login = loginName(d), url = primaryWebsite(d), site = accountSiteName(d)
        const group = groupsAvailable ? groupNames.get(d.group_id) || UNGROUPED : '—'
        const copy = async value => {
          const ok = await copier(value)
          if (ok) onUsed(item)
          return ok
        }
        return <div className={'vault-account-row' + (selectedId === item.id ? ' is-selected' : '')}>
          <button className="vault-account-main" onClick={() => onSelect(item)} title={'查看 ' + (d.service || '未命名账号')}>
            <Favicon domain={domainOf(url)} name={d.service} size={34} />
            <span className="vault-account-fields">
              <span className="vault-account-title">
                <span className="vault-account-name"><strong className="truncate">{d.service || '未命名账号'}</strong>
                  {d.purpose && <small className="truncate">{d.purpose}</small>}
                  {item.favorite && <span aria-label="已收藏" className="text-amber-500">{I.starFill}</span>}
                </span>
                <span className={'vault-row-site truncate' + (site ? '' : ' is-empty')} title={site ? '所属网站 · ' + site : '未填写所属网站'}>{site || '—'}</span>
              </span>
              <span className="vault-login-name truncate">{login || '未填写登录账号'}</span>
              <span className="vault-row-group truncate" title={group}>{group}</span>
            </span>
          </button>
          <div className="vault-row-actions">
            <CopyButton value={login} copier={copy} label="复制账号" />
            <CopyButton value={d.password?.value} copier={copy} label="复制密码" />
            {url && <a href={url} onClick={() => onUsed(item)} target="_blank" rel="noopener noreferrer" title={url}>打开 ↗</a>}
          </div>
        </div>
      }} /> : <p className="vault-empty">{loading ? '正在读取账号…' : items.length ? '没有匹配的账号' : '还没有账号，可以新增或从 CSV 导入。'}</p>}
    </div>
  </section>
}

export function RecentlyDeleted({ session, getVaultKey, onRestore, onPurged, version }) {
  const [rows, setRows] = useState(null), [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null), [busy, setBusy] = useState(false), [reload, setReload] = useState(0)
  useEffect(() => {
    const scope = createVaultTaskScope(session)
    async function load() {
      const result = await vaultListItems(true, { signal: scope.signal })
      scope.assert()
      if (!result.success) throw new Error(result.message || '读取最近删除失败')
      const vek = getVaultKey()
      const entries = await decryptBatches(result.data.items, async row => {
        let data
        try { data = await decryptBlob(vek, row.blob) } catch { data = { service: '无法解密的账号 #' + row.id } }
        return { ...row, data }
      }, { isCurrent: scope.isCurrent })
      scope.assert()
      setRows(entries.sort((a, b) => (b.deleted_at || '').localeCompare(a.deleted_at || '')))
      setError('')
    }
    load().catch(err => { if (scope.isCurrent()) setError(err.message) })
    return () => scope.dispose()
  }, [session, getVaultKey, version, reload])

  async function change(item, purge) {
    const token = session.current()
    setBusy(true); setError('')
    try {
      if (purge) {
        const result = await vaultPurgeItem(item.id)
        session.assert(token)
        if (!result.success) throw new Error(result.message || '删除失败')
        onPurged(item.id)
      } else await onRestore(item.id)
      session.assert(token)
      setRows(list => list?.filter(i => i.id !== item.id)); setConfirm(null)
    } catch (err) { if (session.isCurrent(token)) setError(err.message) }
    finally { if (session.isCurrent(token)) setBusy(false) }
  }
  return <section className="vault-trash" aria-label="最近删除的账号">
    {error && <p role="alert">{error} <button className="vault-button" onClick={() => setReload(n => n + 1)}>重试</button></p>}
    {!rows ? <p className="vault-empty">正在读取…</p> : !rows.length ? <p className="vault-empty">最近删除为空</p> :
      rows.map(item => <div key={item.id} className="vault-account-row">
        <div className="min-w-0"><strong>{item.data.service}</strong><p className="vault-login-name">{[accountSiteName(item.data), loginName(item.data), item.deleted_at && item.deleted_at.slice(0, 10) + ' 删除'].filter(Boolean).join(' · ')}</p></div>
        <div className="vault-actions">
          <button className="vault-button" disabled={busy} onClick={() => change(item, false)}>恢复</button>
          <button className="vault-button vault-danger" disabled={busy} onClick={() => setConfirm(item)}>彻底删除</button>
        </div>
      </div>)}
    {confirm && <div className="vault-dialog-mask"><div role="dialog" aria-modal="true" aria-label="永久删除账号" className="vault-dialog">
      <h3>永久删除账号？</h3><p>「{confirm.data.service}」及其附件将一并销毁。</p>
      <div className="vault-actions"><button className="vault-button" disabled={busy} onClick={() => setConfirm(null)}>取消</button>
        <button className="vault-button vault-danger" disabled={busy} onClick={() => change(confirm, true)}>确认永久删除</button></div>
    </div></div>}
  </section>
}
