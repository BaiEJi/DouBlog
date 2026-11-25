import { useEffect, useState } from 'react'
import { makeClipboardCopier } from '@/shared/sensitiveClipboard'
import { btn, Confirm, inputCls } from '@/shared/ui/kit'
import { confMcpIssueToken, confMcpRenewToken, confMcpTokens, confMcpRevokeToken } from './api'

const copySecret = makeClipboardCopier(60000)
export default function McpTokenCard({ module, toast }) {
  const [tokens, setTokens] = useState(null)
  const [name, setName] = useState('')
  const [issued, setIssued] = useState(null)
  const [revoke, setRevoke] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    confMcpTokens(module.key).then(rows => {
      if (active) { setTokens(rows); setError('') }
    }).catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [module.key, attempt])

  async function issue(e) {
    e.preventDefault()
    setBusy(true)
    try {
      const { token, ...item } = await confMcpIssueToken(module.key, name.trim() || 'MCP 客户端')
      setIssued({ id: item.id, token })
      setTokens(prev => [item, ...prev])
    } catch (err) { toast(err.message, 'error') }
    finally { setBusy(false) }
  }

  async function renew(item) {
    setBusy(true)
    try {
      const updated = await confMcpRenewToken(module.key, item.id, item.expires_at)
      setTokens(rows => rows.map(row => row.id === updated.id ? updated : row))
      toast('已续期 30 天')
    } catch (err) {
      toast(err.message, 'error')
      setTokens(null)
      setAttempt(n => n + 1)
    }
    finally { setBusy(false) }
  }

  async function remove() {
    const id = revoke.id
    setRevoke(null)
    setBusy(true)
    try {
      await confMcpRevokeToken(module.key, id)
      setTokens(prev => prev.filter(item => item.id !== id))
      if (issued?.id === id) setIssued(null)
      toast('令牌已撤销')
    } catch (err) { toast(err.message, 'error') }
    finally { setBusy(false) }
  }

  return (
    <section aria-label="访问令牌" className="min-w-0 rounded-2xl border border-black/[0.07] bg-white p-5 dark:border-white/[0.07] dark:bg-white/[0.025]">
      <h2 className="mb-1 text-base font-semibold">访问令牌</h2>
      <p className="text-sm leading-6 text-stone-600 dark:text-stone-300">{module.title} 模块令牌有效期 30 天，可续期。</p>
      {error ? <div className="mt-3 text-sm" role="alert">{error} <button className={btn.plain} onClick={() => setAttempt(n => n + 1)}>重试</button></div> :
        !tokens ? <p className="mt-3 text-sm text-stone-500">正在读取令牌…</p> :
        <div className="mt-4 space-y-4">
          <form onSubmit={issue}>
            <label htmlFor="mcp-client-name" className="mb-1.5 block text-sm font-medium">客户端名称</label>
            <div className="flex items-center gap-2">
              <input id="mcp-client-name" className={inputCls + ' min-w-0'} maxLength={64} value={name}
                onChange={e => setName(e.target.value)} placeholder="如：桌面助手" />
              <button className="shrink-0 rounded-lg bg-cyan-700 px-3.5 h-9 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-50" disabled={busy || !!issued}>签发令牌</button>
            </div>
          </form>
          {issued && <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 dark:border-cyan-400/30 dark:bg-cyan-400/10">
            <p className="mb-2 text-sm font-medium">令牌只显示这一次，请先复制保存。</p>
            <input aria-label="新签发的令牌" readOnly value={issued.token} onFocus={e => e.target.select()} className={inputCls + ' font-mono'} />
            <div className="mt-2 flex items-center gap-2">
              <button className={btn.plain} onClick={async () => {
                if (await copySecret(issued.token)) toast('令牌已复制')
                else toast('请选择令牌后手动复制', 'error')
              }}>复制令牌</button>
              <button className={btn.ghost} onClick={() => setIssued(null)}>已保存</button>
            </div>
          </div>}
          {tokens.length > 0 && <ul className="divide-y divide-black/10 dark:divide-white/10">
            {tokens.map(item => <li key={item.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0"><div className="truncate font-medium">{item.name}</div>
                <div className="mt-1 text-xs text-stone-500 dark:text-stone-400"><code>••••{item.hint}</code> · 有效至 {new Date(item.expires_at).toLocaleDateString('zh-CN')}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" aria-label={'为 ' + item.name + ' 续期 30 天'} title="延长 30 天，已到期的令牌从当前时间起算"
                  disabled={busy} className="h-7 rounded-lg px-2 text-xs font-medium text-cyan-700 hover:bg-cyan-50 disabled:opacity-50 dark:text-cyan-300 dark:hover:bg-cyan-400/10"
                  onClick={() => renew(item)}>续期</button>
                <button type="button" aria-label={'撤销 ' + item.name} disabled={busy} className={btn.danger} onClick={() => setRevoke(item)}>撤销</button>
              </div>
            </li>)}
          </ul>}
        </div>}
      {revoke && <Confirm text={`撤销「${revoke.name}」尾号 ${revoke.hint} 的令牌？使用它的客户端将立即失去访问权限。`} onOk={remove} onCancel={() => setRevoke(null)} danger />}
    </section>
  )
}
