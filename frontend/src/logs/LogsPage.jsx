/**
 * 日志查询页 /logs：lizysdk send_json 接收端（sdklogs 模块）的检索界面。
 * （v2：过滤动作以 filtersRef 快照直接执行，规避 setState 未 flush 的旧闭包）
 *
 * 能力（对齐 Datadog/Better Stack 主路径，见 docs/logs-benchmark.md）：
 * - P0：时间直方图（级别分色，点击柱/拖拽框选缩放）、相对时间 chips、Live Tail（3s 轮询）、
 *       日志上下文（前后 N 条）、一键字段过滤（展开表格 ⊕/⊖）
 * - P1：搜索词高亮、级别统计 chips、保存的搜索、URL 同步查询状态、导出 CSV/JSON、多行堆栈折叠
 * - P2：模式分组（本地模板过滤）、键盘导航（j/k/Enter//）、无限滚动、日志告警、trace 时间线
 * 过滤全部下推后端；直方图/模式/导出与列表共用同一组查询参数。
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { BackButton } from '../shared/PageHeader'
import {
  sdklogSearch, sdklogSysnames, sdklogHistogram, sdklogContext, sdklogPatterns,
  sdklogTrace, sdklogExport, sdklogAlerts, sdklogAlertConfig, sdklogAlertCheck, sdklogAlertAck,
} from './api'

const LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']
const LEVEL_STYLE = {
  DEBUG: 'text-stone-400 border-stone-300 dark:border-stone-600',
  INFO: 'text-sky-600 dark:text-sky-400 border-sky-400/40',
  WARNING: 'text-amber-600 dark:text-amber-400 border-amber-400/50',
  ERROR: 'text-red-500 border-red-400/50',
  CRITICAL: 'text-red-100 bg-red-800 dark:bg-red-900 border-red-800 dark:border-red-900',
}
const LEVEL_FILL = { DEBUG: '#a8a29e', INFO: '#38bdf8', WARNING: '#fbbf24', ERROR: '#ef4444', CRITICAL: '#991b1b' }
// 小字场景（级别分布文字/tooltip）：CRITICAL 用亮红保证深底对比度
const LEVEL_TEXT_FILL = { ...LEVEL_FILL, CRITICAL: '#f87171' }
const RANGES = [
  { key: '15m', label: '15 分钟', ms: 15 * 60000 },
  { key: '1h', label: '1 小时', ms: 3600000 },
  { key: '6h', label: '6 小时', ms: 6 * 3600000 },
  { key: '24h', label: '24 小时', ms: 24 * 3600000 },
  { key: '7d', label: '7 天', ms: 7 * 86400000 },
]
const PAGE = 100
const SAVED_KEY = 'doublog.log.saved'

const inputCls = 'h-9 px-3 text-sm bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/10 rounded-lg text-stone-800 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:border-black/30 dark:focus:border-white/30 transition-colors'

// 后端存 naive UTC → 本地展示
function fmtLocal(utcIso) {
  if (!utcIso) return ''
  const d = new Date(utcIso.endsWith('Z') ? utcIso : utcIso + 'Z')
  if (isNaN(d)) return utcIso
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
function fmtHm(utcIso) {
  if (!utcIso) return ''
  const d = new Date(utcIso.endsWith('Z') ? utcIso : utcIso + 'Z')
  if (isNaN(d)) return utcIso
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// datetime-local 形如 'YYYY-MM-DDTHH:mm'（本地）→ 后端可解析的 UTC ISO（带 Z）
function localInputToUtc(v) {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d)) return ''
  return d.toISOString().slice(0, 19) + 'Z'
}
// Date → datetime-local（本地）
const toLocalInput = d => {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const localInputFromUtcIso = iso => {
  if (!iso) return ''
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  return isNaN(d) ? '' : toLocalInput(d)
}

/** 搜索词高亮：大小写不敏感分段 */
function Highlight({ text, term }) {
  if (!term || !text) return <>{text}</>
  const t = String(text)
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = t.split(new RegExp(`(${esc})`, 'gi'))
  return <>{parts.map((p, i) => p.toLowerCase() === term.toLowerCase()
    ? <mark key={i} className="bg-amber-300/60 dark:bg-amber-400/30 text-inherit rounded-[2px] px-px">{p}</mark>
    : <span key={i}>{p}</span>)}</>
}

// 点击外部关闭弹层
function useClickOutside(ref, onClose) {
  useEffect(() => {
    if (!ref.current) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', esc) }
  }, [ref, onClose])
}

