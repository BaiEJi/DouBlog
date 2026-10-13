/**
 * 统一入口（门户）页 `/`：各系统卡片按**自定义分组**展示——
 * - 每个模块卡片可拖入任意分组（跨组拖拽 / 组内拖拽排序，dnd-kit 多容器）
 * - 分组本身可拖拽排序（拖组头把手）
 * - 分组可新建 / 重命名（双击组名）/ 删除（卡片并入相邻组，至少保留一组）
 * - 布局持久化 localStorage（doublog_portal_layout = [{id,name,cards:[to...]}]）；
 *   旧 doublog_portal_order（平铺序）自动迁移为单组；新增模块自动追加到末组
 * - 头部「恢复默认」清空布局回默认单组
 * 触屏：长按 180ms 激活拖拽；拖完 120ms 内吞 click 防误跳转。
 */
import { useCallback, useMemo, useRef, useState } from 'react'
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

function logout() {
  fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' })
    .catch(() => {})
    .finally(() => { window.location.href = '/login' })
}

const CARD = 'group text-left p-6 rounded-3xl border transition-all duration-200 ' +
  'border-black/[0.07] dark:border-white/[0.07] bg-white dark:bg-white/[0.025] ' +
  'hover:border-black/[0.18] dark:hover:border-white/[0.2] hover:shadow-md hover:-translate-y-0.5'

const ICON_BOX = 'w-11 h-11 rounded-2xl flex items-center justify-center mb-4 transition-transform group-hover:scale-105'

