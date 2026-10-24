/**
 * 刷题能力包页面 /practice —— 算法题解与艾宾浩斯复习（顶级模块）。
 * PracticeView 将题库 / 复习 / 统计注册到公共 ModuleShell 侧栏。
 */
import { useCallback, useState } from 'react'
import { Toast } from '@/shared/ui/kit'

import PracticeView from './PracticeView'

export default function PracticePage({ dark }) {
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
      {/* ── 主区 ── */}
      <main className="mx-auto max-w-full p-0">
        <PracticeView toast={toast} dark={dark} />
      </main>

      <Toast msg={toastMsg} kind={toastKind} />
    </div>
  )
}
