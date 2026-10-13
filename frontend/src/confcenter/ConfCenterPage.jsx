/**
 * 配置中心页 /confcenter：namespace → key → value 的 KV 存储 + 可选 Redis 缓存层。
 *
 * - 左 namespace 列表（含计数，'' = 全部）+ 右 KV 表（key / 类型徽章 / 值预览 / 更新时间 / 操作）
 * - 新建/编辑 Modal：type 切换 str|json——str=多行文本原样；json=失焦校验，非法标红禁止保存
 * - 删除两步确认（第一步入列就位，3.5s 自动撤销）；搜索框 q（防抖）；分页
 * - 顶部 Redis 状态条（cache/status：已启用/未启用+去配置）+ 缓存配置 Modal（测试连接/保存/清空缓存）
 * 接口全部走 ./api（apiFetch + unwrap）；个性色 cyan——只用于徽章、主按钮、选中态；其余中性 stone。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import PageHeader from '../shared/PageHeader'
import {
  confNamespaces, confEntries, confGetEntry, confPutEntry, confDeleteEntry,
  confCacheStatus, confCacheConfig, confCacheSave, confCacheTest, confCacheFlush,
} from './api'

const card = 'rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]'
const inputCls = 'px-3 py-2 text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-lg text-stone-800 dark:text-stone-100 placeholder:text-stone-400 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors'
const btn = 'px-4 py-2 text-sm font-medium rounded-lg bg-black/[0.06] dark:bg-white/[0.08] text-stone-700 dark:text-stone-200 hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50'
const btnPri = 'px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-50'
const btnDanger = 'px-4 py-2 text-sm font-medium rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50'
const LBL = 'text-xs text-stone-500 dark:text-stone-400'
/** namespace / key 命名约束（与后端一致，防注入） */
const NAME_RE = /^[A-Za-z0-9_.:-]+$/

// ─── 响应形状归一（后端契约见 ./api：分页信封 / namespace 聚合数组） ──

function normEntries(d) {
  const rows = d?.items ?? []
  return { rows, total: d?.total ?? rows.length, page: d?.page ?? 1, page_size: d?.page_size ?? 50 }
}

function normNamespaces(d) {
  return (Array.isArray(d) ? d : []).map(x => ({ namespace: x.namespace, count: x.count }))
}

function fmtTime(s) {
  if (!s) return '-'
  const d = new Date(s)
  return isNaN(d) ? String(s) : d.toLocaleString('zh-CN', { hour12: false })
}

/** 值预览：str 原文（截断 + title 全文）；json pretty（≤3 行折叠，title 全文） */
function ValuePreview({ type, data }) {
  if (type === 'json') {
    let text = ''
    if (typeof data === 'string') {
      try { text = JSON.stringify(JSON.parse(data), null, 2) } catch { text = data }
    } else {
      text = JSON.stringify(data ?? null, null, 2)
    }
    return (
      <pre title={text}
        className="font-mono text-[12px] leading-snug text-stone-600 dark:text-stone-300 whitespace-pre-wrap break-all line-clamp-3 max-w-[380px]">
        {text}
      </pre>
    )
  }
  const text = typeof data === 'string' ? data : (data == null ? '' : String(data))
  return (
    <span title={text} className="block max-w-[280px] truncate text-stone-600 dark:text-stone-300">
      {text}
    </span>
  )
}

/** 类型徽章：str=stone 中性；json=cyan 个性色 */
function TypeBadge({ type }) {
  return type === 'json' ? (
    <span className="px-1.5 py-0.5 rounded-md text-[11px] font-mono font-medium bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">json</span>
  ) : (
    <span className="px-1.5 py-0.5 rounded-md text-[11px] font-mono font-medium bg-stone-500/10 text-stone-600 dark:text-stone-300">str</span>
  )
}

