/**
 * Steam 挂机能力包页面 /steamidler —— 账号挂机管理（顶级模块）。
 * 顶栏遵循统一 PageHeader；视图本体（SteamIdlerView）自带账号卡片与日志面板。
 */
import { useCallback, useState } from 'react'
import PageHeader from '../shared/PageHeader'
import { Icon, Toast } from '../todo/kit'

import SteamIdlerView from './SteamIdlerView'

export default function SteamIdlerPage({ dark, setDark }) {
  const [toastMsg, setToastMsg] = useState(null)
  const [toastKind, setToastKind] = useState('')

  const toast = useCallback((msg, kind) => {
    setToastMsg(msg)
    setToastKind(kind || '')
    setTimeout(() => setToastMsg(null), 2400)
  }, [])

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 transition-colors">
      {/* ── 顶栏 ── */}
      <PageHeader title="Steam 挂机" subtitle="账号 · 挂机时长 · 日志"
        right={
          <button onClick={() => setDark(!dark)} title="切换主题"
            className="w-9 h-9 rounded-xl border border-black/[0.08] dark:border-white/[0.1] text-stone-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center justify-center transition-colors">
            {dark ? Icon.sun : Icon.moon}
          </button>
        }
        accent="slate" />

      {/* ── 主区 ── */}
      <main className="mx-auto max-w-[1700px] px-4 sm:px-6 xl:px-10 py-6">
        <SteamIdlerView toast={toast} />
      </main>

      <Toast msg={toastMsg} kind={toastKind} />
    </div>
  )
}
