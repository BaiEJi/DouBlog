/**
 * API Hub 页 /apihub：统一 API 调用平台（system → api 两维 / 平台令牌 sk- / 多级限流 / 一键探活）。
 *
 * 分类只有 系统-API 两个维度，参考配置中心（confcenter）的 namespace 模式组织页面：
 * API 不占侧栏一级入口，而是「点击进入系统」后管理该系统自己的 API——不同系统展示
 * 不同的 API 内容。选中系统经 URL ?system=<slug> 深链（对齐 confcenter 的 ?namespace=），
 * 刷新/分享不丢；slug 失效（过期书签/改名）自动回落列表。
 * 五个内部 Tab：总览（健康+统计+一键探活）、系统（列表 → 系统详情：系统信息 + 编辑 +
 * 该系统 API 的 CRUD/调用/文档/探活）、平台令牌（明文一次性）、限流规则（实时余量）、调用日志。
 * 鉴权（providers + 凭证值）明文内联在每个 API 的 auth_config 里，随请求/响应/探活配置
 * 一起在 API 表单编辑——无密钥池（2026-10-17 简化，见 backend __init__.py 迁移）。
 * 配置类字段（auth/请求/响应/探活）用 JSON 编辑，失焦校验。
 * 接口全部走 ./api（admin，Basic Auth）；网关调用（sk-）是给外部调用方的，不在本页。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../shared/PageHeader'
import md from '../shared/md'
import {
  apihubApiDoc, apihubApis, apihubCreateToken, apihubDeleteApi,
  apihubDeleteRule, apihubDeleteToken, apihubDeleteSystem,
  apihubInvokeApi, apihubLogs, apihubOverview, apihubProbeAll,
  apihubRules, apihubSaveApi, apihubSaveRule, apihubSaveSystem, apihubSystems,
  apihubToggleApi, apihubTokens, apihubUpdateToken,
} from './api'

const inputCls = 'px-3 py-2 text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-lg text-stone-800 dark:text-stone-100 placeholder:text-stone-400 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors'
const btn = 'px-4 py-2 text-sm font-medium rounded-lg bg-black/[0.06] dark:bg-white/[0.08] text-stone-700 dark:text-stone-200 hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50'
const btnPri = 'px-4 py-2 text-sm font-medium rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:opacity-50'
const card = 'rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]'
// 弹窗卡：暗色用实底深色（叠在遮罩上保持对比），与 subs/diary kit 的 Modal 一致
const modalCard = 'rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-[#1c1b1a]'
// 表格行操作按钮：小号实底钮（默认 stone / 主操作 amber / 文档 violet / 危险 red）
const rowBtn = 'inline-flex items-center h-7 px-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap'
const rowBtnDef = `${rowBtn} bg-black/[0.06] dark:bg-white/[0.08] text-stone-600 dark:text-stone-300 hover:bg-black/[0.10] dark:hover:bg-white/[0.14]`
const rowBtnPri = `${rowBtn} bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20`
const rowBtnViolet = `${rowBtn} bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20`
const rowBtnDanger = `${rowBtn} bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20`

const HEALTH_STYLE = {
  healthy: 'text-emerald-600 dark:text-emerald-400',
  suspect: 'text-amber-600 dark:text-amber-400',
  down: 'text-red-600 dark:text-red-400',
  unknown: 'text-stone-400',
}
const HEALTH_TEXT = { healthy: '健康', suspect: '疑似故障', down: '故障', unknown: '未知' }
// 侧栏一级入口只有五个：API 收敛进「系统」页（点系统进入看该系统的 API），参照配置中心
const TABS = [
  ['overview', '总览'], ['systems', '系统'],
  ['tokens', '平台令牌'], ['rules', '限流规则'], ['logs', '调用日志'],
]

function fmtTime(s) {
  if (!s) return '-'
  const d = new Date(s.endsWith('Z') ? s : s + 'Z')
  return isNaN(d) ? s : d.toLocaleString('zh-CN', { hour12: false })
}

/** JSON 编辑器：失焦解析，无效标红不改值 */
function JsonArea({ value, onChange, rows = 6, placeholder }) {
  const [text, setText] = useState(() => (value == null ? '' : JSON.stringify(value, null, 2)))
  const [err, setErr] = useState(null)
  const touched = useRef(false)
  useEffect(() => {
    if (!touched.current) setText(value == null ? '' : JSON.stringify(value, null, 2))
  }, [value])
  return (
    <div className="w-full">
      <textarea
        rows={rows} value={text} placeholder={placeholder}
        onChange={e => { touched.current = true; setText(e.target.value) }}
        onBlur={() => {
          touched.current = false
          if (!text.trim()) { onChange(null); setErr(null); return }
          try { onChange(JSON.parse(text)); setErr(null) }
          catch (e) { setErr(e.message) }
        }}
        className={`w-full px-3 py-2 font-mono text-xs bg-white dark:bg-white/[0.04] border rounded-lg text-stone-800 dark:text-stone-100 outline-none transition-colors ${err ? 'border-red-400 dark:border-red-500/60' : 'border-black/10 dark:border-white/10 focus:border-black/30 dark:focus:border-white/30'}`} />
      {err && <div className="mt-1 text-[11.5px] text-red-600 dark:text-red-400">JSON 无效: {err}</div>}
    </div>
  )
}