/** 轻提示（约 2.4s 自动消失；error=红底，其余 stone 反色） */
function Toast({ t }) {
  if (!t?.msg) return null
  return (
    <div className={'fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] rounded-lg px-3 py-2 text-[13px] shadow-lg animate-fade-in ' +
      (t.kind === 'error'
        ? 'bg-red-500 text-white'
        : 'bg-stone-800 dark:bg-stone-100 dark:text-stone-900 text-white')}>
      {t.msg}
    </div>
  )
}

/** 通用 Modal 壳：半透明遮罩（点击/Esc 关闭）+ 居中面板 */
function Mask({ onClose, children, wide }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 backdrop-blur-[2px] flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`${card} w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} relative p-5 sm:p-6 my-4 max-h-[calc(100dvh-32px)] overflow-y-auto shadow-2xl`} role="dialog" aria-modal="true">
        <button type="button" onClick={onClose} aria-label="关闭弹窗" className="absolute right-3 top-3 w-8 h-8 rounded-lg text-stone-500 hover:bg-black/5 dark:hover:bg-white/10">×</button>
        {children}
      </div>
    </div>
  )
}

// ─── Redis 状态条 + 缓存配置 ────────────────────────────────

/**
 * 三态：绿 dot=已启用（探活可达）；琥珀 dot=已配置但降级（连不上，直连 DB）；灰 dot=未配置。
 * 附 url_masked + 命中计数；未配置时按钮文案「去配置」。
 */
function CacheBar({ cache, onOpen }) {
  let dot = 'bg-stone-400 dark:bg-stone-500'
  let label = '未启用'
  if (cache?.enabled) { dot = 'bg-emerald-500'; label = '缓存已启用' }
  else if (cache?.configured) { dot = 'bg-amber-500'; label = '已配置 · 连接异常（降级直连）' }
  else if (cache == null) label = '状态加载中…'
  return (
    <div className={`${card} flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-xs`}>
      <span className="flex items-center gap-2 shrink-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span className="font-medium text-stone-700 dark:text-stone-200">Redis · {label}</span>
      </span>
      {cache?.url_masked && (
        <span className="font-mono text-stone-500 dark:text-stone-400 break-all">{cache.url_masked}</span>
      )}
      {cache?.configured && (
        <span className="text-stone-500 dark:text-stone-400 tabular-nums whitespace-nowrap">
          命中 {cache.hits ?? 0} / 未命中 {cache.misses ?? 0}
        </span>
      )}
      <button onClick={onOpen}
        className="ml-auto px-3 h-7 rounded-lg text-xs font-medium shrink-0 text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">
        {cache?.configured ? '缓存配置' : '去配置'}
      </button>
    </div>
  )
}

