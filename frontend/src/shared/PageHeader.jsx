/** PageHeader adapts a page's stateful tabs to ModuleShell's shared sidebar. */
import { Link } from 'react-router-dom'
import { useModuleNavigation } from './module-navigation'

const ARROW = (
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="none">
    <path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export function BackButton({ to = '/', label = '门户' }) {
  return (
    <Link to={to}
      style={{ color: undefined, textDecoration: 'none' }}
      className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-black/[0.1] dark:border-white/[0.12] text-sm font-medium !text-stone-700 dark:!text-stone-200 bg-white dark:bg-white/[0.04] hover:bg-black/[0.04] dark:hover:bg-white/[0.08] transition-colors shrink-0 no-underline">
      {ARROW}<span>{label}</span>
    </Link>
  )
}

export default function PageHeader({ title, subtitle, tabs, activeTab, onTabChange, accent, extra, hideTitle }) {
  useModuleNavigation({ title, subtitle, ...(accent ? { accent } : {}), ...(tabs?.length ? { items: tabs, activeKey: activeTab, onSelect: onTabChange } : {}) })
  const label = tabs?.find(tab => tab.key === activeTab)?.label || title
  if (hideTitle) return null
  return <div className="mb-6"><h1 className="text-base font-semibold tracking-tight">{label}</h1>{extra}</div>
}
