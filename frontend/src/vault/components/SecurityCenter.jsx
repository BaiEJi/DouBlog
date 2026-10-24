/**
 * 安全中心：健康总评分（0-100 环 + 下钻）+ 弱/复用/过旧/到期/无2FA/重复/缺恢复
 * + 泄露检查（HIBP k-anonymity，只上传 SHA-1 前 5 位）——全部基于客户端解密数据，
 * 明文密码永不上传服务端。
 */
import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { analyzeSecurity, daysAgo, expiryInfo } from './core'
import { pwnedCount } from './hibp'
import { Favicon, I } from './ui'
import { createVaultTaskScope, runVaultTasks } from './session'

function Group({ icon, title, tone, items, empty, children, gref, neutral }) {
  return (
    <section ref={gref} className="p-5 rounded-2xl border border-black/[0.06] dark:border-white/[0.06] bg-black/[0.012] dark:bg-white/[0.015] scroll-mt-4">
      <div className="flex items-center gap-2 mb-3">
        <span className={'shrink-0 ' + tone}>{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className={'text-[11px] font-semibold px-2 py-0.5 rounded-md ' + (items.length
          ? 'bg-red-500/12 text-red-600 dark:text-red-400'
          : neutral
            ? 'bg-black/[0.06] dark:bg-white/[0.08] text-stone-500 dark:text-stone-400'
            : 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400')}>{neutral ? '未检查' : items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[12px] text-stone-400">{empty}</p>
      ) : (
        <div className="space-y-0.5 -mx-1">{children}</div>
      )}
    </section>
  )
}

function ItemChip({ item, note, onSelect }) {
  return (
    <button onClick={() => onSelect(item)}
      className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors text-left group">
      <Favicon domain="" name={item.data.service} size={20} />
      <span className="text-[12.5px] font-medium truncate w-28 shrink-0">{item.data.service}</span>
      <span className="text-[11.5px] text-stone-400 truncate flex-1">{item.data.username}</span>
      <span className="text-[11.5px] text-red-500/90 truncate shrink-0">{note}</span>
    </button>
  )
}

/** 健康总评分环（0-100，随扣分项变红/琥珀/绿） */
function ScoreRing({ score, total, checked, onDive }) {
  const R = 54
  const C = 2 * Math.PI * R
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : score >= 40 ? '#f97316' : '#ef4444'
  const label = score >= 80 ? '良好' : score >= 60 ? '一般' : score >= 40 ? '较差' : '高危'
  return (
    <button onClick={onDive}
      className="w-full flex items-center gap-6 p-6 rounded-2xl border border-black/[0.06] dark:border-white/[0.06] bg-black/[0.012] dark:bg-white/[0.015] hover:border-black/[0.12] dark:hover:border-white/[0.14] transition-colors text-left">
      <div className="relative shrink-0">
        <svg className="-rotate-90" width="132" height="132" viewBox="0 0 132 132">
          <circle cx="66" cy="66" r={R} className="stroke-black/[0.07] dark:stroke-white/10" strokeWidth="10" fill="none" />
          <circle cx="66" cy="66" r={R} stroke={color} strokeWidth="10" fill="none" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - score / 100)}
            style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.22, 1, 0.36, 1)' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[34px] font-semibold tabular-nums leading-none" style={{ color }}>{score}</span>
          <span className="text-[11px] text-stone-400 mt-0.5">/ 100</span>
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">库健康度</span>
          <span className="px-2 py-0.5 rounded-full text-[12px] font-medium" style={{ background: color + '1f', color }}>{label}</span>
        </div>
        <p className="text-[12.5px] text-stone-400 mt-2 leading-relaxed">
          {total} 个条目 · 评分 = 100 − 泄露×15 − 弱×8 − 复用×10 − 到期×4 − 过旧×3 − 无2FA×2
          <br />{checked ? '点击查看扣分项（下钻到对应分组）' : '建议先执行一次泄露检查，评分会更准确'}
        </p>
      </div>
    </button>
  )
}

