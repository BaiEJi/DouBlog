/** JWT 解码：header/payload 展开 + exp/iat/nbf 时间人性化 + 有效期状态（不验签） */
import { useEffect, useMemo, useState } from 'react'
import { ToolHead, CopyBtn, inputCls, card, LBL } from '../kit'
import { b64Decode, fromB64Url } from '../lib/misc'

const SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuW4puW4zkRvdUJsb2ciLCJpcm9sZSI6ImFkbWluIiwiaWF0IjoxNzYwMDAwMDAwLCJleHAiOjE5MDAwMDAwMDB9.7dS3vJ0xE2rF8kQ9mZ1pL4wY6cB2nH8dA5tR1uX9oKc'

function fmtTs(ts) {
  if (ts == null) return null
  const d = new Date(ts * 1000)
  if (isNaN(d)) return null
  return d
}

function relTime(d, nowMs) {
  const diff = (d.getTime() - nowMs) / 1000
  const abs = Math.abs(diff)
  const unit = abs < 60 ? [abs, '秒'] : abs < 3600 ? [abs / 60, '分钟'] : abs < 86400 ? [abs / 3600, '小时'] : [abs / 86400, '天']
  return `${diff >= 0 ? '' : '已过去 '}${Math.round(unit[0])} ${unit[1]}${diff >= 0 ? '后' : ''}`
}

const TIME_CLAIMS = { exp: '过期时间', iat: '签发时间', nbf: '生效时间' }

export default function JwtTool() {
  const [token, setToken] = useState(SAMPLE)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  const decoded = useMemo(() => {
    const t = token.trim()
    if (!t) return null
    const parts = t.split('.')
    if (parts.length < 2 || parts.length > 3) return { error: 'JWT 应为 header.payload.signature 三段（至少两段）' }
    try {
      const header = JSON.parse(b64Decode(fromB64Url(parts[0])))
      const payload = JSON.parse(b64Decode(fromB64Url(parts[1])))
      return { header, payload, signature: parts[2] || '(无签名)', parts }
    } catch {
      return { error: 'Base64url 解码或 JSON 解析失败——检查 token 是否完整' }
    }
  }, [token])

  const expState = useMemo(() => {
    if (!decoded?.payload?.exp) return null
    const d = fmtTs(decoded.payload.exp)
    if (!d) return null
    return { d, valid: d.getTime() > now, expiring: d.getTime() - now < 86400 * 7 * 1000 }
  }, [decoded, now])

  return (
    <div>
      <ToolHead title="JWT 解码" desc="展开 header / payload 与时间声明（exp/iat/nbf）；不校验签名，仅用于调试" />
      <textarea className={inputCls + ' w-full font-mono text-[12.5px] leading-relaxed resize-y min-h-16'} rows={3} value={token} spellCheck={false}
        onChange={e => setToken(e.target.value)} placeholder="粘贴 JWT（eyJ...）" aria-label="JWT token" />
      {decoded?.error && <p className="mt-2 text-[13px] text-red-600 dark:text-red-400">✗ {decoded.error}</p>}
      {decoded?.header && (
        <>
          {expState && (
            <div className={'mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] font-medium ' +
              (expState.valid
                ? expState.expiring
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-red-500/10 text-red-600 dark:text-red-400')}>
              {expState.valid ? '● 有效' : '● 已过期'} · {expState.d.toLocaleString()} （{relTime(expState.d, now)}）
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold">Header</span>
                <CopyBtn text={JSON.stringify(decoded.header, null, 2)} />
              </div>
              <pre className="font-mono text-[12.5px] leading-relaxed text-stone-700 dark:text-stone-200 bg-black/[0.02] dark:bg-white/[0.03] rounded-lg p-3 border border-black/[0.05] dark:border-white/[0.06] overflow-x-auto">{JSON.stringify(decoded.header, null, 2)}</pre>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold">Payload</span>
                <CopyBtn text={JSON.stringify(decoded.payload, null, 2)} />
              </div>
              <pre className="font-mono text-[12.5px] leading-relaxed text-stone-700 dark:text-stone-200 bg-black/[0.02] dark:bg-white/[0.03] rounded-lg p-3 border border-black/[0.05] dark:border-white/[0.06] overflow-x-auto">{JSON.stringify(decoded.payload, null, 2)}</pre>
            </div>
          </div>
          <div className={'mt-3 ' + card + ' p-4'}>
            <p className="text-sm font-semibold mb-2">时间声明</p>
            {Object.entries(TIME_CLAIMS).map(([k, label]) => {
              const v = decoded.payload?.[k]
              if (v == null) return null
              const d = fmtTs(v)
              return (
                <div key={k} className="flex flex-wrap items-baseline gap-2 py-1 text-[13px]">
                  <code className="font-mono text-[12.5px] text-stone-600 dark:text-stone-300">{k}</code>
                  <span className="text-stone-400">{label}</span>
                  <span className="tabular-nums">{d ? d.toLocaleString() : `（原始值 ${v}）`}</span>
                  {d && <span className="text-stone-400">{relTime(d, now)}</span>}
                </div>
              )
            })}
            {!Object.keys(TIME_CLAIMS).some(k => decoded.payload?.[k] != null) && <p className={LBL + ' text-[13px]'}>payload 无时间声明。</p>}
            <p className={'mt-2 pt-2 border-t border-black/[0.05] dark:border-white/[0.06] font-mono text-[11.5px] text-stone-400 break-all'}>signature: {decoded.signature}</p>
          </div>
        </>
      )}
      {!token.trim() && <p className="mt-3 text-[13px] text-stone-400">粘贴 JWT 后自动解码。</p>}
    </div>
  )
}
