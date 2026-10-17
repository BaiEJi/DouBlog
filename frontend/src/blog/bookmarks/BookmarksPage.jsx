/**
 * 书签 tab 壳（知识库模块，路由 /bookmarks）。
 * BookmarksView 将 收藏夹 / 稍后阅读 / 统计 / 工具 / 回收站 注册到 blog 模块侧栏。
 */
import { useCallback, useState } from 'react'
import { Toast } from '../../todo/kit'

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
    <div className="min-h-0 text-stone-800 dark:text-stone-100 transition-colors">
      <main className="mx-auto max-w-full p-0">
        <BookmarksView toast={toast} dark={dark} />
      </main>

      <Toast msg={toastMsg} kind={toastKind} />
    </div>
  )
}
