/**
 * Clash 代理管理页 /clash：clashctl 全能力 + mihomo Web 控制台（zashboard）核心能力的 Web 迁移。
 *
 * 七个视图（PageHeader tabs → ModuleShell 侧栏）：
 * - 总览：内核启停 / 系统代理 / Tun / 控制台地址 / 密钥 / 升级 + 运行时配置（模式/局域网）+ 实时流量
 * - 代理：策略组 / 节点切换 / 连通性测速（单节点 + 整组）——ProxiesView
 * - 连接：活跃连接 / 断开单条或全部 / 实时速率——ConnectionsView
 * - 规则：runtime 规则链检索——RulesView
 * - 订阅：clashctl 订阅管理 + Provider 热更新
 * - 配置：Mixin 可编辑（保存即合并重启）；base / runtime 只读
 * - 日志：内核日志尾部 + 实时日志开关（log-level）
 * 未安装 clashctl 时整页空态（门户卡片同时置灰）。个性色 sky（docs/ui-baseline.md）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import PageHeader from '../shared/PageHeader'
import {
  clashAvailability, clashStatus, clashOn, clashOff,
  clashProxy, clashProxySet, clashTun, clashTunSet,
  clashUi, clashSecret, clashSecretSet, clashUpgrade,
  clashConfig, clashConfigSave, clashLog, clashLogLevel,
  clashSubs, clashSubAction, clashSubLog,
  clashCtlConfigs, clashCtlConfigsPatch, clashCtlConnections, clashCtlProviders,
  clashCtlProviderUpdate,
} from './api'
import { card, inputCls, btn, btnPri, btnDanger, LBL, MONO_BLOCK, Toast, StateBadge, fmtBytes } from './kit'
import ProxiesView from './ProxiesView'
import ConnectionsView from './ConnectionsView'
import RulesView from './RulesView'

// ─── 总览视图 ─────────────────────────────────────────────

const MODES = [
  { key: 'rule', label: '规则' },
  { key: 'global', label: '全局' },
  { key: 'direct', label: '直连' },
]

function RuntimeConfigCard({ toast }) {
  const [cfg, setCfg] = useState(null)
  const [busy, setBusy] = useState('')

  const refresh = useCallback(async (quiet = false) => {
    try {
      setCfg(await clashCtlConfigs())
    } catch (e) {
      if (!quiet) toast({ msg: e.message, kind: 'error' })
    }
  }, [toast])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    const t = setInterval(() => refresh(true), 15000)
    return () => clearInterval(t)
  }, [refresh])

  const patch = async body => {
    setBusy('cfg')
    try {
      setCfg(await clashCtlConfigsPatch(body))
      toast({ msg: '运行时配置已热切换' })
    } catch (e) {
      toast({ msg: e.message, kind: 'error' })
    } finally {
      setBusy('')
    }
  }

  const mode = cfg?.mode
  return (
    <div className={`${card} p-5`}>
      <h3 className="text-sm font-semibold mb-0.5">运行配置</h3>
      <p className="text-xs text-stone-400 mb-3">热切换即时生效，不重启内核（控制器 PATCH）</p>
      {cfg == null ? (
        <p className="text-[13px] text-stone-400 py-2">加载中…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className={LBL}>出站模式</span>
            <div className="flex p-0.5 rounded-lg bg-black/[0.05] dark:bg-white/[0.07]">
              {MODES.map(m => (
                <button key={m.key} disabled={!!busy}
                  className={'px-3 py-1.5 rounded-md text-[13px] transition-colors ' +
                    (mode === m.key
                      ? 'bg-white dark:bg-white/[0.14] text-stone-900 dark:text-stone-100 font-medium shadow-sm'
                      : 'text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200')}
                  onClick={() => patch({ mode: m.key })}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm">允许局域网</p>
              <p className="text-[11.5px] text-stone-400 dark:text-stone-500">mixed-port {cfg['mixed-port'] || '—'} · {cfg['bind-address'] || '*'}</p>
            </div>
            <button className={cfg['allow-lan'] ? btnDanger : btn} disabled={!!busy}
              onClick={() => patch({ allow_lan: !cfg['allow-lan'] })}>
              {cfg['allow-lan'] ? '已开启（点此关闭）' : '已关闭（点此开启）'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function TrafficCard({ toast }) {
  const [stat, setStat] = useState(null)
  const [speed, setSpeed] = useState({ up: 0, down: 0 })
  const prev = useRef(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const d = await clashCtlConnections()
        if (!alive) return
        const now = Date.now()
        if (prev.current) {
          const dt = (now - prev.current.t) / 1000
          if (dt > 0) setSpeed({
            up: Math.max(0, (d.uploadTotal - prev.current.up) / dt),
            down: Math.max(0, (d.downloadTotal - prev.current.down) / dt),
          })
        }
        prev.current = { t: now, up: d.uploadTotal, down: d.downloadTotal }
        setStat({ up: d.uploadTotal, down: d.downloadTotal, n: (d.connections || []).length })
      } catch { /* 内核未运行时静默 */ }
    }
    tick()
    const timer = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  return (
    <div className={`${card} p-5`}>
      <h3 className="text-sm font-semibold mb-0.5">实时流量</h3>
      <p className="text-xs text-stone-400 mb-3">本内核会话累计 · {stat ? `${stat.n} 条活跃连接` : '…'}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className={LBL}>↑ 上行</p>
          <p className="text-lg font-semibold tabular-nums">{fmtBytes(speed.up)}/s</p>
          <p className="text-[11.5px] text-stone-400 dark:text-stone-500">累计 {fmtBytes(stat?.up)}</p>
        </div>
        <div>
          <p className={LBL}>↓ 下行</p>
          <p className="text-lg font-semibold tabular-nums">{fmtBytes(speed.down)}/s</p>
          <p className="text-[11.5px] text-stone-400 dark:text-stone-500">累计 {fmtBytes(stat?.down)}</p>
        </div>
      </div>
    </div>
  )
}

