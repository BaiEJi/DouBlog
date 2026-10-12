/**
 * 游戏选择弹窗（源版逻辑照搬）：搜索过滤游戏库 / 多选（上限 maxGames）/ 手输 AppID /
 * 刷新库（force）→ 开始挂机。弹窗改用 Doublog kit Modal；选中态用模块个性色 rose。
 */
import { useEffect, useMemo, useState } from 'react'
import { api, fmtMinutes } from '../api.js'
import { Modal, inputCls } from '../../todo/kit'

const btnPlain = 'px-3 h-9 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] ' +
  'hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors shrink-0'

export default function GamePicker({ account, maxGames, onClose, onStarted, notify }) {
  const [games, setGames] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState(() => new Set(account.idle_appids || []))
  const [manualId, setManualId] = useState('')
  const [starting, setStarting] = useState(false)

  const load = async (force = false) => {
    setLoading(true); setError('')
    try {
      const resp = await api.accountGames(account.steamid, force)
      setGames(resp.games || [])
    } catch (err) {
      setError(err.message)
      setGames([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(false) }, [account.steamid])

  const filtered = useMemo(() => {
    if (!games) return []
    const kw = keyword.trim().toLowerCase()
    if (!kw) return games
    return games.filter(
      (g) => g.name.toLowerCase().includes(kw) || String(g.appid).includes(kw),
    )
  }, [games, keyword])

  const toggle = (appid) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(appid)) {
        next.delete(appid)
      } else if (next.size < maxGames) {
        next.add(appid)
      } else {
        notify(`最多同时挂机 ${maxGames} 个游戏`, 'err')
      }
      return next
    })
  }

  const addManual = () => {
    const ids = manualId
      .split(/[,，\s]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n > 0)
    if (!ids.length) return
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (next.size >= maxGames) break
        next.add(id)
      }
      return next
    })
    setManualId('')
  }

  const start = async () => {
    setStarting(true)
    try {
      await api.startIdle(account.steamid, [...selected])
      notify('已开始挂机', 'ok')
      onStarted()
    } catch (err) {
      notify(err.message, 'err')
    } finally {
      setStarting(false)
    }
  }

  return (
    <Modal open title={`选择要挂机的游戏 — ${account.account_name}`} onClose={onClose} width="max-w-2xl"
      footer={
        <>
          <div className="flex-1 mr-2 text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
            已选 <b className="font-semibold text-rose-600 dark:text-rose-400">{selected.size}</b> / {maxGames} 个
            {selected.size > 0 && ' · 挂机时游戏状态将显示"游戏中"，时长正常累计'}
          </div>
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">
            取消
          </button>
          <button disabled={selected.size === 0 || starting} onClick={start}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-rose-500 text-white hover:bg-rose-600 transition-colors disabled:opacity-50">
            {starting ? '启动中...' : '开始挂机'}
          </button>
        </>
      }>
      <div className="flex gap-2">
        <input
          className={inputCls}
          placeholder="搜索游戏名或 AppID..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <button className={btnPlain} onClick={() => load(true)}>刷新库</button>
      </div>

      {loading && <div className="py-8 text-center text-xs text-stone-400">正在获取游戏库...</div>}

      {error && (
        <div className="mt-3 rounded-lg px-3 py-2 text-[13px] bg-red-500/10 text-red-600 dark:text-red-400 leading-relaxed">
          {error}（可尝试点击"刷新库"，或直接用下方手动 AppID 添加）
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="py-8 text-center text-xs text-stone-400">没有匹配的游戏</div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="mt-3 max-h-[46vh] overflow-y-auto space-y-1 pr-0.5">
          {filtered.slice(0, 400).map((g) => {
            const sel = selected.has(g.appid)
            return (
              <label key={g.appid}
                className={'flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ' +
                  (sel
                    ? 'border-rose-500/50 bg-rose-500/[0.07]'
                    : 'border-transparent bg-black/[0.03] dark:bg-white/[0.04] hover:border-black/10 dark:hover:border-white/15')}>
                <input
                  type="checkbox"
                  checked={sel}
                  onChange={() => toggle(g.appid)}
                  className="w-4 h-4 accent-rose-500 shrink-0"
                />
                <span className="flex-1 min-w-0 text-sm truncate" title={g.name}>{g.name}</span>
                <span className="text-xs text-stone-400 dark:text-stone-500 whitespace-nowrap shrink-0">
                  {g.playtime_forever > 0 ? `已玩 ${fmtMinutes(g.playtime_forever)}` : '未玩过'}
                </span>
              </label>
            )
          })}
        </div>
      )}

      <div className="flex gap-2 mt-3">
        <input
          className={inputCls}
          placeholder="手动输入 AppID (逗号分隔), 如: 730, 570"
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addManual())}
        />
        <button className={btnPlain} onClick={addManual}>添加</button>
      </div>
    </Modal>
  )
}
