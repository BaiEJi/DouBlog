/**
 * 密码生成器：Password（8-128，字符集/排除易混淆）+ Passphrase + 熵 + 复制/重生成。
 * 可独立使用（复制），也可 onUse 直接填充编辑器字段。
 */
import { useState, useMemo, useEffect } from 'react'
import { generatePassword, generatePassphrase, passwordEntropy, passphraseEntropy, strengthLabel } from './core'
import { CopyButton, I } from './ui'

const DEFAULT_PW_OPTS = { length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true, includeAmbiguous: false }
const DEFAULT_PP_OPTS = { words: 4, separator: '-', capitalize: true, includeNumber: true }

function Toggle({ checked, onChange, label }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100 transition-colors">
      <span className={'w-8 h-[18px] rounded-full relative transition-colors ' + (checked ? 'bg-stone-900 dark:bg-stone-100' : 'bg-black/15 dark:bg-white/15')}>
        <span className={'absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white dark:bg-stone-900 transition-all ' + (checked ? 'left-[16px]' : 'left-[2px]')} />
      </span>
      {label}
    </button>
  )
}

export default function Generator({ copier, onUse, onClose }) {
  const [tab, setTab] = useState('password')
  const [pwOpts, setPwOpts] = useState(DEFAULT_PW_OPTS)
  const [ppOpts, setPpOpts] = useState(DEFAULT_PP_OPTS)
  const [pw, setPw] = useState(() => generatePassword(DEFAULT_PW_OPTS))
  const [pp, setPp] = useState(() => generatePassphrase(DEFAULT_PP_OPTS))

  const regen = () => tab === 'password' ? setPw(generatePassword(pwOpts)) : setPp(generatePassphrase(ppOpts))
  useEffect(() => { if (tab === 'password') setPw(generatePassword(pwOpts)) }, [pwOpts, tab]) // eslint-disable-line
  useEffect(() => { if (tab === 'passphrase') setPp(generatePassphrase(ppOpts)) }, [ppOpts, tab]) // eslint-disable-line

  const value = tab === 'password' ? pw : pp
  const entropy = useMemo(() => tab === 'password'
    ? passwordEntropy(pw)
    : passphraseEntropy(pp, ppOpts.words), [tab, pw, pp, ppOpts.words])
  const strength = strengthLabel(entropy)

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 dark:bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.08] rounded-2xl shadow-2xl p-5">
        <div className="flex items-center gap-1 mb-4">
          <div className="flex p-0.5 rounded-lg bg-black/[0.05] dark:bg-white/[0.06]">
            {[['password', '随机密码'], ['passphrase', '口令短语']].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={'px-3 h-7 rounded-md text-[12px] font-medium transition-colors ' + (tab === k
                  ? 'bg-white dark:bg-stone-800 shadow-sm text-stone-900 dark:text-stone-100'
                  : 'text-stone-500')}>{l}</button>
            ))}
          </div>
          <button onClick={onClose} className="ml-auto w-7 h-7 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">✕</button>
        </div>

        {/* 输出 */}
        <div className="p-3 rounded-xl bg-stone-50 dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.06]">
          <div className="font-mono text-[15px] leading-relaxed break-all text-stone-800 dark:text-stone-100 min-h-[3rem]">{value}</div>
          <div className="flex items-center gap-2 mt-2.5">
            <div className="h-1 flex-1 rounded-full bg-black/[0.06] dark:bg-white/[0.08] overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, entropy)}%`, background: strength.color }} />
            </div>
            <span className="text-[11px] font-medium" style={{ color: strength.color }}>{strength.label}</span>
            <span className="text-[11px] text-stone-400 tabular-nums">{entropy} 位熵</span>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button onClick={regen}
            className="px-3 h-9 rounded-lg text-sm text-stone-600 dark:text-stone-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors inline-flex items-center gap-1.5">
            {I.refresh} 重新生成
          </button>
          <div className="ml-auto flex items-center gap-2">
            {onUse && (
              <button onClick={() => onUse(value)}
                className="px-3 h-9 rounded-lg text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 transition-colors">使用此密码</button>
            )}
            <div className="px-3 h-9 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm font-medium flex items-center">
              <CopyButton value={value} copier={copier} label="复制" done="已复制 ✓" />
            </div>
          </div>
        </div>

        {/* 选项 */}
        <div className="mt-4 pt-4 border-t border-black/[0.06] dark:border-white/[0.06]">
          {tab === 'password' ? (
            <>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm text-stone-500 w-16">长度</span>
                <input type="range" min="8" max="128" value={pwOpts.length}
                  onChange={e => setPwOpts(o => ({ ...o, length: +e.target.value }))}
                  className="flex-1 accent-stone-700 dark:accent-stone-200" />
                <span className="text-sm font-mono w-8 text-right tabular-nums">{pwOpts.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-y-2.5">
                <Toggle checked={pwOpts.uppercase} onChange={v => setPwOpts(o => ({ ...o, uppercase: v }))} label="大写 A-Z" />
                <Toggle checked={pwOpts.lowercase} onChange={v => setPwOpts(o => ({ ...o, lowercase: v }))} label="小写 a-z" />
                <Toggle checked={pwOpts.numbers} onChange={v => setPwOpts(o => ({ ...o, numbers: v }))} label="数字 0-9" />
                <Toggle checked={pwOpts.symbols} onChange={v => setPwOpts(o => ({ ...o, symbols: v }))} label="符号 !@#" />
                <Toggle checked={pwOpts.includeAmbiguous} onChange={v => setPwOpts(o => ({ ...o, includeAmbiguous: v }))} label="包含易混淆字符 (I l O 0 1)" />
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm text-stone-500 w-16">词数</span>
                <input type="range" min="3" max="10" value={ppOpts.words}
                  onChange={e => setPpOpts(o => ({ ...o, words: +e.target.value }))}
                  className="flex-1 accent-stone-700 dark:accent-stone-200" />
                <span className="text-sm font-mono w-8 text-right tabular-nums">{ppOpts.words}</span>
              </div>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm text-stone-500 w-16">分隔符</span>
                {['-', '.', ' ', '_'].map(s => (
                  <button key={s} onClick={() => setPpOpts(o => ({ ...o, separator: s }))}
                    className={'w-8 h-7 rounded-md text-sm font-mono transition-colors ' + (ppOpts.separator === s
                      ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
                      : 'text-stone-500 hover:bg-black/5 dark:hover:bg-white/5 border border-black/10 dark:border-white/10')}>
                    {s === ' ' ? '␣' : s}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-y-2.5">
                <Toggle checked={ppOpts.capitalize} onChange={v => setPpOpts(o => ({ ...o, capitalize: v }))} label="首字母大写" />
                <Toggle checked={ppOpts.includeNumber} onChange={v => setPpOpts(o => ({ ...o, includeNumber: v }))} label="附随机数字" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
