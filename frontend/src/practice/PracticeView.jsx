/**
 * 刷题（practice）主视图，由 PracticePage（顶级路由 /practice）挂载。
 * 内部三子视图：题库 / 复习（徽标=今日待复习数）/ 统计；详情与新增/编辑为覆盖层
 * （点击题目 → 详情 → 编辑 → 返回），用 state 切换而非 URL（同 steamidler 子模块先例）。
 * 标签列表由本视图统一加载（列表筛选 / 表单 / 详情共用），新建标签统一走 onCreateTag。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { listTags, createTag, reviewToday } from './api'
import { Icon } from '../todo/kit'
import ProblemList from './components/ProblemList'
import ProblemDetail from './components/ProblemDetail'
import ProblemForm from './components/ProblemForm'
import ReviewQueue from './components/ReviewQueue'
import StatsPanel from './components/StatsPanel'

const SUBS = [
  { key: 'list', label: '题库' },
  { key: 'review', label: '复习' },
  { key: 'stats', label: '统计' },
]

export default function PracticeView({ toast, dark }) {
  const [sub, setSub] = useState('list')
  const [detailId, setDetailId] = useState(null)
  // 覆盖层：{ id: 题目 id 或 null(新增), from: 'list' | 'detail' }
  const [edit, setEdit] = useState(null)
  const [dueCount, setDueCount] = useState(0)
  // R11-2：复习队列响应的 today（todo 设置时区）——题目详情的逾期判定基准，
  // 与浏览器本地时钟解耦（时区不同/跨日零点时不再误判）
  const [serverToday, setServerToday] = useState(null)
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [tags, setTags] = useState([])

  // 卸载守卫：异步回调 setState 前确认组件仍挂载
  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])

  const refreshDue = useCallback(() => {
    reviewToday()
      .then(res => {
        if (!aliveRef.current) return
        setDueCount((res || []).length)
        setServerToday(res?.today || null)
      })
      .catch(() => { /* 后端不可用时徽标归零 */ })
  }, [])

  const reloadTags = useCallback(() => {
    listTags()
      .then(res => { if (aliveRef.current) setTags(res) })
      .catch(() => { /* 标签加载失败：筛选/表单退化为空 */ })
  }, [])

  useEffect(() => { refreshDue(); reloadTags() }, [refreshDue, reloadTags])

  /** 现场新建标签：POST 创建 → 乐观合并进本地标签列表（不逐次重拉，由调用方决定何时统一 reload）→ 返回新标签 */
  const onCreateTag = async name => {
    const tag = await createTag({ name: name.trim() })
    if (tag?.id && aliveRef.current) {
      setTags(list => (list.some(t => t.id === tag.id) ? list : [...list, tag]))
    }
    return tag
  }

  const bump = () => setRefreshSignal(x => x + 1)

  const inOverlay = edit != null || detailId != null

  return (
    <div className="space-y-4">
      {/* ── 子视图头（覆盖层态隐藏） ── */}
      {!inOverlay && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex p-0.5 rounded-lg bg-black/[0.05] dark:bg-white/[0.06]">
            {SUBS.map(s => {
              const active = sub === s.key
              return (
                <button type="button" key={s.key} onClick={() => setSub(s.key)}
                  className={'px-3 h-7 rounded-md text-xs transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ' +
                    (active
                      ? 'bg-white dark:bg-white/[0.12] shadow-sm font-medium text-stone-900 dark:text-stone-100'
                      : 'text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300')}>
                  {s.label}
                  {s.key === 'review' && dueCount > 0 && (
                    <span className="min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 text-center tabular-nums">
                      {dueCount > 99 ? '99+' : dueCount}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <span className="flex-1" />
          <button type="button" onClick={() => setEdit({ id: null, from: 'list' })}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 transition-colors">
            {Icon.plus}新增题目
          </button>
        </div>
      )}

      {/* ── 覆盖层：编辑（新增/编辑） ── */}
      {edit != null ? (
        <ProblemForm
          key={edit.id || 'new'}
          problemId={edit.id}
          dark={dark}
          toast={toast}
          tags={tags}
          onCreateTag={onCreateTag}
          reloadTags={reloadTags}
          onBack={() => setEdit(null)}
          onSaved={savedId => {
            bump()
            refreshDue()
            setEdit(null)
            // 编辑已有题：回详情页（会重拉最新内容）；新建：回题库列表
            if (savedId) setDetailId(savedId)
          }} />
      ) : detailId != null ? (
        /* ── 覆盖层：详情 ── */
        <ProblemDetail
          id={detailId}
          dark={dark}
          toast={toast}
          today={serverToday}
          onBack={() => setDetailId(null)}
          onEdit={id => setEdit({ id, from: 'detail' })}
          onDeleted={() => { setDetailId(null); bump(); refreshDue() }}
          onChanged={() => { bump(); refreshDue() }} />
      ) : (
        /* ── 基础子视图 ── */
        <>
          {sub === 'list' && (
            <ProblemList
              toast={toast}
              tags={tags}
              onCreateTag={onCreateTag}
              refreshSignal={refreshSignal}
              onImported={bump}
              onOpen={id => setDetailId(id)} />
          )}
          {sub === 'review' && (
            <ReviewQueue
              toast={toast}
              dark={dark}
              onReviewed={() => { refreshDue(); bump() }} />
          )}
          {sub === 'stats' && <StatsPanel toast={toast} dark={dark} />}
        </>
      )}
    </div>
  )
}
