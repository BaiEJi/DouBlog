/**
 * 导入导出面板：粘贴 JSON / 选择文件导入（先预检后执行，create/upsert 两种模式）；
 * 按当前过滤条件或全量导出（可选包含历史版本）。
 */
import { useRef, useState } from 'react'
import { assetsExport, assetsImport } from '../api'
import { BTN_GHOST, BTN_PRIMARY } from '../kit'

export default function ImportPanel({ filters, onClose, onDone, toast }) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState('upsert')
  const [preview, setPreview] = useState(null)     // dry_run 结果
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const parse = () => {
    let data = JSON.parse(text)
    if (Array.isArray(data)) data = { items: data }
    if (!Array.isArray(data.items)) throw new Error('items 不是数组')
    if (!data.items.length) throw new Error('items 为空')
    return data
  }

  const run = async dry => {
    if (busy) return
    let payload
    try { payload = parse() } catch (e) {
      toast(`JSON 解析失败：${e.message}`, 'error')
      return
    }
    setBusy(true)
    try {
      const r = await assetsImport({ ...payload, mode, dry_run: dry })
      if (!r.success) { toast(r.message || '导入失败', 'error'); return }
      if (dry) {
        setPreview(r.data)
        toast(`预检完成：${r.data.valid} 条有效，${r.data.errors.length} 条有误`)
      } else {
        toast(`导入完成：新建 ${r.data.created}，更新 ${r.data.updated}` +
          (r.data.errors.length ? `，${r.data.errors.length} 条失败` : ''))
        onDone()
        onClose()
      }
    } finally { setBusy(false) }
  }

  const doExport = async withVersions => {
    if (busy) return
    setBusy(true)
    try {
      const r = await assetsExport({ ...filters, include_versions: withVersions ? 1 : '' })
      if (r.success) { toast('已导出'); onClose() }
      else toast(r.message || '导出失败', 'error')
    } finally { setBusy(false) }
  }

  const onFile = e => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result || ''))
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="导入导出">
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[84vh] flex flex-col rounded-2xl border border-black/[0.08] dark:border-white/[0.1] bg-white dark:bg-[#1c1b1a] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.08]">
          <h3 className="text-[15px] font-semibold">导入 / 导出</h3>
          <button type="button" onClick={onClose} aria-label="关闭"
            className="w-8 h-8 rounded-lg text-stone-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]">✕</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
          {/* 导入 */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[13.5px] font-semibold">导入</h4>
              <div className="flex items-center gap-2">
                <button type="button" className={BTN_GHOST} onClick={() => fileRef.current?.click()}>选择文件…</button>
                <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
              </div>
            </div>
            <p className="text-[11.5px] text-stone-400 mb-2">
              粘贴或选择本库导出的 JSON（也接受 {`[{title, content, ...}]`} 最小格式）；
              upsert 按「类型 + 标题」匹配更新，create 总是新建；分类按名称自动匹配/创建。
            </p>
            <textarea value={text} onChange={e => { setText(e.target.value); setPreview(null) }} rows={6} spellCheck={false}
              placeholder='{"items": [{"kind": "prompt", "title": "示例", "content": "你好 {{name}}"}]}'
              className="w-full px-3.5 py-3 rounded-xl border border-black/[0.1] dark:border-white/[0.12] bg-white dark:bg-white/[0.04] text-[12.5px] font-mono outline-none focus:border-black/30 dark:focus:border-white/30 resize-y" />
            <div className="flex items-center gap-2 mt-2.5">
              <div className="flex rounded-xl border border-black/[0.1] dark:border-white/[0.12] overflow-hidden">
                {[['upsert', 'upsert（智能合并）'], ['create', 'create（全部新建）']].map(([v, label]) => (
                  <button key={v} type="button" onClick={() => setMode(v)}
                    className={`px-3 py-1.5 text-[12px] transition-colors ${mode === v
                      ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
                      : 'text-stone-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'}`}>{label}</button>
                ))}
              </div>
              <span className="flex-1" />
              <button type="button" className={BTN_GHOST} disabled={!text.trim() || busy} onClick={() => run(true)}>预检</button>
              <button type="button" className={BTN_PRIMARY} disabled={!text.trim() || busy} onClick={() => run(false)}>
                {busy ? '执行中…' : '导入'}
              </button>
            </div>

            {preview && (
              <div className="mt-3 px-3.5 py-3 rounded-xl border border-black/[0.07] dark:border-white/[0.09] bg-black/[0.02] dark:bg-white/[0.03] text-[12.5px] space-y-1.5">
                <p>有效 <b>{preview.valid}</b> 条 · 错误 <b className={preview.errors.length ? 'text-red-600 dark:text-red-400' : ''}>{preview.errors.length}</b> 条
                  {preview.categories_created.length > 0 && <> · 将创建分类：{preview.categories_created.join('、')}</>}</p>
                {preview.errors.slice(0, 5).map((e, i) => (
                  <p key={i} className="text-[11.5px] text-red-600 dark:text-red-400">#{e.index + 1} {e.title || '(无标题)'}：{e.error}</p>
                ))}
                {preview.errors.length > 5 && <p className="text-[11.5px] text-stone-400">…共 {preview.errors.length} 条错误</p>}
              </div>
            )}
          </section>

          {/* 导出 */}
          <section>
            <h4 className="text-[13.5px] font-semibold mb-2">导出</h4>
            <div className="flex items-center gap-2.5 flex-wrap">
              <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => doExport(false)}>
                导出（当前过滤条件）
              </button>
              <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => doExport(true)}>
                导出 + 历史版本
              </button>
              <span className="text-[11.5px] text-stone-400">
                {Object.values(filters).some(v => v) ? '按当前左侧过滤条件' : '当前无过滤，将导出全部'}
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
