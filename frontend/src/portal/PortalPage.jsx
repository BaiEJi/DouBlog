/**
 * 统一入口（门户）页 `/`：各系统卡片按**自定义分组**展示——
 * - 每个模块卡片可拖入任意分组（跨组拖拽 / 组内拖拽排序，dnd-kit 多容器）
 * - 分组本身可拖拽排序（拖组头把手）；分组可新建 / 重命名（双击组名）/ 删除
 * - 卡片标题与描述可编辑（hover 铅笔按钮 → 弹窗；空 = 用内置默认文案）
 * - 布局（分组 / 顺序 / 文案覆盖）全量持久化在服务端 system 模块表
 *   （system_home_groups / system_home_cards，GET/PUT/DELETE /api/home/layout）；
 *   localStorage 仅作首屏缓存（doublog_portal_layout_v2），服务端为唯一事实源；
 *   旧 doublog_portal_layout（分组）/ doublog_portal_order（平铺序）在服务端
 *   为空时自动一次性迁移上存
 * - 头部「恢复默认」清空服务端布局回默认单组
 * 鼠标：拖动 6px 激活；拖完 120ms 内吞 click 防误跳转。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  closestCenter, pointerWithin, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, rectSortingStrategy,
  sortableKeyboardCoordinates, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { API_BASE } from '../shared/client'
import { clashAvailability } from '../clash/api'
import { SYSTEMS, SYS_BY_KEY } from './systems'
import { fetchHomeLayout, saveHomeLayout, resetHomeLayout } from './api'
import CardEditModal from './CardEditModal'
import { advanceDataEpoch, getDataIdentity } from '../shared/dataEpoch'
import { createSaveCoordinator } from '../shared/saveCoordinator'

function logout() {
  advanceDataEpoch()
  fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' })
    .catch(() => {})
    .finally(() => { window.location.href = '/login' })
}

const CARD = 'group text-left p-6 rounded-3xl border transition-all duration-200 ' +
  'border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] ' +
  'hover:border-black/[0.18] dark:hover:border-white/[0.2] hover:shadow-md hover:-translate-y-0.5'

const ICON_BOX = 'w-11 h-11 rounded-2xl flex items-center justify-center mb-4 transition-transform group-hover:scale-105'

const PENCIL = (
  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none">
    <path d="M12.8 3.4a2.6 2.6 0 0 1 3.7 3.7l-1.9 1.9-3.7-3.7 1.9-1.9Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="m10.1 6.1-6.5 6.5a2.6 2.6 0 0 0-.7 1.3l-.5 2.7 2.7-.5a2.6 2.6 0 0 0 1.3-.7l6.5-6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// ─── 布局读取与规整（服务端为事实源，localStorage 仅首屏缓存）──

const LAYOUT_KEY = 'doublog_portal_layout_v2'
const DEFAULT_GROUP_NAME = '常用'
const scopedKey = key => `${key}:${getDataIdentity()}`

const gid = () => 'g_' + Math.random().toString(36).slice(2, 9)

const defaultGroups = () => [{ id: gid(), name: DEFAULT_GROUP_NAME, cards: SYSTEMS.map(s => s.key) }]

function writeCache(groups, overrides) {
  try {
    localStorage.setItem(scopedKey(LAYOUT_KEY), JSON.stringify({ groups: groups.map(g => ({ id: g.id, name: g.name, cards: g.cards })), overrides }))
  } catch { /* 存储禁用时仅本次会话生效 */ }
}

function clearCache() {
  try {
    localStorage.removeItem(scopedKey(LAYOUT_KEY))
  } catch { /* 同上 */ }
}

