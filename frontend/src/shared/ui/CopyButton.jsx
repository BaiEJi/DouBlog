import { useState, useEffect, useRef } from 'react'

export default function CopyButton({ value, copier, label = '复制', done = '已复制', ariaLabel }) {
  const [ok, setOk] = useState(false)
  const t = useRef(0)
  useEffect(() => () => clearTimeout(t.current), [])
  const onClick = async () => {
    if (!value) return
    const r = await copier(value)
    if (r) {
      setOk(true)
      clearTimeout(t.current)
      t.current = setTimeout(() => setOk(false), 1500)
    }
  }
  return (
    <button type="button" aria-label={ariaLabel} disabled={!value}
      onClick={onClick}
      title={label}
      className={'shrink-0 px-1.5 h-6 rounded-md text-[11px] font-medium transition-colors ' + (ok
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/10')}
    >
      {ok ? done : label}
    </button>
  )
}
