/**
 * Vault 条目详情（右栏）：LOGIN / TOTP / IDENTITIES / SECRETS / SECURITY /
 * 附件 / PASSWORD HISTORY / NOTES / CUSTOM FIELDS。密文默认隐藏，Reveal 15s 自动隐藏。
 */
import { useMemo, useEffect, useState, useRef } from 'react'
import md from '@/shared/md'
import {
  passwordEntropy, strengthLabel, daysAgo, usageDays, domainOf, expiryInfo,
  TYPE_LABELS, CATEGORY_LABELS, SECRET_KIND_LABELS, METHOD_LABELS,
} from './core'
import { totpNow, parseOtpauth } from './totp'
import { encryptBlob, decryptBlob } from './crypto'
import { vaultListAttachments, vaultAddAttachment, vaultDeleteAttachment } from '../api'
import { SecretField, FieldRow, CopyButton, Favicon, I } from './ui'

function Section({ title, children }) {
  if (!children) return null
  return (
    <section className="pt-5 mt-5 border-t border-black/[0.06] dark:border-white/[0.06] first:border-0 first:mt-0 first:pt-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500 mb-2.5">{title}</h3>
      {children}
    </section>
  )
}

/** Notes 渲染（memo 化 prop，避免无关重渲染整体重建 DOM） */
function NotesView({ text }) {
  const props = useMemo(() => ({ __html: md.render(text) }), [text])
  return <div className="prose-content text-sm text-stone-700 dark:text-stone-200 max-w-none" dangerouslySetInnerHTML={props} />
}

/** TOTP 验证码显示：大号数字 + 30s 环形倒计时 + 一键复制（密钥不出内存） */
function TotpDisplay({ secret, copier, digits, period }) {
  const [state, setState] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let alive = true
    let timer
    const tick = async () => {
      try {
        const r = await totpNow(secret, { digits, period })
        if (alive) { setState(r); timer = setTimeout(tick, (r.remaining > 1 ? (r.remaining - 1) * 1000 : 250)) }
      } catch {
        if (alive) setErr(true)
      }
    }
    tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [secret, digits, period])

  if (err) return null
  if (!state) return null
  const R = 13
  const C = 2 * Math.PI * R
  const frac = state.remaining / state.period
  const urgent = state.remaining <= 5
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-[24px] font-mono font-semibold tabular-nums tracking-[0.08em] text-stone-800 dark:text-stone-100">
        {state.code.slice(0, 3)} {state.code.slice(3)}
      </span>
      <svg className="shrink-0 -rotate-90" width="34" height="34" viewBox="0 0 34 34">
        <circle cx="17" cy="17" r={R} className="stroke-black/[0.08] dark:stroke-white/10" strokeWidth="3" fill="none" />
        <circle cx="17" cy="17" r={R} className={urgent ? 'stroke-red-500' : 'stroke-emerald-500'}
          strokeWidth="3" fill="none" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 0.9s linear' }} />
      </svg>
      <span className={'text-[11px] tabular-nums ' + (urgent ? 'text-red-500' : 'text-stone-400')}>{state.remaining}s</span>
      <CopyButton value={state.code} copier={copier} />
    </div>
  )
}

