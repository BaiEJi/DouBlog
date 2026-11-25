/**
 * Vault 条目编辑器：全字段表单。改密码时自动推进 PasswordHistory（可填原因）。
 */
import { useState } from 'react'
import {
  CATEGORIES, SECRET_KINDS, LOGIN_METHODS,
  CATEGORY_LABELS, SECRET_KIND_LABELS, METHOD_LABELS,
  passwordEntropy, strengthLabel, applyPasswordChange, emptyItem,
} from './core'
import { generatePassword } from './core'
import { loginName, normalizeSiteName, siteFromLoginUrl } from './accountBook.js'
import { GroupPicker } from './AccountGroups'
import { parseOtpauth } from './totp'
import { I, Select } from './ui'

const input = 'w-full px-3 h-9 text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-lg text-stone-800 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors'
const label = 'block text-[11px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500 mb-1.5'

function Row({ children, onRemove }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 min-w-0 flex gap-1.5">{children}</div>
      <button type="button" onClick={onRemove}
        className="w-7 h-7 shrink-0 rounded-md text-stone-400 hover:text-red-500 hover:bg-red-500/10 transition-colors">✕</button>
    </div>
  )
}

function AddBtn({ onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className="mt-1.5 px-2 h-7 rounded-md text-[12px] text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors inline-flex items-center gap-1">
      {I.plus} {children}
    </button>
  )
}