function OverviewView({ toast, unavailable }) {
  const [status, setStatus] = useState(null)         // {running, output}
  const [proxy, setProxy] = useState(null)           // {enabled, output}
  const [tun, setTun] = useState(null)
  const [ui, setUi] = useState(null)
  const [secret, setSecret] = useState('')
  const [secretDraft, setSecretDraft] = useState('')
  const [busy, setBusy] = useState('')
  const [channel, setChannel] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [s, p, t, u, sec] = await Promise.all([
        clashStatus(), clashProxy(), clashTun(), clashUi(), clashSecret(),
      ])
      setStatus(s); setProxy(p); setTun(t); setUi(u)
      setSecret(sec?.secret || '')
    } catch (e) {
      toast({ msg: e.message, kind: 'error' })
    }
  }, [toast])

  useEffect(() => { if (!unavailable) refresh() }, [unavailable, refresh])

  const act = async (name, fn, okMsg) => {
    setBusy(name)
    try {
      const data = await fn()
      const lines = (data?.output || '').split('\n').map(l => l.trim()).filter(Boolean)
      const cat = lines.find(l => l.startsWith('😼') || l.startsWith('😾'))
      toast({ msg: okMsg || cat || lines[lines.length - 1] || '执行成功' })
      await refresh()
    } catch (e) {
      toast({ msg: e.message, kind: 'error' })
    } finally {
      setBusy('')
    }
  }

  const saveSecret = () => {
    if (!secretDraft.trim()) { toast({ msg: '密钥不能为空', kind: 'error' }); return }
    act('secret', () => clashSecretSet(secretDraft.trim()), '😼 密钥更新成功，已重启生效')
    setSecretDraft('')
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 内核 */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">代理内核</h3>
            <p className="text-xs text-stone-400 mt-0.5">clashon / clashoff —— 启停内核并同步系统代理</p>
          </div>
          <StateBadge on={!!status?.running} loading={!status} />
        </div>
        <div className="flex gap-2 mb-3">
          <button className={status?.running ? btn : btnPri} disabled={!!busy || !!status?.running}
            onClick={() => act('on', clashOn, '😼 已开启代理环境')}>
            {busy === 'on' ? '启动中…' : '开启代理'}
          </button>
          <button className={btnDanger} disabled={!!busy || status?.running === false}
            onClick={() => act('off', clashOff, '😼 已关闭代理环境')}>
            {busy === 'off' ? '停止中…' : '关闭代理'}
          </button>
        </div>
        {status?.output && <pre className={MONO_BLOCK}>{status.output}</pre>}
      </div>

      {/* 系统代理 + Tun */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-semibold mb-0.5">系统代理 / Tun 模式</h3>
        <p className="text-xs text-stone-400 mb-3">clashproxy / clashtun —— 环境代理开关与全局路由</p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <StateBadge on={!!proxy?.enabled} loading={!proxy} onText="系统代理已开启" offText="系统代理已关闭" />
            <button className={proxy?.enabled ? btnDanger : btnPri} disabled={!!busy || !proxy}
              onClick={() => act('proxy', () => clashProxySet(!proxy.enabled))}>
              {busy === 'proxy' ? '切换中…' : (proxy?.enabled ? '关闭系统代理' : '开启系统代理')}
            </button>
          </div>
          <div className="flex items-center justify-between">
            <StateBadge on={!!tun?.enabled} loading={!tun} onText="Tun 已启用" offText="Tun 已关闭" />
            <button className={tun?.enabled ? btnDanger : btnPri} disabled={!!busy || !tun}
              onClick={() => act('tun', () => clashTunSet(!tun.enabled))}>
              {busy === 'tun' ? '切换中…' : (tun?.enabled ? '关闭 Tun' : '开启 Tun')}
            </button>
          </div>
          <p className="text-[11.5px] text-stone-400 dark:text-stone-500">Tun 需 sudo 权限重启内核，无免密 sudo 时会失败并回显原因</p>
        </div>
      </div>

      {/* 运行配置（模式 / 局域网）+ 实时流量 */}
      <RuntimeConfigCard toast={toast} />
      <TrafficCard toast={toast} />

      {/* Web 控制台 */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">Web 控制台（原始）</h3>
            <p className="text-xs text-stone-400 mt-0.5">clashctl ui —— zashboard 面板地址（本页已内置其核心能力）</p>
          </div>
          <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-sky-500/10 text-sky-700 dark:text-sky-300">ui</span>
        </div>
        <pre className={MONO_BLOCK}>{ui?.output || '加载中…'}</pre>
      </div>

      {/* 密钥 + 升级 */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-semibold mb-0.5">Web 密钥 · 内核升级</h3>
        <p className="text-xs text-stone-400 mb-3">clashsecret / clashupgrade</p>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className={LBL}>当前密钥</span>
          <code className="font-mono text-xs px-2 py-1 rounded-md bg-black/[0.04] dark:bg-white/[0.06] text-stone-700 dark:text-stone-200">{secret || '（空）'}</code>
        </div>
        <div className="flex flex-wrap gap-2 mb-5">
          <input className={inputCls + ' flex-1 min-w-44'} placeholder="输入新密钥（不含空格/引号）"
            value={secretDraft} onChange={e => setSecretDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveSecret() }} />
          <button className={btn} disabled={!!busy || !secretDraft.trim()} onClick={saveSecret}>修改密钥</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={inputCls} value={channel} onChange={e => setChannel(e.target.value)}
            aria-label="升级通道">
            <option value="">默认通道</option>
            <option value="release">稳定版</option>
            <option value="alpha">测试版</option>
          </select>
          <button className={btn} disabled={!!busy}
            onClick={() => act('upgrade', () => clashUpgrade(channel), null)}>
            {busy === 'upgrade' ? '升级中…' : '升级内核'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 订阅视图 ─────────────────────────────────────────────

function SubsView({ toast, unavailable }) {
  const [subs, setSubs] = useState(null)             // {use, profiles}
  const [log, setLog] = useState(null)
  const [url, setUrl] = useState('')
  const [convert, setConvert] = useState(false)
  const [busy, setBusy] = useState('')
  const [delConfirm, setDelConfirm] = useState(null) // 待二次确认的订阅 id
  const [providers, setProviders] = useState(null)
  const [provBusy, setProvBusy] = useState('')

  const refresh = useCallback(async () => {
    try {
      setSubs(await clashSubs())
    } catch (e) {
      toast({ msg: e.message, kind: 'error' })
    }
  }, [toast])

  const refreshLog = useCallback(async () => {
    try { setLog(await clashSubLog(200)) } catch { /* 日志缺失不阻塞页面 */ }
  }, [])

  const refreshProviders = useCallback(async (quiet = false) => {
    try {
      setProviders(await clashCtlProviders())
    } catch (e) {
      if (!quiet && providers == null) { /* 控制器不可达时折叠该区块，不打扰订阅管理 */ }
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!unavailable) { refresh(); refreshLog(); refreshProviders() }
  }, [unavailable, refresh, refreshLog, refreshProviders])

  const act = async (name, fn) => {
    setBusy(name)
    try {
      const data = await fn()
      const lines = (data?.output || '').split('\n').map(l => l.trim()).filter(Boolean)
      const cat = lines.find(l => l.startsWith('😼') || l.startsWith('😾'))
      toast({ msg: cat || lines[lines.length - 1] || '执行成功' })
      await refresh()
    } catch (e) {
      toast({ msg: e.message, kind: 'error' })
    } finally {
      setBusy('')
    }
  }

  const add = () => {
    const u = url.trim()
    if (!u) { toast({ msg: '请输入订阅链接', kind: 'error' }); return }
    act('add', () => clashSubAction({ action: 'add', url: u }))
    setUrl('')
  }

  const doDel = id => act(`del-${id}`, () => clashSubAction({ action: 'del', id }))

  const updateProvider = async name => {
    setProvBusy(name)
    try {
      const d = await clashCtlProviderUpdate(name)
      setProviders(d)
      toast({ msg: '😼 节点池已热更新（未重启内核）' })
    } catch (e) {
      toast({ msg: e.message, kind: 'error' })
    } finally {
      setProvBusy('')
    }
  }

  const profiles = subs?.profiles || []
  const current = subs?.use
  const httpProviders = (providers?.providers || []).filter(p => p.vehicleType === 'HTTP')

  return (
    <div className="space-y-4">
      {/* 添加订阅 */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-semibold mb-0.5">添加订阅</h3>
        <p className="text-xs text-stone-400 mb-3">clashsub add —— 支持 http(s):// 与 file:// 本地订阅（下载直连）</p>
        <div className="flex flex-wrap gap-2">
          <input className={inputCls + ' flex-1 min-w-64'} placeholder="https://…（含特殊字符时无需引号，直接粘贴）"
            value={url} onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }} />
          <button className={btnPri} disabled={!!busy || !url.trim()} onClick={add}>
            {busy === 'add' ? '添加中…' : '添加'}
          </button>
        </div>
      </div>

      {/* 订阅列表 */}
      <div className={card}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.06]">
          <div>
            <h3 className="text-sm font-semibold">订阅列表</h3>
            <p className="text-xs text-stone-400 mt-0.5">use 切换后自动合并重启内核</p>
          </div>
          <button className={btn} disabled={!!busy}
            onClick={() => act('update-cur', () => clashSubAction({ action: 'update', convert }))}>
            {busy === 'update-cur' ? '更新中…' : `更新当前订阅${convert ? '（转换）' : ''}`}
          </button>
        </div>
        <label className="flex items-center gap-2 px-5 py-2.5 text-xs text-stone-500 dark:text-stone-400 border-b border-black/[0.06] dark:border-white/[0.06] cursor-pointer">
          <input type="checkbox" className="accent-sky-600" checked={convert}
            onChange={e => setConvert(e.target.checked)} />
          更新与添加时使用订阅转换（subconverter，clashsub update --convert）
        </label>
        {profiles.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-stone-400">暂无订阅——添加第一条订阅链接</div>
        ) : (
          <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            {profiles.map(p => (
              <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
                <span className="font-mono text-xs text-stone-500 dark:text-stone-400 tabular-nums w-6 shrink-0">#{p.id}</span>
                {current === p.id ? (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-sky-500/10 text-sky-700 dark:text-sky-300 shrink-0">使用中</span>
                ) : (
                  <span className="w-[52px] shrink-0" />
                )}
                <span className="flex-1 min-w-0 truncate font-mono text-xs text-stone-600 dark:text-stone-300" title={p.url}>{p.url}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {current !== p.id && (
                    <button className="px-3 py-1.5 text-xs font-medium rounded-lg bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50"
                      disabled={!!busy} onClick={() => act(`use-${p.id}`, () => clashSubAction({ action: 'use', id: p.id }))}>
                      {busy === `use-${p.id}` ? '切换中…' : '使用'}
                    </button>
                  )}
                  <button className="px-3 py-1.5 text-xs font-medium rounded-lg bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50"
                    disabled={!!busy} onClick={() => act(`update-${p.id}`, () => clashSubAction({ action: 'update', id: p.id, convert }))}>
                    {busy === `update-${p.id}` ? '更新中…' : '更新'}
                  </button>
                  {delConfirm === p.id ? (
                    <span className="flex items-center gap-1.5">
                      <button className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors"
                        onClick={() => { doDel(p.id); setDelConfirm(null) }}>确认删除</button>
                      <button className="px-2 py-1.5 text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                        onClick={() => setDelConfirm(null)}>取消</button>
                    </span>
                  ) : (
                    <button className="px-3 py-1.5 text-xs font-medium rounded-lg text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                      disabled={!!busy} onClick={() => { setDelConfirm(p.id); setTimeout(() => setDelConfirm(c => c === p.id ? null : c), 3500) }}>
                      删除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between px-5 py-3 border-t border-black/[0.06] dark:border-white/[0.06]">
          <p className="text-[11.5px] text-stone-400 dark:text-stone-500">删除使用中的订阅会被 clashctl 拒绝；自动更新依赖 crontab</p>
          <button className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors disabled:opacity-50"
            disabled={!!busy} onClick={() => act('auto', () => clashSubAction({ action: 'update', auto: true }))}>
            {busy === 'auto' ? '配置中…' : '配置自动更新（每 2 天）'}
          </button>
        </div>
      </div>

      {/* 节点池 Provider（热更新） */}
      {httpProviders.length > 0 && (
        <div className={card}>
          <div className="px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.06]">
            <h3 className="text-sm font-semibold">节点池热更新</h3>
            <p className="text-xs text-stone-400 mt-0.5">控制器 Provider——拉取订阅新节点即时生效，不重启内核</p>
          </div>
          <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            {httpProviders.map(p => (
              <div key={p.name} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3">
                <span className="font-mono text-xs text-stone-600 dark:text-stone-300 truncate">{p.name}</span>
                <span className="text-xs text-stone-400">{p.proxies.length} 节点 · 更新于 {p.updatedAt || '—'}</span>
                <span className="flex-1" />
                <button className="px-3 py-1.5 text-xs font-medium rounded-lg bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50"
                  disabled={!!provBusy} onClick={() => updateProvider(p.name)}>
                  {provBusy === p.name ? '更新中…' : '热更新'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 订阅日志 */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">订阅日志</h3>
            <p className="text-xs text-stone-400 mt-0.5">clashsub log —— 添加 / 切换 / 更新记录</p>
          </div>
          <button className={btn} onClick={refreshLog}>刷新</button>
        </div>
        <pre className={MONO_BLOCK}>{log?.content || '（暂无日志）'}</pre>
      </div>
    </div>
  )
}

// ─── 配置视图 ─────────────────────────────────────────────

const CONFIG_TABS = [
  { key: 'mixin', label: 'Mixin（可编辑）' },
  { key: 'base', label: '原始订阅（只读）' },
  { key: 'runtime', label: '运行时（只读）' },
]

function ConfigView({ toast, unavailable }) {
  const [file, setFile] = useState('mixin')
  const [data, setData] = useState(null)             // {content, editable, path}
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async which => {
    setBusy(true)
    try {
      const d = await clashConfig(which)
      setData(d); setDraft(d.content); setDirty(false)
    } catch (e) {
      toast({ msg: e.message, kind: 'error' })
    } finally {
      setBusy(false)
    }
  }, [toast])

  useEffect(() => { if (!unavailable) load(file) }, [unavailable, file, load])

  const save = async () => {
    setBusy(true)
    try {
      await clashConfigSave(draft)
      setDirty(false)
      toast({ msg: '😼 配置更新成功，已重启生效' })
      await load(file)
    } catch (e) {
      toast({ msg: e.message, kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const editable = data?.editable && file === 'mixin'
  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.06]">
        <div className="flex items-center gap-1.5">
          {CONFIG_TABS.map(t => (
            <button key={t.key}
              className={'px-3 py-1.5 rounded-lg text-[13px] transition-colors ' +
                (file === t.key
                  ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300 font-medium'
                  : 'text-stone-500 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]')}
              onClick={() => setFile(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        {editable && (
          <button className={btnPri} disabled={busy || !dirty} onClick={save}>
            {busy ? '保存中…' : dirty ? '保存并重启内核' : '已保存'}
          </button>
        )}
      </div>
      <div className="p-5">
        {data && <p className={LBL + ' mb-2'}>{data.path}{editable && dirty ? ' · 有未保存修改' : ''}</p>}
        <textarea
          className="w-full h-[60vh] font-mono text-[12.5px] leading-relaxed p-4 rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] text-stone-700 dark:text-stone-200 outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors resize-y"
          spellCheck={false}
          value={draft}
          readOnly={!editable}
          onChange={e => { setDraft(e.target.value); setDirty(true) }}
          placeholder={busy ? '加载中…' : ''} />
        <p className="text-[11.5px] text-stone-400 dark:text-stone-500 mt-2">
          {editable
            ? 'Mixin 与原始订阅深度合并且优先级最高，保存后自动合并并重启内核（等价 clashmixin -e）'
            : '此文件由 clashctl 生成/管理，仅支持查看'}
        </p>
      </div>
    </div>
  )
}

// ─── 内核日志视图 ─────────────────────────────────────────

function LogView({ toast, unavailable }) {
  const [lines, setLines] = useState(200)
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [auto, setAuto] = useState(false)
  const [levelBusy, setLevelBusy] = useState(false)
  const timer = useRef(null)

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setBusy(true)
    try {
      setData(await clashLog(lines))
    } catch (e) {
      if (!quiet) toast({ msg: e.message, kind: 'error' })
    } finally {
      setBusy(false)
    }
  }, [lines, toast])

  useEffect(() => { if (!unavailable) refresh() }, [unavailable])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (auto && !unavailable) timer.current = setInterval(() => refresh(true), 5000)
    return () => clearInterval(timer.current)
  }, [auto, unavailable, refresh])

  // 实时日志 = 内核级别非 silent（订阅配置常带 silent，日志文件不再增长）
  const level = data?.level || 'info'
  const live = level !== 'silent'

  const toggleLive = async () => {
    setLevelBusy(true)
    try {
      const next = live ? 'silent' : 'info'
      await clashLogLevel(next)
      toast({ msg: `😼 日志级别已切换为 ${next}，已重启生效` })
      await refresh()
      if (next === 'silent') setAuto(false)
    } catch (e) {
      toast({ msg: e.message, kind: 'error' })
    } finally {
      setLevelBusy(false)
    }
  }

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.06]">
        <div>
          <h3 className="text-sm font-semibold">内核日志</h3>
          <p className="text-xs text-stone-400 mt-0.5">
            {data?.path || 'mihomo.log'} · 尾部 {lines} 行
            {!live && ' · 内核静默中（log-level: silent），开启实时后才有新日志'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={live ? btnDanger : btnPri} disabled={levelBusy || !data}
            onClick={toggleLive}>
            {levelBusy ? '切换中…' : (live ? '关闭实时（silent）' : '开启实时日志（info）')}
          </button>
          <label className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 cursor-pointer">
            <input type="checkbox" className="accent-sky-600" checked={auto}
              disabled={!live}
              onChange={e => setAuto(e.target.checked)} />
            5s 自动刷新
          </label>
          <select className={inputCls} value={lines} onChange={e => setLines(Number(e.target.value))}
            aria-label="日志行数">
            {[100, 200, 500, 1000, 2000].map(n => <option key={n} value={n}>{n} 行</option>)}
          </select>
          <button className={btn} disabled={busy} onClick={() => refresh()}>{busy ? '刷新中…' : '刷新'}</button>
        </div>
      </div>
      <div className="p-5">
        <pre className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all text-stone-600 dark:text-stone-300 bg-black/[0.02] dark:bg-white/[0.03] rounded-lg p-3 border border-black/[0.05] dark:border-white/[0.06] max-h-[70vh] overflow-y-auto">
          {data?.content || '（暂无日志）'}
        </pre>
      </div>
    </div>
  )
}

// ─── 页面壳 ───────────────────────────────────────────────

const TABS = [
  { key: 'overview', label: '总览' },
  { key: 'proxies', label: '代理' },
  { key: 'connections', label: '连接' },
  { key: 'rules', label: '规则' },
  { key: 'subs', label: '订阅' },
  { key: 'config', label: '配置' },
  { key: 'log', label: '日志' },
]

export default function ClashPage() {
  const [tab, setTab] = useState('overview')
  const [avail, setAvail] = useState(null)           // {available, base_dir, kernel}
  const [toastData, setToastData] = useState(null)
  const timer = useRef(null)

  const toast = useCallback(t => {
    setToastData({ ...t, onDismiss: () => setToastData(null) })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToastData(null), 3200)
  }, [])

  useEffect(() => {
    clashAvailability()
      .then(setAvail)
      .catch(e => setAvail({ available: false, base_dir: '', kernel: '', error: e.message }))
  }, [])

  const unavailable = avail && !avail.available

  return (
    <div>
      <PageHeader title="Clash 代理" subtitle="内核启停 · 代理组与测速 · 订阅 · 连接与规则"
        tabs={TABS} activeTab={tab} onTabChange={setTab} accent="sky" hideTitle />
      {avail === null ? (
        <div className="px-6 py-16 text-center text-sm text-stone-400">检测 clashctl 安装状态…</div>
      ) : unavailable ? (
        <div className={`${card} px-6 py-16 text-center`}>
          <div className="text-4xl mb-3 grayscale opacity-60">😼</div>
          <h2 className="text-base font-semibold mb-1.5">clashctl 未安装</h2>
          <p className="text-[13px] text-stone-500 dark:text-stone-400">
            未找到 clashctl 安装目录{avail.base_dir ? `（${avail.base_dir}）` : ''}，安装后本页功能自动可用
          </p>
        </div>
      ) : (
        <>
          {tab === 'overview' && <OverviewView toast={toast} unavailable={unavailable} />}
          {tab === 'proxies' && <ProxiesView toast={toast} unavailable={unavailable} />}
          {tab === 'connections' && <ConnectionsView toast={toast} unavailable={unavailable} />}
          {tab === 'rules' && <RulesView toast={toast} unavailable={unavailable} />}
          {tab === 'subs' && <SubsView toast={toast} unavailable={unavailable} />}
          {tab === 'config' && <ConfigView toast={toast} unavailable={unavailable} />}
          {tab === 'log' && <LogView toast={toast} unavailable={unavailable} />}
        </>
      )}
      <Toast t={toastData} />
    </div>
  )
}