const SYSTEMS = [
  {
    to: '/blog',
    title: '博客 · 知识库',
    desc: '树形文章、Markdown、双链与多知识库',
    box: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <path d="M4 3.5A1.5 1.5 0 0 1 5.5 2H15a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5.5A1.5 1.5 0 0 1 4 16.5v-13Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M7 6h6M7 9.5h6M7 13h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/diary',
    title: '日记',
    desc: '私人日记 · 心情 · 日历与写作统计',
    box: 'bg-rose-500/10 text-rose-500 dark:text-rose-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3 8h14M6.5 2.5v3M13.5 2.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M7 11.5l1.8 1.8L13 9.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/gamemap',
    title: '剧情图谱',
    desc: '游戏人物关系画布 · 剧情时间线 · 图鉴',
    box: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <circle cx="5.5" cy="5" r="2" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="14.5" cy="7" r="2" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="9" cy="15" r="2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7.2 6.1 12.6 6.7M13.6 8.9 10.4 13.2M6.9 6.9 8.4 13.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/todo',
    title: '待办 · 四象限',
    desc: 'MyTodo 迁入 · 今日看板 · 规律生活计划',
    box: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="3" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3 7.5h14M7.5 3v14" stroke="currentColor" strokeWidth="1.4" />
        <path d="M6 11l1.6 1.6L10.8 9.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/practice',
    title: '刷题 · 算法练习',
    desc: 'LeetCode / 洛谷 · 题解与代码 · 艾宾浩斯复习',
    box: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <path d="M7 4.5 3 10l4 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 4.5 17 10l-4 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/steamidler',
    title: 'Steam 挂机',
    desc: '账号挂机 · 时长统计 · 运行日志',
    box: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <path d="M6.8 6h6.4A3.3 3.3 0 0 1 16.5 9.3v1.2a3 3 0 0 1-5.3 1.9l-.5-.6H9.3l-.5.6a3 3 0 0 1-5.3-1.9V9.3A3.3 3.3 0 0 1 6.8 6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M6.9 9v2.6M5.6 10.3h2.6M12.9 9.6h.01M14.2 11h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/subs',
    title: '订阅管理',
    desc: '会员订阅 · 支出统计 · 到期日历',
    box: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <path d="M3.2 6.5l3.3 3.3L10 5l3.5 4.8 3.3-3.3-1 8.5H4.2l-1-8.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/vault',
    title: '密码库',
    desc: '零知识端到端加密 · 密码服务 · 安全中心',
    box: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <path d="M10 2l6 2.4v4.5c0 3.9-2.6 7.2-6 8.6-3.4-1.4-6-4.7-6-8.6V4.4L10 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <circle cx="10" cy="9" r="2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10 11v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/apihub',
    title: 'API Hub',
    desc: '异构 API 聚合 · 平台令牌 · 多级限流 · 一键探活',
    box: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3M4.8 4.8l2.1 2.1M13.1 13.1l2.1 2.1M15.2 4.8l-2.1 2.1M6.9 13.1l-2.1 2.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/config',
    title: '系统配置',
    desc: '数据库一键切换（SQLite/PG）· 日志上报',
    box: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <path d="M4 6.5h8M14 6.5h2M4 13.5h2M8 13.5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="13" cy="6.5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="7" cy="13.5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    to: '/confcenter',
    title: '配置中心',
    desc: 'namespace → key → value · Redis 缓存',
    box: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <ellipse cx="10" cy="4.8" rx="6" ry="2.3" stroke="currentColor" strokeWidth="1.4" />
        <path d="M4 4.8v10.4c0 1.27 2.69 2.3 6 2.3s6-1.03 6-2.3V4.8" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M4 10c0 1.27 2.69 2.3 6 2.3s6-1.03 6-2.3" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    to: '/logs',
    title: '日志查询',
    desc: 'lizysdk 接收端 · 检索与统计',
    box: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <path d="M3 5h14v10H3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M5.5 8l2 2-2 2M9.5 12h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/admin',
    title: '管理',
    desc: '内容管理 · 备份导出',
    box: 'bg-stone-500/10 text-stone-600 dark:text-stone-300',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10 2.8v2.4M10 14.8v2.4M2.8 10h2.4M14.8 10h2.4M4.9 4.9l1.7 1.7M13.4 13.4l1.7 1.7M15.1 4.9l-1.7 1.7M6.6 13.4l-1.7 1.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
]

// ─── 分组布局持久化（localStorage 存 [{id,name,cards:[to...]}]）──

/** 按 to 找系统定义 */
const SYS_BY_TO = Object.fromEntries(SYSTEMS.map(s => [s.to, s]))

const LAYOUT_KEY = 'doublog_portal_layout'
const LEGACY_ORDER_KEY = 'doublog_portal_order'
const DEFAULT_GROUP_NAME = '常用'

const gid = () => 'g_' + Math.random().toString(36).slice(2, 9)

/**
 * 多容器落点判定（修复"拖不进空分组"，2026-10-13）：
 * 先取指针所在矩形（pointerWithin，多个包含时按角距排序——卡片天然排在其所在
 * 大 section 之前），指针不在任何矩形内（页面留白/拖出边界）再回退中心距。
 * 此前 closestCorners 按"指针到四角距离"全局比较——全宽分组 section 的四角
 * 离组中心 600+px，悬停空分组中部时随便一张小卡（角距 ~360px）都会胜出，
 * 导致 over 永远解析成别的卡、跨组拖放落空。
 */
const portalCollision = args => {
  const within = pointerWithin(args)
  return within.length ? within : closestCenter(args)
}

/** 读取持久化分组布局；兼容旧平铺顺序 key；跨组重复卡去重自愈；新增模块自动追加到末组；损坏数据回退默认 */
function readLayout() {
  let groups = null
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length && parsed.every(g => g && typeof g.name === 'string' && Array.isArray(g.cards))) {
        groups = parsed.map(g => ({ id: g.id || gid(), name: g.name, cards: g.cards.filter(t => SYS_BY_TO[t]) }))
      }
    }
  } catch { /* 损坏 → 回退 */ }
  if (!groups) {
    let order = null
    try {
      const raw = localStorage.getItem(LEGACY_ORDER_KEY)
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) order = arr.filter(t => SYS_BY_TO[t])
      }
    } catch { /* 同上 */ }
    const cards = order && order.length
      ? [...order, ...SYSTEMS.map(s => s.to).filter(t => !order.includes(t))]
      : SYSTEMS.map(s => s.to)
    groups = [{ id: gid(), name: DEFAULT_GROUP_NAME, cards }]
  }
  // 跨组重复的卡只保留首次出现（历史脏数据自愈，防 React key 冲突）
  const seen = new Set()
  groups = groups.map(g => ({ ...g, cards: g.cards.filter(t => !seen.has(t) && seen.add(t)) }))
  // 新增模块（未出现在任何组）追加到末组
  for (const s of SYSTEMS) {
    if (!seen.has(s.to)) groups[groups.length - 1].cards.push(s.to)
  }
  return groups
}

function saveLayout(groups) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(groups.map(g => ({ id: g.id, name: g.name, cards: g.cards })))) }
  catch { /* 存储禁用时仅本次会话生效 */ }
}

/** 可排序卡片：拖拽经 DragOverlay 悬浮跟随（原槽位显示虚线占位）；data 标记类型与所属组 */
function PortalCard({ sys, groupId, guardClick }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: sys.to, data: { type: 'card', group: groupId } })
  return (
    <div
      ref={setNodeRef} {...attributes} {...listeners} data-card={sys.to}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: 'manipulation',
      }}
      className="relative">
      {isDragging ? (
        // 原槽位占位（虚线框保持网格高度，随其他卡归位动画流动）
        <div className="h-full min-h-[150px] rounded-3xl border-2 border-dashed
          border-black/[0.12] dark:border-white/[0.16] bg-black/[0.02] dark:bg-white/[0.02]" />
      ) : (
        <Link
          to={sys.to}
          onClick={e => { if (guardClick.current) { e.preventDefault(); e.stopPropagation() } }}
          className={'flex flex-col h-full ' + CARD + ' cursor-grab active:cursor-grabbing'}>
          <div className={ICON_BOX + ' ' + sys.box}>{sys.icon}</div>
          <div className="text-[15px] font-medium mb-1">{sys.title}</div>
          <div className="text-[12.5px] text-stone-400 leading-relaxed">{sys.desc}</div>
          <div className="mt-4 text-[12px] text-stone-400 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all">
            进入 →
          </div>
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
      <div className={ICON_BOX + ' ' + sys.box}>{sys.icon}</div>
      <div className="text-[15px] font-medium mb-1">{sys.title}</div>
      <div className="text-[12.5px] text-stone-400 leading-relaxed">{sys.desc}</div>
    </div>
  )
}

