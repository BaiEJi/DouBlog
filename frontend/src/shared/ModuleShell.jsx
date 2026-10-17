import { useEffect, useState } from 'react'
import { NavigationContext } from './module-navigation'
import { Link, useLocation } from 'react-router-dom'
import ModuleErrorBoundary from './ModuleErrorBoundary'

const MODULES = {
  blog: { title: '博客 · 知识库', subtitle: '文章 · 双链 · 知识库 · 资产', accent: 'amber', items: [
    { key: 'blog', label: '知识库', to: '/blog' }, { key: 'create', label: '新建文章', to: '/create' },
    { key: 'assets', label: '资产库', to: '/assets', children: [
      { key: 'library', label: '浏览' }, { key: 'trash', label: '回收站' }, { key: 'stats', label: '统计' },
    ] },
  ] },
  diary: { title: '日记', subtitle: '随记 · 日历 · 写作统计', accent: 'rose' },
  subs: { title: '订阅管理', subtitle: '会员 · 支出 · 到期提醒', accent: 'amber' },
  todo: { title: 'MyTodo', subtitle: '四象限 · 迁移 · 规律生活', accent: 'indigo' },
  practice: { title: '刷题', subtitle: '题解 · 代码 · 艾宾浩斯复习', accent: 'blue' },
  steamidler: { title: 'Steam 挂机', subtitle: '账号 · 挂机时长 · 日志', accent: 'slate', items: [{ key: 'accounts', label: '账号管理' }] },
  gamemap: { title: '剧情图谱', subtitle: '游戏 · 人物 · 关系', accent: 'violet' },
  vault: { title: '密码库', subtitle: '条目 · 安全中心 · 密码服务', accent: 'emerald' },
  apihub: { title: 'API Hub', subtitle: '上游 · 平台令牌 · 调用日志', accent: 'amber' },
  logs: { title: '日志查询', subtitle: '检索 · 统计 · 告警', accent: 'sky', items: [{ key: 'search', label: '日志检索' }] },
  config: { title: '系统配置', subtitle: '账号 · 数据库 · 日志上报', accent: 'teal', items: [{ key: 'config', label: '系统配置' }] },
  confcenter: { title: '配置中心', subtitle: 'namespace → key → value', accent: 'cyan', items: [{ key: 'entries', label: '配置管理' }] },
  clash: { title: 'Clash 代理', subtitle: '内核 · 订阅 · Tun · Mixin', accent: 'sky' },
  devtoolbox: { title: '开发者工具箱', subtitle: 'JSON · Diff · 编码 · 哈希 · 正则', accent: 'lime' },
  bookmarks: { title: '书签', subtitle: '收藏 · 阅读队列 · 快照', accent: 'orange' },
}

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

function containsActive(items, activeKey) {
  return items?.some(item => (item.active ?? item.key === activeKey) || containsActive(item.children, activeKey))
}

function NavItem({ item, activeKey, onSelect, accent, collapsed = false, onExpand, depth = 0 }) {
  const selected = item.active ?? item.key === activeKey
  const hasSelectedChild = containsActive(item.children, activeKey)
  const [expanded, setExpanded] = useState(true)
  const active = selected || hasSelectedChild
  const hasChildren = item.children?.length > 0
  const cls = `module-nav-item flex items-center w-full min-w-0 rounded-lg text-base leading-5 text-left transition-colors ${collapsed ? 'justify-center h-8' : `gap-2 px-2 ${depth ? 'min-h-7 py-1' : 'min-h-8 py-1.5'}`} ${active ? `${ACCENTS[accent] || ACCENTS.slate} font-medium` : 'text-stone-600 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'}`
  const content = <>{item.icon || <span className="w-4 h-4 shrink-0 flex items-center justify-center" aria-hidden="true">{collapsed ? item.label.slice(0, 1) : depth ? '·' : '▦'}</span>}<span className={collapsed ? 'sr-only' : 'truncate'}>{item.label}</span>{!collapsed && item.badge != null && <span className="ml-auto text-[13px] tabular-nums">{item.badge}</span>}</>
  const title = collapsed ? `${item.label}${item.badge != null ? `（${item.badge}）` : ''}${hasChildren ? ' · 展开子菜单' : ''}` : item.label
  const open = () => { if (collapsed && hasChildren) { setExpanded(true); onExpand() } }
  const select = () => { open(); (item.onClick || onSelect)?.(item.key) }
  return (
    <div>
      <div className="flex items-center gap-0.5">
        {item.to ? <Link to={item.to} className={cls} title={title} aria-current={selected ? 'page' : undefined} onClick={open}>{content}</Link>
          : <button type="button" className={cls} title={title} aria-current={selected ? 'page' : undefined} onClick={select}>{content}</button>}
        {!collapsed && hasChildren && <button type="button" className="shrink-0 w-6 h-7 rounded-lg text-stone-500 dark:text-stone-400 hover:bg-black/5 dark:hover:bg-white/5" aria-label={`${expanded ? '收起' : '展开'}${item.label}`} aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? '⌄' : '›'}</button>}
      </div>
      {hasChildren && <div hidden={collapsed || !expanded} className="ml-3 pl-2 mt-0.5 border-l border-black/[0.07] dark:border-white/[0.08] space-y-0.5">{item.children.map(child => <NavItem key={child.key} {...{ item: child, activeKey, onSelect, accent }} depth={depth + 1} />)}</div>}
    </div>
  )
}

