/**
 * 刷题能力包页面 /practice —— 算法题解与艾宾浩斯复习（顶级模块）。
 * 顶栏遵循统一 PageHeader；视图本体（PracticeView）自带 Segmented 视图切换。
 */
import { useCallback, useState } from 'react'
import PageHeader from '../shared/PageHeader'
import { Icon, Toast } from '../todo/kit'

import PracticeView from './PracticeView'

export default function PracticePage({ dark, setDark }) {
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
      <PageHeader title="刷题" subtitle="题解 · 代码 · 艾宾浩斯复习"
        right={
          <button onClick={() => setDark(!dark)} title="切换主题"
            className="w-9 h-9 rounded-xl border border-black/[0.08] dark:border-white/[0.1] text-stone-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center justify-center transition-colors">
            {dark ? Icon.sun : Icon.moon}
          </button>
        }
        accent="blue" />

      {/* ── 主区 ── */}
      <main className="mx-auto max-w-[1700px] px-4 sm:px-6 xl:px-10 py-6">
        <PracticeView toast={toast} dark={dark} />
      </main>

      <Toast msg={toastMsg} kind={toastKind} />
    </div>
  )
}
