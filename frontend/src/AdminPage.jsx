import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchDbStatus, testDbConnection, switchDatabase, fetchExportZip } from './api'

// ─── 小组件 ──────────────────────────────────────────────

function Badge({ backend }) {
  const isPg = backend === 'postgres'
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium
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
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] text-[#111] dark:text-[#eee] animate-fade-in">
      {/* 顶栏 */}
      <nav className="sticky top-0 z-50 bg-[#fafafa]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-black/5 dark:border-white/5">
        <div className="w-full px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-xl bg-[#111] dark:bg-[#eee] flex items-center justify-center transition-transform group-hover:scale-105">
                <span className="text-white dark:text-[#111] text-sm font-bold">D</span>
              </div>
              <span className="font-semibold text-lg tracking-tight">系统管理</span>
            </Link>
            <Link to="/" className="text-sm text-[#666] dark:text-[#999] hover:text-[#111] dark:hover:text-[#eee] transition-colors">
              ← 返回首页
            </Link>
          </div>
          <button
            onClick={() => setDark && setDark(!dark)}
            className="w-9 h-9 rounded-xl border border-black/10 dark:border-white/10 flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            aria-label="切换主题"
          >
            {dark ? '☀️' : '🌙'}
          </button>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-8 py-10 space-y-6">
        {loading && <div className="text-center text-[#999] py-20">加载中…</div>}
        {error && <div className="p-4 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm">{error}</div>}

        {status && (
          <>
            {/* 当前数据库 */}
            <section className="p-6 rounded-2xl border border-black/5 dark:border-white/10 bg-white dark:bg-[#111]">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold">当前数据库</h2>
                <Badge backend={status.backend} />
              </div>
              <dl className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <dt className="text-[#999] dark:text-[#666] mb-1">文章</dt>
                  <dd className="text-xl font-semibold">{status.counts.posts}</dd>
                </div>
                <div>
                  <dt className="text-[#999] dark:text-[#666] mb-1">操作日志</dt>
                  <dd className="text-xl font-semibold">{status.counts.audit_logs}</dd>
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
                  className="px-4 h-10 rounded-lg bg-[#111] dark:bg-[#eee] text-white dark:text-[#111] text-sm font-medium
                    hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {exporting ? '导出中…' : '导出 Markdown 备份 (.zip)'}
                </button>
                {exportDone && <span className="text-sm text-green-600 dark:text-green-400">已下载</span>}
                <span className="text-[12px] text-[#999] dark:text-[#666]">全部知识库 → Markdown 文件 + 图片，可用于备份或迁移到 Obsidian 等工具</span>
              </div>
            </section>

            {/* 切换到 PostgreSQL */}
            {status.backend === 'sqlite' && (
              <section className="p-6 rounded-2xl border border-black/5 dark:border-white/10 bg-white dark:bg-[#111]">
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
                    className="px-4 h-10 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
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
              <section className="p-6 rounded-2xl border border-black/5 dark:border-white/10 bg-white dark:bg-[#111]">
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
              <div className={`p-4 rounded-xl text-sm whitespace-pre-line ${
                switchMsg.type === 'error'
                  ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'}`}>
                {switchMsg.text}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
