/**
 * 日记编辑器（全屏弹层）：日期/心情/本子 + 模板 + 引导问题 + 天气获取 +
 * Markdown 预览切换 + 停止输入自动保存（新篇首存 POST，此后 PUT）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import CodeEditor from '@/shared/CodeEditor'
import { createSaveCoordinator } from '@/shared/saveCoordinator'
import { getDataIdentity } from '@/shared/dataEpoch'
import md, { renderMermaidDiagrams } from '@/shared/md'
import { diaryCreate, diaryUpdate, diaryDelete, diaryTemplates, diaryPrompt, diaryUpsertSummary } from '../api'
import { MOODS, Icon, Confirm } from '../kit'
import { fetchWeather } from '../api-entry'

const p2 = n => String(n).padStart(2, '0')

export default function Editor({ entry, journals, onClose, onSaved, onDeleted }) {
  const isNew = !entry
  const [draftKey] = useState(() => `doublog.diary.draft.${getDataIdentity()}.${entry?.id ?? 'new'}`)
  const [availableDraft, setAvailableDraft] = useState(() => {
    try { return JSON.parse(localStorage.getItem(draftKey) || 'null') } catch { return null }
  })
  const [restoredDraft, setRestoredDraft] = useState(null)
  const [id, setId] = useState(entry?.id ?? null)
  const [date, setDate] = useState(entry?.entry_date ?? new Date().toLocaleDateString('sv-SE'))
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
  const coordinatorRef = useRef(null)
  const idRef = useRef(entry?.id ?? null)
  const callbacks = useRef({ onSaved, onClose })
  useLayoutEffect(() => { callbacks.current = { onSaved, onClose } }, [onSaved, onClose])
  const [saveError, setSaveError] = useState('')
  const [draftError, setDraftError] = useState('')
  const dirtyRef = useRef(false)

  useEffect(() => {
    diaryTemplates().then(d => d.success && setTemplates(d.data))
    diaryPrompt(date).then(d => d.success && setPrompt(d.data.prompt))
  }, [date])

  useEffect(() => {
    const coordinator = createSaveCoordinator({
      revision: entry?.revision ?? 1, debounceMs: 1200, idempotent: true,
      initialDraft: restoredDraft,
      draft: {
        write: draft => localStorage.setItem(draftKey, JSON.stringify({ ...draft, resourceId: idRef.current })),
        remove: () => localStorage.removeItem(draftKey),
      },
      save: async (snapshot, { revision, mutationId, signal }) => {
        if (!isSummary && snapshot.journal_id == null) {
          throw Object.assign(new Error('请选择日记本'), { status: 400 })
        }
        const payload = { ...snapshot, revision, mutation_id: mutationId }
        const response = isSummary
          ? await diaryUpsertSummary(payload, { signal })
          : idRef.current ? await diaryUpdate(idRef.current, payload, { signal })
            : await diaryCreate(payload, { signal })
        if (!response.success) throw Object.assign(new Error(response.message || '保存失败'), { status: response.status })
        const saved = isSummary ? response.data.summary : response.data
        idRef.current = saved.id; setId(saved.id)
        return saved
      },
      onState: state => {
        dirtyRef.current = state.dirty
        const t = new Date()
        setStatus(state.status === 'saved' ? `已保存 ${p2(t.getHours())}:${p2(t.getMinutes())}`
          : state.status === 'saving' ? '保存中…' : state.status === 'pending' ? '等待保存…'
            : ['error', 'conflict'].includes(state.status) ? '保存失败' : '')
        setSaveError(state.error?.message || '')
        setDraftError(state.draftError?.message || '')
      },
      onSaved: () => callbacks.current.onSaved?.(),
    })
    coordinatorRef.current = coordinator
    if (restoredDraft) coordinator.flush().catch(() => {})
    return () => { coordinator.dispose(); coordinatorRef.current = null }
  }, [restoredDraft]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dirtyRef.current) return
    coordinatorRef.current?.change({ content: content || '', entry_date: date,
      mood: mood || null, journal_id: isSummary ? null : journalId, weather, location })
  }, [content, mood, date, journalId, weather, location, isSummary])

  useEffect(() => { if (preview) renderMermaidDiagrams() }, [preview, content])

  const save = async () => {
    try { await coordinatorRef.current?.flush(); return true }
    catch { return false }
  }
  const close = async () => {
    if (await save()) callbacks.current.onClose?.()
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
          <span className={'text-[11px] ml-2 ' + (status === '保存失败' ? 'text-red-600 dark:text-red-400' : 'text-stone-400')}>
            {status}
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

        {availableDraft && <div role="status" className="px-5 py-3 text-sm bg-amber-500/10 space-x-3">
          <span>发现未确认保存的本地草稿。</span>
          <button type="button" className="underline" onClick={() => {
            const draft = availableDraft
            if (entry && draft.revision !== entry.revision && !draft.flight) {
              setSaveError('草稿基于旧版本，请先下载草稿对照，避免覆盖服务器的新内容'); return
            }
            const snapshot = draft.snapshot
            setContent(snapshot.content || ''); setDate(snapshot.entry_date); setMood(snapshot.mood || '')
            setJournalId(snapshot.journal_id); setWeather(snapshot.weather); setLocation(snapshot.location)
            idRef.current = draft.resourceId ?? entry?.id ?? null; setId(idRef.current)
            setAvailableDraft(null); setRestoredDraft(draft)
          }}>恢复并继续保存</button>
          <button type="button" className="underline" onClick={() => {
            localStorage.removeItem(draftKey); setAvailableDraft(null)
          }}>丢弃草稿</button>
          <button type="button" className="underline" onClick={() => {
            const blob = new Blob([JSON.stringify(availableDraft, null, 2)], { type: 'application/json' })
            const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'diary-recovered-draft.json'; link.click()
            setTimeout(() => URL.revokeObjectURL(link.href), 1000)
          }}>下载草稿</button>
        </div>}
        {(saveError || draftError) && <div role="alert" className="px-5 py-3 text-sm text-red-700 dark:text-red-300 bg-red-500/10 space-y-2">
          <p>{saveError || `本地草稿存储不可用：${draftError}。请下载当前输入备份`}。当前输入仍在编辑器中。</p>
          <button type="button" onClick={save} className="underline">重试保存</button>
          <button type="button" onClick={() => {
            const blob = new Blob([JSON.stringify({ content, entry_date: date, mood, journal_id: journalId, weather, location }, null, 2)], { type: 'application/json' })
            const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'diary-local-draft.json'; link.click()
            setTimeout(() => URL.revokeObjectURL(link.href), 1000)
          }} className="underline ml-4">下载当前输入</button>
        </div>}
        {/* 元信息区 */}
        <div inert={!!availableDraft} className="px-5 py-3.5 border-b border-black/[0.05] dark:border-white/[0.06] space-y-2.5">
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
                {journals.map(j => (
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
          <div className="flex-1 min-h-0" onKeyDownCapture={event => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); close() }
          }}><CodeEditor editorRef={taRef} value={content} readOnly={!!availableDraft}
            onChange={value => { setContent(value); dirtyRef.current = true }} language="markdown" height="100%"
            ariaLabel="日记正文" onSave={save} /></div>
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
