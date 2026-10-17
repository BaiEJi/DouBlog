/**
 * 公开分享页 /diary/s/:token —— 免登录只读（无 Basic 头），柔和阅读排版。
 */
import { useEffect, useMemo, useState } from 'react'
import md from '@/shared/md'
import { diaryPublicShare } from './api'
import { moodOf } from './kit'

export default function PublicShare() {
  const token = location.pathname.split('/').pop()
  const [entry, setEntry] = useState(null)
  const [state, setState] = useState('loading')   // loading | ok | gone

  useEffect(() => {
    diaryPublicShare(token).then(d => {
      if (d.success) { setEntry(d.data.entry); setState('ok') }
      else setState('gone')
    }).catch(() => setState('gone'))
  }, [token])

  const html = useMemo(() => ({ __html: md.render(entry?.content || '') }), [entry])
  const mood = moodOf(entry?.mood)

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100">
      <div className="max-w-3xl mx-auto px-6 py-14">
        <div className="text-center mb-10">
          <span className="text-[11px] font-medium uppercase tracking-[0.3em] text-stone-400">DouBlog · 日记分享</span>
        </div>
        {state === 'loading' && <p className="text-center text-[13px] text-stone-400 py-10">加载中…</p>}
        {state === 'gone' && (
          <div className="text-center py-16">
            <p className="text-[15px] text-stone-400 mb-2">🕯️ 分享不存在或已过期</p>
            <p className="text-[12px] text-stone-300 dark:text-stone-600">链接可能已被作者撤销或到达有效期</p>
          </div>
        )}
        {state === 'ok' && (
          <article>
            <div className="flex items-center justify-center gap-3 mb-8 text-[12px] text-stone-400">
              <span className="tabular-nums">{entry.entry_date}</span>
              {mood && <span style={{ color: mood.color }}>{mood.emoji} {mood.label}</span>}
              <span>{entry.word_count} 字</span>
            </div>
            <div className="diary-prose prose-content text-[15px] leading-[2]" dangerouslySetInnerHTML={html} />
            <p className="text-center text-[11px] text-stone-300 dark:text-stone-600 mt-14">— 由 DouBlog 日记分享 —</p>
          </article>
        )}
      </div>
    </div>
  )
}
