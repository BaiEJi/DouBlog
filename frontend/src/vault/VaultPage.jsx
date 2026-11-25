import { clearVaultClipboard } from './components/clipboard'
/**
 * Digital Vault 主页面 /vault
 * 状态机：loading → setup（初始化）/ locked（锁屏）→ unlocked（三面板主界面）
 * 零知识：VEK 仅存内存（不可导出 CryptoKey）；锁定即清除；重载/关浏览器自动锁定。
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useModuleNavigation } from '../shared/module-navigation'
import { subscribeDataEpoch } from '../shared/dataEpoch'
import { createVaultSession, decryptBatches } from './components/session'
import { clearPwnedCache } from './components/hibp'
import {
  vaultGetAccount, vaultInitAccount, vaultRotateKeys, vaultSaveGroups,
  vaultListItems, vaultCreateItem, vaultUpdateItem, vaultMarkUsed,
  vaultTrashItem, vaultRestoreItem, vaultAudit, vaultExport,
} from './api'
import {
  createVaultMaterial, unlockVault, rewrapVaultKey, encryptBlob, decryptBlob,
  generateRecoveryKey, cancelVaultCrypto,
} from './components/crypto'
import { analyzeSecurity } from './components/core'
import { buildSiteOptions, loginName, matchesSite, normalizeSiteName } from './components/accountBook.js'
import { makeClipboardCopier, CLIPBOARD_OPTIONS, I, Select } from './components/ui'
import { useCategoryCatalog, loadCustomCategories } from './components/categoryCatalog'
import ItemDetail from './components/ItemDetail'
import ItemEditor from './components/ItemEditor'
import Generator from './components/Generator'
import SecurityCenter from './components/SecurityCenter'
import CategoriesView from './components/CategoriesView'
import { AccountList, RecentlyDeleted } from './components/AccountList'
import { GroupRail } from './components/AccountGroups'
import { accountGroupId, changeGroups, readGroups, UNGROUPED } from './components/groups.js'
import { CsvImport, BackupRestore } from './components/Transfers'
import './book.css'

const LOCK_OPTIONS = [
  { key: '5m', label: '5 分钟', ms: 5 * 60000 },
  { key: '15m', label: '15 分钟', ms: 15 * 60000 },
  { key: '30m', label: '30 分钟', ms: 30 * 60000 },
  { key: '1h', label: '1 小时', ms: 60 * 60000 },
  { key: 'browser', label: '关闭浏览器', ms: 0 },
]

// 输入框档位：与统一登录页（/login）同档（ui-baseline.md）
const VAULT_INPUT = 'w-full px-3.5 py-2.5 rounded-xl border text-sm ' +
  'border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.04] ' +
  'text-stone-900 dark:text-stone-100 outline-none focus:border-black/30 dark:focus:border-white/30 ' +
  'placeholder:text-stone-400 dark:placeholder:text-stone-500 transition-colors'

function loadPrefs() {
  try {
    return {
      lock: localStorage.getItem('vault_lock') || '15m',
      clipboard: localStorage.getItem('vault_clipboard') || '30s',
      externalIcons: localStorage.getItem('vault_external_icons') === 'true',
    }
  } catch { return { lock: '15m', clipboard: '30s' } }
}

const EMPTY_GROUPS = { entries: [], nonce: null }
const ACTION_LABELS = {
  groups_updated: '更新账号分组',
  empty_vault_reinitialized: '重新设置空密码库',
  vault_initialized: '初始化 Vault', vault_keys_rotated: '密钥轮换',
  created: '新建条目', updated: '更新条目', password_changed: '修改密码',
  used: '使用', trashed: '移入最近删除', restored: '恢复', purged: '永久删除',
  exported: '导出备份', imported: '恢复备份', accounts_appended: 'CSV 导入账号',
}

export default function VaultPage() {
  const [phase, setPhase] = useState('loading')
  const [account, setAccount] = useState(null)
  const [session] = useState(createVaultSession)
  const vekRef = useRef(null), reloadGeneration = useRef(0), search = useRef(null)
  const getVaultKey = useCallback(() => vekRef.current, [])
  const [items, setItems] = useState([]), [loading, setLoading] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [section, setSection] = useState('all'), [mode, setMode] = useState('all')
  const [category, setCategory] = useState(''), [tag, setTag] = useState(''), [query, setQuery] = useState('')
  const [identity, setIdentity] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const siteOptions = useMemo(() => buildSiteOptions(items), [items])
  const [groupState, setGroupState] = useState(EMPTY_GROUPS), [groupFilter, setGroupFilter] = useState(null)
  const groupNames = useMemo(() => new Map((groupState.entries || []).map(g => [g.id, g.name])), [groupState.entries])
  const [selectedId, setSelectedId] = useState(null), [editing, setEditing] = useState(null)
  const [genOpen, setGenOpen] = useState(false), [settings, setSettings] = useState(null)
  const [prefs, setPrefs] = useState(loadPrefs), [saving, setSaving] = useState(false)
  const [undo, setUndo] = useState(null), [trashVersion, setTrashVersion] = useState(0)
  const [pwned, setPwned] = useState({})
  const lastActivity = useRef(0)
  const { catalog, replaceCustom, addCategory, renameCategory, deleteCategory, labelOf } = useCategoryCatalog(items)
  const copier = useMemo(() => makeClipboardCopier(CLIPBOARD_OPTIONS.find(o => o.key === prefs.clipboard)?.ms ?? 30000), [prefs.clipboard])

  const fetchAccount = useCallback(async token => {
    const { status, data } = await vaultGetAccount({ signal: session.signal() })
    session.assert(token)
    if (status === 404) return null
    if (!data.success) throw new Error(data.message || '读取密码库失败')
    return data.data
  }, [session])

  const readAccount = useCallback(() => {
    const token = session.begin()
    return fetchAccount(token).then(material => {
      session.assert(token)
      setSyncError(''); setAccount(material)
      setPhase(material ? 'locked' : 'setup')
    }).catch(error => {
      if (session.isCurrent(token)) { setSyncError(error.message); setPhase('error') }
    })
  }, [session, fetchAccount])

  const lockNow = useCallback(() => {
    session.invalidate()
    reloadGeneration.current += 1
    cancelVaultCrypto(); clearPwnedCache(); clearVaultClipboard()
    vekRef.current = null
    setItems([]); setSelectedId(null); setEditing(null); setPwned({})
    setGroupState(EMPTY_GROUPS); setGroupFilter(null)
    setGenOpen(false); setSettings(null); setUndo(null); setQuery(''); setMode('all')
    setCategory(''); setTag(''); setIdentity(''); setSiteFilter(''); setSection('all'); setSaving(false); setLoading(false); setSyncError('')
    setPhase('loading')
    return readAccount()
  }, [session, readAccount])

  useEffect(() => {
    readAccount()
    const unsubscribe = subscribeDataEpoch(lockNow)
    return () => {
      unsubscribe(); session.invalidate(); reloadGeneration.current += 1; vekRef.current = null
      cancelVaultCrypto(); clearVaultClipboard(); clearPwnedCache()
    }
  }, [session, lockNow, readAccount])

  useEffect(() => {
    if (phase !== 'unlocked') return
    const ms = LOCK_OPTIONS.find(o => o.key === prefs.lock)?.ms ?? 900000
    const bump = () => { lastActivity.current = Date.now() }
    bump()
    window.addEventListener('pointerdown', bump)
    window.addEventListener('keydown', bump)
    const timer = setInterval(() => { if (ms && Date.now() - lastActivity.current >= ms) lockNow() }, 15000)
    return () => {
      window.removeEventListener('pointerdown', bump); window.removeEventListener('keydown', bump); clearInterval(timer)
    }
  }, [phase, prefs.lock, lockNow])

  const reloadItems = useCallback(async () => {
    const key = vekRef.current, token = session.current(), load = ++reloadGeneration.current
    if (!key) return
    const current = () => session.isCurrent(token) && load === reloadGeneration.current && vekRef.current === key
    setLoading(true)
    try {
      const result = await vaultListItems(false, { signal: session.signal() })
      if (!current()) return
      if (!result.success) throw new Error(result.message || '读取账号失败')
      const rows = await decryptBatches(result.data.items, async row => ({ ...row, data: await decryptBlob(key, row.blob) }), {
        isCurrent: current, onBatch: batch => { if (current()) setItems(batch) },
      })
      if (!current() || !rows) return
      setItems(rows)
      const missing = result.data.items.length - rows.length
      setSyncError(missing ? missing + ' 个账号解密失败，原始密文仍可备份。' : '')
    } catch (error) {
      if (current()) setSyncError(error.message || '读取账号失败')
    } finally { if (current()) setLoading(false) }
  }, [session])

  async function loadGroups(key, material, token) {
    const box = material.group_catalog
    let entries
    try { entries = await readGroups(key, box) }
    catch { entries = null }
    session.assert(token)
    setGroupState({ entries, nonce: box?.n ?? null })
    setGroupFilter(active => !entries || (active && !entries.some(g => g.id === active)) ? null : active)
    return entries
  }

  async function refreshGroups() {
    const token = session.current(), key = vekRef.current
    const current = await fetchAccount(token)
    if (!key || !current || current.kdf_salt !== account.kdf_salt) throw new Error('密码库密钥已变化，请重新解锁')
    const entries = await loadGroups(key, current, token)
    if (!entries) throw new Error('分组目录无法解密，请检查备份')
  }

  async function saveGroups(change) {
    const token = session.current(), key = vekRef.current
    if (!key || !groupState.entries) throw new Error('请重新读取分组')
    const entries = changeGroups(groupState.entries, change)
    if (entries === groupState.entries) return
    const blob = entries.length ? await encryptBlob(key, entries) : null
    session.assert(token)
    const result = await vaultSaveGroups({ blob, expected_key: account.kdf_salt, expected_nonce: groupState.nonce }, { signal: session.signal() })
    session.assert(token)
    if (!result.success) {
      if (result.code === 409) await refreshGroups()
      throw new Error(result.message || '分组保存失败')
    }
    setGroupState({ entries, nonce: blob?.n ?? null })
  }

  async function unlock(secret, recovery, material) {
    const token = session.begin()
    const current = material || await fetchAccount(token)
    session.assert(token)
    if (!current) throw new Error('密码库尚未初始化，请刷新页面')
    setAccount(current)
    const key = await unlockVault(current, secret, recovery)
    session.assert(token)
    vekRef.current = key
    await loadGroups(key, current, token)
    session.assert(token)
    setPhase('unlocked')
    await reloadItems()
  }

  async function resetMaster(recovery, newPassword) {
    const token = session.begin()
    const current = await fetchAccount(token)
    session.assert(token)
    if (!current) throw new Error('密码库尚未初始化，请刷新页面')
    setAccount(current)
    const material = await changeWrapping(current, recovery, true, newPassword, false, session, token)
    setAccount(material)
    await unlock(newPassword, false, material)
  }

  useEffect(() => {
    if (phase !== 'unlocked') return
    function shortcut(event) {
      if (document.querySelector('dialog[open]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setSection('all'); setSettings(null); setGenOpen(false); setEditing(null); setSelectedId(null)
        setMode('all'); setCategory(''); setTag(''); setIdentity(''); setSiteFilter(''); setGroupFilter(null)
        requestAnimationFrame(() => { search.current?.focus(); search.current?.select() })
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [phase])

  function navigate(key) { setSection(key); setEditing(null); setSelectedId(null) }
  function selectItem(item) {
    if (groupFilter !== null && accountGroupId(item.data, groupNames) !== groupFilter) setGroupFilter(null)
    if (!matchesSite(item.data, siteFilter)) setSiteFilter('')
    setSection('all'); setEditing(null); setSelectedId(item.id)
  }
  function newItem() { setSection('all'); setSelectedId(null); setEditing('new') }
  async function saveItem(data, existing) {
    const token = session.current(), key = vekRef.current
    setSaving(true)
    try {
      const blob = await encryptBlob(key, data)
      session.assert(token)
      const payload = { blob, password_updated_at: data.password_updated_at, expected_key: account.kdf_salt }
      if (existing) payload.expected_item_nonce = existing.blob.n
      if (groupState.entries && (data.group_id || existing?.data.group_id)) payload.expected_group_nonce = groupState.nonce
      const options = { signal: session.signal() }
      const result = existing ? await vaultUpdateItem(existing.id, payload, options)
        : await vaultCreateItem(payload, options)
      session.assert(token)
      if (!result.success) {
        if (result.code === 409) { await refreshGroups(); await reloadItems() }
        throw new Error(result.message || '保存失败')
      }
      if (existing) setPwned(previous => { const next = { ...previous }; delete next[existing.id]; return next })
      await reloadItems()
      session.assert(token)
      const visible = (groupFilter === null || groupFilter === accountGroupId(data, groupNames)) && matchesSite(data, siteFilter)
      setEditing(null); setSelectedId(visible ? result.data.id : null)
    } finally { if (session.isCurrent(token)) setSaving(false) }
  }

  async function toggleFavorite(item) {
    const token = session.current()
    try {
      const result = await vaultUpdateItem(item.id, { favorite: !item.favorite }, { signal: session.signal() })
      session.assert(token)
      if (!result.success) throw new Error(result.message || '更新收藏失败')
      setItems(rows => rows.map(row => row.id === item.id ? { ...row, favorite: result.data.favorite } : row))
    } catch (error) { if (session.isCurrent(token)) setSyncError(error.message) }
  }

  function markUsed(item) {
    const token = session.current()
    vaultMarkUsed(item.id, { signal: session.signal() }).then(result => {
      if (result.success && session.isCurrent(token)) setItems(rows => rows.map(row =>
        row.id === item.id && (row.last_used_at || '') < result.data.last_used_at ? { ...row, last_used_at: result.data.last_used_at } : row))
    }).catch(() => {})
  }

  async function trashItem(item) {
    const token = session.current()
    try {
      const result = await vaultTrashItem(item.id, { signal: session.signal() })
      session.assert(token)
      if (!result.success) throw new Error(result.message || '删除失败')
      setSelectedId(null); setEditing(null); setItems(rows => rows.filter(row => row.id !== item.id))
      setUndo({ id: item.id, name: item.data.service }); setTrashVersion(v => v + 1)
      await reloadItems()
    } catch (error) { if (session.isCurrent(token)) setSyncError(error.message) }
  }

  async function restoreItem(id) {
    const token = session.current()
    const result = await vaultRestoreItem(id, { signal: session.signal() })
    session.assert(token)
    if (!result.success) throw new Error(result.message || '恢复失败')
    setUndo(previous => previous?.id === id ? null : previous); setTrashVersion(v => v + 1)
    await reloadItems()
  }
  async function restoredBackup(categories) {
    replaceCustom(categories); await lockNow()
  }

  const selected = items.find(item => item.id === selectedId)
  const risks = useMemo(() => {
    const s = analyzeSecurity(items)
    return new Set([...s.weak, ...s.expired, ...s.reused.flatMap(group => group.items),
      ...items.filter(i => pwned[i.id] > 0)].map(i => i.id)).size
  }, [items, pwned])

  useModuleNavigation({
    items: phase === 'unlocked' ? [
      { key: 'all', label: '我的账号', icon: I.key, badge: items.length },
      { key: 'trash', label: '最近删除', icon: I.trash },
      { key: 'security', label: '安全检查', icon: I.shield },
    ] : [{ key: 'locked', label: '我的账号' }],
    activeKey: phase === 'unlocked' ? (section === 'categories' ? 'all' : section) : 'locked', onSelect: navigate,
  })

  return <div className="vault-book min-h-[60vh]">
    {syncError && <div role="alert" className="vault-notice">{syncError}
      <button className="vault-button" onClick={phase === 'error' ? readAccount : reloadItems}>重试</button></div>}
    {phase === 'loading' && <p className="vault-empty">正在读取密码库…</p>}
    {(phase === 'setup' || phase === 'reset-empty') && <SetupView onDone={readAccount} session={session}
      previous={phase === 'reset-empty' ? account : null} onCancel={readAccount} onRestored={restoredBackup} />}
    {phase === 'locked' && account && <LockView onUnlock={unlock} onReset={resetMaster}
      onEmptyReset={account.can_reinitialize_empty ? () => setPhase('reset-empty') : null} />}
    {phase === 'unlocked' && <div className={section === 'security' ? 'vault-security-view' : 'vault-content'}>
      <header className="vault-toolbar">
        <label className="vault-search">{I.search}<input ref={search} type="search" aria-label="搜索账号"
          placeholder="搜索名称、网站、登录账号或标签" value={query} onChange={e => { setQuery(e.target.value); navigate('all') }} /></label>
        <button className="vault-button vault-primary" onClick={newItem}>{I.plus} 新增账号</button>
        <div className="vault-toolbar-tools">
          <button className="vault-button" onClick={() => setSettings('backup')}>导入</button>
          <button className="vault-button" title="密码生成器" onClick={() => setGenOpen(true)}>{I.dice}</button>
          <button className="vault-button" onClick={() => setSettings('general')}>设置</button>
          <button className="vault-button" onClick={lockNow}>{I.lock} 锁定</button>
        </div>
      </header>
      {undo && <div role="status" className="vault-notice">「{undo.name}」已移入最近删除
        <button className="vault-button" onClick={() => restoreItem(undo.id).catch(e => { if (e.name !== 'AbortError') setSyncError(e.message) })}>撤销</button>
        <button aria-label="关闭提示" onClick={() => setUndo(null)}>×</button></div>}
      {section === 'all' && <>
        {risks > 0 && <div className="vault-notice">{risks} 个账号的密码需要检查
          <button className="vault-risk-link" onClick={() => navigate('security')}>查看详情 →</button></div>}
        <div className={'vault-workspace' + (editing || selected ? ' has-record' : '')}>
          {!editing && !selected && <GroupRail groups={groupState.entries} names={groupNames} items={items} active={groupFilter}
            onSelect={setGroupFilter} onCommit={saveGroups} onRetry={refreshGroups} />}
          <AccountList items={items} catalog={catalog} query={query} category={category} setCategory={setCategory}
            siteFilter={siteFilter} setSiteFilter={setSiteFilter} siteOptions={siteOptions.filter}
            groupFilter={groupFilter} groupNames={groupNames} groupsAvailable={groupState.entries !== null}
            tag={tag} setTag={setTag} identity={identity} setIdentity={setIdentity} mode={mode} setMode={setMode} selectedId={selectedId} onSelect={selectItem}
            onManage={() => navigate('categories')} onUsed={markUsed} copier={copier} compact={!!(editing || selected)} loading={loading} />
          {(editing || selected) && <section className="vault-record">
            {editing ? <ItemEditor key={editing === 'new' ? 'new' : editing.id}
              initial={editing === 'new' ? null : editing.data} catalog={catalog} saving={saving} onCancel={() => setEditing(null)}
              groups={groupState.entries} defaultGroup={groupFilter || ''} onGroupCommit={saveGroups}
              siteOptions={siteOptions.editor} defaultSite={siteFilter}
              onSave={data => saveItem(data, editing === 'new' ? null : editing)} /> : <>
              <button className="vault-back" onClick={() => setSelectedId(null)}>← 返回账号列表</button>
              <ItemDetail key={selected.id} item={selected} getVaultKey={getVaultKey} vaultSession={session} categoryLabel={labelOf}
                groupLabel={groupState.entries ? groupNames.get(selected.data.group_id) || UNGROUPED : '分组目录无法读取'}
                onUsed={() => markUsed(selected)} copier={async value => { const ok = await copier(value); if (ok) markUsed(selected); return ok }}
                onToggleFav={toggleFavorite} onEdit={() => setEditing(selected)} onDelete={trashItem} /></>}
          </section>}
        </div>
      </>}
      {section === 'categories' && <>
        <button className="vault-back self-start" onClick={() => navigate('all')}>← 返回账号列表</button>
        <CategoriesView items={items} catalog={catalog} active={category} onActiveChange={setCategory} onNew={newItem}
          onOpenItem={selectItem} onAddCategory={addCategory} onRenameCategory={renameCategory} onDeleteCategory={deleteCategory} />
      </>}
      {section === 'security' && <SecurityCenter items={items} onSelect={selectItem} vaultSession={session} pwned={pwned} setPwned={setPwned} />}
      {section === 'trash' && <RecentlyDeleted session={session} getVaultKey={getVaultKey} version={trashVersion} onRestore={restoreItem}
        onPurged={id => setUndo(previous => previous?.id === id ? null : previous)} />}
      {genOpen && <Generator copier={copier} onClose={() => setGenOpen(false)} />}
      {settings && <SettingsView initialTab={settings} prefs={prefs} setPrefs={setPrefs} items={items} copier={copier}
        account={account} setAccount={setAccount} session={session} getVaultKey={getVaultKey} onAppended={reloadItems}
        onRestored={restoredBackup} onClose={() => setSettings(null)} />}
    </div>}
  </div>
}

// Both lock-screen recovery and settings replace one wrapper around the same data key.
async function changeWrapping(account, secret, useRecovery, newSecret, replaceRecovery, session, token) {
  let wrapped
  try { wrapped = await rewrapVaultKey(account, secret, useRecovery, newSecret, replaceRecovery) }
  catch (error) {
    if (error.name !== 'OperationError') throw error
    throw new Error(useRecovery ? '恢复密钥不正确' : '当前主密码不正确', { cause: error })
  }
  session.assert(token)
  const update = replaceRecovery ? { recovery_wrapped_vault_key: wrapped.box, recovery_salt: wrapped.salt }
    : { wrapped_vault_key: wrapped.box, kdf_salt: wrapped.salt, kdf_params: wrapped.params }
  const result = await vaultRotateKeys({ ...update, expected_key: account.kdf_salt, expected_recovery: account.recovery_salt }, { signal: session.signal() })
  session.assert(token)
  if (!result.success) throw new Error(result.message || '密钥更新失败')
  return result.data
}

function SetupView({ onDone, session, previous, onCancel, onRestored }) {
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [recovery, setRecovery] = useState(null)   // {key, confirmed}
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [savedInput, setSavedInput] = useState('')

  const start = async () => {
    if (busy) return
    const token = session.current()
    if (pw1.length < 8) return setErr('主密码至少 8 位——它保护你所有的密码，请设置强口令')
    if (pw1 !== pw2) return setErr('两次输入不一致')
    setErr(''); setBusy(true)
    try {
      const { account, recoveryKey } = await createVaultMaterial(pw1)
      session.assert(token)
      const payload = previous ? { ...account, replace_empty: { kdf_salt: previous.kdf_salt, recovery_salt: previous.recovery_salt } } : account
      const res = await vaultInitAccount(payload, { signal: session.signal() })
      session.assert(token)
      if (res.success) setRecovery(recoveryKey)   // 先展示 Recovery Key，用户确认后才 onDone
      else setErr(res.message || '初始化失败')
    } catch (e) { if (session.isCurrent(token)) setErr(e.message || '设置失败') }
    finally { if (session.isCurrent(token)) setBusy(false) }
  }

  if (recovery) {
    return (
      <Centered title="保存你的恢复密钥" icon={I.key}>
        <p className="text-[12.5px] text-stone-500 leading-relaxed mb-4">
          这是唯一能在你<b className="text-stone-700 dark:text-stone-200">忘记主密码</b>时找回数据的钥匙。
          它<b className="text-red-500">只显示这一次</b>，服务端不保存明文——请抄写或存入离线安全位置。
        </p>
        <div className="p-3.5 rounded-xl bg-stone-50 dark:bg-white/[0.03] border border-black/[0.07] dark:border-white/[0.07] font-mono text-xs leading-relaxed break-all select-all">{recovery}</div>
        <div className="mt-4">
          <label className="flex items-start gap-2 text-[12.5px] text-stone-500 cursor-pointer">
            <input type="checkbox" checked={!!savedInput} onChange={e => setSavedInput(e.target.checked)} className="mt-0.5 accent-stone-700 dark:accent-stone-200" />
            我已安全保存 Recovery Key，并理解：<b>Recovery Key 与主密码同时丢失时，Vault 数据将无法恢复</b>
          </label>
        </div>
        <button disabled={!savedInput} onClick={() => onDone(null)}
          className="mt-5 w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90 transition-opacity disabled:bg-stone-400 dark:disabled:bg-stone-500 disabled:cursor-not-allowed">
          已保存，进入解锁
        </button>
      </Centered>
    )
  }

  return (
    <Centered title={previous ? '重新设置空密码库' : '创建密码库'} icon={I.shield}>
      <p className="text-[12.5px] text-stone-500 leading-relaxed mb-5">
        {previous ? '当前库内没有账号和附件。设置新主密码后，将生成新的恢复密钥。以前导出的备份仍使用备份时的口令。'
          : '设置一个主密码。加密在本机完成，创建后请保存恢复密钥。'}
      </p>
      <input type="password" value={pw1} onChange={e => setPw1(e.target.value)} autoFocus placeholder="主密码（≥8 位）"
        className={VAULT_INPUT} autoComplete="new-password" />
      <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="再输入一次"
        className={VAULT_INPUT + ' mt-2.5'} autoComplete="new-password" />
      {err && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-600 dark:text-red-400">{err}</p>}
      <button onClick={start} disabled={busy || !pw1 || !pw2}
        className="mt-5 w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90 transition-opacity disabled:bg-stone-400 dark:disabled:bg-stone-500 disabled:cursor-not-allowed">
        {busy ? '正在生成加密材料…' : previous ? '设置新主密码并生成恢复密钥' : '创建密码库'}
      </button>
      {previous && <button type="button" className="vault-back mt-2" disabled={busy} onClick={onCancel}>返回解锁</button>}
      {!previous && !busy && <div className="mt-6 border-t pt-4"><BackupRestore session={session} account={null} onRestored={onRestored} /></div>}
    </Centered>
  )
}

function LockView({ onUnlock, onReset, onEmptyReset }) {
  const [secret, setSecret] = useState(''), [recovery, setRecovery] = useState(false)
  const [reset, setReset] = useState(false), [newPw, setNewPw] = useState(''), [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    if (busy || !secret) return
    if (reset && (newPw.length < 8 || again !== newPw)) return setError('新主密码至少 8 位，两次输入须一致。')
    setBusy(true); setError('')
    try {
      if (reset) await onReset(secret, newPw)
      else await onUnlock(secret, recovery)
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.name === 'OperationError'
        ? (recovery ? '恢复密钥不正确' : '主密码不正确') : err.message || '解锁失败，请重试')
    } finally { setBusy(false) }
  }
  function switchMode() {
    setRecovery(!recovery); setReset(!recovery); setNewPw(''); setAgain(''); setSecret(''); setError('')
  }
  return <Centered title={recovery ? '使用恢复密钥' : '密码库已锁定'} icon={I.lock}>
    <form onSubmit={submit}>
      <input className={VAULT_INPUT} autoFocus type="password" value={secret} onChange={e => setSecret(e.target.value)}
        autoComplete={recovery ? 'off' : 'current-password'} aria-label={recovery ? '恢复密钥' : '主密码'} placeholder={recovery ? '粘贴 Recovery Key…' : '输入主密码…'} />
      {recovery && <>
        <p className="mt-2 text-xs text-stone-500">恢复密钥共 16 组，每组 4 个十六进制字符。</p>
        <label className="flex items-center gap-2 my-3 text-sm"><input type="checkbox" checked={reset} onChange={e => setReset(e.target.checked)} />设置新主密码</label>
        {reset && <><input className={VAULT_INPUT} type="password" value={newPw} onChange={e => setNewPw(e.target.value)} autoComplete="new-password" placeholder="新主密码（≥8 位）" />
          <input className={VAULT_INPUT + ' mt-2'} type="password" value={again} onChange={e => setAgain(e.target.value)} autoComplete="new-password" placeholder="再输入一次新主密码" /></>}
      </>}
      {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" className="vault-button vault-primary mt-4 w-full" disabled={busy || !secret}>
        {busy ? '正在验证…' : reset ? '重设主密码并解锁' : '解锁密码库'}</button>
      <button type="button" className="vault-back mt-2" disabled={busy} onClick={switchMode}>{recovery ? '使用主密码解锁' : '忘记主密码？使用恢复密钥'}</button>
      {recovery && onEmptyReset && <button type="button" className="vault-button mt-2" disabled={busy} onClick={onEmptyReset}>重新设置空密码库</button>}
    </form>
  </Centered>
}

function Centered({ title, icon, children }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6 bg-stone-50 dark:bg-[#100f0e]">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-6">
          <div className="inline-flex w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 items-center justify-center text-emerald-600 dark:text-emerald-400 mb-3">
            <span>{icon}</span>
          </div>
          <h1 className="text-[22px] font-semibold text-stone-900 dark:text-stone-100 tracking-tight">{title}</h1>
        </div>
        <div className="rounded-3xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-8">
          {children}
        </div>
        <p className="mt-6 text-center text-[11.5px] text-stone-400 dark:text-stone-500">
          零知识端到端加密 · 密钥仅存于本机内存 · 服务端只存密文
        </p>
      </div>
    </div>
  )
}

function SettingsView({ prefs, setPrefs, account, setAccount, items, copier, initialTab, session, getVaultKey, onRestored, onAppended, onClose }) {
  const [tab, setTab] = useState(initialTab)
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 dark:bg-black/60" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="密码库设置" className="relative w-full max-w-lg max-h-[85vh] bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.08] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="relative shrink-0 flex flex-wrap items-center gap-1 px-3 pr-12 pt-3 border-b border-black/[0.06] dark:border-white/[0.06]">
          {[['general', '通用'], ['security', '主密码与恢复'], ['backup', '导入与备份'], ['activity', '活动记录']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={'px-3 h-9 whitespace-nowrap text-sm font-medium transition-colors border-b-2 -mb-px ' + (tab === k
                ? 'border-stone-800 dark:border-stone-100 text-stone-900 dark:text-stone-100'
                : 'border-transparent text-stone-400 hover:text-stone-600 dark:hover:text-stone-300')}>{l}</button>
          ))}
          <button onClick={onClose} aria-label="关闭设置" className="absolute right-2 top-3 w-8 h-8 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">✕</button>
        </div>
        <div className="overflow-y-auto p-5">
          {tab === 'general' && <GeneralTab prefs={prefs} setPrefs={setPrefs} account={account} />}
          {tab === 'security' && <SecurityTab session={session} account={account} setAccount={setAccount} copier={copier} />}
          {tab === 'backup' && <BackupTab items={items} account={account} session={session} getVaultKey={getVaultKey} onRestored={onRestored} onAppended={onAppended} />}
          {tab === 'activity' && <ActivityTab items={items} />}
        </div>
      </div>
    </div>
  )
}

function GeneralTab({ prefs, setPrefs, account }) {
  const set = (k, v) => {
    setPrefs(p => ({ ...p, [k]: v }))
    try {
      localStorage.setItem(k === 'lock' ? 'vault_lock' : k === 'externalIcons' ? 'vault_external_icons' : 'vault_clipboard', v)
      if (k === 'externalIcons') window.dispatchEvent(new Event('vault-icon-preference'))
    } catch { /* 浏览器存储不可用，偏好在本次会话生效。 */ }
  }
  return (
    <div className="space-y-6">
      <label className="flex items-start gap-2 text-sm text-stone-700 dark:text-stone-200"><input type="checkbox" checked={!!prefs.externalIcons} onChange={event => set('externalIcons', event.target.checked)} className="mt-1" /><span>加载外部站点图标<span className="block mt-1 text-xs text-stone-500 dark:text-stone-400">开启后会向 DuckDuckGo 图标服务发送条目域名；默认关闭。</span></span></label>
      <div>
        <label className="block text-[12px] font-medium text-stone-500 mb-1.5">自动锁定</label>
        <Select aria-label="自动锁定时间" className="w-full" value={prefs.lock} onChange={v => set('lock', v)}
          options={LOCK_OPTIONS.map(o => ({ value: o.key, label: o.label }))} />
        <p className="mt-1.5 text-[11px] text-stone-400">锁定后清除内存中的加密密钥；页面刷新/关闭浏览器也会自动锁定。</p>
      </div>
      <div>
        <label className="block text-[12px] font-medium text-stone-500 mb-1.5">复制后自动清理剪贴板</label>
        <Select aria-label="剪贴板清除时间" className="w-full" value={prefs.clipboard} onChange={v => set('clipboard', v)}
          options={CLIPBOARD_OPTIONS.map(o => ({ value: o.key, label: o.label }))} />
      </div>
      <div className="pt-4 border-t border-black/[0.06] dark:border-white/[0.06]">
        <h4 className="text-[12px] font-medium text-stone-500 mb-2">安全属性</h4>
        <ul className="text-[12px] text-stone-400 space-y-1 leading-relaxed">
          <li>· 加密：Argon2id（t={account_kdf(account, 't')}, m={account_kdf(account, 'm')} KiB）派生 KEK + AES-256-GCM</li>
          <li>· 零知识：服务端仅存密文与包裹后的密钥材料</li>
          <li>· 密钥仅存内存，不写入 localStorage / Cookie / 日志</li>
        </ul>
      </div>
    </div>
  )
}
function account_kdf(account, key) { return account?.kdf_params?.[key] ?? '?' }

