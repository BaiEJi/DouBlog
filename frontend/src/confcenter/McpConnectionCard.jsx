export default function McpConnectionCard({ module, toast }) {
  const authorization = 'Bearer <YOUR_TOKEN>'
  const example = JSON.stringify({ mcpServers: { [module.server_name]: {
    type: 'http', url: module.endpoint, headers: { Authorization: authorization },
  } } }, null, 2)
  const label = 'text-xs font-medium text-stone-500 dark:text-stone-400'
  async function copy() {
    try { await navigator.clipboard.writeText(example); toast('MCP 配置已复制') }
    catch { toast('请展开 JSON 示例后手动复制', 'error') }
  }
  return <section aria-label="MCP 接入配置" className="min-w-0 rounded-2xl border border-black/[0.07] bg-white p-5 dark:border-white/[0.07] dark:bg-white/[0.025]">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold">MCP 接入配置</h2>
      <button type="button" onClick={copy} className="text-sm font-medium text-cyan-700 hover:underline dark:text-cyan-300">复制配置</button>
    </div>
    <dl className="mt-4 space-y-3">
      <div><dt className={label}>传输方式</dt><dd className="mt-1 text-sm">Streamable HTTP</dd></div>
      <div><dt className={label}>服务地址 · {module.remote_enabled ? 'HTTPS 远程接入' : '本机接入'}</dt>
        <dd className="mt-1 select-all break-all font-mono text-[13px]">{module.endpoint}</dd></div>
      <div><dt className={label}>认证请求头</dt>
        <dd className="mt-1 select-all break-all font-mono text-[13px]">Authorization: {authorization}</dd></div>
    </dl>
    <details className="mt-4 border-t border-black/[0.07] pt-3 text-sm dark:border-white/10">
      <summary className="w-fit cursor-pointer font-medium text-cyan-700 dark:text-cyan-300">JSON 配置示例</summary>
      <p className="my-2 leading-6 text-stone-600 dark:text-stone-300">支持 <code>mcpServers</code> 的客户端可使用以下配置，将 <code>&lt;YOUR_TOKEN&gt;</code> 替换成已签发的令牌。</p>
      <pre className="whitespace-pre-wrap rounded-lg bg-stone-100 p-3 font-mono text-xs leading-5 [overflow-wrap:anywhere] dark:bg-white/5">{example}</pre>
    </details>
  </section>
}
