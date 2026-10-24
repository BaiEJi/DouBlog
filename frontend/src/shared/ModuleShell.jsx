import { useState } from 'react'
import { NavigationContext } from './module-navigation'
import { Link, useLocation } from 'react-router-dom'
import { BackButton } from './PageHeader'
import ModuleErrorBoundary from './ModuleErrorBoundary'
import { useSidebarLayout } from './useSidebarLayout'
import { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from './sidebarPreferences'

import { MODULES } from './modules'

const ACCENTS = {
  amber: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',
  rose: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
  indigo: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
  blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  teal: 'bg-teal-500/10 text-teal-700 dark:text-teal-400',
  sky: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  cyan: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
  slate: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
  lime: 'bg-lime-500/12 text-lime-700 dark:text-lime-400',
  fuchsia: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400',
  orange: 'bg-orange-500/12 text-orange-700 dark:text-orange-400',
}

function containsActive(items, activeKey, keyMatch = true) {
  return keyMatch && items?.some(item => (item.active ?? item.key === activeKey) || containsActive(item.children, activeKey))
}

/** 把页面经 useModuleNavigation 注册的动态徽标（badges: {key: n}）合并进静态菜单树。 */
function applyBadges(items, badges) {
  return items.map(item => {
    const badge = badges?.[item.key]
    const next = badge != null ? { ...item, badge } : item
    return item.children ? { ...next, children: applyBadges(item.children, badges) } : next
  })
}

/** 当前激活分区：`to` 是 pathname 前缀（最长者胜）的顶层项；子孙项的 `to` 也算匹配
 *（如「知识库」下的「新建文章」/create——进入后父分区保持展开高亮）。无匹配返回 null。 */
function findActiveSection(items, pathname) {
  const matches = it => it.to && (pathname === it.to || pathname.startsWith(`${it.to}/`))
    || it.children?.some(matches)
  let best = null
  for (const it of items) {
    if (!matches(it)) continue
    if (!best || it.to.length > best.to.length) best = it
  }
  return best
}

/** 按 pathname 递归查找 `to` 精确匹配的项（含子孙，如知识库下的新建文章）。 */
function findByPath(items, pathname) {
  for (const it of items) {
    if (it.to === pathname) return it
    const hit = it.children && findByPath(it.children, pathname)
    if (hit) return hit
  }
  return null
}

function NavItem({ item, activeKey, onSelect, accent, depth = 0, keyMatch = true, activeSection = null }) {
  // 顶层分区项（带 to，如 blog 模块的 资产库/日记/书签 三个 tab）：children 只在本分区
  // 激活时展示并参与 activeKey 匹配——跨分区 child key 重名（三处 stats/trash）不会
  // 互相误亮，未激活分区的子项也不可点（进入分区由父项 Link 导航，避免把别的分区的
  // key 发给当前页面的 onSelect）。无 to 的顶层项（其它模块视图按钮）保持原行为。
  const isSection = depth === 0 && !!item.to
  const sectionActive = !isSection || item === activeSection
  const childKeyMatch = keyMatch && sectionActive
  const selected = keyMatch && (item.active ?? item.key === activeKey)
  const hasSelectedChild = containsActive(item.children, activeKey, childKeyMatch)
  const [expanded, setExpanded] = useState(true)
  const active = selected || hasSelectedChild
  const showChildren = item.children?.length > 0 && (!isSection || item === activeSection)
  const cls = `module-nav-item flex items-center gap-2.5 w-full min-h-9 px-2.5 py-2 rounded-xl text-sm text-left transition-colors ${active ? `${ACCENTS[accent] || ACCENTS.slate} font-medium` : 'text-stone-600 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'}`
  const content = <>{item.icon || <span className="w-4 h-4 shrink-0 flex items-center justify-center" aria-hidden="true">{depth ? '·' : '▦'}</span>}<span className="truncate">{item.label}</span>{item.badge != null && <span className="ml-auto text-[11px] tabular-nums">{item.badge}</span>}</>
  const select = () => (item.onClick || onSelect)?.(item.key)
  return (
    <div>
      <div className="flex items-center gap-0.5">
        {item.to ? <Link to={item.to} className={cls} aria-current={selected ? 'page' : undefined}>{content}</Link>
          : <button type="button" className={cls} aria-current={selected ? 'page' : undefined} onClick={select}>{content}</button>}
        {showChildren && <button type="button" className="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-stone-500 dark:text-stone-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors" aria-label={`${expanded ? '收起' : '展开'}${item.label}`} aria-expanded={expanded} onClick={() => setExpanded(v => !v)}><svg className={`w-4 h-4 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`} viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
      </div>
      {showChildren && expanded && <div className="ml-4 pl-2 mt-1 border-l border-black/[0.07] dark:border-white/[0.08] space-y-1">{item.children.map(child => <NavItem key={child.key} {...{ item: child, activeKey, onSelect, accent, activeSection }} depth={depth + 1} keyMatch={childKeyMatch} />)}</div>}
    </div>
  )
}

const CHEVRON = direction => (
  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d={direction === 'left' ? 'M11 5l-5 5 5 5M15.5 5l-5 5 5 5' : 'M9 5l5 5-5 5M4.5 5l5 5-5 5'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** 折叠窄轨的一级菜单图标：item.icon 优先，否则取 label 首字符；
 * 点击行为与展开态一致（to 用 Link，其余触发 onSelect）；二级不进入窄轨。 */
function railGlyph(item) {
  if (item.icon) return item.icon
  const label = String(item.label || '')
  return <span className="text-[13px] font-medium" aria-hidden="true">{label.slice(0, 1)}</span>
}

function RailItem({ item, activeKey, onSelect, accent, activeSection }) {
  const selected = (item.active ?? item.key === activeKey) || item === activeSection
  const cls = `w-9 h-9 grid place-items-center rounded-xl text-left transition-colors shrink-0 ${selected ? `${ACCENTS[accent] || ACCENTS.slate} font-medium` : 'text-stone-600 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'}`
  const select = () => (item.onClick || onSelect)?.(item.key)
  return item.to
    ? <Link to={item.to} className={cls} aria-current={selected ? 'page' : undefined} aria-label={item.label} title={item.label}>{railGlyph(item)}</Link>
    : <button type="button" className={cls} aria-current={selected ? 'page' : undefined} aria-label={item.label} title={item.label} onClick={select}>{railGlyph(item)}</button>
}

export default function ModuleShell({ module, dark, setDark, children }) {
  const base = MODULES[module]
  const [navigation, setNavigation] = useState(null)
  const { pathname } = useLocation()
  const { layout, width, dragging, asideRef, handleProps, toggleCollapsed, resetWidth } = useSidebarLayout()
  const collapsed = layout.collapsed
  const config = { ...base, ...navigation }
  const items = navigation?.badges
    ? applyBadges(config.items || [{ key: module, label: config.title }], navigation.badges)
    : (config.items || [{ key: module, label: config.title }])
  const activeKey = config.activeKey || findByPath(items, pathname)?.key || items[0]?.key
  const activeSection = findActiveSection(items, pathname)
  return (
    <NavigationContext.Provider value={setNavigation}>
      <div className="module-shell min-h-screen bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100">
        <aside
          ref={asideRef}
          id="module-sidebar"
          aria-label={`${config.title}导航`}
          data-sidebar-collapsed={collapsed || undefined}
          style={{ width: `${width}px` }}
          className={`module-sidebar relative flex flex-col shrink-0 border-r border-black/[0.05] dark:border-white/[0.06] bg-stone-50 dark:bg-[#100f0e] sticky left-0 top-0 h-screen z-30 overflow-hidden ${dragging ? '' : 'transition-[width] duration-150 motion-reduce:transition-none'}`}>
          {/* 固定头部：返回门户 + 模块标题；折叠窄轨只保留紧凑返回按钮 */}
          <div className={`shrink-0 pt-4 ${collapsed ? 'px-2' : 'p-4 pb-0'}`}>
            <div className={collapsed ? 'hidden' : 'mb-3'}><BackButton /></div>
            <div className={collapsed ? 'hidden' : 'px-2 mb-4 font-mono text-base font-semibold'}>{config.title}</div>
            <div className={collapsed ? 'flex justify-center' : 'hidden'}>
              <Link to="/" aria-label="返回门户" title="返回门户"
                className="w-9 h-9 grid place-items-center rounded-xl border border-black/[0.1] dark:border-white/[0.12] text-stone-700 dark:text-stone-200 bg-white dark:bg-white/[0.04] hover:bg-black/[0.04] dark:hover:bg-white/[0.08] transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </Link>
            </div>
          </div>
          {/* 可独立滚动的菜单/插槽区：折叠时完整树 display:none 保持挂载（分组展开状态不丢）；
              窄轨另渲染一级图标列（二级不进入窄轨） */}
          <div className={collapsed ? 'hidden' : 'flex-1 min-h-0 overflow-y-auto px-4 pb-4'}>
            <nav aria-label="模块页面" className="space-y-1">{items.map(item => <NavItem key={item.key} {...{ item, activeKey, onSelect: config.onSelect, accent: config.accent, activeSection }} />)}</nav>
            {config.sidebar}
          </div>
          <nav aria-label="模块页面（紧凑）" className={collapsed ? 'flex-1 min-h-0 overflow-y-auto px-2 pt-2 flex flex-col items-center gap-1' : 'hidden'}>
            {items.map(item => <RailItem key={item.key} {...{ item, activeKey, onSelect: config.onSelect, accent: config.accent, activeSection }} />)}
          </nav>
          {/* 固定底部操作区：不随长菜单滚走 */}
          <div className="shrink-0 border-t border-black/[0.05] dark:border-white/[0.06] p-3">
            {collapsed ? (
              <div className="flex flex-col items-center gap-1.5">
                <button type="button" onClick={setDark} aria-label="切换主题" title="切换主题" className="w-8 h-8 grid place-items-center rounded-lg border border-black/[0.08] dark:border-white/[0.1] text-stone-500 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]">{dark ? '☀' : '☾'}</button>
                <button type="button" onClick={toggleCollapsed} aria-expanded={false} aria-controls="module-sidebar" aria-label="展开侧边栏" title="展开侧边栏" className="w-8 h-8 grid place-items-center rounded-lg border border-black/[0.08] dark:border-white/[0.1] text-stone-500 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]">{CHEVRON('right')}</button>
              </div>
            ) : (
              <div className="px-1 flex items-center justify-between gap-2">
                <span className="text-[11px] text-stone-400 dark:text-stone-500">DouBlog</span>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={setDark} aria-label="切换主题" title="切换主题" className="w-8 h-8 grid place-items-center rounded-lg border border-black/[0.08] dark:border-white/[0.1] text-stone-500 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]">{dark ? '☀' : '☾'}</button>
                  <button type="button" onClick={toggleCollapsed} aria-expanded aria-controls="module-sidebar" aria-label="折叠侧边栏" title="折叠侧边栏" className="w-8 h-8 grid place-items-center rounded-lg border border-black/[0.08] dark:border-white/[0.1] text-stone-500 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]">{CHEVRON('left')}</button>
                </div>
              </div>
            )}
          </div>
          {/* 右边界拖动手柄：命中区 7px，折叠时隐藏（不参与焦点与辅助技术） */}
          {!collapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整侧边栏宽度"
              aria-valuemin={SIDEBAR_MIN_WIDTH}
              aria-valuemax={SIDEBAR_MAX_WIDTH}
              aria-valuenow={layout.width}
              aria-controls="module-sidebar"
              tabIndex={0}
              onDoubleClick={resetWidth}
              title="拖动调整宽度（双击恢复默认 220px）"
              className={`absolute top-0 bottom-0 right-0 w-[7px] cursor-col-resize z-10 focus-visible:outline-none ${dragging ? 'bg-black/10 dark:bg-white/15' : 'hover:bg-black/[0.06] dark:hover:bg-white/[0.08] focus-visible:bg-black/10 dark:focus-visible:bg-white/15'}`}
              {...handleProps}
            />
          )}
        </aside>
        <div className="module-main flex-1 min-w-0"><div className="module-content mx-auto w-full max-w-[1700px] px-10 py-8"><ModuleErrorBoundary resetKey={pathname}>{children}</ModuleErrorBoundary></div></div>
      </div>
    </NavigationContext.Provider>
  )
}
