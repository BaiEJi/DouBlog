/**
 * 配置中心页 /confcenter：公共侧栏两个同级视图（PageHeader tabs 注册）——
 * · 配置管理（entries）：namespace → KV + Redis 缓存状态/配置；表头四数据列
 *   key/类型/值预览/更新时间支持升降排序（SQL 端完整结果集排序，跨页稳定）
 * · 限流配置（ratelimit）：独立主页面（RateLimitPage），不再用限流 Modal
 *
 * - 先创建独立 namespace；左侧选择空间，右侧只管理当前空间的 KV
 * - 新建/编辑 Modal：type 切换 str|json 共用同一个带行号的值编辑器
 *   （CodeMirror；str 原样文本，json 着色 + Worker 格式化/压缩 + 校验非法禁存）；
 *   值工具栏提供字号调整（默认 15px、12–24 整数、localStorage 持久化）；
 *   反馈区固定占位（48px），格式化/校验状态变化不改变弹窗几何布局
 * - 删除两步确认（第一步入列就位，3.5s 自动撤销）；搜索框 q（防抖）；分页
 * - 顶部 Redis 缓存状态条（cache/status）+ 缓存配置 Modal（测试连接/保存/清空缓存）
 * - URL：?view=entries|ratelimit&namespace=… 可深链/刷新；缺省/非法 view 回 entries
 * 接口全部走 ./api（apiFetch + unwrap）；个性色 cyan——只用于徽章、主按钮、选中态；其余中性 stone。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../shared/PageHeader'
import JsonEditor, { JsonHighlightedView } from './JsonEditor'
import useJsonValue from './useJsonValue'
import RateLimitPage from './RateLimitPage'
import Select from './Select'
import { FONT_DEFAULT, FONT_MIN, FONT_MAX, loadFontSize, saveFontSize, clampFontSize } from './editorPreferences'
import {
  confNamespaces, confCreateNamespace, confEntries, confGetEntry, confPutEntry, confDeleteEntry,
  confRenameEntry, confCacheStatus, confCacheConfig, confCacheSave, confCacheTest, confCacheFlush,
} from './api'

const card = 'rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]'
const modalCard = 'rounded-2xl border border-black/[0.07] dark:border-white/[0.1] bg-white dark:bg-[#1c1b1a]'
const inputCls = 'px-3 py-2 text-base bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-lg text-stone-800 dark:text-stone-100 placeholder:text-stone-400 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors'
const btn = 'px-4 py-2 text-base font-medium rounded-lg bg-black/[0.06] dark:bg-white/[0.08] text-stone-700 dark:text-stone-200 hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50'
const btnPri = 'px-4 py-2 text-base font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-50'
const btnDanger = 'px-4 py-2 text-base font-medium rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50'
const LBL = 'text-sm text-stone-500 dark:text-stone-400'
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

/** API 的 json data 已解析；字符串标量也须保留引号，不能再次 JSON.parse。 */
function valueText({ type, data }, pretty = false) {
  return type === 'json'
    ? JSON.stringify(data ?? null, null, pretty ? 2 : undefined)
    : (data == null ? '' : String(data))
}

/** 表格保持单行，完整值在只读弹窗查看，避免截断的 JSON 撑高列表。
 * 点击热区经 after 伪元素撑满整个单元格（覆盖 td 的 px-2/py-2.5 内边距）——
 * 点值文本任意处即打开预览，不必瞄准右侧图标。 */
