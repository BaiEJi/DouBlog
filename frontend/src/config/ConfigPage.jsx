/**
 * 系统配置页 `/config`：全站唯一总配置入口。
 * - 数据库：所有模块共用的数据库后端（本地 SQLite / 远端 PostgreSQL 一键切换，
 *   切换只换连接读目标库现有数据，两侧互不影响）
 * - 日志上报：lizysdk 日志管道的外发开关/地址/级别
 * - 登录账号：用户名/密码管理（system_accounts 表，PBKDF2 哈希，改密需验旧密码）
 */
import { useCallback, useEffect, useState } from 'react'
import PageHeader from '../shared/PageHeader'
import {
  fetchAccount, fetchDbStatus, testDbConnection, switchDatabase, updateAccount,
  fetchLoggingConfig, saveLoggingConfig, testLoggingSend,
} from './api'

const CARD = 'rounded-2xl border border-black/[0.07] dark:border-white/[0.07] ' +
  'bg-white dark:bg-white/[0.025] p-6'

const INPUT = 'w-full px-3 py-2 rounded-lg border text-sm ' +
  'border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.04] ' +
  'text-stone-900 dark:text-stone-100 outline-none focus:border-black/30 dark:focus:border-white/30'

const LABEL = 'block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5'

const BTN = 'px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

function Banner({ tone, children }) {
  if (!children) return null
  const cls = tone === 'ok'
    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    : tone === 'err'
      ? 'bg-red-500/10 text-red-600 dark:text-red-400'
      : 'bg-sky-500/10 text-sky-700 dark:text-sky-400'
  return <div className={`${cls} rounded-lg px-3 py-2 text-[13px] break-all`}>{children}</div>
}

