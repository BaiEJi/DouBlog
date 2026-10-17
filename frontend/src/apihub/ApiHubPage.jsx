/**
 * API Hub 页 /apihub：统一 API 调用平台（聚合异构上游 / 平台令牌 sk- / 多级限流 / 一键探活）。
 *
 * 六个内部 Tab：总览（健康+统计+一键探活）、上游（含密钥池）、API、平台令牌（明文一次性）、
 * 限流规则（实时余量）、调用日志。配置类字段（鉴权/请求/响应/探活）用 JSON 编辑，失焦校验。
 * 接口全部走 ./api（admin，Basic Auth）；网关调用（sk-）是给外部调用方的，不在本页。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PageHeader from '../shared/PageHeader'
import { API_BASE } from '../shared/client'
import {
  apihubAddKey, apihubApis, apihubCreateToken, apihubDeleteApi, apihubDeleteKey,
  apihubDeleteRule, apihubDeleteToken, apihubDeleteUpstream, apihubInvokeApi, apihubKeys,
  apihubLogs, apihubOverview, apihubProbeAll, apihubRules, apihubSaveApi, apihubSaveRule,
  apihubSaveUpstream, apihubToggleApi, apihubTokens, apihubUpdateKey, apihubUpdateToken,
  apihubUpstreams,
} from './api'

const inputCls = 'px-3 py-2 text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-lg text-stone-800 dark:text-stone-100 placeholder:text-stone-400 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors'
// 下拉框 = inputCls + 显式 color-scheme：展开的原生选项列表（含滚动条）明暗跟随主题，不留白底刺眼
const selectCls = inputCls + ' [color-scheme:light] dark:[color-scheme:dark]'
const btn = 'px-4 py-2 text-sm font-medium rounded-lg bg-black/[0.06] dark:bg-white/[0.08] text-stone-700 dark:text-stone-200 hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50'
const btnPri = 'px-4 py-2 text-sm font-medium rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:opacity-50'
const card = 'rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]'
// 弹窗卡：暗色用实底深色（叠在遮罩上保持对比），与 subs/diary kit 的 Modal 一致
const modalCard = 'rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-[#1c1b1a]'

const HEALTH_STYLE = {
  healthy: 'text-emerald-600 dark:text-emerald-400',
  suspect: 'text-amber-600 dark:text-amber-400',
  down: 'text-red-600 dark:text-red-400',
  unknown: 'text-stone-400',
}
const HEALTH_TEXT = { healthy: '健康', suspect: '疑似故障', down: '故障', unknown: '未知' }
const TABS = [
  ['overview', '总览'], ['upstreams', '上游'], ['apis', 'API'],
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

function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-auto"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} my-auto ${modalCard} p-5 shadow-2xl`}
           onMouseDown={e => e.stopPropagation()}>
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

/** 主题切换图标（与 todo/practice 页同款按钮规格） */
export default function ApiHubPage() {
  const [tab, setTab] = useState('overview')
  const [err, setErr] = useState(null)
  return (
    <div className="min-h-0 font-mono bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 transition-colors">
      <PageHeader title="API Hub" subtitle="异构 API 聚合 · 平台令牌 · 四级限流 · 一键探活"

        tabs={TABS.map(([k, label]) => ({ key: k, label }))}
        activeTab={tab}
        onTabChange={k => { setTab(k); setErr(null) }} />
      <div className="p-0 max-w-full mx-auto">
        <Err e={err} />
        {tab === 'overview' && <Overview setErr={setErr} />}
        {tab === 'upstreams' && <Upstreams setErr={setErr} />}
        {tab === 'apis' && <Apis setErr={setErr} />}
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
      setErr(new Error(`探活完成：${ok}/${results.length} 个健康（详情见 API 列表健康列）`))
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
          ['上游', stats.counts.upstreams],
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
        <ApiTable rows={stats.per_api} empty="暂无调用数据：在上游/API 页配置后用平台令牌调用" />
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

// ─── 上游 ───────────────────────────────────────────────────────────

const DEFAULT_AUTH = {
  providers: [{ type: 'bearer', value: '{cred.token}' }],
  credential_fields: ['token'],
  transport: {},
}

function Upstreams({ setErr }) {
  const [rows, setRows] = useState(null)
  const [editing, setEditing] = useState(null)   // {} 新建 | {...row} 编辑
  const [keysOf, setKeysOf] = useState(null)
  const load = useCallback(async () => {
    try { setRows(await apihubUpstreams()) } catch (e) { setErr(e) }
  }, [setErr])
  useEffect(() => { load() }, [load])
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className={btnPri} onClick={() => setEditing({})}>＋ 新建上游</button>
      </div>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-stone-500 dark:text-stone-400 border-b border-black/[0.06] dark:border-white/[0.06]">
              <th className="pl-4 pr-2 py-2 font-normal">名称 / Slug</th>
              <th className="px-2 py-2 font-normal">Base URL</th>
              <th className="px-2 py-2 font-normal">鉴权</th>
              <th className="px-2 py-2 font-normal">密钥池</th>
              <th className="px-2 py-2 font-normal">状态</th>
              <th className="pl-2 pr-4 py-2 font-normal">操作</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map(u => (
              <tr key={u.id} className="border-b last:border-0 border-black/[0.06] dark:border-white/[0.06]">
                <td className="pl-4 pr-2 py-2.5">
                  <div className="text-stone-700 dark:text-stone-200">{u.name}</div>
                  <div className="text-xs text-stone-400 font-mono">{u.slug}</div>
                </td>
                <td className="px-2 py-2.5 text-stone-600 dark:text-stone-300 max-w-52 truncate">{u.base_url}</td>
                <td className="px-2 py-2.5"><span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono text-[11px]">
                  {(u.auth_config?.providers || []).map(p => p.type).join('+') || '-'}</span></td>
                <td className="px-2 py-2.5">
                  <button className="text-stone-600 dark:text-stone-300 hover:underline"
                          onClick={() => setKeysOf(u.id)}>
                    {u.key_enabled_count}/{u.key_count} 可用
                  </button>
                </td>
                <td className={`px-2 py-2.5 font-medium whitespace-nowrap ${u.status === 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                  {u.status === 1 ? '启用' : u.status === 2 ? '手动禁用' : '自动禁用'}
                </td>
                <td className="pl-2 pr-4 py-2.5">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <button className="text-stone-600 dark:text-stone-300 hover:underline" onClick={() => setEditing(u)}>编辑</button>
                    <button className="text-stone-600 dark:text-stone-300 hover:underline" onClick={() => setKeysOf(u.id)}>密钥</button>
                    <button className="text-red-600 dark:text-red-400 hover:underline" onClick={async () => {
                      if (!confirm(`删除上游 ${u.slug}？（其下 API 需先删除）`)) return
                      try { await apihubDeleteUpstream(u.id); load() } catch (e) { setErr(e) }
                    }}>删除</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={6} className="py-10 text-center text-stone-400">暂无上游</td></tr>}
          </tbody>
        </table>
      </div>
      {editing !== null && (
        <UpstreamForm row={editing} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load() }} setErr={setErr} />
      )}
      {keysOf !== null && (
        <KeyPanel uid={keysOf} onClose={() => { setKeysOf(null); load() }} setErr={setErr} />
      )}
    </div>
  )
}

function UpstreamForm({ row, onClose, onSaved, setErr }) {
  const [form, setForm] = useState(() => ({
    name: row.name || '', slug: row.slug || '', base_url: row.base_url || 'https://',
    timeout_ms: row.timeout_ms ?? 30000, max_retry: row.max_retry ?? 2,
    status: row.status ?? 1,
    auth_config: row.auth_config || DEFAULT_AUTH,
  }))
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const save = async () => {
    try {
      await apihubSaveUpstream({ ...form, id: row.id, timeout_ms: +form.timeout_ms, max_retry: +form.max_retry, status: +form.status })
      onSaved()
    } catch (e) { setErr(e) }
  }
  return (
    <Modal wide title={row.id ? `编辑上游：${row.name}` : '新建上游'} onClose={onClose}>
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
            <select className={`${selectCls} w-full mt-1`} value={form.status} onChange={e => set('status', e.target.value)}>
              <option value={1}>启用</option><option value={2}>手动禁用</option>
            </select>
          </label>
        </div>
        <div>
          <span className="text-xs text-stone-500 dark:text-stone-400">鉴权配置（JSON）</span>
          <div className="text-[11.5px] text-stone-400 dark:text-stone-500 mt-0.5 mb-1">
            七种静态类型：bearer / api_key_header / query_key / basic / static_cookie / path_token / template；
            凭证模板 {'{cred.字段}'} 可用于 header/query/cookie 与 URL/路径
          </div>
          <JsonArea rows={10} value={form.auth_config} onChange={v => set('auth_config', v)} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button className={btn} onClick={onClose}>取消</button>
          <button className={btnPri} onClick={save}>保存</button>
        </div>
      </div>
    </Modal>
  )
}

function KeyPanel({ uid, onClose, setErr }) {
  const [rows, setRows] = useState([])
  const [fields, setFields] = useState(['token'])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({})
  const load = useCallback(async () => {
    try {
      setRows(await apihubKeys(uid))
      const ups = await apihubUpstreams()
      const u = ups.find(x => x.id === uid)
      const f = u?.auth_config?.credential_fields
      if (f?.length) setFields(f)
    } catch (e) { setErr(e) }
  }, [uid, setErr])
  useEffect(() => { load() }, [load])
  const add = async () => {
    const credential = {}
    for (const f of fields) {
      const v = (draft[f] || '').trim()
      if (v.includes('=')) { const [k, ...r] = v.split('='); credential[k] = r.join('=') }
      else if (v) credential[f] = v
    }
    if (!Object.keys(credential).length) { setErr(new Error('请按字段填写凭证值')); return }
    try { await apihubAddKey(uid, credential); setAdding(false); setDraft({}); load() } catch (e) { setErr(e) }
  }
  return (
    <Modal wide title={`密钥池（上游 #${uid}）`} onClose={onClose}>
      <div className="flex justify-end mb-2">
        <button className={btn} onClick={() => setAdding(!adding)}>＋ 添加密钥</button>
      </div>
      {adding && (
        <div className="mb-3 p-3 rounded-xl border border-black/[0.07] dark:border-white/[0.07] space-y-2">
          <div className="text-xs text-stone-500 dark:text-stone-400">
            按 credential_fields 填写：{fields.join(' / ')}
          </div>
          {fields.map(f => (
            <input key={f} className={`${inputCls} w-full font-mono`} placeholder={`${f} = 值`}
                   value={draft[f] || ''} onChange={e => setDraft({ ...draft, [f]: e.target.value })} />
          ))}
          <button className={btnPri} onClick={add}>提交</button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-stone-500 dark:text-stone-400 border-b border-black/[0.06] dark:border-white/[0.06]">
            {['凭证（脱敏）', '状态', '最近使用', '操作'].map(h => <th key={h} className="py-2 font-normal">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(k => (
            <tr key={k.id} className="border-b last:border-0 border-black/[0.06] dark:border-white/[0.06]">
              <td className="py-2.5 font-mono text-xs text-stone-600 dark:text-stone-300">
                {Object.entries(k.credential || {}).map(([f, v]) => `${f}=${v}`).join('  ')}
                {k.disabled_reason && <span className="ml-2 text-red-600 dark:text-red-400">{k.disabled_reason.slice(0, 30)}</span>}
              </td>
              <td className={`py-2.5 font-medium ${k.status === 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {k.status === 1 ? '可用' : '禁用'}
              </td>
              <td className="py-2.5 text-stone-500 dark:text-stone-400">{fmtTime(k.last_used_at)}</td>
              <td className="py-2.5">
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <button className="text-stone-600 dark:text-stone-300 hover:underline" onClick={async () => {
                    try { await apihubUpdateKey(k.id, { status: k.status === 1 ? 2 : 1 }); load() } catch (e) { setErr(e) }
                  }}>{k.status === 1 ? '禁用' : '启用'}</button>
                  <button className="text-red-600 dark:text-red-400 hover:underline" onClick={async () => {
                    if (!confirm('删除该密钥？')) return
                    try { await apihubDeleteKey(k.id); load() } catch (e) { setErr(e) }
                  }}>删除</button>
                </div>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={4} className="py-8 text-center text-stone-400">暂无密钥</td></tr>}
        </tbody>
      </table>
    </Modal>
  )
}

// ─── API ────────────────────────────────────────────────────────────

const DEFAULT_PROBE = {
  type: 'http', method: 'GET', path: '', timeout_ms: 5000,
  expect_status: [200, 201, 204, 301, 302], expect_body_regex: '',
  interval_s: 0, failure_threshold: 3, success_threshold: 2,
}

// ── 分组折叠：默认 ≥8 条的组收起（246 条 API 全展开首屏过长、全折叠又缺概览，
//    折中：大组收起保持一屏可扫，小组展开开箱即见）；手动展开/收起写入 localStorage，
//    下次进入保持。搜索时强制展开有命中的组（保证结果可见），批量折叠按钮随之禁用。
const FOLD_KEY = 'doublog_apihub_group_fold'
const FOLD_THRESHOLD = 8
const UNGROUPED_KEY = '(未分组)'   // 括号不可能出现在合法 group1（字母数字_-）中，不会与真实分组撞 key

const loadFolds = () => {
  try { return JSON.parse(localStorage.getItem(FOLD_KEY)) || {} } catch { return {} }
}

/** 调用弹窗：页面直发一次上游请求（管理端调试通道，不走平台令牌/限流/配额，日志 mode=test）。
 *  路径模板变量自动生成输入框（预填 param_defaults），body JSON 编辑器预填 body.defaults。 */
function InvokeModal({ row, onClose, setErr }) {
  const reqCfg = row.request_cfg || {}
  const defaults = reqCfg.param_defaults || {}
  const pathVars = [...row.path_tpl.matchAll(/\{path\.(\w+)\}/g)].map(m => m[1])
  const [pv, setPv] = useState(() => Object.fromEntries(pathVars.map(v => [v, defaults[v] ?? ''])))
  const [bodyText, setBodyText] = useState(
    () => JSON.stringify(reqCfg.body?.defaults ?? {}, null, 2))
  const [queryText, setQueryText] = useState('{}')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)   // {status_code,latency_ms,ok,body} | {error}

  const run = async () => {
    let body = null, query = {}
    try { body = bodyText.trim() ? JSON.parse(bodyText) : null }
    catch { setResult({ error: 'body 不是合法 JSON' }); return }
    try { query = queryText.trim() ? JSON.parse(queryText) : {} }
    catch { setResult({ error: 'query 不是合法 JSON' }); return }
    setBusy(true); setResult(null)
    try {
      const path = Object.fromEntries(Object.entries(pv).filter(([, v]) => v !== ''))
      const r = await apihubInvokeApi(row.id, { path, query, body })
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
            <div className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5">路径变量（已预填默认值）</div>
            <div className="grid grid-cols-2 gap-2.5">
              {pathVars.map(v => (
                <label key={v} className="block">
                  <span className="block text-[11px] font-mono text-stone-400 mb-1">{`{${v}}`}</span>
                  <input className={`${inputCls} w-full font-mono text-xs`} value={pv[v] || ''}
                    onChange={e => setPv(p => ({ ...p, [v]: e.target.value }))} />
                </label>
              ))}
            </div>
          </div>
        )}
        <div>
          <div className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5">
            请求 body（JSON，已预填默认值——如发 QQ 消息补上 content 即可）
          </div>
          <textarea className={`${inputCls} w-full font-mono text-xs`} rows={5}
            value={bodyText} onChange={e => setBodyText(e.target.value)} spellCheck={false} />
        </div>
        <div>
          <div className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5">query（JSON，可选）</div>
          <textarea className={`${inputCls} w-full font-mono text-xs`} rows={2}
            value={queryText} onChange={e => setQueryText(e.target.value)} spellCheck={false} />
        </div>

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
            调试通道：不走平台令牌/限流/配额；调用以 mode=test 记入日志
          </span>
          <button className={btnPri} disabled={busy} onClick={run}>
            {busy ? '调用中…' : '执行调用'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Apis({ setErr }) {
  const [rows, setRows] = useState(null)
  const [ups, setUps] = useState([])
  const [editing, setEditing] = useState(null)
  const [grouping, setGrouping] = useState(null)   // 轻量分组弹窗的目标行
  const [probeTip, setProbeTip] = useState(null)
  const [invoking, setInvoking] = useState(null)   // 调用弹窗的目标行
  const [q, setQ] = useState('')                   // 搜索：按 slug / 名称 / method / 路径过滤
  const [folds, setFolds] = useState(loadFolds)    // 组折叠覆盖表 {组key: 是否折叠}

  const load = useCallback(async () => {
    try {
      setRows(await apihubApis())
      setUps(await apihubUpstreams())
    } catch (e) { setErr(e) }
  }, [setErr])
  useEffect(() => { load() }, [load])

  const probeOne = async (row) => {
    try {
      const [res] = await apihubProbeAll([row.id])
      setProbeTip(res)
      await load()
    } catch (e) { setErr(e) }
  }
  /** 行内一键启停：关闭后网关/OpenAPI 调用立即 503「已关闭，不可用」 */
  const toggle = async (row) => {
    try {
      await apihubToggleApi(row.id, !row.enabled)
      await load()
    } catch (e) { setErr(e) }
  }
  const upSlug = id => ups.find(u => u.id === id)?.slug || id

  // 折叠操作：写 state + localStorage（写失败如隐私模式忽略即可）
  const setFold = (key, folded) => {
    const next = { ...folds, [key]: folded }
    setFolds(next)
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }
  const setAllFolds = folded => {
    const next = { ...folds }
    for (const g of groups) next[g.key] = folded
    setFolds(next)
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  // 按 group1/group2 聚合；group1 为空的归「未分组」排最后；组间按路径排序。
  // 搜索时按 slug/名称/method/路径过滤组内 API；关键词命中组路径则保留整组
  //（搜「todo」能直接看到 self/todo 组），无命中的组整个隐藏。
  const kw = q.trim().toLowerCase()
  const groups = useMemo(() => {
    const hit = a => !kw || [a.slug, a.name, a.method, a.path_tpl]
      .some(s => (s || '').toLowerCase().includes(kw))
    const map = new Map()
    for (const a of rows || []) {
      const key = a.group1 ? `${a.group1}/${a.group2 || ''}` : UNGROUPED_KEY
      if (!map.has(key)) map.set(key, { key, g1: a.group1, g2: a.group2 || '', apis: [] })
      map.get(key).apis.push(a)
    }
    return [...map.values()]
      .sort((x, y) => (x.g1 ? 0 : 1) - (y.g1 ? 0 : 1) || x.key.localeCompare(y.key))
      .map(g => ({ ...g, apis: kw && g.key.toLowerCase().includes(kw) ? g.apis : g.apis.filter(hit) }))
      .filter(g => g.apis.length)
  }, [rows, kw])

  // 折叠判定：搜索中强制展开（命中必须可见）；否则取手动覆盖，无覆盖按默认规则（大组折叠）
  const isFolded = g => !kw && (folds[g.key] ?? g.apis.length >= FOLD_THRESHOLD)
  const matchCount = groups.reduce((n, g) => n + g.apis.length, 0)

  return (
    <div className="space-y-3">
      {/* 工具条：搜索 + 批量折叠 + 新建（搜索中折叠无意义，批量按钮禁用） */}
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inputCls} w-72`} placeholder="搜索：slug / 名称 / method / 路径"
               value={q} onChange={e => setQ(e.target.value)} />
        {kw && <span className="text-xs text-stone-500 dark:text-stone-400 tabular-nums">命中 {matchCount} 条</span>}
        <div className="flex-1" />
        <button className={btn} disabled={!!kw} onClick={() => setAllFolds(false)}>全部展开</button>
        <button className={btn} disabled={!!kw} onClick={() => setAllFolds(true)}>全部收起</button>
        <button className={btnPri} onClick={() => setEditing({})}>＋ 新建 API</button>
      </div>
      {rows && !groups.length && (
        <div className={`${card} py-10 text-center text-sm text-stone-400`}>{kw ? '无匹配 API' : '暂无 API'}</div>
      )}
      {!rows && <div className="text-xs text-stone-400 py-16 text-center">加载中…</div>}
      {groups.map(g => {
        const folded = isFolded(g)
        const gPath = `${g.g1}${g.g2 ? `/${g.g2}` : ''}`
        return (
          <div key={g.key} className={`${card} overflow-hidden`}>
            {/* 组头：折叠箭头 + 分组路径 + API 数量 + OpenAPI 前缀链接 */}
            <div className="flex items-center gap-2 pl-3 pr-4 py-2 border-b border-black/[0.06] dark:border-white/[0.06]">
              <button className="flex flex-1 items-center gap-2 min-w-0 text-left" onClick={() => setFold(g.key, !folded)}
                      title={folded ? '展开该组' : '收起该组'}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                     className={`w-4 h-4 shrink-0 text-stone-400 transition-transform ${folded ? '' : 'rotate-90'}`}>
                  <path d="M7 5l6 5-6 5" />
                </svg>
                <span className="font-mono text-[13px] font-medium text-stone-700 dark:text-stone-200 truncate">
                  {g.g1 || '未分组（不发布）'}
                </span>
                <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-black/[0.06] dark:bg-white/[0.08] text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                  {g.apis.length}
                </span>
              </button>
              {g.g1 && (
                <a className="shrink-0 font-mono text-[11.5px] text-violet-600 dark:text-violet-400 hover:underline"
                   href={`${API_BASE}/openapi/${gPath}`} title="该组 OpenAPI 前缀" target="_blank" rel="noreferrer">
                  /openapi/{gPath}
                </a>
              )}
            </div>
            {!folded && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-stone-500 dark:text-stone-400 border-b border-black/[0.06] dark:border-white/[0.06]">
                    <th className="pl-4 pr-2 py-2 font-normal">健康</th>
                    <th className="px-2 py-2 font-normal">API</th>
                    <th className="px-2 py-2 font-normal">上游</th>
                    <th className="px-2 py-2 font-normal">最近探活延迟</th>
                    <th className="px-2 py-2 font-normal">状态</th>
                    <th className="pl-2 pr-4 py-2 font-normal">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {g.apis.map(a => (
                    <tr key={a.id} className={`border-b last:border-0 border-black/[0.06] dark:border-white/[0.06] ${a.enabled ? '' : 'opacity-55'}`}>
                      <td className={`pl-4 pr-2 py-2.5 font-medium whitespace-nowrap ${HEALTH_STYLE[a.health?.status] || ''}`}>
                        ● {HEALTH_TEXT[a.health?.status] || a.health?.status}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="text-stone-700 dark:text-stone-200">
                          {a.name} <span className="font-mono text-xs text-stone-400">{a.slug}</span>
                        </div>
                        <div className="text-xs text-stone-400 font-mono">{a.method} {a.path_tpl}</div>
                      </td>
                      <td className="px-2 py-2.5 text-stone-600 dark:text-stone-300 font-mono text-xs">{upSlug(a.upstream_id)}</td>
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
                      <td className="pl-2 pr-4 py-2.5">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <button className="text-amber-600 dark:text-amber-400 hover:underline" onClick={() => setInvoking(a)}>调用</button>
                          <button className="text-stone-600 dark:text-stone-300 hover:underline" onClick={() => probeOne(a)}>探活</button>
                          <button className="text-violet-600 dark:text-violet-400 hover:underline" onClick={() => setGrouping(a)}>分组</button>
                          <button className="text-stone-600 dark:text-stone-300 hover:underline" onClick={() => setEditing(a)}>编辑</button>
                          <button className="text-red-600 dark:text-red-400 hover:underline" onClick={async () => {
                            if (!confirm(`删除 API ${a.slug}？`)) return
                            try { await apihubDeleteApi(a.id); load() } catch (e) { setErr(e) }
                          }}>删除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
      {editing !== null && (
        <ApiForm row={editing} ups={ups} onClose={() => setEditing(null)}
                 onSaved={async () => { setEditing(null); await load() }} setErr={setErr} />
      )}
      {invoking !== null && (
        <InvokeModal row={invoking} onClose={() => setInvoking(null)} setErr={setErr} />
      )}
      {grouping !== null && (
        <GroupForm row={grouping} onClose={() => setGrouping(null)}
                   onSaved={async () => { setGrouping(null); await load() }} setErr={setErr} />
      )}
      {probeTip && (
        <Modal title={`探活结果：${probeTip.slug}`} onClose={() => setProbeTip(null)}>
          <div className="text-sm space-y-1.5 text-stone-700 dark:text-stone-200">
            <div>结果：<b className={probeTip.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{probeTip.ok ? '成功' : '失败'}</b></div>
            <div>状态码：{probeTip.status_code ?? '-'}　延迟：{probeTip.latency_ms ?? '-'} ms</div>
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

function ApiForm({ row, ups, onClose, onSaved, setErr }) {
  const [form, setForm] = useState(() => ({
    name: row.name || '', slug: row.slug || '', upstream_id: row.upstream_id || ups[0]?.id,
    method: row.method || 'GET', path_tpl: row.path_tpl || '/', description: row.description || '',
    group1: row.group1 || '', group2: row.group2 || '', pub_name: row.pub_name || '',
    doc_md: row.doc_md || '',
    request_cfg: row.request_cfg || { body: { type: 'json' } },
    response_cfg: row.response_cfg || { envelope: 'passthrough' },
    probe: row.probe || DEFAULT_PROBE, enabled: row.enabled ?? true,
    timeout_ms: row.timeout_ms ?? null,   // 表单不编辑该项，编辑时原值透传（防被清空）
  }))
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const save = async () => {
    try {
      await apihubSaveApi({ ...form, id: row.id, upstream_id: +form.upstream_id, enabled: !!form.enabled,
        timeout_ms: form.timeout_ms == null ? null : +form.timeout_ms })
      onSaved()
    } catch (e) { setErr(e) }
  }
  return (
    <Modal wide title={row.id ? `编辑 API：${row.name}` : '新建 API'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">名称</span>
            <input className={`${inputCls} w-full mt-1`} value={form.name} onChange={e => set('name', e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">Slug</span>
            <input className={`${inputCls} w-full mt-1 font-mono`} value={form.slug} onChange={e => set('slug', e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">上游</span>
            <select className={`${selectCls} w-full mt-1`} value={form.upstream_id} onChange={e => set('upstream_id', e.target.value)}>
              {ups.map(u => <option key={u.id} value={u.id}>{u.name}（{u.slug}）</option>)}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">Method</span>
            <select className={`${selectCls} w-full mt-1`} value={form.method} onChange={e => set('method', e.target.value)}>
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label className="block col-span-2">
            <span className="text-xs text-stone-500 dark:text-stone-400">路径模板（{'{path.x}'} 与 {'{cred.x}'} 变量）</span>
            <input className={`${inputCls} w-full mt-1 font-mono`} placeholder="/v1/orders/{path.id}"
                   value={form.path_tpl} onChange={e => set('path_tpl', e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <JsonBlock label="请求配置（body 类型 json/form/raw、header 模板；param_defaults 路径变量默认值、body.defaults JSON 字段默认值——如 QQ 的 openid/msg_type 可不传）" value={form.request_cfg} onChange={v => set('request_cfg', v)} />
          <JsonBlock label="响应配置（envelope/charset/error_mapping 双通道）" value={form.response_cfg} onChange={v => set('response_cfg', v)} />
          <JsonBlock label="探活配置（path 默认=API 自身路径；interval_s>0 定时探）" value={form.probe} onChange={v => set('probe', v)} />
        </div>
        {/* ── OpenAPI 发布：二级分组 + 对外名称（/openapi/{g1}/{g2}/{名称}）── */}
        <div className="p-3 rounded-xl border border-black/[0.07] dark:border-white/[0.08] space-y-3">
          <div className="text-xs font-medium text-stone-500 dark:text-stone-400">
            OpenAPI 发布（留空一级分组 = 不发布；对外路径 /openapi/一级/二级/名称）
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs text-stone-500 dark:text-stone-400">一级分组</span>
              <input className={`${inputCls} w-full mt-1 font-mono`} placeholder="如 self / weather"
                     value={form.group1} onChange={e => set('group1', e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs text-stone-500 dark:text-stone-400">二级分组（可选，最多二级）</span>
              <input className={`${inputCls} w-full mt-1 font-mono`} placeholder="如 todo / blog"
                     value={form.group2} onChange={e => set('group2', e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs text-stone-500 dark:text-stone-400">对外 api 名称（空 = slug；'doc' 保留）</span>
              <input className={`${inputCls} w-full mt-1 font-mono`} placeholder="如 tasks-list"
                     value={form.pub_name} onChange={e => set('pub_name', e.target.value)} />
            </label>
          </div>
          {form.group1 && (
            <div className="text-[11.5px] text-stone-400 font-mono break-all">
              调用：/openapi/{form.group1}{form.group2 ? `/${form.group2}` : ''}/{form.pub_name || form.slug || '<slug>'}　文档：…/doc
            </div>
          )}
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">文档补充（Markdown，追加在 /doc 自动骨架之后）</span>
            <textarea className={`${inputCls} w-full mt-1 font-mono text-xs`} rows={4} placeholder="## 详细说明…"
                      value={form.doc_md} onChange={e => set('doc_md', e.target.value)} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
          <input type="checkbox" className="[color-scheme:light] dark:[color-scheme:dark]" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} /> 启用
        </label>
        <div className="flex justify-end gap-2">
          <button className={btn} onClick={onClose}>取消</button>
          <button className={btnPri} onClick={save}>保存</button>
        </div>
      </div>
    </Modal>
  )
}

function JsonBlock({ label, value, onChange }) {
  return (
    <div>
      <span className="text-xs text-stone-500 dark:text-stone-400">{label}</span>
      <div className="mt-1"><JsonArea rows={7} value={value} onChange={onChange} /></div>
    </div>
  )
}

/** 轻量分组弹窗：只编辑 OpenAPI 发布四字段（一级/二级分组、对外名称、文档补充），
 *  免开完整编辑表单。后端 PUT 为全量 upsert（_upsert_api 会整行覆写），
 *  因此未在弹窗中的字段必须从行数据原样带上，否则会被清空。 */
function GroupForm({ row, onClose, onSaved, setErr }) {
  const [g, setG] = useState(() => ({
    group1: row.group1 || '', group2: row.group2 || '',
    pub_name: row.pub_name || '', doc_md: row.doc_md || '',
  }))
  const set = (k, v) => setG(s => ({ ...s, [k]: v }))
  const g1 = g.group1.trim(); const g2 = g.group2.trim(); const pub = g.pub_name.trim()
  // 与后端 _upsert_api 同规则的轻校验（先拦明显错误，最终以后端报错为准）
  const badFormat = [g1, g2, pub].some(v => v && !/^[a-zA-Z0-9_-]{1,64}$/.test(v))
  const invalidMsg =
    g2 && !g1 ? '二级分组需要一级分组'
    : badFormat ? '分组 / 名称仅限字母数字与 _-，≤64 字符'
    : g1 && (pub || row.slug) === 'doc' ? '对外名称 "doc" 为文档路由保留字'
    : ''
  // 对外路径实时预览（名称空 = 用 slug）
  const pubPath = g1 ? `/openapi/${g1}${g2 ? `/${g2}` : ''}/${pub || row.slug}` : null
  const save = async () => {
    try {
      await apihubSaveApi({
        id: row.id, name: row.name, slug: row.slug, upstream_id: row.upstream_id,
        method: row.method, path_tpl: row.path_tpl, description: row.description,
        request_cfg: row.request_cfg, response_cfg: row.response_cfg, probe: row.probe,
        enabled: row.enabled, timeout_ms: row.timeout_ms,   // 全量透传，防 upsert 清空
        group1: g1, group2: g2, pub_name: pub, doc_md: g.doc_md,
      })
      onSaved()
    } catch (e) { setErr(e) }
  }
  return (
    <Modal title={`分组设置：${row.name}（${row.slug}）`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">一级分组（留空 = 不发布）</span>
            <input className={`${inputCls} w-full mt-1 font-mono`} placeholder="如 self / weather"
                   value={g.group1} onChange={e => set('group1', e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">二级分组（可选，最多二级）</span>
            <input className={`${inputCls} w-full mt-1 font-mono`} placeholder="如 todo / blog"
                   value={g.group2} onChange={e => set('group2', e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-stone-500 dark:text-stone-400">对外 api 名称（空 = slug；'doc' 保留）</span>
          <input className={`${inputCls} w-full mt-1 font-mono`} placeholder="如 tasks-list"
                 value={g.pub_name} onChange={e => set('pub_name', e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-stone-500 dark:text-stone-400">文档补充（Markdown，追加在 /doc 自动骨架之后）</span>
          <textarea className={`${inputCls} w-full mt-1 font-mono text-xs`} rows={4} placeholder="## 详细说明…"
                    value={g.doc_md} onChange={e => set('doc_md', e.target.value)} />
        </label>
        {/* 对外路径实时预览 */}
        <div className="text-[11.5px] font-mono break-all text-stone-400 dark:text-stone-500">
          {pubPath
            ? <>调用：<span className="text-stone-600 dark:text-stone-300">{pubPath}</span>　文档：{pubPath}/doc</>
            : '未设置一级分组：不生成 OpenAPI 对外路由'}
        </div>
        {invalidMsg && <div className="text-[11.5px] text-red-600 dark:text-red-400">{invalidMsg}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button className={btn} onClick={onClose}>取消</button>
          <button className={btnPri} disabled={!!invalidMsg} onClick={save}>保存</button>
        </div>
      </div>
    </Modal>
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
            <select className={`${selectCls} w-full mt-1`} value={f.scope} onChange={e => set('scope', e.target.value)}>
              <option value="token_api">令牌×API（单 API 分令牌）</option>
              <option value="api">API 总量（保护上游）</option>
              <option value="token">令牌全局</option>
              <option value="global">全局</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">算法</span>
            <select className={`${selectCls} w-full mt-1`} value={f.algorithm} onChange={e => set('algorithm', e.target.value)}>
              <option value="token_bucket">令牌桶（速率，允许突发）</option>
              <option value="fixed_window">固定窗口（长周期配额）</option>
            </select>
          </label>
        </div>
        {['token_api', 'api'].includes(f.scope) && (
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">API</span>
            <select className={`${selectCls} w-full mt-1`} value={f.api_id || ''} onChange={e => set('api_id', e.target.value)}>
              <option value="">选择 API…</option>
              {apis.map(a => <option key={a.id} value={a.id}>{a.name}（{a.slug}）</option>)}
            </select>
          </label>
        )}
        {['token_api', 'token'].includes(f.scope) && (
          <label className="block">
            <span className="text-xs text-stone-500 dark:text-stone-400">平台令牌</span>
            <select className={`${selectCls} w-full mt-1`} value={f.token_id || ''} onChange={e => set('token_id', e.target.value)}>
              <option value="">选择令牌…</option>
              {tokens.map(t => <option key={t.id} value={t.id}>{t.name}（{t.key_hint}）</option>)}
            </select>
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
        <select className={selectCls} value={apiId} onChange={e => setApiId(e.target.value)}>
          <option value="">全部 API</option>
          {apis.map(a => <option key={a.id} value={a.id}>{a.slug}</option>)}
        </select>
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
              <th className="px-2 py-2 font-normal">API/上游</th>
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
                  {apis.find(a => a.id === l.api_id)?.slug || (l.upstream_id ? `up#${l.upstream_id}` : '-')}
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
