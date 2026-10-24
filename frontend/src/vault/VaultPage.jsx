import { clearVaultClipboard } from './components/clipboard'
/**
 * Digital Vault 主页面 /vault
 * 状态机：loading → setup（初始化）/ locked（锁屏）→ unlocked（三面板主界面）
 * 零知识：VEK 仅存内存（不可导出 CryptoKey）；锁定即清除；重载/关浏览器自动锁定。
 */
import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react'
import { useModuleNavigation } from '../shared/module-navigation'
import VirtualList from '../shared/VirtualList'
import { subscribeDataEpoch } from '../shared/dataEpoch'
import { createVaultSession, decryptBatches } from './components/session'
import { clearPwnedCache } from './components/hibp'
import {
  vaultGetAccount, vaultInitAccount, vaultRotateKeys,
  vaultListItems, vaultCreateItem, vaultUpdateItem, vaultMarkUsed,
  vaultPurgeItem, vaultAudit, vaultExport, vaultImport,
} from './api'
import {
  createVaultMaterial, unlockVault, rewrapVaultKey, encryptBlob, decryptBlob,
  generateRecoveryKey, cancelVaultCrypto,
} from './components/crypto'
import {
  itemMatches, domainOf, extractIdentities, analyzeSecurity, daysAgo, expiryInfo,
  TYPE_LABELS,
} from './components/core'
import { makeClipboardCopier, CLIPBOARD_OPTIONS, Favicon, I, Select } from './components/ui'
import { useCategoryCatalog, loadCustomCategories } from './components/categoryCatalog'
import ItemDetail from './components/ItemDetail'
import ItemEditor from './components/ItemEditor'
import Generator from './components/Generator'
import SecurityCenter from './components/SecurityCenter'
import CategoriesView from './components/CategoriesView'
const PwsvcView = lazy(() => import('./components/PwsvcView'))

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

const ACTION_LABELS = {
  vault_initialized: '初始化 Vault', vault_keys_rotated: '密钥轮换',
  created: '新建条目', updated: '更新条目', password_changed: '修改密码',
  used: '使用', trashed: '移入回收站', restored: '恢复', purged: '永久删除',
  exported: '导出备份', imported: '导入备份',
}

