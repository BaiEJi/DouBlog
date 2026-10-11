import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { BackButton } from '../../shared/PageHeader'
import { fetchDbStatus, testDbConnection, switchDatabase, fetchExportZip, fetchLoggingConfig, saveLoggingConfig, testLoggingSend } from '@/blog/api'

// ─── 小组件 ──────────────────────────────────────────────

function Badge({ backend }) {
  const isPg = backend === 'postgres'
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
      ${isPg ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {isPg ? 'PostgreSQL' : 'SQLite'}
    </span>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-[#666] dark:text-[#999]">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="px-3 h-10 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#111]
          text-[#111] dark:text-[#eee] outline-none focus:border-blue-400 transition-colors"
      />
    </label>
  )
}

// ─── 管理页 ──────────────────────────────────────────────

export default function AdminPage({ dark, setDark }) {
  const [status, setStatus] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportDone, setExportDone] = useState(false)

  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    setExportDone(false)
    try {
      const blob = await fetchExportZip()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const d = new Date()
      const pad = n => String(n).padStart(2, '0')
      a.href = url
      a.download = `doublog-export-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      setExportDone(true)
    } catch (e) {
      console.error(e)
      alert('导出失败：' + (e.message || e))
    } finally {
      setExporting(false)
    }
  }

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // PostgreSQL 连接表单（从后端配置预填）
  const [pg, setPg] = useState({ host: '', port: 5432, user: 'postgres', password: '', dbname: 'doublog' })
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [switchMsg, setSwitchMsg] = useState(null)      // {type: 'ok'|'error'|'reload', text}

  const reloadStatus = () => {
    setLoading(true)
    fetchDbStatus()
      .then(d => {
        if (d.success) {
          setStatus(d.data)
          if (d.data.postgres) {
            setPg(prev => ({ ...prev, ...d.data.postgres }))
          }
        } else setError(d.message || '加载失败')
      })
      .catch(e => setError(`无法连接后端：${e.message}`))
      .finally(() => setLoading(false))
  }

  useEffect(reloadStatus, [])

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const d = await testDbConnection({ target: 'postgres', postgres: pg })
      setTestResult(d)
    } catch (e) {
      setTestResult({ success: false, message: e.message })
    } finally {
      setTesting(false)
    }
  }

  const doSwitch = async (target) => {
    setSwitching(true)
    setSwitchMsg(null)
    try {
      const payload = { target }
      if (target === 'postgres') payload.postgres = pg
      const d = await switchDatabase(payload)

      if (d.success) {
        setSwitchMsg({
          type: d.data.restart_required ? 'ok' : 'reload',
          text: d.data.restart_required
            ? '已切换连接。请重启后端服务后读取新数据库的数据。'
            : '已切换连接。后端正在自动重启，3 秒后刷新页面。',
        })
        if (!d.data.restart_required) setTimeout(() => window.location.reload(), 3000)
      } else {
        setSwitchMsg({ type: 'error', text: d.message || '切换失败' })
      }
    } catch (e) {
      setSwitchMsg({ type: 'error', text: e.message })
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 animate-fade-in">
      {/* 顶栏 */}
      <nav className="sticky top-0 z-50 bg-stone-50 dark:bg-[#141312] backdrop-blur-xl border-b border-black/5 dark:border-white/5">
        <div className="mx-auto w-full max-w-[1700px] px-4 sm:px-6 xl:px-10 h-12 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <BackButton />
            <Link to="/blog" className="flex items-center gap-2 group">
              <div className="w-7 h-7 rounded-lg bg-[#111] dark:bg-[#eee] flex items-center justify-center">
                <span className="text-white dark:text-[#111] text-[12px] font-bold">D</span>
              </div>
              <span className="font-semibold text-[15px] tracking-tight">系统管理</span>
            </Link>
          </div>
          <button
            onClick={() => setDark && setDark(!dark)}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-stone-400"
            aria-label="切换主题"
          >
            {dark ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
            )}
          </button>
        </div>
      </nav>

      <main className="max-w-[1700px] mx-auto px-4 sm:px-6 xl:px-10 py-6 space-y-6">
        {loading && <div className="text-center text-[#999] py-20">加载中…</div>}
        {error && <div className="rounded-lg px-3 py-2 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-[13px]">{error}</div>}

        {status && (
          <>
            {/* 当前数据库 */}
            <section className="p-6 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold">当前数据库</h2>
                <Badge backend={status.backend} />
              </div>
              <dl className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <dt className="text-[#999] dark:text-[#666] mb-1">文章</dt>
                  <dd className="text-xl font-semibold tabular-nums">{status.counts.posts}</dd>
                </div>
                <div>
                  <dt className="text-[#999] dark:text-[#666] mb-1">操作日志</dt>
                  <dd className="text-xl font-semibold tabular-nums">{status.counts.audit_logs}</dd>
                </div>
                <div>
                  <dt className="text-[#999] dark:text-[#666] mb-1">数据目录</dt>
                  <dd className="text-xs font-mono mt-2 break-all text-[#666] dark:text-[#999]">{status.data_dir}</dd>
                </div>
              </dl>
              <div className="mt-5 pt-5 border-t border-black/5 dark:border-white/5 flex items-center gap-3">
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="px-4 h-9 rounded-lg border border-black/10 dark:border-white/15 text-stone-600 dark:text-stone-300 text-sm font-medium
                    hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  {exporting ? '导出中…' : '导出 Markdown 备份 (.zip)'}
                </button>
                {exportDone && <span className="text-sm text-green-600 dark:text-green-400">已下载</span>}
                <span className="text-[12px] text-[#999] dark:text-[#666]">全部知识库 → Markdown 文件 + 图片，可用于备份或迁移到 Obsidian 等工具</span>
              </div>
            </section>

            {/* 切换到 PostgreSQL */}
            {status.backend === 'sqlite' && (
              <section className="p-6 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]">
                <h2 className="text-base font-semibold mb-1">切换到 PostgreSQL</h2>
                <p className="text-sm text-[#999] dark:text-[#666] mb-5">
                  直接切换到 PostgreSQL 连接并读取其现有数据（空库会自动初始化，不迁移数据；本地 SQLite 数据保持原样，随时可切回）。
                </p>
                <div className="grid grid-cols-2 gap-4 mb-5">
                  <Field label="主机" value={pg.host} onChange={v => setPg(p => ({ ...p, host: v }))} placeholder="localhost" />
                  <Field label="端口" value={pg.port} onChange={v => setPg(p => ({ ...p, port: v }))} placeholder="5432" />
                  <Field label="用户名" value={pg.user} onChange={v => setPg(p => ({ ...p, user: v }))} />
                  <Field label="密码" type="password" value={pg.password} onChange={v => setPg(p => ({ ...p, password: v }))} />
                  <Field label="数据库名" value={pg.dbname} onChange={v => setPg(p => ({ ...p, dbname: v }))} placeholder="doublog" />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleTest}
                    disabled={testing}
                    className="px-4 h-10 rounded-lg border border-black/10 dark:border-white/10 text-sm
                      hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                  >
                    {testing ? '测试中…' : '测试连接'}
                  </button>
                  <button
                    onClick={() => doSwitch('postgres')}
                    disabled={switching}
                    className="px-4 h-10 rounded-lg bg-amber-500/90 hover:bg-amber-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {switching ? '切换中…' : '切换并连接'}
                  </button>
                  {testResult && (
                    <span className={`text-sm ${testResult.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {testResult.success ? (testResult.data?.message || '连接成功') : testResult.message}
                    </span>
                  )}
                </div>
              </section>
            )}

            {/* 切回 SQLite */}
            {status.backend === 'postgres' && (
              <section className="p-6 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]">
                <h2 className="text-base font-semibold mb-1">切回 SQLite</h2>
                <p className="text-sm text-[#999] dark:text-[#666] mb-5">
                  切回本地 SQLite 文件并读取其原有数据（PostgreSQL 侧数据保持原样，不做任何改动）。
                </p>
                <button
                  onClick={() => doSwitch('sqlite')}
                  disabled={switching}
                  className="px-4 h-10 rounded-lg bg-[#111] dark:bg-[#eee] text-white dark:text-[#111] text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {switching ? '切换中…' : '切回 SQLite'}
                </button>
              </section>
            )}

            {/* 切换结果 / 覆盖确认 */}
            {switchMsg && (
              <div className={`rounded-lg px-3 py-2 text-[13px] whitespace-pre-line ${
                switchMsg.type === 'error'
                  ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'}`}>
                {switchMsg.text}
              </div>
            )}
          </>
        )}

        {/* 日志上报配置 */}
        <LoggingCard />
      </main>
    </div>
  )
}


