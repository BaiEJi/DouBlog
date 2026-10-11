/**
 * 账号卡（源版逻辑照搬）：状态徽章（语义色）/ 挂机游戏 chips / 三格统计 /
 * 操作按钮（选游戏=rose 主按钮）/ 设置面板（自动恢复开关 + shared_secret + 移除账号确认）。
 * 样式换 Tailwind（ui-baseline 档位）；个性色 rose 仅用于主按钮/选中态/游戏 chips。
 */
import { useState } from 'react'
import { api, fmtDuration } from '../api.js'
import { Confirm, inputCls } from '../../kit'

const STATE_LABEL = {
  online: { cls: 'online', text: '在线' },
  connecting: { cls: 'connecting', text: '连接中' },
  reconnecting: { cls: 'connecting', text: '重连中' },
  error: { cls: 'error', text: '异常' },
  offline: { cls: 'offline', text: '离线' },
  stopped: { cls: 'offline', text: '已停止' },
  starting: { cls: 'connecting', text: '启动中' },
}

const BADGE_CLS = {
  online: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  connecting: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  error: 'bg-red-500/10 text-red-600 dark:text-red-400',
  offline: 'bg-stone-500/10 text-stone-500 dark:text-stone-400',
}

/** rose 版开关（与 kit Switch 同档位，选中态个性色跟随本子模块） */
function RoseSwitch({ checked, onChange }) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={'relative w-10 h-[22px] rounded-full transition-colors shrink-0 ' +
        (checked ? 'bg-rose-500' : 'bg-black/[0.15] dark:bg-white/[0.2]')}>
      <span className={'absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow transition-all ' +
        (checked ? 'left-[21px]' : 'left-[3px]')} />
    </button>
  )
}

const btnGhostMini = 'inline-flex items-center px-3 h-8 rounded-lg text-xs text-stone-500 dark:text-stone-400 ' +
  'hover:bg-black/5 dark:hover:bg-white/10 transition-colors'

