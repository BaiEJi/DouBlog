/**
 * 日记视图（知识库模块 tab，路由 /diary）—— Memos × Day One 超集。
 * 布局：blog 模块侧栏（ModuleShell 静态菜单含「日记」项，五视图为其 children，
 * 经 useModuleNavigation 注册 activeKey 切换）+ 页内左列「日记本」内侧栏
 * （timeline 视图，卡片式 sticky，同 confcenter namespace / assets 过滤栏先例）+
 * 主区（时间线/日历/热力图/统计/回收站）。
 * 时间线：那年今日横幅 → 快捷录入盒 → 置顶 → 日期分组（总结卡+随记卡）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { getDataIdentity } from '@/shared/dataEpoch'
import { Link } from 'react-router-dom'
import { useModuleNavigation } from '../../shared/module-navigation'
import { useDebouncedValue } from '../../shared/useDebouncedValue'

import {
  diaryList, diaryEntry, diaryJournals, diaryCreateJournal, diaryAction, diaryDelete,
  diaryDates, diaryOnThisDay, diaryExportZip, diaryUpsertSummary,
} from './api'
import { MOODS, Icon, Confirm } from './kit'
import QuickCapture from './components/QuickCapture'
import EntryCard from './components/EntryCard'
import SummaryCard from './components/SummaryCard'
import Editor from './components/Editor'
import CalendarView from './components/CalendarView'
import HeatmapView from './components/HeatmapView'
import StatsView from './components/StatsView'
import ShareDialog from './components/ShareDialog'

const VIEWS = [
  { key: 'timeline', label: '时间线', icon: Icon.timeline },
  { key: 'calendar', label: '日历', icon: Icon.calendar },
  { key: 'heatmap', label: '热力图', icon: Icon.heat },
  { key: 'stats', label: '统计', icon: Icon.stats },
  { key: 'trash', label: '回收站', icon: Icon.trash },
]

export default function DiaryPage({ dark }) {
  const [view, setView] = useState('timeline')
  const [journals, setJournals] = useState([])
  const [activeJournal, setActiveJournal] = useState(undefined)   // undefined=全部
  const [pageError, setPageError] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [mood, setMood] = useState('')
  const [pickDate, setPickDate] = useState('')
  const [otd, setOtd] = useState(null)
  const [editing, setEditing] = useState(null)      // null | 'new' | entry
  const [sharing, setSharing] = useState(null)
  const [newJournal, setNewJournal] = useState('')
  const [confirmPurge, setConfirmPurge] = useState(null)

  const loadJournals = useCallback(async () => {
    const d = await diaryJournals()
    if (d.success) setJournals(d.data)
  }, [])
  const entryQuery = useInfiniteQuery({
    queryKey: ['diary-entries', getDataIdentity(), view, activeJournal, mood, pickDate, debouncedSearch],
    enabled: view === 'timeline' || view === 'trash', initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const params = { view: view === 'trash' ? 'trash' : 'timeline', limit: 50, offset: pageParam, include_content: 0,
        journal_id: activeJournal, mood: mood || undefined, date: pickDate || undefined,
        search: debouncedSearch || undefined }
      const response = await diaryList(params, { signal })
      if (!response.success) throw new Error(response.message || '加载日记失败')
      return response.data
    },
    getNextPageParam: page => page.has_more ? page.offset + page.items.length : undefined,
  })
  const entries = entryQuery.data ? entryQuery.data.pages.flatMap(page => page.items) : null
  const trash = view === 'trash' ? entries : null
  const entryTotal = entryQuery.data?.pages[0]?.total || 0
  const entryLoading = entryQuery.isFetchingNextPage
  const loadEntries = entryQuery.refetch


  useEffect(() => { loadJournals(); diaryOnThisDay().then(d => d.success && setOtd(d.data)) }, [loadJournals])


  const groups = useMemo(() => {
    const map = new Map()
    for (const e of entries || []) {
      if (!map.has(e.entry_date)) map.set(e.entry_date, { date: e.entry_date, summary: null, notes: [] })
      const g = map.get(e.entry_date)
      if (e.kind === 'summary') g.summary = e
      else g.notes.push(e)
    }
    return [...map.values()]
  }, [entries])

  const journalById = useMemo(() => {
    const m = new Map()
    for (const j of journals) m.set(j.id, j)
    return m
  }, [journals])

  const writeSummary = async (dateStr, initial) => {
    const content = initial ?? window.prompt(`写 ${dateStr} 的每日总结：`) ?? ''
    if (!content.trim()) return
    const d = await diaryUpsertSummary({ entry_date: dateStr, content })
    if (d.success) loadEntries()
  }

  const doAction = async (id, action) => {
    const d = await diaryAction(id, action)
    if (d.success) loadEntries()
  }
  const doDelete = async id => {
    const d = await diaryDelete(id)
    if (d.success) loadEntries()
  }
  const editEntry = async entry => {
    if (!entry?.id) { setEditing(entry); return }
    try { const result = await diaryEntry(entry.id); if (!result.success) throw new Error(result.message); setEditing(result.data) }
    catch (error) { setPageError(error.message || '加载正文失败') }
  }
  const goDate = d => { setPickDate(d); setView('timeline') }

  const today = new Date()
  const dateStr = `${today.getMonth() + 1} 月 ${today.getDate()} 日 · 周${'日一二三四五六'[today.getDay()]}`

  // 注册到 blog 模块侧栏：不覆盖静态菜单（「日记」项 children 即五视图），只声明当前视图；
  // 日记本列表为页内侧栏（timeline 视图左列，同 confcenter namespace / assets 过滤栏先例）
  useModuleNavigation({ activeKey: view, onSelect: setView })

  const journalsAside = (
    <aside aria-label="日记本" className="w-52 shrink-0 sticky top-4 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] p-2">
      <div className="px-2 py-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-stone-500 dark:text-stone-400">日记本</h2>
        <span className="text-[11px] tabular-nums text-stone-400 dark:text-stone-500">{journals.length}</span>
      </div>
      <nav aria-label="日记本列表" className="space-y-0.5">
        <button type="button" onClick={() => setActiveJournal(undefined)} aria-pressed={activeJournal === undefined}
          className={'w-full flex items-center gap-2 px-2.5 h-9 rounded-lg text-[13px] transition-colors ' +
            (activeJournal === undefined ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium' : 'text-stone-600 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]')}>
          <span>📚</span>
          <span className="flex-1 min-w-0 truncate text-left">全部随记</span>
          <span className="text-[11px] text-stone-400 dark:text-stone-500 tabular-nums">
            {journals.reduce((a, j) => a + (j.entry_count || 0), 0)}
          </span>
        </button>
        {journals.map(j => (
          <button key={String(j.id)} type="button" onClick={() => setActiveJournal(j.id)} aria-pressed={activeJournal === j.id}
            className={'w-full flex items-center gap-2 px-2.5 h-9 rounded-lg text-[13px] transition-colors ' +
              (activeJournal === j.id ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium' : 'text-stone-600 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]')}>
            <span>{j.emoji}</span>
            <span className="flex-1 min-w-0 truncate text-left">{j.name}</span>
            <span className="text-[11px] text-stone-400 dark:text-stone-500 tabular-nums">{j.entry_count}</span>
          </button>
        ))}
      </nav>
      <div className="flex gap-1 px-1 mt-2">
        <input value={newJournal} onChange={e => setNewJournal(e.target.value)}
          onKeyDown={async e => {
            if (e.key === 'Enter' && newJournal.trim()) {
              const d = await diaryCreateJournal({ name: newJournal.trim() })
              if (d.success) { setNewJournal(''); loadJournals() }
            }
          }}
          placeholder="新本子名…"
          className="flex-1 min-w-0 h-7 px-2 text-[11.5px] bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 focus:border-black/30 dark:focus:border-white/30 rounded-lg outline-none placeholder:text-stone-400" />
      </div>
      <button type="button" onClick={diaryExportZip}
        className="w-full mt-1 px-2.5 h-9 text-left rounded-lg text-[13px] text-stone-600 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors">↓ 导出全部</button>
    </aside>
  )

  return (
    <div className="min-h-0 text-stone-800 dark:text-stone-100 transition-colors">
      <h1 className="text-base font-semibold mb-6">日记 · {VIEWS.find(v => v.key === view)?.label}<span className="ml-3 text-xs font-normal text-stone-500 dark:text-stone-400">{dateStr}</span></h1>
      <div className={view === 'timeline' ? 'flex gap-6 items-start' : undefined}>
        {view === 'timeline' && journalsAside}
        <main className="flex-1 min-w-0 w-full">
        {view === 'timeline' && (
          <div>
            {/* 搜索与过滤行 */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <div className="relative flex-1 min-w-[180px]">
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="搜索日记…"
                  className="w-full h-9 px-3 text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-lg outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors placeholder:text-stone-400" />
              </div>
              <div className="flex gap-0.5 bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-lg px-1.5 py-1">
                {MOODS.map(m => (
                  <button key={m.key} onClick={() => setMood(mood === m.key ? '' : m.key)} title={m.label}
                    className={'w-7 h-7 rounded-lg text-[14px] flex items-center justify-center transition-all ' +
                      (mood === m.key ? 'bg-rose-500/10 scale-110' : 'opacity-40 hover:opacity-80')}>
                    {m.emoji}
                  </button>
                ))}
              </div>
              {(mood || pickDate || search) && (
                <button onClick={() => { setMood(''); setPickDate(''); setSearch('') }}
                  className="px-2.5 h-9 rounded-lg text-xs text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 border border-black/10 dark:border-white/10">
                  清除过滤{pickDate ? ` · ${pickDate}` : ''}
                </button>
              )}
            </div>

            {/* 那年今日 */}
            {otd && (otd.past?.length > 0 || otd.random) && (
              <div className="mb-4 p-4 rounded-2xl bg-gradient-to-r from-rose-500/[0.09] to-transparent border border-rose-500/20">
                <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-rose-600 dark:text-rose-400">
                  {Icon.sparkle} 那年今日
                </div>
                {(otd.past || []).slice(0, 2).map(e => (
                  <button key={e.id} onClick={() => editEntry(e)}
                    className="block w-full text-left mb-1.5 text-[12px] text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200">
                    <b className="tabular-nums mr-1.5">{e.entry_date}</b>
                    <span className="line-clamp-1">{(e.content || '').replace(/[#*\-\n>]/g, ' ').slice(0, 60) || '（无文字）'}</span>
                  </button>
                ))}
                {otd.past?.length === 0 && otd.random && (
                  <button onClick={() => editEntry(otd.random)}
                    className="block w-full text-left text-[12px] text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">
                    <b className="mr-1.5">随机记忆 · {otd.random.entry_date}</b>
                    <span className="line-clamp-1">{(otd.random.content || '').replace(/[#*\-\n>]/g, ' ').slice(0, 60)}</span>
                  </button>
                )}
              </div>
            )}

            {/* 快捷录入 */}
            <div className="mb-5">
              <QuickCapture journals={journals} activeJournal={activeJournal}
                onSaved={() => { loadEntries(); loadJournals() }} />
            </div>

            {(pageError || entryQuery.error) && <p role="alert" className="text-sm text-red-600 dark:text-red-400 my-3">{pageError || entryQuery.error?.message}</p>}
            {/* 时间线 */}
            {!entries ? (
              <p className="text-xs text-stone-400 py-14 text-center">加载中…</p>
            ) : entries.length === 0 ? (
              <p className="text-xs text-stone-400 py-14 text-center">
                {mood || pickDate || search ? '没有匹配的随记' : '从上面写下第一条随记吧 ✍️（记得选日记本）'}
              </p>
            ) : groups.map(g => (
              <div key={g.date} className="mb-7">
                <div className="flex items-center gap-2 mb-2.5 sticky top-0 bg-stone-50 dark:bg-[#100f0e] py-1 z-10">
                  <span className="text-[12px] font-medium text-stone-400 tabular-nums">{g.date}</span>
                  <span className="text-[11px] text-stone-300 dark:text-stone-600">{g.notes.length} 条随记{g.summary ? ' · 已总结' : ''}</span>
                  <span className="flex-1 h-px bg-black/[0.05] dark:bg-white/[0.06]" />
                  <button onClick={() => g.summary ? editEntry(g.summary) : writeSummary(g.date)}
                    className={'px-2 h-6 rounded-full text-[11px] transition-colors shrink-0 ' +
                      (g.summary
                        ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-500/10'
                        : 'border border-dashed border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10')}>
                    {g.summary ? '✏️ 改总结' : '✍️ 写今日总结'}
                  </button>
                </div>
                <div className="space-y-2.5">
                  {g.summary && (
                    <SummaryCard summary={g.summary} dateStr={g.date} onEdit={editEntry} />
                  )}
                  {g.notes.map(e => (
                    <EntryCard key={e.id} entry={e} compact attached={!!g.summary}
                      journal={journalById.get(e.journal_id)}
                      onEdit={editEntry} onAction={doAction} onDelete={doDelete}
                      onShare={setSharing} />
                  ))}
                </div>
              </div>
            ))}
            {entries && entries.length < entryTotal && <button type="button" disabled={entryLoading} onClick={() => entryQuery.fetchNextPage()} className="w-full py-3 text-sm text-rose-600 dark:text-rose-400 disabled:opacity-40">
              {entryLoading ? '加载中…' : `加载更多（${entries.length}/${entryTotal}）`}
            </button>}
          </div>
        )}

        {view === 'calendar' && <CalendarView onPickDate={goDate} />}
        {view === 'heatmap' && <HeatmapView onPickDate={goDate} />}
        {view === 'stats' && <StatsView />}
        {view === 'trash' && (
          <div>

            {!trash ? <p className="text-xs text-stone-400 py-10 text-center">加载中…</p>
              : trash.length === 0 ? <p className="text-xs text-stone-400 py-14 text-center">回收站是空的</p>
                : <div className="space-y-2.5">
                  {trash.map(e => (
                    <div key={e.id} className="flex items-center gap-3 p-3.5 rounded-2xl border border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025]">
                      <div className="flex-1 min-w-0">
                        <div className="text-[11.5px] text-stone-400 tabular-nums mb-1">{e.entry_date} · {e.word_count} 字</div>
                        <div className="text-xs text-stone-600 dark:text-stone-300 line-clamp-2">
                          {(e.content || '').replace(/[#*\-\n>]/g, ' ').slice(0, 120) || '（无文字）'}
                        </div>
                      </div>
                      <button onClick={async () => { await diaryAction(e.id, 'restore'); loadEntries(); }}
                        className="px-3 h-8 rounded-lg text-xs font-medium text-stone-700 dark:text-stone-200 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14]">恢复</button>
                      <button onClick={() => setConfirmPurge(e)}
                        className="px-3 h-8 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20">彻底删除</button>
                    </div>
                  ))}
                </div>}
            {trash && trash.length < entryTotal && <button type="button" disabled={entryLoading} onClick={() => entryQuery.fetchNextPage()} className="w-full py-3 text-sm text-rose-600 dark:text-rose-400 disabled:opacity-40">加载更多（{trash.length}/{entryTotal}）</button>}
          </div>
        )}
      </main>
      </div>

      {/* 编辑器 */}
      {editing && (
        <Editor entry={editing === 'new' ? null : editing} journals={journals}
          onClose={() => setEditing(null)}
          onSaved={() => { loadEntries(); loadJournals() }}
          onDeleted={() => { loadEntries(); setEditing(null) }} />
      )}
      {/* 分享 */}
      {sharing && <ShareDialog entry={sharing} onClose={() => setSharing(false)} />}
      {confirmPurge && (
        <Confirm text={`彻底删除 ${confirmPurge.entry_date} 的这篇日记？不可恢复。`} danger
          onCancel={() => setConfirmPurge(null)}
          onOk={async () => {
            await diaryDelete(confirmPurge.id, true)
            setConfirmPurge(null)
            loadEntries()
          }} />
      )}
    </div>
  )
}