/** 缓存配置 Modal：enabled/host/port/db/password/ttl + 测试连接 / 保存 / 清空缓存 */
function CacheModal({ status, onClose, onSaved, say }) {
  const [cfg, setCfg] = useState({ enabled: false, host: 'localhost', port: 6379, db: 0, password: '', ttl_seconds: 3600 })
  const [loaded, setLoaded] = useState(false)   // 回显完成前禁存，防默认值覆盖真实配置
  const [busy, setBusy] = useState('')          // '' | test | save | flush
  const [msg, setMsg] = useState(null)          // {tone:'ok'|'err', text}

  // 回显当前配置（密码不回显——留空 = 沿用已存密码）
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await confCacheConfig()
        if (alive && data) setCfg(c => ({
          ...c,
          enabled: !!data.enabled,
          host: data.host ?? c.host,
          port: data.port ?? c.port,
          db: data.db ?? c.db,
          ttl_seconds: data.ttl_seconds ?? c.ttl_seconds,
          password: '',
        }))
      } catch {
        // 回显失败不阻断表单——ttl 兜底取 status 里的
        if (alive && status?.ttl_seconds) setCfg(c => ({ ...c, ttl_seconds: status.ttl_seconds }))
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    return () => { alive = false }
  }, [status])

  /** 密码留空 = 省略字段沿用已存值（后端 normalize_config 语义），而非置空 */
  const payload = () => {
    const p = {
      enabled: !!cfg.enabled,
      host: String(cfg.host || '').trim(),
      port: +cfg.port || 6379,
      db: +cfg.db || 0,
      ttl_seconds: +cfg.ttl_seconds || 3600,
    }
    if (cfg.password) p.password = cfg.password
    return p
  }

  async function onTest() {
    if (!String(cfg.host || '').trim()) { setMsg({ tone: 'err', text: 'host 不能为空' }); return }
    setBusy('test'); setMsg(null)
    try {
      const d = await confCacheTest(payload())
      setMsg({ tone: d.ok ? 'ok' : 'err', text: d.message })
    } catch (e) {
      setMsg({ tone: 'err', text: e.message })
    } finally { setBusy('') }
  }

  async function onSave() {
    if (!String(cfg.host || '').trim()) { setMsg({ tone: 'err', text: 'host 不能为空' }); return }
    setBusy('save'); setMsg(null)
    try {
      await confCacheSave(payload())
      say('缓存配置已保存')
      onSaved()
      onClose()
    } catch (e) {
      setMsg({ tone: 'err', text: e.message })
    } finally { setBusy('') }
  }

  async function onFlush() {
    if (!window.confirm('清空本模块缓存键（confcenter:* 前缀，非整库）？')) return
    setBusy('flush'); setMsg(null)
    try {
      const d = await confCacheFlush()
      setMsg({ tone: d.ok ? 'ok' : 'err', text: d.message || `已清理 ${d.deleted ?? 0} 个缓存键` })
      onSaved()
    } catch (e) {
      setMsg({ tone: 'err', text: e.message })
    } finally { setBusy('') }
  }

  return (
    <Mask onClose={onClose}>
      <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">Redis 缓存配置</h3>
      <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
        读穿缓存 + 写失效；未启用或不可达时自动降级直连数据库（写语义不受影响）
      </p>

      <label className="flex items-center gap-2 mt-4 text-sm cursor-pointer select-none">
        <input type="checkbox" className="accent-cyan-600 w-4 h-4" checked={cfg.enabled}
          onChange={e => setCfg({ ...cfg, enabled: e.target.checked })} />
        <span className="text-stone-700 dark:text-stone-200">启用缓存</span>
      </label>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        <div className="col-span-2">
          <label className={`${LBL} block mb-1.5`}>主机</label>
          <input className={`${inputCls} w-full`} value={cfg.host} placeholder="localhost"
            onChange={e => setCfg({ ...cfg, host: e.target.value })} />
        </div>
        <div>
          <label className={`${LBL} block mb-1.5`}>端口</label>
          <input className={`${inputCls} w-full`} type="number" min="1" max="65535" value={cfg.port}
            onChange={e => setCfg({ ...cfg, port: +e.target.value || 6379 })} />
        </div>
        <div>
          <label className={`${LBL} block mb-1.5`}>DB</label>
          <input className={`${inputCls} w-full`} type="number" min="0" value={cfg.db}
            onChange={e => setCfg({ ...cfg, db: +e.target.value || 0 })} />
        </div>
        <div className="col-span-2">
          <label className={`${LBL} block mb-1.5`}>密码</label>
          <input className={`${inputCls} w-full`} type="password" value={cfg.password} placeholder="留空沿用已存密码"
            onChange={e => setCfg({ ...cfg, password: e.target.value })} />
        </div>
        <div>
          <label className={`${LBL} block mb-1.5`}>TTL（秒）</label>
          <input className={`${inputCls} w-full`} type="number" min="1" value={cfg.ttl_seconds}
            onChange={e => setCfg({ ...cfg, ttl_seconds: +e.target.value || 3600 })} />
        </div>
      </div>

      {msg && (
        <div className={'mt-4 rounded-lg px-3 py-2 text-[13px] break-all ' +
          (msg.tone === 'ok'
            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            : 'bg-red-500/10 text-red-600 dark:text-red-400')}>
          {msg.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5 mt-5">
        <button className={btn} disabled={busy !== '' || !loaded} onClick={onTest}>
          {busy === 'test' ? '测试中…' : '测试连接'}
        </button>
        <button className={btnPri} disabled={busy !== '' || !loaded} onClick={onSave}>
          {busy === 'save' ? '保存中…' : '保存'}
        </button>
        <button className={`${btnDanger} ml-auto`} disabled={busy !== ''} onClick={onFlush}>
          {busy === 'flush' ? '清理中…' : '清空缓存'}
        </button>
      </div>
    </Mask>
  )
}

// ─── 新建 / 编辑 Modal ─────────────────────────────────────

/** 新建/编辑 Modal：type 段选——str=多行原样；json=失焦校验非法标红禁存 */
function EntryModal({ init, defaultNs, onClose, onSaved, say }) {
  const isEdit = init.mode === 'edit'
  const [ns, setNs] = useState(isEdit ? init.entry.namespace : (defaultNs || ''))
  const [key, setKey] = useState(isEdit ? init.entry.key : '')
  const [type, setType] = useState(isEdit ? (init.entry.type || 'str') : 'str')
  const [data, setData] = useState(() => {
    if (!isEdit || init.entry.data === undefined) return ''
    const d = init.entry.data
    return typeof d === 'string' ? d : JSON.stringify(d ?? null, null, 2)
  })
  const [jsonErr, setJsonErr] = useState(null)
  const [busy, setBusy] = useState(false)
  // 列表行不含 data 时（防御）才回源读单条
  const [fetching, setFetching] = useState(isEdit && init.entry.data === undefined)

  useEffect(() => {
    if (!isEdit || init.entry.data !== undefined) return
    let alive = true
    confGetEntry(init.entry.namespace, init.entry.key)
      .then(d => {
        if (!alive) return
        setType(d.type || 'str')
        setData(typeof d.data === 'string' ? d.data : JSON.stringify(d.data ?? null, null, 2))
      })
      .catch(e => { if (alive) say(`读取失败：${e.message}`, 'error') })
      .finally(() => { if (alive) setFetching(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** json 失焦校验：非法 → 标红 + 禁存（保存前 canSave 兜底再校一次） */
  function checkJson() {
    if (type !== 'json') return
    try { JSON.parse(data); setJsonErr(null) }
    catch { setJsonErr('不是合法的 JSON 文本') }
  }

  const nsOk = ns.length <= 100 && NAME_RE.test(ns)
  const keyOk = key.length <= 200 && NAME_RE.test(key)
  const dataOk = type === 'str' ||
    (() => { try { JSON.parse(data); return true } catch { return false } })()
  const canSave = !busy && !fetching && nsOk && keyOk && dataOk

  async function onSave() {
    if (!canSave) return
    setBusy(true)
    try {
      await confPutEntry(ns, key, { type, data })
      say(isEdit ? `已更新 ${ns}/${key}` : `已创建 ${ns}/${key}`)
      onSaved()
      onClose()
    } catch (e) {
      say(`保存失败：${e.message}`, 'error')
    } finally { setBusy(false) }
  }

  return (
    <Mask onClose={onClose} wide>
      <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
        {isEdit ? '编辑配置' : '新建配置'}
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        <div>
          <label className={`${LBL} block mb-1.5`}>namespace</label>
          <input className={`${inputCls} w-full font-mono disabled:opacity-60 disabled:cursor-not-allowed`}
            value={ns} disabled={isEdit} placeholder="如 app"
            onChange={e => setNs(e.target.value)} />
          {ns && !nsOk && (
            <div className="mt-1 text-xs text-red-600 dark:text-red-400">仅允许字母数字 _ . : -（≤100 字符）</div>
          )}
        </div>
        <div>
          <label className={`${LBL} block mb-1.5`}>key</label>
          <input className={`${inputCls} w-full font-mono disabled:opacity-60 disabled:cursor-not-allowed`}
            value={key} disabled={isEdit} placeholder="如 feature_flags"
            onChange={e => setKey(e.target.value)} />
          {key && !keyOk && (
            <div className="mt-1 text-xs text-red-600 dark:text-red-400">仅允许字母数字 _ . : -（≤200 字符）</div>
          )}
        </div>
      </div>
      {isEdit && (
        <p className="mt-1.5 text-[11px] text-stone-400 dark:text-stone-500">
          编辑时不可改 namespace / key（复合主键）——需要请另存新条目
        </p>
      )}

      <div className="mt-4">
        <label className={`${LBL} block mb-1.5`}>类型</label>
        <div className="flex gap-1 p-1 rounded-xl w-fit bg-black/[0.05] dark:bg-white/[0.06]">
          {['str', 'json'].map(t => (
            <button key={t} type="button"
              onClick={() => { setType(t); setJsonErr(null) }}
              className={'px-5 h-8 rounded-lg text-sm font-mono font-medium transition-colors ' +
                (type === t
                  ? 'bg-cyan-600 text-white'
                  : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200')}>
              {t}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-stone-400 dark:text-stone-500">
          {type === 'str' ? 'str —— 原样字符串，不做任何解析' : 'json —— 保存时须为合法 JSON 文本（对象 / 数组 / 数字…）'}
        </p>
      </div>

      <div className="mt-4">
        <label className={`${LBL} block mb-1.5`}>值</label>
        <textarea value={data} onChange={e => setData(e.target.value)} onBlur={checkJson} rows={8}
          spellCheck={false}
          className={`${inputCls} w-full font-mono text-[13px] leading-relaxed resize-y ` +
            (jsonErr ? '!border-red-400 dark:!border-red-500' : '')} />
        {jsonErr && (
          <div className="mt-1 text-xs text-red-600 dark:text-red-400">{jsonErr}——修正后再保存</div>
        )}
      </div>

      <div className="flex justify-end gap-2.5 mt-5">
        <button className={btn} onClick={onClose}>取消</button>
        <button className={btnPri} disabled={!canSave} onClick={onSave}>
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </Mask>
  )
}

// ─── 页面 ──────────────────────────────────────────────────

export default function ConfCenterPage() {
  const [ns, setNs] = useState('')            // 当前 namespace 过滤（'' = 全部）
  const [qInput, setQInput] = useState('')    // 搜索框即时值
  const [q, setQ] = useState('')              // 防抖后的查询词
  const [page, setPage] = useState(1)
  const [namespaces, setNamespaces] = useState(null)  // null = 加载中
  const [cache, setCache] = useState(null)
  const [list, setList] = useState(null)      // {rows,total,page,pages}
  const [editing, setEditing] = useState(null)
  const [cacheOpen, setCacheOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [delTarget, setDelTarget] = useState(null)    // `${namespace}\u0000${key}`（两步删除第一步入列）
  const delTimer = useRef(null)
  const toastTimer = useRef(null)

  const say = useCallback((msg, kind) => {
    setToast({ msg, kind })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2400)
  }, [])

  /** 元数据：namespace 聚合计数 + 缓存状态 */
  const loadMeta = useCallback(async () => {
    try {
      const [nsList, st] = await Promise.all([confNamespaces(), confCacheStatus()])
      setNamespaces(normNamespaces(nsList))
      setCache(st)
    } catch (e) {
      say(`元数据加载失败：${e.message}`, 'error')
    }
  }, [say])

  useEffect(() => { loadMeta() }, [loadMeta])

  const fetchList = useCallback(async (p = 1) => {
    setList(null)
    try {
      const d = normEntries(await confEntries({ namespace: ns, q, page: p }))
      const pages = Math.max(1, Math.ceil(d.total / Math.max(1, d.page_size)))
      setList({ ...d, page: Math.min(d.page || p, pages), pages })
    } catch (e) {
      setList({ rows: [], total: 0, page: 1, page_size: 50, pages: 1 })
      say(`列表加载失败：${e.message}`, 'error')
    }
  }, [ns, q, say])

  useEffect(() => { fetchList(page) }, [fetchList, page])

  // 搜索防抖：300ms 后提交 q 并回到第一页
  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [qInput])

  useEffect(() => () => { clearTimeout(delTimer.current); clearTimeout(toastTimer.current) }, [])

  const totalCount = (namespaces || []).reduce((s, n) => s + (n.count ?? 0), 0)

  const onEntrySaved = useCallback(() => {
    if (page === 1) fetchList(1)
    else setPage(1)
    loadMeta()
  }, [page, fetchList, loadMeta])

  /** 两步删除第一步入列；3.5s 无操作自动撤销（重新计时） */
  function armDel(id) {
    clearTimeout(delTimer.current)
    setDelTarget(id)
    delTimer.current = setTimeout(() => setDelTarget(null), 3500)
  }

  function disarmDel() {
    clearTimeout(delTimer.current)
    setDelTarget(null)
  }

  async function onDel(namespace, key) {
    clearTimeout(delTimer.current)
    setDelTarget(null)
    try {
      await confDeleteEntry(namespace, key)
      say(`已删除 ${namespace}/${key}`)
      // 当前页删空且不在第一页 → 回退一页，否则原地刷新
      if (list?.rows?.length === 1 && page > 1) setPage(page - 1)
      else fetchList(list?.page || page || 1)
      loadMeta()
    } catch (e) {
      say(`删除失败：${e.message}`, 'error')
    }
  }

  return (
    <div className="min-h-0 bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 transition-colors">
      <PageHeader title="配置中心" subtitle="namespace → key → value · Redis 缓存"  />

      <div className="p-0 max-w-full mx-auto">
        <CacheBar cache={cache} onOpen={() => setCacheOpen(true)} />

        <div className="mt-4 flex flex-col lg:flex-row gap-4 items-stretch">
          {/* 左：namespace 列表（计数） */}
          <aside className={`${card} w-full lg:w-56 shrink-0 p-2 lg:self-start lg:sticky lg:top-20`}>
            <button
              onClick={() => { setNs(''); setPage(1) }}
              className={'w-full flex items-center justify-between gap-2 px-3 h-9 rounded-lg text-sm transition-colors ' +
                (ns === ''
                  ? 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 font-medium'
                  : 'text-stone-600 dark:text-stone-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]')}>
              <span className="font-mono text-[13px]">全部</span>
              <span className="text-xs text-stone-400 tabular-nums shrink-0">
                {namespaces == null ? '…' : totalCount || (namespaces.length ? '' : 0)}
              </span>
            </button>
            {namespaces == null && (
              <div className="px-3 py-2 text-xs text-stone-400">加载中…</div>
            )}
            {namespaces != null && !namespaces.length && (
              <div className="px-3 py-2 text-xs text-stone-400">暂无 namespace</div>
            )}
            {(namespaces || []).map(n => (
              <button key={n.namespace}
                onClick={() => { setNs(n.namespace); setPage(1) }}
                className={'w-full flex items-center justify-between gap-2 px-3 h-9 rounded-lg text-sm transition-colors ' +
                  (ns === n.namespace
                    ? 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 font-medium'
                    : 'text-stone-600 dark:text-stone-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]')}>
                <span className="truncate font-mono text-[13px]">{n.namespace}</span>
                <span className="text-xs text-stone-400 tabular-nums shrink-0">{n.count ?? ''}</span>
              </button>
            ))}
          </aside>

          {/* 右：搜索 + KV 表 */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input value={qInput} onChange={e => setQInput(e.target.value)}
                placeholder="搜索 key…"
                className={`${inputCls} w-full sm:w-60`} />
              <span className="text-[11.5px] text-stone-400">
                {list == null ? '' : `共 ${list.total} 条${ns ? ` · ${ns}` : ''}`}
              </span>
              <button className={`${btnPri} ml-auto`} onClick={() => setEditing({ mode: 'new' })}>
                ＋ 新建配置
              </button>
            </div>

            <div className={`${card} overflow-x-auto`}>
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-stone-500 dark:text-stone-400 border-b border-black/[0.06] dark:border-white/[0.06]">
                    <th className="pl-4 pr-2 py-2 font-normal">{ns ? 'key' : 'namespace / key'}</th>
                    <th className="px-2 py-2 font-normal">类型</th>
                    <th className="px-2 py-2 font-normal">值预览</th>
                    <th className="px-2 py-2 font-normal">更新时间</th>
                    <th className="pl-2 pr-4 py-2 font-normal text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {list == null && (
                    <tr><td colSpan={5} className="py-10 text-center text-xs text-stone-400">加载中…</td></tr>
                  )}
                  {list != null && !list.rows.length && (
                    <tr><td colSpan={5} className="py-10 text-center text-xs text-stone-400">
                      暂无配置{q ? `匹配“${q}”的 key` : ''}——点右上「新建配置」创建第一条
                    </td></tr>
                  )}
                  {list != null && list.rows.map(e => {
                    const id = `${e.namespace}\u0000${e.key}`
                    return (
                      <tr key={id}
                        className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-black/[0.015] dark:hover:bg-white/[0.02] transition-colors">
                        <td className="pl-4 pr-2 py-2.5">
                          <div className="font-mono text-[13px] leading-snug break-all text-stone-800 dark:text-stone-100">
                            {ns
                              ? e.key
                              : <>{e.namespace}<span className="text-stone-400 dark:text-stone-500"> / </span>{e.key}</>}
                          </div>
                        </td>
                        <td className="px-2 py-2.5 whitespace-nowrap"><TypeBadge type={e.type} /></td>
                        <td className="px-2 py-2.5 max-w-[400px]"><ValuePreview type={e.type} data={e.data} /></td>
                        <td className="px-2 py-2.5 whitespace-nowrap text-xs text-stone-500 dark:text-stone-400">
                          {fmtTime(e.updated_at)}
                        </td>
                        <td className="pl-2 pr-4 py-2.5 text-right whitespace-nowrap">
                          {delTarget === id ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-[11.5px] text-red-600 dark:text-red-400">确认删除？</span>
                              <button onClick={() => onDel(e.namespace, e.key)}
                                className="px-2 h-7 rounded-md text-xs bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors">
                                确认
                              </button>
                              <button onClick={disarmDel}
                                className="px-2 h-7 rounded-md text-xs text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
                                取消
                              </button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <button onClick={() => setEditing({ mode: 'edit', entry: e })}
                                className="px-2.5 h-7 rounded-md text-xs text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">
                                编辑
                              </button>
                              <button onClick={() => armDel(id)}
                                className="px-2.5 h-7 rounded-md text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors">
                                删除
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {list && list.pages > 1 && (
              <div className="flex items-center justify-between mt-3 text-xs text-stone-500 dark:text-stone-400">
                <span>共 {list.total} 条</span>
                <div className="flex items-center gap-2">
                  <button disabled={list.page <= 1} onClick={() => setPage(list.page - 1)}
                    className="px-2.5 h-8 rounded-lg text-sm text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] disabled:opacity-40">‹ 上一页</button>
                  <span className="tabular-nums">{list.page} / {list.pages}</span>
                  <button disabled={list.page >= list.pages} onClick={() => setPage(list.page + 1)}
                    className="px-2.5 h-8 rounded-lg text-sm text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] disabled:opacity-40">下一页 ›</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <EntryModal init={editing} defaultNs={ns}
          onClose={() => setEditing(null)} onSaved={onEntrySaved} say={say} />
      )}
      {cacheOpen && (
        <CacheModal status={cache} onClose={() => setCacheOpen(false)}
          onSaved={loadMeta} say={say} />
      )}
      <Toast t={toast} />
    </div>
  )
}
