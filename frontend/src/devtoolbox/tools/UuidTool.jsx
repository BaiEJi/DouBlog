/** UUID / 短 ID 生成：v4（随机）/ v7（时间有序）批量 + NanoID 自定义字母表 */
import { useState } from 'react'
import { ToolHead, CopyBtn, Segmented, Check, LBL, btnPri, inputCls, selectCls, card } from '../kit'
import { uuidV4, uuidV7, nanoId } from '../lib/misc'

export default function UuidTool() {
  const [kind, setKind] = useState('v4')
  const [upper, setUpper] = useState(false)
  const [noDash, setNoDash] = useState(false)
  const [count, setCount] = useState(5)
  const [nanoSize, setNanoSize] = useState(21)
  const [list, setList] = useState([])

  const generate = () => {
    const fmt = s => {
      let out = s
      if (noDash) out = out.replace(/-/g, '')
      if (upper) out = out.toUpperCase()
      return out
    }
    if (kind === 'nano') setList(Array.from({ length: count }, () => nanoId(nanoSize)))
    else if (kind === 'v7') setList(Array.from({ length: count }, () => fmt(uuidV7())))
    else setList(Array.from({ length: count }, () => fmt(uuidV4())))
  }

  return (
    <div>
      <ToolHead title="UUID / 短 ID" desc="v4 随机 / v7 时间有序（可排序，适合主键与日志）/ NanoID 短 ID"
        right={<>
          <Segmented value={kind} onChange={k => { setKind(k); setList([]) }} options={[
            { key: 'v4', label: 'UUID v4' },
            { key: 'v7', label: 'UUID v7' },
            { key: 'nano', label: 'NanoID' },
          ]} />
          <button className={btnPri} onClick={generate}>生成</button>
        </>} />
      <div className={'flex flex-wrap items-center gap-x-5 gap-y-3 p-4 ' + card}>
        <label className="flex items-center gap-2 text-[13px] text-stone-600 dark:text-stone-300">
          数量
          <select className={selectCls} value={count} onChange={e => setCount(+e.target.value)} aria-label="数量">
            {[1, 5, 10, 20, 50].map(n => <option key={n} value={n}>{n} 个</option>)}
          </select>
        </label>
        {kind === 'nano' ? (
          <label className="flex items-center gap-2 text-[13px] text-stone-600 dark:text-stone-300">
            长度 <input type="number" min={6} max={64} className={inputCls + ' w-20'} value={nanoSize}
              onChange={e => setNanoSize(Math.max(6, Math.min(64, +e.target.value || 21)))} />
          </label>
        ) : (
          <>
            <Check checked={upper} onChange={setUpper} label="大写" />
            <Check checked={noDash} onChange={setNoDash} label="去掉连字符" />
          </>
        )}
        {kind === 'v7' && <span className={LBL}>前 48 bit 为毫秒时间戳——按生成时间自然有序</span>}
        {kind === 'nano' && <span className={LBL}>62 字符字母表，21 位 ≈ 124 bit 熵</span>}
      </div>
      <div className={'mt-4 divide-y divide-black/[0.05] dark:divide-white/[0.06] ' + card}>
        {list.map((id, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-6 text-right text-[11.5px] tabular-nums text-stone-400">{i + 1}</span>
            <code className="flex-1 min-w-0 font-mono text-[13px] text-stone-800 dark:text-stone-100 break-all">{id}</code>
            <CopyBtn text={id} />
          </div>
        ))}
        {!list.length && <p className="px-4 py-3 text-[13px] text-stone-400">点击「生成」。</p>}
      </div>
      {list.length > 1 && <CopyBtn text={list.join('\n')} label="复制全部" cls={btnPri + ' mt-3'} />}
    </div>
  )
}
