/**
 * 密码服务（轮换密码）：项目 / 用户类型（策略）/ 用户（独立密码链 + 倒计时）/ API 集成。
 * 注意：本模块为服务端校验服务（非零知识），UI 中已明确标注。
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  pwsvcCreateProject, pwsvcListProjects, pwsvcUpdateProject, pwsvcDeleteProject,
  pwsvcResetApiKey, pwsvcCreateType, pwsvcListTypes, pwsvcUpdateType, pwsvcDeleteType,
  pwsvcCreateUser, pwsvcListUsers, pwsvcUpdateUser, pwsvcDeleteUser, pwsvcCurrentPassword,
  pwsvcListLogs,
} from '../api'
import { API_BASE } from '../api'
import { CopyButton, I } from './ui'

const ROTATIONS = [
  { v: 30, l: '30 秒' }, { v: 60, l: '60 秒' }, { v: 120, l: '2 分钟' },
  { v: 300, l: '5 分钟' }, { v: 600, l: '10 分钟' },
]

const input = 'w-full h-9 px-3 text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-lg text-stone-800 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors'
const label = 'block text-[11px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500 mb-1.5'

function Modal({ title, children, onClose, wide }) {
  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 dark:bg-black/60" onClick={onClose} />
      <div className={'relative bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.08] rounded-2xl shadow-2xl p-5 w-full ' + (wide ? 'max-w-lg' : 'max-w-sm')}>
        <div className="flex items-center mb-4">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="ml-auto w-7 h-7 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── 用户行：当前密码 + 倒计时 + 自动刷新 ────────────────
function UserRow({ user, types, copier, onChanged }) {
  const [cur, setCur] = useState(null)
  const [left, setLeft] = useState(null)
  const timerRef = useRef(0)

  const refresh = useCallback(async () => {
    const d = await pwsvcCurrentPassword(user.id).catch(() => null)
    if (d?.success) {
      setCur(d.data)
      setLeft(d.data.expires_in)
    }
  }, [user.id])

  useEffect(() => {
    refresh()
    timerRef.current = setInterval(() => {
      setLeft(l => {
        if (l === null) return l
        if (l <= 1) { refresh(); return null }
        return l - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [refresh])

  const type = types.find(t => t.id === user.type_id)
  const disabled = user.status === 'disabled'
  const pct = cur && cur.rotation_seconds ? Math.min(100, (left ?? 0) / cur.rotation_seconds * 100) : 0

  return (
    <div className={'flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ' + (disabled
      ? 'border-black/[0.04] dark:border-white/[0.04] opacity-50'
      : 'border-black/[0.06] dark:border-white/[0.06] hover:border-black/[0.13] dark:hover:border-white/[0.13]')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{user.username}</span>
          {user.display_name && <span className="text-[11px] text-stone-400 truncate">{user.display_name}</span>}
          {disabled && <span className="text-[11px] px-2 py-0.5 rounded-md bg-black/[0.06] dark:bg-white/[0.08] text-stone-400">已禁用</span>}
        </div>
        <div className="text-[11px] text-stone-400">{type ? type.name : '—'}</div>
      </div>
      {/* 当前密码 */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="font-mono text-xs text-stone-600 dark:text-stone-300 tabular-nums tracking-wider select-all">
          {disabled ? '—' : (cur ? cur.password : '…')}
        </span>
        {!disabled && cur && <CopyButton value={cur.password} copier={copier} />}
        {/* 倒计时圆环 */}
        {!disabled && (
          <span className="relative w-7 h-7 shrink-0" title={left != null ? `${left} 秒后刷新` : ''}>
            <svg width="28" height="28" viewBox="0 0 28 28" className="-rotate-90">
              <circle cx="14" cy="14" r="11" fill="none" strokeWidth="2.5" className="stroke-black/[0.08] dark:stroke-white/[0.1]" />
              <circle cx="14" cy="14" r="11" fill="none" strokeWidth="2.5" strokeLinecap="round"
                className="stroke-amber-500 transition-all duration-1000"
                strokeDasharray={`${2 * Math.PI * 11}`}
                strokeDashoffset={`${2 * Math.PI * 11 * (1 - pct / 100)}`} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono tabular-nums text-stone-400">{left ?? '·'}</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <button onClick={() => pwsvcUpdateUser(user.id, { status: disabled ? 'enabled' : 'disabled' }).then(onChanged)}
          title={disabled ? '启用' : '禁用'}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-stone-400 hover:text-amber-600 hover:bg-amber-500/10 transition-colors text-sm">{disabled ? '▶' : '❚❚'}</button>
        <button onClick={() => pwsvcUpdateUser(user.id, { reset_seed: true }).then(onChanged)}
          title="重置密码链（旧密码全部失效）"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-stone-400 hover:text-blue-600 hover:bg-blue-500/10 transition-colors">{I.refresh}</button>
        <button onClick={() => { if (confirm(`删除用户 ${user.username}？`)) pwsvcDeleteUser(user.id).then(onChanged) }}
          title="删除"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-500/10 transition-colors">{I.trash}</button>
      </div>
    </div>
  )
}

