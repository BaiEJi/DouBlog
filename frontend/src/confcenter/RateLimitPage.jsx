/**
 * 限流配置独立主视图（原 KV 页顶部状态条 + 配置 Modal 迁移为页面）。
 *
 * - 状态卡：mode 三态（redis 滑动窗口 / 本地降级 / 未启用）+ 当前默认规则（只读展示）
 *   + 放行/拒绝计数 + 主动刷新
 * - 配置表单：启用开关、按 namespace 覆盖行（limit=0 豁免；**namespace 用统一下拉选择**
 *   已有空间，非文本输入——2026-10-24 用户指令）。**默认额度/窗口不在页面编辑**
 *   （2026-10-24 用户指令）——保存 payload 省略这两个字段，后端部分缺省沿用已存默认值
 *   · 配置 GET 失败 → 禁存 + 错误/重试（不标记已加载，不放开默认值提交）
 *   · 配置 GET 成功而 status GET 失败 → 允许编辑，状态卡显示失败 + 重试
 * - 保存/回读不覆盖在途新草稿（R2）：保存提交→回读完成期间禁用表单；手动
 *   回读（重试）用编辑代次围栏——用户在 GET 在途改过表单则只更新已保存快照
 * - overrides 构造走 overrides.js 纯函数（__proto__ 等合法名不丢，R4）
 * - 重置计数卡已按用户要求移除（2026-10-24）；reset API 保留在 api.js 供需要时使用
 * - 校验与后端一致：覆盖行 limit=0–1000000、window=1–86400、下拉已保证 namespace
 *   合法；未选（空）或与已有行重复禁存
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { confRatelimitStatus, confRatelimitConfig, confRatelimitSave } from './api'
import { buildOverrides, parseOverrides } from './overrides'
import Select from './Select'

const card = 'rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]'
const btn = 'px-4 py-2 text-base font-medium rounded-lg bg-black/[0.06] dark:bg-white/[0.08] text-stone-700 dark:text-stone-200 hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50'
const btnPri = 'px-4 py-2 text-base font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-50'
const LBL = 'text-sm text-stone-500 dark:text-stone-400'
const NAME_RE = /^[A-Za-z0-9_.:-]+$/

/** 空串/空白不是 0：Number('') === 0 的坑必须显式挡掉 */
const numOk = (v, lo, hi) => String(v).trim() !== '' && Number.isInteger(Number(v))
  && Number(v) >= lo && Number(v) <= hi