function DbCard() {
  const [status, setStatus] = useState(null)
  const [pg, setPg] = useState({ host: 'localhost', port: 5432, user: 'postgres', password: '', dbname: 'doublog' })
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)   // {tone, text}

  const load = useCallback(async () => {
    try {
      const d = await fetchDbStatus()
      setStatus(d)
      if (d.postgres) setPg(p => ({ ...p, ...d.postgres, password: p.password }))
    } catch (e) {
      setMsg({ tone: 'err', text: `读取状态失败：${e.message}` })
    }
  }, [])

  useEffect(() => { load() }, [load])

  const isPg = status?.backend === 'postgres'

  async function onTest() {
    setBusy('test'); setMsg(null)
    try {
      const d = await testDbConnection({ target: 'postgres', postgres: pg })
      setMsg({ tone: 'ok', text: d.message })
    } catch (e) {
      setMsg({ tone: 'err', text: e.message })
    } finally { setBusy('') }
  }

  async function onSwitch(target) {
    if (!window.confirm(target === 'postgres'
      ? '切换到 PostgreSQL？将直接读取目标库现有数据（空库自动建表播种），两侧数据互不影响。'
      : '切换回本地 SQLite？将读取本地库现有数据。')) return
    setBusy('switch'); setMsg(null)
    try {
      const d = await switchDatabase(target === 'postgres' ? { target: 'postgres', postgres: pg } : { target: 'sqlite' })
      setMsg({
        tone: 'ok',
        text: d.restart_required
          ? `已切换到 ${d.backend}。生产模式需手动重启后端生效。`
          : `已切换到 ${d.backend}，后端正在自动重启（约 2-3 秒）…`,
      })
      setTimeout(load, 3500)
    } catch (e) {
      setMsg({ tone: 'err', text: e.message })
    } finally { setBusy('') }
  }

  return (
    <section className={CARD}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">数据库</h2>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
            所有模块共用同一份数据库配置（data/db_config.json）
          </p>
        </div>
        {status && (
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
            isPg ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                 : 'bg-stone-500/10 text-stone-600 dark:text-stone-300'}`}>
            {isPg ? 'PostgreSQL（远端）' : 'SQLite（本地）'}
          </span>
        )}
      </div>

      {status && (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5 text-sm">
          <div><dt className="text-xs text-stone-500 dark:text-stone-400">文章数</dt>
            <dd className="font-medium text-stone-900 dark:text-stone-100">{status.counts?.posts ?? '-'}</dd></div>
          <div><dt className="text-xs text-stone-500 dark:text-stone-400">审计日志</dt>
            <dd className="font-medium text-stone-900 dark:text-stone-100">{status.counts?.audit_logs ?? '-'}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-stone-500 dark:text-stone-400">连接</dt>
            <dd className="font-mono text-xs mt-0.5 text-stone-700 dark:text-stone-300 break-all">
              {status.database_url_masked || '-'}
            </dd></div>
        </dl>
      )}

      <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] p-4 mb-4">
        <p className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-3">PostgreSQL 连接参数（切换目标）</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div><label className={LABEL}>主机</label>
            <input className={INPUT} value={pg.host} onChange={e => setPg({ ...pg, host: e.target.value })} /></div>
          <div><label className={LABEL}>端口</label>
            <input className={INPUT} type="number" value={pg.port}
              onChange={e => setPg({ ...pg, port: +e.target.value || 5432 })} /></div>
          <div><label className={LABEL}>库名</label>
            <input className={INPUT} value={pg.dbname} onChange={e => setPg({ ...pg, dbname: e.target.value })} /></div>
          <div><label className={LABEL}>用户</label>
            <input className={INPUT} value={pg.user} onChange={e => setPg({ ...pg, user: e.target.value })} /></div>
          <div className="col-span-2"><label className={LABEL}>密码</label>
            <input className={INPUT} type="password" value={pg.password} placeholder="留空使用已存密码"
              onChange={e => setPg({ ...pg, password: e.target.value })} /></div>
        </div>
      </div>

      <Banner tone={msg?.tone}>{msg?.text}</Banner>

      <div className="flex flex-wrap gap-2.5 mt-4">
        <button className={`${BTN} bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] text-stone-800 dark:text-stone-100`}
          disabled={busy !== ''} onClick={onTest}>
          {busy === 'test' ? '测试中…' : '测试连接'}
        </button>
        <button className={`${BTN} ${isPg
            ? 'bg-black/[0.06] dark:bg-white/[0.08] text-stone-500 dark:text-stone-400 cursor-not-allowed'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
          disabled={busy !== '' || isPg} onClick={() => onSwitch('postgres')}>
          {busy === 'switch' ? '切换中…' : '一键切换到 PostgreSQL'}
        </button>
        <button className={`${BTN} ${!isPg
            ? 'bg-black/[0.06] dark:bg-white/[0.08] text-stone-500 dark:text-stone-400 cursor-not-allowed'
            : 'bg-stone-800 hover:bg-stone-700 text-white'}`}
          disabled={busy !== '' || !isPg} onClick={() => onSwitch('sqlite')}>
          一键切换回 SQLite
        </button>
      </div>
    </section>
  )
}