// ─── 类型策略编辑 ────────────────────────────────────────
function TypeEditor({ pid, initial, onDone, onCancel }) {
  const [t, setT] = useState(() => initial || {
    name: '', length: 16, uppercase: true, lowercase: true, digits: true, symbols: true,
    exclude_ambiguous: true, rotation_seconds: 60,
  })
  const [err, setErr] = useState('')
  const set = (k, v) => setT(p => ({ ...p, [k]: v }))
  const save = async () => {
    const res = initial
      ? await pwsvcUpdateType(initial.id, t)
      : await pwsvcCreateType(pid, t)
    if (res.success) onDone()
    else setErr(res.message || '保存失败')
  }
  return (
    <Modal title={initial ? '编辑类型' : '新建用户类型'} onClose={onCancel}>
      <div className="space-y-3.5">
        <div>
          <label className={label}>类型名</label>
          <input className={input} value={t.name} onChange={e => set('name', e.target.value)} placeholder="如：管理员 / 普通用户" autoFocus />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-stone-500 w-16">密码长度</span>
          <input type="range" min="8" max="64" value={t.length} onChange={e => set('length', +e.target.value)} className="flex-1 accent-stone-700 dark:accent-stone-200" />
          <span className="text-sm font-mono w-8 text-right tabular-nums">{t.length}</span>
        </div>
        <div>
          <label className={label}>轮换周期</label>
          <div className="flex gap-1.5 flex-wrap">
            {ROTATIONS.map(r => (
              <button key={r.v} onClick={() => set('rotation_seconds', r.v)}
                className={'px-2.5 h-8 rounded-lg text-[12px] transition-colors ' + (t.rotation_seconds === r.v
                  ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
                  : 'text-stone-500 border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5')}>{r.l}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-y-2 text-[12.5px] text-stone-600 dark:text-stone-300">
          {[['uppercase', '大写 A-Z'], ['lowercase', '小写 a-z'], ['digits', '数字 0-9'], ['symbols', '符号 !@#'], ['exclude_ambiguous', '排除易混淆 (I l 1 O 0 o)']].map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!t[k]} onChange={e => set(k, e.target.checked)} className="accent-stone-700 dark:accent-stone-200" />
              {l}
            </label>
          ))}
        </div>
        {err && <p className="text-[12px] text-red-500">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} className="px-3 h-9 rounded-lg text-sm text-stone-500 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">取消</button>
          <button onClick={save} disabled={!t.name.trim()}
            className="px-4 h-9 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40">保存</button>
        </div>
      </div>
    </Modal>
  )
}