/** 首屏缓存（v2）；损坏回退 null（走默认 + 服务器同步） */
function readCached() {
  try {
    const raw = localStorage.getItem(scopedKey(LAYOUT_KEY))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.groups) && parsed.groups.length
      && parsed.groups.every(g => g && typeof g.name === 'string' && Array.isArray(g.cards))
      && typeof parsed.overrides === 'object' && parsed.overrides) {
      return { groups: parsed.groups.map(g => ({ id: g.id || gid(), name: g.name, cards: g.cards })), overrides: parsed.overrides }
    }
  } catch { /* 损坏 → 回退 */ }
  return null
}

/**
 * 布局自愈规整：过滤未知卡（服务端可能存有已下线模块）、跨组重复卡去重、
 * 新增模块（未出现在任何组）追加到末组；覆盖表收敛到布局内的卡。
 */
function normalize(groups, overrides) {
  const seen = new Set()
  // 未知卡（服务端存有已下线模块）滤除；跨组重复卡只保留首次出现；空组保留待拖入
  const healed = groups.map(g => ({ ...g, cards: g.cards.filter(k => SYS_BY_KEY[k] && !seen.has(k) && seen.add(k)) }))
  for (const s of SYSTEMS) {
    if (!seen.has(s.key)) healed[healed.length - 1]?.cards.push(s.key)
  }
  const keys = new Set(healed.flatMap(g => g.cards))
  const ov = Object.fromEntries(Object.entries(overrides || {})
    .filter(([k]) => keys.has(k))
    .map(([k, v]) => [k, { title: v?.title || null, desc: v?.desc || null }]))
  return { groups: healed, overrides: ov }
}

/** 是否等价于"出厂默认"（单组 / 默认名 / 全卡原序 / 无覆盖）——决定要不要迁移上存 */


/** 服务端布局 → 组件态（cards 只留 key；title/desc 抽成覆盖表） */
function fromServer(data) {
  const groups = (data?.groups || []).map(g => ({ id: g.id || gid(), name: g.name, cards: (g.cards || []).map(c => c.key) }))
  const overrides = {}
  for (const g of data?.groups || []) {
    for (const c of g.cards || []) {
      if (c.title || c.desc) overrides[c.key] = { title: c.title || null, desc: c.desc || null }
    }
  }
  return { groups, overrides }
}

/** 组件态 → PUT 载荷（每卡带覆盖；服务端全删全插） */
const buildPayload = (groups, overrides) => ({
  groups: groups.map(g => ({
    name: g.name,
    cards: g.cards.map(k => ({
      key: k,
      title: overrides[k]?.title ?? null,
      desc: overrides[k]?.desc ?? null,
    })),
  })),
})

/**
 * 多容器落点判定（修复"拖不进空分组"，2026-10-13）：
 * 先取指针所在矩形（pointerWithin，多个包含时按角距排序——卡片天然排在其所在
 * 大 section 之前），指针不在任何矩形内（页面留白/拖出边界）再回退中心距。
 */
const portalCollision = args => {
  const within = pointerWithin(args)
  return within.length ? within : closestCenter(args)
}

/** 内置定义 + 文案覆盖 → 展示用卡片定义 */
const resolveSys = (key, overrides) => {
  const sys = SYS_BY_KEY[key]
  const ov = overrides?.[key]
  return ov ? { ...sys, title: ov.title || sys.title, desc: ov.desc || sys.desc } : sys
}

/** 卡片正文（槽位卡 / 悬浮克隆共用）：图标 + 标题 + 描述 + 进入提示 */
function CardBody({ sys, disabled }) {
  return (
    <>
      <div className={ICON_BOX + ' ' + sys.box}>{sys.icon}</div>
      <div className="text-[15px] font-medium mb-1">{sys.title}</div>
      <div className="text-[12.5px] text-stone-400 leading-relaxed">{sys.desc}</div>
      <div className={'mt-4 text-[12px] text-stone-400 transition-all ' +
        (disabled
          ? 'text-stone-400 dark:text-stone-500'
          : 'opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0')}>
        {disabled ? '😼 未安装 clashctl' : '进入 →'}
      </div>
    </>
  )
}

