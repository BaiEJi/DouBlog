/** URL 解析：协议/主机/端口/路径/参数/锚点拆解 + 查询参数表格（原生 URL API） */
import { useMemo, useState } from 'react'
import { ToolHead, CopyBtn, StatusLine, inputCls, card } from '../kit'

export default function UrlParseTool() {
  const [input, setInput] = useState('https://user:pass@example.com:8443/blog/post/42?tab=comments&sort=new%20first&tab=reply#footer')

  const { url, error } = useMemo(() => {
    if (!input.trim()) return { url: null, error: null }
    try {
      return { url: new URL(input), error: null }
    } catch {
      return { url: null, error: '无效 URL（需含协议，如 https:// ）' }
    }
  }, [input])

  const parts = url ? [
    ['协议 protocol', url.protocol],
    ['用户名 username', url.username || '—'],
    ['密码 password', url.password ? '•'.repeat(url.password.length) : '—'],
    ['主机 hostname', url.hostname],
    ['端口 port', url.port || '（默认）'],
    ['主机头 host', url.host],
    ['路径 pathname', url.pathname],
    ['查询 search', url.search || '—'],
    ['锚点 hash', url.hash || '—'],
    ['来源 origin', url.origin],
  ] : []

  const params = []
  if (url) url.searchParams.forEach((v, k) => params.push([k, v]))

  return (
    <div>
      <ToolHead title="URL 解析" desc="拆解各组成部分；查询参数逐项展开（保留重复键），可单独复制" />
      <input className={inputCls + ' w-full font-mono text-[13px]'} value={input} spellCheck={false}
        onChange={e => setInput(e.target.value)} placeholder="https://…" aria-label="URL 输入" />
      <div className="mt-2"><StatusLine ok={!!url} err={error} okText="解析成功" /></div>
      {url && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <div className={'divide-y divide-black/[0.05] dark:divide-white/[0.06] ' + card}>
            {parts.map(([k, v]) => (
              <div key={k} className="flex items-center gap-3 px-4 py-2">
                <span className="w-32 shrink-0 text-xs text-stone-500 dark:text-stone-400">{k}</span>
                <code className="flex-1 min-w-0 font-mono text-[12.5px] text-stone-800 dark:text-stone-100 break-all">{v}</code>
                <CopyBtn text={v} disabled={v === '—'} />
              </div>
            ))}
          </div>
          <div className={card}>
            <p className="px-4 py-3 text-sm font-semibold border-b border-black/[0.05] dark:border-white/[0.06]">查询参数（{params.length} 项）</p>
            {params.length ? (
              <div className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
                {params.map(([k, v], i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2">
                    <code className="font-mono text-[12.5px] text-lime-700 dark:text-lime-400 shrink-0">{k}</code>
                    <code className="flex-1 min-w-0 font-mono text-[12.5px] text-stone-700 dark:text-stone-200 break-all">= {v}</code>
                    <CopyBtn text={v} />
                  </div>
                ))}
              </div>
            ) : <p className="px-4 py-3 text-[13px] text-stone-400">无查询参数。</p>}
          </div>
        </div>
      )}
    </div>
  )
}