// ─── API Key 一次性展示 ──────────────────────────────────
function ApiKeyOnce({ apiKey, name, copier, onConfirm }) {
  const [saved, setSaved] = useState(false)
  const curl = `curl -X POST ${API_BASE}/api/pwsvc/validate \\
  -H "X-Api-Key: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"username": "user001", "password": "..."}'`
  return (
    <Modal title="API Key（仅显示一次）" onClose={saved ? onConfirm : () => {}} wide>
      <p className="text-[12.5px] text-stone-500 leading-relaxed mb-3">
        项目「{name}」的校验密钥。服务端只保存哈希，<b className="text-red-500">关闭后无法再次查看</b>——请立即复制保存。
      </p>
      <div className="p-3 rounded-xl bg-stone-50 dark:bg-white/[0.03] border border-black/[0.07] dark:border-white/[0.07] font-mono text-xs break-all select-all">{apiKey}</div>
      <div className="mt-3 flex items-center gap-2">
        <CopyButton value={apiKey} copier={copier} label="复制 Key" done="已复制 ✓" />
        <CopyButton value={curl} copier={copier} label="复制 curl 示例" done="已复制 ✓" />
      </div>
      <pre className="mt-3 p-3 rounded-xl bg-stone-900 text-stone-200 text-[11px] leading-relaxed overflow-x-auto">{curl}</pre>
      <label className="flex items-center gap-2 mt-4 text-[12.5px] text-stone-500 cursor-pointer">
        <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} className="accent-stone-700 dark:accent-stone-200" />
        我已安全保存此 Key
      </label>
      <button disabled={!saved} onClick={onConfirm}
        className="mt-4 w-full h-10 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40">完成</button>
    </Modal>
  )
}