/** 可排序卡片：拖拽经 DragOverlay 悬浮跟随（原槽位显示虚线占位）；data 标记类型与所属组。
 *  hover 出现铅笔按钮——编辑标题与描述（阻止冒泡，与拖拽/跳转互不干扰）。
 *  disabled（如本机未装 clashctl）：置灰去饱和、不可进入，但仍可拖拽归置。 */
function PortalCard({ sys, groupId, guardClick, disabled, onEdit }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: sys.key, data: { type: 'card', group: groupId } })
  return (
    <div
      ref={setNodeRef} {...attributes} {...listeners} data-card={sys.key}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="relative group/card">
      {!isDragging && (
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); onEdit(sys.key) }}
          title="编辑标题与描述" aria-label={'编辑 ' + sys.title}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-lg flex items-center justify-center
            bg-white/90 dark:bg-[#1c1b1a]/90 border border-black/[0.07] dark:border-white/[0.1]
            text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 shadow-sm
            opacity-0 group-hover/card:opacity-100 transition-opacity">
          {PENCIL}
        </button>
      )}
      {isDragging ? (
        // 原槽位占位（虚线框保持网格高度，随其他卡归位动画流动）
        <div className="h-full min-h-[150px] rounded-3xl border-2 border-dashed
          border-black/[0.12] dark:border-white/[0.16] bg-black/[0.02] dark:bg-white/[0.02]" />
      ) : disabled ? (
        <div className={'flex flex-col h-full p-6 rounded-3xl border cursor-not-allowed select-none ' +
          'border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] ' +
          'opacity-55 grayscale'} title="未安装 clashctl，安装后自动恢复">
          <CardBody sys={sys} disabled />
        </div>
      ) : (
        <Link
          to={sys.to}
          onClick={e => { if (guardClick.current) { e.preventDefault(); e.stopPropagation() } }}
          className={'flex flex-col h-full ' + CARD + ' cursor-grab active:cursor-grabbing'}>
          <CardBody sys={sys} />
        </Link>
      )}
    </div>
  )
}

