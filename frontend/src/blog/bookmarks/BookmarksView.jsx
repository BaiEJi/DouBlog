/**
 * 书签与稍后阅读主视图（知识库模块 tab，路由 /bookmarks，由 BookmarksPage 挂载）。
 * 五子视图：收藏夹 / 稍后阅读（徽标=待读数）/ 统计 / 工具 / 回收站；
 * 详情与收录/编辑为覆盖层（state 切换而非 URL，同 practice 先例）。
 * 分类与标签由本视图统一加载（筛选/表单/分类管理共用）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { listCategories, listTags, listItems } from './api'
import { Icon } from '@/shared/ui/kit'
import { useModuleNavigation } from '../../shared/module-navigation'
import ListView from './components/ListView'
import QueueView from './components/QueueView'
import StatsView from './components/StatsView'
import ToolsView from './components/ToolsView'
import TrashView from './components/TrashView'
import ItemForm from './components/ItemForm'
import ItemDetail from './components/ItemDetail'
import CategoryManager from './components/CategoryManager'

const SUBS = [
  { key: 'shelf', label: '收藏夹' },
  { key: 'queue', label: '稍后阅读' },
  { key: 'stats', label: '统计' },
  { key: 'tools', label: '工具' },
  { key: 'trash', label: '回收站' },
]

export default function BookmarksView({ toast, dark }) {
  const [sub, setSub] = useState('shelf')
  const [detailId, setDetailId] = useState(null)
  // 覆盖层：{ id: 书签 id 或 null(新增) }
  const [edit, setEdit] = useState(null)
  const [catOpen, setCatOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [categories, setCategories] = useState([])
  const [tags, setTags] = useState([])

  // 卸载守卫：异步回调 setState 前确认组件仍挂载
  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])

  const reloadCategories = useCallback(() => {
    listCategories().then(d => { if (aliveRef.current) setCategories(d) }).catch(() => {})
  }, [])
  const reloadTags = useCallback(() => {
    listTags().then(d => { if (aliveRef.current) setTags(d) }).catch(() => {})
  }, [])
  const refreshUnread = useCallback(() => {
    listItems({ status: 'unread', page_size: 1 })
      .then(res => { if (aliveRef.current) setUnreadCount(res?.total ?? 0) })
      .catch(() => { if (aliveRef.current) setUnreadCount(0) })
  }, [])

  useEffect(() => { reloadCategories(); reloadTags(); refreshUnread() },
    [reloadCategories, reloadTags, refreshUnread])

  const bump = useCallback(() => {
    setRefreshSignal(x => x + 1)
    reloadCategories()
    reloadTags()
    refreshUnread()
  }, [reloadCategories, reloadTags, refreshUnread])

  // 注册到 blog 模块侧栏：不覆盖静态菜单（「书签 · 稍后阅读」项 children 即五子视图），
  // 只声明当前视图；待读徽标经 badges 合并到「稍后阅读」子项
  useModuleNavigation({
    activeKey: sub,
    onSelect: key => { setSub(key); setDetailId(null); setEdit(null) },
    badges: { queue: unreadCount || undefined },
  })

  const inOverlay = edit != null || detailId != null

  return (
    <div className="space-y-4">
      {/* ── 子视图头（覆盖层态隐藏） ── */}
      {!inOverlay && (
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-base font-semibold">书签 · {SUBS.find(s => s.key === sub)?.label}</h1>
          <span className="flex-1" />
          <button type="button" onClick={() => setEdit({ id: null })}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors">
            {Icon.plus}收录网址</button>
        </div>
      )}

      {/* ── 覆盖层：收录 / 编辑 ── */}
      {edit != null ? (
        <ItemForm
          key={edit.id || 'new'}
          itemId={edit.id}
          categories={categories}
          tags={tags}
          toast={toast}
          onBack={() => setEdit(null)}
          onSaved={savedId => {
            bump()
            setEdit(null)
            if (savedId) setDetailId(savedId)
          }} />
      ) : detailId != null ? (
        /* ── 覆盖层：详情 ── */
        <ItemDetail
          id={detailId}
          categories={categories}
          toast={toast}
          onBack={() => setDetailId(null)}
          onEdit={id => setEdit({ id })}
          onChanged={bump}
          onDeleted={() => { setDetailId(null); bump() }} />
      ) : (
        /* ── 基础子视图 ── */
        <>
          {sub === 'shelf' && (
            <ListView
              toast={toast}
              categories={categories}
              tags={tags}
              refreshSignal={refreshSignal}
              onChanged={bump}
              onOpenDetail={id => setDetailId(id)}
              onEdit={id => setEdit({ id })}
              onManageCategories={() => setCatOpen(true)} />)}
          {sub === 'queue' && (
            <QueueView
              toast={toast}
              refreshSignal={refreshSignal}
              onChanged={bump}
              onOpenDetail={id => setDetailId(id)} />)}
          {sub === 'stats' && <StatsView toast={toast} dark={dark} refreshSignal={refreshSignal} />}
          {sub === 'tools' && <ToolsView toast={toast} onChanged={bump} />}
          {sub === 'trash' && <TrashView toast={toast} refreshSignal={refreshSignal} onChanged={bump} />}
        </>
      )}

      {/* ── 分类管理模态 ── */}
      <CategoryManager
        open={catOpen}
        onClose={() => setCatOpen(false)}
        categories={categories}
        onChanged={bump}
        toast={toast} />
    </div>
  )
}
