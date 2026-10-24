/**
 * 登录卡（源版逻辑照搬）：账密表单 → begin → 3s 轮询 attempt 状态机 →
 * 手机 App 确认（device confirmation）/ 令牌验证码 / 邮箱验证码 → 成功回调 onSuccess。
 * 样式换 Tailwind（ui-baseline 档位）；主按钮用模块个性色 rose 实底。
 */
import { useState } from 'react'
import usePolling from '../../shared/usePolling'
import { api } from '../api.js'
import { Field, inputCls } from '../../shared/ui/kit'

const GUARD_DEVICE_CONFIRMATION = 4
const GUARD_DEVICE_CODE = 3
const GUARD_EMAIL_CODE = 2

const btnPlain = 'px-4 h-9 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] ' +
  'hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors shrink-0'
const errCls = 'mt-3 rounded-lg px-3 py-2 text-[13px] bg-red-500/10 text-red-600 dark:text-red-400 leading-relaxed'

export default function LoginCard({ onSuccess }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(null) // {attempt_id, allowed, ...}
  const [code, setCode] = useState('')
  const [codeMsg, setCodeMsg] = useState('')
  const [watchId, setWatchId] = useState(null)
  const watchAttempt = setWatchId
  usePolling(async ({ signal }) => {
    const status = await api.loginStatus(watchId, { signal })
    if (signal.aborted) return
    setAttempt(previous => previous ? { ...previous, ...status } : previous)
    if (status.state === 'success') {
      setWatchId(null); setBusy(false); setPassword(''); onSuccess(status.account)
    } else if (status.state === 'failed' || status.state === 'timeout') {
      setWatchId(null); setBusy(false); setError(status.error || '登录超时，请重试'); setAttempt(null)
    }
  }, { intervalMs: 3000, enabled: !!watchId, immediate: false,
    onError: error => setError(`状态查询失败：${error.message}`) })

  const handleBegin = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setBusy(true); setError(''); setAttempt(null); setCodeMsg('')
    try {
      const st = await api.loginBegin(username.trim(), password)
      setAttempt(st)
      if (st.state === 'failed') {
        setError(st.error || '登录失败')
        setAttempt(null); setBusy(false)
      } else {
        watchAttempt(st.attempt_id)
      }
    } catch (err) {
      setError(err.message); setBusy(false)
    }
  }

  const handleSubmitCode = async (codeType) => {
    if (!attempt || !code.trim()) return
    setCodeMsg('正在验证...')
    try {
      const st = await api.loginCode(attempt.attempt_id, code.trim(), codeType)
      setAttempt({ ...attempt, ...st })
      if (st.state === 'failed') {
        setCodeMsg('')
        setError(st.error || '验证失败')
        setAttempt(null); setBusy(false)
      } else {
        setCodeMsg('已提交，等待 Steam 确认...')
        watchAttempt(attempt.attempt_id)
      }
    } catch (err) {
      setCodeMsg('')
      setError(err.message)
    }
  }

  const cancelAttempt = () => {
    setWatchId(null)
    setAttempt(null); setBusy(false); setError('')
  }

  const allowedTypes = (attempt?.allowed || []).map((c) => c.confirmation_type)
  const needDeviceConfirm = allowedTypes.includes(GUARD_DEVICE_CONFIRMATION)
  const needDeviceCode = allowedTypes.includes(GUARD_DEVICE_CODE)
  const needEmailCode = allowedTypes.includes(GUARD_EMAIL_CODE)
  const waitingConfirm = attempt && (attempt.state === 'polling' || attempt.state === 'pending')

  if (waitingConfirm) {
    return (
      <div className="max-w-md mx-auto rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5">
        <h2 className="text-sm font-semibold">登录 {username}</h2>
        {attempt.retryable && <p role="status" className={errCls}>{attempt.error}</p>}
        <div className="mt-3 rounded-xl border border-dashed border-black/[0.15] dark:border-white/[0.15] bg-black/[0.02] dark:bg-white/[0.03] p-4 text-sm leading-relaxed space-y-2.5">
          {needDeviceConfirm && (
            <div className="flex items-start gap-2">
              <span className="mt-1.5 w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
              <span>请在手机 Steam App 中确认本次登录（会显示设备 <b className="font-medium">steam-idler</b>）</span>
            </div>
          )}
          {needDeviceCode && <div>需要令牌验证码（Steam 令牌 App 中的 5 位代码）</div>}
          {needEmailCode && <div>需要邮箱验证码（Steam 发送到邮箱的代码）</div>}
          {(needDeviceCode || needEmailCode) && (
            <div className="flex gap-2 pt-1">
              <input
                className={inputCls}
                placeholder={needEmailCode && !needDeviceCode ? '邮箱验证码' : '令牌验证码'}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitCode(needDeviceCode ? GUARD_DEVICE_CODE : GUARD_EMAIL_CODE)}
                autoFocus
              />
              <button className={btnPlain}
                onClick={() => handleSubmitCode(needDeviceCode ? GUARD_DEVICE_CODE : GUARD_EMAIL_CODE)}>
                验证
              </button>
            </div>
          )}
          {codeMsg && <div className="text-xs text-rose-600 dark:text-rose-400">{codeMsg}</div>}
          <div>
            <button
              className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 underline underline-offset-2 transition-colors"
              onClick={cancelAttempt}>
              取消并返回
            </button>
          </div>
        </div>
        {error && <div className={errCls}>{error}</div>}
      </div>
    )
  }

  return (
    <form
      className="max-w-md mx-auto rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-5"
      onSubmit={handleBegin}>
      <h2 className="text-sm font-semibold">添加 Steam 账号</h2>
      <p className="mt-1 mb-4 text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
        使用 Steam 账号密码登录，支持手机 App 确认 / 令牌验证码 / 邮箱验证码。
        密码不会被保存，登录成功后只保留长期令牌（refresh token）用于自动重连。
      </p>
      <div className="space-y-3">
        <Field label="账号">
          <input
            className={inputCls}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Steam 用户名"
            autoComplete="username"
          />
        </Field>
        <Field label="密码">
          <input
            className={inputCls}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Steam 密码"
            autoComplete="current-password"
          />
        </Field>
      </div>
      <button
        type="submit"
        disabled={busy || !username.trim() || !password}
        className="mt-4 w-full px-4 h-9 rounded-lg text-sm font-medium bg-rose-500 text-white hover:bg-rose-600 transition-colors disabled:opacity-50">
        {busy ? '登录中...' : '登 录'}
      </button>
      {error && <div className={errCls}>{error}</div>}
    </form>
  )
}