/** 自绘下拉（原生 select 在深色主题下样式失控） */
function Dropdown({ value, onChange, options, placeholder, width = 'w-36' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useClickOutside(ref, () => setOpen(false))
  const current = options.find(o => o.v === value)

  return (
    <div className={'relative ' + width} ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={inputCls + ' w-full flex items-center justify-between gap-1 text-left'}>
        <span className={'truncate ' + (current ? '' : 'text-stone-400')}>{current?.l ?? placeholder}</span>
        <svg className={'w-3 h-3 shrink-0 text-stone-400 transition-transform ' + (open ? 'rotate-180' : '')} viewBox="0 0 12 12" fill="none">
          <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[8.5rem] py-1 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1c1b1a] shadow-lg animate-dropdown">
          {options.map(o => (
            <button key={o.v} type="button"
              onClick={() => { onChange(o.v); setOpen(false) }}
              className={'w-full text-left px-3 h-8 flex items-center text-[12.5px] transition-colors ' +
                (o.v === value
                  ? 'bg-stone-100 dark:bg-white/[0.07] text-stone-900 dark:text-stone-100 font-medium'
                  : 'text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/[0.04]')}>
              {o.l}
              {o.v === value && <span className="ml-auto text-blue-500">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const p2 = n => String(n).padStart(2, '0')

/** 自绘时间选择器：日历 + 时分微调 + 快捷项（替代原生 datetime-local） */
function DateTimeInput({ value, onChange, placeholder }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useClickOutside(ref, () => setOpen(false))
  const init = value ? new Date(value) : new Date()
  const [view, setView] = useState({ y: init.getFullYear(), m: init.getMonth() })   // 日历视窗月份
  const [hh, setHh] = useState(value ? init.getHours() : 0)
  const [mm, setMm] = useState(value ? init.getMinutes() : 0)

  const openPicker = () => {
    const base = value ? new Date(value) : new Date()
    setView({ y: base.getFullYear(), m: base.getMonth() })
    setHh(base.getHours()); setMm(base.getMinutes())
    setOpen(o => !o)
  }

  const apply = (day) => {
    if (!day) return
    onChange(`${day.getFullYear()}-${p2(day.getMonth() + 1)}-${p2(day.getDate())}T${p2(hh)}:${p2(mm)}`)
    setOpen(false)
  }

  const now = new Date()
  const selected = value ? new Date(value) : null
  const first = new Date(view.y, view.m, 1)
  const lead = (first.getDay() + 6) % 7                      // 周一开头
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(view.y, view.m, i + 1))]
  while (cells.length % 7 !== 0) cells.push(null)
  const hourInput = (val, set, max) => (
    <div className="flex items-center gap-0.5">
      <button type="button" onClick={() => set((val + max) % (max + 1))}
        className="w-5 h-5 rounded text-[11px] text-stone-400 hover:bg-black/5 dark:hover:bg-white/10">▲</button>
      <span className="w-7 text-center text-[13px] font-mono tabular-nums">{p2(val)}</span>
      <button type="button" onClick={() => set((val + 1) % (max + 1))}
        className="w-5 h-5 rounded text-[11px] text-stone-400 hover:bg-black/5 dark:hover:bg-white/10">▼</button>
    </div>
  )

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={openPicker}
        className={inputCls + ' w-full flex items-center gap-1.5 text-left tabular-nums'}>
        <svg className="w-3.5 h-3.5 shrink-0 text-stone-400" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span className={'truncate ' + (value ? '' : 'text-stone-400')}>
          {value ? `${value.slice(0, 10)} ${value.slice(11, 16)}` : placeholder}
        </span>
        {value && (
          <span role="button" onClick={e => { e.stopPropagation(); onChange(''); setOpen(false) }}
            className="ml-auto w-4 h-4 shrink-0 rounded-full bg-stone-200 dark:bg-white/10 text-stone-500 text-[10px] leading-4 text-center hover:bg-stone-300 dark:hover:bg-white/20">✕</span>
        )}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 p-2.5 w-64 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#1c1b1a] shadow-lg animate-dropdown">
          {/* 月份导航 */}
          <div className="flex items-center mb-1.5">
            <button type="button" onClick={() => setView(v => ({ y: v.m === 0 ? v.y - 1 : v.y, m: (v.m + 11) % 12 }))}
              className="w-6 h-6 rounded text-stone-400 hover:bg-black/5 dark:hover:bg-white/10">‹</button>
            <span className="flex-1 text-center text-[12.5px] font-medium">{view.y} 年 {view.m + 1} 月</span>
            <button type="button" onClick={() => setView(v => ({ y: v.m === 11 ? v.y + 1 : v.y, m: (v.m + 1) % 12 }))}
              className="w-6 h-6 rounded text-stone-400 hover:bg-black/5 dark:hover:bg-white/10">›</button>
          </div>
          {/* 日历 */}
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS.map(w => <span key={w} className="text-center text-[10.5px] text-stone-400 py-0.5">{w}</span>)}
            {cells.map((d, i) => d ? (
              <button key={i} type="button" onClick={() => apply(d)}
                className={'h-6 rounded text-[11.5px] tabular-nums transition-colors ' +
                  (selected && d.toDateString() === selected.toDateString()
                    ? 'bg-stone-800 dark:bg-stone-100 text-white dark:text-stone-900 font-medium'
                    : d.toDateString() === now.toDateString()
                      ? 'text-blue-500 hover:bg-stone-100 dark:hover:bg-white/10'
                      : 'text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-white/10')}>
                {d.getDate()}
              </button>
            ) : <span key={i} />)}
          </div>
          {/* 时间 + 快捷项 */}
          <div className="flex items-center gap-3 pt-2 mt-1 border-t border-black/[0.06] dark:border-white/[0.06]">
            {hourInput(hh, setHh, 23)}<span className="text-stone-400 text-[12px]">时</span>
            {hourInput(mm, setMm, 59)}<span className="text-stone-400 text-[12px]">分</span>
            <button type="button"
              onClick={() => { const n = new Date(); setHh(n.getHours()); setMm(n.getMinutes()); apply(n) }}
              className="ml-auto px-2 h-6 rounded-md text-[11.5px] text-stone-500 hover:bg-black/5 dark:hover:bg-white/10">此刻</button>
            <button type="button" onClick={() => { onChange(''); setOpen(false) }}
              className="px-2 h-6 rounded-md text-[11.5px] text-stone-400 hover:bg-black/5 dark:hover:bg-white/10">清除</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** 时间直方图：级别分色堆叠柱；点击柱缩放到该桶，横向拖拽框选时间范围 */
function Histogram({ data, onZoom }) {
  const wrapRef = useRef(null)
  const [w, setW] = useState(0)
  const [hover, setHover] = useState(null)        // {i, x}
  const [drag, setDrag] = useState(null)          // {x0, x1}
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    // 页面隐藏（如后台标签）时 ResizeObserver 回调不派发，getBoundingClientRect + resize 事件兜底
    const measure = () => setW(Math.round(el.getBoundingClientRect().width))
    measure()
    window.addEventListener('resize', measure)
    let ro
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure)
      ro.observe(el)
    }
    return () => { window.removeEventListener('resize', measure); ro?.disconnect() }
  }, [])
  const H = 92
  const buckets = data?.buckets ?? []
  const n = buckets.length
  const max = Math.max(1, ...buckets.map(b => b.total))
  const bw = n ? (w - 8) / n : 0

  const bucketAt = x => Math.max(0, Math.min(n - 1, Math.floor((x - 4) / bw)))
  const bucketIso = i => {
    const b = buckets[i]
    const s = new Date(b.start.endsWith('Z') ? b.start : b.start + 'Z')
    return { start: s, end: new Date(s.getTime() + (data.bucket_secs || 60) * 1000) }
  }
  const ready = n > 0 && w >= 40

  return (
    <div ref={wrapRef} className="relative select-none min-h-[92px]"
      onMouseLeave={() => setHover(null)}
      onMouseMove={e => {
        if (!ready) return
        const rc = e.currentTarget.getBoundingClientRect()
        const x = e.clientX - rc.left
        if (drag) setDrag(d => ({ ...d, x1: x }))
        else if (x >= 4 && x <= 4 + n * bw) setHover({ i: bucketAt(x), x })
        else setHover(null)
      }}
      onMouseDown={e => {
        if (!ready) return
        const rc = e.currentTarget.getBoundingClientRect()
        setDrag({ x0: e.clientX - rc.left, x1: e.clientX - rc.left })
      }}
      onMouseUp={() => {
        if (drag && ready) {
          const i0 = bucketAt(Math.min(drag.x0, drag.x1))
          const i1 = bucketAt(Math.max(drag.x0, drag.x1))
          const moved = Math.abs(drag.x1 - drag.x0) > 6
          if (moved) {
            const a = bucketIso(i0), b = bucketIso(i1)
            onZoom(toLocalInput(a.start), toLocalInput(b.end))
          } else {
            const a = bucketIso(i0), b = bucketIso(i0)
            onZoom(toLocalInput(a.start), toLocalInput(b.end))   // 单击：缩放到该桶
          }
        }
        setDrag(null)
      }}>
      {ready && (
        <svg width={w} height={H + 16}>
          {buckets.map((b, i) => {
            let y = H
            const x = 4 + i * bw
            return (
              <g key={i}>
                {LEVELS.map(lv => {
                  const c = b.counts[lv]
                  if (!c) return null
                  const h = (c / max) * (H - 4)
                  y -= h
                  return <rect key={lv} x={x} y={y} width={Math.max(1, bw - 1)} height={h}
                    fill={LEVEL_FILL[lv]} opacity={0.85} rx={bw > 4 ? 1.5 : 0} />
                })}
                {b.total === 0 && <rect x={x} y={H - 1} width={Math.max(1, bw - 1)} height={1}
                  className="fill-black/10 dark:fill-white/10" />}
              </g>
            )
          })}
          <text x={4} y={H + 12} fontSize="9" className="fill-stone-400">{fmtHm(buckets[0].start)}</text>
          <text x={w - 4} y={H + 12} textAnchor="end" fontSize="9" className="fill-stone-400">{fmtHm(buckets[n - 1].start)}</text>
        </svg>
      )}
      {/* 拖拽框选高亮 */}
      {drag && Math.abs(drag.x1 - drag.x0) > 2 && (
        <div className="absolute top-0 bottom-4 bg-blue-500/15 border-x border-blue-500/50 pointer-events-none"
          style={{ left: Math.min(drag.x0, drag.x1), width: Math.abs(drag.x1 - drag.x0) }} />
      )}
      {/* 悬浮提示 */}
      {hover && !drag && ready && (
        <div className="absolute -top-1 z-10 pointer-events-none px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/15 bg-white dark:bg-[#1c1b1a] shadow-lg text-[10.5px] leading-relaxed"
          style={{ left: Math.min(Math.max(hover.x - 70, 0), w - 150) }}>
          <div className="font-medium tabular-nums">{fmtHm(buckets[hover.i].start)} · 共 {buckets[hover.i].total} 条</div>
          {LEVELS.map(lv => buckets[hover.i].counts[lv] > 0 && (
            <div key={lv} className="flex items-center gap-1.5 text-stone-500 dark:text-stone-400">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: LEVEL_FILL[lv] }} />{lv} {buckets[hover.i].counts[lv]}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 通用模态外壳 */
function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] flex items-start justify-center p-6 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={'w-full ' + (wide ? 'max-w-[980px]' : 'max-w-[720px]') + ' mt-10 rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#161514] shadow-2xl'}
        onKeyDown={e => e.key === 'Escape' && onClose()}>
        <div className="flex items-center gap-3 px-5 h-12 border-b border-black/[0.06] dark:border-white/[0.07]">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="ml-auto w-7 h-7 rounded-lg text-stone-400 hover:bg-black/5 dark:hover:bg-white/10">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

/** 紧凑行（上下文/trace 模态内用） */
function MiniRow({ log, anchor, term, onClick }) {
  return (
    <div onClick={onClick} role="button"
      className={'flex items-center gap-2.5 px-3 py-[5px] cursor-pointer border-t border-black/[0.06] dark:border-white/[0.06] transition-colors ' +
        (anchor ? 'bg-amber-500/10' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]')}>
      <span className="text-[11px] text-stone-400 tabular-nums shrink-0 w-[104px]">{fmtLocal(log.ts)}</span>
      <span className={'shrink-0 w-[70px] text-center px-1 py-px rounded border text-[9.5px] font-semibold ' + (LEVEL_STYLE[log.level_text] || '')}>{log.level_text}</span>
      <span className="shrink-0 text-[10.5px] text-stone-400 w-[70px] truncate">{log.sys_name}</span>
      <span className="flex-1 min-w-0 text-[12px] truncate"><Highlight text={log.message} term={term} /></span>
    </div>
  )
}

/** 上下文模态：锚点前后 N 条 */
function ContextModal({ log, onClose, onOpenTrace }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    sdklogContext(log.id, 15, 15).then(d => d.success && setData(d.data))
  }, [log.id])
  return (
    <Modal title={`上下文 · ${fmtLocal(log.ts)} 前后各 15 条`} onClose={onClose} wide>
      {!data ? <p className="text-[12.5px] text-stone-400 py-8 text-center">加载中…</p> : (
        <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] overflow-hidden">
          {data.items.map(l => (
            <MiniRow key={l.id} log={l} anchor={l.anchor}
              onClick={() => l.trace_id && onOpenTrace(l.trace_id)} />
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-stone-400">琥珀高亮行为锚点；行内点击可跳转 trace（若存在）。</p>
    </Modal>
  )
}

/** trace 时间线模态：同 trace_id 日志按时间升序 + 相对偏移点阵 */
function TraceModal({ traceId, onClose }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    sdklogTrace(traceId).then(d => d.success && setData(d.data))
  }, [traceId])
  const items = data?.items ?? []
  const span = data?.span
  const spanMs = span?.span_ms ?? 1
  const startMs = span ? new Date(span.start + 'Z').getTime() : 0
  return (
    <Modal title={`trace ${traceId}${span ? ` · 跨度 ${spanMs >= 1000 ? (spanMs / 1000).toFixed(1) + 's' : spanMs + 'ms'}` : ''}`} onClose={onClose} wide>
      {!data ? <p className="text-[12.5px] text-stone-400 py-8 text-center">加载中…</p> : items.length === 0 ? (
        <p className="text-[12.5px] text-stone-400 py-8 text-center">该 trace 没有日志</p>
      ) : (
        <>
          {/* 时间线点阵 */}
          <div className="relative h-8 mb-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.05] dark:border-white/[0.06]">
            {items.map(l => {
              const off = new Date(l.ts + 'Z').getTime() - startMs
              return <span key={l.id} title={`${fmtLocal(l.ts)} · ${l.level_text}`}
                className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ring-2 ring-white dark:ring-[#161514]"
                style={{ left: `calc(${Math.min(100, off / spanMs * 100)}% - 4px)`, background: LEVEL_FILL[l.level_text] || '#a8a29e' }} />
            })}
            <span className="absolute left-1.5 top-0.5 text-[9px] text-stone-400">0</span>
            <span className="absolute right-1.5 top-0.5 text-[9px] text-stone-400">+{spanMs >= 1000 ? (spanMs / 1000).toFixed(1) + 's' : spanMs + 'ms'}</span>
          </div>
          <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] overflow-hidden">
            {items.map(l => (
              <div key={l.id} className="flex items-center gap-2.5 px-3 py-[5px] border-t border-black/[0.06] dark:border-white/[0.06] first:border-t-0">
                <span className="text-[11px] text-amber-600 dark:text-amber-400 tabular-nums shrink-0 w-[52px] text-right">
                  +{new Date(l.ts + 'Z').getTime() - startMs}ms
                </span>
                <span className={'shrink-0 w-[70px] text-center px-1 py-px rounded border text-[9.5px] font-semibold ' + (LEVEL_STYLE[l.level_text] || '')}>{l.level_text}</span>
                <span className="shrink-0 text-[10.5px] text-stone-400 w-[70px] truncate">{l.sys_name}</span>
                <span className="flex-1 min-w-0 text-[12px] truncate" title={l.message}>{l.message}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

/** 告警模态：阈值规则配置 + 最近事件 + 确认 */
function AlertModal({ onClose }) {
  const [state, setState] = useState(null)
  const [cfg, setCfg] = useState(null)
  const [msg, setMsg] = useState('')
  const reload = useCallback(() => {
    sdklogAlerts().then(d => { if (d.success) { setState(d.data); setCfg(d.data.config) } })
  }, [])
  useEffect(() => { reload() }, [reload])

  const save = async () => {
    const d = await sdklogAlertConfig(cfg)
    setMsg(d.success ? '已保存 ✓' : `保存失败：${d.message}`)
    if (d.success) reload()
  }
  const checkNow = async () => {
    const d = await sdklogAlertCheck()
    setMsg(d.success ? (d.data.triggered ? '已触发新告警 ⚠' : `检查完成：窗口内 ${d.data.count} 条（未达阈值）`) : '检查失败')
    reload()
  }
  const ack = async payload => { await sdklogAlertAck(payload); reload() }

  const num = (k, label, min, max) => (
    <label className="flex items-center gap-2 text-[12px]">
      <span className="text-stone-500 w-[92px] shrink-0">{label}</span>
      <input type="number" min={min} max={max} value={cfg[k]}
        onChange={e => setCfg(c => ({ ...c, [k]: e.target.value }))}
        className={inputCls + ' w-24'} />
    </label>
  )

  return (
    <Modal title="日志告警" onClose={onClose} wide>
      {!cfg ? <p className="text-[12.5px] text-stone-400 py-6 text-center">加载中…</p> : (
        <>
          <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] p-4 mb-4">
            <div className="text-[12.5px] font-medium mb-3">阈值规则</div>
            <div className="grid sm:grid-cols-2 gap-2.5">
              <label className="flex items-center gap-2 text-[12px]">
                <span className="text-stone-500 w-[92px] shrink-0">启用</span>
                <button type="button" onClick={() => setCfg(c => ({ ...c, enabled: !c.enabled }))}
                  className={'w-10 h-[22px] rounded-full relative transition-colors ' + (cfg.enabled ? 'bg-amber-500' : 'bg-stone-300 dark:bg-white/15')}>
                  <span className={'absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-all ' + (cfg.enabled ? 'left-[22px]' : 'left-[3px]')} />
                </button>
                <span className="text-[11px] text-stone-400">{cfg.enabled ? '每 60s 巡检' : '已停用'}</span>
              </label>
              <label className="flex items-center gap-2 text-[12px]">
                <span className="text-stone-500 w-[92px] shrink-0">级别 ≥</span>
                <select value={cfg.level_gte} onChange={e => setCfg(c => ({ ...c, level_gte: e.target.value }))}
                  className={inputCls + ' w-28 bg-white dark:bg-[#1c1b1a]'}>
                  {['WARNING', 'ERROR', 'CRITICAL'].map(l => <option key={l}>{l}</option>)}
                </select>
              </label>
              {num('threshold', '阈值（条数）', 1, 100000)}
              {num('window_minutes', '窗口（分钟）', 1, 1440)}
              {num('cooldown_minutes', '冷却（分钟）', 1, 1440)}
              <label className="flex items-center gap-2 text-[12px]">
                <span className="text-stone-500 w-[92px] shrink-0">限定系统</span>
                <input value={cfg.sys_name} placeholder="空=全部"
                  onChange={e => setCfg(c => ({ ...c, sys_name: e.target.value }))}
                  className={inputCls + ' w-36'} />
              </label>
              <label className="flex items-center gap-2 text-[12px] sm:col-span-2">
                <span className="text-stone-500 w-[92px] shrink-0">Webhook</span>
                <input value={cfg.webhook_url} placeholder="https://…（可选，POST JSON 通知）"
                  onChange={e => setCfg(c => ({ ...c, webhook_url: e.target.value }))}
                  className={inputCls + ' flex-1'} />
              </label>
            </div>
            <div className="flex items-center gap-2 mt-3.5">
              <button onClick={save} className="px-4 h-8 rounded-lg bg-stone-800 dark:bg-stone-100 text-white dark:text-stone-900 text-[12.5px] font-medium hover:opacity-90">保存规则</button>
              <button onClick={checkNow} className="px-3 h-8 rounded-lg text-[12px] text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14]">立即检查</button>
              {msg && <span className="text-[11.5px] text-stone-500">{msg}</span>}
            </div>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <div className="text-[12.5px] font-medium">最近事件</div>
            {state.unacked > 0 && (
              <button onClick={() => ack({ all: true })} className="px-2 h-6 rounded-md text-[11px] text-amber-600 dark:text-amber-400 border border-amber-500/40 hover:bg-amber-500/10">全部确认（{state.unacked}）</button>
            )}
          </div>
          {state.events.length === 0 ? (
            <p className="text-[12px] text-stone-400 py-6 text-center border border-dashed border-black/10 dark:border-white/10 rounded-xl">还没有触发过告警</p>
          ) : (
            <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] overflow-hidden">
              {state.events.map(e => (
                <div key={e.id} className={'flex items-center gap-3 px-3.5 py-2 border-t border-black/[0.06] dark:border-white/[0.06] first:border-t-0 ' + (e.acked ? 'opacity-60' : '')}>
                  <span className="text-[11px] text-stone-400 tabular-nums shrink-0 w-[110px]">{fmtLocal(e.created_at)}</span>
                  <span className={'shrink-0 px-1.5 py-px rounded border text-[9.5px] font-semibold ' + (LEVEL_STYLE[e.level_text] || '')}>{e.level_text}</span>
                  <span className="shrink-0 text-[11px] text-stone-500">{e.sys_name}</span>
                  <span className="shrink-0 text-[11px] text-red-500 font-medium tabular-nums">{e.count} 条/{e.window_minutes}分</span>
                  <span className="flex-1 min-w-0 text-[11.5px] truncate" title={e.sample}>{e.sample}</span>
                  {e.notified && <span className="shrink-0 text-[10px] text-stone-400" title="webhook 已通知">已通知</span>}
                  {!e.acked && (
                    <button onClick={() => ack({ id: e.id })} className="shrink-0 px-2 h-6 rounded-md text-[11px] text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14]">确认</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

/** 单行日志：紧凑一行 + 高亮 + 堆栈折叠 + 展开（字段一键过滤/上下文/trace/复制） */
function LogRow({ log, term, selected, newFlash, expanded, onToggle, onKvFilter, onSysFilter, onLevelFilter, onTraceFilter, onContext, onOpenTrace }) {
  const [copied, setCopied] = useState(false)
  const [stackOpen, setStackOpen] = useState(false)
  const copyJson = async (e) => {
    e.stopPropagation()
    try { await navigator.clipboard.writeText(JSON.stringify(log)); setCopied(true); setTimeout(() => setCopied(false), 1200) } catch { /* 剪贴板不可用忽略 */ }
  }
  const multiline = log.message.includes('\n')
  const firstLine = multiline ? log.message.split('\n')[0] : log.message
  const stackLines = multiline ? log.message.split('\n').length - 1 : 0

  const rows = [
    ['时间', `${fmtLocal(log.ts)}（UTC ${log.ts}）`],
    ['级别', `${log.level_text}（${log.level}）`],
    ['sys_name', log.sys_name],
    ['文件', log.file ? `${log.file}:${log.line ?? '?'}` : '—'],
    ['trace_id', log.trace_id || '—'],
    ['消息', log.message],
    ['接收时间', `${fmtLocal(log.received_at)}（UTC ${log.received_at}）`],
    ...Object.entries(log.fields || {}).map(([k, v]) => [k, String(v)]),
  ]
  // 一键过滤目标：核心字段映射到对应控件，业务 kv 走 kv 过滤
  const filterTarget = k => ({
    'sys_name': { kind: 'sys' }, '级别': { kind: 'level' }, 'trace_id': { kind: 'trace' },
  }[k] || { kind: 'kv', key: k })

  const FBtn = ({ value, target }) => (
    <span className="flex gap-0.5 shrink-0">
      <button title="按此值过滤" onClick={e => { e.stopPropagation(); applyFilter(target, value, true) }}
        className="w-5 h-5 rounded text-[11px] text-stone-400 hover:text-blue-500 hover:bg-blue-500/10">⊕</button>
      <button title="排除此值" onClick={e => { e.stopPropagation(); applyFilter(target, value, false) }}
        className="w-5 h-5 rounded text-[11px] text-stone-400 hover:text-red-500 hover:bg-red-500/10">⊖</button>
    </span>
  )
  const applyFilter = (target, value, include) => {
    if (target.kind === 'sys') { onSysFilter(value, include) }
    else if (target.kind === 'level') { onLevelFilter(value, include) }
    else if (target.kind === 'trace') { onTraceFilter(value, include) }
    else { onKvFilter(target.key, value, include) }
  }

  return (
    <div className={'border-t border-black/[0.06] dark:border-white/[0.06] transition-colors ' +
      (expanded ? 'bg-stone-50 dark:bg-white/[0.02] ' : 'hover:bg-black/[0.015] dark:hover:bg-white/[0.02] ') +
      (selected ? 'ring-1 ring-inset ring-blue-500/40 ' : '') +
      (newFlash ? 'animate-newlog bg-amber-500/[0.12]' : '')}>
      <div onClick={onToggle} role="button" className="flex items-center gap-2.5 px-3 py-[5px] cursor-pointer select-none">
        <span className="text-[11.5px] text-stone-400 tabular-nums shrink-0 w-[104px]">{fmtLocal(log.ts)}</span>
        <span className={'shrink-0 w-[74px] text-center px-1 py-px rounded border text-[10px] font-semibold ' + (LEVEL_STYLE[log.level_text] || '')}>{log.level_text}</span>
        <span className="shrink-0 w-[90px] text-[11px] text-stone-400 font-mono truncate" title={log.file ? `${log.file}:${log.line ?? '?'}` : log.sys_name}>{log.file ? `${log.file}:${log.line ?? '?'}` : log.sys_name}</span>
        <span role="button" onClick={e => { if (log.trace_id) { e.stopPropagation(); onOpenTrace(log.trace_id) } }}
          title={log.trace_id ? '查看 trace 时间线' : ''} className="shrink-0 w-[100px] text-[11px] font-mono truncate text-sky-600 dark:text-sky-400 hover:underline">{log.trace_id || ''}</span>
        <span className="flex-1 min-w-0 text-[12.5px] truncate" title={log.message}>
          <Highlight text={firstLine} term={term} />
          {multiline && <span onClick={e => { e.stopPropagation(); setStackOpen(s => !s) }}
            className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400 border border-amber-500/30 rounded px-1 py-px hover:bg-amber-500/10" title="展开/收起堆栈">
            堆栈 {stackLines} 行
          </span>}
        </span>
        <svg className={'w-3 h-3 shrink-0 text-stone-300 dark:text-stone-600 transition-transform ' + (expanded ? 'rotate-90' : '')} viewBox="0 0 12 12" fill="none">
          <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {/* 多行堆栈原样展示 */}
      {multiline && stackOpen && (
        <pre className="mx-3 mb-2 p-3 rounded-lg bg-black/[0.03] dark:bg-black/40 text-[11px] font-mono leading-relaxed text-stone-600 dark:text-stone-300 whitespace-pre-wrap break-all border border-black/[0.05] dark:border-white/[0.06]">{log.message}</pre>
      )}
      {expanded && (
        <div className="px-3 pb-3">
          <div className="flex flex-wrap justify-end gap-1.5 mb-1.5">
            <button onClick={e => { e.stopPropagation(); onContext(log) }} className="px-2 h-6 rounded-md text-[11.5px] text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">⇅ 上下文</button>
            {log.trace_id && <button onClick={e => { e.stopPropagation(); onOpenTrace(log.trace_id) }} className="px-2 h-6 rounded-md text-[11.5px] text-sky-600 dark:text-sky-400 border border-sky-500/30 hover:bg-sky-500/10 transition-colors">⇗ trace</button>}
            <button onClick={copyJson} className="px-2 h-6 rounded-md text-[11.5px] text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">{copied ? '已复制 ✓' : '复制 JSON'}</button>
          </div>
          <div className="rounded-lg border border-black/[0.06] dark:border-white/[0.06] overflow-hidden">
            {rows.map(([k, v], i) => (
              <div key={k + i} className={'grid grid-cols-[130px_1fr_auto] items-center ' + (i > 0 ? 'border-t border-black/[0.06] dark:border-white/[0.06] ' : '') +
                (k === '消息' ? 'py-1.5' : 'py-[3px]')}>
                <span className="px-3 text-[11.5px] text-stone-400 font-mono">{k}</span>
                <span className="px-3 py-px text-[12px] text-stone-700 dark:text-stone-200 break-all">{k === '消息' ? <Highlight text={v} term={term} /> : v}</span>
                <span className="pr-2.5 flex items-center">{v && v !== '—' && <FBtn value={k === '级别' ? log.level_text : v} target={filterTarget(k)} />}</span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[10.5px] text-stone-400">⊕ 过滤此值 · ⊖ 排除此值</p>
        </div>
      )}
    </div>
  )
}

export default function LogsPage() {
  // ── 过滤状态 ──
  const [sysName, setSysName] = useState('')
  const [sysNames, setSysNames] = useState([])
  const [levelGte, setLevelGte] = useState('')          // 下拉：某级别及以上
  const [exactLevels, setExactLevels] = useState([])    // chips：精确级别（多选）
  const [traceId, setTraceId] = useState('')
  const [q, setQ] = useState('')
  const [start, setStart] = useState(toLocalInput(new Date(Date.now() - 3600000)))   // 默认最近 1h
  const [end, setEnd] = useState(toLocalInput(new Date()))
  const [rangeKey, setRangeKey] = useState('1h')
  const [kv, setKv] = useState([])                      // [{key, value}] 多条 kv 过滤
  const [kvKey, setKvKey] = useState('')
  const [kvVal, setKvVal] = useState('')

  // ── 数据 ──
  const [items, setItems] = useState(null)              // null=首屏加载中
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hist, setHist] = useState(null)
  const [patterns, setPatterns] = useState(null)        // 模式分组数据
  const [showPatterns, setShowPatterns] = useState(false)
  const [patternSel, setPatternSel] = useState(null)    // 选中的模式模板（本地过滤）

  // ── 交互 ──
  const [liveTail, setLiveTail] = useState(false)
  const [newIds, setNewIds] = useState(new Set())
  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || [] } catch { return [] }
  })
  const [savedOpen, setSavedOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [selIdx, setSelIdx] = useState(-1)              // 键盘导航选中行
  const [contextLog, setContextLog] = useState(null)
  const [traceFor, setTraceFor] = useState(null)
  const [alertOpen, setAlertOpen] = useState(false)
  const [unacked, setUnacked] = useState(0)
  const qInputRef = useRef(null)
  const sentinelRef = useRef(null)

  // 过滤状态镜像（每次渲染刷新）：供 runQuery/buildParams 在任意回调里读最新值，
  // 避免 setTimeout(()=>runQuery()) 捕获 setState 前的旧闭包导致过滤慢一拍
  const filtersRef = useRef({})
  filtersRef.current = { sysName, levelGte, exactLevels, traceId, q, start, end, kv, rangeKey }
  const showPatternsRef = useRef(false)
  showPatternsRef.current = showPatterns

  // 当前生效的过滤参数（列表/直方图/模式/导出共用）；读 filtersRef 保证拿到最新过滤
  const buildParams = useCallback((extra = {}) => {
    const f = filtersRef.current
    const p = { ...extra }
    if (f.sysName.trim()) p.sys_name = f.sysName.trim()
    if (f.levelGte) p.level_gte = f.levelGte
    if (f.exactLevels.length) p.level = f.exactLevels.join(',')
    if (f.traceId.trim()) p.trace_id = f.traceId.trim()
    if (f.q.trim()) p.q = f.q.trim()
    if (f.start) p.start = localInputToUtc(f.start)
    if (f.end) p.end = localInputToUtc(f.end)
    for (const { key, value } of f.kv) if (key.trim() && value.trim()) p[key.trim()] = value.trim()
    return p
  }, [])

  // URL 同步（?f= b64 JSON）：进入还原、查询后更新
  const snapshotFilters = useCallback(() => ({ ...filtersRef.current }), [])
  const applySnapshot = snap => {
    setSysName(snap.sysName || ''); setLevelGte(snap.levelGte || ''); setExactLevels(snap.exactLevels || [])
    setTraceId(snap.traceId || ''); setQ(snap.q || '')
    setStart(snap.start ?? ''); setEnd(snap.end ?? ''); setRangeKey(snap.rangeKey || 'custom')
    setKv(Array.isArray(snap.kv) ? snap.kv : [])
    return snap
  }
  const searchRef = useRef({})                          // 最近一次实际执行的参数（供 liveTick 复用）
  /** 从快照直接构造查询参数（URL 恢复/保存的查询应用时 state 尚未 flush）；extra 附加分页/桶数 */
  const paramsFromSnap = (snap, extra = {}) => {
    const p = { ...extra }
    if (snap.sysName?.trim()) p.sys_name = snap.sysName.trim()
    if (snap.levelGte) p.level_gte = snap.levelGte
    if (snap.exactLevels?.length) p.level = snap.exactLevels.join(',')
    if (snap.traceId?.trim()) p.trace_id = snap.traceId.trim()
    if (snap.q?.trim()) p.q = snap.q.trim()
    if (snap.start) p.start = localInputToUtc(snap.start)
    if (snap.end) p.end = localInputToUtc(snap.end)
    for (const { key, value } of snap.kv || []) if (key?.trim() && value?.trim()) p[key.trim()] = value.trim()
    return p
  }
  const runQuery = useCallback(async (snap) => {
    const useSnap = snap || snapshotFilters()
    const params = snap ? paramsFromSnap(snap, { limit: PAGE, offset: 0 }) : buildParams({ limit: PAGE, offset: 0 })
    searchRef.current = { params, snap: useSnap }
    setLoading(true); setPatternSel(null)
    const [d, h] = await Promise.all([
      sdklogSearch(params).catch(() => null),
      sdklogHistogram(snap ? paramsFromSnap(snap, { buckets: 60 }) : buildParams({ buckets: 60 })).catch(() => null),
    ])
    if (d?.success) { setItems(d.data.items); setTotal(d.data.total) }
    if (h?.success) setHist(h.data)
    setLoading(false)
    if (showPatternsRef.current) {
      sdklogPatterns(buildParams()).then(p => p?.success && setPatterns(p.data))
    }
    // URL 同步
    try {
      const usp = new URLSearchParams()
      usp.set('f', btoa(unescape(encodeURIComponent(JSON.stringify(useSnap)))))
      window.history.replaceState(null, '', `${location.pathname}?${usp}`)
    } catch { /* 忽略编码失败 */ }
  }, [buildParams, snapshotFilters])

  // 首次进入：URL 还原 or 默认最近 1h
  useEffect(() => {
    loadSysNames()
    sdklogAlerts().then(d => d.success && setUnacked(d.data.unacked)).catch(() => {})
    let snap = null
    const f = new URLSearchParams(location.search).get('f')
    if (f) {
      try { snap = applySnapshot(JSON.parse(decodeURIComponent(escape(atob(f))))) } catch { /* 坏参数走默认 */ }
    }
    runQuery(snap || snapshotFilters())
    /* eslint-disable react-hooks/exhaustive-deps */
  }, [])
  const loadSysNames = useCallback(async () => {
    const d = await sdklogSysnames().catch(() => null)
    if (d?.success) setSysNames(d.data)
  }, [])

  // Live Tail：3s 轮询第一页 + 增量高亮；相对窗口随时间滑动
  useEffect(() => {
    if (!liveTail) { setNewIds(new Set()); return }
    const timer = setInterval(async () => {
      // 相对窗口滑动：先更新 state（下个 tick buildParams 取到新窗口），
      // 并同步刷新 filtersRef，使本 tick 就用新窗口查询
      const snap = searchRef.current.snap
      if (snap && snap.rangeKey && snap.rangeKey !== 'custom') {
        const r = RANGES.find(x => x.key === snap.rangeKey)
        if (r) {
          const ns = toLocalInput(new Date(Date.now() - r.ms))
          const ne = toLocalInput(new Date())
          setStart(ns); setEnd(ne)
          filtersRef.current = { ...filtersRef.current, start: ns, end: ne }
        }
      }
      const params = buildParams({ limit: PAGE, offset: 0 })   // 每 tick 现算（窗口/过滤都是最新）
      const [d, h] = await Promise.all([
        sdklogSearch(params).catch(() => null),
        sdklogHistogram(buildParams({ buckets: 60 })).catch(() => null),
      ])
      if (d?.success) {
        setItems(prev => {
          if (!prev) return d.data.items
          const prevIds = new Set(prev.map(x => x.id))
          const fresh = d.data.items.filter(x => !prevIds.has(x.id))
          if (fresh.length) setNewIds(s => new Set([...s, ...fresh.map(x => x.id)]))
          return [...d.data.items, ...prev.filter(x => !d.data.items.some(y => y.id === x.id))].slice(0, Math.max(prev.length, 500))
        })
        setTotal(d.data.total)
      }
      if (h?.success) setHist(h.data)
    }, 3000)
    return () => clearInterval(timer)
  }, [liveTail, buildParams])

  // 无限滚动：滚动到哨兵附近 → 追加下一页（scroll 事件 + getBoundingClientRect，
  // 不用 IntersectionObserver——隐藏标签页不派发回调）；哨兵区另有"加载更多"按钮兜底。
  const busyRef = useRef(false)
  const loadMore = useCallback(() => {
    if (busyRef.current || loading) return
    const prev = items
    if (!prev || prev.length >= total || liveTail) return
    busyRef.current = true
    ;(async () => {
      setLoading(true)
      const offset = prev.length
      const params = { ...(searchRef.current.params || { limit: PAGE, offset: 0 }), offset }
      const d = await sdklogSearch(params).catch(() => null)
      if (d?.success) {
        setItems(cur => {
          const ids = new Set(cur.map(x => x.id))
          return [...cur, ...d.data.items.filter(x => !ids.has(x.id))]
        })
      }
      setLoading(false)
      busyRef.current = false
    })()
  }, [loading, items, total, liveTail])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || liveTail) return
    const onScroll = () => {
      if (el.getBoundingClientRect().top <= window.innerHeight + 200) loadMore()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [loadMore, liveTail])

  // 键盘导航：j/k 选行、Enter 展开、/ 聚焦搜索
  useEffect(() => {
    const onKey = e => {
      const tag = (e.target.tagName || '').toLowerCase()
      const inInput = tag === 'input' || tag === 'textarea' || tag === 'select'
      if (e.key === '/' && !inInput) { e.preventDefault(); qInputRef.current?.focus(); return }
      if (inInput || contextLog || traceFor) return
      if (!items || !items.length) return
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        setSelIdx(i => {
          const next = e.key === 'j' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)
          document.querySelectorAll('[data-logrow]')[next]?.scrollIntoView({ block: 'nearest' })
          return next
        })
      } else if (e.key === 'Enter' && selIdx >= 0) {
        setExpandedId(cur => cur === items[selIdx].id ? null : items[selIdx].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, selIdx, contextLog, traceFor])

  // 相对时间 chips
  const applyRange = key => {
    const r = RANGES.find(x => x.key === key)
    if (!r) return
    setRangeKey(key)
    setStart(toLocalInput(new Date(Date.now() - r.ms)))
    setEnd(toLocalInput(new Date()))
  }

  // 一键过滤动作：先 setState 再以 filtersRef+补丁立即执行（setTimeout 方案会踩 React 未 flush 的旧闭包）
  const addKvFilter = (key, value, include) => {
    const f = filtersRef.current
    const nextKv = include
      ? [...f.kv.filter(x => !(x.key === key && x.value === value)), { key, value }]
      : f.kv.filter(x => x.key !== key)   // ⊖ 排除：清掉该 key 的过滤
    setKv(nextKv)
    runQuery({ ...f, kv: nextKv })
  }
  const setSysFilter = (value, include) => {
    const f = filtersRef.current
    setSysName(include ? value : '')
    runQuery({ ...f, sysName: include ? value : '' })
  }
  const setLevelFilterChip = (value, include) => {
    const f = filtersRef.current
    const nextLevels = include
      ? (f.exactLevels.includes(value) ? f.exactLevels : [...f.exactLevels, value])
      : f.exactLevels.filter(l => l !== value)
    setExactLevels(nextLevels)
    setLevelGte('')
    runQuery({ ...f, exactLevels: nextLevels, levelGte: '' })
  }
  const setTraceFilter = (value, include) => {
    const f = filtersRef.current
    setTraceId(include ? value : '')
    runQuery({ ...f, traceId: include ? value : '' })
  }

  // 保存的搜索
  const [saveName, setSaveName] = useState('')
  const persistSaved = list => { setSaved(list); try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)) } catch { } }
  const saveCurrent = () => {
    const name = saveName.trim()
    if (!name) return
    persistSaved([...saved.filter(s => s.name !== name), { name, snap: snapshotFilters() }])
    setSaveName('')
  }
  const applySaved = s => { const snap = applySnapshot(s.snap); setSavedOpen(false); runQuery(snap) }

  // 导出
  const doExport = async format => {
    setExportOpen(false)
    try {
      const blob = await sdklogExport(buildParams(), format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const p = n => String(n).padStart(2, '0')
      const d = new Date()
      a.href = url
      a.download = `logs-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch { alert('导出失败') }
  }

  // 模式分组本地过滤：模板 → 正则
  const patternRegex = useMemo(() => {
    if (!patternSel) return null
    const esc = patternSel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp('^' + esc
      .replace(/<uuid>/g, '[0-9a-fA-F-]{36}')
      .replace(/<ip>/g, '(?:\\d{1,3}\\.){3}\\d{1,3}(?::\\d+)?')
      .replace(/<path>/g, '[\\w\\-./\\\\]+\\.[A-Za-z0-9]{1,5}')
      .replace(/<hex>/g, '[0-9a-fA-F]{16,}')
      .replace(/<str>/g, '"[^"\\n]{1,120}"')
      .replace(/<num>/g, '\\d+(?:\\.\\d+)?') + '$')
  }, [patternSel])
  const displayItems = useMemo(() => {
    if (!patternRegex || !items) return items
    return items.filter(l => patternRegex.test(l.message))
  }, [items, patternRegex])

  const levelTotals = hist?.totals ?? {}

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-[#100f0e] text-stone-800 dark:text-stone-100 transition-colors">
      <header className="sticky top-0 z-20 bg-stone-50/95 dark:bg-[#141312] backdrop-blur border-b border-black/[0.06] dark:border-white/[0.06]">
        <div className="mx-auto w-full max-w-[1700px] px-4 sm:px-6 xl:px-10 h-12 flex items-center gap-4">
          <BackButton />
          <h1 className="text-lg font-semibold tracking-tight">日志查询</h1>
          {/* Live Tail */}
          <button onClick={() => setLiveTail(v => !v)} title="实时追尾：每 3 秒自动拉取新日志"
            className={'flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[12px] border transition-colors ' +
              (liveTail
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-600 dark:text-amber-400'
                : 'text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] border-transparent')}>
            <span className={'w-2 h-2 rounded-full ' + (liveTail ? 'bg-amber-500 animate-pulse' : 'bg-stone-400')} />
            {liveTail ? '实时中' : '实时'}
          </button>
          {/* 保存的搜索 */}
          <div className="relative">
            <button onClick={() => setSavedOpen(o => !o)} className="px-2.5 h-7 rounded-lg text-[12px] text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">★ 查询集</button>
            {savedOpen && (
              <div className="absolute z-30 left-0 mt-1 w-56 py-1 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1c1b1a] shadow-lg">
                {saved.length === 0 && <p className="px-3 py-2 text-[11.5px] text-stone-400">还没有保存的查询</p>}
                {saved.map(s => (
                  <div key={s.name} className="flex items-center px-3 h-8 text-[12.5px] text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/[0.04]">
                    <button className="flex-1 text-left truncate" onClick={() => applySaved(s)}>{s.name}</button>
                    <button title="删除" onClick={() => persistSaved(saved.filter(x => x.name !== s.name))}
                      className="w-6 h-6 rounded text-stone-400 hover:text-red-500 hover:bg-red-500/10">✕</button>
                  </div>
                ))}
                <div className="flex items-center gap-1.5 px-3 py-2 border-t border-black/[0.05] dark:border-white/[0.06]">
                  <input value={saveName} onChange={e => setSaveName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveCurrent() } }}
                    placeholder="当前查询命名…" className={inputCls + ' flex-1 h-7 text-[11.5px]'} />
                  <button onClick={saveCurrent} className="px-2 h-7 rounded-md text-[11.5px] text-blue-500 hover:bg-blue-500/10">保存</button>
                </div>
              </div>
            )}
          </div>
          {/* 导出 */}
          <div className="relative">
            <button onClick={() => setExportOpen(o => !o)} className="px-2.5 h-7 rounded-lg text-[12px] text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">⬇ 导出</button>
            {exportOpen && (
              <div className="absolute z-30 left-0 mt-1 w-32 py-1 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1c1b1a] shadow-lg">
                <button onClick={() => doExport('csv')} className="w-full text-left px-3 h-8 text-[12.5px] text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/[0.04]">CSV</button>
                <button onClick={() => doExport('json')} className="w-full text-left px-3 h-8 text-[12.5px] text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/[0.04]">JSON</button>
              </div>
            )}
          </div>
          {/* 告警 */}
          <button onClick={() => setAlertOpen(true)}
            className={'relative px-2.5 h-7 rounded-lg text-[12px] border transition-colors ' +
              (unacked > 0
                ? 'bg-red-500/10 border-red-500/50 text-red-500'
                : 'text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] border-transparent')}>
            🔔 告警{unacked > 0 && <span className="ml-1 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4">{unacked}</span>}
          </button>
          <button onClick={() => { loadSysNames(); runQuery() }} className="ml-auto px-2.5 h-7 rounded-lg text-[12px] text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] transition-colors">{loading ? '…' : '刷新'}</button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1700px] px-4 sm:px-6 xl:px-10 py-4">
        {/* 未确认告警横幅 */}
        {unacked > 0 && !alertOpen && (
          <button onClick={() => setAlertOpen(true)} className="w-full mb-3 px-4 h-9 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 text-[12.5px] flex items-center gap-2 hover:bg-red-500/15 transition-colors">
            ⚠ 日志告警：{unacked} 条未确认 —— 点击查看
          </button>
        )}

        {/* 查询工具条 */}
        <form onSubmit={e => { e.preventDefault(); setRangeKey('custom'); runQuery({ ...filtersRef.current, rangeKey: 'custom' }) }}
          className="flex flex-wrap items-stretch gap-1.5 mb-2.5">
          {/* 相对时间 chips */}
          <div className="flex items-center gap-1 w-full sm:w-auto">
            {RANGES.map(r => (
              <button key={r.key} type="button" onClick={() => {
                const rr = RANGES.find(x => x.key === r.key)
                if (!rr) return
                const ns = toLocalInput(new Date(Date.now() - rr.ms)), ne = toLocalInput(new Date())
                setRangeKey(r.key); setStart(ns); setEnd(ne)
                runQuery({ ...filtersRef.current, rangeKey: r.key, start: ns, end: ne })
              }}
                className={'h-8 px-2.5 rounded-lg text-[12px] border transition-colors ' +
                  (rangeKey === r.key
                    ? 'bg-stone-800 dark:bg-stone-100 text-white dark:text-stone-900 border-transparent font-medium'
                    : 'text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] border-transparent')}>
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-[8.5rem]">
            <Dropdown value={sysName} onChange={v => { setSysName(v); runQuery({ ...filtersRef.current, sysName: v }) }} placeholder="全部系统" width="w-full"
              options={[{ v: '', l: '全部系统' },
                ...sysNames.map(n => ({ v: n.sys_name, l: `${n.sys_name} · ${n.count}` }))]} />
          </div>
          <div className="flex-1 min-w-[7.5rem]">
            <Dropdown value={levelGte} onChange={v => { setLevelGte(v); setExactLevels([]); runQuery({ ...filtersRef.current, levelGte: v, exactLevels: [] }) }} placeholder="全部级别" width="w-full"
              options={[{ v: '', l: '全部级别' }, ...LEVELS.map(l => ({ v: l, l: `${l} 及以上` }))]} />
          </div>
          <input ref={qInputRef} className={inputCls + ' flex-[2] min-w-[12rem]'} placeholder="消息包含…（按 / 聚焦）" value={q}
            onChange={e => setQ(e.target.value)} />
          <div className="flex-1 min-w-[12.5rem]"><DateTimeInput value={start} onChange={v => { setStart(v); setRangeKey('custom') }} placeholder="开始时间" /></div>
          <div className="flex-1 min-w-[12.5rem]"><DateTimeInput value={end} onChange={v => { setEnd(v); setRangeKey('custom') }} placeholder="结束时间" /></div>
          <input className={inputCls + ' flex-1 min-w-[8rem]'} placeholder="trace_id" value={traceId} onChange={e => setTraceId(e.target.value)} />
          <div className="flex-1 min-w-[7rem]"><input className={inputCls + ' w-full'} placeholder="字段名" value={kvKey} onChange={e => setKvKey(e.target.value)} /></div>
          <div className="flex-1 min-w-[7.5rem]"><input className={inputCls + ' w-full'} placeholder="字段值" value={kvVal} onChange={e => setKvVal(e.target.value)} /></div>
          <button type="submit" className="h-9 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors">查询</button>
        </form>

        {/* kv 过滤 chips */}
        {kv.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
            {kv.map((k, i) => (
              <span key={k.key + k.value + i} className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 text-[11.5px]">
                <b className="font-mono font-medium">{k.key}</b>={k.value}
                <button onClick={() => { const nextKv = filtersRef.current.kv.filter((_, j) => j !== i); setKv(nextKv); runQuery({ ...filtersRef.current, kv: nextKv }) }}
                  className="w-4 h-4 rounded-full hover:bg-blue-500/20 text-[10px]">✕</button>
              </span>
            ))}
          </div>
        )}
        {exactLevels.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
            <span className="text-[11px] text-stone-400">精确级别：</span>
            {exactLevels.map(l => (
              <span key={l} className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-stone-200/70 dark:bg-white/10 text-[11.5px]">
                {l}
                <button onClick={() => { const nextLs = filtersRef.current.exactLevels.filter(x => x !== l); setExactLevels(nextLs); runQuery({ ...filtersRef.current, exactLevels: nextLs }) }}
                  className="w-4 h-4 rounded-full hover:bg-black/10 dark:hover:bg-white/20 text-[10px]">✕</button>
              </span>
            ))}
          </div>
        )}

        {/* 直方图 + 级别统计 chips */}
        <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-white dark:bg-[#141312] px-3 pt-2.5 pb-1.5 mb-3">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className="text-[11px] text-stone-400">点击柱缩放 · 拖拽框选时间</span>
            <span className="flex-1" />
            {LEVELS.map(lv => (levelTotals[lv] ?? 0) > 0 && (
              <button key={lv} onClick={() => setLevelFilterChip(lv, !exactLevels.includes(lv))}
                className={'inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] border transition-colors ' +
                  (exactLevels.includes(lv)
                    ? 'bg-stone-800 dark:bg-white/15 text-white dark:text-stone-100 border-transparent font-medium'
                    : 'bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] border-transparent text-stone-600 dark:text-stone-300')}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: LEVEL_FILL[lv] }} />
                {lv} <b className="tabular-nums font-medium">{levelTotals[lv]}</b>
              </button>
            ))}
          </div>
          {hist ? <Histogram data={hist} onZoom={(s, e) => { setStart(s); setEnd(e); setRangeKey('custom'); runQuery({ ...filtersRef.current, rangeKey: 'custom', start: s, end: e }) }} />
            : <div className="h-[92px] animate-pulse rounded bg-black/[0.03] dark:bg-white/[0.04]" />}
        </div>

        {/* 模式分组 */}
        <div className="flex items-center gap-2 mb-2.5">
          <button onClick={() => {
            const next = !showPatterns
            setShowPatterns(next)
            if (next) sdklogPatterns(buildParams()).then(p => p?.success && setPatterns(p.data))
          }} className={'px-2.5 h-7 rounded-lg text-[12px] border transition-colors ' +
            (showPatterns ? 'bg-amber-500/15 border-amber-500/50 text-amber-600 dark:text-amber-400' : 'text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] border-transparent')}>
            ▤ 模式分组{patterns ? `（${patterns.distinct}）` : ''}
          </button>
          {patternSel && (
            <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-600 dark:text-amber-400 text-[11px] max-w-[420px]">
              <span className="truncate font-mono">{patternSel}</span>
              <button onClick={() => setPatternSel(null)} className="w-4 h-4 rounded-full hover:bg-amber-500/20 text-[10px] shrink-0">✕</button>
            </span>
          )}
          <span className="text-[11px] text-stone-400">{patternSel ? '（已在本页结果内筛选该模式）' : ''}</span>
        </div>
        {showPatterns && patterns && (
          <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-white dark:bg-[#141312] overflow-hidden mb-3">
          <div className="max-h-64 overflow-y-auto">
            {patterns.items.map(p => (
              <button key={p.pattern} onClick={() => setPatternSel(patternSel === p.pattern ? null : p.pattern)}
                className={'w-full flex items-center gap-3 px-3.5 py-2 border-t border-black/[0.06] dark:border-white/[0.06] first:border-t-0 text-left transition-colors ' +
                  (patternSel === p.pattern ? 'bg-amber-500/10' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]')}>
                <span className="shrink-0 px-1.5 py-px rounded bg-stone-200/70 dark:bg-white/10 text-[10.5px] font-medium tabular-nums">{p.count}</span>
                <span className="flex-1 min-w-0 truncate font-mono text-[11.5px] text-stone-600 dark:text-stone-300" title={`样例：${p.sample}`}>{p.pattern}</span>
                <span className="shrink-0 flex gap-1">
                  {Object.entries(p.levels).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([lv, c]) => (
                    <span key={lv} className="text-[10px] px-1 rounded" style={{ color: LEVEL_TEXT_FILL[lv] }}>{lv} {c}</span>
                  ))}
                </span>
              </button>
            ))}
            {patterns.items.length === 0 && <p className="text-[12px] text-stone-400 py-6 text-center">窗口内没有可归并的日志</p>}
          </div>
          {patterns.items.length > 7 && (
            <p className="px-3.5 py-1.5 text-[10.5px] text-stone-400 border-t border-black/[0.06] dark:border-white/[0.06]">
              共 {patterns.distinct} 组 · 面板内滚动查看全部
            </p>
          )}
          </div>
        )}

        {/* 结果 */}
        <div className="flex items-center mb-1.5">
          <span className="text-[11.5px] text-stone-400 tabular-nums">
            {loading ? '查询中…' : `共 ${total} 条`}
            {displayItems && ` · 已加载 ${displayItems.length}`}
            {liveTail && <span className="ml-2 text-amber-600 dark:text-amber-400">● 实时追尾中</span>}
          </span>
          <span className="ml-auto text-[11px] text-stone-400">j/k 选行 · Enter 展开 · / 搜索 · 点击行展开全部字段</span>
        </div>

        <div className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] overflow-hidden bg-white dark:bg-[#141312]">
          {!loading && displayItems && displayItems.length === 0 ? (
            <p className="text-[12.5px] text-stone-400 py-16 text-center">
              没有匹配的日志 —— 试试放宽时间范围或减少过滤条件
              <span className="block mt-1.5 text-[11px] text-stone-400/70">SDK 接入：lizysdk setup_logging(..., send_json=True, send_url="http://&lt;host&gt;:60100/api/v1/logs")</span>
            </p>
          ) : (displayItems || []).map((l, i) => (
            <div key={l.id} data-logrow>
              <LogRow log={l} term={q.trim()} selected={i === selIdx}
                newFlash={newIds.has(l.id)}
                expanded={expandedId === l.id}
                onToggle={() => { setExpandedId(c => c === l.id ? null : l.id); setSelIdx(i) }}
                onKvFilter={addKvFilter} onSysFilter={setSysFilter} onLevelFilter={setLevelFilterChip} onTraceFilter={setTraceFilter}
                onContext={setContextLog} onOpenTrace={setTraceFor} />
            </div>
          ))}
          {loading && !displayItems && (
            <div className="py-16 space-y-2.5 px-3">
              {[...Array(6)].map((_, i) => <div key={i} className="h-4 rounded bg-black/[0.04] dark:bg-white/[0.05] animate-pulse" />)}
            </div>
          )}
        </div>
        {/* 无限滚动哨兵 */}
        <div ref={sentinelRef} className="h-10 flex items-center justify-center gap-3">
          {displayItems && displayItems.length < total && !liveTail && (
            <button onClick={loadMore} disabled={loading}
              className="px-3 h-7 rounded-lg text-[12px] text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14] disabled:opacity-40">
              {loading ? '加载中…' : `加载更多（${displayItems.length}/${total}）`}
            </button>
          )}
          {liveTail && <span className="text-[11.5px] text-stone-400">实时模式下新日志自动置顶</span>}
        </div>
      </main>

      {contextLog && <ContextModal log={contextLog} onClose={() => setContextLog(null)} onOpenTrace={tid => { setContextLog(null); setTraceFor(tid) }} />}
      {traceFor && <TraceModal traceId={traceFor} onClose={() => setTraceFor(null)} />}
      {alertOpen && <AlertModal onClose={() => { setAlertOpen(false); sdklogAlerts().then(d => d.success && setUnacked(d.data.unacked)).catch(() => {}) }} />}
    </div>
  )
}