export default function ItemEditor({ initial, catalog, groups, defaultGroup, onGroupCommit, siteOptions, defaultSite, onCancel, onSave, saving }) {
  const [d, setD] = useState(() => ({ ...emptyItem(), group_id: initial ? '' : defaultGroup, site_name: initial ? '' : defaultSite, ...(initial || {}) }))
  const [pwInput, setPwInput] = useState(d.password?.value || '')
  const [pwReason, setPwReason] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [searchingSites, setSearchingSites] = useState(false)
  const [saveError, setSaveError] = useState('')

  const patch = (fields) => setD(prev => ({ ...prev, ...fields }))

  const entropy = passwordEntropy(pwInput)
  const strength = strengthLabel(entropy)
  const pwChanged = pwInput !== (d.password?.value || '')
  const inferredSite = siteFromLoginUrl(d)

  const save = () => {
    const next = JSON.parse(JSON.stringify(d))
    const siteName = normalizeSiteName(d.site_name)
    next.site_name = siteOptions.find(option => option.value.toLowerCase() === siteName.toLowerCase())?.value ?? siteName
    if (groups && !groups.some(g => g.id === next.group_id)) next.group_id = ''
    if (pwChanged) applyPasswordChange(next, pwInput, pwReason)
    setSaveError('')
    Promise.resolve(onSave(next)).catch(error => { if (error.name !== 'AbortError') setSaveError(error.message || '保存失败') })
  }

  const addTag = () => {
    const t = tagInput.trim().replace(/,$/, '')
    if (t && !next(d.tags).includes(t) && next(d.tags).length < 20) patch({ tags: [...next(d.tags), t] })
    setTagInput('')
  }
  const next = (v) => v || []

  const genOpts = { length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true }

  return (
    <div className="vault-editor p-5 overflow-y-auto h-full">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onCancel} className="w-8 h-8 -ml-2 flex items-center justify-center rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">{I.back}</button>
        <h2 className="text-base font-semibold">{initial ? '编辑账号' : '新增账号'}</h2>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onCancel} className="px-3 h-8 rounded-lg text-sm text-stone-500 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">取消</button>
          <button onClick={save} disabled={saving || !d.service.trim()}
            className="px-4 h-8 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40">
            {saving ? '加密保存中…' : '保存'}
          </button>
        </div>
      </div>

      {saveError && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{saveError}</p>}
      <div className="grid grid-cols-2 gap-x-3">
        <label className="vault-field min-w-0">名称
          <input className={input} value={d.service} onChange={e => patch({ service: e.target.value })} placeholder="如：工作邮箱" autoFocus />
        </label>
        <div className="vault-field min-w-0"><span>所属网站</span>
          <Select mode="combobox" aria-label="所属网站" className="w-full" allowClear value={d.site_name || ''}
            onChange={value => patch({ site_name: value ?? '' })} options={siteOptions}
            showSearch={{ optionFilterProp: 'label', filterOption: searchingSites, onSearch: () => setSearchingSites(true) }}
            onOpenChange={open => { if (!open) setSearchingSites(false) }}
            placeholder={inferredSite ? '按网址显示 · ' + inferredSite : '选择或输入网站名称'} />
        </div>
      </div>
      <GroupPicker groups={groups} value={d.group_id} onChange={id => patch({ group_id: id })} onCommit={onGroupCommit} />
      <label className="vault-field">登录账号
        <input className={input} value={loginName(d)} autoComplete="off" placeholder="用户名、邮箱或手机号"
          onChange={e => patch({ login: e.target.value, username: e.target.value })} />
      </label>
      <div className="mb-1">
        <label className={label}>密码</label>
        <div className="flex gap-1.5">
          <input
            className={input + ' font-mono'}
            aria-label="密码" type={showPw ? 'text' : 'password'}
            value={pwInput}
            onChange={e => setPwInput(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
          <button type="button" onClick={() => setShowPw(s => !s)}
            className="px-2.5 h-9 rounded-lg text-[12px] text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0">{showPw ? '隐藏' : '显示'}</button>
          <button type="button" onClick={() => setPwInput(generatePassword(genOpts))} title="生成 20 位强密码"
            className="px-2.5 h-9 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0">{I.dice}</button>
        </div>
        {pwInput && (
          <div className="flex items-center gap-2 mt-1.5">
            <div className="h-1 flex-1 rounded-full bg-black/[0.06] dark:bg-white/[0.08] overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, entropy)}%`, background: strength.color }} />
            </div>
            <span className="text-[11px] font-medium" style={{ color: strength.color }}>{strength.label}</span>
            <span className="text-[11px] text-stone-400">{entropy} 位熵</span>
          </div>
        )}
      </div>
      <label className="vault-field">登录网址
        <input className={input} value={d.urls?.[0]?.value || ''} placeholder="https://"
          onChange={e => patch({ urls: [{ ...d.urls?.[0], value: e.target.value }, ...next(d.urls).slice(1)] })} />
      </label>
      <label className="vault-field">备注（选填）
        <textarea className={input + ' min-h-16 py-2 resize-y'} value={d.notes} onChange={e => patch({ notes: e.target.value })} />
      </label>
      <details className="vault-advanced">
        <summary>更多信息</summary>
        <div className="mt-4 space-y-4">
          <label className="vault-field">用途
            <input className={input} value={d.purpose || ''} onChange={e => patch({ purpose: e.target.value })} placeholder="例如：个人、工作" />
          </label>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className={label}>分类</label>
          <Select aria-label="条目类别" className="w-full" value={d.category} onChange={v => patch({ category: v })}
            options={(catalog || CATEGORIES.map(k => ({ key: k, label: CATEGORY_LABELS[k] || k }))).map(c => ({ value: c.key, label: c.label }))} />
        </div>
        <div>
          <label className={label}>App 名称</label>
          <input className={input} value={d.app_name} onChange={e => patch({ app_name: e.target.value })} placeholder="（App 类条目填写）" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className={label}>手机号</label>
          <input className={input} value={d.phone} onChange={e => patch({ phone: e.target.value })} placeholder="可选，如 +86 138****1234" />
        </div>
        <div>
          <label className={label}>邮箱</label>
          <input className={input} value={d.email} onChange={e => patch({ email: e.target.value })} placeholder="可选，如 name@example.com" />
        </div>
      </div>

      <div className="mb-4">
        <label className={label}>实名人</label>
        <input className={input} value={d.real_name} onChange={e => patch({ real_name: e.target.value })} placeholder="可选，账号归属人的真实姓名" />
      </div>

        {pwChanged && pwInput && initial && (
          <div className="mt-2">
            <input className={input} value={pwReason} onChange={e => setPwReason(e.target.value)}
              placeholder="修改原因（可选，会记入密码历史）" />
          </div>
        )}
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[11.5px] text-stone-400 shrink-0">到期提醒</span>
          <input type="number" min="0" max="3650" className={input + ' w-24 tabular-nums'}
            value={d.expiry_days ?? ''} placeholder="如 90"
            onChange={e => patch({ expiry_days: e.target.value === '' ? null : Math.min(3650, Math.max(0, parseInt(e.target.value, 10) || 0)) })} />
          <span className="text-[11.5px] text-stone-400">天未改密码后在概览提醒（留空不提醒，0 = 每次提醒）</span>
        </div>

      <div className="mb-4">
        <label className={label}>其他登录地址</label>
        {d.urls?.[0]?.value && <input aria-label="主网址标签" className={input} value={d.urls[0].label || ''} placeholder="主网址标签（选填）"
          onChange={e => patch({ urls: d.urls.map((u, i) => i === 0 ? { ...u, label: e.target.value } : u) })} />}
        <div className="space-y-1.5">
          {next(d.urls).slice(1).map((u, i) => (
            <Row key={i} onRemove={() => patch({ urls: d.urls.filter((_, j) => j !== i + 1) })}>
              <input className={input} style={{ maxWidth: '7rem' }} value={u.label || ''} placeholder="标签"
                onChange={e => patch({ urls: d.urls.map((x, j) => j === i + 1 ? { ...x, label: e.target.value } : x) })} />
              <input className={input} value={u.value} placeholder="https://"
                onChange={e => patch({ urls: d.urls.map((x, j) => j === i + 1 ? { ...x, value: e.target.value } : x) })} />
            </Row>
          ))}
        </div>
        <AddBtn onClick={() => patch({ urls: [...(d.urls?.length ? d.urls : [{ value: '', label: '' }]), { label: '', value: '' }] })}>添加网址</AddBtn>
      </div>

      <div className="mb-4">
        <label className={label}>绑定身份（邮箱 / 手机号）</label>
        <div className="space-y-1.5">
          {next(d.identities).map((x, i) => (
            <Row key={i} onRemove={() => patch({ identities: d.identities.filter((_, j) => j !== i) })}>
              <Select aria-label="身份类型" className="w-[6rem]" value={x.type} title="身份类型"
                onChange={v => patch({ identities: d.identities.map((y, j) => j === i ? { ...y, type: v } : y) })}
                options={[{ value: 'email', label: 'Email' }, { value: 'phone', label: 'Phone' }]} />
              <Select aria-label="身份用途" className="w-[7rem]" value={x.role || 'primary'} title="身份用途"
                onChange={v => patch({ identities: d.identities.map((y, j) => j === i ? { ...y, role: v } : y) })}
                options={[{ value: 'primary', label: '主要' }, { value: 'recovery', label: '恢复用' }]} />
              <input className={input} value={x.value} placeholder="xxx@gmail.com"
                onChange={e => patch({ identities: d.identities.map((y, j) => j === i ? { ...y, value: e.target.value } : y) })} />
            </Row>
          ))}
        </div>
        <AddBtn onClick={() => patch({ identities: [...next(d.identities), { type: 'email', value: '', role: 'primary' }] })}>添加身份</AddBtn>
      </div>

      <div className="mb-4">
        <label className={label}>密钥（两步验证 / PIN / API Key…）</label>
        <div className="space-y-1.5">
          {next(d.secrets).map((s, i) => (
            <Row key={i} onRemove={() => patch({ secrets: d.secrets.filter((_, j) => j !== i) })}>
              <Select aria-label="密钥类型" className="w-[10rem]" value={s.kind} title="密钥类型"
                onChange={v => patch({ secrets: d.secrets.map((y, j) => j === i ? { ...y, kind: v } : y) })}
                options={SECRET_KINDS.map(k => ({ value: k.key, label: SECRET_KIND_LABELS[k.key] || k.label }))} />
              {s.kind === 'security_question' && (
                <input className={input} style={{ maxWidth: '10rem' }} value={s.question || ''} placeholder="问题"
                  onChange={e => patch({ secrets: d.secrets.map((y, j) => j === i ? { ...y, question: e.target.value } : y) })} />
              )}
              <input className={input + ' font-mono'} value={s.value} placeholder={s.kind === '2fa_secret' ? 'Base32 密钥或 otpauth:// URI（自动解析）' : '值（加密存储）'}
                onChange={e => {
                  const v = e.target.value
                  if (s.kind === '2fa_secret' && v.startsWith('otpauth://')) {
                    const otp = parseOtpauth(v)
                    if (otp) {
                      // 解析成功：密钥存 Base32，签发方回填服务名（仅当当前为空）
                      patch({ secrets: d.secrets.map((y, j) => j === i ? { ...y, value: otp.secret } : y) })
                      if (otp.issuer && !d.service) patch({ service: otp.issuer })
                      return
                    }
                  }
                  patch({ secrets: d.secrets.map((y, j) => j === i ? { ...y, value: v } : y) })
                }} />
            </Row>
          ))}
        </div>
        <AddBtn onClick={() => patch({ secrets: [...next(d.secrets), { kind: '2fa_secret', value: '' }] })}>添加密钥</AddBtn>
      </div>

      <div className="mb-4">
        <label className={label}>自定义字段</label>
        <div className="space-y-1.5">
          {next(d.custom_fields).map((f, i) => (
            <Row key={i} onRemove={() => patch({ custom_fields: d.custom_fields.filter((_, j) => j !== i) })}>
              <input className={input} style={{ maxWidth: '9rem' }} value={f.key} placeholder="Organization"
                onChange={e => patch({ custom_fields: d.custom_fields.map((y, j) => j === i ? { ...y, key: e.target.value } : y) })} />
              <input className={input} value={f.value} placeholder="OpenAI"
                onChange={e => patch({ custom_fields: d.custom_fields.map((y, j) => j === i ? { ...y, value: e.target.value } : y) })} />
              <button type="button" title="作为机密隐藏"
                onClick={() => patch({ custom_fields: d.custom_fields.map((y, j) => j === i ? { ...y, secret: !y.secret } : y) })}
                className={'w-9 h-9 shrink-0 rounded-lg text-sm transition-colors ' + (f.secret ? 'text-amber-500 bg-amber-500/10' : 'text-stone-400 hover:bg-black/5 dark:hover:bg-white/5')}>
                {I.lock}
              </button>
            </Row>
          ))}
        </div>
        <AddBtn onClick={() => patch({ custom_fields: [...next(d.custom_fields), { key: '', value: '', secret: false }] })}>添加字段</AddBtn>
      </div>

      <div className="mb-4">
        <label className={label}>登录方式</label>
        <div className="flex gap-1.5 flex-wrap">
          {LOGIN_METHODS.map(m => {
            const on = next(d.login_methods).includes(m)
            return (
              <button key={m} type="button"
                onClick={() => patch({ login_methods: on ? d.login_methods.filter(x => x !== m) : [...next(d.login_methods), m] })}
                className={'px-2.5 h-8 rounded-lg text-[12px] transition-colors ' + (on
                  ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
                  : 'text-stone-500 hover:bg-black/5 dark:hover:bg-white/5 border border-black/10 dark:border-white/10')}>
                {METHOD_LABELS[m] || m}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mb-4">
        <label className={label}>标签 Tags</label>
        <div className="flex flex-wrap items-center gap-1.5">
          {next(d.tags).map(t => (
            <span key={t} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-black/[0.05] dark:bg-white/[0.07] text-[12px] text-stone-600 dark:text-stone-300">
              {t}
              <button type="button" onClick={() => patch({ tags: d.tags.filter(x => x !== t) })}
                className="w-4 h-4 rounded-full text-stone-400 hover:text-red-500 text-sm leading-none">×</button>
            </span>
          ))}
          <input value={tagInput} onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }}
            onBlur={addTag}
            placeholder="加标签…"
            className="w-24 bg-transparent text-[12px] text-stone-600 dark:text-stone-300 placeholder:text-stone-400 focus:outline-none" />
        </div>
      </div>

      <div className="mb-4">
        <label className={label}>昵称 / Account ID</label>
        <input className={input} value={d.account_id} onChange={e => patch({ account_id: e.target.value })} placeholder="可选" />
      </div>

        </div>
      </details>
    </div>
  )
}
