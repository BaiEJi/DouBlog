/**
 * 日记公共小件：心情模型 / 天气码映射 / 图标 / 轻组件（供各视图复用）。
 */

export const MOODS = [
  { key: 'great', label: '很棒', emoji: '😄', color: '#f59e0b' },
  { key: 'good', label: '不错', emoji: '🙂', color: '#84a860' },
  { key: 'ok', label: '一般', emoji: '😐', color: '#a8a29e' },
  { key: 'low', label: '低落', emoji: '😕', color: '#7d9bb3' },
  { key: 'bad', label: '糟糕', emoji: '😖', color: '#d8849c' },
]
export const moodOf = k => MOODS.find(m => m.key === k)

const WMO = {
  0: ['晴', '☀️'], 1: ['基本晴', '🌤️'], 2: ['多云', '⛅'], 3: ['阴', '☁️'],
  45: ['雾', '🌫️'], 48: ['雾凇', '🌫️'], 51: ['小毛雨', '🌦️'], 53: ['毛雨', '🌦️'], 55: ['大毛雨', '🌦️'],
  61: ['小雨', '🌧️'], 63: ['中雨', '🌧️'], 65: ['大雨', '⛈️'], 71: ['小雪', '🌨️'], 73: ['中雪', '🌨️'],
  75: ['大雪', '❄️'], 80: ['阵雨', '🌦️'], 81: ['强阵雨', '🌧️'], 82: ['暴雨', '⛈️'], 95: ['雷暴', '⛈️'],
}
export const weatherIcon = code => (WMO[code] || ['—', '🌡️'])[1]

export const Icon = {
  timeline: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h13"/></svg>,
  calendar: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/></svg>,
  heat: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="4" width="4" height="7" rx="1" opacity=".35"/><rect x="3" y="13" width="4" height="7" rx="1" opacity=".8"/><rect x="9" y="4" width="4" height="3" rx="1" opacity=".5"/><rect x="9" y="9" width="4" height="11" rx="1"/><rect x="15" y="4" width="4" height="9" rx="1" opacity=".6"/><rect x="15" y="15" width="4" height="5" rx="1" opacity=".3"/></svg>,
  stats: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>,
  sparkle: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" opacity=".9"/><path d="M19 14l.9 2.6L22.5 17.5l-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14z" opacity=".6"/></svg>,
  trash: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>,
  pin: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>,
  archive: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/></svg>,
  share: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/></svg>,
  edit: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 20h4L20 8l-4-4L4 16v4zM13 7l4 4"/></svg>,
  location: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>,
  arrowL: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 5l-7 7 7 7"/></svg>,
  arrowR: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 5l7 7-7 7"/></svg>,
}

export function Chip({ children, onClick, active, title }) {
  return (
    <button onClick={onClick} title={title}
      className={'px-2 h-6 rounded-full text-[11.5px] border transition-colors inline-flex items-center gap-1 ' +
        (active
          ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
          : 'bg-black/[0.03] dark:bg-white/[0.05] border-black/[0.06] dark:border-white/[0.08] text-stone-500 hover:border-black/15 dark:hover:border-white/20')}>
      {children}
    </button>
  )
}

/** 确认弹层 */
export function Confirm({ text, onOk, onCancel, danger }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="w-full max-w-xs p-5 rounded-2xl bg-white dark:bg-[#1c1b1a] shadow-xl animate-dropdown"
        onClick={e => e.stopPropagation()}>
        <p className="text-[13.5px] leading-relaxed mb-4">{text}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 h-8 rounded-lg text-xs font-medium text-stone-600 dark:text-stone-300 bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/[0.14]">取消</button>
          <button onClick={onOk}
            className={'px-3 h-8 rounded-lg text-xs font-medium ' + (danger
              ? 'text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20'
              : 'text-white bg-stone-900 dark:bg-stone-100 dark:text-stone-900 hover:opacity-90')}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