/** 分组区块：组头（拖把手 + 名称双击改名 + 计数 + 删除）+ 组内卡网格（空组显示放置占位） */
function GroupSection({ group, total, onRename, onDelete, guardClick }) {
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
          className="w-7 h-7 -ml-1 rounded-lg text-stone-400 dark:text-stone-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.07] cursor-grab active:cursor-grabbing touch-none shrink-0"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
            {group.cards.map(to => (
              <PortalCard key={to} sys={SYS_BY_TO[to]} groupId={group.id} guardClick={guardClick} />
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
  const [groups, setGroups] = useState(readLayout)
  // 拖拽结束后的 120ms 内吞掉落在卡片上的 click，防止"拖完误跳转"
  const suppressClick = useRef(false)
  // 拖拽悬浮层：DragOverlay 渲染的克隆卡（含源卡尺寸），松手后经 dropAnimation 归位
  const [activeCard, setActiveCard] = useState(null)

  const onDragStart = useCallback(({ active }) => {
    if (active.data.current?.type !== 'card') return
    const sys = SYS_BY_TO[active.id]
    const rect = document.querySelector(`[data-card="${active.id}"]`)?.getBoundingClientRect()
    setActiveCard(sys && rect ? { sys, width: Math.round(rect.width), height: Math.round(rect.height) } : sys ? { sys } : null)
  }, [])

  // 触屏（粗指针）：长按 180ms 激活拖拽（滚动位移 >6px 自动取消）；鼠标：拖动 6px 激活
  const coarse = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches, [])
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: coarse ? { delay: 180, tolerance: 6 } : { distance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const endDrag = useCallback(() => {
    suppressClick.current = true
    setTimeout(() => { suppressClick.current = false }, 120)
  }, [])

  const handleDragEnd = useCallback(({ active, over }) => {
    endDrag()
    setActiveCard(null)
    if (!over || active.id === over.id) return
    const aType = active.data.current?.type
    const oType = over.data.current?.type
    setGroups(prev => {
      let next = prev
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
      saveLayout(next)
      return next
    })
  }, [endDrag])

  const update = next => { saveLayout(next); setGroups(next) }
  const addGroup = () => {
    const id = gid()
    update([...groups, { id, name: '新分组', cards: [] }])
    // 新组渲染后平滑滚动到位（长页面时新组在折叠线下，看不见也拖不到）
    setTimeout(() => {
      document.querySelector(`[data-gid="${id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 60)
  }
  const renameGroup = (id, name) => update(groups.map(g => g.id === id ? { ...g, name } : g))
  const deleteGroup = id => {
    if (groups.length <= 1) return
    const idx = groups.findIndex(g => g.id === id)
    if (idx < 0) return
    // 卡片并入相邻组（优先下一组，末组并到上一组）
    const target = groups[idx + 1] || groups[idx - 1]
    const moved = groups[idx].cards
    update(groups.filter(g => g.id !== id).map(g => g.id === target.id ? { ...g, cards: [...g.cards, ...moved] } : g))
  }
  const resetLayout = () => {
    try { localStorage.removeItem(LAYOUT_KEY); localStorage.removeItem(LEGACY_ORDER_KEY) } catch { /* 同上 */ }
    setGroups([{ id: gid(), name: DEFAULT_GROUP_NAME, cards: SYSTEMS.map(s => s.to) }])
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 transition-colors">
      <div className="mx-auto w-full max-w-[1700px] px-4 sm:px-6 xl:px-10 py-10 sm:py-14">
        {/* 头部 */}
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-400 mb-2">DouBlog</p>
            <h1 className="text-[30px] sm:text-[34px] font-semibold tracking-tight">工作台</h1>
            <p className="mt-2 text-[13px] text-stone-400">个人系统统一入口——卡片可拖入任意分组，组内/组间均可拖拽排序</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={resetLayout} title="恢复默认布局" aria-label="恢复默认布局"
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

        {/* 分组卡片（组间/组内均可拖拽） */}
        <DndContext sensors={sensors} collisionDetection={portalCollision}
          onDragStart={onDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => { endDrag(); setActiveCard(null) }}>
          <SortableContext items={groups.map(g => g.id)} strategy={rectSortingStrategy}>
            <div className="space-y-8">
              {groups.map(g => (
                <GroupSection key={g.id} group={g} total={groups.length}
                  onRename={renameGroup} onDelete={deleteGroup} guardClick={suppressClick} />
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

        <p className="mt-8 text-center text-[11.5px] text-stone-400 dark:text-stone-500">
          FastAPI + React · 日志与异常由 LizySDK 驱动
        </p>
      </div>
    </div>
  )
}
