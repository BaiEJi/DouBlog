/**
 * 工具箱：导入（Netscape HTML / JSON）· 导出（HTML / JSON）· 死链批量检测 · 重复链接清理。
 */
import { useEffect, useRef, useState } from 'react'

import { importBookmarks, exportBookmarks, checkLinks, listDuplicates, batchItems } from '../api'
import { Card, Icon, Spinner, Empty } from '../../todo/kit'

export default function ToolsView({ toast, onChanged }) {
  const fileRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const [checking, setChecking] = useState(false)
  const [exporting, setExporting] = useState('')
  const [dups, setDups] = useState(null)
  const [dupBusy, setDupBusy] = useState(false)

  const reloadDups = () => {
    listDuplicates().then(setDups).catch(e => toast(e.message, 'err'))
  }
  useEffect(() => { reloadDups() }, [])

  const doImport = async file => {
    if (!file) return
    setImporting(true)
    try {
      const r = await importBookmarks(file)
      toast(`导入 ${r.imported} 条（跳过重复 ${r.skipped}，无效 ${r.invalid}，新建分类 ${r.categories_created}）`)
      onChanged()
      reloadDups()
    } catch (e) { toast(e.message, 'err') } finally { setImporting(false) }
  }

  const doExport = async format => {
    setExporting(format)
    try { await exportBookmarks(format); toast('已开始下载') }
    catch (e) { toast(e.message, 'err') } finally { setExporting('') }
  }

  const doCheck = async () => {
    setChecking(true)
    try {
      const r = await checkLinks([])
      toast(`检测 ${r.checked} 条：可达 ${r.ok} · 失效 ${r.dead} · 异常 ${r.error}`)
      onChanged()
    } catch (e) { toast(e.message, 'err') } finally { setChecking(false) }
  }

  const dedupGroup = async group => {
    // 保留最早收录的一条，其余移入回收站
    const victims = group.items.slice(1).map(i => i.id)
    if (!victims.length) return
    setDupBusy(true)
    try {
      await batchItems(victims, 'delete')
      toast(`已去重 ${victims.length} 条（保留最早收录）`)
      reloadDups(); onChanged()
    } catch (e) { toast(e.message, 'err') } finally { setDupBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="导入书签">
          <p className="text-xs text-stone-500 dark:text-stone-400 leading-6 mb-3">
            支持浏览器导出的 <span className="font-mono">Netscape HTML</span> 书签文件
            （Chrome / Edge / Firefox 导出书签即此格式）与本模块的 JSON 备份；文件夹自动建为分类，
            重复链接自动跳过。
          </p>
          <input ref={fileRef} type="file" accept=".html,.htm,.json" className="hidden"
            onChange={e => { doImport(e.target.files?.[0]); e.target.value = '' }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={importing}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors disabled:opacity-50">
            {Icon.plus}{importing ? '导入中…' : '选择文件导入'}</button>
        </Card>

        <Card title="导出备份">
          <p className="text-xs text-stone-500 dark:text-stone-400 leading-6 mb-3">
            HTML 可直接导入任何浏览器；JSON 为全量备份（含分类树 / 标签 / 状态 / 离线快照）。
          </p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => doExport('html')} disabled={!!exporting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50">
              {Icon.migrate}{exporting === 'html' ? '导出中…' : '导出 HTML（浏览器格式）'}</button>
            <button type="button" onClick={() => doExport('json')} disabled={!!exporting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors disabled:opacity-50">
              {Icon.migrate}{exporting === 'json' ? '导出中…' : '导出 JSON（全量备份）'}</button>
          </div>
        </Card>
      </div>

      <Card title="死链检测"
        extra={<button type="button" onClick={doCheck} disabled={checking}
          className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors disabled:opacity-50">
          {Icon.refresh}{checking ? '检测中…（最长 1 分钟）' : '检测最久未检的 50 条'}</button>}>
        <p className="text-xs text-stone-500 dark:text-stone-400 leading-6">
          逐条请求原链接判断可达性：HTTP 200-399 与「需登录 / 防爬」（401/403/405/429）视为可达；
          其余 4xx/5xx 记为失效，网络不通记为异常。结果标在书签上（列表与详情可见），失效项可在收藏夹按「失效」筛出后批量清理。
        </p>
      </Card>

      <Card title="重复链接">
        {dups === null ? <Spinner /> : dups.length === 0 ? (
          <Empty text="没有重复链接" />
        ) : (
          <div className="space-y-3">
            {dups.map(g => (
              <div key={g.normalized_url}
                className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] p-3.5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-mono text-stone-500 dark:text-stone-400 truncate flex-1">{g.normalized_url}</span>
                  <button type="button" onClick={() => dedupGroup(g)} disabled={dupBusy}
                    className="px-2.5 h-7 rounded-lg text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50">
                    去重（保留最早）</button>
                </div>
                <div className="space-y-1.5">
                  {g.items.map((it, idx) => (
                    <div key={it.id} className="flex items-center gap-2 text-xs">
                      <span className={'w-12 shrink-0 ' + (idx === 0 ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-stone-400')}>
                        {idx === 0 ? '保留' : '多余'}</span>
                      <span className="truncate">{it.title}</span>
                      <span className="text-stone-400 dark:text-stone-500 shrink-0">{it.created_at?.slice(0, 10)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
