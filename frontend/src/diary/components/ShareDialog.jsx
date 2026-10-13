/**
 * 分享弹层：选有效期 → 创建链接（一键复制）→ 可撤销。
 */
import { useEffect, useState } from 'react'
import { diaryShare, diaryRevokeShare } from '../api'

const OPTIONS = [
  { h: 24, label: '1 天' },
  { h: 24 * 7, label: '7 天' },
  { h: 24 * 30, label: '30 天' },
  { h: 24 * 365, label: '一年' },
]

export default function ShareDialog({ entry, onClose }) {
  const [hours, setHours] = useState(24 * 7)
  const [token, setToken] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [revoked, setRevoked] = useState(false)

  const create = async () => {
    setBusy(true)
    const d = await diaryShare(entry.id, hours)
    setBusy(false)
    if (d.success) { setToken(d.data.token); setRevoked(false) }
  }
  const url = token ? `${location.origin}/diary/s/${token}` : ''

  useEffect(() => {
    if (entry.share) create()
  }, [])

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md p-5 rounded-2xl bg-white dark:bg-[#1c1b1a] shadow-xl animate-dropdown"
        role="dialog" aria-modal="true" aria-label="分享日记" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 mb-1"><h3 className="text-base font-semibold">分享日记</h3><button type="button" onClick={onClose} aria-label="关闭分享弹窗" className="w-8 h-8 rounded-lg text-stone-500 hover:bg-black/5 dark:hover:bg-white/10">×</button></div>
        <p className="text-xs text-stone-400 mb-4">
          生成免登录只读链接（{entry.entry_date}）——任何拿到链接的人都能读到这一篇，注意内容隐私。
        </p>

        {!token ? (
          <>
            <div className="flex gap-1.5 mb-4">
              {OPTIONS.map(o => (
                <button key={o.h} onClick={() => setHours(o.h)}
                  className={'flex-1 h-9 rounded-lg text-sm border transition-colors ' +
                    (hours === o.h
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium'
                      : 'border-black/10 dark:border-white/10 text-stone-500 hover:border-black/20 dark:hover:border-white/25')}>
                  {o.label}
                </button>
              ))}
            </div>
            <button onClick={create} disabled={busy}
              className="w-full h-10 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90 text-sm font-medium disabled:opacity-40">
              {busy ? '生成中…' : '生成分享链接'}
            </button>
          </>
        ) : revoked ? (
          <p className="text-sm text-stone-400 py-4 text-center">链接已撤销</p>
        ) : (
          <>
            <div className="flex gap-1.5 mb-3">
              <input readOnly value={url} onFocus={e => e.target.select()}
                className="flex-1 h-9 px-3 text-xs font-mono bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-lg outline-none text-stone-600 dark:text-stone-300" />
              <button
                onClick={async () => {
                  try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { }
                }}
                className="px-3 h-9 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-medium">
                {copied ? '已复制 ✓' : '复制'}
              </button>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={async () => { await diaryRevokeShare(entry.id); setRevoked(true); }}
                className="px-3 h-8 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20">
                撤销链接
              </button>
              <button onClick={onClose}
                className="px-3 h-8 rounded-lg text-xs font-medium text-stone-700 dark:text-stone-200 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14]">
                完成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
