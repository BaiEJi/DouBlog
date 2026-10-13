/**
 * Steam 挂机能力包页面 /steamidler —— 账号挂机管理（顶级模块）。
 * 顶栏遵循统一 PageHeader；视图本体（SteamIdlerView）自带账号卡片与日志面板。
 */
import { useCallback, useState } from 'react'
import PageHeader from '../shared/PageHeader'
import { Toast } from '../todo/kit'

import SteamIdlerView from './SteamIdlerView'

export default function SteamIdlerPage() {
  const [toastMsg, setToastMsg] = useState(null)
  const [toastKind, setToastKind] = useState('')

  const toast = useCallback((msg, kind) => {
    setToastMsg(msg)
    setToastKind(kind || '')
    setTimeout(() => setToastMsg(null), 2400)
  }, [])

  return (
    <div className="min-h-0 bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 transition-colors">
      {/* ── 顶栏 ── */}
      <PageHeader title="Steam 挂机" subtitle="账号 · 挂机时长 · 日志"

        accent="slate" />

      {/* ── 主区 ── */}
      <main className="mx-auto max-w-full p-0">
        <SteamIdlerView toast={toast} />
      </main>

      <Toast msg={toastMsg} kind={toastKind} />
    </div>
  )
}