function ValuePreview({ entry, onEdit }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef(null)
  const text = valueText(entry)
  const pretty = valueText(entry, true)
  const close = () => { setOpen(false); trigger.current?.focus() }
  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(true)} aria-label={`预览 ${entry.key}`} title="查看完整值"
        className="group relative flex w-full min-w-0 items-center gap-2 h-8 px-2.5 rounded-lg border border-black/[0.05] dark:border-white/[0.06] bg-stone-50 dark:bg-black/15 text-left hover:bg-stone-100 dark:hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 transition-colors cursor-pointer after:absolute after:-inset-x-2 after:-inset-y-2.5 after:content-['']">
        <span className={`min-w-0 flex-1 truncate font-mono text-sm ${text === '' ? 'text-stone-400 dark:text-stone-500 italic' : 'text-stone-600 dark:text-stone-300'}`}>
          {text === '' ? '空字符串' : text.replace(/\r\n|\r|\n/g, ' ↵ ')}
        </span>
        <svg className="w-3.5 h-3.5 shrink-0 text-stone-400 dark:text-stone-500 group-hover:text-stone-700 dark:group-hover:text-stone-200" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <Mask onClose={close} wide label="值预览">
        <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">值预览</h3>
        <div className="mt-2 flex items-center gap-2 pr-4 min-w-0">
          <span className="min-w-0 truncate font-mono text-sm text-stone-500 dark:text-stone-400" title={`${entry.namespace}/${entry.key}`}>{entry.namespace} / {entry.key}</span>
          <TypeBadge type={entry.type} />
        </div>
        {text === ''
          ? <pre tabIndex={0} aria-label="完整值" className="mt-4 min-h-40 max-h-[55vh] overflow-auto rounded-xl border border-black/[0.06] dark:border-white/[0.08] bg-stone-50 dark:bg-black/20 p-4 font-mono text-[15px] leading-6 whitespace-pre-wrap break-all text-stone-700 dark:text-stone-200 selection:bg-cyan-500/20"><span className="italic text-stone-400 dark:text-stone-500">空字符串</span></pre>
          : entry.type === 'json'
            ? <div className="mt-4"><JsonHighlightedView text={pretty} /></div>
            : <pre tabIndex={0} aria-label="完整值" className="mt-4 min-h-40 max-h-[55vh] overflow-auto rounded-xl border border-black/[0.06] dark:border-white/[0.08] bg-stone-50 dark:bg-black/20 p-4 font-mono text-[15px] leading-6 whitespace-pre-wrap break-all text-stone-700 dark:text-stone-200 selection:bg-cyan-500/20">{pretty}</pre>}
        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" className={btn} onClick={close} autoFocus>关闭</button>
          <button type="button" className={btnPri} onClick={() => { setOpen(false); onEdit() }}>编辑 KV</button>
        </div>
      </Mask>}
    </>
  )
}

/** 类型徽章：str=stone 中性；json=cyan 个性色 */
function TypeBadge({ type }) {
  return type === 'json' ? (
    <span className="px-1.5 py-0.5 rounded-md text-[13px] font-mono font-medium bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">json</span>
  ) : (
    <span className="px-1.5 py-0.5 rounded-md text-[13px] font-mono font-medium bg-stone-500/10 text-stone-600 dark:text-stone-300">str</span>
  )
}

/** 轻提示（约 2.4s 自动消失；error=红底，其余 stone 反色） */
function Toast({ t }) {
  if (!t?.msg) return null
  return (
    <div className={'fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] rounded-lg px-3 py-2 text-[15px] shadow-lg animate-fade-in ' +
      (t.kind === 'error'
        ? 'bg-red-500 text-white'
        : 'bg-stone-800 dark:bg-stone-100 dark:text-stone-900 text-white')}>
      {t.msg}
    </div>
  )
}

