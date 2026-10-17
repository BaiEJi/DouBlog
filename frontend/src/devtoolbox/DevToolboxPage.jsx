/**
 * 开发者工具箱页 /devtoolbox：31 个工具、8 大分类。
 *
 * - 侧栏（ModuleShell 多级菜单）：分类 → 工具两级；选中态同步 ?t=<工具id> 深链
 * - 首页：搜索框（按名称/描述/分类过滤）+ 分组卡片网格
 * - 绝大多数工具纯本地计算；哈希/字符集互转/JSON⇄YAML/二维码 走 /api/devtoolbox
 * 个性色 lime（docs/ui-baseline.md）。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useModuleNavigation } from '../shared/module-navigation'
import { GROUPS, findTool } from './registry'
import { Toast, inputCls, card } from './kit'

/** 工具加载骨架（lazy 分包的占位） */
function ToolFallback() {
  return (
    <div className="py-16 flex items-center justify-center">
      <div className="w-40 h-2 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
        <div className="h-full w-1/2 rounded-full bg-black/15 dark:bg-white/20 animate-pulse" />
      </div>
    </div>
  )
}

export default function DevToolboxPage() {
  const [params, setParams] = useSearchParams()
  const toolId = params.get('t') || ''
  const [q, setQ] = useState('')
  // 轻提示状态（3.2s 自动消失）
  const [toastData, setToastData] = useState(null)
  const toastTimer = useRef(null)
  const toast = useCallback(t => {
    setToastData({ ...t, onDismiss: () => setToastData(null) })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastData(null), 3200)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const active = findTool(toolId)

  const onSelect = useCallback(key => {
    // 分组头点击 → 进入该组第一个工具；工具点击 → 切换
    const target = key.startsWith('g:') ? GROUPS.find(g => g.id === key.slice(2))?.tools[0]?.id : key
    if (!target) return
    setParams(target ? { t: target } : {}, { replace: false })
    window.scrollTo({ top: 0 })
  }, [setParams])

  const navItems = useMemo(
    () => GROUPS.map(g => ({
      key: 'g:' + g.id,
      label: g.name,
      children: g.tools.map(t => ({ key: t.id, label: t.name })),
    })),
    [])

  useModuleNavigation({
    title: '开发者工具箱',
    subtitle: '31 个工具 · 大部分本地计算',
    accent: 'lime',
    items: navItems,
    activeKey: toolId,
    onSelect,
  })

  const query = q.trim().toLowerCase()
  const filteredGroups = useMemo(() => {
    if (!query) return GROUPS
    return GROUPS
      .map(g => ({
        ...g,
        tools: g.tools.filter(t =>
          t.id.includes(query) || t.name.toLowerCase().includes(query) || t.desc.toLowerCase().includes(query) || g.name.toLowerCase().includes(query)),
      }))
      .filter(g => g.tools.length)
  }, [query])

  const totalShown = filteredGroups.reduce((n, g) => n + g.tools.length, 0)

  return (
    <div>
      {active ? (
        <Suspense fallback={<ToolFallback />}>
          <active.Component toast={toast} />
        </Suspense>
      ) : (
        <div>
          <div className="mb-5">
            <h1 className="text-2xl font-semibold tracking-tight">开发者工具箱</h1>
            <p className="mt-1.5 text-[13px] text-stone-500 dark:text-stone-400">
              31 个日常高频工具——JSON 处理、diff 对比、编解码、哈希、时间、转换生成；除标注「后端」的 4 类外全部浏览器本地计算，数据不出本机
            </p>
          </div>
          <div className="relative mb-5">
            <input autoFocus className={inputCls + ' w-full max-w-lg pl-9'} value={q} spellCheck={false}
              onChange={e => setQ(e.target.value)} placeholder="搜索工具：名称 / 描述 / 分类…" aria-label="搜索工具" />
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" viewBox="0 0 20 20" fill="none">
              <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="m13.5 13.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="space-y-6">
            {filteredGroups.map(g => (
              <section key={g.id}>
                <div className="flex items-center gap-2 mb-2.5">
                  <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-200">{g.name}</h2>
                  <span className="text-[11px] text-stone-400 tabular-nums">{g.tools.length} 个</span>
                  <span className="flex-1 border-b border-black/[0.05] dark:border-white/[0.06]" />
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {g.tools.map(t => (
                    <button key={t.id}
                      className={'group text-left p-4 rounded-2xl border transition-all duration-200 ' + card + ' hover:border-black/[0.18] dark:hover:border-white/[0.2] hover:shadow-md hover:-translate-y-0.5'}
                      onClick={() => onSelect(t.id)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[14.5px] font-medium">{t.name}</span>
                        <span className="text-stone-300 dark:text-stone-600 group-hover:text-lime-600 dark:group-hover:text-lime-400 transition-all opacity-0 group-hover:opacity-100 -translate-x-1 group-hover:translate-x-0">→</span>
                      </div>
                      <p className="mt-1 text-xs text-stone-500 dark:text-stone-400 leading-relaxed">{t.desc}</p>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {!totalShown && (
              <p className="py-12 text-center text-[13px] text-stone-400">没有匹配「{q}」的工具——试试 json / diff / 编码 / 时间等关键词</p>
            )}
          </div>
        </div>
      )}
      <Toast t={toastData} />
    </div>
  )
}
