/**
 * 每日总结卡：时间线日期组头部的大卡。有总结时展示（可编辑/更新时间），
 * 无总结时组头显示「写今日总结」按钮。随记视觉上挂在总结卡之后（连接线）。
 */
import { useMemo, useState } from 'react'
import md from '@/shared/md'
import { Icon, moodOf, weatherIcon } from '../kit'

export default function SummaryCard({ summary, dateStr, onEdit }) {
  const html = useMemo(() => ({ __html: md.render(summary.content || '') }), [summary.content])
  const mood = moodOf(summary.mood)

  return (
    <div className="relative rounded-2xl border border-rose-500/30 bg-gradient-to-br from-rose-500/[0.08] to-transparent p-5">
      <div className="flex items-center gap-2 mb-2.5 text-[11.5px]">
        <span className="inline-flex items-center gap-1 px-2 h-6 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium">
          📝 每日总结
        </span>
        {mood && <span style={{ color: mood.color }}>{mood.emoji}</span>}
        <span className="text-stone-400 ml-auto">{summary.word_count || 0} 字</span>
      </div>
      <div onClick={() => onEdit(summary)} className="diary-prose prose-content text-sm text-stone-700 dark:text-stone-200 cursor-pointer"
        dangerouslySetInnerHTML={html} />
      <div className="flex items-center gap-1 mt-2 opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button onClick={() => onEdit(summary)}
          className="w-7 h-7 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center" title="编辑总结">
          {Icon.edit}
        </button>
      </div>
      {/* 底部连接线：随记挂在总结后 */}
      <span className="absolute left-6 -bottom-[10px] w-px h-[10px] bg-rose-500/60" aria-hidden />
    </div>
  )
}