function SecurityTab({ account, setAccount, copier, session }) {
  const [cur, setCur] = useState(''), [useRecovery, setUseRecovery] = useState(false)
  const [rotatePw, setRotatePw] = useState('')
  const [n1, setN1] = useState('')
  const [n2, setN2] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [newRecovery, setNewRecovery] = useState(null)

  const changePw = async () => {
    if (n1.length < 8) return setMsg('新密码至少 8 位')
    if (n1 !== n2) return setMsg('两次新密码不一致')
    setBusy(true); setMsg('')
    try {
      const material = await changeWrapping(account, cur, useRecovery, n1, false, session, session.current())
      setAccount(material); setMsg('主密码已修改'); setCur(''); setN1(''); setN2('')
    } catch (error) { if (error.name !== 'AbortError') setMsg(error.message) } finally { setBusy(false) }
  }

  const rotateRecovery = async () => {
    setBusy(true); setMsg('')
    try {
      const key = generateRecoveryKey()
      const material = await changeWrapping(account, rotatePw, false, key, true, session, session.current())
      setAccount(material); setNewRecovery(key); setRotatePw('')
    } catch (error) { if (error.name !== 'AbortError') setMsg(error.message) } finally { setBusy(false) }
  }

  const input = VAULT_INPUT

  return (
    <div className="space-y-7">
      {newRecovery ? (
        <div>
          <h4 className="text-sm font-semibold mb-2">新的恢复密钥（仅显示一次）</h4>
          <div className="p-3 rounded-xl bg-stone-50 dark:bg-white/[0.03] border border-black/[0.07] dark:border-white/[0.07] font-mono text-xs break-all select-all">{newRecovery}</div>
          <button onClick={() => copier(newRecovery)} className="mt-2 px-3 h-8 rounded-lg text-[12px] text-stone-500 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">复制</button>
        </div>
      ) : (
        <>
          <div>
            <h4 className="text-sm font-semibold mb-2.5">修改主密码</h4>
            <label className="flex items-center gap-2 my-2 text-sm"><input type="checkbox" checked={useRecovery} onChange={e => { setUseRecovery(e.target.checked); setCur(''); setMsg('') }} />使用恢复密钥验证</label>
            <input type="password" className={input} placeholder={useRecovery ? '恢复密钥' : '当前主密码'} value={cur} onChange={e => setCur(e.target.value)} autoComplete={useRecovery ? 'off' : 'current-password'} />
            <input type="password" className={input + ' mt-2'} placeholder="新主密码（≥8 位）" value={n1} onChange={e => setN1(e.target.value)} autoComplete="new-password" />
            <input type="password" className={input + ' mt-2'} placeholder="再输入一次" value={n2} onChange={e => setN2(e.target.value)} autoComplete="new-password" />
            <div className="flex items-center gap-3 mt-3">
              <button onClick={changePw} disabled={busy || !cur || !n1}
                className="px-3.5 h-9 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40">
                {busy ? '派生密钥中…' : '修改主密码'}</button>
              <span className="text-[11.5px] text-stone-400">仅需重包裹密钥，不重加密数据</span>
            </div>
          </div>
          <div className="pt-5 border-t border-black/[0.06] dark:border-white/[0.06]">
            <h4 className="text-sm font-semibold mb-1.5">轮换恢复密钥</h4>
            <p className="text-[11.5px] text-stone-400 mb-2.5">生成新的恢复密钥（旧密钥立即作废）。需验证当前主密码。</p>
            <input type="password" className={input} placeholder="当前主密码" value={rotatePw} onChange={e => setRotatePw(e.target.value)} autoComplete="current-password" />
            <button onClick={rotateRecovery} disabled={busy || !rotatePw}
              className="mt-2.5 px-3.5 h-9 rounded-lg border border-black/10 dark:border-white/15 text-sm text-stone-600 dark:text-stone-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-40">轮换恢复密钥</button>
          </div>
        </>
      )}
      {msg && <p className="text-[12px] text-stone-500">{msg}</p>}
    </div>
  )
}