/** 拖拽悬浮层卡片：静态克隆（非交互），微倾斜 + 大投影呈现"拎起来"的手感 */
function OverlayCard({ sys, width, height }) {
  return (
    <div
      style={{ width, height }}
      className="flex flex-col text-left p-6 rounded-3xl border rotate-2 scale-[1.04]
        border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-[#1c1b1a]
        shadow-2xl ring-1 ring-black/10 dark:ring-white/20 cursor-grabbing select-none">
      <CardBody sys={sys} />
    </div>
  )
}

/** 分组区块：组头（拖把手 + 名称双击改名 + 计数 + 删除）+ 组内卡网格（空组显示放置占位） */
function GroupSection({ group, total, overrides, onRename, onDelete, guardClick, isCardDisabled, onEditCard }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(group.name)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id, data: { type: 'group' } })

  const commit = () => {
    const name = draft.trim()
    if (name && name !== group.name) onRename(group.id, name)
    else setDraft(group.name)
    setEditing(false)
  }

  return (
    <section
      ref={setNodeRef}
      data-gid={group.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'relative z-30 opacity-90' : 'relative'}>
      <div className="flex items-center gap-2 mb-3">
        <button
          {...attributes} {...listeners} title="拖拽调整分组顺序"
          className="w-7 h-7 -ml-1 rounded-lg text-stone-400 dark:text-stone-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.07] cursor-grab active:cursor-grabbing shrink-0"
          aria-label={'拖拽排序分组 ' + group.name}>
          <svg className="w-4 h-4 mx-auto" viewBox="0 0 20 20" fill="currentColor">
            <circle cx="7" cy="4.5" r="1.3" /><circle cx="13" cy="4.5" r="1.3" />
            <circle cx="7" cy="10" r="1.3" /><circle cx="13" cy="10" r="1.3" />
            <circle cx="7" cy="15.5" r="1.3" /><circle cx="13" cy="15.5" r="1.3" />
          </svg>
        </button>
        {editing ? (
          <input
            autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(group.name); setEditing(false) } }}
            className="w-40 px-2 py-1 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.04] text-sm text-stone-900 dark:text-stone-100 outline-none focus:border-black/30 dark:focus:border-white/30"
            aria-label="分组名称" />
        ) : (
          <h2
            onDoubleClick={() => { setDraft(group.name); setEditing(true) }}
            title="双击重命名分组"
            className="text-sm font-semibold text-stone-700 dark:text-stone-200 cursor-text select-none">
            {group.name}
          </h2>
        )}
        <span className="text-[11px] text-stone-400 dark:text-stone-500 tabular-nums">{group.cards.length} 项</span>
        <span className="flex-1 border-b border-black/[0.05] dark:border-white/[0.06]" />
        <button
          onClick={() => onDelete(group.id)}
          disabled={total <= 1}
          title={total <= 1 ? '至少保留一个分组' : '删除分组（卡片并入相邻分组）'}
          className="w-7 h-7 rounded-lg text-stone-400 dark:text-stone-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-stone-400 shrink-0"
          aria-label={'删除分组 ' + group.name}>
          <svg className="w-4 h-4 mx-auto" viewBox="0 0 20 20" fill="none">
            <path d="M4 6h12M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6M6 6l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L14 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <SortableContext items={group.cards} strategy={rectSortingStrategy}>
        {group.cards.length ? (
          <div className="grid grid-cols-6 gap-3.5">
            {group.cards.map(key => (
              <PortalCard key={key} sys={resolveSys(key, overrides)} groupId={group.id} guardClick={guardClick}
                disabled={isCardDisabled?.(key)} onEdit={onEditCard} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-black/[0.12] dark:border-white/[0.12] py-10 text-center text-[12.5px] text-stone-400 dark:text-stone-500">
            空分组——把卡片拖到这里
          </div>
        )}
      </SortableContext>
    </section>
  )
}

export default function PortalPage({ dark, setDark }) {
  // 首屏：localStorage 缓存（v2）→ 旧版布局 → 默认单组；随后 GET 服务端覆盖
  const [initial] = useState(() => {
    const cached = readCached()
    if (cached) return normalize(cached.groups, cached.overrides)
    return { groups: defaultGroups(), overrides: {} }
  })
  const [groups, setGroups] = useState(initial.groups)
  const [overrides, setOverrides] = useState(initial.overrides)

  // 拖拽结束后的 120ms 内吞掉落在卡片上的 click，防止"拖完误跳转"
  const suppressClick = useRef(false)
  // 拖拽悬浮层：DragOverlay 渲染的克隆卡（含源卡尺寸），松手后经 dropAnimation 归位
  const [activeCard, setActiveCard] = useState(null)
  // clashctl 未安装 → 门户 Clash 卡片置灰（检测失败/后端不可达时不置灰，避免误伤）
  const [clashMissing, setClashMissing] = useState(false)
  // 卡片编辑弹窗（key = 模块标识）
  const [editingKey, setEditingKey] = useState(null)
  // 保存失败提示条（5s 自动消失）
  const [saveError, setSaveError] = useState(null)
  const errorTimer = useRef(null)
  // 服务端同步到达前本地已改过 → 本地为准（下次 PUT 覆盖服务端）
  const mutated = useRef(false)
  const writer = useRef(null)
  const pendingLayout = useRef(null)
  const [saveStatus, setSaveStatus] = useState('loading')
  const [draftError, setDraftError] = useState(null)
  const [resetting, setResetting] = useState(false)
  const resetGuard = useRef(false)

  const showError = useCallback((err) => {
    setSaveError(err?.message || String(err))
    clearTimeout(errorTimer.current)
    errorTimer.current = setTimeout(() => setSaveError(null), 5000)
  }, [])

  // One writer per layout; unknown network outcomes retain their mutation ID.
  useEffect(() => {
    let alive = true
    const draftKey = scopedKey(LAYOUT_KEY + ':pending')
    fetchHomeLayout().then(data => {
      if (!alive) return
      let initialDraft
      try { initialDraft = JSON.parse(localStorage.getItem(draftKey) || 'null') } catch { /* damaged draft */ }
      const source = initialDraft?.snapshot || data
      const server = fromServer(source)
      if (!mutated.current) {
        const next = server.groups.length ? normalize(server.groups, server.overrides) : { groups: defaultGroups(), overrides: {} }
        setGroups(next.groups); setOverrides(next.overrides); writeCache(next.groups, next.overrides)
      }
      writer.current = createSaveCoordinator({ revision: data.revision, initialDraft, idempotent: true,
        save: (snapshot, { revision, mutationId, signal }) => saveHomeLayout({ ...snapshot, revision, mutation_id: mutationId }, { signal }),
        onState: state => { if (alive) { setDraftError(state.draftError || null); setSaveStatus(state.status); if (state.error) showError(state.error); else if (state.status === 'saved') { setSaveError(null); clearTimeout(errorTimer.current) } } },
        draft: { write: value => localStorage.setItem(draftKey, JSON.stringify(value)), remove: () => localStorage.removeItem(draftKey) },
      })
      setSaveStatus(initialDraft ? 'pending' : 'saved')
      if (pendingLayout.current) writer.current.change(pendingLayout.current)
      if (initialDraft) writer.current.flush().catch(showError)
    }).catch(error => { if (alive) { setSaveStatus('error'); showError(error) } })
    return () => { alive = false; writer.current?.dispose(); writer.current = null; clearTimeout(errorTimer.current) }
  }, [showError])

  useEffect(() => {
    let alive = true
    clashAvailability()
      .then(d => { if (alive && d && d.available === false) setClashMissing(true) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  const isCardDisabled = useCallback(key => key === 'clash' && clashMissing, [clashMissing])

  const onDragStart = useCallback(({ active }) => {
    if (active.data.current?.type !== 'card') return
    const sys = resolveSys(active.id, overrides)
    const rect = document.querySelector(`[data-card="${active.id}"]`)?.getBoundingClientRect()
    setActiveCard(sys && rect ? { sys, width: Math.round(rect.width), height: Math.round(rect.height) } : sys ? { sys } : null)
  }, [overrides])

  // 鼠标：拖动 6px 激活
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const endDrag = useCallback(() => {
    suppressClick.current = true
    setTimeout(() => { suppressClick.current = false }, 120)
  }, [])

  /** 乐观提交：更新本地 + 写缓存 + PUT 服务端（失败仅提示，不回滚——单用户低频） */
  const commit = useCallback((nextGroups, nextOverrides) => {
    if (resetGuard.current) return
    mutated.current = true
    setGroups(nextGroups)
    setOverrides(nextOverrides)
    writeCache(nextGroups, nextOverrides)
    pendingLayout.current = buildPayload(nextGroups, nextOverrides)
    writer.current?.change(pendingLayout.current)
  }, [])

  const handleDragEnd = useCallback(({ active, over }) => {
    endDrag()
    setActiveCard(null)
    if (!over || active.id === over.id) return
    const aType = active.data.current?.type
    const oType = over.data.current?.type
    setGroups(prev => {
      let next
      if (aType === 'group') {
        // 组排序：over 为组 → 交换位置；over 为卡 → 移到该卡所在组的位置
        const overGroup = oType === 'group' ? over.id : prev.find(g => g.cards.includes(over.id))?.id
        if (!overGroup || overGroup === active.id) return prev
        const from = prev.findIndex(g => g.id === active.id)
        const to = prev.findIndex(g => g.id === overGroup)
        next = arrayMove(prev, from, to)
      } else if (aType === 'card') {
        const fromGroup = prev.find(g => g.cards.includes(active.id))
        if (!fromGroup) return prev
        if (oType === 'card') {
          const toGroup = prev.find(g => g.cards.includes(over.id))
          if (!toGroup) return prev
          if (fromGroup.id === toGroup.id) {
            // 组内排序
            next = prev.map(g => g.id !== fromGroup.id ? g : {
              ...g, cards: arrayMove(g.cards, g.cards.indexOf(active.id), g.cards.indexOf(over.id)),
            })
          } else {
            // 跨组：从源组移除，插到目标卡之前
            next = prev.map(g => {
              if (g.id === fromGroup.id) return { ...g, cards: g.cards.filter(t => t !== active.id) }
              if (g.id === toGroup.id) {
                const cards = [...g.cards]
                cards.splice(cards.indexOf(over.id), 0, active.id)
                return { ...g, cards }
              }
              return g
            })
          }
        } else if (oType === 'group') {
          // 卡拖到组头/组体：移动到该组末尾
          if (fromGroup.id === over.id) return prev
          next = prev.map(g => {
            if (g.id === fromGroup.id) return { ...g, cards: g.cards.filter(t => t !== active.id) }
            if (g.id === over.id) return { ...g, cards: [...g.cards, active.id] }
            return g
          })
        } else return prev
      } else return prev
      commit(next, overrides)
      return next
    })
  }, [endDrag, overrides, commit])

  const addGroup = () => {
    const id = gid()
    commit([...groups, { id, name: '新分组', cards: [] }], overrides)
    // 新组渲染后平滑滚动到位（长页面时新组在折叠线下，看不见也拖不到）
    setTimeout(() => {
      document.querySelector(`[data-gid="${id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 60)
  }
  const renameGroup = (id, name) =>
    commit(groups.map(g => g.id === id ? { ...g, name } : g), overrides)
  const deleteGroup = id => {
    if (groups.length <= 1) return
    const idx = groups.findIndex(g => g.id === id)
    if (idx < 0) return
    // 卡片并入相邻组（优先下一组，末组并到上一组）
    const target = groups[idx + 1] || groups[idx - 1]
    const moved = groups[idx].cards
    commit(groups.filter(g => g.id !== id).map(g => g.id === target.id ? { ...g, cards: [...g.cards, ...moved] } : g), overrides)
  }
  const saveCardEdit = (key, { title, desc }) => {
    const next = { ...overrides }
    if (title || desc) next[key] = { title: title || null, desc: desc || null }
    else delete next[key]
    commit(groups, next)
  }
  const resetLayout = async () => {
    if (!writer.current || resetGuard.current) return
    resetGuard.current = true; setResetting(true)
    try {
      await writer.current.flush()
      const data = await resetHomeLayout({ revision: writer.current.getState().revision, mutation_id: crypto.randomUUID() })
      writer.current.reset({ revision: data.revision })
      mutated.current = true; pendingLayout.current = null
      clearCache(); setGroups(defaultGroups()); setOverrides({}); setSaveStatus('saved')
    } catch (error) { showError(error) }
    finally { resetGuard.current = false; setResetting(false) }
  }


  return (
    <div className="min-h-screen bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 transition-colors">
      <div className="mx-auto w-full max-w-[1700px] px-10 py-14">
        {/* 头部 */}
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-400 mb-2">DouBlog</p>
            <h1 className="text-[34px] font-semibold tracking-tight">工作台</h1>
            <p className="mt-2 text-[13px] text-stone-400">个人系统统一入口——卡片可拖入任意分组，标题描述可编辑，布局云端保存</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button disabled={resetting || saveStatus === 'loading'} onClick={resetLayout} title="恢复默认布局" aria-label="恢复默认布局"
              className="w-9 h-9 rounded-xl border border-black/[0.08] dark:border-white/[0.1] text-stone-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors">
              <svg className="w-4 h-4 mx-auto" viewBox="0 0 20 20" fill="none">
                <path d="M16 8A6.5 6.5 0 1 0 16 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M16 3.5V8h-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button onClick={() => setDark(!dark)} title="切换主题"
              className="w-9 h-9 rounded-xl border border-black/[0.08] dark:border-white/[0.1] text-stone-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors">
              {dark ? (
                <svg className="w-4 h-4 mx-auto" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="3.4" stroke="currentColor" strokeWidth="1.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              ) : (
                <svg className="w-4 h-4 mx-auto" viewBox="0 0 20 20" fill="none"><path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5 6.8 6.8 0 1 0 15.5 12.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
              )}
            </button>
            <button onClick={logout} title="登出"
              className="w-9 h-9 rounded-xl border border-black/[0.08] dark:border-white/[0.1] text-stone-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors">
              <svg className="w-4 h-4 mx-auto" viewBox="0 0 20 20" fill="none">
                <path d="M12.5 6.5v-2a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M8.5 10h8M14 7.5l2.5 2.5L14 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        <div role="status" className="mb-4 text-xs text-stone-500 dark:text-stone-400">{resetting ? '正在恢复默认…' : ({ loading: '正在读取布局…', pending: '布局待保存', saving: '正在保存布局…', saved: '布局已保存', error: '布局未保存', conflict: '布局已在其他页面更新，请刷新后核对' }[saveStatus] || '')}{saveStatus === 'error' && <button className="ml-3 underline" onClick={() => writer.current?.retry().catch(showError)}>重试</button>}</div>
        {draftError && <p role="alert" className="mb-4 text-sm text-amber-700 dark:text-amber-300">本地草稿存储不可用，关闭页面前请确认布局已保存。</p>}
        {saveError && (
          <div role="alert"
            onClick={() => setSaveError(null)}
            className="mb-6 rounded-lg px-3 py-2 text-[13px] text-red-700 dark:text-red-300
              bg-red-500/10 cursor-pointer">
            布局保存失败：{saveError}（点击关闭，本地改动仍在）
          </div>
        )}

        {/* 分组卡片（组间/组内均可拖拽） */}
        <DndContext sensors={sensors} collisionDetection={portalCollision}
          onDragStart={onDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => { endDrag(); setActiveCard(null) }}>
          <SortableContext items={groups.map(g => g.id)} strategy={rectSortingStrategy}>
            <div className="space-y-8">
              {groups.map(g => (
                <GroupSection key={g.id} group={g} total={groups.length} overrides={overrides}
                  onRename={renameGroup} onDelete={deleteGroup} guardClick={suppressClick}
                  isCardDisabled={isCardDisabled} onEditCard={setEditingKey} />
              ))}
            </div>
          </SortableContext>
          <button onClick={addGroup}
            className="mt-5 w-full rounded-2xl border border-dashed border-black/[0.12] dark:border-white/[0.12] py-3 text-sm text-stone-500 dark:text-stone-400 hover:border-black/25 dark:hover:border-white/25 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
            ＋ 新建分组
          </button>
          {/* 拖拽悬浮层：拎起的卡片克隆（微倾斜 + 大投影），松手 240ms 缓动归位 */}
          <DragOverlay dropAnimation={{ duration: 240, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
            {activeCard && (
              <OverlayCard sys={activeCard.sys}
                width={activeCard.width} height={activeCard.height} />
            )}
          </DragOverlay>
        </DndContext>

        {editingKey && SYS_BY_KEY[editingKey] && (
          <CardEditModal
            sys={SYS_BY_KEY[editingKey]}
            override={overrides[editingKey]}
            onSave={payload => saveCardEdit(editingKey, payload)}
            onClose={() => setEditingKey(null)} />
        )}

        <p className="mt-8 text-center text-[11.5px] text-stone-400 dark:text-stone-500">
          FastAPI + React · 日志与异常由 LizySDK 驱动
        </p>
      </div>
    </div>
  )
}