export default function SecurityCenter({ items, onSelect, vaultSession }) {
  const s = useMemo(() => analyzeSecurity(items), [items])
  const [pwned, setPwned] = useState({})         // itemId → 次数（≥1 泄露 / 0 安全 / -1 不可达）
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const groupRefs = useRef({})
  const lifecycle = useRef(null)

  // 含密码的条目（HIBP 查询时按密码去重，同密码只查一次）
  const withPw = useMemo(() => items.filter(i => i.data.password?.value), [items])
  useEffect(() => {
    const scope = createVaultTaskScope(vaultSession); lifecycle.current = scope
    return () => scope.dispose()
  }, [vaultSession, withPw])

  const runCheck = useCallback(async () => {
    const scope = lifecycle.current
    if (checking || !scope?.isCurrent()) return
    setChecking(true)
    // 按密码去重 → 并发 3 逐个查
    const uniq = new Map()
    for (const it of withPw) {
      const pw = it.data.password.value
      if (!uniq.has(pw)) uniq.set(pw, [])
      uniq.get(pw).push(it.id)
    }
    const entries = [...uniq.entries()]
    setProgress({ done: 0, total: entries.length })
    const results = { ...pwned }
    let done = 0
    try {
      await runVaultTasks(entries, async ([pw, ids], { signal }) => ({ ids, n: await pwnedCount(pw, { signal }) }), {
        signal: scope.signal, isCurrent: scope.isCurrent, concurrency: 3, onResult: ({ ids, n }) => {
        for (const id of ids) results[id] = n
        done += 1
        setProgress({ done, total: entries.length })
        setPwned({ ...results })
        },
      })
    } finally { if (lifecycle.current?.isCurrent()) setChecking(false) }
  }, [checking, withPw, pwned])

  const checked = Object.values(pwned).length > 0
  const pwnedItems = useMemo(
    () => withPw.filter(i => pwned[i.id] >= 1),
    [withPw, pwned])
  const offline = useMemo(
    () => Object.values(pwned).some(v => v === -1), [pwned])

  // 总评分：100 − 加权扣分（泄露 15 / 弱 8 / 复用组 10 / 到期 4 / 过旧 3 / 无2FA 2 / 重复组 2 / 缺恢复 1）
  const score = useMemo(() => {
    if (!items.length) return 100
    const ded = pwnedItems.length * 15
      + s.weak.length * 8
      + s.reused.reduce((a, g) => a + (g.items.length > 1 ? 10 : 0), 0)
      + s.expired.length * 4
      + s.old.length * 3
      + s.no2fa.length * 2
      + s.duplicate.reduce((a, arr) => a + (arr.length > 1 ? 2 : 0), 0)
      + s.missingRecovery.length * 1
    return Math.max(0, 100 - ded)
  }, [items.length, pwnedItems.length, s])

  const dive = key => groupRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="p-8 overflow-y-auto h-full animate-fade-in">
      <div className="max-w-[1700px] w-full mx-auto">
        <div className="flex items-center gap-2.5 mb-1.5">
          <span className="text-stone-400">{I.shield}</span>
          <h2 className="text-xl font-semibold">安全中心</h2>
        </div>
        <p className="text-[12px] text-stone-400 mb-6">所有检测均在本地解密后完成，密码明文不会离开这台设备；泄露检查仅上传 SHA-1 前 5 位（k-anonymity）。</p>

        {/* 总评分 */}
        <div className="mb-5">
          <ScoreRing score={score} total={items.length} checked={checked} onDive={() => dive(pwnedItems.length ? 'pwned' : s.weak.length ? 'weak' : 'first')} />
        </div>

        <div className="grid grid-cols-2 gap-3">

          {/* 泄露检查（HIBP）：操作条常驻 Group 之外（结果为空时也要能点） */}
          <div className="col-span-2">
            <div className="flex items-center gap-3 mb-2">
              <button onClick={runCheck} disabled={checking || withPw.length === 0}
                className="px-3 h-7 rounded-lg text-[12px] text-white bg-stone-900 dark:bg-stone-100 dark:text-stone-900 hover:opacity-90 disabled:opacity-40 transition-opacity">
                {checking ? `检查中 ${progress.done}/${progress.total}…` : checked ? '重新检查泄露' : '检查泄露'}
              </button>
              <span className="text-[11.5px] text-stone-400">
                {checking ? '并发 3，仅上传 SHA-1 前 5 位（k-anonymity）'
                  : `对 ${withPw.length} 个含密码条目（去重后）比对 8 亿+ 泄露记录`}
              </span>
              {offline && !checking && <span className="text-[11.5px] text-amber-600 dark:text-amber-400">部分查询不可达（离线/被墙），结果可能不完整</span>}
            </div>
            <Group gref={el => groupRefs.current.pwned = el}
              icon={I.alert} title="已泄露密码" tone="text-stone-400"
              items={pwnedItems} neutral={!checked}
              empty={checked ? "没有密码出现在已知泄露库中 🎉" : "尚未检查——点击上方按钮开始"}>
              {pwnedItems.map(i => (
                <ItemChip key={i.id} item={i} note={`出现于泄露库 ${pwned[i.id].toLocaleString()} 次，立即改密`} onSelect={onSelect} />
              ))}
            </Group>
          </div>

          <div ref={el => groupRefs.current.first = el} className="contents">
            <Group gref={el => groupRefs.current.weak = el} icon={I.key} title="弱密码" tone="text-stone-400" items={s.weak} empty="没有弱密码 🎉">
              {s.weak.map(i => (
                <ItemChip key={i.id} item={i} note="强度不足（熵 < 60 位）" onSelect={onSelect} />
              ))}
            </Group>
          </div>

          <Group gref={el => groupRefs.current.reused = el} icon={I.key} title="复用密码" tone="text-stone-400" items={s.reused} empty="没有复用的密码">
            {s.reused.map((g, gi) => (
              <div key={gi} className="mb-2 p-2.5 rounded-lg bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.05] dark:border-white/[0.05]">
                <p className="text-[12px] text-red-500/90 mb-1">同一密码用于 {g.items.length} 个账号</p>
                {g.items.map(i => (
                  <ItemChip key={i.id} item={i} note="" onSelect={onSelect} />
                ))}
              </div>
            ))}
          </Group>

          <Group gref={el => groupRefs.current.old = el} icon={I.clock} title="过旧密码（超过 180 天未改）" tone="text-stone-400" items={s.old} empty="所有密码都在半年内更新过">
            {s.old.map(i => {
              const age = daysAgo(i.password_updated_at || i.created_at)
              return <ItemChip key={i.id} item={i} note={`密码已 ${age} 天未修改`} onSelect={onSelect} />
            })}
          </Group>

          <Group gref={el => groupRefs.current.expired = el} icon={I.clock} title="密码到期提醒（超过自定义周期）" tone="text-stone-400" items={s.expired} empty="没有条目超过自定义提醒周期">
            {s.expired.map(i => {
              const info = expiryInfo(i)
              return <ItemChip key={i.id} item={i} note={`已 ${info.days} 天 / 设定 ${info.limit} 天`} onSelect={onSelect} />
            })}
          </Group>

          <Group gref={el => groupRefs.current.no2fa = el} icon={I.shield} title="未开启两步验证" tone="text-stone-400" items={s.no2fa} empty="有密码的账号均已配置 2FA 或 Passkey">
            {s.no2fa.map(i => (
              <ItemChip key={i.id} item={i} note="未开启两步验证" onSelect={onSelect} />
            ))}
          </Group>

          <Group gref={el => groupRefs.current.duplicate = el} icon={I.edit} title="重复账号" tone="text-stone-400" items={s.duplicate} empty="没有疑似重复的账号">
            {s.duplicate.map((arr, gi) => (
              <div key={gi} className="mb-2 p-2.5 rounded-lg bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.05] dark:border-white/[0.05]">
                <p className="text-[12px] text-amber-600 dark:text-amber-400 mb-1">相同服务 + 用户名出现 {arr.length} 次</p>
                {arr.map(i => <ItemChip key={i.id} item={i} note="" onSelect={onSelect} />)}
              </div>
            ))}
          </Group>

          <Group gref={el => groupRefs.current.missingRecovery = el} icon={I.key} title="缺少恢复方式" tone="text-stone-400" items={s.missingRecovery} empty="所有账号都有恢复邮箱/手机或恢复密钥">
            {s.missingRecovery.map(i => (
              <ItemChip key={i.id} item={i} note="未记录任何恢复途径" onSelect={onSelect} />
            ))}
          </Group>
        </div>
      </div>
    </div>
  )
}