export default function RateLimitPage({ namespaces, say }) {
  // ── 状态卡 ──
  const [status, setStatus] = useState(null)        // null=加载中
  const [statusError, setStatusError] = useState('')
  const [statusBusy, setStatusBusy] = useState(false)
  const statusGen = useRef(0)                       // 并发刷新围栏：只应用最新一次

  // ── 配置表单 ──
  // 默认额度/窗口不在页面编辑（用户指令 2026-10-24）——保存时省略字段，后端沿用已存默认值；
  // 状态卡仍只读展示服务器当前默认规则
  const [cfg, setCfg] = useState({ enabled: false })
  const [rows, setRows] = useState([])              // 覆盖行 [{ns, limit, window}]
  const [configState, setConfigState] = useState('loading')  // loading | ready | error
  const [configError, setConfigError] = useState('')
  const [savedSnapshot, setSavedSnapshot] = useState(null)   // 已保存快照（恢复用）
  const [busy, setBusy] = useState(false)           // 保存提交→回读完成期间禁表单
  const [msg, setMsg] = useState(null)              // {tone:'ok'|'err', text}
  const editGen = useRef(0)                         // 编辑代次：手动回读只在不覆盖新草稿时应用
  const configGen = useRef(0)                       // 并发 loadConfig 围栏

  const loadStatus = useCallback(async () => {
    const gen = ++statusGen.current
    setStatusBusy(true); setStatusError('')
    try {
      const data = await confRatelimitStatus()
      if (gen !== statusGen.current) return         // 过时响应不发布
      setStatus(data)
    } catch (e) {
      if (gen !== statusGen.current) return
      setStatusError(e.message)
    } finally {
      if (gen === statusGen.current) setStatusBusy(false)
    }
  }, [])

  const loadConfig = useCallback(async ({ silent = false } = {}) => {
    const gen = ++configGen.current
    const edits = editGen.current                   // 本次回读开始时的编辑代次
    if (!silent) { setConfigState('loading'); setConfigError('') }
    try {
      const d = await confRatelimitConfig()
      if (gen !== configGen.current) return false   // 过时回读不发布
      const server = { enabled: !!d.enabled, rows: parseOverrides(d.overrides) }
      setSavedSnapshot(server)
      // R2：回读在途用户改过表单 → 只更新已保存快照，不动草稿
      if (editGen.current !== edits) return true
      setCfg({ enabled: server.enabled })
      setRows(server.rows.map(r => ({ ...r })))
      setConfigState('ready')
      return true
    } catch (e) {
      if (gen !== configGen.current) return false
      if (!silent) {                                // 静默回读失败不打断已就绪表单
        setConfigError(e.message)
        setConfigState('error')
      }
      return false
    }
  }, [])

  useEffect(() => { loadConfig(); loadStatus() }, [loadConfig, loadStatus])

  /** 任何草稿编辑都推进代次（回读应用围栏用） */
  const touchDraft = () => { editGen.current++ }

  const nsOk = ns => ns.length > 0 && ns.length <= 100 && NAME_RE.test(ns)
  const rowsValid = rows.every(r => nsOk(r.ns.trim())
    && numOk(r.limit, 0, 1000000) && numOk(r.window, 1, 86400)
    && rows.filter(x => x.ns.trim() === r.ns.trim()).length === 1)
  const canSave = !busy && configState === 'ready' && rowsValid

  async function onSave() {
    if (!canSave) return
    setBusy(true); setMsg(null)                     // 提交→回读完成期间禁表单（R2）
    let putOk = false
    try {
      // 默认额度/窗口不传——后端部分缺省沿用已存默认值（页面不再编辑默认规则）
      await confRatelimitSave({ enabled: !!cfg.enabled, overrides: buildOverrides(rows) })
      putOk = true
      // 编辑已被禁用：代次不变，回读可直接应用并重建快照
      const reloadOk = await loadConfig()
      if (reloadOk) { say('限流配置已保存'); setMsg({ tone: 'ok', text: '限流配置已保存' }) }
      else throw new Error('回读配置失败')
    } catch (e) {
      // PUT 失败 与 保存成功但回读失败 分开提示；两者草稿都保留
      if (putOk) {
        setMsg({ tone: 'err', text: `已保存，但回读配置失败：${e.message}——草稿已保留，可重试加载` })
        say('已保存，但回读配置失败', 'error')
      } else {
        setMsg({ tone: 'err', text: `保存失败：${e.message}` })
      }
    } finally { setBusy(false) }
  }

  function restoreSaved() {
    if (!savedSnapshot) return
    touchDraft()
    setCfg({ enabled: savedSnapshot.enabled })
    setRows(savedSnapshot.rows.map(r => ({ ...r })))
    setMsg(null)
  }

  const setRow = (i, patch) => { touchDraft(); setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r)) }
  const numField = 'w-24 h-8 px-2 rounded-lg text-sm tabular-nums bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-stone-800 dark:text-stone-100 outline-none focus:border-black/30 dark:focus:border-white/30'
  const formDisabled = busy                         // 保存提交→回读完成期间禁用（R2）

  // 状态卡三态文案
  let dot = 'bg-stone-400 dark:bg-stone-500', modeLabel = '未启用', note = ''
  if (status?.mode === 'redis') { dot = 'bg-emerald-500'; modeLabel = 'Redis 滑动窗口' }
  else if (status?.mode === 'local') { dot = 'bg-amber-500'; modeLabel = '本地窗口'; note = '（Redis 不可用，已降级）' }

  return (
    <div className="max-w-4xl space-y-4">
      {/* 状态卡 */}
      <section aria-label="限流状态" className={`${card} p-5`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">限流状态</h2>
          <button type="button" onClick={loadStatus} disabled={statusBusy}
            className="ml-auto px-3 h-8 rounded-lg text-sm font-medium text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50">
            {statusBusy ? '刷新中…' : '刷新状态'}
          </button>
        </div>
        {statusError ? (
          <div className="mt-3 text-sm text-red-600 dark:text-red-400">
            状态加载失败：{statusError}
            <button type="button" onClick={loadStatus} disabled={statusBusy} className="ml-3 underline">重试</button>
          </div>
        ) : status == null ? (
          <p className="mt-3 text-sm text-stone-400 dark:text-stone-500">加载中…</p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${dot}`} />
              <span className="font-medium text-stone-700 dark:text-stone-200">{modeLabel}<span className="font-normal text-stone-400 dark:text-stone-500">{note}</span></span>
            </span>
            {status.enabled && (
              <span className="text-stone-500 dark:text-stone-400 tabular-nums whitespace-nowrap">
                默认 {status.limit} 次 / {status.window_seconds}s
                {Object.keys(status.overrides || {}).length > 0 && ` · ${Object.keys(status.overrides).length} 个覆盖`}
              </span>
            )}
            {status.enabled && (
              <span className="text-stone-500 dark:text-stone-400 tabular-nums whitespace-nowrap">
                放行 {status.allowed ?? 0} / 拒绝 {status.rejected ?? 0}
              </span>
            )}
            {status.tracked && Object.keys(status.tracked).length > 0 && (
              <span className="text-stone-500 dark:text-stone-400 tabular-nums">
                窗口计数：{Object.entries(status.tracked).map(([ns, n]) => `${ns}=${n}`).join(' · ')}
              </span>
            )}
          </div>
        )}
        <p className="mt-3 text-[13px] text-stone-400 dark:text-stone-500">
          按 namespace 计数限流单条 KV 读写（GET/PUT/DELETE）；优先 Redis 滑动窗口（lizysdk），
          Redis 不可用时自动降级为本地窗口；浏览与缓存/限流管理端点不限流。
        </p>
      </section>

      {/* 配置表单 */}
      <section aria-label="限流配置" className={`${card} p-5`}>
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">限流配置</h2>
        {configState === 'loading' && <p className="mt-3 text-sm text-stone-400 dark:text-stone-500">配置加载中…</p>}
        {configState === 'error' && (
          <div role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
            配置加载失败：{configError}——已禁用保存以防默认值覆盖真实配置。
            <button type="button" onClick={() => loadConfig()} className="ml-3 underline">重试</button>
          </div>
        )}
        {configState !== 'error' && (<>          <label className="flex items-center gap-2 mt-4 text-base cursor-pointer select-none">
            <input type="checkbox" className="accent-cyan-600 [color-scheme:light] dark:[color-scheme:dark] w-4 h-4" checked={cfg.enabled}
              disabled={formDisabled}
              onChange={e => { touchDraft(); setCfg({ ...cfg, enabled: e.target.checked }) }} />
            <span className="text-stone-700 dark:text-stone-200">启用限流</span>
          </label>

          <div className="mt-5">
            <div className="flex items-center justify-between mb-1.5">
              <label className={LBL}>按空间覆盖（limit=0 表示豁免不限流）</label>
              <button type="button" disabled={formDisabled}
                className="px-2 h-7 rounded-md text-[13px] font-medium text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/10 transition-colors disabled:opacity-50"
                onClick={() => { touchDraft(); setRows(rs => [...rs, { ns: '', limit: 10, window: 60 }]) }}>＋ 添加覆盖</button>
            </div>
            {rows.length === 0 && (
              <p className="text-sm text-stone-400 dark:text-stone-500">没有覆盖行——所有空间使用默认额度。</p>
            )}
            {rows.length > 0 && (
              <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.08] divide-y divide-black/[0.05] dark:divide-white/[0.06]">
                {rows.map((r, i) => {
                  const dup = rows.filter(x => x.ns.trim() === r.ns.trim()).length > 1
                  const bad = configState === 'ready' && (!nsOk(r.ns.trim())
                    || !numOk(r.limit, 0, 1000000) || !numOk(r.window, 1, 86400) || dup)
                  return (
                    <div key={i} className="flex items-center gap-2 px-2.5 py-2">
                      <div className="flex-1 min-w-0">
                        <Select value={r.ns} invalid={bad} disabled={formDisabled} size="form"
                          ariaLabel={`覆盖 namespace ${i + 1}`}
                          placeholder="选择 namespace…"
                          onChange={v => setRow(i, { ns: String(v) })}
                          options={(namespaces || []).map(n => ({ value: n.namespace, label: n.namespace }))} />
                      </div>
                      <input type="number" min="0" max="1000000" value={r.limit} aria-label="覆盖额度" className={numField}
                        disabled={formDisabled}
                        onChange={e => setRow(i, { limit: e.target.value })} />
                      <span className="text-sm text-stone-400 dark:text-stone-500 shrink-0">次 /</span>
                      <input type="number" min="1" max="86400" value={r.window} aria-label="覆盖窗口秒数" className={numField}
                        disabled={formDisabled}
                        onChange={e => setRow(i, { window: e.target.value })} />
                      <span className="text-sm text-stone-400 dark:text-stone-500 shrink-0">s</span>
                      <button type="button" aria-label={`删除覆盖 ${r.ns || '(未命名)'}`} disabled={formDisabled}
                        onClick={() => { touchDraft(); setRows(rs => rs.filter((_, j) => j !== i)) }}
                        className="w-7 h-7 shrink-0 rounded-md text-stone-400 dark:text-stone-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50">×</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>)}

        {msg && (
          <div role="status" className={'mt-4 rounded-lg px-3 py-2 text-[15px] break-all ' +
            (msg.tone === 'ok'
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'bg-red-500/10 text-red-600 dark:text-red-400')}>
            {msg.text}
          </div>
        )}

        {configState !== 'error' && (
          <div className="flex justify-end gap-2.5 mt-5">
            {savedSnapshot && <button type="button" className={btn} disabled={formDisabled} onClick={restoreSaved}>恢复已保存值</button>}
            <button type="button" className={btnPri} disabled={!canSave} onClick={onSave}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