/* ─── 日志上报配置卡片：每模块 sys_name + 服务地址/开关/级别 ─── */
function LoggingCard() {
  const [cfg, setCfg] = useState(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = async () => {
    const d = await fetchLoggingConfig()
    if (d.success) { setCfg(d.data); setUrl(d.data.url) }
  }
  useEffect(() => { load() }, [])

  const save = async (patch) => {
    setBusy(true); setMsg('')
    const d = await saveLoggingConfig(patch)
    setBusy(false)
    if (d.success) { setCfg(d.data); setUrl(d.data.url); setMsg('已保存并生效') }
    else setMsg(d.message || '保存失败')
    setTimeout(() => setMsg(''), 2500)
  }

  const test = async () => {
    const d = await testLoggingSend()
    if (d.success) setMsg(`已发送测试日志（marker=${d.data.marker}），到日志查询页搜索验证`)
    else setMsg(d.message || '发送失败')
  }

  if (!cfg) return null
  return (
    <section className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5">
      <h3 className="text-sm font-semibold mb-1">日志上报</h3>
      <p className="text-[12px] text-stone-400 mb-4">
        各模块日志（WARNING 起）按标准 HTTP 发送到日志查询模块；按 sys_name 区分模块。
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <button onClick={() => save({ enabled: !cfg.enabled })}
          className={'relative w-11 h-6 rounded-full transition-colors ' + (cfg.enabled ? 'bg-amber-500' : 'bg-black/15 dark:bg-white/15')}>
          <span className={'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ' + (cfg.enabled ? 'left-[22px]' : 'left-0.5')} />
        </button>
        <span className="text-[13px]">{cfg.enabled ? '已启用上报' : '已停用（仅本地落盘）'}</span>

        <div className="flex items-center gap-1.5 ml-2">
          <span className="text-[12px] text-stone-400">外发级别</span>
          {['WARNING', 'INFO'].map(lv => (
            <button key={lv} onClick={() => save({ level: lv })} disabled={busy}
              className={'px-2.5 h-7 rounded-lg text-[11.5px] border transition-colors ' +
                (cfg.level === lv ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium'
                  : 'border-black/[0.08] dark:border-white/[0.1] text-stone-500')}>
              {lv === 'WARNING' ? 'WARNING+' : 'INFO+'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        <input value={url} onChange={e => setUrl(e.target.value)} spellCheck={false}
          placeholder="http://host:60100/api/v1/logs"
          className="flex-1 h-9 px-3 text-[12.5px] font-mono bg-black/[0.02] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.1] rounded-lg outline-none focus:border-amber-500/50" />
        <button onClick={() => save({ url })} disabled={busy || url === cfg.url}
          className="px-4 h-9 rounded-lg bg-stone-800 dark:bg-stone-100 text-white dark:text-stone-900 text-[12.5px] font-medium disabled:opacity-40">
          保存
        </button>
        <button onClick={test} disabled={!cfg.enabled}
          className="px-3 h-9 rounded-lg text-[12.5px] text-stone-500 border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40">
          发测试
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(cfg.modules || []).map(m => (
          <span key={m.module} className="px-2 h-6 rounded-full bg-black/[0.035] dark:bg-white/[0.05] text-[11px] text-stone-500 font-mono">
            {m.sys_name}
          </span>
        ))}
      </div>
      {msg && <p className="text-[11.5px] text-amber-600 dark:text-amber-400 mt-2.5">{msg}</p>}
    </section>
  )
}
