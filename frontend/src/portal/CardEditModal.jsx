/**
 * 门户卡片编辑弹窗：自定义卡片标题与描述（覆盖内置默认文案，持久化到服务端
 * system_home_cards.title/desc；空 = 用默认）。左下"恢复默认文案"清除该卡覆盖。
 * Esc 关闭走捕获阶段 stopPropagation——与资产库弹窗同一约定，叠层时只关顶层。
 */
import { useEffect, useRef, useState } from 'react'

const INPUT = 'w-full text-sm px-3 py-2 rounded-lg border border-black/10 ' +
  'dark:border-white/10 bg-white dark:bg-white/[0.04] text-stone-900 dark:text-stone-100 ' +
  'outline-none focus:border-black/30 dark:focus:border-white/30'

const BTN_BASE = 'text-sm font-medium px-4 py-2 rounded-lg transition-colors'

export default function CardEditModal({ sys, override, onSave, onClose }) {
  // 初值 = 覆盖值（无覆盖则空——placeholder 展示内置默认文案）
  const [title, setTitle] = useState(override?.title || '')
  const [desc, setDesc] = useState(override?.desc || '')
  const titleRef = useRef(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  const commit = (payload) => { onSave(payload); onClose() }
  const save = () => commit({
    title: title.trim() || null,
    desc: desc.trim() || null,
  })

  const onKeyDown = e => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
  }

  return (
    <div
      onKeyDownCapture={onKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-black/[0.07] dark:border-white/[0.1]
          bg-white dark:bg-[#1c1b1a] p-6 shadow-2xl">
        <h3 className="text-base font-semibold mb-1">编辑卡片</h3>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-5">
          {sys.title}——留空使用内置默认文案
        </p>

        <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5">
          标题{title.trim() ? '' : `（默认：${sys.title}）`}
        </label>
        <input
          ref={titleRef} value={title} maxLength={120}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save() }}
          className={INPUT + ' mb-4'} placeholder={sys.title} aria-label="卡片标题" />

        <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5">
          描述{desc.trim() ? '' : `（默认：${sys.desc}）`}
        </label>
        <textarea
          value={desc} maxLength={300} rows={3}
          onChange={e => setDesc(e.target.value)}
          className={INPUT + ' resize-none'} placeholder={sys.desc} aria-label="卡片描述" />

        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => commit({ title: null, desc: null })}
            className="text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg px-3 py-2 transition-colors">
            恢复默认文案
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose}
              className={BTN_BASE + ' bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14]'}>
              取消
            </button>
            <button onClick={save}
              className={BTN_BASE + ' bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90'}>
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
