/**
 * 快捷录入盒（Memos 式）：自动增高 textarea + 本子/心情/天气/模板 + 今日引导问题，
 * Ctrl/Cmd+Enter 立即落库，成功后抖进时间线顶部。随记必须选日记本。
 */
import { useEffect, useRef, useState } from 'react'
import { MOODS, Icon } from '../kit'
import { diaryCreate, diaryTemplates, diaryPrompt } from '../api'
import { fetchWeather } from '../api-entry'

export default function QuickCapture({ journals, activeJournal, onSaved }) {
  const [content, setContent] = useState('')
  const [mood, setMood] = useState('')
  const [jid, setJid] = useState(null)   // 本次录入写入的日记本
  const [showJ, setShowJ] = useState(false)
  const [templates, setTemplates] = useState([])
  const [prompt, setPrompt] = useState('')
  const [showTpl, setShowTpl] = useState(false)
  const [busy, setBusy] = useState(false)
  const [wx, setWx] = useState(null)          // {weather, location}
  const [wxState, setWxState] = useState('')  // '' | getting | done | denied
  const taRef = useRef(null)
  const requestRef = useRef(null)
  const [error, setError] = useState('')

  // 跟随侧栏选择：选中具体本子 → 用它；选“全部” → 退化到第一本
  useEffect(() => {
    setJid(activeJournal ?? journals[0]?.id ?? null)
  }, [activeJournal, journals])
  const curJournal = journals.find(j => j.id === jid)

  useEffect(() => {
    diaryTemplates().then(d => d.success && setTemplates(d.data))
    diaryPrompt().then(d => d.success && setPrompt(d.data.prompt))
  }, [])

  const grabWeather = async () => {
    setWxState('getting')
    const got = await fetchWeather()
    if (got) { setWx(got); setWxState('done') }
    else setWxState('denied')
  }

  const submit = async () => {
    const text = content.trim()
    if (!text || busy) return
    if (!jid) return          // 随记必须选择日记本
    setBusy(true)
    const payload = { content: text, entry_date: new Date().toLocaleDateString('sv-SE'), journal_id: jid }
    if (mood) payload.mood = mood
    if (wx?.weather) payload.weather = wx.weather
    if (wx?.location) payload.location = wx.location
    const fingerprint = JSON.stringify(payload)
    if (requestRef.current?.fingerprint !== fingerprint) requestRef.current = { fingerprint, body: { ...payload, mutation_id: crypto.randomUUID() } }
    try {
    const d = await diaryCreate(requestRef.current.body)
    if (!d.success) throw new Error(d.message || '保存失败')
    requestRef.current = null; setError('')
    if (d.success) {
      setContent(''); setMood(''); setWx(null); setWxState('')
      onSaved(d.data)
      taRef.current?.focus()
    }
    } catch (failure) { setError(failure.message || '保存失败，当前输入已保留') }
    finally { setBusy(false) }
  }

  return (
    <div className="rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-4 shadow-sm">
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>}
      <textarea
        ref={taRef}
        value={content}
        onChange={e => setContent(e.target.value)}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
        }}
        rows={content ? Math.min(10, content.split('\n').length + 1) : 2}
        placeholder={journals.length ? "此刻在想什么…（Ctrl+Enter 保存）" : "请先在左侧创建日记本"}
        className="w-full bg-transparent outline-none resize-none text-[14px] leading-relaxed placeholder:text-stone-400 diary-serif"
      />
      {/* 提示语 */}
      {prompt && !content && (
        <p className="text-[11.5px] text-stone-500 dark:text-stone-400 -mt-1 mb-2">
          ✦ {prompt}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-black/[0.05] dark:border-white/[0.06]">
        {/* 日记本（必选） */}
        {journals.length > 0 && (
          <div className="relative">
            <button onClick={() => { setShowJ(s => !s); setShowTpl(false) }}
              title="选择要写入的日记本（必选）"
              className={'h-6 px-2 rounded-full text-[11.5px] border transition-colors flex items-center gap-1 ' +
                (curJournal
                  ? 'border-rose-500/30 text-rose-600 dark:text-rose-400 bg-rose-500/10'
                  : 'border-red-500/30 text-red-600 dark:text-red-400')}>
              {curJournal ? `${curJournal.emoji || '📔'} ${curJournal.name}` : '选日记本'} ▾
            </button>
            {showJ && (
              <div className="absolute z-20 mt-1 py-1 w-40 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1c1b1a] shadow-lg">
                {journals.map(j => (
                  <button key={j.id}
                    onClick={() => { setJid(j.id); setShowJ(false); taRef.current?.focus() }}
                    className={'w-full text-left px-3 h-8 text-xs flex items-center gap-1.5 ' +
                      (j.id === jid ? 'text-rose-600 dark:text-rose-400 bg-rose-500/10' : 'text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/[0.05]')}>
                    <span>{j.emoji || '📔'}</span>
                    <span className="truncate flex-1">{j.name}</span>
                    <span className="text-[11px] text-stone-400 tabular-nums">{j.entry_count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {/* 心情 */}
        <div className="flex gap-0.5">
          {MOODS.map(m => (
            <button key={m.key} onClick={() => setMood(mood === m.key ? '' : m.key)} title={m.label}
              className={'w-7 h-7 rounded-lg text-[15px] flex items-center justify-center transition-all ' +
                (mood === m.key ? 'bg-rose-500/10 scale-110' : 'opacity-45 hover:opacity-90')}>
              {m.emoji}
            </button>
          ))}
        </div>
        {/* 天气 */}
        <button onClick={grabWeather} title="记录当前天气与位置"
          className={'h-6 px-2 rounded-full text-[11.5px] border transition-colors ' +
            (wxState === 'done' ? 'border-rose-500/30 text-rose-600 dark:text-rose-400 bg-rose-500/10'
              : 'border-black/[0.06] dark:border-white/[0.08] text-stone-400 hover:text-stone-600 dark:hover:text-stone-300')}>
          {wxState === 'getting' ? '定位中…' : wxState === 'done' ? `${wx.weather.text} ${Math.round(wx.weather.temp)}°` : wxState === 'denied' ? '🚫定位' : '🌤️天气'}
        </button>
        {/* 模板 */}
        <div className="relative">
          <button onClick={() => { setShowTpl(s => !s); setShowJ(false) }}
            className="h-6 px-2 rounded-full border border-black/[0.06] dark:border-white/[0.08] text-[11.5px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-300">
            📋模板
          </button>
          {showTpl && (
            <div className="absolute z-20 mt-1 py-1 w-40 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1c1b1a] shadow-lg">
              {templates.map(t => (
                <button key={t.key}
                  onClick={() => { setContent(c => (c ? c + '\n\n' : '') + t.body); setShowTpl(false); taRef.current?.focus() }}
                  className="w-full text-left px-3 h-8 text-xs text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/[0.05]">
                  {t.emoji} {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={submit} disabled={!content.trim() || busy || !jid}
          className="ml-auto px-4 h-8 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90 text-sm font-medium transition-opacity disabled:opacity-40">
          {busy ? '记录中…' : '记下'}
        </button>
      </div>
    </div>
  )
}
