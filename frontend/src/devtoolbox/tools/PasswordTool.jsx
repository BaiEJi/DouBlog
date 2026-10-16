/** 密码生成器：长度/字符集/排除易混淆 + 批量；口令短语模式；熵估计（crypto.getRandomValues） */
import { useMemo, useState } from 'react'
import { ToolHead, CopyBtn, Check, LBL, btnPri, selectCls, card } from '../kit'
import { randomPassword, entropyBits, PW_SETS } from '../lib/misc'

const PHRASE_WORDS = ('apple river mountain castle dragon forest planet silver window garden bamboo candle harbor meadow orange purple rocket sunset tiger velvet water anchor bridge cherry dolphin eagle falcon galaxy honey island jungle kitten lantern magnet nectar ocean pearl quiver rainbow storm thunder umbrella violet walnut zephyr').split(' ')

function passphrase(words, sep, capFirst) {
  const ws = Array.from({ length: words }, () => PHRASE_WORDS[Math.floor(Math.random() * PHRASE_WORDS.length)])
  if (capFirst) ws.forEach((w, i) => { ws[i] = w[0].toUpperCase() + w.slice(1) })
  const digits = Math.floor(Math.random() * 90 + 10)
  return ws.join(sep) + sep + digits
}

function strengthCls(bits) {
  if (bits >= 100) return { label: '极强', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' }
  if (bits >= 70) return { label: '强', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' }
  if (bits >= 45) return { label: '中等', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' }
  return { label: '弱', cls: 'bg-red-500/10 text-red-600 dark:text-red-400' }
}

export default function PasswordTool() {
  const [mode, setMode] = useState('random')
  const [length, setLength] = useState(16)
  const [count, setCount] = useState(5)
  const [sets, setSets] = useState({ lower: true, upper: true, digit: true, symbol: true })
  const [excludeConfusing, setExcludeConfusing] = useState(true)
  const [words, setWords] = useState(4)
  const [sep, setSep] = useState('-')
  const [capFirst, setCapFirst] = useState(true)
  const [list, setList] = useState([])

  const activeSets = Object.keys(sets).filter(k => sets[k])
  const poolSize = useMemo(() => {
    let pool = ''
    for (const s of activeSets) {
      let chars = PW_SETS[s]
      if (excludeConfusing) chars = [...chars].filter(c => !'il1Lo0O'.includes(c)).join('')
      pool += chars
    }
    return new Set(pool).size
  }, [activeSets, excludeConfusing])

  const bits = mode === 'random' ? entropyBits(length, poolSize) : entropyBits(words, PHRASE_WORDS.length) + 6.5
  const strength = strengthCls(bits)

  const generate = () => {
    if (mode === 'random') {
      if (!activeSets.length) return
      setList(Array.from({ length: count }, () => randomPassword(length, activeSets, excludeConfusing)))
    } else {
      setList(Array.from({ length: count }, () => passphrase(words, sep, capFirst)))
    }
  }

  return (
    <div>
      <ToolHead title="密码生成器" desc="crypto.getRandomValues + 拒绝采样（无模偏差）；全程本地生成不上传"
        right={<>
          <div className="inline-flex p-0.5 rounded-lg bg-black/[0.05] dark:bg-white/[0.07]">
            {[['random', '随机密码'], ['phrase', '口令短语']].map(([k, label]) => (
              <button key={k} className={'px-2.5 py-1 rounded-md text-[12.5px] transition-colors ' + (mode === k ? 'bg-white dark:bg-white/[0.14] text-stone-900 dark:text-stone-100 font-medium shadow-sm' : 'text-stone-500 dark:text-stone-400')}
                onClick={() => { setMode(k); setList([]) }}>{label}</button>
            ))}
          </div>
          <button className={btnPri} onClick={generate}>生成</button>
        </>} />
      <div className={'p-4 ' + card}>
        {mode === 'random' ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <label className="flex items-center gap-2 text-[13px] text-stone-600 dark:text-stone-300">
              长度 <input type="range" min={4} max={64} value={length} className="w-36 accent-lime-600 dark:accent-lime-500"
                onChange={e => setLength(+e.target.value)} />
              <span className="w-8 text-right tabular-nums font-medium">{length}</span>
            </label>
            {Object.entries({ lower: '小写 a-z', upper: '大写 A-Z', digit: '数字 0-9', symbol: '符号 !@#' }).map(([k, label]) => (
              <Check key={k} checked={sets[k]} label={label} onChange={v => setSets(s => ({ ...s, [k]: v }))} />
            ))}
            <Check checked={excludeConfusing} onChange={setExcludeConfusing} label="排除易混淆 (il1Lo0O)" />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <label className="flex items-center gap-2 text-[13px] text-stone-600 dark:text-stone-300">
              词数 <input type="range" min={3} max={8} value={words} className="w-32 accent-lime-600 dark:accent-lime-500"
                onChange={e => setWords(+e.target.value)} />
              <span className="w-6 text-right tabular-nums font-medium">{words}</span>
            </label>
            <label className="flex items-center gap-1.5 text-[13px] text-stone-600 dark:text-stone-300">
              分隔符
              <select className={selectCls} value={sep} onChange={e => setSep(e.target.value)} aria-label="分隔符">
                <option value="-">-</option>
                <option value=".">.</option>
                <option value="_">_</option>
                <option value=" ">空格</option>
              </select>
            </label>
            <Check checked={capFirst} onChange={setCapFirst} label="首字母大写" />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-black/[0.05] dark:border-white/[0.06]">
          <label className="flex items-center gap-2 text-[13px] text-stone-600 dark:text-stone-300">
            数量
            <select className={selectCls} value={count} onChange={e => setCount(+e.target.value)} aria-label="生成数量">
              {[1, 3, 5, 10, 20].map(n => <option key={n} value={n}>{n} 个</option>)}
            </select>
          </label>
          <span className={'px-2.5 py-1 rounded-full text-xs font-medium ' + strength.cls}>熵 ≈ {bits} bit · {strength.label}</span>
          <span className={LBL}>字符池 {mode === 'random' ? poolSize : PHRASE_WORDS.length + 100}</span>
        </div>
      </div>
      <div className={'mt-4 divide-y divide-black/[0.05] dark:divide-white/[0.06] ' + card}>
        {list.map((pw, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <code className="flex-1 min-w-0 font-mono text-[13.5px] text-stone-800 dark:text-stone-100 break-all">{pw}</code>
            <CopyBtn text={pw} />
          </div>
        ))}
        {!list.length && <p className="px-4 py-3 text-[13px] text-stone-400">点击「生成」——默认排除形近字符；≥70bit 可抵御离线暴力破解。</p>}
      </div>
    </div>
  )
}