function Modal({ title, onClose, children, wide, xwide }) {
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-auto"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      {/* 面板不拦 mousedown 冒泡：遮罩仅 e.target===e.currentTarget 才关，点面板内不会误关；
          拦住会顺带掐断 Select 的「点外面收起」文档监听 */}
      <div className={`w-full ${xwide ? 'max-w-4xl' : wide ? 'max-w-2xl' : 'max-w-lg'} my-auto ${modalCard} p-5 shadow-2xl`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-stone-800 dark:text-stone-100">{title}</h3>
          <button onClick={onClose} className={`${btn} shrink-0 whitespace-nowrap`}>关闭</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Err({ e }) {
  if (!e) return null
  return <div className="mb-3 rounded-lg px-3 py-2 text-[13px] text-red-600 dark:text-red-400
    border border-red-500/20 bg-red-500/10">{e.message || String(e)}</div>
}

/** 统一下拉框：按钮 + 绝对定位菜单。
 *  原生 <select> 展开的选项列表在暗色下泛白刺眼（color-scheme 各浏览器支持不一），
 *  全模块改用它保持明暗一致；options: [{value, label}]。 */
function Select({ value, onChange, options, placeholder = '选择…', disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const cur = options.find(o => String(o.value) === String(value))
  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => setOpen(o => !o)}
        className={`${inputCls} w-full flex items-center justify-between gap-2 text-left disabled:opacity-50`}>
        <span className="truncate">{cur ? cur.label : placeholder}</span>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
             className={`w-3.5 h-3.5 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1c1b1a] py-1 shadow-xl">
          {options.map(o => (
            <button key={String(o.value)} type="button"
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                String(o.value) === String(value)
                  ? 'text-amber-600 dark:text-amber-400 font-medium bg-amber-500/[0.08]'
                  : 'text-stone-700 dark:text-stone-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.06]'}`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 主题切换图标（与 todo/practice 页同款按钮规格） */
export default function ApiHubPage() {
  // 带 ?system= 深链（分享/刷新/书签）直接落在系统 Tab——否则系统详情够不着
  const [tab, setTab] = useState(() =>
    (new URLSearchParams(window.location.search).has('system') ? 'systems' : 'overview'))
  const [err, setErr] = useState(null)
  return (
    <div className="min-h-0 font-mono bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 transition-colors">
      <PageHeader title="API Hub" subtitle="系统 · API · 平台令牌 · 四级限流 · 一键探活"

        tabs={TABS.map(([k, label]) => ({ key: k, label }))}
        activeTab={tab}
        onTabChange={k => { setTab(k); setErr(null) }} />
      <div className="p-0 max-w-full mx-auto">
        <Err e={err} />
        {tab === 'overview' && <Overview setErr={setErr} />}
        {tab === 'systems' && <Systems setErr={setErr} />}
        {tab === 'tokens' && <Tokens setErr={setErr} />}
        {tab === 'rules' && <Rules setErr={setErr} />}
        {tab === 'logs' && <Logs setErr={setErr} />}
      </div>
    </div>
  )
}

// ─── 总览 ───────────────────────────────────────────────────────────

function Overview({ setErr }) {
  const [stats, setStats] = useState(null)
  const [probing, setProbing] = useState(false)
  const load = useCallback(async () => {
    try { setStats(await apihubOverview()) } catch (e) { setErr(e) }
  }, [setErr])
  useEffect(() => { load() }, [load])

  const probeAll = async () => {
    setProbing(true)
    try {
      const results = await apihubProbeAll()
      const ok = results.filter(x => x.ok).length
      setErr(new Error(`探活完成：${ok}/${results.length} 个健康（详情见系统内 API 列表健康列）`))
      await load()
    } catch (e) { setErr(e) } finally { setProbing(false) }
  }

  if (!stats) return <div className="text-xs text-stone-400 py-16 text-center">加载中…</div>
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-5 gap-3">
        {[
          ['24h 调用量', stats.total_calls],
          ['24h 错误率', (stats.error_rate * 100).toFixed(1) + '%'],
          ['系统', stats.counts.systems],
          ['API', stats.counts.apis],
          ['平台令牌', stats.counts.tokens],
        ].map(([label, v]) => (
          <div key={label} className={`${card} p-4`}>
            <div className="text-[11.5px] text-stone-500 dark:text-stone-400">{label}</div>
            <div className="text-lg font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <div className={`${card} overflow-hidden`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/[0.06] dark:border-white/[0.06]">
          <span className="text-base font-semibold text-stone-700 dark:text-stone-200">
            API 健康与调用（近 24 小时）
          </span>
          <button className={btnPri} disabled={probing} onClick={probeAll}>
            {probing ? '探活中…' : '⚡ 一键探活'}
          </button>
        </div>
        <ApiTable rows={stats.per_api} empty="暂无调用数据：进入系统配置 API 后用平台令牌调用" />
      </div>
    </div>
  )
}

function ApiTable({ rows, empty }) {
  if (!rows?.length) return <div className="py-10 text-center text-xs text-stone-400">{empty}</div>
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-stone-500 dark:text-stone-400 border-b border-black/[0.06] dark:border-white/[0.06]">
          <th className="pl-4 pr-2 py-2 font-normal">健康</th><th className="px-2 py-2 font-normal">API</th>
          <th className="px-2 py-2 font-normal text-right">调用量</th><th className="px-2 py-2 font-normal text-right">错误率</th>
          <th className="pl-2 pr-4 py-2 font-normal text-right">平均延迟</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.api_id} className="border-b last:border-0 border-black/[0.06] dark:border-white/[0.06]">
            <td className={`px-4 py-2.5 font-medium ${HEALTH_STYLE[r.health] || ''}`}>
              ● {HEALTH_TEXT[r.health] || r.health}
            </td>
            <td className="px-2 py-2.5 text-stone-700 dark:text-stone-200">
              {r.name}（{r.slug}）{!r.enabled && <span className="ml-1 text-red-600 dark:text-red-400">已停用</span>}
            </td>
            <td className="px-2 py-2.5 text-right tabular-nums text-stone-600 dark:text-stone-300">{r.calls}</td>
            <td className="px-2 py-2.5 text-right tabular-nums text-stone-600 dark:text-stone-300">{(r.error_rate * 100).toFixed(1)}%</td>
            <td className="pl-2 pr-4 py-2.5 text-right tabular-nums text-stone-600 dark:text-stone-300">{r.avg_latency_ms} ms</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── 系统（列表 → 点击进入系统详情）─────────────────────────────────

function Systems({ setErr }) {
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState(null)
  const [editing, setEditing] = useState(null)   // {} 新建 | {...row} 编辑
  const load = useCallback(async () => {
    try { setRows(await apihubSystems()) } catch (e) { setErr(e) }
  }, [setErr])
  useEffect(() => { load() }, [load])

  // 选中系统走 URL ?system=<slug>（参照 confcenter ?namespace=）：可深链、刷新不丢。
  // slug 失效（过期书签/系统已删）→ 回落列表；深链首屏先出加载态，不闪列表。
  const slug = params.get('system') || ''
  const current = (rows || []).find(s => s.slug === slug) || null
  const select = s => setParams(p => {
    const next = new URLSearchParams(p)
    if (s) next.set('system', s)
    else next.delete('system')
    return next
  })
  // 保存后即时补丁（改名时 URL 与 rows 同一批更新，详情页不闪）；无补丁数据才整表重载
  const onSystemSaved = updated => {
    if (updated?.id != null) {
      setRows(prev => (prev || []).map(s => (s.id === updated.id ? { ...s, ...updated } : s)))
    } else load()
  }

  if (slug && !rows) return <div className="text-xs text-stone-400 py-16 text-center">加载中…</div>
  if (slug && current) {
    return (
      <SystemDetail system={current} setErr={setErr} onBack={() => { select(''); load() }}
                    onSelect={select} onSystemSaved={onSystemSaved} onApisChanged={load} />
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className={btnPri} onClick={() => setEditing({})}>＋ 新建系统</button>
      </div>
      <div className={`${card} overflow-x-auto`}>
        {/* 平铺：colgroup 百分比 + table-fixed，各列按占比撑满整宽，不留栏间空白 */}
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[24%]" /><col className="w-[38%]" /><col className="w-[8%]" />
            <col className="w-[10%]" /><col className="w-[20%]" />
          </colgroup>
          <thead>
            <tr className="text-left text-xs text-stone-500 dark:text-stone-400 border-b border-black/[0.06] dark:border-white/[0.06]">
              <th className="pl-4 pr-2 py-2 font-normal">名称 / Slug</th>
              <th className="px-2 py-2 font-normal">Base URL</th>
              <th className="px-2 py-2 font-normal">API</th>
              <th className="px-2 py-2 font-normal">状态</th>
              <th className="pl-2 pr-4 py-2 font-normal text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map(s => (
              <tr key={s.id} className="border-b last:border-0 border-black/[0.06] dark:border-white/[0.06]">
                <td className="pl-4 pr-2 py-2.5">
                  {/* 点名称进入该系统：管理它自己的 API（不同系统内容不同） */}
                  <button className="font-medium text-left text-stone-700 dark:text-stone-200 hover:text-amber-600 dark:hover:text-amber-400 hover:underline"
                          title="点击进入该系统，管理其 API" onClick={() => select(s.slug)}>
                    {s.name}
                  </button>
                  <div className="text-xs text-stone-400 font-mono">{s.slug}</div>
                </td>
                <td className="px-2 py-2.5 text-stone-600 dark:text-stone-300 truncate" title={s.base_url}>{s.base_url}</td>
                <td className="px-2 py-2.5">
                  <button className="tabular-nums text-stone-600 dark:text-stone-300 hover:text-amber-600 dark:hover:text-amber-400 hover:underline"
                          title="点击进入该系统，管理其 API" onClick={() => select(s.slug)}>
                    {s.api_count ?? 0}
                  </button>
                </td>
                <td className={`px-2 py-2.5 font-medium whitespace-nowrap ${s.status === 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                  {s.status === 1 ? '启用' : s.status === 2 ? '手动禁用' : '自动禁用'}
                </td>
                <td className="pl-2 pr-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                    <button className={rowBtnPri} onClick={() => select(s.slug)}>进入</button>
                    <button className={rowBtnDef} onClick={() => setEditing(s)}>编辑</button>
                    <button className={rowBtnDanger} onClick={async () => {
                      if (!confirm(`删除系统 ${s.slug}？（其下 API 需先删除）`)) return
                      try { await apihubDeleteSystem(s.id); load() } catch (e) { setErr(e) }
                    }}>删除</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={5} className="py-10 text-center text-stone-400">暂无系统</td></tr>}
          </tbody>
        </table>
      </div>
      {editing !== null && (
        <SystemForm row={editing} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load() }} setErr={setErr} />
      )}
    </div>
  )
}

/** 系统详情：系统信息 + 编辑 + 「该系统自己的」API 管理（点击系统列表进入）。
 *  API 的增删改探活调用都锚定在本系统内——不同系统展示不同的 API 内容。 */
function SystemDetail({ system, setErr, onBack, onSelect, onSystemSaved, onApisChanged }) {
  const [rows, setRows] = useState(null)
  const [editing, setEditing] = useState(null)        // API 编辑（系统固定为当前系统）
  const [sysEditing, setSysEditing] = useState(false)
  const [invoking, setInvoking] = useState(null)      // 调用弹窗的目标行
  const [docOf, setDocOf] = useState(null)            // 文档弹窗的目标行
  const [probeTip, setProbeTip] = useState(null)
  const [q, setQ] = useState('')                      // 搜索：按 slug / 名称 / method / 路径过滤

  const load = useCallback(async () => {
    try { setRows(await apihubApis(`?system_id=${system.id}`)) } catch (e) { setErr(e) }
  }, [system.id, setErr])
  useEffect(() => { load() }, [load])

  const probeOne = async (row) => {
    try {
      const [res] = await apihubProbeAll([row.id])
      setProbeTip(res)
      await load()
    } catch (e) { setErr(e) }
  }
  /** 行内一键启停：关闭后网关调用立即 503「已关闭，不可用」 */
  const toggle = async (row) => {
    try {
      await apihubToggleApi(row.id, !row.enabled)
      await load()
    } catch (e) { setErr(e) }
  }

  const kw = q.trim().toLowerCase()
  const apis = useMemo(() => (rows || []).filter(a => !kw ||
    [a.slug, a.name, a.method, a.path_tpl].some(s => (s || '').toLowerCase().includes(kw))), [rows, kw])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={onBack}>← 返回系统列表</button>
        <div className="flex-1" />
        <button className={btn} onClick={() => setSysEditing(true)}>编辑系统</button>
      </div>

      {/* 系统信息卡：名称/slug/状态 + 网关入口 + 运行参数 */}
      <div className={`${card} p-4`}>
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-100">{system.name}</h2>
          <span className="font-mono text-sm text-stone-400">{system.slug}</span>
          <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
            system.status === 1 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
            {system.status === 1 ? '启用' : system.status === 2 ? '手动禁用' : '自动禁用'}
          </span>
          <span className="ml-auto font-mono text-[11.5px] text-violet-600 dark:text-violet-400"
                title="透明代理入口前缀（路径映射到该系统 base_url）">
            /gw/systems/{system.slug}/&#123;path&#125;
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-[13px]">
          <div className="min-w-0">
            <dt className="text-stone-400 dark:text-stone-500">Base URL</dt>
            <dd className="font-mono text-stone-600 dark:text-stone-300 break-all">{system.base_url}</dd>
          </div>
          <div>
            <dt className="text-stone-400 dark:text-stone-500">超时 / 重试</dt>
            <dd className="text-stone-600 dark:text-stone-300 tabular-nums">{system.timeout_ms} ms / {system.max_retry}</dd>
          </div>
          <div>
            <dt className="text-stone-400 dark:text-stone-500">API</dt>
            <dd className="text-stone-600 dark:text-stone-300 tabular-nums">{rows == null ? '…' : rows.length} 个</dd>
          </div>
        </dl>
      </div>

      {/* 该系统 API 列表 */}
      <div className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-black/[0.06] dark:border-white/[0.06]">
          <span className="text-base font-semibold text-stone-700 dark:text-stone-200">API</span>
          <span className="px-1.5 py-0.5 rounded-md bg-black/[0.06] dark:bg-white/[0.08] text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
            {rows == null ? '…' : apis.length}
          </span>
          <div className="flex-1" />
          <input className={`${inputCls} w-64`} placeholder="搜索：slug / 名称 / method / 路径"
                 value={q} onChange={e => setQ(e.target.value)} />
          <button className={btnPri} onClick={() => setEditing({})}>＋ 新建 API</button>
        </div>
        {!rows && <div className="text-xs text-stone-400 py-16 text-center">加载中…</div>}
        {rows && !apis.length && (
          <div className="py-10 text-center text-sm text-stone-400">
            {kw ? '无匹配 API' : <span>该系统还没有 API<br />
              <button className="mt-2 text-amber-600 dark:text-amber-400 hover:underline" onClick={() => setEditing({})}>添加第一条 API</button>
            </span>}
          </div>
        )}
        {rows && !!apis.length && (
          /* 平铺：colgroup 百分比 + table-fixed，各列按占比撑满整宽，不留栏间空白 */
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col className="w-[11%]" /><col className="w-[33%]" /><col className="w-[15%]" />
              <col className="w-[14%]" /><col className="w-[27%]" />
            </colgroup>
            <thead>
              <tr className="text-left text-xs text-stone-500 dark:text-stone-400 border-b border-black/[0.06] dark:border-white/[0.06]">
                <th className="pl-4 pr-2 py-2 font-normal">健康</th>
                <th className="px-2 py-2 font-normal">API</th>
                <th className="px-2 py-2 font-normal whitespace-nowrap">最近探活延迟</th>
                <th className="px-2 py-2 font-normal">状态</th>
                <th className="pl-2 pr-4 py-2 font-normal text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {apis.map(a => (
                <tr key={a.id} className={`border-b last:border-0 border-black/[0.06] dark:border-white/[0.06] ${a.enabled ? '' : 'opacity-55'}`}>
                  <td className={`pl-4 pr-2 py-2.5 font-medium whitespace-nowrap ${HEALTH_STYLE[a.health?.status] || ''}`}>
                    ● {HEALTH_TEXT[a.health?.status] || a.health?.status}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="text-stone-700 dark:text-stone-200">
                      {a.name} <span className="font-mono text-xs text-stone-400">{a.slug}</span>
                    </div>
                    <div className="text-xs text-stone-400 font-mono break-all">
                      {a.method} {a.path_tpl}
                      {(a.auth_config?.providers || []).length > 0 && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 align-middle">
                          {(a.auth_config.providers || []).map(p => p.type).join('+')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-stone-600 dark:text-stone-300 whitespace-nowrap">
                    {a.last_latency_ms == null ? '-' : `${a.last_latency_ms} ms`}
                    <div className="text-[11.5px] text-stone-400">{fmtTime(a.last_probe_at)}</div>
                  </td>
                  <td className="px-2 py-2.5 whitespace-nowrap">
                    <button onClick={() => toggle(a)} title={a.enabled ? '点击关闭（调用立即 503 已关闭，不可用）' : '点击开启'}
                      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium border whitespace-nowrap transition-colors ${
                        a.enabled
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                          : 'bg-black/[0.04] dark:bg-white/[0.06] border-black/10 dark:border-white/10 text-stone-500 dark:text-stone-400 hover:bg-black/[0.08] dark:hover:bg-white/[0.1]'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${a.enabled ? 'bg-emerald-500' : 'bg-stone-400'}`} />
                      {a.enabled ? '已开启' : '已关闭'}
                    </button>
                  </td>
                  <td className="pl-2 pr-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                      <button className={rowBtnPri} onClick={() => setInvoking(a)}>调用</button>
                      <button className={rowBtnViolet} onClick={() => setDocOf(a)}>文档</button>
                      <button className={rowBtnDef} onClick={() => probeOne(a)}>探活</button>
                      <button className={rowBtnDef} onClick={() => setEditing(a)}>编辑</button>
                      <button className={rowBtnDanger} onClick={async () => {
                        if (!confirm(`删除 API ${a.slug}？`)) return
                        try { await apihubDeleteApi(a.id); await load(); onApisChanged() } catch (e) { setErr(e) }
                      }}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sysEditing && (
        <SystemForm row={system} onClose={() => setSysEditing(false)}
          onSaved={async updated => {
            setSysEditing(false)
            // 改名后 URL 里的 slug 同步到新值（保持深链有效），再重载列表数据
            if (updated?.slug && updated.slug !== system.slug) onSelect(updated.slug)
            await onSystemSaved()
          }} setErr={setErr} />
      )}
      {editing !== null && (
        <ApiForm row={editing} system={system} onClose={() => setEditing(null)}
                 onSaved={async () => { setEditing(null); await load(); onApisChanged() }} setErr={setErr} />
      )}
      {invoking !== null && (
        <InvokeModal row={invoking} onClose={() => setInvoking(null)} />
      )}
      {docOf !== null && (
        <DocModal row={docOf} onClose={() => setDocOf(null)} />
      )}
      {probeTip && (
        <Modal title={`探活结果：${probeTip.slug}`} onClose={() => setProbeTip(null)}>
          <div className="text-sm space-y-1.5 text-stone-700 dark:text-stone-200">
            <div>结果：<b className={probeTip.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{probeTip.ok ? '成功' : '失败'}</b></div>
            <div>状态码：{probeTip.status_code ?? '-'} · 延迟：{probeTip.latency_ms ?? '-'} ms</div>
            <div>新状态：{HEALTH_TEXT[probeTip.new_status] || probeTip.new_status}</div>
            <pre className="mt-2 p-2.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] font-mono text-xs overflow-auto">
              {JSON.stringify(probeTip.detail, null, 2)}
            </pre>
          </div>
        </Modal>
      )}
    </div>
  )
}

function SystemForm({ row, onClose, onSaved, setErr }) {
  const [form, setForm] = useState(() => ({
    name: row.name || '', slug: row.slug || '', base_url: row.base_url || 'https://',
    timeout_ms: row.timeout_ms ?? 30000, max_retry: row.max_retry ?? 2,
    status: row.status ?? 1,
    skip_verify: row.transport?.verify === false,
  }))
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const save = async () => {
    try {
      const updated = await apihubSaveSystem({ ...form, id: row.id, timeout_ms: +form.timeout_ms,
        max_retry: +form.max_retry, status: +form.status, transport: { verify: !form.skip_verify } })
      onSaved(updated)
    } catch (e) { setErr(e) }
  }
  return (
    <Modal wide title={row.id ? `编辑系统：${row.name}` : '新建系统'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">名称</span>
            <input className={`${inputCls} w-full mt-1`} value={form.name} onChange={e => set('name', e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">Slug（调用路径用）</span>
            <input className={`${inputCls} w-full mt-1 font-mono`} value={form.slug} onChange={e => set('slug', e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-stone-500 dark:text-stone-400">
            Base URL（支持 {'{cred.字段}'} 模板，如 https://{'{shop}'}.myshopify.com）
          </span>
          <input className={`${inputCls} w-full mt-1 font-mono`} value={form.base_url} onChange={e => set('base_url', e.target.value)} />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">超时(ms)</span>
            <input type="number" className={`${inputCls} w-full mt-1`} value={form.timeout_ms} onChange={e => set('timeout_ms', e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">最大重试</span>
            <input type="number" className={`${inputCls} w-full mt-1`} value={form.max_retry} onChange={e => set('max_retry', e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">状态</span>
            <div className="mt-1">
              <Select value={form.status} onChange={v => set('status', v)} options={[
                { value: 1, label: '启用' }, { value: 2, label: '手动禁用' },
              ]} />
            </div>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
          <input type="checkbox" className="[color-scheme:light] dark:[color-scheme:dark]" checked={form.skip_verify}
                 onChange={e => set('skip_verify', e.target.checked)} />
          跳过 TLS 证书校验（自签名证书/抓包代理场景）
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button className={btn} onClick={onClose}>取消</button>
          <button className={btnPri} onClick={save}>保存</button>
        </div>
      </div>
    </Modal>
  )
}

// ─── API（系统详情页内管理，系统固定，鉴权内联）──────────────────────

// 新 API 默认鉴权：bearer + token 字段；凭证值直接写在同 JSON 的 credential 里
const DEFAULT_AUTH = {
  providers: [{ type: 'bearer', value: '{cred.token}' }],
  credential_fields: ['token'],
  credential: { token: '' },
}

const DEFAULT_PROBE = {
  type: 'http', method: 'GET', path: '', timeout_ms: 5000,
  expect_status: [200, 201, 204, 301, 302], expect_body_regex: '',
  interval_s: 0, failure_threshold: 3, success_threshold: 2,
}

/** KV 输入组：按默认值键名生成输入框（预填默认值，清空=不传走后端默认），支持追加自定义键。 */
function KeyValueFields({ entries, setEntries, placeholder }) {
  const [newKey, setNewKey] = useState('')
  const add = () => {
    const k = newKey.trim()
    if (!k || k in entries) return
    setEntries({ ...entries, [k]: '' })
    setNewKey('')
  }
  const keys = Object.keys(entries)
  if (!keys.length && !newKey) {
    return (
      <div className="flex items-center gap-2">
        <input className={`${inputCls} w-44 font-mono text-xs`} placeholder={placeholder}
               value={newKey} onChange={e => setNewKey(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <button className={btn} onClick={add}>添加</button>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {keys.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5">
          {keys.map(k => (
            <div key={k} className="flex items-center gap-1.5">
              <label className="block flex-1 min-w-0">
                <span className="block text-[11px] font-mono text-stone-400 mb-1 truncate" title={k}>{k}</span>
                <input className={`${inputCls} w-full font-mono text-xs`} value={entries[k] ?? ''}
                       onChange={e => setEntries({ ...entries, [k]: e.target.value })} />
              </label>
              <button className="mt-5 text-stone-400 hover:text-red-500 text-xs" title="移除该参数"
                      onClick={() => { const n = { ...entries }; delete n[k]; setEntries(n) }}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input className={`${inputCls} w-44 font-mono text-xs`} placeholder={placeholder}
               value={newKey} onChange={e => setNewKey(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <button className={btn} onClick={add}>添加</button>
      </div>
    </div>
  )
}

/** 调用弹窗：页面直发一次系统请求（管理端调试通道，不走平台令牌/限流/配额，日志 mode=test）。
 *  参数齐全：路径变量 / query / header / body 四桶全部提供输入——已配置默认值的参数
 *  自动生成输入框并预填，清空即回落后端默认值；也可追加任意自定义参数。 */
function InvokeModal({ row, onClose }) {
  const reqCfg = row.request_cfg || {}
  const paramDefaults = reqCfg.param_defaults || {}
  const queryDefaults = reqCfg.query_defaults || {}
  const headerDefaults = reqCfg.header_defaults || {}
  const bodyDefaults = reqCfg.body?.defaults || {}
  const pathVars = [...new Set([
    ...[...row.path_tpl.matchAll(/\{path\.(\w+)\}/g)].map(m => m[1]),
    ...Object.keys(paramDefaults),
  ])]
  const [pv, setPv] = useState(() => Object.fromEntries(pathVars.map(v => [v, paramDefaults[v] ?? ''])))
  const [qv, setQv] = useState(() => ({ ...queryDefaults }))
  const [hv, setHv] = useState(() => ({ ...headerDefaults }))
  const [bodyText, setBodyText] = useState(() => JSON.stringify(bodyDefaults ?? {}, null, 2))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)   // {status_code,latency_ms,ok,body} | {error}
  const hasBody = row.method !== 'GET' && row.method !== 'HEAD'

  const run = async () => {
    let body = null
    try { body = bodyText.trim() ? JSON.parse(bodyText) : null }
    catch { setResult({ error: 'body 不是合法 JSON' }); return }
    setBusy(true); setResult(null)
    try {
      const pick = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== ''))
      const r = await apihubInvokeApi(row.id, {
        path: pick(pv), query: pick(qv), header: pick(hv), body,
      })
      setResult(r)
    } catch (e) {
      setResult({ error: e.message })
    } finally { setBusy(false) }
  }

  const statusCls = result?.status_code == null ? ''
    : result.status_code < 400 ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-600 dark:text-red-400'
  return (
    <Modal title={`调用 ${row.slug}（${row.method} ${row.path_tpl}）`} onClose={onClose} wide>
      <div className="space-y-3.5">
        {pathVars.length > 0 && (
          <div>
            <div className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5">
              路径变量（已预填默认值，清空 = 缺省时由后端补齐）
            </div>
            <KeyValueFields entries={pv} setEntries={setPv} placeholder="变量名，如 id" />
          </div>
        )}
        <div>
          <div className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5">
            Query 参数（已预填 query_defaults）
          </div>
          <KeyValueFields entries={qv} setEntries={setQv} placeholder="参数名，如 page" />
        </div>
        <div>
          <div className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5">
            请求头（已预填 header_defaults）
          </div>
          <KeyValueFields entries={hv} setEntries={setHv} placeholder="Header 名，如 X-Request-Id" />
        </div>
        {hasBody && (
          <div>
            <div className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5">
              请求 body（JSON，已预填 body.defaults——如发 QQ 消息补上 content 即可）
            </div>
            <textarea className={`${inputCls} w-full font-mono text-xs`} rows={5}
              value={bodyText} onChange={e => setBodyText(e.target.value)} spellCheck={false} />
          </div>
        )}

        {result && (result.error ? (
          <div className="rounded-lg px-3 py-2 text-[13px] bg-red-500/10 text-red-600 dark:text-red-400 break-all">
            ❌ {result.error}
          </div>
        ) : (
          <div className="rounded-lg border border-black/[0.07] dark:border-white/[0.09] bg-black/[0.02] dark:bg-white/[0.03] p-3">
            <div className="text-[13px] mb-2">
              <b className={statusCls}>HTTP {result.status_code}</b>
              <span className="text-stone-400"> · {result.latency_ms}ms · {result.ok ? '业务成功' : '业务失败'}</span>
            </div>
            <pre className="font-mono text-xs overflow-auto max-h-72 whitespace-pre-wrap break-all">
              {typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2)}
            </pre>
          </div>
        ))}

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-[11px] text-stone-400">
            调试通道：不走平台令牌/限流/配额；未填参数由默认值补齐，调用以 mode=test 记入日志
          </span>
          <button className={btnPri} disabled={busy} onClick={run}>
            {busy ? '调用中…' : '执行调用'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** 调用文档弹窗：后端 /admin/apis/{id}/doc 生成的 Markdown（参数表 + 可复制的调用示例）。 */
function DocModal({ row, onClose }) {
  const [html, setHtml] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let alive = true
    apihubApiDoc(row.id)
      .then(t => { if (alive) setHtml(md.render(t)) })
      .catch(e => { if (alive) setErr(e) })
    return () => { alive = false }
  }, [row.id])
  return (
    <Modal wide title={`调用文档：${row.name}（${row.slug}）`} onClose={onClose}>
      {err ? <Err e={err} /> : html == null
        ? <div className="text-xs text-stone-400 py-10 text-center">加载中…</div>
        : <div className="prose-content text-sm max-h-[72vh] overflow-auto pr-1"
               dangerouslySetInnerHTML={{ __html: html }} />}
    </Modal>
  )
}

/** API 表单：系统详情页内使用，所属系统固定（要换系统请删后重建）。
 *  全控件化配置页——鉴权/请求/响应/探活都是表单字段，用户不接触 JSON；
 *  多 provider / template 等复杂配置与"高级"逃生通道收在底部折叠的 JSON 编辑器里。 */
function ApiForm({ row, system, onClose, onSaved, setErr }) {
  const [form, setForm] = useState(() => ({
    name: row.name || '', slug: row.slug || '', system_id: row.system_id || system.id,
    method: row.method || 'GET', path_tpl: row.path_tpl || '/',
    description: row.description || '',
    auth_config: row.auth_config || DEFAULT_AUTH,
    request_cfg: row.request_cfg || { body: { type: 'json' } },
    response_cfg: row.response_cfg || { envelope: 'passthrough' },
    probe: row.probe || DEFAULT_PROBE, enabled: row.enabled ?? true,
    timeout_ms: row.timeout_ms ?? null,   // 表单不编辑该项，编辑时原值透传（防被清空）
  }))
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const save = async () => {
    try {
      await apihubSaveApi({ ...form, id: row.id, system_id: +form.system_id, enabled: !!form.enabled,
        timeout_ms: form.timeout_ms == null ? null : +form.timeout_ms })
      onSaved()
    } catch (e) { setErr(e) }
  }
  return (
    <Modal xwide title={row.id ? `编辑 API：${row.name}` : '新建 API'} onClose={onClose}>
      <div className="space-y-6">
        {/* 基本信息 */}
        <section>
          <SectionTitle title="基本信息" />
          <div className="grid grid-cols-3 gap-3">
            <Field label="名称">
              <input className={inputCls + ' w-full'} value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="Slug">
              <input className={inputCls + ' w-full font-mono'} value={form.slug} onChange={e => set('slug', e.target.value)} />
            </Field>
            <Field label="所属系统">
              <input readOnly className={inputCls + ' w-full text-stone-500 dark:text-stone-400'}
                     value={`${system.name}（${system.slug}）`} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <Field label="Method">
              <Select value={form.method} onChange={v => set('method', v)} options={
                ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => ({ value: m, label: m }))
              } />
            </Field>
            <Field label="路径模板" hint="相对系统 Base URL；{path.x} 路径变量与 {cred.x} 凭证变量" span={2}>
              <input className={inputCls + ' w-full font-mono'} placeholder="/v1/orders/{path.id}"
                     value={form.path_tpl} onChange={e => set('path_tpl', e.target.value)} />
            </Field>
          </div>
        </section>

        {/* 鉴权 */}
        <section>
          <SectionTitle title="鉴权" hint="网关按此配置向上游系统注入身份；凭证值明文保存在本 API 上" />
          <AuthSection auth={form.auth_config} onChange={v => set('auth_config', v)} />
        </section>

        {/* 请求 */}
        <section>
          <SectionTitle title="请求" hint="调用方未传的参数按默认值补齐，显式传值优先" />
          <RequestSection req={form.request_cfg} onChange={v => set('request_cfg', v)} />
        </section>

        {/* 响应 */}
        <section>
          <SectionTitle title="响应" />
          <ResponseSection res={form.response_cfg} onChange={v => set('response_cfg', v)} />
        </section>

        {/* 探活 */}
        <section>
          <SectionTitle title="探活" hint="path 留空 = 探 API 自身路径；interval_s>0 才定时探" />
          <ProbeSection probe={form.probe} onChange={v => set('probe', v)} />
        </section>

        <div className="flex items-center justify-between pt-1">
          <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
            <input type="checkbox" className="[color-scheme:light] dark:[color-scheme:dark]" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} /> 启用
          </label>
          <div className="flex gap-2">
            <button className={btn} onClick={onClose}>取消</button>
            <button className={btnPri} onClick={save}>保存</button>
          </div>
        </div>

        {/* 高级：复杂配置（多 provider / template / 嵌套 JSON）的逃生通道，默认折叠 */}
        <details className="group">
          <summary className="cursor-pointer select-none text-xs text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300">
            高级（JSON 原始配置，一般无需改动）
          </summary>
          <div className="mt-3 space-y-3">
            <JsonBlock label="鉴权配置" value={form.auth_config} onChange={v => set('auth_config', v)} />
            <JsonBlock label="请求配置" value={form.request_cfg} onChange={v => set('request_cfg', v)} />
            <JsonBlock label="响应配置" value={form.response_cfg} onChange={v => set('response_cfg', v)} />
            <JsonBlock label="探活配置" value={form.probe} onChange={v => set('probe', v)} />
          </div>
        </details>
      </div>
    </Modal>
  )
}

/** 分区标题：细线分隔 + 可选提示 */
function SectionTitle({ title, hint }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-black/[0.06] dark:border-white/[0.06] pb-2 mb-3">
      <span className="text-[13px] font-semibold text-stone-700 dark:text-stone-200">{title}</span>
      {hint && <span className="text-[11px] text-stone-400 dark:text-stone-500">{hint}</span>}
    </div>
  )
}

/** 表单字段：标签（+提示）包裹，mt-1 对齐控件 */
function Field({ label, hint, span = 1, children }) {
  return (
    <label className={`block ${span === 2 ? 'col-span-2' : ''}`}>
      <span className="text-xs text-stone-500 dark:text-stone-400">{label}</span>
      {hint && <span className="ml-1.5 text-[11px] text-stone-400 dark:text-stone-500">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  )
}

// ─── 鉴权分区 ───────────────────────────────────────────────────────

const AUTH_TYPES = [
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'api_key_header', label: 'API Key（请求头）' },
  { value: 'query_key', label: 'API Key（Query 参数）' },
  { value: 'basic', label: 'Basic Auth（用户名/密码）' },
  { value: 'static_cookie', label: '静态 Cookie' },
  { value: 'path_token', label: '路径令牌（凭证用于 URL/路径）' },
  { value: 'qq_bot', label: 'QQ 机器人（动态令牌）' },
  { value: 'custom', label: '自定义（多 provider / template）' },
]
// 各鉴权方式的默认凭证字段与 provider 参数
const AUTH_DEFAULTS = {
  bearer: { fields: ['token'], provider: { type: 'bearer', value: '{cred.token}' } },
  api_key_header: { fields: ['token'], provider: { type: 'api_key_header', header: 'X-API-Key', value: '{cred.token}' } },
  query_key: { fields: ['key'], provider: { type: 'query_key', param: 'key', value: '{cred.key}' } },
  basic: { fields: ['user', 'password'], provider: { type: 'basic', user: '{cred.user}', password: '{cred.password}' } },
  static_cookie: { fields: ['session'], provider: { type: 'static_cookie', cookie: 'SESSION', value: '{cred.session}' } },
  path_token: { fields: ['token'], provider: { type: 'path_token' } },
  qq_bot: { fields: ['app_id', 'app_secret'], provider: { type: 'qq_bot' } },
}
// provider 参数控件定义：key → [标签]
const AUTH_PROVIDER_FIELDS = {
  bearer: [['value', '值模板']],
  api_key_header: [['header', 'Header 名'], ['value', '值模板']],
  query_key: [['param', '参数名'], ['value', '值模板']],
  basic: [['user', '用户名模板'], ['password', '密码模板']],
  static_cookie: [['cookie', 'Cookie 名'], ['value', '值模板']],
  qq_bot: [['token_url', '令牌端点（留空=官方默认）']],
}

function AuthSection({ auth, onChange }) {
  const providers = auth.providers || []
  const type = providers.length === 1 && AUTH_DEFAULTS[providers[0].type] ? providers[0].type : 'custom'
  const provider = providers[0] || {}
  const fields = auth.credential_fields || []
  const cred = auth.credential || {}

  const setType = t => {
    if (t === 'custom') return   // 自定义 = 保持原样，走底部 JSON
    const d = AUTH_DEFAULTS[t]
    const keep = {}
    for (const f of d.fields) if (cred[f] != null) keep[f] = cred[f]
    onChange({ ...auth, providers: [{ ...d.provider }], credential_fields: [...d.fields], credential: keep })
  }
  const setProvider = (k, v) => onChange({ ...auth, providers: [{ ...provider, [k]: v }] })
  const setCred = (k, v) => onChange({ ...auth, credential: { ...cred, [k]: v } })

  return (
    <div className="space-y-3">
      <Field label="鉴权方式">
        <Select value={type} onChange={setType} options={AUTH_TYPES} />
      </Field>
      {type !== 'custom' && (
        <>
          {(AUTH_PROVIDER_FIELDS[type] || []).length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {AUTH_PROVIDER_FIELDS[type].map(([k, label]) => (
                <Field key={k} label={label}>
                  <input className={inputCls + ' w-full font-mono text-xs'} placeholder={AUTH_DEFAULTS[type].provider[k] || ''}
                         value={provider[k] ?? ''} onChange={e => setProvider(k, e.target.value)} />
                </Field>
              ))}
            </div>
          )}
          <div>
            <div className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">
              凭证字段与值（provider 里的 <span className="font-mono">{'{cred.字段}'}</span> 引用的就是这里）
            </div>
            <div className="space-y-2">
              {fields.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={inputCls + ' w-40 font-mono text-xs !py-1.5'} value={f}
                         onChange={e => {
                           const nv = e.target.value
                           if (!nv || nv === f) return
                           const list = [...fields]
                           list[i] = nv
                           const nc = { ...cred }
                           nc[nv] = cred[f]
                           delete nc[f]
                           onChange({ ...auth, credential_fields: list, credential: nc })
                         }} />
                  <input className={inputCls + ' flex-1 font-mono text-xs !py-1.5'} placeholder={`${f} 的值`}
                         value={cred[f] == null ? '' : String(cred[f])} onChange={e => setCred(f, e.target.value)} />
                  <button type="button" className="text-stone-400 hover:text-red-500 text-xs px-1"
                          onClick={() => {
                            const nc = { ...cred }; delete nc[f]
                            onChange({ ...auth, credential_fields: fields.filter((_, j) => j !== i), credential: nc })
                          }}>✕</button>
                </div>
              ))}
              <FieldRowAdder placeholder="字段名，如 token"
                onAdd={name => { if (!name || fields.includes(name)) return; onChange({ ...auth, credential_fields: [...fields, name] }) }} />
            </div>
          </div>
        </>
      )}
      {type === 'custom' && (
        <p className="text-[11px] text-stone-400 dark:text-stone-500">
          当前为多 provider / template 等复杂配置，请在底部「高级（JSON）」中编辑。
        </p>
      )}
    </div>
  )
}

/** KV 对象编辑器：{k: v} ↔ 输入行（值按字符串编辑，原样写回） */
function KVFields({ obj, onChange, keyPlaceholder = '参数名', valPlaceholder = '值', empty = '未配置——调用方不传时网关不补齐该参数' }) {
  const entries = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {}
  const keys = Object.keys(entries)
  const set = (k, v) => onChange({ ...entries, [k]: v })
  const del = k => { const n = { ...entries }; delete n[k]; onChange(n) }
  return (
    <div className="space-y-2">
      {keys.map(k => (
        <div key={k} className="flex items-center gap-2">
          <input readOnly className={inputCls + ' w-40 font-mono text-xs !py-1.5'} value={k} title={k} />
          <input className={inputCls + ' flex-1 font-mono text-xs !py-1.5'} value={entries[k] == null ? '' : String(entries[k])}
                 onChange={e => set(k, e.target.value)} />
          <button type="button" className="text-stone-400 hover:text-red-500 text-xs px-1" onClick={() => del(k)}>✕</button>
        </div>
      ))}
      <FieldRowAdder placeholder={keyPlaceholder} valPlaceholder={valPlaceholder} onAdd={(k, v) => {
        if (!k || k in entries) return
        onChange({ ...entries, [k]: v })
      }} />
      {!keys.length && <p className="text-[11px] text-stone-400 dark:text-stone-500">{empty}</p>}
    </div>
  )
}

/** 键值添加行：仅键（credential_fields）或键+值（四桶默认值） */
function FieldRowAdder({ placeholder, valPlaceholder, onAdd }) {
  const [k, setK] = useState('')
  const [v, setV] = useState('')
  const add = () => { onAdd(k.trim(), v); setK(''); setV('') }
  return (
    <div className="flex items-center gap-2">
      <input className={inputCls + ' w-40 font-mono text-xs !py-1.5'} placeholder={placeholder} value={k}
             onChange={e => setK(e.target.value)}
             onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
      {valPlaceholder !== undefined ? (
        <input className={inputCls + ' flex-1 font-mono text-xs !py-1.5'} placeholder={valPlaceholder} value={v}
               onChange={e => setV(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
      ) : <div className="flex-1" />}
      <button type="button" className={btn + ' !px-3 !py-1.5 text-xs shrink-0'} onClick={add}>添加</button>
    </div>
  )
}

// ─── 请求分区 ───────────────────────────────────────────────────────

function RequestSection({ req, onChange }) {
  const body = req.body || {}
  const bodyType = body.type || 'json'
  const setBody = (k, v) => onChange({ ...req, body: { ...body, [k]: v } })
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Body 类型">
          <Select value={bodyType} onChange={v => setBody('type', v)} options={[
            { value: 'json', label: 'JSON' }, { value: 'form', label: '表单 urlencoded' }, { value: 'raw', label: '原始文本' },
          ]} />
        </Field>
        {bodyType === 'raw' && (
          <Field label="Content-Type" span={2}>
            <input className={inputCls + ' w-full font-mono text-xs'} placeholder="application/octet-stream"
                   value={body.content_type || ''} onChange={e => setBody('content_type', e.target.value)} />
          </Field>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <KVBlock label="路径变量默认值" hint="param_defaults：补进 {path.x} 模板" obj={req.param_defaults}
                 onChange={v => onChange({ ...req, param_defaults: v })} />
        <KVBlock label="Query 默认值" hint="query_defaults" obj={req.query_defaults}
                 onChange={v => onChange({ ...req, query_defaults: v })} />
        <KVBlock label="请求头默认值" hint="header_defaults" obj={req.header_defaults}
                 onChange={v => onChange({ ...req, header_defaults: v })} />
        {bodyType === 'json' ? (
          <KVBlock label="Body 默认值" hint="body.defaults：JSON 顶层字段" obj={body.defaults}
                   onChange={v => setBody('defaults', v)} />
        ) : (
          <div>
            <div className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">Body 默认值</div>
            <p className="text-[11px] text-stone-400 dark:text-stone-500">仅 JSON 类型支持默认值补齐</p>
          </div>
        )}
      </div>
    </div>
  )
}

function KVBlock({ label, hint, obj, onChange }) {
  return (
    <div>
      <div className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">
        {label}{hint && <span className="ml-1.5 text-[11px] text-stone-400 dark:text-stone-500">{hint}</span>}
      </div>
      <KVFields obj={obj} onChange={onChange} />
    </div>
  )
}

// ─── 响应分区 ───────────────────────────────────────────────────────

function ResponseSection({ res, onChange }) {
  const em = res.error_mapping || {}
  const setEm = (k, v) => onChange({ ...res, error_mapping: { ...em, [k]: v } })
  return (
    <div className="grid grid-cols-3 gap-3">
      <Field label="信封模式">
        <Select value={res.envelope || 'passthrough'} onChange={v => onChange({ ...res, envelope: v })} options={[
          { value: 'passthrough', label: '透传（系统侧原文）' }, { value: 'wrap', label: '统一信封 {code,message,data}' },
        ]} />
      </Field>
      <Field label="字符集" hint="留空=utf-8">
        <input className={inputCls + ' w-full font-mono text-xs'} placeholder="utf-8"
               value={res.charset || ''} onChange={e => onChange({ ...res, charset: e.target.value })} />
      </Field>
      <Field label="业务码路径" hint="如 $.code">
        <input className={inputCls + ' w-full font-mono text-xs'} placeholder="如 $.code（留空=只看 HTTP 状态）"
               value={em.body_code_path || ''} onChange={e => setEm('body_code_path', e.target.value)} />
      </Field>
      <Field label="成功业务码" hint="逗号分隔">
        <input className={inputCls + ' w-full font-mono text-xs'} placeholder="0, 200, OK"
               value={(em.success_codes || []).join(', ')}
               onChange={e => setEm('success_codes', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
      </Field>
      <Field label="错误消息路径" hint="如 $.msg">
        <input className={inputCls + ' w-full font-mono text-xs'} placeholder="如 $.msg"
               value={em.body_message_path || ''} onChange={e => setEm('body_message_path', e.target.value)} />
      </Field>
    </div>
  )
}

// ─── 探活分区 ───────────────────────────────────────────────────────

function ProbeSection({ probe, onChange }) {
  const p = { ...DEFAULT_PROBE, ...(probe || {}) }
  const set = (k, v) => onChange({ ...p, [k]: v })
  return (
    <div className="grid grid-cols-4 gap-3">
      <Field label="Method">
        <Select value={p.method} onChange={v => set('method', v)} options={
          ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map(m => ({ value: m, label: m }))
        } />
      </Field>
      <Field label="探活路径" hint="留空=API 自身路径" span={3}>
        <input className={inputCls + ' w-full font-mono text-xs'} placeholder="/health"
               value={p.path || ''} onChange={e => set('path', e.target.value)} />
      </Field>
      <Field label="期望状态码" hint="逗号分隔">
        <input className={inputCls + ' w-full font-mono text-xs'}
               value={(p.expect_status || []).join(', ')}
               onChange={e => set('expect_status', e.target.value.split(',').map(s => s.trim()).filter(Boolean).map(Number))} />
      </Field>
      <Field label="Body 正则" hint="可选">
        <input className={inputCls + ' w-full font-mono text-xs'} placeholder='如 "status":"ok"'
               value={p.expect_body_regex || ''} onChange={e => set('expect_body_regex', e.target.value)} />
      </Field>
      <Field label="超时(ms)">
        <input type="number" className={inputCls + ' w-full'} value={p.timeout_ms}
               onChange={e => set('timeout_ms', +e.target.value || 0)} />
      </Field>
      <Field label="定时间隔(s)" hint="0=仅手动">
        <input type="number" className={inputCls + ' w-full'} value={p.interval_s}
               onChange={e => set('interval_s', +e.target.value || 0)} />
      </Field>
      <Field label="失败阈值" hint="连续 N 次判故障">
        <input type="number" className={inputCls + ' w-full'} value={p.failure_threshold}
               onChange={e => set('failure_threshold', +e.target.value || 1)} />
      </Field>
      <Field label="恢复阈值" hint="连续 N 次判恢复">
        <input type="number" className={inputCls + ' w-full'} value={p.success_threshold}
               onChange={e => set('success_threshold', +e.target.value || 1)} />
      </Field>
      <Field label="探活请求头" hint="可选">
        <input readOnly className={inputCls + ' w-full text-stone-400 text-xs'}
               value={(p.headers && Object.keys(p.headers).length) ? `${Object.keys(p.headers).length} 个（高级可改）` : '无'} />
      </Field>
      <div />
    </div>
  )
}

/** JSON 配置块（高级区用）：标签 + 编辑器 */
function JsonBlock({ label, value, onChange }) {
  return (
    <div>
      <span className="text-xs font-medium text-stone-600 dark:text-stone-300">{label}</span>
      <div className="mt-1"><JsonArea rows={8} value={value} onChange={onChange} /></div>
    </div>
  )
}

// ─── 平台令牌 ───────────────────────────────────────────────────────

function Tokens({ setErr }) {
  const [rows, setRows] = useState(null)
  const [creating, setCreating] = useState(false)
  const [issued, setIssued] = useState(null)
  const [form, setForm] = useState({ name: '', expires_at: '', allowed_ips: '', quota_total: '' })
  const load = useCallback(async () => {
    try { setRows(await apihubTokens()) } catch (e) { setErr(e) }
  }, [setErr])
  useEffect(() => { load() }, [load])

  const create = async () => {
    const body = { name: form.name || 'token' }
    if (form.expires_at) body.expires_at = form.expires_at
    if (form.allowed_ips) body.allowed_ips = form.allowed_ips.split(',').map(s => s.trim()).filter(Boolean)
    if (form.quota_total) body.quota_total = +form.quota_total
    try {
      const t = await apihubCreateToken(body)
      setCreating(false); setIssued(t); setForm({ name: '', expires_at: '', allowed_ips: '', quota_total: '' })
      load()
    } catch (e) { setErr(e) }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className={btnPri} onClick={() => setCreating(true)}>签发令牌</button>
      </div>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-stone-500 dark:text-stone-400 border-b border-black/[0.06] dark:border-white/[0.06]">
              <th className="pl-4 pr-2 py-2 font-normal">名称</th>
              <th className="px-2 py-2 font-normal">Key（指纹）</th>
              <th className="px-2 py-2 font-normal">状态</th>
              <th className="px-2 py-2 font-normal">过期时间</th>
              <th className="px-2 py-2 font-normal">配额(用/总)</th>
              <th className="px-2 py-2 font-normal">IP 白名单</th>
              <th className="px-2 py-2 font-normal">最近使用</th>
              <th className="pl-2 pr-4 py-2 font-normal">操作</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map(t => (
              <tr key={t.id} className="border-b last:border-0 border-black/[0.06] dark:border-white/[0.06]">
                <td className="pl-4 pr-2 py-2.5 text-stone-700 dark:text-stone-200">{t.name}</td>
                <td className="px-2 py-2.5 font-mono text-xs text-stone-500 dark:text-stone-400">{t.key_hint}</td>
                <td className={`px-2 py-2.5 font-medium whitespace-nowrap ${t.status === 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                  {t.status === 1 ? '启用' : '停用'}
                </td>
                <td className="px-2 py-2.5 text-stone-500 dark:text-stone-400 whitespace-nowrap">{fmtTime(t.expires_at)}</td>
                <td className="px-2 py-2.5 tabular-nums text-stone-600 dark:text-stone-300">
                  {t.quota_total == null ? '无限' : `${t.quota_used}/${t.quota_total}`}
                </td>
                <td className="px-2 py-2.5 text-stone-500 dark:text-stone-400">{(t.allowed_ips || []).join(',') || '-'}</td>
                <td className="px-2 py-2.5 text-stone-500 dark:text-stone-400 whitespace-nowrap">{fmtTime(t.last_used_at)}</td>
                <td className="pl-2 pr-4 py-2.5">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <button className="text-stone-600 dark:text-stone-300 hover:underline" onClick={async () => {
                      try { await apihubUpdateToken(t.id, { status: t.status === 1 ? 2 : 1 }); load() } catch (e) { setErr(e) }
                    }}>{t.status === 1 ? '停用' : '启用'}</button>
                    {t.quota_total != null && (
                      <button className="text-stone-600 dark:text-stone-300 hover:underline" onClick={async () => {
                        try { await apihubUpdateToken(t.id, { quota_used_reset: true }); load() } catch (e) { setErr(e) }
                      }}>重置用量</button>
                    )}
                    <button className="text-red-600 dark:text-red-400 hover:underline" onClick={async () => {
                      if (!confirm('删除该令牌？')) return
                      try { await apihubDeleteToken(t.id); load() } catch (e) { setErr(e) }
                    }}>删除</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={8} className="py-10 text-center text-stone-400">暂无令牌</td></tr>}
          </tbody>
        </table>
      </div>
      {creating && (
        <Modal title="签发平台令牌" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs text-stone-500 dark:text-stone-400">名称</span>
              <input className={`${inputCls} w-full mt-1`} value={form.name}
                     onChange={e => setForm({ ...form, name: e.target.value })} placeholder="如：我的应用" />
            </label>
            <label className="block">
              <span className="text-xs text-stone-500 dark:text-stone-400">过期时间（留空=永久，如 2030-01-01T00:00:00）</span>
              <input className={`${inputCls} w-full mt-1 font-mono`} value={form.expires_at}
                     onChange={e => setForm({ ...form, expires_at: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-stone-500 dark:text-stone-400">IP 白名单（逗号分隔）</span>
                <input className={`${inputCls} w-full mt-1`} value={form.allowed_ips}
                       onChange={e => setForm({ ...form, allowed_ips: e.target.value })} placeholder="1.2.3.4" />
              </label>
              <label className="block">
                <span className="text-xs text-stone-500 dark:text-stone-400">计次配额（留空=不限）</span>
                <input type="number" className={`${inputCls} w-full mt-1`} value={form.quota_total}
                       onChange={e => setForm({ ...form, quota_total: e.target.value })} />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button className={btn} onClick={() => setCreating(false)}>取消</button>
              <button className={btnPri} onClick={create}>签发</button>
            </div>
          </div>
        </Modal>
      )}
      {issued && (
        <Modal title="令牌已签发" onClose={() => setIssued(null)}>
          <div className="text-sm text-amber-600 dark:text-amber-400 mb-2">
            明文 Key 仅此一次显示，请立即复制保存：
          </div>
          <div className="flex gap-2">
            <input readOnly value={issued.key} className={`${inputCls} w-full font-mono`} />
            <button className={btn} onClick={() => {
              navigator.clipboard?.writeText(issued.key)
            }}>复制</button>
          </div>
          <div className="mt-3 text-[11.5px] text-stone-400">
            调用方式：POST /api/apihub/gw/apis/&#123;slug&#125;，Header Authorization: Bearer sk-…
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── 限流规则 ───────────────────────────────────────────────────────

const SCOPE_TEXT = { token_api: '令牌×API', api: 'API 总量', token: '令牌全局', global: '全局' }

function Rules({ setErr }) {
  const [rows, setRows] = useState(null)
  const [apis, setApis] = useState([])
  const [tokens, setTokens] = useState([])
  const [editing, setEditing] = useState(null)
  const load = useCallback(async () => {
    try {
      setRows(await apihubRules())
      setApis(await apihubApis())
      setTokens(await apihubTokens())
    } catch (e) { setErr(e) }
  }, [setErr])
  useEffect(() => { load() }, [load])
  const apiName = id => apis.find(a => a.id === id)?.slug || `#${id}`
  const tokenName = id => tokens.find(t => t.id === id)?.name || `#${id}`

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className={btnPri} onClick={() => setEditing({
          scope: 'api', algorithm: 'token_bucket', rate_per_sec: 1, burst: 5, window_s: 60, max_count: 100, enabled: true,
        })}>＋ 新建规则</button>
      </div>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-stone-500 dark:text-stone-400 border-b border-black/[0.06] dark:border-white/[0.06]">
              <th className="pl-4 pr-2 py-2 font-normal">层级</th>
              <th className="px-2 py-2 font-normal">作用对象</th>
              <th className="px-2 py-2 font-normal">算法 / 参数</th>
              <th className="px-2 py-2 font-normal">当前余量</th>
              <th className="px-2 py-2 font-normal">状态</th>
              <th className="pl-2 pr-4 py-2 font-normal">操作</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map(r => (
              <tr key={r.id} className="border-b last:border-0 border-black/[0.06] dark:border-white/[0.06]">
                <td className="pl-4 pr-2 py-2.5">
                  <span className={`px-2 py-0.5 rounded-md text-[11px] ${
                    r.scope === 'global' ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                    : r.scope === 'api' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : r.scope === 'token_api' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400'}`}>{SCOPE_TEXT[r.scope]}</span>
                </td>
                <td className="px-2 py-2.5 text-stone-600 dark:text-stone-300">
                  {r.api_id && <span className="font-mono text-xs mr-1">{apiName(r.api_id)}</span>}
                  {r.token_id && <span className="text-amber-600 dark:text-amber-400">{tokenName(r.token_id)}</span>}
                </td>
                <td className="px-2 py-2.5 text-stone-600 dark:text-stone-300">
                  {r.algorithm === 'token_bucket'
                    ? `令牌桶 ${r.rate_per_sec}/s · 突发 ${r.burst}`
                    : `固定窗口 ${r.max_count} 次 / ${r.window_s}s`}
                </td>
                <td className="px-2 py-2.5">
                  {r.usage ? (
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                        <div className={`h-full ${r.usage.remaining / Math.max(1, r.usage.limit) < 0.2 ? 'bg-red-500' : 'bg-emerald-500'}`}
                             style={{ width: `${Math.min(100, r.usage.remaining / Math.max(1, r.usage.limit) * 100)}%` }} />
                      </div>
                      <span className="text-xs text-stone-500 dark:text-stone-400">{r.usage.remaining}/{r.usage.limit}</span>
                    </div>
                  ) : '-'}
                </td>
                <td className={`px-2 py-2.5 font-medium ${r.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-400'}`}>
                  {r.enabled ? '启用' : '停用'}
                </td>
                <td className="pl-2 pr-4 py-2.5">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <button className="text-stone-600 dark:text-stone-300 hover:underline" onClick={() => setEditing(r)}>编辑</button>
                    <button className="text-red-600 dark:text-red-400 hover:underline" onClick={async () => {
                      if (!confirm('删除该规则？')) return
                      try { await apihubDeleteRule(r.id); load() } catch (e) { setErr(e) }
                    }}>删除</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={6} className="py-10 text-center text-stone-400">
              暂无规则。层级：令牌×API → API 总量 → 令牌全局 → 全局，任一超限即 429</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && (
        <RuleForm row={editing} apis={apis} tokens={tokens} onClose={() => setEditing(null)}
                  onSaved={async () => { setEditing(null); await load() }} setErr={setErr} />
      )}
    </div>
  )
}

function RuleForm({ row, apis, tokens, onClose, onSaved, setErr }) {
  const [f, setF] = useState(() => ({
    ...row,
    rate_per_sec: row.rate_per_sec ?? 1, burst: row.burst ?? 5,
    window_s: row.window_s ?? 60, max_count: row.max_count ?? 100, enabled: row.enabled ?? true,
  }))
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const save = async () => {
    try {
      await apihubSaveRule({
        id: f.id, scope: f.scope, algorithm: f.algorithm, enabled: !!f.enabled,
        api_id: f.scope === 'token' ? null : +f.api_id || null,
        token_id: f.scope === 'api' ? null : +f.token_id || null,
        rate_per_sec: f.algorithm === 'token_bucket' ? +f.rate_per_sec : null,
        burst: f.algorithm === 'token_bucket' ? +f.burst : null,
        window_s: f.algorithm === 'fixed_window' ? +f.window_s : null,
        max_count: f.algorithm === 'fixed_window' ? +f.max_count : null,
      })
      onSaved()
    } catch (e) { setErr(e) }
  }
  return (
    <Modal title={row.id ? '编辑限流规则' : '新建限流规则'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">层级</span>
            <div className="mt-1">
              <Select value={f.scope} onChange={v => set('scope', v)} options={[
                { value: 'token_api', label: '令牌×API（单 API 分令牌）' },
                { value: 'api', label: 'API 总量（保护系统）' },
                { value: 'token', label: '令牌全局' },
                { value: 'global', label: '全局' },
              ]} />
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">算法</span>
            <div className="mt-1">
              <Select value={f.algorithm} onChange={v => set('algorithm', v)} options={[
                { value: 'token_bucket', label: '令牌桶（速率，允许突发）' },
                { value: 'fixed_window', label: '固定窗口（长周期配额）' },
              ]} />
            </div>
          </label>
        </div>
        {['token_api', 'api'].includes(f.scope) && (
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">API</span>
            <div className="mt-1">
              <Select value={f.api_id || ''} onChange={v => set('api_id', v)} placeholder="选择 API…" options={
                apis.map(a => ({ value: a.id, label: `${a.name}（${a.slug}）` }))
              } />
            </div>
          </label>
        )}
        {['token_api', 'token'].includes(f.scope) && (
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">平台令牌</span>
            <div className="mt-1">
              <Select value={f.token_id || ''} onChange={v => set('token_id', v)} placeholder="选择令牌…" options={
                tokens.map(t => ({ value: t.id, label: `${t.name}（${t.key_hint}）` }))
              } />
            </div>
          </label>
        )}
        {f.algorithm === 'token_bucket' ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-stone-500 dark:text-stone-400">速率（令牌/秒）</span>
              <input type="number" step="0.1" className={`${inputCls} w-full mt-1`} value={f.rate_per_sec} onChange={e => set('rate_per_sec', e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs text-stone-500 dark:text-stone-400">突发容量</span>
              <input type="number" className={`${inputCls} w-full mt-1`} value={f.burst} onChange={e => set('burst', e.target.value)} />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-stone-500 dark:text-stone-400">窗口（秒）</span>
              <input type="number" className={`${inputCls} w-full mt-1`} value={f.window_s} onChange={e => set('window_s', e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs text-stone-500 dark:text-stone-400">窗口内最大次数</span>
              <input type="number" className={`${inputCls} w-full mt-1`} value={f.max_count} onChange={e => set('max_count', e.target.value)} />
            </label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className={btn} onClick={onClose}>取消</button>
          <button className={btnPri} onClick={save}>保存</button>
        </div>
      </div>
    </Modal>
  )
}

// ─── 调用日志 ───────────────────────────────────────────────────────

function Logs({ setErr }) {
  const [rows, setRows] = useState(null)
  const [apis, setApis] = useState([])
  const [apiId, setApiId] = useState('')
  const load = useCallback(async () => {
    try {
      setRows(await apihubLogs(apiId ? `?api_id=${apiId}` : ''))
      setApis(await apihubApis())
    } catch (e) { setErr(e) }
  }, [apiId, setErr])
  useEffect(() => { load() }, [load])
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-56">
          <Select value={apiId} onChange={setApiId} options={[
            { value: '', label: '全部 API' },
            ...apis.map(a => ({ value: a.id, label: a.slug })),
          ]} />
        </div>
        <button className={btn} onClick={load}>刷新</button>
        <span className="text-[11.5px] text-stone-400">最近 200 条（异步批量落库，约 2s 延迟）</span>
      </div>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-stone-500 dark:text-stone-400 border-b border-black/[0.06] dark:border-white/[0.06]">
              <th className="pl-4 pr-2 py-2 font-normal">时间</th>
              <th className="px-2 py-2 font-normal">结果</th>
              <th className="px-2 py-2 font-normal">模式</th>
              <th className="px-2 py-2 font-normal">API/系统</th>
              <th className="px-2 py-2 font-normal">请求</th>
              <th className="px-2 py-2 font-normal text-right">状态码</th>
              <th className="px-2 py-2 font-normal text-right">延迟</th>
              <th className="pl-2 pr-4 py-2 font-normal">错误</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map(l => (
              <tr key={l.id} className="border-b last:border-0 border-black/[0.06] dark:border-white/[0.06]">
                <td className="pl-4 pr-2 py-2.5 text-xs text-stone-500 dark:text-stone-400 whitespace-nowrap">{fmtTime(l.created_at)}</td>
                <td className="px-2 py-2.5 whitespace-nowrap">
                  {l.rl_scope
                    ? <span className="text-purple-600 dark:text-purple-400">限流:{l.rl_scope}</span>
                    : <span className={l.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                        {l.ok ? '成功' : '失败'}</span>}
                </td>
                <td className="px-2 py-2.5 text-stone-500 dark:text-stone-400">{l.mode}</td>
                <td className="px-2 py-2.5 text-stone-600 dark:text-stone-300 font-mono text-xs">
                  {apis.find(a => a.id === l.api_id)?.slug || (l.system_id ? `sys#${l.system_id}` : '-')}
                </td>
                <td className="px-2 py-2.5 font-mono text-xs text-stone-500 dark:text-stone-400 max-w-52 truncate">{l.method} {l.path_digest}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-stone-600 dark:text-stone-300">{l.status_code ?? '-'}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-stone-500 dark:text-stone-400">{l.latency_ms == null ? '-' : `${l.latency_ms}ms`}</td>
                <td className="pl-2 pr-4 py-2.5 text-red-600 dark:text-red-400 max-w-40 truncate">{l.error_type || ''}</td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={8} className="py-10 text-center text-stone-400">暂无日志</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