const SIDEBAR_STORAGE_KEY = 'doublog_sidebar_collapsed'

export default function ModuleShell({ module, dark, setDark, children }) {
  const base = MODULES[module]
  const [navigation, setNavigation] = useState(null)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true' }
    catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed)) }
    catch { /* Navigation still works when browser storage is unavailable. */ }
  }, [collapsed])
  const { pathname } = useLocation()
  const config = { ...base, ...navigation }
  const items = config.items || [{ key: module, label: config.title }]
  const activeKey = config.activeKey || items.find(item => item.to === pathname)?.key || items[0]?.key
  const toggleLabel = collapsed ? '展开侧边栏' : '折叠侧边栏'
  const iconButton = 'shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-black/[0.08] dark:border-white/[0.1] text-stone-500 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors'
  return (
    <NavigationContext.Provider value={setNavigation}>
      <div className="module-shell min-h-screen bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100">
        <aside id="module-sidebar" aria-label={`${config.title}导航`} className={`module-sidebar flex flex-col shrink-0 border-r border-black/[0.05] dark:border-white/[0.06] bg-stone-50 dark:bg-[#100f0e] sticky left-0 top-0 h-screen z-30 overflow-hidden transition-[width] duration-200 ${collapsed ? 'w-14 px-2 py-3' : 'w-[180px] px-2 py-3'}`}>
          <div className={collapsed ? 'flex flex-col-reverse items-center gap-2 mb-3' : 'flex items-center gap-2 mb-3'}>
            <Link to="/" aria-label="返回门户" title={collapsed ? '返回门户' : undefined} className={`flex items-center h-8 rounded-lg border border-black/[0.1] dark:border-white/[0.12] text-base font-medium text-stone-700 dark:text-stone-200 bg-white dark:bg-white/[0.04] hover:bg-black/[0.04] dark:hover:bg-white/[0.08] transition-colors ${collapsed ? 'w-8 justify-center shrink-0' : 'flex-1 min-w-0 gap-1.5 px-2.5'}`}>
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {!collapsed && <span>门户</span>}
            </Link>
            <button type="button" className={iconButton} aria-label={toggleLabel} title={toggleLabel} aria-expanded={!collapsed} aria-controls="module-sidebar-content" onClick={() => setCollapsed(v => !v)}>
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M7 3.5v13" stroke="currentColor" strokeWidth="1.5" /><path d={collapsed ? 'm10 7 3 3-3 3' : 'm13 7-3 3 3 3'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
          <div hidden={collapsed} className="px-2 mb-3"><div className="text-base font-semibold mb-0.5">{config.title}</div><div className="text-[13.5px] text-stone-500 dark:text-stone-400 leading-relaxed">{config.subtitle}</div></div>
          <div id="module-sidebar-content" className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            <nav aria-label="模块页面" className="space-y-0.5">{items.map(item => <NavItem key={item.key} {...{ item, activeKey, onSelect: config.onSelect, accent: config.accent, collapsed }} onExpand={() => setCollapsed(false)} />)}</nav>
            {config.sidebar && <div hidden={collapsed}>{config.sidebar}</div>}
          </div>
          <div className={`pt-3 flex items-center gap-2 ${collapsed ? 'justify-center' : 'px-2 justify-between'}`}>{!collapsed && <span className="text-[13px] text-stone-400 dark:text-stone-500">DouBlog</span>}<button type="button" onClick={setDark} aria-label="切换主题" title="切换主题" className={iconButton}>{dark ? '☀' : '☾'}</button></div>
        </aside>
        <div className="module-main flex-1 min-w-0"><div className="module-content mx-auto w-full max-w-[1700px] px-10 py-8"><ModuleErrorBoundary resetKey={pathname}>{children}</ModuleErrorBoundary></div></div>
      </div>
    </NavigationContext.Provider>
  )
}
