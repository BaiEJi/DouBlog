/**
 * 统一登录页 `/login`：全站唯一登录入口。
 * 登录成功签发会话 Cookie（HttpOnly，30 天），之后所有模块免再登录；
 * 支持 ?next=<path> 登录后回跳。分享页（/diary/s/*）与登录页本身无需登录。
 */
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { API_BASE } from '../shared/client'

const INPUT = 'w-full px-3 py-2 rounded-lg border text-sm ' +
  'border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.04] ' +
  'text-stone-900 dark:text-stone-100 outline-none focus:border-black/30 dark:focus:border-white/30 ' +
  'placeholder:text-stone-400 dark:placeholder:text-stone-500 transition-colors'

export default function LoginPage({ dark, setDark }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const next = params.get('next') || '/'
  // next=/login（历史脏 URL，如 /login?next=%2Flogin）会导致"登录成功又回到登录页"，兜底回门户
  const safeNext = next.startsWith('/') && !next.startsWith('//') && next !== '/login' ? next : '/'

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr('')
    try {
      const r = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      })
      const body = await r.json().catch(() => ({}))
      if (r.ok && body.success) {
        navigate(safeNext, { replace: true })
        return
      }
      setErr(body.message || (r.status === 401 ? '用户名或密码不正确' : `登录失败(${r.status})`))
    } catch {
      setErr('无法连接后端服务，请确认服务已启动')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-[#100f0e] flex items-center justify-center p-6 transition-colors">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between mb-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-400">DouBlog</p>
          <button onClick={setDark} title="切换主题"
            className="w-9 h-9 rounded-xl border border-black/[0.08] dark:border-white/[0.1] text-stone-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors">
            {dark ? (
              <svg className="w-4 h-4 mx-auto" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="3.4" stroke="currentColor" strokeWidth="1.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            ) : (
              <svg className="w-4 h-4 mx-auto" viewBox="0 0 20 20" fill="none"><path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5 6.8 6.8 0 1 0 15.5 12.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
            )}
          </button>
        </div>

        <div className="rounded-3xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-8">
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100 tracking-tight">登录</h1>
          <p className="mt-1.5 text-[12.5px] text-stone-400 leading-relaxed">
            登录一次即可访问全部模块——博客、日记、订阅、密码库、日志与配置
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5">用户名</label>
              <input className={INPUT} value={username} autoComplete="username"
                onChange={e => setUsername(e.target.value)} placeholder="用户名" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5">密码</label>
              <input className={INPUT} type="password" value={password} autoComplete="current-password"
                onChange={e => setPassword(e.target.value)} placeholder="密码" />
            </div>

            {err && (
              <div className="rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-600 dark:text-red-400 break-all">{err}</div>
            )}

            <button type="submit" disabled={busy || !username || !password}
              className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90 transition-opacity disabled:bg-stone-400 dark:disabled:bg-stone-500 disabled:cursor-not-allowed">
              {busy ? '登录中…' : '登 录'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-[11.5px] text-stone-400 dark:text-stone-500">
          单用户系统 · 会话 30 天有效 · 可随时在门户登出
        </p>
      </div>
    </div>
  )
}