/** 通用 Modal 壳：半透明遮罩（点击/Esc 关闭）+ 居中面板；xwide 比 wide 再宽一档 */
function Mask({ onClose, children, wide, xwide, label }) {
  function containFocus(e) {
    if (e.key !== 'Tab') return
    const controls = [...e.currentTarget.querySelectorAll('button, input, textarea, select, [tabindex]')]
      .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length > 0)
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
  }
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`${modalCard} w-full ${xwide ? 'max-w-4xl' : wide ? 'max-w-2xl' : 'max-w-lg'} relative p-6 my-4 max-h-[calc(100vh-32px)] overflow-y-auto shadow-2xl`} role="dialog" aria-modal="true" aria-label={label} onKeyDown={containFocus}>
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
    <div className={`${card} flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm`}>
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
        className="ml-auto px-3 h-7 rounded-lg text-sm font-medium shrink-0 text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">
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
      <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Redis 缓存配置</h3>
      <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">
        读穿缓存 + 写失效；未启用或不可达时自动降级直连数据库（写语义不受影响）
      </p>

      <label className="flex items-center gap-2 mt-4 text-base cursor-pointer select-none">
        <input type="checkbox" className="accent-cyan-600 [color-scheme:light] dark:[color-scheme:dark] w-4 h-4" checked={cfg.enabled}
          onChange={e => setCfg({ ...cfg, enabled: e.target.checked })} />
        <span className="text-stone-700 dark:text-stone-200">启用缓存</span>
      </label>

      <div className="grid grid-cols-4 gap-3 mt-4">
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
        <div className={'mt-4 rounded-lg px-3 py-2 text-[15px] break-all ' +
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

// ─── 限流：独立主视图 RateLimitPage.jsx（原状态条 + 配置 Modal 迁移）──

function NamespaceModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const namespace = name.trim()
  const valid = namespace.length > 0 && namespace.length <= 100 && NAME_RE.test(namespace)
  async function create(e) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError('')
    try {
      const created = await confCreateNamespace(namespace)
      onCreated(created)
      onClose()
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  return (
    <Mask onClose={onClose}>
      <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">新建 namespace</h3>
      <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">创建一个独立空间，再在其中添加 KV 配置。</p>
      <form onSubmit={create} className="mt-5">
        <label htmlFor="conf-new-namespace" className={`${LBL} block mb-1.5`}>namespace 名称</label>
        <input id="conf-new-namespace" autoFocus autoComplete="off" maxLength={100}
          value={name} onChange={e => { setName(e.target.value); setError('') }} placeholder="如 app、service-prod"
          className={`${inputCls} w-full font-mono`} aria-invalid={!!error || (!!namespace && !valid)} />
        <p className="mt-2 text-sm text-stone-400 dark:text-stone-500">支持字母、数字及 _ . : -，最多 100 个字符。</p>
        {namespace && !valid && <p className="mt-2 text-sm text-red-600 dark:text-red-400">名称包含不支持的字符。</p>}
        {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" onClick={onClose} className={btn}>取消</button>
          <button type="submit" disabled={!valid || busy} className={btnPri}>{busy ? '创建中…' : '创建空间'}</button>
        </div>
      </form>
    </Mask>
  )
}

// ─── 新建 / 编辑 Modal ─────────────────────────────────────

/** 字号工具：标签“字号”+ A−/A+ + 统一下拉（12–24）+ 恢复默认；边界禁用，键盘可访问 */
function FontSizeControl({ fontSize, onChange }) {
  return (
    <span className="flex items-center gap-1">
      <span aria-hidden="true" className="text-[13px] text-stone-400 dark:text-stone-500">字号</span>
      <button type="button" aria-label="减小字号" disabled={fontSize <= FONT_MIN}
        onClick={() => onChange(fontSize - 1)}
        className="w-6 h-6 rounded-md text-[13px] font-medium text-stone-500 dark:text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors disabled:opacity-40">A−</button>
      <Select size="sm" className="w-14 tabular-nums" value={fontSize}
        ariaLabel="编辑器字号"
        options={Array.from({ length: FONT_MAX - FONT_MIN + 1 }, (_, i) => FONT_MIN + i).map(px => ({ value: px, label: String(px) }))}
        onChange={onChange} />
      <button type="button" aria-label="增大字号" disabled={fontSize >= FONT_MAX}
        onClick={() => onChange(fontSize + 1)}
        className="w-6 h-6 rounded-md text-[13px] font-medium text-stone-500 dark:text-stone-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors disabled:opacity-40">A+</button>
      {fontSize !== FONT_DEFAULT && (
        <button type="button" onClick={() => onChange(FONT_DEFAULT)}
          className="px-1.5 h-6 rounded-md text-[13px] text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/10 transition-colors">恢复默认</button>
      )}
    </span>
  )
}

/**
 * 新建/编辑 Modal：type 段选切换 str|json——同一个带行号的值编辑器实例
 * （CodeMirror，language=text|json），不以 type/字号重建（撤销栈/滚动保留）。
 * str 原样存取不解析；json 校验非法标红禁存，Worker 格式化/压缩带会话防护：
 * 类型切换/关闭/原稿变化后迟到结果不落地（abort + 代次双重校验）。
 * 反馈区固定 48px 占位：忙碌/错误文案增删不改变居中弹窗几何布局。
 */
function EntryModal({ init, defaultNs, onClose, onSaved, say }) {
  const isEdit = init.mode === 'edit'
  const ns = isEdit ? init.entry.namespace : defaultNs
  const [key, setKey] = useState(isEdit ? init.entry.key : '')
  const [type, setType] = useState(isEdit ? (init.entry.type || 'str') : 'str')
  const [data, setData] = useState(() => {
    if (!isEdit || init.entry.data === undefined) return ''
    return valueText(init.entry, true)
  })
  const [revision, setRevision] = useState(init.entry?.updated_at)
  const [jsonErr, setJsonErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [fontSize, setFontSize] = useState(() => loadFontSize())
  // 编辑必须取得值与版本，读取失败不能变成一次无条件覆盖。
  const needsFetch = isEdit && (init.entry.data === undefined || !init.entry.updated_at)
  const [fetching, setFetching] = useState(needsFetch)
  const [formatting, setFormatting] = useState(false)
  const validation = useJsonValue(data, type === 'json')
  const latestData = useRef(data)
  useEffect(() => { latestData.current = data }, [data])
  // 格式化代次 + 中止：类型切换/弹窗关闭后，在途 Worker 结果不得应用
  const formatSession = useRef(0)
  const formatAbort = useRef(null)
  useEffect(() => () => { formatSession.current++; formatAbort.current?.abort() }, [])

  function changeFontSize(next) {
    const value = clampFontSize(next)
    setFontSize(value)
    saveFontSize(value)   // 存储被禁用时静默失败，本次会话仍生效
  }

  useEffect(() => {
    if (!needsFetch) return
    let alive = true
    confGetEntry(init.entry.namespace, init.entry.key)
      .then(d => {
        if (!alive) return
        setRevision(d.updated_at)
        setType(d.type || 'str')
        setData(valueText(d, true))
      })
      .catch(e => { if (alive) say(`读取失败：${e.message}`, 'error') })
      .finally(() => { if (alive) setFetching(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** json 失焦校验：非法 → 标红 + 禁存（保存前 canSave 兜底再校一次） */
  function checkJson() {
    if (type !== 'json') return
    setJsonErr(validation.error)
  }

  /** 切换类型：json→str 时作废在途格式化（迟到结果不能写进 str 文本） */
  function switchType(t) {
    if (t === type) return
    if (type === 'json' && t === 'str') {
      formatSession.current++
      formatAbort.current?.abort()
      setFormatting(false)
    }
    setType(t)
    setJsonErr(null)
  }

  /** 格式化 / 压缩（devtoolbox JsonFormatTool 同款语义；非法时提示不改动）。
   *  完成/失败仅在「代次 + 原稿 + 类型」都未变时应用——编辑器视口由
   *  CodeEditor 的 keepViewportOnExternalChange 在整文替换前后保持。 */
  async function reformat(minify) {
    if (type !== 'json' || formatting) return
    const source = data
    const session = ++formatSession.current
    const controller = new AbortController()
    formatAbort.current?.abort()
    formatAbort.current = controller
    setFormatting(true)
    try {
      const formatted = await validation.format(source, minify, controller.signal)
      if (formatSession.current !== session || latestData.current !== source) return
      setData(formatted)
      setJsonErr(null)
    } catch (error) {
      if (formatSession.current !== session || latestData.current !== source) return
      if (!controller.signal.aborted) setJsonErr(error.message)
    } finally {
      if (formatSession.current === session) setFormatting(false)
    }
  }

  const nsOk = ns.length <= 100 && NAME_RE.test(ns)
  const keyOk = key.length <= 200 && NAME_RE.test(key)
  const canSave = !busy && !fetching && !formatting && (!isEdit || !!revision) && nsOk && keyOk && validation.valid
  const visibleJsonErr = jsonErr || validation.error

  async function onSave() {
    if (!canSave) return
    setBusy(true)
    try {
      if (isEdit) {
        await confRenameEntry(ns, init.entry.key, key, { type, data, if_updated_at: revision })
      } else {
        await confPutEntry(ns, key, { type, data, if_absent: true })
      }
      if (isEdit && key !== init.entry.key) say(`已重命名并更新 ${ns}/${key}`)
      else say(isEdit ? `已更新 ${ns}/${key}` : `已创建 ${ns}/${key}`)
      onSaved()
      onClose()
    } catch (e) {
      say(`保存失败：${e.message}`, 'error')
    } finally { setBusy(false) }
  }

  return (
    <Mask onClose={onClose} xwide>
      <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
        {isEdit ? '编辑 KV' : '新建 KV'}
      </h3>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div>
          <label htmlFor="conf-entry-namespace" className={`${LBL} block mb-1.5`}>所属 namespace</label>
          <input id="conf-entry-namespace" className={`${inputCls} w-full font-mono text-stone-500 dark:text-stone-400`}
            value={ns} readOnly />
          {ns && !nsOk && (
            <div className="mt-1 text-sm text-red-600 dark:text-red-400">仅允许字母数字 _ . : -（≤100 字符）</div>
          )}
        </div>
        <div>
          <label htmlFor="conf-entry-key" className={`${LBL} block mb-1.5`}>key</label>
          <input id="conf-entry-key" className={`${inputCls} w-full font-mono`}
            value={key} placeholder="如 feature_flags" autoComplete="off"
            onChange={e => setKey(e.target.value)} />
          {key && !keyOk && (
            <div className="mt-1 text-sm text-red-600 dark:text-red-400">仅允许字母数字 _ . : -（≤200 字符）</div>
          )}
        </div>
      </div>
      {isEdit && (
        <p className="mt-1.5 text-[13px] text-stone-400 dark:text-stone-500">
          namespace 不可改；修改 key 即重命名（值原样迁移，目标 key 已存在会拒绝保存）
        </p>
      )}

      <div className="mt-4">
        <label className={`${LBL} block mb-1.5`}>类型</label>
        <div className="flex gap-1 p-1 rounded-xl w-fit bg-black/[0.05] dark:bg-white/[0.06]">
          {['str', 'json'].map(t => (
            <button key={t} type="button"
              onClick={() => switchType(t)}
              className={'px-5 h-8 rounded-lg text-base font-mono font-medium transition-colors ' +
                (type === t
                  ? 'bg-cyan-600 text-white'
                  : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200')}>
              {t}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[13px] text-stone-400 dark:text-stone-500">
          {type === 'str' ? 'str —— 原样字符串，不做任何解析' : 'json —— 保存时须为合法 JSON 文本（对象 / 数组 / 数字…）'}
        </p>
      </div>

      <div className="mt-4">
        {/* h-6 固定标签行高：格式化/压缩按钮与字号工具的增删不引起弹窗高度跳变 */}
        <div className="flex h-6 items-center justify-between gap-3 mb-1.5">
          <label htmlFor="conf-entry-value" className={LBL}>值</label>
          <span className="flex items-center gap-2.5">
            {type === 'json' && (
              <span className="flex items-center gap-1.5">
                <button type="button" disabled={formatting} onClick={() => reformat(false)}
                  className="px-2 h-6 rounded-md text-[13px] text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors disabled:opacity-50">格式化</button>
                <button type="button" disabled={formatting} onClick={() => reformat(true)}
                  className="px-2 h-6 rounded-md text-[13px] text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors disabled:opacity-50">压缩</button>
              </span>
            )}
            <FontSizeControl fontSize={fontSize} onChange={changeFontSize} />
          </span>
        </div>
        {/* str 与 json 共用同一个带行号的编辑器实例（408px 固定外框）；
            切换类型只切 language，不重建编辑器（撤销栈/滚动保留），
            弹窗尺寸与字号变化无关 */}
        <JsonEditor id="conf-entry-value" value={data}
          onChange={value => { setData(value); setJsonErr(null) }}
          onBlur={checkJson} onSave={onSave}
          language={type === 'json' ? 'json' : 'text'}
          ariaLabel={type === 'json' ? 'JSON 值编辑器' : 'str 值编辑器'}
          rows={16} fontSize={fontSize} invalid={!!visibleJsonErr} />
        {/* 固定 48px 反馈区（aria-live）：忙碌/错误文案出现或消失不改变布局；
            长错误内部滚动且可被辅助技术读到 */}
        <div aria-live="polite" className="mt-1 h-12 overflow-y-auto text-sm">
          {visibleJsonErr
            ? <span role="alert" className="text-red-600 dark:text-red-400">{visibleJsonErr}——修正后再保存</span>
            : (validation.pending || formatting)
              ? <span className="text-stone-500 dark:text-stone-400">{formatting ? '正在格式化…' : '正在校验 JSON…'}</span>
              : null}
        </div>
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

/** 可排序表头：button 触发（Enter/Space 原生可用）；活动列显示方向并置 th aria-sort；
 *  非活动列显示极淡双向箭头暗示可排序。aria-label 提示**实际下一动作**：
 *  非活动列点按从升序开始；活动列 asc→降序、desc→升序 */
function SortHeader({ label, field, sortBy, sortOrder, onSort, thCls }) {
  const active = sortBy === field
  const nextAction = active ? (sortOrder === 'asc' ? '降序' : '升序') : '升序'
  return (
    <th scope="col" className={thCls}
      aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(field)}
        aria-label={`${label}，按${label}${nextAction}排列`}
        className={'inline-flex items-center gap-1 hover:text-stone-800 dark:hover:text-stone-100 transition-colors ' +
          (active ? 'text-stone-800 dark:text-stone-100 font-medium' : '')}>
        {label}
        {active ? (
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            {sortOrder === 'asc'
              ? <path d="M6 9V3m0 0L3 6m3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
              : <path d="M6 3v6m0 0 3-3m-3 3L3 6" strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
        ) : (
          <svg className="w-3 h-3 opacity-25" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M6 2v8M3.5 4.5 6 2l2.5 2.5M3.5 7.5 6 10l2.5-2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </th>
  )
}

const VIEW_TABS = [
  { key: 'entries', label: '配置管理' },
  { key: 'ratelimit', label: '限流配置' },
]

export default function ConfCenterPage() {
  const [params, setParams] = useSearchParams()
  // 缺省/非法 view 回 entries；entries 为默认视图（URL 不带 view）
  const view = params.get('view') === 'ratelimit' ? 'ratelimit' : 'entries'
  const requestedNs = params.get('namespace') || ''
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState('key')        // key|type|data|updated_at
  const [sortOrder, setSortOrder] = useState('asc')  // asc|desc；namespace 切换保留排序
  const [namespaces, setNamespaces] = useState(null)
  const [nsError, setNsError] = useState('')
  const [cache, setCache] = useState(null)
  const [list, setList] = useState(null)
  const [listVersion, setListVersion] = useState(0)
  const [editing, setEditing] = useState(null)
  const [namespaceOpen, setNamespaceOpen] = useState(false)
  const [cacheOpen, setCacheOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [delTarget, setDelTarget] = useState(null)
  const delTimer = useRef(null)
  const toastTimer = useRef(null)
  const namespaceRequest = useRef(0)
  const ns = namespaces?.some(n => n.namespace === requestedNs) ? requestedNs : (namespaces?.[0]?.namespace || '')
  const currentNamespace = namespaces?.find(n => n.namespace === ns)
  // 请求身份 = namespace + q + page + 排序 + listVersion：过时成功/错误都不覆盖新状态
  const visibleList = list?.namespace === ns && list?.query === q && list?.requestedPage === page
    && list?.version === listVersion && list?.sortBy === sortBy && list?.sortOrder === sortOrder ? list : null

  const say = useCallback((msg, kind) => {
    setToast({ msg, kind })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2400)
  }, [])

  const loadNamespaces = useCallback(async () => {
    const requestId = ++namespaceRequest.current
    try {
      const rows = normNamespaces(await confNamespaces())
      if (requestId === namespaceRequest.current) { setNamespaces(rows); setNsError('') }
    } catch (e) { if (requestId === namespaceRequest.current) setNsError(e.message) }
  }, [])
  const loadCache = useCallback(async () => {
    try { setCache(await confCacheStatus()) }
    catch (e) { say(`缓存状态加载失败：${e.message}`, 'error') }
  }, [say])
  useEffect(() => {
    let alive = true
    const requestId = ++namespaceRequest.current
    confNamespaces().then(rows => { if (alive && requestId === namespaceRequest.current) { setNamespaces(normNamespaces(rows)); setNsError('') } })
      .catch(e => { if (alive && requestId === namespaceRequest.current) setNsError(e.message) })
    confCacheStatus().then(status => { if (alive) setCache(status) })
      .catch(e => { if (alive) say(`缓存状态加载失败：${e.message}`, 'error') })
    return () => { alive = false }
  }, [say])

  useEffect(() => {
    if (!ns) return
    let alive = true
    confEntries({ namespace: ns, q, page, sortBy, sortOrder }).then(raw => {
      if (!alive) return
      const d = normEntries(raw)
      const pages = Math.max(1, Math.ceil(d.total / Math.max(1, d.page_size)))
      if (page > pages) { setPage(pages); return }
      setList({ ...d, namespace: ns, query: q, requestedPage: page, version: listVersion, sortBy, sortOrder, pages })
    }).catch(e => {
      if (alive) setList({ rows: [], total: 0, page, pages: 1, namespace: ns, query: q, requestedPage: page, version: listVersion, sortBy, sortOrder, error: e.message })
    })
    return () => { alive = false }
  }, [ns, q, page, sortBy, sortOrder, listVersion])
  function refreshEntries() { setListVersion(v => v + 1) }
  /** 点当前列切升/降；点其他列从升序开始；变更排序回第 1 页 */
  function onSort(field) {
    if (field === sortBy) {
      if (sortOrder === 'asc') setSortOrder('desc')
      else setSortOrder('asc')
    } else {
      setSortBy(field)
      setSortOrder('asc')
    }
    setPage(1)
  }
  useEffect(() => {
    const timer = setTimeout(() => { setQ(qInput.trim()); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [qInput])
  useEffect(() => () => { clearTimeout(delTimer.current); clearTimeout(toastTimer.current) }, [])

  function disarmDel() {
    clearTimeout(delTimer.current)
    setDelTarget(null)
  }
  function selectNamespace(namespace) {
    setParams(p => { const next = new URLSearchParams(p); next.set('namespace', namespace); return next })
    setQInput(''); setQ(''); setPage(1); setEditing(null); disarmDel()
  }
  function switchView(key) {
    setParams(p => {
      const next = new URLSearchParams(p)
      if (key === 'entries') next.delete('view')
      else next.set('view', key)
      return next
    })
  }
  function onNamespaceCreated(created) {
    setNamespaces(prev => [...(prev || []).filter(n => n.namespace !== created.namespace), created].sort((a, b) => a.namespace.localeCompare(b.namespace)))
    selectNamespace(created.namespace)
    loadNamespaces()
    say(`已创建空间 ${created.namespace}`)
  }
  function onEntrySaved() {
    if (page === 1) refreshEntries()
    else setPage(1)
    loadNamespaces()
  }
  function armDel(id) {
    clearTimeout(delTimer.current)
    setDelTarget(id)
    delTimer.current = setTimeout(() => setDelTarget(null), 3500)
  }
  async function onDel(namespace, key, updatedAt) {
    disarmDel()
    try {
      const revision = updatedAt || (await confGetEntry(namespace, key)).updated_at
      if (!revision) throw new Error('未取得配置版本，请刷新后重试')
      await confDeleteEntry(namespace, key, revision)
      say(`已删除 ${namespace}/${key}`)
      if (visibleList?.rows.length === 1 && page > 1) setPage(page - 1)
      else refreshEntries()
      loadNamespaces()
    } catch (e) { say(`删除失败：${e.message}`, 'error') }
  }

  const thBase = 'py-2 font-normal'

  return (
    <div className="min-h-0 bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 transition-colors [&_h1]:text-lg">
      <PageHeader title="配置中心" subtitle="namespace · KV 配置 · Redis 缓存 · 限流"
        tabs={VIEW_TABS} activeTab={view} onTabChange={switchView} />
      {/* 两个视图都保持挂载：切换侧栏菜单保留未保存的限流草稿与列表状态 */}
      <div hidden={view !== 'entries'}>
        <CacheBar cache={cache} onOpen={() => setCacheOpen(true)} />
        <div className="mt-4 flex items-start gap-4">
          <aside aria-label="Namespaces" className={`${card} w-52 shrink-0 p-2 sticky top-8`}>
            <div className="px-2 py-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-stone-500 dark:text-stone-400">Namespaces</h2>
              <span className="text-[13px] tabular-nums text-stone-400 dark:text-stone-500">{namespaces?.length ?? '…'}</span>
            </div>
            <button type="button" className={`${btn} w-full mb-2`} onClick={() => setNamespaceOpen(true)}>＋ 新建 namespace</button>
            <nav aria-label="namespace 列表" className="space-y-0.5 max-h-[calc(100vh-300px)] overflow-y-auto">
              {namespaces == null && !nsError && <p className="px-2 py-3 text-sm text-stone-400 dark:text-stone-500">加载中…</p>}
              {nsError && <div className="px-2 py-3 text-sm text-red-600 dark:text-red-400"><p>空间加载失败</p><button type="button" onClick={loadNamespaces} className="mt-2 underline">重试</button></div>}
              {namespaces?.length === 0 && <p className="px-2 py-3 text-sm text-stone-400 dark:text-stone-500">还没有 namespace</p>}
              {(namespaces || []).map(n => (
                <button key={n.namespace} type="button" onClick={() => selectNamespace(n.namespace)} aria-pressed={ns === n.namespace}
                  className={'w-full flex items-center justify-between gap-2 px-2.5 h-9 rounded-lg text-base transition-colors ' +
                    (ns === n.namespace ? 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 font-medium' : 'text-stone-600 dark:text-stone-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]')}>
                  <span className="min-w-0 truncate font-mono text-[15px]" title={n.namespace}>{n.namespace}</span>
                  <span className="text-sm text-stone-400 dark:text-stone-500 tabular-nums shrink-0">{n.count}</span>
                </button>
              ))}
            </nav>
          </aside>
          <section aria-label={ns ? `空间 ${ns}` : '空间概览'} className="flex-1 min-w-0">
            {!ns ? (
              <div className={`${card} min-h-[360px] flex flex-col items-center justify-center gap-3 p-8 text-center`}>
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z" strokeLinejoin="round" /></svg>
                </div>
                <h2 className="text-lg font-semibold">{nsError ? '暂时无法加载空间' : namespaces == null ? '正在加载 namespace…' : '先创建一个 namespace'}</h2>
                <p className="text-base text-stone-500 dark:text-stone-400">按应用或环境组织空间，在选中的空间内管理 KV。</p>
                {namespaces != null && !nsError && <button type="button" className={btnPri} onClick={() => setNamespaceOpen(true)}>创建 namespace</button>}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4 min-w-0">
                  <h2 className="font-mono text-xl font-semibold break-all">{ns}</h2>
                  <span className="shrink-0 text-sm text-stone-400 dark:text-stone-500">{currentNamespace?.count ?? 0} 条配置</span>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <input value={qInput} onChange={e => setQInput(e.target.value)} aria-label="搜索 key" placeholder="搜索当前空间的 key…" className={`${inputCls} w-60`} />
                  <button type="button" className={`${btnPri} ml-auto shrink-0`} onClick={() => setEditing({ mode: 'new' })}>＋ 新建 KV</button>
                </div>
                <div className={`${card} overflow-x-auto`}>
                  <table className="w-full min-w-[740px] table-fixed text-base">
                    <colgroup>
                      <col className="w-[20%]" /><col className="w-[76px]" /><col /><col className="w-[176px]" /><col className="w-[160px]" />
                    </colgroup>
                    <thead><tr className="text-left text-sm text-stone-500 dark:text-stone-400 border-b border-black/[0.06] dark:border-white/[0.06]">
                      <SortHeader label="key" field="key" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} thCls={`${thBase} pl-4 pr-2`} />
                      <SortHeader label="类型" field="type" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} thCls={`${thBase} px-2`} />
                      <SortHeader label="值预览" field="data" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} thCls={`${thBase} px-2`} />
                      <SortHeader label="更新时间" field="updated_at" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} thCls={`${thBase} px-2`} />
                      {/* 操作列没有业务数据，不参与排序 */}
                      <th scope="col" className={`${thBase} pl-2 pr-4 text-right`}>操作</th>
                    </tr></thead>
                    <tbody>
                      {visibleList == null && <tr><td colSpan={5} className="py-12 text-center text-sm text-stone-400 dark:text-stone-500">加载中…</td></tr>}
                      {visibleList?.error && <tr><td colSpan={5} className="py-12 text-center text-sm text-red-600 dark:text-red-400">加载失败：{visibleList.error}<button type="button" onClick={() => refreshEntries()} className="ml-3 underline">重试</button></td></tr>}
                      {visibleList && !visibleList.error && !visibleList.rows.length && <tr><td colSpan={5} className="py-14 text-center">
                        <p className="text-base text-stone-500 dark:text-stone-400">{q ? `没有匹配“${q}”的 key` : '这个空间还没有 KV'}</p>
                        {!q && <button type="button" onClick={() => setEditing({ mode: 'new' })} className="mt-3 text-sm font-medium text-cyan-600 dark:text-cyan-400 hover:underline">添加第一条 KV</button>}
                      </td></tr>}
                      {visibleList?.rows.map(e => {
                        const id = `${e.namespace}\u0000${e.key}`
                        return <tr key={id} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-black/[0.015] dark:hover:bg-white/[0.02] transition-colors">
                          <td className="pl-4 pr-2 py-2.5 font-mono text-[15px] text-stone-800 dark:text-stone-100"><span className="block truncate" title={e.key}>{e.key}</span></td>
                          <td className="px-2 py-2.5 whitespace-nowrap"><TypeBadge type={e.type} /></td>
                          <td className="px-2 py-2.5"><ValuePreview entry={e} onEdit={() => setEditing({ mode: 'edit', entry: e })} /></td>
                          <td className="px-2 py-2.5 whitespace-nowrap text-sm text-stone-500 dark:text-stone-400">{fmtTime(e.updated_at)}</td>
                          <td className="pl-2 pr-4 py-2.5 text-right whitespace-nowrap">
                            {delTarget === id ? <span className="inline-flex items-center gap-1.5">
                              <button type="button" onClick={() => onDel(e.namespace, e.key, e.updated_at)} className="px-2 h-7 rounded-md text-sm bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors">确认删除</button>
                              <button type="button" onClick={disarmDel} className="px-2 h-7 rounded-md text-sm text-stone-400 dark:text-stone-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">取消</button>
                            </span> : <span className="inline-flex items-center gap-1.5">
                              <button type="button" onClick={() => setEditing({ mode: 'edit', entry: e })} className="px-2.5 h-7 rounded-md text-sm text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">编辑</button>
                              <button type="button" onClick={() => armDel(id)} className="px-2.5 h-7 rounded-md text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors">删除</button>
                            </span>}
                          </td>
                        </tr>
                      })}
                    </tbody>
                  </table>
                </div>
                {visibleList && visibleList.pages > 1 && <div className="flex items-center justify-between mt-3 text-sm text-stone-500 dark:text-stone-400">
                  <span>共 {visibleList.total} 条</span><div className="flex items-center gap-2">
                    <button type="button" disabled={visibleList.page <= 1} onClick={() => setPage(visibleList.page - 1)} className={btn}>‹ 上一页</button>
                    <span className="tabular-nums">{visibleList.page} / {visibleList.pages}</span>
                    <button type="button" disabled={visibleList.page >= visibleList.pages} onClick={() => setPage(visibleList.page + 1)} className={btn}>下一页 ›</button>
                  </div>
                </div>}
              </>
            )}
          </section>
        </div>
      </div>
      <div hidden={view !== 'ratelimit'}>
        <RateLimitPage namespaces={namespaces} say={say} />
      </div>
      {namespaceOpen && <NamespaceModal onClose={() => setNamespaceOpen(false)} onCreated={onNamespaceCreated} />}
      {editing && ns && <EntryModal init={editing} defaultNs={ns} onClose={() => setEditing(null)} onSaved={onEntrySaved} say={say} />}
      {cacheOpen && <CacheModal status={cache} onClose={() => setCacheOpen(false)} onSaved={loadCache} say={say} />}
      <Toast t={toast} />
    </div>
  )
}