export default function VaultPage() {
  const [phase, setPhase] = useState('loading')
  const [account, setAccount] = useState(null)
  const vekRef = useRef(null)
  const [session] = useState(createVaultSession)
  const reloadGeneration = useRef(0)
  const [syncError, setSyncError] = useState('')
  const [items, setItems] = useState([])

  const [section, setSection] = useState('overview')
  const [filterValue, setFilterValue] = useState(null)
  const [catActive, setCatActive] = useState(null)   // 类别页当前选中类别（跨编辑器开关保持）
  const [selectedId, setSelectedId] = useState(null)
  const [editing, setEditing] = useState(null)      // null | 'new' | item
  const [query, setQuery] = useState('')
  const [genOpen, setGenOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [prefs, setPrefs] = useState(loadPrefs)
  const [busy, setBusy] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const lastActivity = useRef(0)

  const copier = useMemo(() => {
    const opt = CLIPBOARD_OPTIONS.find(o => o.key === prefs.clipboard)
    return makeClipboardCopier(opt ? opt.ms : 30000)
  }, [prefs.clipboard])

  // ─── 初始化检查 ────────────────────────────────────────
  useEffect(() => {
    let alive = true
    vaultGetAccount().then(({ status, data }) => {
      if (!alive) return
      if (status === 200 && data.success) {
        setAccount(data.data)
        setPhase('locked')
      } else if (status === 404) {
        setPhase('setup')
      } else {
        setSyncError(data.message || '读取密码库失败'); setPhase('error')
      }
    }).catch(error => { if (alive) { setSyncError(error.message); setPhase('error') } })
    return () => { alive = false }
  }, [])

  // ─── 自动锁定 ──────────────────────────────────────────
  const lockNow = useCallback(() => {
    session.invalidate(); reloadGeneration.current += 1
    cancelVaultCrypto(); clearPwnedCache(); clearVaultClipboard()
    vekRef.current = null      // 清除内存中的 VEK
    setItems([]); setSelectedId(null); setEditing(null)
    setGenOpen(false); setSettingsOpen(false); setPaletteOpen(false); setConfirmPurge(null)
    setQuery(''); setBusy(false); setSyncError('')
    setPhase('locked')
  }, [session])

  useEffect(() => {
    const activeSession = session
    const unsubscribe = subscribeDataEpoch(lockNow)
    return () => { unsubscribe(); activeSession.invalidate(); reloadGeneration.current += 1; vekRef.current = null; cancelVaultCrypto(); clearPwnedCache() }
  }, [lockNow, session])

  useEffect(() => {
    if (phase !== 'unlocked') return
    const opt = LOCK_OPTIONS.find(o => o.key === prefs.lock)
    const ms = opt ? opt.ms : 15 * 60000
    const bump = () => { lastActivity.current = Date.now() }
    lastActivity.current = Date.now()
    window.addEventListener('pointerdown', bump)
    window.addEventListener('keydown', bump)
    const timer = setInterval(() => {
      if (ms > 0 && Date.now() - lastActivity.current > ms) lockNow()
    }, 15000)
    return () => {
      window.removeEventListener('pointerdown', bump)
      window.removeEventListener('keydown', bump)
      clearInterval(timer)
    }
  }, [phase, prefs.lock, lockNow])

  // ─── 数据同步 ──────────────────────────────────────────
  const reloadItems = useCallback(async (vek) => {
    const key = vek || vekRef.current
    if (!key) return
    const token = session.current(), load = ++reloadGeneration.current
    const current = () => session.isCurrent(token) && load === reloadGeneration.current && vekRef.current === key
    const liveRes = await vaultListItems(false)
    if (!current()) return
    if (!liveRes.success) throw new Error(liveRes.message || '读取条目失败')
    const result = await decryptBatches(liveRes.data.items, async it => ({ ...it, data: await decryptBlob(key, it.blob) }), {
      isCurrent: current, onBatch: batch => { if (current()) setItems(batch) },
    })
    if (current() && result) { setItems(result); setSyncError(result.length < liveRes.data.items.length ? `${liveRes.data.items.length - result.length} 个条目解密失败；密文仍保留，请检查备份。` : '') }
  }, [session])

  const unlock = async (secret, isRecovery) => {
    const token = session.begin()
    const vek = await unlockVault(account, secret, isRecovery)  // 密码错误会抛错
    session.assert(token)
    vekRef.current = vek
    setPhase('unlocked')
    try { await reloadItems(vek) }
    catch (error) { if (session.isCurrent(token)) setSyncError('读取条目失败：' + error.message) }
    session.assert(token)
  }

  // ─── 条目操作 ──────────────────────────────────────────
  const saveItem = async (data, existing) => {
    const token = session.current(), key = vekRef.current
    if (!key) return
    setBusy(true)
    try {
      const blob = await encryptBlob(key, data)
      session.assert(token)
      const meta = { blob, favorite: !!existing?.favorite, password_updated_at: data.password_updated_at }
      const res = existing ? await vaultUpdateItem(existing.id, meta) : await vaultCreateItem(meta)
      session.assert(token)
      if (!res.success) throw new Error(res.message || '保存失败')
      if (res.success) await reloadItems()
      setEditing(null)
      // 类别页新建后回到类别表（其余场景选中新条目进详情）
      if (res.success) setSelectedId(section === 'categories' ? null : res.data.id)
    } finally { if (session.isCurrent(token)) setBusy(false) }
  }

  const toggleFavorite = async (item) => {
    const token = session.current()
    const res = await vaultUpdateItem(item.id, { blob: item.blob, favorite: !item.favorite })
    if (res.success && session.isCurrent(token)) {
      setItems(prev => prev.map(x => x.id === item.id ? { ...x, favorite: !item.favorite } : x))
    }
  }

  const selectItem = (item) => {
    const token = session.current()
    setSelectedId(item.id)
    vaultMarkUsed(item.id).then(res => {
      if (res.success && session.isCurrent(token)) setItems(prev => prev.map(x => x.id === item.id ? { ...x, last_used_at: res.data.last_used_at } : x))
    }).catch(() => {})
  }

  // 回收站已移除：删除即永久删除（密文一并销毁），先弹确认
  const requestDelete = (item) => setConfirmPurge(item)
  const doPurge = async () => {
    const token = session.current()
    const item = confirmPurge
    setConfirmPurge(null)
    const res = await vaultPurgeItem(item.id)
    if (res.success && session.isCurrent(token)) { setSelectedId(null); await reloadItems() }
  }

  // ─── Command Palette (Ctrl/Cmd+K) ─────────────────────
  useEffect(() => {
    if (phase !== 'unlocked') return
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(p => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  // ─── 派生数据 ──────────────────────────────────────────
  const security = useMemo(() => analyzeSecurity(items), [items])
  const identities = useMemo(() => extractIdentities(items), [items])
  const { catalog, replaceCustom, addCategory, renameCategory, deleteCategory, labelOf } = useCategoryCatalog(items)
  const allTags = useMemo(() => {
    const s = new Set()
    items.forEach(i => (i.data.tags || []).forEach(t => s.add(t)))
    return [...s].sort()
  }, [items])
  const allCategories = useMemo(() => {
    const s = new Set()
    items.forEach(i => i.data.category && s.add(i.data.category))
    return [...s]
  }, [items])

  const listItems = useMemo(() => {
    let base = items.filter(i => !i.deleted_at)
    if (section === 'favorites') base = base.filter(i => i.favorite)
    if (section === 'category' && filterValue) base = base.filter(i => i.data.category === filterValue)
    if (section === 'tag' && filterValue) base = base.filter(i => (i.data.tags || []).includes(filterValue))
    if (section === 'identity' && filterValue) {
      const [type, value] = filterValue.split('||')
      base = base.filter(i => (i.data.identities || []).some(x => x.type === type && x.value.toLowerCase() === value.toLowerCase()))
    }
    const q = query.trim()
    return q ? base.filter(i => itemMatches(i, q)) : base
  }, [items, section, filterValue, query])

  const selectedItem = useMemo(
    () => items.find(i => i.id === selectedId) || null,
    [items, selectedId])

  useModuleNavigation({
    items: phase === 'unlocked' ? [
      { key: 'overview', label: '概览', icon: I.shield },
      { key: 'categories', label: '类别', icon: I.folder },
      { key: 'all', label: '全部条目', icon: I.key, badge: items.length, children: [
        ...allCategories.map(c => ({ key: `category:${c}`, label: labelOf(c), active: section === 'category' && filterValue === c })),
        ...allTags.map(t => ({ key: `tag:${t}`, label: `# ${t}`, active: section === 'tag' && filterValue === t })),
      ] },
      { key: 'favorites', label: '收藏', icon: I.star, badge: items.filter(i => i.favorite).length },
      { key: 'identities', label: '身份' }, { key: 'security', label: '安全中心', icon: I.shield },
      { key: 'pwsvc', label: '密码服务', icon: I.key },
    ] : [{ key: 'locked', label: phase === 'setup' ? '初始化密码库' : '解锁密码库' }],
    activeKey: section,
    onSelect: key => {
      const split = key.indexOf(':')
      setSection(split >= 0 ? key.slice(0, split) : key)
      if (split >= 0) setFilterValue(key.slice(split + 1))
      setSelectedId(null); setEditing(null)
    },
  })

  // ═══════════ 渲染 ═══════════
  return (
    <div className="min-h-[60vh] bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100">
      {syncError && <div role="alert" className="mb-3 rounded-lg p-3 bg-red-500/10 text-sm text-red-700 dark:text-red-300">{syncError}{phase === 'error' && <button onClick={() => window.location.reload()} className="ml-3 underline">重试</button>}</div>}
      {phase === 'loading' && (
        <div className="min-h-[60vh] flex items-center justify-center text-sm text-stone-400">加载中…</div>
      )}
      {phase === 'setup' && (
        <SetupView onDone={async () => {
          // 初始化完成后重新拉取账号材料（不信任调用方传参）
          const { status, data } = await vaultGetAccount()
          if (status === 200 && data.success) { setAccount(data.data); setPhase('locked') }
        }} />
      )}
      {phase === 'locked' && (
        <LockView account={account} onUnlock={unlock} />
      )}
      {phase === 'unlocked' && (
        <div className="h-[calc(100vh-64px)] min-h-[600px] flex flex-col">
          {/* 顶栏 */}
          <header className="min-h-10 shrink-0 flex flex-wrap items-center gap-3 mb-5">

            <span className="text-base font-semibold flex items-center gap-1.5">
              <span className="text-stone-400">{I.key}</span> 密码库
              <span className="inline text-[11px] font-normal text-stone-400 dark:text-stone-600 ml-1">端到端加密</span>
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => setPaletteOpen(true)}
                className="h-8 px-2.5 rounded-lg text-[12px] text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex items-center gap-1.5">
                {I.search} <span className="inline">搜索</span>
                <kbd className="inline text-[11px] px-1 py-px rounded border border-black/10 dark:border-white/15 font-mono">⌘K</kbd>
              </button>
              <button onClick={() => setGenOpen(true)} title="密码生成器"
                className="h-8 px-2.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">{I.dice}</button>
              <button onClick={() => setSettingsOpen(true)} title="设置"
                className="h-8 px-2.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>
              <button onClick={lockNow}
                className="h-8 px-2.5 rounded-lg text-[12px] text-stone-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors flex items-center gap-1.5">
                {I.lock} <span className="inline">锁定</span>
              </button>
            </div>
          </header>

          {/* 三面板 */}
          <div className="flex-1 flex min-h-0">
            {/* 列表 / 概览 / 安全中心 */}
            {(section === 'overview' || section === 'categories' || section === 'identities' || section === 'security' || section === 'pwsvc') && !selectedId && !editing ? (
              <main className="flex-1 min-w-0 overflow-y-auto">
                {section === 'overview' && (
                  <Overview items={items} security={security} identities={identities}
                    onSelect={selectItem} onGoSection={s => { setSection(s) }} onNew={() => setEditing('new')} />
                )}
                {section === 'categories' && (
                  <CategoriesView items={items} catalog={catalog} onNew={() => setEditing('new')}
                    active={catActive} onActiveChange={setCatActive}
                    onOpenItem={item => { setSection('category'); setFilterValue(item.data.category); setSelectedId(item.id) }}
                    onAddCategory={addCategory} onRenameCategory={renameCategory} onDeleteCategory={deleteCategory} />
                )}
                {section === 'identities' && (
                  <IdentitiesView identities={identities} onPick={(idv) => { setSection('identity'); setFilterValue(`${idv.type}||${idv.value}`) }} />
                )}
                {section === 'security' && <SecurityCenter items={items} onSelect={selectItem} vaultSession={session} />}
                {section === 'pwsvc' && <Suspense fallback={<p className="text-sm text-stone-500 dark:text-stone-400">加载密码服务…</p>}><PwsvcView copier={copier} /></Suspense>}
              </main>
            ) : (
              <>
                <section className="flex-1 min-w-0 flex flex-col border-r border-black/[0.07] dark:border-white/[0.07] max-w-[300px]">
                  <div className="p-2.5 border-b border-black/[0.07] dark:border-white/[0.07] flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400">{I.search}</span>
                      <input value={query} onChange={e => setQuery(e.target.value)}
                        placeholder="搜索：名称 / 用户名 / 邮箱 / 手机 / 域名 / 标签"
                        className="w-full h-8 pl-8 pr-2 text-[12px] bg-black/[0.03] dark:bg-white/[0.04] border border-transparent focus:border-black/10 dark:focus:border-white/10 focus:bg-white dark:focus:bg-white/[0.05] rounded-lg focus:outline-none transition-colors" />
                    </div>
                    <button onClick={() => setEditing('new')} title="新建"
                      className="w-8 h-8 shrink-0 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 flex items-center justify-center hover:opacity-90 transition-opacity">{I.plus}</button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {listItems.length === 0 ? (
                      <p className="py-16 text-center text-[12px] text-stone-400">
                        {query ? '没有匹配的条目' : '还没有条目'}
                      </p>
                    ) : <VirtualList items={listItems} getKey={item => item.id} estimateSize={60} height="100%" renderItem={item => (
                      <button key={item.id} onClick={() => selectItem(item)}
                        className={'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ' + (selectedId === item.id
                          ? 'bg-black/[0.045] dark:bg-white/[0.06]'
                          : 'hover:bg-black/[0.025] dark:hover:bg-white/[0.035]')}>
                        <Favicon domain={domainOf(item.data.urls?.[0]?.value)} name={item.data.service} size={26} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium truncate">{item.data.service || '未命名'}</span>
                            {item.favorite && <span className="text-amber-500 shrink-0">{I.starFill}</span>}
                          </div>
                          <div className="text-[11px] text-stone-400 truncate">
                            {item.data.username || item.data.account_id
                              || (item.data.identities || [])[0]?.value
                              || domainOf(item.data.urls?.[0]?.value) || (item.data.category ? labelOf(item.data.category) : '')}
                          </div>
                        </div>
                        <span className="text-[11px] text-stone-300 dark:text-stone-600 shrink-0">
                          {(item.data.urls?.[0]?.value ? domainOf(item.data.urls[0].value) : '')}
                        </span>
                      </button>
                    )} />}
                  </div>
                </section>

                {/* 详情 / 编辑器 */}
                <section className="block flex-1 min-w-0">
                  {editing ? (
                    <ItemEditor
                      key={editing === 'new' ? 'new' : editing.id}
                      initial={editing === 'new' ? null : editing.data}
                      catalog={catalog}
                      onCancel={() => setEditing(null)}
                      onSave={(data) => saveItem(data, editing === 'new' ? null : editing)}
                      saving={busy}
                    />
                  ) : selectedItem ? (
                    <ItemDetail
                      item={selectedItem}
                      copier={copier}
                      vek={vekRef.current}
                      vaultSession={session}
                      categoryLabel={labelOf}
                      onEdit={() => setEditing(selectedItem)}
                      onDelete={requestDelete}
                      onToggleFav={toggleFavorite}
                    />
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-stone-300 dark:text-stone-600 gap-3">
                      <span>{I.key}</span>
                      <p className="text-[12px]">选择一个条目查看详情</p>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>

          {/* 生成器 */}
          {genOpen && <Generator copier={copier} onClose={() => setGenOpen(false)} />}

          {/* Command Palette */}
          {paletteOpen && (
            <CommandPalette items={items} onClose={() => setPaletteOpen(false)}
              onSelect={(it) => { setPaletteOpen(false); setSection('all'); selectItem(it) }} />
          )}

          {/* 设置 */}
          {settingsOpen && (
            <SettingsView
              prefs={prefs} setPrefs={setPrefs}
              account={account} setAccount={setAccount}
              items={items} copier={copier}
              onRelock={lockNow}
              onCategoriesImported={replaceCustom}
              onImported={async () => { const { status, data } = await vaultGetAccount(); if (status === 200 && data.success) setAccount(data.data) }}
              onClose={() => setSettingsOpen(false)}
            />
          )}

          {/* 永久删除确认 */}
          {confirmPurge && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/30 dark:bg-black/60" onClick={() => setConfirmPurge(null)} />
              <div className="relative w-full max-w-xs bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.08] rounded-2xl shadow-xl p-5">
                <h3 className="text-base font-semibold mb-2">彻底删除？</h3>
                <p className="text-[12px] text-stone-400 leading-relaxed mb-5">「{confirmPurge.data?.service}」将被永久删除，无法恢复（密文一并销毁）。</p>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setConfirmPurge(null)} className="px-3.5 py-1.5 text-sm rounded-lg text-stone-500 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">取消</button>
                  <button onClick={doPurge} className="px-3.5 py-1.5 text-sm rounded-lg bg-red-500/90 text-white hover:bg-red-500 transition-colors">彻底删除</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── 子视图 ──────────────────────────────────────────────

function NavBtn({ active, onClick, icon, label, count, small, alert }) {
  return (
    <button onClick={onClick}
      className={'flex items-center gap-2 w-full px-2 rounded-lg transition-colors text-left ' + (small ? 'h-7' : 'h-8') + ' ' + (active
        ? 'bg-black/[0.055] dark:bg-white/[0.08] text-stone-900 dark:text-stone-100 font-medium'
        : 'text-stone-500 dark:text-stone-400 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] hover:text-stone-700 dark:hover:text-stone-200')}>
      {icon && <span className="shrink-0">{icon}</span>}
      <span className={'truncate ' + (small ? 'text-[12px]' : 'text-[12.5px]')}>{label}</span>
      {count != null && count > 0 && <span className="ml-auto text-[11px] text-stone-400 tabular-nums">{count}</span>}
      {alert > 0 && <span className="ml-auto text-[11px] px-2 py-0.5 rounded-md bg-red-500/10 text-red-600 dark:text-red-400">{alert}</span>}
    </button>
  )
}

function SideLabel({ children }) {
  return <div className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-widest text-stone-300 dark:text-stone-600">{children}</div>
}

function SetupView({ onDone }) {
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [recovery, setRecovery] = useState(null)   // {key, confirmed}
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [savedInput, setSavedInput] = useState('')

  const start = async () => {
    if (pw1.length < 8) return setErr('主密码至少 8 位——它保护你所有的密码，请设置强口令')
    if (pw1 !== pw2) return setErr('两次输入不一致')
    setErr(''); setBusy(true)
    try {
      const { account, recoveryKey } = await createVaultMaterial(pw1)
      const res = await vaultInitAccount(account)
      if (res.success) setRecovery(recoveryKey)   // 先展示 Recovery Key，用户确认后才 onDone
      else setErr(res.message || '初始化失败')
    } catch (e) { setErr('初始化失败：' + (e.message || e)) }
    finally { setBusy(false) }
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
    <Centered title="创建密码库" icon={I.shield}>
      <p className="text-[12.5px] text-stone-500 leading-relaxed mb-5">
        设置一个<b className="text-stone-700 dark:text-stone-200">主密码（Master Password）</b>。
        它在你的设备上通过 Argon2id 派生密钥，<b className="text-stone-700 dark:text-stone-200">永远不会离开这台设备</b>；
        服务端只保存加密后的数据。
      </p>
      <input type="password" value={pw1} onChange={e => setPw1(e.target.value)} autoFocus placeholder="主密码（≥8 位）"
        className={VAULT_INPUT} autoComplete="new-password" />
      <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="再输入一次"
        className={VAULT_INPUT + ' mt-2.5'} autoComplete="new-password" />
      {err && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-600 dark:text-red-400">{err}</p>}
      <button onClick={start} disabled={busy || !pw1 || !pw2}
        className="mt-5 w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90 transition-opacity disabled:bg-stone-400 dark:disabled:bg-stone-500 disabled:cursor-not-allowed">
        {busy ? '正在生成加密材料…' : '创建密码库'}
      </button>
    </Centered>
  )
}

function LockView({ account, onUnlock }) {
  const [secret, setSecret] = useState('')
  const [isRecovery, setIsRecovery] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const go = async () => {
    if (!secret) return
    setErr(''); setBusy(true)
    try {
      await onUnlock(secret, isRecovery)
    } catch {
      setErr(isRecovery ? 'Recovery Key 不正确' : '主密码不正确')
    } finally { setBusy(false) }
  }

  return (
    <Centered title={isRecovery ? '使用恢复密钥解锁' : '密码库已锁定'} icon={I.lock}>
      <input
        type={isRecovery ? 'text' : 'password'}
        value={secret}
        onChange={e => setSecret(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && go()}
        autoFocus placeholder={isRecovery ? '粘贴 Recovery Key…' : '输入主密码…'}
        className={VAULT_INPUT + ' font-mono'}
      />
      {err && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-600 dark:text-red-400">{err}</p>}
      <button onClick={go} disabled={busy || !secret}
        className="mt-5 w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90 transition-opacity disabled:bg-stone-400 dark:disabled:bg-stone-500 disabled:cursor-not-allowed">
        {busy ? '正在派生密钥…' : '解锁保险库'}
      </button>
      <button onClick={() => { setIsRecovery(r => !r); setErr(''); setSecret('') }}
        className="mt-3 text-[12px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors">
        {isRecovery ? '← 使用主密码解锁' : '忘记主密码？使用恢复密钥 →'}
      </button>

    </Centered>
  )
}

function Centered({ title, icon, children }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6 bg-stone-50 dark:bg-[#100f0e]">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-6">
          <div className="inline-flex w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 items-center justify-center text-emerald-600 dark:text-emerald-400 mb-3">
            <span>{I.key}</span>
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

function Overview({ items, security, identities, onSelect, onGoSection, onNew }) {
  const recentEdited = items.slice().sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')).slice(0, 6)
  const favorites = items.filter(i => i.favorite)
  const secCards = [
    { n: security.weak.length, label: '弱密码', hint: '强度不足' },
    { n: security.reused.length, label: '复用密码', hint: '多账号同密码' },
    { n: security.old.length, label: '过旧密码', hint: '超过 180 天未改' },
    { n: security.no2fa.length, label: '未开两步验证', hint: '建议开启 2FA' },
    { n: security.duplicate.length, label: '重复账号', hint: '疑似重复条目' },
    { n: security.missingRecovery.length, label: '缺恢复方式', hint: '未留后路' },
  ]
  const risky = secCards.reduce((a, c) => a + c.n, 0)
  const health = risky === 0 ? { label: '很好', color: '#16a34a', pct: 100 }
    : risky <= 2 ? { label: '良好', color: '#d97706', pct: 72 }
    : risky <= 5 ? { label: '需注意', color: '#ea580c', pct: 45 }
    : { label: '需处理', color: '#dc2626', pct: 22 }

  return (
    <div className="p-0 animate-fade-in max-w-full w-full mx-auto">
      {/* 头部：大数字 + 健康度 */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4 mb-7">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[40px] leading-none font-semibold tracking-tight tabular-nums">{items.length}</span>
            <span className="text-[15px] text-stone-400">个账号</span>
          </div>
          <p className="mt-2 text-[12px] text-stone-400">
            {items.filter(i => i.favorite).length} 个收藏 · {identities.length} 个身份 · {items.filter(i => i.last_used_at).length} 个用过
          </p>
        </div>
        <div className="ml-auto w-44">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[11px] font-medium uppercase tracking-widest text-stone-400">库健康度</span>
            <span className="text-[12px] font-semibold" style={{ color: health.color }}>{health.label}</span>
          </div>
          <div className="h-1.5 rounded-full bg-black/[0.06] dark:bg-white/[0.08] overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${health.pct}%`, background: health.color }} />
          </div>
          <p className="mt-1.5 text-[11px] text-stone-400">{risky === 0 ? '未发现风险项' : `${risky} 项待处理`}</p>
        </div>
        <button onClick={onNew} className="px-4 h-9 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm font-medium hover:opacity-90 transition-opacity inline-flex items-center gap-1.5 self-center">{I.plus} 新建条目</button>
      </div>

      {/* 密码到期提醒横条 */}
      {security.expired?.length > 0 && (
        <div className="mb-8 p-4 rounded-2xl bg-amber-500/[0.07] border border-amber-500/25">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-amber-600 dark:text-amber-400">{I.clock}</span>
            <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              {security.expired.length} 个密码已超过设定的提醒周期
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {security.expired.slice(0, 8).map(i => {
              const info = expiryInfo(i)
              return (
                <button key={i.id} onClick={() => onSelect(i)}
                  className="px-2.5 h-7 rounded-full bg-white/70 dark:bg-white/[0.06] border border-amber-500/20 text-[12px] text-stone-700 dark:text-stone-200 hover:border-amber-500/50 transition-colors">
                  {i.data.service || i.data.app_name || '未命名'}
                  <span className="text-amber-600 dark:text-amber-400 ml-1.5">已 {info.days} 天 / 设定 {info.limit} 天</span>
                </button>
              )
            })}
            {security.expired.length > 8 && (
              <span className="px-2.5 h-7 inline-flex items-center text-[12px] text-amber-600 dark:text-amber-400">等 {security.expired.length} 个…</span>
            )}
          </div>
        </div>
      )}

      <SecTitle>安全概览</SecTitle>
      <div className="grid grid-cols-6 gap-2.5 mb-9">
        {secCards.map(c => (
          <button key={c.label} onClick={() => onGoSection('security')}
            className={'group text-left p-3.5 rounded-2xl border transition-all ' + (c.n > 0
              ? 'border-red-500/20 bg-red-500/[0.04] hover:bg-red-500/[0.07] hover:border-red-500/35'
              : 'border-black/[0.07] dark:border-white/[0.07] hover:bg-black/[0.02] dark:hover:bg-white/[0.03]')}>
            <div className="flex items-start justify-between">
              <span className={'text-lg font-semibold tabular-nums ' + (c.n > 0 ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400')}>{c.n}</span>
              <span className={'w-1.5 h-1.5 rounded-full mt-1.5 ' + (c.n > 0 ? 'bg-red-500' : 'bg-emerald-500/70')} />
            </div>
            <div className="mt-2 text-[12.5px] font-medium">{c.label}</div>
            <div className="text-[11px] text-stone-400 mt-0.5">{c.hint}</div>
          </button>
        ))}
      </div>

      {/* 双栏内容区 */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-2">
        <div>
          {favorites.length > 0 && (
            <>
              <SecTitle>收藏</SecTitle>
              <MiniList items={favorites} onSelect={onSelect} />
            </>
          )}
          {identities.length > 0 && (
            <>
              <SecTitle>身份</SecTitle>
              <div className="mb-8 space-y-1">
                {identities.slice(0, 5).map(idv => (
                  <button key={idv.type + idv.value} onClick={() => onGoSection('identities')}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors text-left">
                    <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 w-12 text-center shrink-0">{idv.type === 'email' ? '邮箱' : '手机'}</span>
                    <span className="text-sm truncate flex-1">{idv.value}</span>
                    <span className="text-[12px] text-stone-400 shrink-0 tabular-nums">{idv.count} 个账号</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div>
          <SecTitle>最近修改</SecTitle>
          <MiniList items={recentEdited} onSelect={onSelect} />
        </div>
      </div>
    </div>
  )
}

function SecTitle({ children }) {
  return <h2 className="text-[11px] font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500 mb-3">{children}</h2>
}

function MiniList({ items, onSelect }) {
  return (
    <div className="space-y-1">
      {items.map(i => {
        const age = daysAgo(i.last_used_at || i.updated_at)
        return (
          <button key={i.id} onClick={() => onSelect(i)}
            className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-black/[0.05] dark:border-white/[0.05] bg-white dark:bg-white/[0.02] hover:border-black/[0.12] dark:hover:border-white/[0.12] hover:shadow-sm transition-all text-left">
            <Favicon domain={domainOf(i.data.urls?.[0]?.value)} name={i.data.service} size={26} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium truncate">{i.data.service}</span>
                {i.favorite && <span className="text-amber-500 shrink-0">{I.starFill}</span>}
              </div>
              <div className="text-[11px] text-stone-400 truncate">{i.data.username || i.data.account_id || '—'}</div>
            </div>
            <span className="text-[11px] text-stone-300 dark:text-stone-600 shrink-0 tabular-nums group-hover:text-stone-400 transition-colors">
              {i.last_used_at ? `${age ?? 0} 天前用过` : `${age ?? 0} 天前修改`}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function IdentitiesView({ identities, onPick }) {
  return (
    <div className="p-0 animate-fade-in max-w-full w-full mx-auto">
      <h1 className="text-xl font-semibold mb-1">身份</h1>
      <p className="text-[12px] text-stone-400 mb-8">你的每个邮箱 / 手机号在各服务上的分布——点击查看关联账号。</p>
      {identities.length === 0 ? (
        <p className="text-sm text-stone-400">暂无身份信息，先在条目里添加邮箱 / 手机号。</p>
      ) : (
        <div className="grid grid-cols-3 gap-2.5">
          {identities.map(idv => (
            <button key={idv.type + idv.value} onClick={() => onPick(idv)}
              className="group text-left p-4 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] hover:border-black/[0.15] dark:hover:border-white/[0.15] hover:shadow-sm transition-all">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">{idv.type === 'email' ? '邮箱' : '手机'}</span>
                <span className="ml-auto text-[12px] text-stone-400 tabular-nums">{idv.count} 个账号</span>
              </div>
              <div className="text-sm font-medium truncate">{idv.value}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CommandPalette({ items, onClose, onSelect }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const results = useMemo(() => items.filter(i => itemMatches(i, q)).slice(0, 8), [items, q])

  useEffect(() => setIdx(0), [q])
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && results[idx]) { e.preventDefault(); onSelect(results[idx]) }
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center pt-[15vh] px-4">
      <div className="absolute inset-0 bg-black/30 dark:bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden animate-dropdown">
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-black/[0.06] dark:border-white/[0.06]">
          <span className="text-stone-400">{I.search}</span>
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} autoFocus
            placeholder="搜索密码库…"
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-stone-400" />
          <kbd className="text-[11px] px-1.5 py-0.5 rounded border border-black/10 dark:border-white/15 text-stone-400 font-mono">ESC</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-stone-400">输入服务名 / 用户名 / 邮箱 / 手机 / 域名 / 标签</p>
          ) : results.map((item, i) => (
            <button key={item.id} onClick={() => onSelect(item)}
              onMouseEnter={() => setIdx(i)}
              className={'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ' + (i === idx ? 'bg-black/[0.05] dark:bg-white/[0.08]' : '')}>
              <Favicon domain={domainOf(item.data.urls?.[0]?.value)} name={item.data.service} size={24} />
              <span className="text-sm font-medium truncate">{item.data.service}</span>
              <span className="text-[11.5px] text-stone-400 truncate">{item.data.username}</span>
              <span className="ml-auto text-[11px] text-stone-300 dark:text-stone-600 shrink-0">{domainOf(item.data.urls?.[0]?.value)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── 设置（含改密/轮换/备份/审计）────────────────────────
function SettingsView({ prefs, setPrefs, account, setAccount, items, copier, onRelock, onCategoriesImported, onImported, onClose }) {
  const [tab, setTab] = useState('general')
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 dark:bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[85vh] bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.08] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="relative shrink-0 flex flex-wrap items-center gap-1 px-3 pr-12 pt-3 border-b border-black/[0.06] dark:border-white/[0.06]">
          {[['general', '通用'], ['security', '主密码与恢复'], ['backup', '备份'], ['activity', '活动记录']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={'px-3 h-9 whitespace-nowrap text-sm font-medium transition-colors border-b-2 -mb-px ' + (tab === k
                ? 'border-stone-800 dark:border-stone-100 text-stone-900 dark:text-stone-100'
                : 'border-transparent text-stone-400 hover:text-stone-600 dark:hover:text-stone-300')}>{l}</button>
          ))}
          <button onClick={onClose} aria-label="关闭设置" className="absolute right-2 top-3 w-8 h-8 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">✕</button>
        </div>
        <div className="overflow-y-auto p-5">
          {tab === 'general' && <GeneralTab prefs={prefs} setPrefs={setPrefs} account={account} />}
          {tab === 'security' && <SecurityTab account={account} setAccount={setAccount} copier={copier} />}
          {tab === 'backup' && <BackupTab items={items} account={account} onRelock={onRelock} onCategoriesImported={onCategoriesImported} onImported={onImported} />}
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
    } catch {}
  }
  return (
    <div className="space-y-6">
      <label className="flex items-start gap-2 text-sm text-stone-700 dark:text-stone-200"><input type="checkbox" checked={!!prefs.externalIcons} onChange={event => set('externalIcons', event.target.checked)} className="mt-1" /><span>加载外部站点图标<span className="block mt-1 text-xs text-stone-500 dark:text-stone-400">开启后会向 DuckDuckGo 图标服务发送条目域名；默认关闭。</span></span></label>
      <div>
        <label className="block text-[12px] font-medium text-stone-500 mb-1.5">自动锁定</label>
        <Select value={prefs.lock} onChange={v => set('lock', v)}
          options={LOCK_OPTIONS.map(o => ({ value: o.key, label: o.label }))} />
        <p className="mt-1.5 text-[11px] text-stone-400">锁定后清除内存中的加密密钥；页面刷新/关闭浏览器也会自动锁定。</p>
      </div>
      <div>
        <label className="block text-[12px] font-medium text-stone-500 mb-1.5">复制后自动清理剪贴板</label>
        <Select value={prefs.clipboard} onChange={v => set('clipboard', v)}
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

function SecurityTab({ account, setAccount, copier }) {
  const [cur, setCur] = useState('')
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
      const r = await rewrapVaultKey(account, cur, false, n1, false)
      const res = await vaultRotateKeys({ wrapped_vault_key: r.box, kdf_salt: r.salt, kdf_params: r.params })
      if (res.success) { setAccount(res.data); setMsg('✓ 主密码已修改（条目数据无需重加密）'); setCur(''); setN1(''); setN2('') }
      else setMsg(res.message || '失败')
    } catch { setMsg('当前主密码不正确') } finally { setBusy(false) }
  }

  const rotateRecovery = async () => {
    setBusy(true); setMsg('')
    try {
      const key = generateRecoveryKey()
      const r = await rewrapVaultKey(account, cur, false, key, true)
      const res = await vaultRotateKeys({ recovery_wrapped_vault_key: r.box, recovery_salt: r.salt })
      if (res.success) { setAccount(res.data); setNewRecovery(key) }
      else setMsg(res.message || '失败')
    } catch { setMsg('当前主密码不正确') } finally { setBusy(false) }
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
            <input type="password" className={input} placeholder="当前主密码" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" />
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
            <input type="password" className={input} placeholder="当前主密码" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" />
            <button onClick={rotateRecovery} disabled={busy || !cur}
              className="mt-2.5 px-3.5 h-9 rounded-lg border border-black/10 dark:border-white/15 text-sm text-stone-600 dark:text-stone-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-40">轮换恢复密钥</button>
          </div>
        </>
      )}
      {msg && <p className="text-[12px] text-stone-500">{msg}</p>}
    </div>
  )
}

function BackupTab({ items, account, onRelock, onCategoriesImported, onImported }) {
  const [csvStep, setCsvStep] = useState(0)
  const [csvPw, setCsvPw] = useState('')
  const [csvErr, setCsvErr] = useState('')
  const [importConfirm, setImportConfirm] = useState(null)
  const fileRef = useRef(null)

  const download = (name, content, type) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  const exportEncrypted = async () => {
    const res = await vaultExport()
    if (res.success) {
      // 自定义类别目录随备份往返（服务端不存 vault 元数据；后端导入忽略该字段）
      const payload = { ...res.data, custom_categories: loadCustomCategories() }
      download(`vault-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json')
    }
  }

  const doCsvExport = async () => {
    setCsvErr('')
    try {
      await unlockVault(account, csvPw, false)   // 本地验证主密码（不上传）
      const rows = [['name', 'url', 'username', 'password', 'notes']]
      for (const i of items) {
        rows.push([
          i.data.service || '', (i.data.urls || [])[0]?.value || '',
          i.data.username || '', i.data.password?.value || '', (i.data.notes || '').replace(/\n/g, '\\n'),
        ])
      }
      const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
      download(`vault-export-${new Date().toISOString().slice(0, 10)}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8')
      setCsvStep(0); setCsvPw('')
    } catch { setCsvErr('主密码不正确') }
  }

  const onImportFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const backup = JSON.parse(await file.text())
      // 备份内的自定义类别目录先落到本地（导入替换后立即可见，不依赖重新解锁）
      if (Array.isArray(backup.custom_categories)) onCategoriesImported(backup.custom_categories)
      setImportConfirm(backup)
    } catch { alert('无法解析备份文件') }
  }

  const doImport = async () => {
    const res = await vaultImport(importConfirm)
    setImportConfirm(null)
    if (res.success) {
      await onImported()
      onRelock()   // 密钥材料已变，重新解锁
    } else alert(res.message || '导入失败')
  }

  return (
    <div className="space-y-7">
      <div>
        <h4 className="text-sm font-semibold mb-1.5">加密备份（推荐）</h4>
        <p className="text-[11.5px] text-stone-400 mb-2.5">导出为自有加密格式（密文 + 密钥材料）。恢复时导入并使用原主密码/Recovery Key 解锁。</p>
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
            {csvErr && <p className="mt-2 text-[12px] text-red-500">{csvErr}</p>}
            <div className="flex gap-2 mt-3">
              <button onClick={() => { setCsvStep(0); setCsvPw('') }} className="px-3 h-9 rounded-lg text-sm text-stone-500 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">取消</button>
              <button onClick={doCsvExport} disabled={!csvPw}
                className="px-3.5 h-9 rounded-lg bg-red-500/90 text-white text-sm font-medium hover:bg-red-500 transition-colors disabled:opacity-40">导出明文 CSV</button>
            </div>
          </div>
        )}
      </div>
      <div className="pt-5 border-t border-black/[0.06] dark:border-white/[0.06]">
        <h4 className="text-sm font-semibold mb-1.5">导入备份</h4>
        <p className="text-[11.5px] text-stone-400 mb-2.5">导入加密备份文件将<b>替换</b>当前 Vault 的全部内容（需用备份时的主密码解锁）。</p>
        <input ref={fileRef} type="file" accept=".json" hidden onChange={onImportFile} />
        <button onClick={() => fileRef.current?.click()}
          className="px-3.5 h-9 rounded-lg border border-black/10 dark:border-white/15 text-sm text-stone-600 dark:text-stone-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">选择备份文件…</button>
      </div>

      {importConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setImportConfirm(null)} />
          <div className="relative w-full max-w-xs bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.08] rounded-2xl shadow-xl p-5">
            <h3 className="text-base font-semibold mb-2">导入并替换？</h3>
            <p className="text-[12px] text-stone-400 leading-relaxed mb-5">
              备份包含 {importConfirm.items?.length ?? '?'} 个条目。当前全部数据将被替换，此操作不可撤销。
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setImportConfirm(null)} className="px-3.5 py-1.5 text-sm rounded-lg text-stone-500 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">取消</button>
              <button onClick={doImport} className="px-3.5 py-1.5 text-sm rounded-lg bg-red-500/90 text-white hover:bg-red-500 transition-colors">替换导入</button>
            </div>
          </div>
        </div>
      )}
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