// ─── 主视图 ──────────────────────────────────────────────
export default function PwsvcView({ copier }) {
  const [projects, setProjects] = useState(null)
  const [current, setCurrent] = useState(null)      // 当前项目详情
  const [types, setTypes] = useState([])
  const [users, setUsers] = useState(null)
  const [keyOnce, setKeyOnce] = useState(null)       // {api_key, name}
  const [newProject, setNewProject] = useState(false)

  const loadProjects = async () => {
    const d = await pwsvcListProjects().catch(() => null)
    if (d?.success) setProjects(d.data)
  }
  useEffect(() => { loadProjects() }, [])

  // 打开项目：拉类型与用户
  const openProject = async (p) => {
    setCurrent(p)
    setUsers(null)
    setTypes([])
    const [usersRes, typesRes] = await Promise.all([
      pwsvcListUsers(p.id).catch(() => null),
      pwsvcListTypes(p.id).catch(() => null),
    ])
    if (typesRes?.success) setTypes(typesRes.data)
    if (usersRes?.success) setUsers(usersRes.data)
  }

  return (
    <div className="p-8 overflow-y-auto h-full animate-fade-in">
      <div className="max-w-[1700px] w-full">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="text-stone-400">{I.key}</span>
          <h2 className="text-xl font-semibold">密码服务</h2>
        </div>
        <p className="text-[12px] text-stone-400 mb-7">
          为项目提供自动轮换的密码（每用户独立密码链）与校验 API。
          <span className="text-amber-600/80"> 本模块为服务端校验服务，非零知识加密。</span>
        </p>

        {!projects ? <p className="text-sm text-stone-400 py-8 text-center">加载中…</p>
          : current ? (
            <ProjectDetail
              project={current}
              users={users}
              types={types}
              copier={copier}
              onTypesChange={setTypes}
              onUsersChange={async () => { const d = await pwsvcListUsers(current.id); if (d.success) setUsers(d.data) }}
              onBack={async () => { setCurrent(null); loadProjects() }}
              onResetKey={async () => {
                const d = await pwsvcResetApiKey(current.id)
                if (d.success) setKeyOnce({ api_key: d.data.api_key, name: current.name })
              }}
            />
          ) : (
            <>
              <div className="flex items-center mb-4">
                <SecTitle>项目（{projects.length}）</SecTitle>
                <button onClick={() => setNewProject(true)}
                  className="ml-auto px-3 h-8 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm font-medium hover:opacity-90 transition-opacity inline-flex items-center gap-1.5">{I.plus} 新建项目</button>
              </div>
              {projects.length === 0 ? (
                <p className="text-sm text-stone-400 py-12 text-center">还没有项目——新建一个，为它的用户发放轮换密码</p>
              ) : (
                <div className="grid grid-cols-3 gap-2.5">
                  {projects.map(p => (
                    <button key={p.id} onClick={() => openProject(p)}
                      className="group text-left p-4 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] hover:border-black/[0.15] dark:hover:border-white/[0.15] hover:shadow-sm transition-all">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-semibold truncate">{p.name}</span>
                        <span className="ml-auto font-mono text-[11px] text-stone-400 shrink-0">{p.api_key_prefix}…</span>
                      </div>
                      <p className="text-[12px] text-stone-400 truncate mb-2.5">{p.description || '—'}</p>
                      <div className="text-[11.5px] text-stone-400 flex gap-3">
                        <span>{p.type_count} 类型</span><span>{p.user_count} 用户</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
      </div>

      {/* 新建项目 */}
      {newProject && (
        <NewProjectModal onClose={() => setNewProject(false)}
          onCreated={async (d) => { setNewProject(false); setKeyOnce({ api_key: d.api_key, name: d.name }); loadProjects() }} />
      )}

      {/* API Key 一次性展示 */}
      {keyOnce && (
        <ApiKeyOnce apiKey={keyOnce.api_key} name={keyOnce.name} copier={copier}
          onConfirm={() => setKeyOnce(null)} />
      )}
    </div>
  )
}

function SecTitle({ children }) {
  return <h2 className="text-[11px] font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500">{children}</h2>
}

function NewProjectModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true); setErr('')
    const d = await pwsvcCreateProject({ name, description: desc }).catch(e => ({ success: false, message: String(e) }))
    setBusy(false)
    if (d.success) onCreated(d.data)
    else setErr(d.message || '创建失败')
  }
  return (
    <Modal title="新建项目" onClose={onClose}>
      <div className="space-y-3.5">
        <div>
          <label className={label}>项目名</label>
          <input className={input} value={name} onChange={e => setName(e.target.value)} placeholder="如：商城测试环境" autoFocus />
        </div>
        <div>
          <label className={label}>描述（可选）</label>
          <input className={input} value={desc} onChange={e => setDesc(e.target.value)} placeholder="一句话说明" />
        </div>
        {err && <p className="text-[12px] text-red-500">{err}</p>}
        <p className="text-[11.5px] text-stone-400">创建后将生成 API Key（仅显示一次），供其他服务调用校验接口。</p>
        <button onClick={go} disabled={busy || !name.trim()}
          className="w-full h-10 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40">
          {busy ? '创建中…' : '创建项目'}</button>
      </div>
    </Modal>
  )
}

function ProjectDetail({ project, users, types, copier, onTypesChange, onUsersChange, onBack, onResetKey }) {
  const [typeEditor, setTypeEditor] = useState(null)
  const [newUser, setNewUser] = useState(false)
  const [limit, setLimit] = useState(project.rate_limit ?? 120)   // 校验限流（次/分钟）
  const [limitInput, setLimitInput] = useState(String(project.rate_limit ?? 120))
  const [limitErr, setLimitErr] = useState('')
  const [limitBusy, setLimitBusy] = useState(false)

  const saveLimit = async () => {
    const v = parseInt(limitInput, 10)
    if (!Number.isInteger(v) || v < 0 || v > 10000) { setLimitErr('需为 0-10000 的整数'); return }
    setLimitErr(''); setLimitBusy(true)
    const d = await pwsvcUpdateProject(project.id, { rate_limit: v }).catch(() => null)
    setLimitBusy(false)
    if (d?.success) { setLimit(v); setLimitInput(String(v)) }
    else setLimitErr(d?.message || '保存失败')
  }

  return (
    <div className="animate-fade-in">
      <button onClick={onBack} className="text-sm text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors mb-4">← 全部项目</button>
      <div className="flex flex-wrap items-center gap-3 mb-7">
        <h3 className="text-lg font-semibold">{project.name}</h3>
        <span className="font-mono text-[11px] text-stone-400">{project.api_key_prefix}…</span>
        <div className="ml-auto flex gap-2">
          <button onClick={onResetKey} className="px-3 h-8 rounded-lg text-sm text-stone-500 border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">重置 API Key</button>
        </div>
      </div>

      {/* API 集成 */}
      <SecTitle>API 集成</SecTitle>
      <div className="mt-2.5 mb-8 p-3.5 rounded-2xl bg-stone-50 dark:bg-white/[0.02] border border-black/[0.06] dark:border-white/[0.06]">
        <div className="flex items-center gap-2 mb-2 text-[12px] text-stone-500">
          <span className="font-mono text-[11.5px]">POST {API_BASE}/api/pwsvc/validate</span>
        </div>
        <pre className="text-[11px] leading-relaxed overflow-x-auto text-stone-500 dark:text-stone-400">{`curl -X POST ${API_BASE}/api/pwsvc/validate \\
  -H "X-Api-Key: <你的项目 Key>" \\
  -H "Content-Type: application/json" \\
  -d '{"username": "user001", "password": "当前密码"}'
# → {"data": {"valid": true, "expires_in": 23}}   # 密码错误 → valid:false`}</pre>
        {/* 校验限流设置 */}
        <div className="mt-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.06] flex flex-wrap items-center gap-2">
          <span className="text-[11.5px] text-stone-400">校验限流</span>
          <input type="number" min="0" max="10000" value={limitInput}
            onChange={e => setLimitInput(e.target.value)}
            className="w-20 h-7 px-2 text-[12px] bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-lg text-stone-800 dark:text-stone-100 tabular-nums focus:outline-none focus:border-black/30 dark:focus:border-white/30" />
          <span className="text-[11.5px] text-stone-400">次 / 分钟（0 = 不限流，超出返回 429）</span>
          <button onClick={saveLimit} disabled={limitBusy || limitInput === String(limit)}
            className="ml-auto px-2.5 h-7 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[11.5px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40">{limitBusy ? '保存中…' : '保存'}</button>
        </div>
        {limitErr && <p className="mt-1.5 text-[11.5px] text-red-500">{limitErr}</p>}
      </div>

      {/* 用户类型 */}
      <div className="flex items-center mb-2.5">
        <SecTitle>用户类型（{types.length}）</SecTitle>
        <button onClick={() => setTypeEditor({})} className="ml-auto text-[12px] text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors inline-flex items-center gap-1">{I.plus} 新建类型</button>
      </div>
      <div className="mb-8 space-y-1.5">
        {types.length === 0 && users?.length === 0 && (
          <p className="text-[12.5px] text-stone-400">先创建用户类型（定义密码策略与轮换周期），再添加用户。</p>
        )}
        {types.map(t => (
          <div key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-black/[0.06] dark:border-white/[0.06]">
            <span className="text-sm font-medium">{t.name}</span>
            <span className="text-[11.5px] text-stone-400">{t.length} 位 · 每 {t.rotation_seconds}s 轮换</span>
            <div className="ml-auto flex gap-0.5">
              <button onClick={() => setTypeEditor(t)} className="w-7 h-7 flex items-center justify-center rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">{I.edit}</button>
              <button onClick={async () => {
                const d = await pwsvcDeleteType(t.id)
                if (!d.success) { alert(d.message); return }
                const d2 = await pwsvcListTypes(project.id).catch(() => null)
                if (d2?.success) onTypesChange(d2.data)
              }} className="w-7 h-7 flex items-center justify-center rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-500/10 transition-colors">{I.trash}</button>
            </div>
          </div>
        ))}
      </div>

      {/* 用户 */}
      <div className="flex items-center mb-2.5">
        <SecTitle>用户（{users?.length ?? 0}）</SecTitle>
        <button onClick={() => setNewUser(true)} disabled={!types.length}
          className="ml-auto px-3 h-7 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[12px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center gap-1">{I.plus} 添加用户</button>
      </div>
      <div className="space-y-1.5">
        {!users ? <p className="text-[12.5px] text-stone-400">加载中…</p>
          : users.length === 0 ? <p className="text-[12.5px] text-stone-400">还没有用户</p>
            : users.map(u => (
              <UserRow key={u.id} user={u} types={types} copier={copier} onChanged={onUsersChange} />
            ))}
      </div>

      {/* 校验日志 */}
      <div className="mt-10 mb-2.5">
        <SecTitle>校验日志</SecTitle>
      </div>
      <LogsPanel pid={project.id} />

      {/* 类型编辑弹层 */}
      {typeEditor && (
        <TypeEditor
          pid={project.id}
          initial={typeEditor.id ? typeEditor : null}
          onDone={async () => {
            setTypeEditor(null)
            const d = await pwsvcListTypes(project.id).catch(() => null)
            if (d?.success) onTypesChange(d.data)
          }}
          onCancel={() => setTypeEditor(null)}
        />
      )}

      {/* 新建用户 */}
      {newUser && (
        <Modal title="添加用户" onClose={() => setNewUser(false)}>
          <NewUserForm pid={project.id} types={types}
            onDone={() => { setNewUser(false); onUsersChange() }}
            onCancel={() => setNewUser(false)} />
        </Modal>
      )}
    </div>
  )
}

// ─── 校验日志面板（统计 + 时间线 + 分页）────────────────
function LogsPanel({ pid }) {
  const [data, setData] = useState(null)
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)

  const load = async (p = 1, append = false) => {
    setBusy(true)
    const d = await pwsvcListLogs(pid, p).catch(() => null)
    setBusy(false)
    if (!d?.success) return
    setData(prev => (append && prev ? { ...d.data, items: [...prev.items, ...d.data.items] } : d.data))
    setPage(p)
  }
  useEffect(() => { load(1) }, [pid])

  if (!data) return <p className="text-[12.5px] text-stone-400">加载中…</p>

  const { items, total, stats } = data
  const s1 = stats?.h1 ?? { ok: 0, fail: 0 }
  const s24 = stats?.h24 ?? { ok: 0, fail: 0 }
  const brute = s1.fail >= 50   // 近 1 小时失败 ≥50 次视为疑似爆破

  return (
    <div>
      {/* 统计胶囊 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="px-2.5 h-7 inline-flex items-center gap-1.5 rounded-full bg-stone-100 dark:bg-white/[0.04] text-[11.5px] text-stone-500">
          近 1 小时 <b className={s1.fail ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}>✓{s1.ok} ✗{s1.fail}</b>
        </span>
        <span className="px-2.5 h-7 inline-flex items-center gap-1.5 rounded-full bg-stone-100 dark:bg-white/[0.04] text-[11.5px] text-stone-500">
          近 24 小时 <b className={s24.fail ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}>✓{s24.ok} ✗{s24.fail}</b>
        </span>
        {brute && (
          <span className="px-2.5 h-7 inline-flex items-center rounded-full bg-red-500/10 text-red-500 text-[11.5px] font-medium">⚠ 疑似在线爆破（近 1 小时失败 {s1.fail} 次）</span>
        )}
        {stats?.fail_top?.length > 0 && (
          <span className="px-2.5 h-7 inline-flex items-center gap-1.5 rounded-full bg-stone-100 dark:bg-white/[0.04] text-[11.5px] text-stone-500">
            失败最多：{stats.fail_top.map(f => `${f.username}×${f.count}`).join('、')}
          </span>
        )}
        <span className="ml-auto text-[11px] text-stone-400">共 {total} 条 · 保留 30 天</span>
        <button onClick={() => load(1)} disabled={busy}
          className="px-2.5 h-7 rounded-lg text-[11.5px] text-stone-500 border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-40">{busy ? '…' : '刷新'}</button>
      </div>

      {/* 时间线 */}
      {total === 0 ? (
        <p className="text-[12.5px] text-stone-400 py-4 text-center">还没有校验记录——用左侧 curl 示例调一次校验接口试试</p>
      ) : (
        <div className="rounded-2xl border border-black/[0.06] dark:border-white/[0.06] overflow-hidden">
          <div className="grid grid-cols-[130px_1fr_70px_120px] gap-2 px-3.5 py-2.5 bg-stone-50 dark:bg-white/[0.03] text-[11px] text-stone-400">
            <span>时间</span><span>用户名</span><span>结果</span><span>来源 IP</span>
          </div>
          {items.map(l => (
            <div key={l.id} className="grid grid-cols-[130px_1fr_70px_120px] gap-2 px-3.5 py-2.5 text-sm border-t border-black/[0.06] dark:border-white/[0.06]">
              <span className="text-stone-400 tabular-nums">{fmtLogTime(l.created_at)}</span>
              <span className="truncate text-stone-700 dark:text-stone-200">{l.username}</span>
              <span>{l.valid
                ? <b className="text-emerald-600 dark:text-emerald-400">✓ 通过</b>
                : <b className="text-red-500">✗ 失败</b>}</span>
              <span className="text-stone-400 font-mono text-[11px] truncate">{l.ip || '—'}</span>
            </div>
          ))}
        </div>
      )}

      {items.length < total && (
        <button onClick={() => load(page + 1, true)} disabled={busy}
          className="mt-2.5 px-3 h-8 rounded-lg text-[12px] text-stone-500 border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-40">
          加载更多（{items.length} / {total}）
        </button>
      )}
    </div>
  )
}

function fmtLogTime(iso) {
  // 后端存 naive UTC，转本地时间显示
  if (!iso) return '—'
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  if (isNaN(d)) return iso
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}


function NewUserForm({ pid, types, onDone, onCancel }) {
  const [username, setUsername] = useState('')
  const [display, setDisplay] = useState('')
  const [typeId, setTypeId] = useState(types[0]?.id ?? '')
  const [err, setErr] = useState('')
  const go = async () => {
    const d = await pwsvcCreateUser(pid, { username, type_id: typeId, display_name: display })
    if (d.success) onDone()
    else setErr(d.message || '创建失败')
  }
  return (
    <div className="space-y-3.5">
      <div>
        <label className={label}>用户名（项目内唯一）</label>
        <input className={input} value={username} onChange={e => setUsername(e.target.value)} placeholder="user001" autoFocus />
      </div>
      <div>
        <label className={label}>显示名（可选）</label>
        <input className={input} value={display} onChange={e => setDisplay(e.target.value)} />
      </div>
      <div>
        <label className={label}>用户类型</label>
        <select className={input} value={typeId} onChange={e => setTypeId(+e.target.value)}>
          {types.map(t => <option key={t.id} value={t.id}>{t.name}（{t.length} 位 · {t.rotation_seconds}s）</option>)}
        </select>
      </div>
      {err && <p className="text-[12px] text-red-500">{err}</p>}
      <p className="text-[11.5px] text-stone-400">创建后立即拥有独立的轮换密码链。</p>
      <button onClick={go} disabled={!username.trim() || !typeId}
        className="w-full h-10 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40">创建用户</button>
    </div>
  )
}
