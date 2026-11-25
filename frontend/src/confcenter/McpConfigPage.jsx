import { useEffect, useId, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SYSTEMS } from '@/portal/systems'
import { confMcpModules, confMcpSetTool } from './api'
import McpTokenCard from './McpTokenCard'
import McpConnectionCard from './McpConnectionCard'

// 门户使用页面路由名，MCP 使用后端能力包名。
const backendKeys = { config: 'system', logs: 'sdklogs' }
const portalModules = SYSTEMS.map(({ key, title, icon }) => ({ key: backendKeys[key] ?? key, title, icon }))

function ModuleSidebar({ choices, current, onSelect }) {
  return <aside className="sticky top-6 w-40 shrink-0 self-start overflow-y-auto max-h-[calc(100vh-64px)] rounded-2xl border border-black/[0.07] bg-white p-2 dark:border-white/[0.07] dark:bg-white/[0.025]">
    <h2 className="px-2.5 pb-2 pt-1.5 text-base font-semibold">模块</h2>
    <nav aria-label="MCP 模块" className="space-y-2">
      {[{ title: '已接入', rows: choices.filter(item => item.provider) },
        { title: '未接入', rows: choices.filter(item => !item.provider) }].map(({ title, rows }) =>
        rows.length > 0 && <div key={title}>
          <h3 className="px-2.5 py-1.5 text-xs font-medium text-stone-500 dark:text-stone-400">{title}</h3>
          <ul>{rows.map(item => <li key={item.key}>
            <button type="button" aria-current={item.key === current ? 'page' : undefined} onClick={() => onSelect(item.key)}
              className={'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ' + (item.key === current
                ? 'bg-cyan-50 font-semibold text-cyan-800 dark:bg-cyan-400/10 dark:text-cyan-300'
                : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/5')}>
              {item.icon && <span aria-hidden="true" className="shrink-0 [&_svg]:h-4 [&_svg]:w-4">{item.icon}</span>}
              <span className="truncate">{item.title}</span>
            </button>
          </li>)}</ul>
        </div>)}
    </nav>
  </aside>
}

function fieldType(field) {
  if (field.anyOf) return field.anyOf.filter(item => item.type !== 'null').map(fieldType).join(' / ')
  if (field.enum) return field.enum.join(' / ')
  if (field.const !== undefined) return String(field.const)
  if (field.format) return field.format
  if (field.type === 'array') return fieldType(field.items ?? {}) + '[]'
  return field.type ?? field.$ref?.split('/').pop() ?? 'JSON'
}

function ToolDetails({ tool, id }) {
  const schema = tool.input_schema
  const fields = Object.entries(schema?.properties ?? {})
  return <section id={id} aria-label={tool.title + '详情'} className="border-t border-black/[0.05] bg-stone-50/70 px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.025]">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <code className="break-all text-sm font-medium">{tool.name}</code>
      <span className="text-xs text-stone-500 dark:text-stone-400">{tool.read_only ? '只读工具' : '写入工具'}</span>
    </div>
    <p className="my-2 text-sm leading-6">{tool.description}</p>
    {fields.length > 0 ? <div className="max-h-80 overflow-y-auto [scrollbar-gutter:stable]">
      <table aria-label="输入参数" className="w-full table-fixed text-left text-[13px] leading-5 [overflow-wrap:anywhere]">
        <colgroup>
          <col className="w-[22%]" /><col className="w-[17%]" /><col className="w-[32%]" />
          <col className="w-[23%]" /><col className="w-[6%]" />
        </colgroup>
        <thead className="sticky top-0 bg-stone-50 text-stone-600 dark:bg-[#1c1b1a] dark:text-stone-300"><tr>
          <th scope="col" className="py-1.5 pr-2 font-medium">参数</th>
          <th scope="col" className="pr-2 font-medium">类型或取值</th>
          <th scope="col" className="pr-2 font-medium">参数含义</th>
          <th scope="col" className="pr-2 font-medium">示例参数</th>
          <th scope="col" className="whitespace-nowrap text-right font-medium">必填</th>
        </tr></thead>
        <tbody>{fields.map(([name, field]) => <tr key={name} className="border-t border-black/[0.06] align-top dark:border-white/[0.06]">
          <th scope="row" className="py-2 pr-2 font-normal">
            <code>{name.split('_').map((part, i) => <span key={i}>{i > 0 && <>_<wbr /></>}{part}</span>)}</code>
          </th>
          <td className="py-2 pr-2 text-stone-600 dark:text-stone-400">{fieldType(field)}</td>
          <td className="py-2 pr-2">{field.description || '—'}</td>
          <td className="py-2 pr-2"><code className="select-all whitespace-pre-wrap text-cyan-800 dark:text-cyan-300">
            {field.examples?.length ? field.examples.map(value => JSON.stringify(value)).join('\n') : '—'}
          </code></td>
          <td className="py-2 text-right">{schema.required?.includes(name) ? '是' : '否'}</td>
        </tr>)}</tbody>
      </table>
    </div> : schema && <p className="text-xs text-stone-500 dark:text-stone-400">无需输入参数</p>}
  </section>
}

function ToolRow({ moduleKey, tool, onSaved, say }) {
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const detailId = useId()
  async function toggle() {
    setBusy(true)
    try {
      const saved = await confMcpSetTool(moduleKey, tool.name, !tool.enabled)
      onSaved(moduleKey, saved)
    } catch (err) { say(err.message, 'error') }
    finally { setBusy(false) }
  }
  return <li className="border-b border-black/[0.05] last:border-0 dark:border-white/[0.06]">
    <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto_36px] items-center gap-2.5 px-4 py-2.5">
      <span className="text-[15px] font-medium">{tool.title}</span>
      <code title={tool.name} className="truncate text-[13px] text-stone-500 dark:text-stone-400">{tool.name}</code>
      <button type="button" aria-expanded={expanded} aria-controls={detailId} aria-label={(expanded ? '收起详情，' : '查看详情，') + tool.title}
        className="rounded px-1 py-1 text-xs font-medium text-cyan-700 hover:underline dark:text-cyan-300" onClick={() => setExpanded(value => !value)}>
        {expanded ? '收起详情' : '查看详情'}
      </button>
      <button type="button" role="switch" aria-label={tool.title} aria-checked={tool.enabled} disabled={busy} onClick={toggle}
        className={'relative h-5 w-9 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 disabled:opacity-50 ' +
          (tool.enabled ? 'bg-cyan-700 dark:bg-cyan-600' : 'bg-stone-300 dark:bg-stone-600')}>
        <span aria-hidden="true" className={'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform left-0.5 ' +
          (tool.enabled ? 'translate-x-4' : '')} />
      </button>
    </div>
    {expanded && <ToolDetails tool={tool} id={detailId} />}
  </li>
}

export default function McpConfigPage({ say }) {
  const [modules, setModules] = useState(null)
  const [params, setParams] = useSearchParams()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    confMcpModules().then(rows => {
      if (active) { setModules(rows); setError('') }
    }).catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [attempt])

  function onSaved(key, saved) {
    setModules(items => items.map(item => item.key !== key ? item : {
      ...item, tools: item.tools.map(tool => tool.name === saved.name ? { ...tool, enabled: saved.enabled } : tool),
    }))
  }
  if (error) return <div role="alert" className="text-sm">{error} <button className="ml-2 text-cyan-700 dark:text-cyan-300" onClick={() => setAttempt(n => n + 1)}>重试</button></div>
  if (!modules) return <p role="status" className="text-sm text-stone-500">正在读取 MCP 配置…</p>
  const directory = new Map(portalModules.map(item => [item.key, item]))
  for (const provider of modules) {
    directory.set(provider.key, { ...directory.get(provider.key), key: provider.key, title: provider.title, provider })
  }
  const choices = [...directory.values()]
  const selected = directory.get(params.get('module')) ?? choices.find(item => item.provider) ?? choices[0]
  const module = selected.provider
  function selectModule(key) {
    if (key === selected.key) return
    setParams(previous => {
      const next = new URLSearchParams(previous)
      next.set('module', key)
      return next
    })
  }
  const groups = new Map()
  for (const tool of module?.tools ?? []) {
    if (!groups.has(tool.group)) groups.set(tool.group, [])
    groups.get(tool.group).push(tool)
  }
  return <div className="flex items-start gap-4">
    <ModuleSidebar choices={choices} current={selected.key} onSelect={selectModule} />
    {module ? <div className="flex min-w-0 flex-1 flex-wrap items-start gap-4">
      <section className="min-w-0 flex-[1.7_1_445px] overflow-hidden rounded-2xl border border-black/[0.07] bg-white dark:border-white/[0.07] dark:bg-white/[0.025]" aria-label="开放工具">
        <div className="flex items-baseline justify-between gap-3 px-5 pt-5">
          <h2 className="text-base font-semibold">开放工具</h2>
          <span aria-live="polite" className="text-sm tabular-nums text-stone-500 dark:text-stone-400">已开放 {module.tools.filter(tool => tool.enabled).length} / {module.tools.length}</span>
        </div>
        <p className="px-5 pb-4 pt-1 text-sm text-stone-500 dark:text-stone-400">开关即时生效，适用于此模块的所有令牌。</p>
        {[...groups].map(([group, tools]) => <div key={group}>
          <h3 className="border-y border-black/[0.05] bg-stone-50 px-5 py-2 text-[13px] font-semibold text-stone-600 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-stone-300">{group}</h3>
          <ul>{tools.map(tool => <ToolRow key={module.key + '/' + tool.name} moduleKey={module.key} tool={tool} onSaved={onSaved} say={say} />)}</ul>
        </div>)}
      </section>
      <div key={module.key} className="min-w-0 flex-[1_1_285px] space-y-4">
        <McpTokenCard module={module} toast={say} />
        <McpConnectionCard module={module} toast={say} />
      </div>
    </div> : <p className="flex-1 rounded-2xl border border-black/[0.07] bg-white p-8 text-sm text-stone-600 dark:border-white/[0.07] dark:bg-white/[0.025] dark:text-stone-300">
      {selected.title} 尚未接入 MCP。
    </p>}
  </div>
}
