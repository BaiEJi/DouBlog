import { useState } from 'react'
import { NavigationContext } from './module-navigation'
import { Link, useLocation } from 'react-router-dom'
import { BackButton } from './PageHeader'
import ModuleErrorBoundary from './ModuleErrorBoundary'

const MODULES = {
  blog: { title: '博客 · 知识库', subtitle: '文章 · 双链 · 知识库 · 资产', accent: 'amber', items: [
    { key: 'blog', label: '知识库', to: '/blog' }, { key: 'create', label: '新建文章', to: '/create' },
    { key: 'admin', label: '内容管理', to: '/admin' },
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

function NavItem({ item, activeKey, onSelect, accent, depth = 0 }) {
  const selected = item.active ?? item.key === activeKey
  const hasSelectedChild = containsActive(item.children, activeKey)
  const [expanded, setExpanded] = useState(true)
  const active = selected || hasSelectedChild
  const cls = `module-nav-item flex items-center gap-2.5 w-full min-h-9 px-2.5 py-2 rounded-xl text-sm text-left transition-colors ${active ? `${ACCENTS[accent] || ACCENTS.slate} font-medium` : 'text-stone-600 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'}`
  const content = <>{item.icon || <span className="w-4 h-4 shrink-0 flex items-center justify-center" aria-hidden="true">{depth ? '·' : '▦'}</span>}<span className="truncate">{item.label}</span>{item.badge != null && <span className="ml-auto text-[11px] tabular-nums">{item.badge}</span>}</>
  const select = () => (item.onClick || onSelect)?.(item.key)
  return (
    <div>
      <div className="flex items-center gap-0.5">
        {item.to ? <Link to={item.to} className={cls} aria-current={selected ? 'page' : undefined}>{content}</Link>
          : <button type="button" className={cls} aria-current={selected ? 'page' : undefined} onClick={select}>{content}</button>}
        {item.children?.length > 0 && <button type="button" className="shrink-0 w-7 h-8 rounded-lg text-stone-500 dark:text-stone-400 hover:bg-black/5 dark:hover:bg-white/5" aria-label={`${expanded ? '收起' : '展开'}${item.label}`} aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? '⌄' : '›'}</button>}
      </div>
      {item.children?.length > 0 && expanded && <div className="ml-4 pl-2 mt-1 border-l border-black/[0.07] dark:border-white/[0.08] space-y-1">{item.children.map(child => <NavItem key={child.key} {...{ item: child, activeKey, onSelect, accent }} depth={depth + 1} />)}</div>}
    </div>
  )
}

export default function ModuleShell({ module, dark, setDark, children }) {
  const base = MODULES[module]
  const [navigation, setNavigation] = useState(null)
  const { pathname } = useLocation()
  const config = { ...base, ...navigation }
  const items = config.items || [{ key: module, label: config.title }]
  const activeKey = config.activeKey || items.find(item => item.to === pathname)?.key || items[0]?.key
  return (
    <NavigationContext.Provider value={setNavigation}>
      <div className="module-shell min-h-screen bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100">
        <aside id="module-sidebar" aria-label={`${config.title}导航`} className="module-sidebar flex flex-col gap-1 p-4 w-[220px] shrink-0 border-r border-black/[0.05] dark:border-white/[0.06] bg-stone-50 dark:bg-[#100f0e] sticky left-0 top-0 h-screen z-30 overflow-y-auto">
          <div className="mb-3"><BackButton /></div>
          <div className="px-2 mb-4"><div className="text-base font-semibold mb-0.5">{config.title}</div><div className="text-[11.5px] text-stone-500 dark:text-stone-400 leading-relaxed">{config.subtitle}</div></div>
          <nav aria-label="模块页面" className="space-y-1">{items.map(item => <NavItem key={item.key} {...{ item, activeKey, onSelect: config.onSelect, accent: config.accent }} />)}</nav>
          {config.sidebar}
          <div className="mt-auto pt-5 px-2 flex items-center justify-between gap-2"><span className="text-[11px] text-stone-400 dark:text-stone-500">DouBlog</span><button type="button" onClick={setDark} aria-label="切换主题" title="切换主题" className="w-8 h-8 rounded-lg border border-black/[0.08] dark:border-white/[0.1] text-stone-500 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]">{dark ? '☀' : '☾'}</button></div>
        </aside>
        <div className="module-main flex-1 min-w-0"><div className="module-content mx-auto w-full max-w-[1700px] px-10 py-8"><ModuleErrorBoundary resetKey={pathname}>{children}</ModuleErrorBoundary></div></div>
      </div>
    </NavigationContext.Provider>
  )
}