/** 安全附件区：上传（VEK 加密→密文上传）/ 下载（密文→解密→Blob）/ 删除 */
function Attachments({ item, vek, copier }) {
  const [rows, setRows] = useState(null)      // [{meta, attachment}]，meta=解密后 {filename, mime, data}
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)
  const MAX = 5 * 1024 * 1024

  const reload = async () => {
    const d = await vaultListAttachments(item.id).catch(() => null)
    if (!d?.success) { setRows([]); return }
    const out = []
    for (const a of d.data) {
      try {
        const meta = await decryptBlob(vek, a.blob)
        out.push({ a, meta })
      } catch {
        out.push({ a, meta: { filename: '（无法解密）', mime: '', data: '' } })
      }
    }
    setRows(out)
  }

  useEffect(() => { if (vek && !item.deleted_at) reload(); else setRows([]) }, [item.id, vek])

  const upload = async file => {
    if (!file) return
    setErr('')
    if (file.size > MAX) { setErr(`文件超过 5MB 上限（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）`); return }
    setBusy(true)
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000))
      const b64 = btoa(bin)
      const blob = await encryptBlob(vek, { filename: file.name, mime: file.type || 'application/octet-stream', data: b64 })
      const d = await vaultAddAttachment(item.id, { blob, size: file.size })
      if (!d.success) setErr(d.message || '上传失败')
      else await reload()
    } catch (e) {
      setErr('加密/上传失败：' + (e?.message || String(e)))
    }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const download = async row => {
    try {
      const { filename, mime, data } = row.meta
      const bin = atob(data)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
      const a = document.createElement('a')
      a.href = url
      a.download = filename || 'attachment'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setErr('下载/解密失败')
    }
  }

  const remove = async row => {
    if (!window.confirm(`删除附件「${row.meta.filename}」？不可恢复。`)) return
    const d = await vaultDeleteAttachment(row.a.id).catch(() => null)
    if (d?.success) reload()
  }

  const fmtSize = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`

  return (
    <Section title={`安全附件（${rows?.length ?? 0}）`}>
      {!rows ? <p className="text-[12px] text-stone-400">加载中…</p> : (
        <>
          {rows.map(row => (
            <div key={row.a.id} className="flex items-center gap-2 py-1.5">
              <span className="w-4 h-4 shrink-0 text-stone-400">{I.paperclip || '📎'}</span>
              <span className="text-sm truncate flex-1" title={row.meta.filename}>{row.meta.filename}</span>
              <span className="text-[11px] text-stone-400 tabular-nums shrink-0">{fmtSize(row.a.size)}</span>
              <button onClick={() => download(row)} className="px-1.5 h-6 rounded-md text-[11px] text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">下载</button>
              <button onClick={() => remove(row)} className="px-1.5 h-6 rounded-md text-[11px] text-stone-400 hover:text-red-500 hover:bg-red-500/10 transition-colors">删除</button>
            </div>
          ))}
          {rows.length === 0 && <p className="text-[12px] text-stone-400 mb-1.5">尚无附件——可上传保险单扫描件、恢复码 PDF 等（端到端加密，上限 5MB/文件）</p>}
          <input ref={fileRef} type="file" className="hidden" onChange={e => upload(e.target.files?.[0])} />
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="mt-1 px-3 h-7 rounded-lg text-[12px] text-stone-500 border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40 transition-colors">
            {busy ? '加密上传中…' : '＋ 加密上传附件'}
          </button>
          {err && <p className="mt-1.5 text-[11.5px] text-red-500">{err}</p>}
        </>
      )}
    </Section>
  )
}

export default function ItemDetail({ item, copier, vek, onEdit, onTrash, onRestore, onPurge, onToggleFav, inTrash }) {
  const d = item.data
  const domain = domainOf(d.urls?.[0]?.value) || (d.app_name ? '' : '')
  const entropy = passwordEntropy(d.password?.value)
  const strength = strengthLabel(entropy)
  const pwAge = daysAgo(item.password_updated_at || item.created_at)
  const emails = (d.identities || []).filter(x => x.type === 'email' && x.role !== 'recovery')
  const recoveryEmails = (d.identities || []).filter(x => x.type === 'email' && x.role === 'recovery')
  const phones = (d.identities || []).filter(x => x.type === 'phone' && x.role !== 'recovery')
  const recoveryPhones = (d.identities || []).filter(x => x.type === 'phone' && x.role === 'recovery')
  const has2fa = (d.secrets || []).some(s => s.kind === '2fa_secret' && s.value)
  const hasPasskey = (d.login_methods || []).some(m => /passkey/i.test(m))
  const history = (d.password_history || []).slice().reverse()   // 新在前
  const overdue = expiryInfo(item)
  // TOTP 材料：otpauth:// URI 或 Base32 形态的 2FA Secret
  const totpSecrets = (d.secrets || [])
    .filter(s => s.kind === '2fa_secret' && s.value && !s.value.includes(' '))
    .map(s => parseOtpauth(s.value) || { secret: s.value.trim().replace(/[\s-]/g, ''), digits: 6, period: 30, issuer: '' })
    .filter(t => /^[A-Za-z2-7]+=*$/.test(t.secret) && t.secret.length >= 8)

  return (
    <div className="p-5 sm:p-7 animate-fade-in overflow-y-auto h-full">
      {/* 头部 */}
      <div className="flex items-start gap-4">
        <Favicon domain={domain} name={d.service} size={40} />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold leading-tight truncate">{d.service || '未命名'}</h2>
          <div className="flex items-center gap-2 mt-1 text-[12px] text-stone-400 dark:text-stone-500 flex-wrap">
            {domain && <span className="truncate">{domain}</span>}
            {d.app_name && <span>· {d.app_name}</span>}
            {d.category && <span className="px-2 py-0.5 rounded-md bg-black/[0.05] dark:bg-white/[0.07] text-[11px]">{CATEGORY_LABELS[d.category] || d.category}</span>}
            {d.type && d.type !== 'Website' && <span className="px-2 py-0.5 rounded-md bg-black/[0.05] dark:bg-white/[0.07] text-[11px]">{TYPE_LABELS[d.type] || d.type}</span>}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {(d.tags || []).map(t => (
              <span key={t} className="text-[11px] text-stone-400 dark:text-stone-500 bg-black/[0.04] dark:bg-white/[0.06] px-2 py-0.5 rounded-md">{t}</span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onToggleFav(item)}
            title={item.favorite ? '取消收藏' : '收藏'}
            className={'w-8 h-8 flex items-center justify-center rounded-lg transition-colors ' + (item.favorite
              ? 'text-amber-500' : 'text-stone-300 dark:text-stone-600 hover:text-stone-500 dark:hover:text-stone-400 hover:bg-black/5 dark:hover:bg-white/5')}
          >{item.favorite ? I.starFill : I.star}</button>
          {inTrash ? (
            <>
              <button onClick={() => onRestore(item)} className="px-2.5 h-8 rounded-lg text-[12px] text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors">恢复</button>
              <button onClick={() => onPurge(item)} className="px-2.5 h-8 rounded-lg text-[12px] text-red-500 hover:bg-red-500/10 transition-colors">彻底删除</button>
            </>
          ) : (
            <>
              <button onClick={onEdit} title="编辑" className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">{I.edit}</button>
              <button onClick={() => onTrash(item)} title="移入回收站" className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-500/10 transition-colors">{I.trash}</button>
            </>
          )}
        </div>
      </div>

      {/* LOGIN */}
      <Section title="登录信息">
        {d.username && (
          <FieldRow label="用户名">
            <div className="flex items-center gap-1">
              <span className="text-sm font-mono truncate text-stone-800 dark:text-stone-100">{d.username}</span>
              <CopyButton value={d.username} copier={copier} />
            </div>
          </FieldRow>
        )}
        {d.account_id && (
          <FieldRow label="账号昵称">
            <span className="text-sm text-stone-600 dark:text-stone-300 truncate">{d.account_id}</span>
          </FieldRow>
        )}
        {d.password?.value ? (
          <SecretField label="密码" value={d.password.value} copier={copier} />
        ) : (
          <FieldRow label="密码"><span className="text-[12px] text-stone-400">未设置</span></FieldRow>
        )}
        {(d.urls || []).filter(u => u.value).map((u, i) => (
          <FieldRow key={i} label={i === 0 ? 'Website' : ' '}>
            <div className="flex items-center gap-1">
              <a href={u.value.includes('://') ? u.value : `https://${u.value}`} target="_blank" rel="noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate">
                {u.value}
              </a>
              <button
                onClick={() => window.open(u.value.includes('://') ? u.value : `https://${u.value}`, '_blank', 'noreferrer')}
                className="px-1.5 h-6 rounded-md text-[11px] text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >打开</button>
              <CopyButton value={u.value} copier={copier} />
            </div>
          </FieldRow>
        ))}
        {(d.login_methods || []).length > 0 && (
          <FieldRow label="登录方式">
            <div className="flex gap-1.5 flex-wrap">
              {d.login_methods.map(m => (
                <span key={m} className="px-2 py-0.5 rounded-md bg-black/[0.05] dark:bg-white/[0.07] text-[11px] text-stone-500 dark:text-stone-400">{METHOD_LABELS[m] || m}</span>
              ))}
            </div>
          </FieldRow>
        )}
      </Section>

      {/* TOTP 验证码（2FA Secret 可用时实时生成） */}
      {totpSecrets.length > 0 && (
        <Section title="TOTP 验证码">
          {totpSecrets.map((t, i) => (
            <div key={i} className="mb-2 last:mb-0">
              {t.issuer && <p className="text-[11px] text-stone-400 mb-0.5">{t.issuer}</p>}
              <TotpDisplay secret={t.secret} digits={t.digits} period={t.period} copier={copier} />
            </div>
          ))}
          <p className="text-[11px] text-stone-400 mt-1">本地生成（RFC 6238），密钥不出设备；环形进度为本周期剩余时间。</p>
        </Section>
      )}

      {/* IDENTITIES */}
      {(emails.length > 0 || recoveryEmails.length > 0 || phones.length > 0 || recoveryPhones.length > 0) && (
        <Section title="绑定身份">
          {emails.map((x, i) => <SecretField key={`e${i}`} label="邮箱" value={x.value} copier={copier} mono={false} />)}
          {recoveryEmails.map((x, i) => <SecretField key={`re${i}`} label="恢复邮箱" value={x.value} copier={copier} mono={false} />)}
          {phones.map((x, i) => <SecretField key={`p${i}`} label="手机号" value={x.value} copier={copier} mono={false} />)}
          {recoveryPhones.map((x, i) => <SecretField key={`rp${i}`} label="恢复手机号" value={x.value} copier={copier} mono={false} />)}
        </Section>
      )}

      {/* SECRETS */}
      {(d.secrets || []).some(s => s.value) && (
        <Section title="密钥">
          {d.secrets.filter(s => s.value).map((s, i) => (
            <SecretField
              key={i}
              label={SECRET_KIND_LABELS[s.kind] || s.kind}
              value={s.kind === 'security_question' ? (s.question ? `${s.question} → ${s.value}` : s.value) : s.value}
              copier={copier}
            />
          ))}
        </Section>
      )}

      {/* SECURITY */}
      <Section title="安全状况">
        {d.password?.value && (
          <FieldRow label="密码强度">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: strength.color }}>{strength.label}</span>
              <span className="text-[11px] text-stone-400">{entropy} 位熵</span>
            </div>
          </FieldRow>
        )}
        <FieldRow label="密码年龄">
          <span className="text-sm text-stone-600 dark:text-stone-300">
            {pwAge == null ? '—' : pwAge === 0 ? '今天刚改' : `${pwAge} 天前`}
          </span>
          {overdue && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px] font-medium">
              已超提醒周期（设定 {overdue.limit} 天）
            </span>
          )}
        </FieldRow>
        <FieldRow label="2FA">
          <span className={'text-sm font-medium ' + ((has2fa || hasPasskey) ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
            {has2fa ? '已开启（TOTP）' : hasPasskey ? '已开启（通行密钥）' : '未配置'}
          </span>
        </FieldRow>
      </Section>

      {/* 附件（VEK 可用且非回收站） */}
      {vek && !inTrash && <Attachments item={item} vek={vek} copier={copier} />}

      {/* PASSWORD HISTORY */}
      {d.password?.value && (
        <Section title={`密码历史（${history.length + 1}）`}>
          <div className="border-l-2 border-black/[0.08] dark:border-white/[0.08] ml-1">
            <div className="pl-4 pb-3 relative">
              <span className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-emerald-500" />
              <div className="text-sm font-medium">{(item.password_updated_at || item.created_at || '').slice(0, 10)}</div>
              <div className="text-[11px] text-stone-400">当前使用</div>
              <SecretField label=" " value={d.password.value} copier={copier} />
            </div>
            {history.map((h, i) => (
              <div key={i} className="pl-4 pb-3 relative">
                <span className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-stone-300 dark:bg-stone-600" />
                <div className="text-sm font-medium">{(h.replacedAt || '').slice(0, 10)}</div>
                <div className="text-[11px] text-stone-400">
                  使用 {usageDays(h)} 天{h.reason ? ` · ${h.reason}` : ''}
                </div>
                <SecretField label=" " value={h.value} copier={copier} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* CUSTOM FIELDS */}
      {(d.custom_fields || []).length > 0 && (
        <Section title="自定义字段">
          {d.custom_fields.map((f, i) =>
            f.secret
              ? <SecretField key={i} label={f.key} value={f.value} copier={copier} />
              : (
                <FieldRow key={i} label={f.key}>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-stone-700 dark:text-stone-200 break-all">{f.value}</span>
                    <CopyButton value={f.value} copier={copier} />
                  </div>
                </FieldRow>
              )
          )}
        </Section>
      )}

      {/* NOTES */}
      {d.notes && (
        <Section title="备注">
          <NotesView text={d.notes} />
        </Section>
      )}

      <div className="pt-6 mt-6 border-t border-black/[0.06] dark:border-white/[0.06] text-[11px] text-stone-400 dark:text-stone-600 flex gap-4">
        <span>创建于 {(item.created_at || '').slice(0, 10)}</span>
        <span>更新于 {(item.updated_at || '').slice(0, 10)}</span>
      </div>
    </div>
  )
}

