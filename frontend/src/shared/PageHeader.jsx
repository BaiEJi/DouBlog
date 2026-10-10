/**
 * 模块页公共顶栏 v2（全站统一模板）。
 *
 * 结构（两行，第二行可选）：
 * ┌──────────────────────────────────────────────────────┐
 * │ [‹ 门户]  Title  subtitle          [right actions]   │  ← 第一行 h-14
 * ├──────────────────────────────────────────────────────┤
 * │ [Tab] [Tab] [Tab] ...                               │  ← 第二行（可选，pill 药丸式）
 * └──────────────────────────────────────────────────────┘
 *
 * - 有子 Tab 的模块（todo/apihub/gamemap）传 tabs + activeTab + onTabChange
 * - 无子 Tab 的模块（confcenter/config）只传 title/subtitle/right
 * - 侧栏型页面（diary/subs/vault 解锁态）可单独用 BackButton
 * - 容器统一 px-4 sm:px-6 xl:px-10 max-w-[1700px] mx-auto
 */
import { Link } from 'react-router-dom'

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

/**
 * 统一 Tab 药丸组。
 * @param {Array<{key: string, label: string, icon?: ReactNode}>} tabs
 * @param {string} activeTab
 * @param {(key: string) => void} onTabChange
 * @param {string} [accent] — 选中态主色（默认 stone 中性；模块个性色传 'indigo'|'cyan'|'amber' 等）
 */
export function HeaderTabs({ tabs, activeTab, onTabChange, accent = 'stone' }) {
  const ACCENT = {
    stone: 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900',
    indigo: 'bg-indigo-600 text-white',
    cyan: 'bg-cyan-600 text-white',
    amber: 'bg-amber-500 text-white',
    violet: 'bg-violet-600 text-white',
    sky: 'bg-sky-600 text-white',
  }
  return (
    <nav className="flex items-center gap-1 overflow-x-auto pb-3">
      {tabs.map(t => (
        <button key={t.key} onClick={() => onTabChange(t.key)}
          className={`inline-flex items-center gap-1.5 px-3.5 h-9 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
            activeTab === t.key
              ? ACCENT[accent] || ACCENT.stone
              : 'text-stone-600 dark:text-stone-300 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
          }`}>
          {t.icon}{t.label}
        </button>
      ))}
    </nav>
  )
}

/**
 * 统一模块顶栏。
 *
 * @param {string} title
 * @param {string} [subtitle]
 * @param {string} [backTo='/'] — 返回目标路由
 * @param {string} [backLabel='门户']
 * @param {ReactNode} [right] — 右侧操作区（主题切换、按钮）
 * @param {Array<{key,label,icon?}>} [tabs] — 子 Tab（可选）
 * @param {string} [activeTab] — 当前激活的 Tab key
 * @param {(key) => void} [onTabChange]
 * @param {string} [accent] — Tab 选中色（默认 stone；传模块个性色）
 * @param {ReactNode} [extra] — 额外内容（优先级低于 tabs；一般不混用）
 */
export default function PageHeader({
  title, subtitle, backTo = '/', backLabel = '门户', right,
  tabs, activeTab, onTabChange, accent,
  extra,
}) {
  return (
    <header className="sticky top-0 z-30 bg-stone-50/95 dark:bg-[#100f0e]/95 backdrop-blur border-b border-black/[0.06] dark:border-white/[0.07]">
      <div className="mx-auto w-full max-w-[1700px] px-4 sm:px-6 xl:px-10">
        {/* 第一行：返回 + 标题 + 右侧操作 */}
        <div className="h-14 flex items-center gap-3">
          <BackButton to={backTo} label={backLabel} />
          <h1 className="text-2xl font-semibold tracking-tight truncate">{title}</h1>
          {subtitle && (
            <span className="hidden lg:inline text-xs text-stone-500 dark:text-stone-400 truncate">{subtitle}</span>
          )}
          <div className="ml-auto flex items-center gap-2 shrink-0">{right}</div>
        </div>
        {/* 第二行：统一 Tab 或自定义内容 */}
        {tabs && tabs.length > 0 && (
          <HeaderTabs tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} accent={accent} />
        )}
        {!tabs && extra}
      </div>
    </header>
  )
}