function BackupTab({ items, account, session, getVaultKey, onRestored, onAppended }) {
  const [csvStep, setCsvStep] = useState(0)
  const [csvPw, setCsvPw] = useState('')
  const [csvErr, setCsvErr] = useState('')
  const download = (name, content, type) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  const exportEncrypted = async () => {
    const token = session.current()
    setCsvErr('')
    try {
      const res = await vaultExport({ signal: session.signal() })
      session.assert(token)
      if (!res.success) throw new Error(res.message || '导出失败')
      const payload = { ...res.data, category_catalog: await encryptBlob(getVaultKey(), loadCustomCategories()) }
      session.assert(token)
      download('vault-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(payload, null, 2), 'application/json')
    } catch (error) { if (session.isCurrent(token)) setCsvErr(error.message) }
  }

  const doCsvExport = async () => {
    setCsvErr('')
    try {
      const token = session.current()
      await unlockVault(account, csvPw, false)
      session.assert(token)
      const rows = [['name', 'url', 'username', 'password', 'notes', 'site_name']]
      for (const i of items) {
        rows.push([
          i.data.service || '', (i.data.urls || [])[0]?.value || '',
          loginName(i.data), i.data.password?.value || '', i.data.notes || '', normalizeSiteName(i.data.site_name),
        ])
      }
      const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
      download(`vault-export-${new Date().toISOString().slice(0, 10)}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8')
      setCsvStep(0); setCsvPw('')
    } catch { setCsvErr('主密码不正确') }
  }

  return (
    <div className="space-y-7">
      <CsvImport account={account} session={session} getVaultKey={getVaultKey} onAppended={onAppended} />
      <BackupRestore account={account} session={session} onRestored={onRestored} />
      {csvErr && <p role="alert" className="text-sm text-red-600">{csvErr}</p>}
      <div>
        <h4 className="text-sm font-semibold mb-1.5">加密备份（推荐）</h4>
        <p className="text-[11.5px] text-stone-400 mb-2.5">包含账号、最近删除的记录和加密附件。可以使用备份时的主密码或恢复密钥还原。</p>
        <button onClick={exportEncrypted}
          className="px-3.5 h-9 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm font-medium hover:opacity-90 transition-opacity">导出加密备份 (.json)</button>
      </div>
      <div className="pt-5 border-t border-black/[0.06] dark:border-white/[0.06]">
        <h4 className="text-sm font-semibold mb-1.5 text-red-500">CSV 明文导出（危险）</h4>
        <p className="text-[11.5px] text-stone-400 mb-2.5">CSV 是<b className="text-red-500">完全明文</b>的文件，任何能读到它的人都能看到你的所有密码。仅用于迁移到其他工具后立即安全删除。</p>
        {csvStep === 0 && (
          <button onClick={() => setCsvStep(1)}
            className="px-3.5 h-9 rounded-lg border border-red-500/40 text-red-500 text-sm hover:bg-red-500/10 transition-colors">我已了解风险，继续</button>
        )}
        {csvStep === 1 && (
          <div>
            <p className="text-[12px] text-stone-500 mb-2">为确认是你本人操作，请输入主密码（本地验证，不上传）：</p>
            <input type="password" className={VAULT_INPUT} value={csvPw} onChange={e => setCsvPw(e.target.value)} placeholder="主密码" autoComplete="current-password" />
            <div className="flex gap-2 mt-3">
              <button onClick={() => { setCsvStep(0); setCsvPw('') }} className="px-3 h-9 rounded-lg text-sm text-stone-500 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">取消</button>
              <button onClick={doCsvExport} disabled={!csvPw}
                className="px-3.5 h-9 rounded-lg bg-red-500/90 text-white text-sm font-medium hover:bg-red-500 transition-colors disabled:opacity-40">导出明文 CSV</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ActivityTab({ items }) {
  const [logs, setLogs] = useState(null)
  useEffect(() => {
    vaultAudit(1).then(d => { if (d.success) setLogs(d.data.items) }).catch(() => setLogs([]))
  }, [])
  const nameOf = (id) => {
    const it = items.find(x => x.id === id)
    return it ? it.data.service : `#${id}`
  }
  return (
    <div>
      <h4 className="text-sm font-semibold mb-1.5">活动记录</h4>
      <p className="text-[11.5px] text-stone-400 mb-4">仅记录行为与条目编号，永不包含密码或密钥内容。</p>
      {!logs ? <p className="text-[12px] text-stone-400">加载中…</p> : logs.length === 0 ? (
        <p className="text-[12px] text-stone-400">暂无记录</p>
      ) : (
        <div className="space-y-0.5">
          {logs.map(l => (
            <div key={l.id} className="flex items-center gap-3 py-1.5 text-[12px]">
              <span className="font-mono text-stone-400 shrink-0 tabular-nums">{(l.created_at || '').slice(5, 16).replace('T', ' ')}</span>
              <span className="text-stone-600 dark:text-stone-300">{ACTION_LABELS[l.action] || l.action}</span>
              {l.item_id != null && <span className="text-stone-400 truncate">{nameOf(l.item_id)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