export default function AccountCard({ account, gamesMeta, onOpenPicker, onOpenLog, notify, refresh }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [secretValue, setSecretValue] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  const st = STATE_LABEL[account.state] || STATE_LABEL.offline
  const isIdling = account.idle_appids?.length > 0
  const totalFarmed = (account.farmed_total || 0) + (account.farmed_session || 0)

  const stopIdle = async () => {
    try {
      await api.stopIdle(account.steamid)
      notify('已停止挂机', 'ok')
      refresh()
    } catch (err) {
      notify(err.message, 'err')
    }
  }

  const remove = async () => {
    try {
      await api.removeAccount(account.steamid)
      notify('已移除账号', 'ok')
      setConfirmRemove(false)
      refresh()
    } catch (err) {
      notify(err.message, 'err')
    }
  }

  const saveSecret = async () => {
    try {
      await api.setSharedSecret(account.steamid, secretValue.trim())
      notify(secretValue.trim() ? '已保存 shared_secret，下次登录将自动填写令牌' : '已清除 shared_secret', 'ok')
      setSecretValue('')
      setSettingsOpen(false)
      refresh()
    } catch (err) {
      notify(err.message, 'err')
    }
  }

  const toggleAutoResume = async (enabled) => {
    try {
      await api.setAutoResume(account.steamid, enabled)
      refresh()
    } catch (err) {
      notify(err.message, 'err')
    }
  }

  const gameNames = (account.idle_appids || []).slice(0, 6).map(
    (id) => gamesMeta.get(id) || `App ${id}`,
  )
  const moreCount = (account.idle_appids || []).length - gameNames.length
  const initial = (account.account_name || '?')[0].toUpperCase()

  return (
    <div className={'rounded-2xl border p-5 flex flex-col gap-3.5 transition-colors ' +
      (isIdling
        ? 'border-rose-500/40 bg-white dark:bg-white/[0.025]'
        : 'border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] hover:border-black/[0.15] dark:hover:border-white/[0.15]')}>

      {/* ── 头部：头像 + 名称 + 状态徽章 ── */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-rose-500/10 text-rose-600 dark:text-rose-300 flex items-center justify-center text-lg font-bold">
          {account.avatar_url ? <img src={account.avatar_url} alt="" className="w-full h-full object-cover" /> : initial}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-medium truncate" title={account.account_name}>{account.account_name}</div>
          <div className="font-mono text-[11.5px] text-stone-400 dark:text-stone-500 mt-0.5 truncate">ID: {account.steamid}</div>
        </div>
        <span className={'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] whitespace-nowrap ' + BADGE_CLS[st.cls]}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          {st.text}
        </span>
      </div>

      {account.state === 'error' && account.last_error && (
        <div className="-mt-1 text-xs text-red-600 dark:text-red-400 leading-relaxed break-all">{account.last_error}</div>
      )}

      {/* ── 统计行 ── */}
      <div className="flex gap-2.5">
        <div className="flex-1 min-w-0 rounded-xl bg-black/[0.04] dark:bg-white/[0.05] px-3 py-2.5">
          <div className={'text-sm font-semibold whitespace-nowrap ' + (isIdling ? 'text-rose-600 dark:text-rose-400' : '')}>
            {isIdling ? '挂机中' : '未挂机'}
          </div>
          <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 truncate">
            {isIdling ? `已连续 ${fmtDuration(account.idle_since ? (Date.now() / 1000 - account.idle_since) : account.farmed_session)}` : '选择游戏开始刷时长'}
          </div>
        </div>
        <div className="flex-1 min-w-0 rounded-xl bg-black/[0.04] dark:bg-white/[0.05] px-3 py-2.5">
          <div className="text-sm font-semibold tabular-nums whitespace-nowrap">{fmtDuration(totalFarmed)}</div>
          <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">累计挂机时长</div>
        </div>
        <div className="flex-1 min-w-0 rounded-xl bg-black/[0.04] dark:bg-white/[0.05] px-3 py-2.5">
          <div className="text-sm font-semibold tabular-nums">{(account.idle_appids || []).length}</div>
          <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">挂机游戏数</div>
        </div>
      </div>

      {/* ── 当前挂机列表 ── */}
      <div className="min-h-[34px]">
        <div className="text-xs text-stone-500 dark:text-stone-400 mb-1.5">当前挂机列表</div>
        {isIdling ? (
          <div className="flex flex-wrap gap-1.5">
            {gameNames.map((n, i) => (
              <span key={i} className="px-2 py-0.5 rounded-md text-[11px] bg-rose-500/10 text-rose-700 dark:text-rose-300 whitespace-nowrap">{n}</span>
            ))}
            {moreCount > 0 && (
              <span className="px-2 py-0.5 rounded-md text-[11px] border border-dashed border-rose-500/40 text-rose-600 dark:text-rose-400">+{moreCount}</span>
            )}
          </div>
        ) : (
          <div className="text-xs text-stone-400 dark:text-stone-500">— 无 —</div>
        )}
      </div>

      {/* ── 操作行 ── */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="inline-flex items-center px-3 h-8 rounded-lg text-xs font-medium bg-rose-500 text-white hover:bg-rose-600 transition-colors"
          onClick={() => onOpenPicker(account)}>
          {isIdling ? '调整挂机' : '选择游戏挂机'}
        </button>
        {isIdling && (
          <button className={btnGhostMini} onClick={stopIdle}>停止挂机</button>
        )}
        <button className={btnGhostMini} onClick={() => onOpenLog(account)}>日志</button>
        <span className="flex-1" />
        <button className={btnGhostMini} onClick={() => setSettingsOpen(!settingsOpen)}>设置</button>
      </div>

      {/* ── 设置面板 ── */}
      {settingsOpen && (
        <div className="rounded-xl border border-black/[0.07] dark:border-white/[0.07] bg-black/[0.02] dark:bg-white/[0.03] p-3.5 space-y-3 text-sm">
          <div className="flex items-center gap-2.5">
            <RoseSwitch checked={!!account.auto_resume} onChange={toggleAutoResume} />
            <div className="text-[13px]">程序重启后自动恢复挂机</div>
          </div>
          <div className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
            配置 shared_secret 后，登录时自动生成令牌验证码（无需手动输入）。
            {account.shared_secret_set ? ' 已配置。' : ' 未配置。'}
          </div>
          <div className="flex gap-2">
            <input
              className={inputCls}
              placeholder="maFile 中的 shared_secret (base64)"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
            />
            <button
              className="inline-flex items-center px-3 h-9 rounded-lg text-xs font-medium bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors shrink-0"
              onClick={saveSecret}>
              保存
            </button>
          </div>
          <div className="flex justify-end pt-2 border-t border-black/[0.05] dark:border-white/[0.06]">
            <button className="inline-flex items-center px-3 h-8 rounded-lg text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors" onClick={() => setConfirmRemove(true)}>
              移除账号
            </button>
          </div>
        </div>
      )}

      {confirmRemove && (
        <Confirm
          text={`确认移除账号 ${account.account_name}？将删除其登录令牌与挂机配置。`}
          danger
          onOk={remove}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  )
}
