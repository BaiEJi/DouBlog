/**
 * 运行日志弹窗（源版逻辑照搬）：每 2s 轮询账号日志并自动滚到底。
 * 弹窗改用 Doublog kit Modal；日志面板为终端风深底（明暗两态一致可读）。
 */
import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { Modal } from '../../todo/kit'

export default function LogPanel({ account, onClose }) {
  const [lines, setLines] = useState([])
  const boxRef = useRef(null)

  useEffect(() => {
    let alive = true
    const fetchLog = async () => {
      try {
        const resp = await api.accountLog(account.steamid)
        if (alive) {
          setLines(resp.lines || [])
          if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
        }
      } catch { /* ignore */ }
    }
    fetchLog()
    const t = setInterval(fetchLog, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [account.steamid])

  return (
    <Modal open title={`运行日志 — ${account.account_name}`} onClose={onClose} width="max-w-2xl">
      <div
        ref={boxRef}
        className="max-h-[52vh] overflow-y-auto rounded-lg border border-black/[0.06] dark:border-white/[0.06] bg-stone-950 px-3.5 py-3 font-mono text-xs leading-relaxed text-stone-300 whitespace-pre-wrap break-all">
        {lines.length ? lines.join('\n') : '暂无日志'}
      </div>
    </Modal>
  )
}
