import { Card } from '../kit'
import './reports.css'

export function ReportPage({ title, controls, children }) {
  return (
    <div role="region" aria-label={title} className="todo-report h-full min-h-0 overflow-y-auto">
      {controls && <header className="flex items-center">{controls}</header>}
      {children}
    </div>
  )
}

export function ReportPanel({ title, controls, children }) {
  return (
    <Card className="min-w-0">
      <header className="mb-5 flex min-h-10 items-center justify-between gap-3">
        <h2 className="shrink-0 text-lg font-semibold">{title}</h2>
        {controls}
      </header>
      {children}
    </Card>
  )
}

export function ReportMetrics({ items, compact = false }) {
  return (
    <dl className={'todo-report-metrics' + (compact ? ' is-compact' : '')}>
      {items.map(({ label, value, unit, accent }) => (
        <div key={label} className="min-w-0">
          <dt>{label}</dt>
          <dd className={accent ? 'text-indigo-700 dark:text-indigo-300' : ''}>
            {value}<span>{unit}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}
