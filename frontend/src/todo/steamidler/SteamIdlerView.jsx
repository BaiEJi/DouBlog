/**
 * Steam 挂机（steam-idler）子模块主视图 —— 源版 App.jsx 逻辑照搬，样式换 Tailwind（ui-baseline 档位）。
 * 个性色 rose（挂机=游戏=热情色）：仅用于徽章/主按钮/选中态；其余一律中性 stone。
 * 结构：统计栏（StatTile）+ 登录卡（居中）+ 账号卡网格 + 弹窗调度（GamePicker/LogPanel）；
 * 每 3 秒轮询 /api/todo/steamidler/accounts，顺带补全挂机游戏的名称缓存。
 * 由 TodoPage 顶栏 Tab「挂机」挂载（?v=steamidler），toast 复用页面级单 toast。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, fmtDuration } from './api.js'
import LoginCard from './components/LoginCard.jsx'
import AccountCard from './components/AccountCard.jsx'
import GamePicker from './components/GamePicker.jsx'
import LogPanel from './components/LogPanel.jsx'
import { StatTile, Empty } from '../kit'

export default function SteamIdlerView({ toast }) {
  const [accounts, setAccounts] = useState([])
  const [gamesMeta, setGamesMeta] = useState(() => new Map())
  const [maxGames, setMaxGames] = useState(32)
  const [pickerFor, setPickerFor] = useState(null)
  const [logFor, setLogFor] = useState(null)
  const aliveRef = useRef(true)

  // 源版右上多 toast 栈收敛为 Doublog 页面级单 toast（'err' → kit Toast 的 error 语义）
  const notify = useCallback((text, kind = '') => {
    toast?.(text, kind === 'err' ? 'error' : '')
  }, [toast])

  const refresh = useCallback(async () => {
    try {
      const list = await api.accounts()
      if (!aliveRef.current) return
      setAccounts(list)
      // 补充游戏名称缓存
      const acc = list.find((a) => a.idle_appids?.length)
      if (acc) {
        try {
          const resp = await api.accountGames(acc.steamid)
          if (resp.games && aliveRef.current) {
            setGamesMeta((prev) => {
              const next = new Map(prev)
              for (const g of resp.games) next.set(g.appid, g.name)
              return next
            })
          }
        } catch { /* 游戏库获取失败不影响主界面 */ }
      }
    } catch { /* 后端未就绪时静默 */ }
  }, [])

  useEffect(() => {
    aliveRef.current = true
    api.meta().then((m) => setMaxGames(m.max_idle_games || 32)).catch(() => {})
    refresh()
    const t = setInterval(refresh, 3000)
    return () => { aliveRef.current = false; clearInterval(t) }
  }, [refresh])

  const totalIdling = accounts.filter((a) => a.idle_appids?.length > 0).length
  const totalFarmed = accounts.reduce(
    (sum, a) => sum + (a.farmed_total || 0) + (a.farmed_session || 0), 0)

  return (
    <div className="space-y-5">
      {/* ── 统计栏 ── */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile title="账号" value={accounts.length} suffix="个" />
        <StatTile title="挂机中" value={totalIdling} suffix="个" />
        <StatTile title="累计挂机" value={fmtDuration(totalFarmed)} />
      </div>

      {/* ── 登录卡（居中） ── */}
      <LoginCard
        onSuccess={(acc) => {
          notify(`账号 ${acc?.account_name || ''} 登录成功`, 'ok')
          refresh()
        }}
      />

      {/* ── 账号卡网格 ── */}
      {accounts.length === 0 ? (
        <Empty text="还没有账号，使用上方表单添加第一个 Steam 账号" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {accounts.map((a) => (
            <AccountCard
              key={a.steamid}
              account={a}
              gamesMeta={gamesMeta}
              onOpenPicker={setPickerFor}
              onOpenLog={setLogFor}
              notify={notify}
              refresh={refresh}
            />
          ))}
        </div>
      )}

      {/* ── 弹窗调度 ── */}
      {pickerFor && (
        <GamePicker
          account={pickerFor}
          maxGames={maxGames}
          onClose={() => setPickerFor(null)}
          onStarted={() => {
            setPickerFor(null)
            refresh()
          }}
          notify={notify}
        />
      )}

      {logFor && <LogPanel account={logFor} onClose={() => setLogFor(null)} />}
    </div>
  )
}
