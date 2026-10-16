/** 命名转换：camelCase / snake_case / kebab-case 等 13 种风格一键全出 */
import { useMemo, useState } from 'react'
import { ToolHead, CopyBtn, inputCls, card } from '../kit'
import { caseConversions } from '../lib/text'

export default function CaseConvertTool() {
  const [text, setText] = useState('getUserByID http_response_code')

  const rows = useMemo(() => text.trim() ? caseConversions(text) : [], [text])

  return (
    <div>
      <ToolHead title="命名转换" desc="自动切词（驼峰边界 / 分隔符 / 中英混排），13 种命名风格同时给出" />
      <input className={inputCls + ' w-full font-mono'} value={text} spellCheck={false}
        onChange={e => setText(e.target.value)} placeholder="输入标识符，如 getUserByID / http_response_code" aria-label="标识符输入" />
      <div className={'mt-4 divide-y divide-black/[0.05] dark:divide-white/[0.06] ' + card}>
        {rows.map(r => (
          <div key={r.label} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-44 shrink-0 text-xs text-stone-500 dark:text-stone-400">{r.label}</span>
            <code className="flex-1 min-w-0 font-mono text-[13px] text-stone-800 dark:text-stone-100 break-all">{r.value || '—'}</code>
            <CopyBtn text={r.value} disabled={!r.value} />
          </div>
        ))}
        {!rows.length && <p className="px-4 py-3 text-[13px] text-stone-400">输入后显示全部风格。</p>}
      </div>
    </div>
  )
}
