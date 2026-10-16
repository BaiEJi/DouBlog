/** 哈希计算：MD5/SHA-1/SHA-2/SHA-3/BLAKE + HMAC（经后端 hashlib——WebCrypto 缺 MD5/SHA-3/BLAKE） */
import { useState } from 'react'
import { ToolHead, CopyBtn, StatusLine, LBL, inputCls, areaCls, btnPri, card } from '../kit'
import { dtHash } from '../api'

const ALGORITHMS = ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'sha3_256', 'sha3_512', 'blake2b', 'blake2s']
const HMAC_ALGORITHMS = ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512']

export default function HashTool() {
  const [text, setText] = useState('hello world')
  const [key, setKey] = useState('')
  const [results, setResults] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const compute = async () => {
    if (!text) { setResults([]); setError(null); return }
    setBusy(true)
    try {
      const algos = key ? ALGORITHMS.filter(a => HMAC_ALGORITHMS.includes(a)) : ALGORITHMS
      const outs = await Promise.all(algos.map(a => dtHash(text, a, key)))
      setResults(outs)
      setError(null)
    } catch (e) {
      setResults([])
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <ToolHead title="哈希计算" desc="一次输入，全部算法结果同时给出（MD5/SHA-1/SHA-2/SHA-3/BLAKE；填密钥则切换为 HMAC 模式）"
        right={<>
          <input className={inputCls + ' w-44'} value={key} onChange={e => { setKey(e.target.value); setResults([]) }}
            placeholder="HMAC 密钥（留空=普通哈希）" aria-label="HMAC 密钥" />
          <button className={btnPri} disabled={busy || !text} onClick={compute}>{busy ? '计算中…' : '计算全部'}</button>
        </>} />
      <textarea className={areaCls} rows={6} value={text} spellCheck={false}
        onChange={e => { setText(e.target.value); setResults([]) }} placeholder="输入文本（UTF-8，≤1MB）" aria-label="哈希输入" />
      <div className="mt-2"><StatusLine ok={!error && !!results.length} err={error} okText="计算完成" /></div>
      <div className={'mt-3 divide-y divide-black/[0.05] dark:divide-white/[0.06] ' + card}>
        {results.map(r => (
          <div key={r.algorithm} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-24 shrink-0 font-mono text-[12.5px] font-medium">{r.algorithm}</span>
            {r.hmac && <span className="px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-lime-500/10 text-lime-700 dark:text-lime-400 shrink-0">HMAC</span>}
            <code className="flex-1 min-w-0 font-mono text-[12.5px] text-stone-600 dark:text-stone-300 break-all">{r.hex}</code>
            <CopyBtn text={r.hex} />
          </div>
        ))}
        {!results.length && <p className="px-4 py-3 text-[13px] text-stone-400">点击「计算全部」查看全部算法摘要。</p>}
      </div>
      <p className={'mt-1 ' + LBL}>数据经本机后端 hashlib 计算，不落盘；MD5/SHA-1 仅用于校验场景，勿用于安全存储。</p>
    </div>
  )
}
