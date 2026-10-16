/**
 * 书签与稍后阅读能力包页面 /bookmarks —— 顶级模块。
 * BookmarksView 将 收藏夹 / 稍后阅读 / 统计 / 工具 / 回收站 注册到公共 ModuleShell 侧栏。
 */
import { useCallback, useState } from 'react'
import { Toast } from '../todo/kit'

import BookmarksView from './BookmarksView'

export default function BookmarksPage({ dark }) {
  const [toastMsg, setToastMsg] = useState(null)
  const [toastKind, setToastKind] = useState('')

  const toast = useCallback((msg, kind) => {
    setToastMsg(msg)
    setToastKind(kind || '')
    setTimeout(() => setToastMsg(null), 2400)
  }, [])

  return (
    <div className="min-h-0 bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 transition-colors">
      <main className="mx-auto max-w-full p-0">
        <BookmarksView toast={toast} dark={dark} />
      </main>

      <Toast msg={toastMsg} kind={toastKind} />
    </div>
  )
}
