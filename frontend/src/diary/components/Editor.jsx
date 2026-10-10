/**
 * 日记编辑器（全屏弹层）：日期/心情/标签/本子 + 模板 + 引导问题 + 天气获取 +
 * Markdown 预览切换 + 停止输入自动保存（新篇首存 POST，此后 PUT）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import md, { renderMermaidDiagrams } from '@/shared/md'
import { diaryCreate, diaryUpdate, diaryDelete, diaryTemplates, diaryPrompt, diaryUpsertSummary } from '../api'
import { MOODS, Icon, Confirm } from '../kit'
import { fetchWeather } from '../api-entry'

const p2 = n => String(n).padStart(2, '0')

export default function Editor({ entry, journals, onClose, onSaved, onDeleted }) {
  const isNew = !entry
  const [id, setId] = useState(entry?.id ?? null)
  const [date, setDate] = useState(entry?.entry_date ?? new Date().toISOString().slice(0, 10))
  const [content, setContent] = useState(entry?.content ?? '')
  const [mood, setMood] = useState(entry?.mood ?? '')
  const isSummary = entry?.kind === 'summary'
  const [journalId, setJournalId] = useState(entry?.journal_id ?? null)
  const [weather, setWeather] = useState(entry?.weather ?? null)
  const [location, setLocation] = useState(entry?.location ?? null)
  const [preview, setPreview] = useState(false)
  const [status, setStatus] = useState('')          // '' | saving | saved HH:MM | fail
  const [prompt, setPrompt] = useState('')
  const [templates, setTemplates] = useState([])
  const [showTpl, setShowTpl] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const taRef = useRef(null)
  const debounceRef = useRef(null)
  const dirtyRef = useRef(false)

  useEffect(() => {
    diaryTemplates().then(d => d.success && setTemplates(d.data))
    diaryPrompt(date).then(d => d.success && setPrompt(d.data.prompt))
  }, [date])

  // 自动保存（停止输入 1.2s）
  useEffect(() => {
    if (!dirtyRef.current) return
    setStatus('saving')
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(save, 1200)
    return () => clearTimeout(debounceRef.current)
  }, [content, mood, date, journalId, weather, location])

  useEffect(() => {
    if (preview) renderMermaidDiagrams()
  }, [preview, content])

  const save = async () => {
    if (!isSummary && journalId == null) { setStatus('fail'); return }
    if (isSummary) {
      const d = await diaryUpsertSummary({ entry_date: date, content: content || '', mood: mood || null })
      if (d.success) {
        dirtyRef.current = false
        const t = new Date()
        setStatus(`已保存 ${p2(t.getHours())}:${p2(t.getMinutes())}`)
        if (!id) setId(d.data.summary.id)
        onSaved?.()
      } else setStatus('fail')
      return
    }
    const payload = {
      content: content || '',
      entry_date: date,
      mood: mood || null,
      journal_id: journalId,
      ...(weather ? { weather } : {}),
      ...(location ? { location } : {}),
    }
    const d = id
      ? await diaryUpdate(id, payload)
      : await diaryCreate(payload)
    if (d.success) {
      dirtyRef.current = false
      const t = new Date()
      setStatus(`已保存 ${p2(t.getHours())}:${p2(t.getMinutes())}`)
      if (!id) { setId(d.data.id); onSaved?.() } else onSaved?.()
    } else {
      setStatus('fail')
    }
  }

  const close = () => {
    clearTimeout(debounceRef.current)
    if (dirtyRef.current || (isNew && content.trim())) {
      save().then(onClose)
    } else onClose()
  }

  const html = useMemo(() => ({ __html: md.render(content || '') }), [content])

  const grabWeather = async () => {
    const got = await fetchWeather()
    if (got) { setWeather(got.weather); setLocation(got.location); dirtyRef.current = true }
  }

  return (
    <div className="fixed inset-0 z-40 bg-stone-100/80 dark:bg-black/60 backdrop-blur-sm flex justify-end"
      onClick={close}>
      <div className="w-full max-w-[860px] h-full bg-stone-50 dark:bg-[#141312] shadow-2xl flex flex-col animate-fade-in"
        onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center gap-2 px-5 h-14 border-b border-black/[0.06] dark:border-white/[0.07]">
          <span className="text-sm font-semibold">{isSummary ? (isNew ? '写每日总结' : '编辑每日总结') : (isNew ? '写随记' : '编辑随记')}</span>
          <span className={'text-[11px] ml-2 ' + (status === 'fail' ? 'text-red-600 dark:text-red-400' : 'text-stone-400')}>
            {status === 'saving' ? '保存中…' : status}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {id && (
              <button onClick={() => setConfirmDel(true)} title="移入回收站"
                className="w-8 h-8 rounded-lg text-stone-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center">{Icon.trash}</button>
            )}
            <button onClick={close}
              className="px-3 h-8 rounded-lg text-xs font-medium text-stone-700 dark:text-stone-200 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14]">完成</button>
          </div>
        </div>

        {/* 元信息区 */}
        <div className="px-5 py-3.5 border-b border-black/[0.05] dark:border-white/[0.06] space-y-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <input type="date" value={date} onChange={e => { setDate(e.target.value); dirtyRef.current = true }}
              className="h-8 px-2.5 text-xs tabular-nums bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 focus:border-black/30 dark:focus:border-white/30 rounded-lg outline-none" />
            <div className="flex gap-0.5">
              {MOODS.map(m => (
                <button key={m.key} onClick={() => { setMood(mood === m.key ? '' : m.key); dirtyRef.current = true }} title={m.label}
                  className={'w-7 h-7 rounded-lg text-[15px] flex items-center justify-center transition-all ' +
                    (mood === m.key ? 'bg-rose-500/10 scale-110' : 'opacity-40 hover:opacity-90')}>
                  {m.emoji}
                </button>
              ))}
            </div>
            {!isSummary && (
              <select value={journalId == null ? '' : journalId}
                onChange={e => { setJournalId(e.target.value ? +e.target.value : null); dirtyRef.current = true }}
                className={'h-8 px-2 text-xs bg-white dark:bg-white/[0.04] border rounded-lg outline-none ' +
                  (journalId == null ? 'border-red-500/50' : 'border-black/10 dark:border-white/10')}>
                <option value="" disabled>选择日记本（必选）</option>
                {journals.filter(j => !j.virtual).map(j => (
                  <option key={String(j.id)} value={j.id}>{j.emoji} {j.name}</option>
                ))}
              </select>
            )}
            {isSummary && (
              <span className="px-2 h-8 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[11.5px] inline-flex items-center">📝 每日总结</span>
            )}
            <button onClick={grabWeather} title="记录天气与位置"
              className="h-8 px-2.5 rounded-lg text-xs border border-black/10 dark:border-white/10 text-stone-500 hover:text-stone-700 dark:hover:text-stone-300">
              {weather ? `${weather.text || ''} ${weather.temp != null ? Math.round(weather.temp) + '°' : ''}` : '🌤️ 天气'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative ml-auto">
              <button onClick={() => setShowTpl(s => !s)}
                className="h-6 px-2 rounded-full border border-black/10 dark:border-white/10 text-[11px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-300">
                📋 插入模板
              </button>
              {showTpl && (
                <div className="absolute right-0 z-20 mt-1 py-1 w-40 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1c1b1a] shadow-lg">
                  {templates.map(t => (
                    <button key={t.key}
                      onClick={() => { setContent(c => (c ? c + '\n\n' : '') + t.body); setShowTpl(false); dirtyRef.current = true; taRef.current?.focus() }}
                      className="w-full text-left px-3 h-8 text-xs text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/[0.05]">
                      {t.emoji} {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setPreview(p => !p)}
              className="h-6 px-2 rounded-full border border-black/10 dark:border-white/10 text-[11px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-300">
              {preview ? '✏️ 编辑' : '👁 预览'}
            </button>
          </div>
          {prompt && !isSummary && !preview && !content && (
            <p className="text-[11.5px] text-stone-500 dark:text-stone-400">✦ {prompt}</p>
          )}
        </div>

        {/* 正文 */}
        {preview ? (
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="diary-prose prose-content text-[14px]" dangerouslySetInnerHTML={html} />
          </div>
        ) : (
          <textarea ref={taRef} value={content}
            onChange={e => { setContent(e.target.value); dirtyRef.current = true }}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { save(); close() } }}
            placeholder="写点什么…（Ctrl+Enter 保存退出）"
            className="flex-1 resize-none outline-none bg-transparent px-6 py-5 text-[14px] leading-[1.9] diary-serif placeholder:text-stone-400" />
        )}
      </div>
      {confirmDel && (
        <Confirm text="移入回收站？" danger
          onCancel={() => setConfirmDel(false)}
          onOk={async () => {
            setConfirmDel(false)
            if (id) { await diaryDelete(id); onDeleted?.() }
          }} />
      )}
    </div>
  )
}