function LoggingCard() {
  const [cfg, setCfg] = useState({ enabled: false, url: '', level: 'WARNING' })
  const [modules, setModules] = useState([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    fetchLoggingConfig()
      .then(d => { setCfg({ enabled: d.enabled, url: d.url, level: d.level }); setModules(d.modules || []) })
      .catch(e => setMsg({ tone: 'err', text: e.message }))
  }, [])

  async function onSave() {
    setBusy('save'); setMsg(null)
    try {
      const d = await saveLoggingConfig({
        enabled: cfg.enabled, url: cfg.url, level: cfg.level,
      })
      setMsg({ tone: 'ok', text: '已保存并即时生效' })
      setCfg(c => ({ ...c, enabled: d.enabled, url: d.url, level: d.level }))
    } catch (e) {
      setMsg({ tone: 'err', text: e.message })
    } finally { setBusy('') }
  }

  async function onTest() {
    setBusy('test'); setMsg(null)
    try {
      const d = await testLoggingSend()
      setMsg({ tone: 'ok', text: `已发送测试日志（marker: ${d.marker}）——到 /logs 页搜索 marker 验证链路` })
    } catch (e) {
      setMsg({ tone: 'err', text: e.message })
    } finally { setBusy('') }
  }

  return (
    <section className={CARD}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">日志上报</h2>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
            各模块 lizysdk 日志（sys_name=doublog.&lt;module&gt;）外发配置，即时生效
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input type="checkbox" className="accent-stone-700 dark:accent-stone-300 w-4 h-4"
            checked={cfg.enabled} onChange={e => setCfg({ ...cfg, enabled: e.target.checked })} />
          <span className="text-stone-700 dark:text-stone-300">外发启用</span>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="sm:col-span-2"><label className={LABEL}>服务地址</label>
          <input className={INPUT} value={cfg.url} placeholder="http://127.0.0.1:60100/api/v1/logs"
            onChange={e => setCfg({ ...cfg, url: e.target.value })} /></div>
        <div><label className={LABEL}>外发最低级别</label>
          <select className={INPUT} value={cfg.level} onChange={e => setCfg({ ...cfg, level: e.target.value })}>
            <option value="WARNING">WARNING 及以上</option>
            <option value="INFO">INFO 及以上</option>
          </select></div>
      </div>

      {modules.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {modules.map(m => (
            <span key={m.module}
              className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-black/[0.04] dark:bg-white/[0.06] text-stone-500 dark:text-stone-400">
              {m.sys_name}
            </span>
          ))}
        </div>
      )}

      <Banner tone={msg?.tone}>{msg?.text}</Banner>

      <div className="flex flex-wrap gap-2.5 mt-4">
        <button className={`${BTN} bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] text-stone-800 dark:text-stone-100`}
          disabled={busy !== ''} onClick={onSave}>
          {busy === 'save' ? '保存中…' : '保存'}
        </button>
        <button className={`${BTN} bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] text-stone-800 dark:text-stone-100`}
          disabled={busy !== ''} onClick={onTest}>
          {busy === 'test' ? '发送中…' : '发送测试日志'}
        </button>
      </div>
    </section>
  )
}

function AccountCard() {
  const [cur, setCur] = useState(null)
  const [form, setForm] = useState({ username: '', new_password: '', old_password: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    fetchAccount()
      .then(d => setCur(d))
      .catch(e => setMsg({ tone: 'err', text: e.message }))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const canSubmit = !busy && form.old_password && (form.username || form.new_password)

  async function onSave() {
    setBusy(true); setMsg(null)
    try {
      const payload = { old_password: form.old_password }
      if (form.username) payload.username = form.username.trim()
      if (form.new_password) payload.new_password = form.new_password
      const d = await updateAccount(payload)
      setCur(d)
      setForm({ username: '', new_password: '', old_password: '' })
      setMsg({ tone: 'ok', text: '已保存，即刻生效（curl/脚本请改用新凭据；已登录的浏览器会话不受影响）' })
    } catch (e) {
      setMsg({ tone: 'err', text: e.message })
    } finally { setBusy(false) }
  }

  return (
    <section className={CARD}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">登录账号</h2>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
            当前用户名 <span className="font-mono">{cur?.username ?? '…'}</span>
            ——凭据存数据库（仅哈希落库），改密需验证旧密码
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className={LABEL}>新用户名（留空不改，3-64 位字母数字_-）</span>
          <input className={INPUT} value={form.username} placeholder={cur?.username || 'admin'}
                 onChange={e => set('username', e.target.value)} />
        </label>
        <label className="block">
          <span className={LABEL}>新密码（留空不改，≥8 位）</span>
          <input className={INPUT} type="password" value={form.new_password}
                 onChange={e => set('new_password', e.target.value)} />
        </label>
        <label className="block">
          <span className={LABEL}>旧密码（必填）</span>
          <input className={INPUT} type="password" value={form.old_password}
                 onChange={e => set('old_password', e.target.value)} />
        </label>
      </div>
      <div className="flex items-center justify-between gap-3 mt-4">
        <Banner tone={msg?.tone}>{msg?.text}</Banner>
        <button onClick={onSave} disabled={!canSubmit}
          className={`${BTN} bg-amber-500 hover:bg-amber-600 text-white ml-auto shrink-0`}>
          {busy ? '保存中…' : '保存变更'}
        </button>
      </div>
    </section>
  )
}

export default function ConfigPage() {
  return (
    <div className="min-h-0 bg-stone-50 dark:bg-[#100f0e]">
      <PageHeader title="系统配置" subtitle="数据库一键切换 · 日志上报"  />


      <main className="w-full max-w-full mx-auto p-0 grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <DbCard />
        <LoggingCard />
        <AccountCard />
      </main>
    </div>
  )
}
